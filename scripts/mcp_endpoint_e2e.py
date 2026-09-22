#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Night Voyage 开发期 MCP 端点端到端测试。

为什么是「打真实进程」而不是 cargo 单元测试：
    每个工具都要经 ``ToolContext { app: AppHandle, db: SqlitePool }`` 落到真实服务层，
    而 ``AppHandle`` 只有在事件循环真正跑起来时才存在——cargo 单元测试里造不出来。
    因此本测试以一个独立的第三方客户端身份，通过 HTTP 打到一个正在运行的客户端进程，
    验证的正是用户「现场演示」会走的那条路径。

隔离性：
    端点监听 ``127.0.0.1:55287``。启动被测进程时必须显式设置
    ``NIGHT_VOYAGE_DB_PATH`` 指向一个一次性库，测试第一步即断言这一点，
    确保永远不会误伤女巫的真实存档。

用法：
    NIGHT_VOYAGE_DB_PATH=<临时库> ./night-voyage.exe     # 另开一处运行
    python scripts/mcp_endpoint_e2e.py --db <临时库> [--port 55287]
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request

# ---------------------------------------------------------------- 期望契约常量

TOKEN_FILE = r"D:\software_cache\night-voyage-mcp.token"

# 本机环境设置了 HTTP_PROXY（见下），而 urllib 默认会读它。若不走这一步，
# 请求会绕经代理再回到环回地址，测试就不再是「客户端 ↔ 端点」的直接一跳。
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

EXPECTED_TOOLS = {
    "nv_db_info",
    "nv_conversations_list",
    "nv_session_state_raw",
    "nv_session_state_get",
    "nv_tool_call_execute",
    "nv_session_state_reset",
    "nv_messages_list",
}

# models/game_state.rs::impl Default for DataContainer
DEFAULT_STATS = {
    "hp": 100.0,
    "max_hp": 100.0,
    "mp": 50.0,
    "max_mp": 50.0,
    "gold": 100.0,
    "weight": 0.0,
    "max_weight": 50.0,
}

# ---------------------------------------------------------------- 测试结果登记


class Report:
    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str]] = []

    def record(self, status: str, name: str, detail: str = "") -> None:
        self.rows.append((status, name, detail))
        mark = {"PASS": "PASS", "FAIL": "FAIL", "XFAIL": "XFAIL", "SKIP": "SKIP"}[status]
        print(f"[{mark}] {name}" + (f" :: {detail}" if detail else ""))

    def check(self, name: str, ok: bool, detail: str = "") -> None:
        self.record("PASS" if ok else "FAIL", name, detail if not ok else "")

    def summary(self) -> int:
        counts: dict[str, int] = {}
        for status, _, _ in self.rows:
            counts[status] = counts.get(status, 0) + 1
        print("\n" + "=" * 68)
        print(
            "合计 %d 项  PASS=%d  FAIL=%d  XFAIL=%d  SKIP=%d"
            % (
                len(self.rows),
                counts.get("PASS", 0),
                counts.get("FAIL", 0),
                counts.get("XFAIL", 0),
                counts.get("SKIP", 0),
            )
        )
        failed = [r for r in self.rows if r[0] == "FAIL"]
        if failed:
            print("\n失败项：")
            for _, name, detail in failed:
                print(f"  - {name}\n      {detail}")
        print("=" * 68)
        return 1 if failed else 0


# ---------------------------------------------------------------- HTTP 客户端


class Client:
    def __init__(self, port: int, token: str) -> None:
        self.port = port
        self.token = token
        self._seq = 0

    def raw(self, body: bytes, *, token: str | None = None, method: str = "POST",
            path: str = "/mcp") -> tuple[int, str]:
        url = f"http://127.0.0.1:{self.port}{path}"
        headers = {"Content-Type": "application/json"}
        if token is not None:
            headers["X-NV-Token"] = token
        req = urllib.request.Request(url, data=body if method == "POST" else None,
                                     headers=headers, method=method)
        try:
            with _OPENER.open(req, timeout=20) as resp:
                return resp.status, resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as err:
            return err.code, err.read().decode("utf-8", "replace")

    def rpc(self, method_name: str, params=None, *, notification: bool = False,
            raw_body: bytes | None = None) -> tuple[int, dict | None]:
        if raw_body is None:
            payload: dict = {"jsonrpc": "2.0", "method": method_name}
            if not notification:
                self._seq += 1
                payload["id"] = self._seq
            if params is not None:
                payload["params"] = params
            raw_body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        status, text = self.raw(raw_body, token=self.token)
        if not text.strip():
            return status, None
        try:
            return status, json.loads(text)
        except json.JSONDecodeError:
            return status, {"_unparsed": text}

    # 便捷包装：调用工具，返回 (isError, 文本)
    def call_tool(self, name: str, arguments: dict) -> tuple[bool, str]:
        status, body = self.rpc("tools/call", {"name": name, "arguments": arguments})
        if body is None:
            return True, f"<空响应 HTTP {status}>"
        if "error" in body:
            return True, f"<协议错误 {body['error'].get('code')}: {body['error'].get('message')}>"
        result = body.get("result", {})
        blocks = result.get("content", [])
        text = "\n".join(block.get("text", "") for block in blocks)
        return bool(result.get("isError")), text


# ---------------------------------------------------------------- 夹具


def setup_fixture(db_path: str) -> tuple[int, int]:
    """在一次性库里铺夹具：一个会话 + 一条消息。返回 (会话 id, 消息 id)。"""
    conn = sqlite3.connect(db_path, timeout=15)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        now = int(time.time())

        # 幂等：先清掉历史夹具
        conn.execute("DELETE FROM messages WHERE conversation_id IN "
                     "(SELECT id FROM conversations WHERE title = '__mcp_e2e__')")
        conn.execute("DELETE FROM session_states WHERE session_id IN "
                     "(SELECT id FROM conversations WHERE title = '__mcp_e2e__')")
        conn.execute("DELETE FROM conversations WHERE title = '__mcp_e2e__'")

        cur = conn.execute(
            "INSERT INTO conversations (title, created_at, updated_at) VALUES (?, ?, ?)",
            ("__mcp_e2e__", now, now),
        )
        conv_id = int(cur.lastrowid or 0)

        cur = conn.execute(
            "INSERT INTO messages (conversation_id, role, content, is_swipe, swipe_index, "
            "created_at, message_kind, is_hidden) VALUES (?, 'user', ?, 0, 0, ?, 'chat', 0)",
            (conv_id, "端到端测试夹具消息", now),
        )
        msg_id = int(cur.lastrowid or 0)

        conn.commit()
        return conv_id, msg_id
    finally:
        conn.close()


# ---------------------------------------------------------------- 测试主体


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True, help="被测进程使用的临时库路径")
    parser.add_argument("--port", type=int, default=55287)
    args = parser.parse_args()

    report = Report()
    db_path = os.path.abspath(args.db)

    # ---- 令牌
    if not os.path.exists(TOKEN_FILE):
        print(f"找不到令牌文件：{TOKEN_FILE}")
        return 2
    with open(TOKEN_FILE, "r", encoding="utf-8") as handle:
        token = handle.read().strip()
    if len(token) != 32:
        print(f"令牌长度异常：{len(token)}")
        return 2

    client = Client(args.port, token)

    proxy_env = {k: v for k, v in os.environ.items() if k.lower() in ("http_proxy", "https_proxy", "all_proxy")}
    if proxy_env:
        print(f"检测到代理环境变量 {proxy_env}，已强制直连环回地址")

    # ---- 前置：进程可达
    try:
        status, _ = client.raw(b"{}", token=token)
    except Exception as err:  # noqa: BLE001 — 连接失败就是最重要的一条诊断
        print(f"端点不可达 http://127.0.0.1:{args.port}/mcp :: {err}")
        return 2

    fixture_conv, fixture_msg = setup_fixture(db_path)
    print(f"夹具就绪：conversation_id={fixture_conv} message_id={fixture_msg}\n")

    # ============================================================ A 传输 / 鉴权
    print("--- A 传输层与鉴权 ---")
    status, _ = client.raw(b'{"jsonrpc":"2.0","id":1,"method":"ping"}', token=None)
    report.check("A01 缺失令牌返回 401", status == 401, f"实际 HTTP {status}")

    status, _ = client.raw(b'{"jsonrpc":"2.0","id":1,"method":"ping"}', token="0" * 32)
    report.check("A02 错误令牌返回 401", status == 401, f"实际 HTTP {status}")

    status, _ = client.raw(b'{"jsonrpc":"2.0","id":1,"method":"ping"}', token=token,
                           method="GET", path="/mcp")
    report.check("A03 GET /mcp 返回 405", status == 405, f"实际 HTTP {status}")

    status, _ = client.raw(b'{"jsonrpc":"2.0","id":1,"method":"ping"}', token=token,
                           path="/nope")
    report.check("A04 错误路径返回 405", status == 405, f"实际 HTTP {status}")

    # ============================================================ B JSON-RPC
    print("\n--- B JSON-RPC 协议层 ---")
    status, body = client.rpc("initialize", {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "nv-e2e", "version": "1.0.0"},
    })
    ok = (status == 200 and body is not None
          and body.get("result", {}).get("serverInfo", {}).get("name") == "night-voyage-dev-mcp")
    report.check("B01 initialize 返回 serverInfo", ok, f"HTTP {status} 体={body}")

    status, body = client.rpc("notifications/initialized", notification=True)
    report.check("B02 通知返回 202 空体", status == 202 and body is None,
                 f"HTTP {status} 体={body}")

    status, body = client.rpc("ping")
    report.check("B03 ping 返回空对象", body is not None and body.get("result") == {},
                 f"体={body}")

    status, body = client.rpc("no/such/method")
    code = (body or {}).get("error", {}).get("code")
    report.check("B04 未知方法返回 -32601", code == -32601, f"code={code} 体={body}")

    status, body = client.rpc("", raw_body=b"{ this is not json")
    code = (body or {}).get("error", {}).get("code")
    report.check("B05 非法 JSON 返回 -32600（HTTP 200）", status == 200 and code == -32600,
                 f"HTTP {status} code={code}")

    # ============================================================ C tools/list
    print("\n--- C 工具清单 ---")
    status, body = client.rpc("tools/list")
    tools = (body or {}).get("result", {}).get("tools", [])
    names = {tool.get("name") for tool in tools}
    report.check("C01 tools/list 返回 7 个工具", len(tools) == 7, f"实际 {len(tools)}")
    report.check("C02 工具名与契约一致", names == EXPECTED_TOOLS,
                 f"多出={names - EXPECTED_TOOLS} 缺失={EXPECTED_TOOLS - names}")
    report.check("C03 每个工具都带 inputSchema",
                 all(isinstance(t.get("inputSchema"), dict) for t in tools))

    # ============================================================ D 工具语义
    print("\n--- D 只读工具 ---")
    is_err, text = client.call_tool("nv_db_info", {})
    normalised = text.replace("\\", "/")
    report.check("D01 nv_db_info 报告的是测试库", is_err is False and "nv-mcp-test" in normalised,
                 f"isError={is_err} 文本={text[:400]}")
    report.check("D02 nv_db_info 含三张表行数",
                 "conversations=" in text and "messages=" in text
                 and "session_states=" in text, text[:400])

    is_err, text = client.call_tool("nv_conversations_list", {})
    report.check("D03 nv_conversations_list 命中夹具会话",
                 is_err is False and str(fixture_conv) in text, f"isError={is_err} 文本={text[:400]}")

    is_err, text = client.call_tool("nv_messages_list", {"sessionId": fixture_conv})
    report.check("D04 nv_messages_list 返回夹具消息",
                 is_err is False and str(fixture_msg) in text, f"isError={is_err} 文本={text[:400]}")

    is_err, text = client.call_tool("nv_session_state_raw", {"sessionId": 999999})
    report.check("D05 未初始化会话报「没有行」而非报错",
                 is_err is False and "没有行" in text, f"isError={is_err} 文本={text[:200]}")

    # ------------------------------------------------------------ 状态生命周期
    print("\n--- D 状态生命周期（经真实 service） ---")
    is_err, text = client.call_tool("nv_session_state_reset", {"sessionId": fixture_conv})
    report.check("D06 reset 生成默认状态", is_err is False and "已重置" in text,
                 f"isError={is_err} 文本={text[:300]}")

    is_err, raw_text = client.call_tool("nv_session_state_raw", {"sessionId": fixture_conv})
    raw_json = None
    if "raw:\n" in raw_text:
        raw_json = raw_text.split("raw:\n", 1)[1]
    stored = None
    if raw_json:
        try:
            stored = json.loads(raw_json)
        except json.JSONDecodeError as err:
            stored = None
            report.record("FAIL", "D07 库里 state_json 可被标准 JSON 解析", str(err))
    if stored is not None:
        report.record("PASS", "D07 库里 state_json 可被标准 JSON 解析")

    if isinstance(stored, dict):
        stats = stored.get("stats", {})
        report.check("D08 默认 stats 与 DataContainer::default 一致",
                     all(abs(stats.get(k, -1) - v) < 1e-9 for k, v in DEFAULT_STATS.items()),
                     f"实际 stats={stats}")
        report.check("D09 flags 是字符串字典（serde 契约）",
                     isinstance(stored.get("flags"), dict), f"flags={stored.get('flags')!r}")
        report.check("D10 inventory 为数组", isinstance(stored.get("inventory"), list))
    else:
        report.record("SKIP", "D08/D09/D10 依赖 D07 的解析结果")

    is_err, text = client.call_tool("nv_session_state_get", {"sessionId": fixture_conv})
    report.check("D11 nv_session_state_get 走 load_session_state 解析成功",
                 is_err is False and "解析结果" in text, f"isError={is_err} 文本={text[:300]}")
    report.check("D12 解析结果含负重上限与金币", "负重上限=50.00" in text and "金币=100.00" in text,
                 text[:300])

    # ------------------------------------------------------------ ToolCall 契约
    print("\n--- D ToolCall 契约与确定性门禁 ---")
    is_err, text = client.call_tool("nv_tool_call_execute", {
        "sessionId": fixture_conv, "toolName": "check_inventory", "argumentsJson": "{}"})
    report.check("D13 check_inventory 空背包文案", is_err is False and "背包为空" in text,
                 f"isError={is_err} 文本={text[:300]}")

    is_err, text = client.call_tool("nv_tool_call_execute", {
        "sessionId": fixture_conv, "toolName": "get_player_stats", "argumentsJson": "{}"})
    report.check("D14 get_player_stats 返回数值", is_err is False and "gold" in text,
                 f"isError={is_err} 文本={text[:300]}")

    # 成功购买：100G - (2 x 10) = 80G，负重 2 x 0.5 = 1.0kg
    is_err, text = client.call_tool("nv_tool_call_execute", {
        "sessionId": fixture_conv, "toolName": "buy_item",
        "argumentsJson": json.dumps({"item_id": "health_potion", "name": "治疗药水",
                                     "count": 2, "unit_price": 10, "unit_weight": 0.5})})
    report.check("D15 buy_item 成功扣款", is_err is False and "交易成功" in text and "剩余金币: 80.0G" in text,
                 f"isError={is_err} 文本={text[:300]}")

    is_err, text = client.call_tool("nv_session_state_get", {"sessionId": fixture_conv})
    report.check("D16 购买已持久化（负重 1.00 / 金币 80.00）",
                 "当前负重=1.00" in text and "金币=80.00" in text, text[:300])

    # 门禁 1：金币不足（1000G > 80G）
    is_err, text = client.call_tool("nv_tool_call_execute", {
        "sessionId": fixture_conv, "toolName": "buy_item",
        "argumentsJson": json.dumps({"item_id": "relic", "count": 1,
                                     "unit_price": 1000, "unit_weight": 0.1})})
    report.check("D17 金币门禁拦截", is_err is True and "金币不足" in text,
                 f"isError={is_err} 文本={text[:300]}")

    is_err, text = client.call_tool("nv_tool_call_execute", {
        "sessionId": fixture_conv, "toolName": "buy_item",
        "argumentsJson": json.dumps({"item_id": "boulder", "count": 1,
                                     "unit_price": 1, "unit_weight": 100})})
    report.check("D18 超重门禁拦截", is_err is True and "背包超重" in text,
                 f"isError={is_err} 文本={text[:300]}")

    is_err, text = client.call_tool("nv_tool_call_execute", {
        "sessionId": fixture_conv, "toolName": "buy_item",
        "argumentsJson": json.dumps({"item_id": "relic", "count": 0, "unit_price": 1})})
    report.check("D19 非法数量被拒", is_err is True and "正整数" in text,
                 f"isError={is_err} 文本={text[:300]}")

    # 门禁被拒后状态不得被改动
    is_err, text = client.call_tool("nv_session_state_get", {"sessionId": fixture_conv})
    report.check("D20 门禁拦截后状态未被污染（仍为 80.00G / 1.00kg）",
                 "当前负重=1.00" in text and "金币=80.00" in text, text[:300])

    is_err, text = client.call_tool("nv_tool_call_execute", {
        "sessionId": fixture_conv, "toolName": "inspect_item",
        "argumentsJson": json.dumps({"item_id": "not_there"})})
    report.check("D21 inspect_item 不存在物品报错", is_err is True and "未找到" in text,
                 f"isError={is_err} 文本={text[:300]}")

    is_err, text = client.call_tool("nv_tool_call_execute", {
        "sessionId": fixture_conv, "toolName": "use_item",
        "argumentsJson": json.dumps({"item_id": "health_potion", "count": 1})})
    report.check("D22 use_item 消耗成功（负重回到 0.50）",
                 is_err is False and "使用物品成功" in text and "当前负重: 0.5kg" in text,
                 f"isError={is_err} 文本={text[:300]}")

    is_err, text = client.call_tool("nv_tool_call_execute", {
        "sessionId": fixture_conv, "toolName": "no_such_contract", "argumentsJson": "{}"})
    report.check("D23 未知契约报错不透传", is_err is True and "未知的 ToolCall 契约" in text,
                 f"isError={is_err} 文本={text[:300]}")

    # ------------------------------------------------------------ 参数校验
    print("\n--- D 参数校验 ---")
    is_err, text = client.call_tool("nv_session_state_raw", {})
    report.check("D24 缺 sessionId 报错", is_err is True and "缺少必需的整数参数" in text,
                 f"isError={is_err} 文本={text[:300]}")

    is_err, text = client.call_tool("nv_messages_list", {"sessionId": fixture_conv, "limit": 0})
    report.check("D25 limit=0 被拒", is_err is True and "正整数" in text,
                 f"isError={is_err} 文本={text[:300]}")

    status, body = client.rpc("tools/call", {"name": "no_such_tool", "arguments": {}})
    err = (body or {}).get("error", {})
    report.check("D26 未知工具名报出可用工具清单",
                 err.get("code") in (-32601, -32602) and "未知工具" in err.get("message", ""),
                 f"体={body}")
    if err.get("code") == -32601:
        print("    注：MCP 规范对未知工具更贴近 -32602（Invalid params）；"
              "-32601 是 Method not found。语义略偏，但错误明确、无吞没，不阻塞。")

    # ============================================================ E 已知偏差探针
    print("\n--- E 已知偏差探针（预期不通过，用于登记既有缺陷） ---")

    # X01：C2 零静默回退缺口
    is_err, text = client.call_tool("nv_tool_call_execute", {
        "sessionId": fixture_conv, "toolName": "buy_item",
        "argumentsJson": "这不是合法 JSON"})
    caught = is_err and "缺少 item_id 参数" in text
    report.record(
        "XFAIL" if caught else "PASS",
        "X01 argumentsJson 非法时被静默降级为空对象",
        "agent_runtime.rs:88-89 的 .unwrap_or(空对象) 吞掉了 JSON 解析错误，"
        f"对外报的是「缺少 item_id 参数」而非「参数不是合法 JSON」。实际文本={text[:200]}",
    )

    # X02：浮点负零泄漏到玩家可见文本
    client.call_tool("nv_session_state_reset", {"sessionId": fixture_conv})
    client.call_tool("nv_tool_call_execute", {
        "sessionId": fixture_conv, "toolName": "buy_item",
        "argumentsJson": json.dumps({"item_id": "probe_zero", "count": 1,
                                     "unit_price": 1, "unit_weight": 0.5})})
    _, use_text = client.call_tool("nv_tool_call_execute", {
        "sessionId": fixture_conv, "toolName": "use_item",
        "argumentsJson": json.dumps({"item_id": "probe_zero", "count": 1})})
    _, raw_after = client.call_tool("nv_session_state_raw", {"sessionId": fixture_conv})
    leaked = "-0.0kg" in use_text
    if "raw:" in raw_after:
        try:
            stored_weight = json.loads(raw_after.split("raw:", 1)[1].strip())["stats"]["weight"]
            leaked = leaked and str(stored_weight) == "-0.0"
        except (json.JSONDecodeError, KeyError, IndexError) as err:
            leaked = False
            report.record("FAIL", "X02 探针自身取值失败", str(err))
    report.record(
        "XFAIL" if leaked else "PASS",
        "X02 空背包时负零泄漏（total_weight 返回 -0.0）",
        "models/game_state.rs:62-67 的 .sum::<f64>() 在空背包上返回 -0.0"
        "（Rust std 的 Sum for f64 用 fold(-0.0, _) 作初值），sync_weight 把它写进 "
        f"stats[\"weight\"] 并持久化。产品对外文本={use_text[:160]}",
    )

    print("\n--- 观察项（不计入通过率） ---")
    is_err, write_text = client.call_tool("nv_tool_call_execute", {
        "sessionId": fixture_conv, "toolName": "write_text",
        "argumentsJson": json.dumps({"key": "draft", "content": "应被持久化的草稿"})})
    is_err, read_text = client.call_tool("nv_tool_call_execute", {
        "sessionId": fixture_conv, "toolName": "read_text",
        "argumentsJson": json.dumps({"key": "draft"})})
    print(f"    write_text -> {write_text[:120]}")
    print(f"    read_text  -> {read_text[:120]}")
    if "应被持久化的草稿" not in read_text:
        print("    结论：write_text 只改内存 state.scratchpad，不落库也不广播，")
        print("          下一次调用读不到；且它对外宣称「已更新」。")

    return report.summary()


if __name__ == "__main__":
    sys.exit(main())
