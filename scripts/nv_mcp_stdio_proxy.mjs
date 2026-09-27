#!/usr/bin/env node
/**
 * Night Voyage —— stdio MCP 代理（应用生命周期监督者）
 *
 * 为什么要有这一层：直连 http://127.0.0.1:55287/mcp 的 http 型连接器，只有在**会话启动那一刻**
 * 客户端已经在运行时才能完成握手；客户端晚起，工具清单就永远进不了当前会话的工具索引。
 * 本代理由宿主（Agent 会话）spawn 为 stdio 子进程，存活与否与客户端无关，因此任何会话都能
 * 稳定拿到工具清单。
 *
 * 职责划分（单一实现，不做第二套）：
 *   1. 11 个 nv_* 业务工具：透传到客户端内的真实 Rust service（db/agent_runtime/蓝图），
 *      本代理不重写任何门禁、不重算状态、不自己拼 JSON。
 *   2. 3 个生命周期工具：启动 / 关闭 / 重启客户端进程（只有外部监督者能做）。
 *   3. 客户端未运行时，业务工具统一返回「程序未启动」，不静默降级、不伪造数据。
 *
 * 传输：stdin/stdout 上按行分隔的 JSON-RPC 2.0（MCP stdio 传输）。
 */

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HOST = '127.0.0.1';
const PORT = 55287;
const TOKEN_FILE = 'D:\\software_cache\\night-voyage-mcp.token';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const EXE_NAME = 'night-voyage.exe';
const START_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 60_000; // 截图等重操作留足时间

/** 读取鉴权令牌：令牌文件优先，环境变量兜底。 */
function loadToken() {
  try {
    const value = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (value) return value;
  } catch (_) {
    /* 文件不存在时走环境变量 */
  }
  return process.env.NV_MCP_TOKEN || '';
}

const TOKEN = loadToken();

// ---------------------------------------------------------------------------
// 进程/端点探测
// ---------------------------------------------------------------------------

/** 原始 socket 探测端点是否监听（不用 HTTP：本机有代理，进程死时会返回 502 而非拒绝）。 */
function isEndpointUp(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(PORT, HOST);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs, intervalMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(intervalMs);
  }
  return await predicate();
}

/** 实例目录与 exe 路径。instance: 'a' | 'b'。 */
function resolveInstance(instance) {
  const key = String(instance || 'a').toLowerCase();
  const dir = path.join(PROJECT_ROOT, '.cache', 'instances', `instance-${key}`);
  return { key, dir, exe: path.join(dir, EXE_NAME) };
}

// ---------------------------------------------------------------------------
// 透传调用
// ---------------------------------------------------------------------------

/** 向客户端内端点发一条 JSON-RPC（http 模块不走系统代理）。 */
function postJsonRpc(payload, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NV-Token': TOKEN,
          'Content-Length': body.length,
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(text));
          } catch (err) {
            reject(new Error(`端点返回的不是合法 JSON: ${text.slice(0, 300)}`));
          }
        });
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('请求端点超时')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** 透传到真实 service 的业务工具。 */
async function callThrough(name, args) {
  if (!(await isEndpointUp())) {
    return {
      content: [
        {
          type: 'text',
          text:
            `程序未启动：Night Voyage 客户端没有运行（端点 ${HOST}:${PORT} 未监听）。\n` +
            '请先用 nv_app_start 启动客户端，再调用本工具。',
        },
      ],
      isError: true,
    };
  }

  let response;
  try {
    response = await postJsonRpc({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args || {} },
    });
  } catch (err) {
    return {
      content: [{ type: 'text', text: `调用端点失败（客户端可能正在退出）: ${err.message}` }],
      isError: true,
    };
  }

  if (response.error) {
    return {
      content: [{ type: 'text', text: `端点返回错误 ${response.error.code}: ${response.error.message}` }],
      isError: true,
    };
  }

  // 客户端侧已经把业务错误包成 isError 结果，原样透传，不改写、不吞错。
  return (
    response.result || {
      content: [{ type: 'text', text: '端点返回了空结果' }],
      isError: true,
    }
  );
}

// ---------------------------------------------------------------------------
// 生命周期工具
// ---------------------------------------------------------------------------

async function toolAppStart(args) {
  if (await isEndpointUp()) {
    return textResult(
      `客户端已在运行（端点 ${HOST}:${PORT} 已监听），未重复启动。`,
    );
  }

  const { key, dir, exe } = resolveInstance(args.instance);
  if (!fs.existsSync(exe)) {
    return errorResult(`找不到客户端可执行文件: ${exe}\n（实例 ${key} 的 exe 应由 scripts/build_dual_release.bat 生成）`);
  }

  // 以 exe 所在目录为工作目录启动：resolve_db_path 的「exe 同目录」分支由此命中真实库。
  const child = spawn(exe, [], {
    cwd: dir,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();

  const startedAt = Date.now();
  const up = await waitFor(isEndpointUp, START_TIMEOUT_MS, 1000);
  if (!up) {
    return errorResult(
      `已启动进程（pid=${child.pid}），但 ${Math.round(START_TIMEOUT_MS / 1000)}s 内端点 ${HOST}:${PORT} 仍未监听。\n` +
        '可能原因：该 exe 不是带 mcp-dev 特性构建的，或启动过程报错。',
    );
  }

  return textResult(
    `已启动 Night Voyage 客户端\n实例: instance-${key}\n路径: ${exe}\npid: ${child.pid}\n` +
      `端点 ${HOST}:${PORT} 于 ${((Date.now() - startedAt) / 1000).toFixed(1)}s 后就绪`,
  );
}

function killProcesses(force) {
  const args = force ? ['/IM', EXE_NAME, '/F'] : ['/IM', EXE_NAME];
  // 取原始字节自己解码：taskkill 的回显是 GBK，交给 Node 默认 utf8 会变乱码。
  const result = spawnSync('taskkill', args, { encoding: 'buffer' });
  const decoder = new TextDecoder('gb18030');
  return {
    ok: result.status === 0,
    output: `${decoder.decode(result.stdout || Buffer.alloc(0))}${decoder.decode(result.stderr || Buffer.alloc(0))}`.trim(),
  };
}

async function toolAppStop(_args) {
  if (!(await isEndpointUp())) {
    return textResult(`客户端未在运行（端点 ${HOST}:${PORT} 未监听），无需关闭。`);
  }

  // 先发正常的关闭请求，给窗口过程保存状态的机会；超时后再强杀。
  let kill = killProcesses(false);
  const down = await waitFor(async () => !(await isEndpointUp()), 8000, 500);
  if (!down) {
    kill = killProcesses(true);
    const forced = await waitFor(async () => !(await isEndpointUp()), STOP_TIMEOUT_MS, 500);
    if (!forced) {
      return errorResult(`关闭失败，端点仍在监听。taskkill 输出: ${kill.output}`);
    }
  }

  return textResult(`已关闭 Night Voyage 客户端，端点 ${HOST}:${PORT} 已停止监听。\ntaskkill: ${kill.output || '(无输出)'}`);
}

async function toolAppRestart(args) {
  const stop = await toolAppStop(args);
  if (stop.isError) return stop;
  await sleep(1000);
  const start = await toolAppStart(args);
  const merged = `${stop.content[0].text}\n${start.content[0].text}`;
  return start.isError ? errorResult(merged) : textResult(merged);
}

// ---------------------------------------------------------------------------
// 工具清单（与 src-tauri/src/mcp/tools.rs 的契约保持一致）
// ---------------------------------------------------------------------------

const SESSION_ID_PROP = {
  type: 'integer',
  description: '会话 id（等于 conversations.id）',
};

const PASSTHROUGH_TOOLS = [
  {
    name: 'nv_db_info',
    description:
      '报告客户端当前连接的 SQLite 库路径与 conversations / messages / session_states 行数，用于确认操作的是同一个库。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'nv_conversations_list',
    description: '列出库中全部会话（id、绑定的角色卡、标题、创建与更新时间戳）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'nv_session_state_raw',
    description:
      '读取 session_states.state_json 的原始字符串，不做解析与修补，用于区分「库里的数据坏了」和「界面渲染坏了」。',
    inputSchema: {
      type: 'object',
      properties: { sessionId: SESSION_ID_PROP },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'nv_session_state_get',
    description:
      '调用后端 load_session_state 解析会话状态，与前端 session_game_state_get 完全同一条路径；解析失败原样报错，不降级。',
    inputSchema: {
      type: 'object',
      properties: { sessionId: SESSION_ID_PROP },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'nv_tool_call_execute',
    description:
      '调用后端 execute_tool_call 执行 ToolCall 契约（check_inventory / get_player_stats / inspect_item / buy_item / use_item / read_text / write_text）。含确定性门禁、状态持久化与 HUD 增量广播，结果实时反映到运行中的界面。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: SESSION_ID_PROP,
        toolName: { type: 'string', description: 'ToolCall 契约名' },
        argumentsJson: {
          type: 'string',
          description: '参数对象序列化后的 JSON 字符串，例如 {"item_id":"health_potion","count":1}',
        },
      },
      required: ['sessionId', 'toolName', 'argumentsJson'],
      additionalProperties: false,
    },
  },
  {
    name: 'nv_preset_gate_select',
    description:
      '设置某预设下 Gate 节点选中的键（等价于在预设详情页 Gate 面板里勾选）。决定蓝图中该分支后方的节点链是否参与编译——例如选中 inventory_trade 才会生成 buy_item 的工具执行计划。',
    inputSchema: {
      type: 'object',
      properties: {
        presetId: { type: 'integer', description: '预设 id' },
        nodeId: { type: 'string', description: '蓝图 Gate 节点 id，例如 n_rpg_engine_gate' },
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: '选中的键；空数组表示取消选择',
        },
      },
      required: ['presetId', 'nodeId', 'keys'],
      additionalProperties: false,
    },
  },
  {
    name: 'nv_session_state_reset',
    description:
      '调用后端 reset_session_state 把会话状态重置为默认初始状态（由 serde 序列化生成，字段名必然符合 camelCase 契约），并广播 HUD 增量。',
    inputSchema: {
      type: 'object',
      properties: { sessionId: SESSION_ID_PROP },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'nv_messages_list',
    description: '列出指定会话的消息（id、角色、时间戳、正文长度、swipe 状态），默认最多 50 条。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: SESSION_ID_PROP,
        limit: { type: 'integer', description: '最多返回条数，默认 50' },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'nv_blueprint_get',
    description:
      '读取预设的蓝图图 JSON（nodes + edges），与蓝图编辑器打开该预设时使用的是同一份数据。',
    inputSchema: {
      type: 'object',
      properties: { presetId: { type: 'integer', description: '预设 id' } },
      required: ['presetId'],
      additionalProperties: false,
    },
  },
  {
    name: 'nv_blueprint_save',
    description:
      '写回预设的蓝图图 JSON（先经 normalize_blueprint_graph 归一化校验），保存路径与蓝图编辑器点击保存完全一致。',
    inputSchema: {
      type: 'object',
      properties: {
        presetId: { type: 'integer', description: '预设 id' },
        graphJson: { type: 'string', description: '完整蓝图图 JSON（nodes + edges）' },
      },
      required: ['presetId', 'graphJson'],
      additionalProperties: false,
    },
  },
  {
    name: 'nv_screenshot',
    description:
      '抓取运行中客户端窗口的真实像素并存为 PNG，返回文件路径与尺寸。用于确认 HUD 增量广播是否真的刷新了界面（屏幕实抓，非渲染合成）。',
    inputSchema: {
      type: 'object',
      properties: {
        outputPath: {
          type: 'string',
          description: 'PNG 输出路径；缺省写到 D:\\software_cache\\nv-screenshot-<时间戳>.png',
        },
      },
      additionalProperties: false,
    },
  },
];

const LIFECYCLE_TOOLS = [
  {
    name: 'nv_app_start',
    description:
      '启动 Night Voyage 客户端（以 exe 同目录为工作目录，因此命中的是实例自己的真实库）。已在运行时不重复启动，会等待端点就绪后返回。',
    inputSchema: {
      type: 'object',
      properties: {
        instance: {
          type: 'string',
          description: "实例名：'a' 或 'b'，默认 'a'",
          enum: ['a', 'b'],
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'nv_app_stop',
    description: '关闭 Night Voyage 客户端：先发正常关闭请求，超时后强杀。未运行则直接返回无需关闭。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'nv_app_restart',
    description: '重启 Night Voyage 客户端：先关闭再启动，返回两阶段结果。用于让重新构建的 exe 生效。',
    inputSchema: {
      type: 'object',
      properties: {
        instance: {
          type: 'string',
          description: "实例名：'a' 或 'b'，默认 'a'",
          enum: ['a', 'b'],
        },
      },
      additionalProperties: false,
    },
  },
];

const ALL_TOOLS = [...PASSTHROUGH_TOOLS, ...LIFECYCLE_TOOLS];

function textResult(text) {
  return { content: [{ type: 'text', text }], isError: false };
}

function errorResult(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

async function dispatchCall(name, args) {
  switch (name) {
    case 'nv_app_start':
      return toolAppStart(args || {});
    case 'nv_app_stop':
      return toolAppStop(args || {});
    case 'nv_app_restart':
      return toolAppRestart(args || {});
    default:
      if (ALL_TOOLS.some((tool) => tool.name === name)) {
        return callThrough(name, args);
      }
      return errorResult(
        `未知工具: ${name}\n可用工具: ${ALL_TOOLS.map((t) => t.name).join(', ')}`,
      );
  }
}

// ---------------------------------------------------------------------------
// stdio JSON-RPC 主循环
// ---------------------------------------------------------------------------

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function log(message) {
  // stdout 是协议通道，日志只能走 stderr。
  process.stderr.write(`[nv-proxy] ${message}\n`);
}

async function handle(message) {
  const { id, method, params } = message || {};

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'night-voyage-dev-mcp', version: '0.2.0' },
        },
      };

    case 'notifications/initialized':
    case 'initialized':
      return null; // 通知不回包

    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: ALL_TOOLS } };

    case 'tools/call': {
      try {
        const result = await dispatchCall(params?.name, params?.arguments);
        return { jsonrpc: '2.0', id, result };
      } catch (err) {
        return {
          jsonrpc: '2.0',
          id,
          result: errorResult(`调用 ${params?.name} 时抛出未处理异常: ${err.message}`),
        };
      }
    }

    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `不支持的方法: ${method}` },
      };
  }
}

async function main() {
  let buffer = '';
  process.stdin.setEncoding('utf8');

  // 串行队列：生命周期工具（启动/关闭/重启）会改变端点的存活性，若与业务工具并发，
  // 后发的请求可能打到正在退出的进程上，结果不可预期。按到达顺序逐条处理。
  let queue = Promise.resolve();
  const enqueue = (task) => {
    queue = queue.then(task).catch((err) => log(`队列任务失败: ${err.stack || err.message}`));
    return queue;
  };

  // stdin 关闭（宿主断开）时不能直接退出：可能还有正在等待端点的请求。
  // 等全部请求落地再退出，否则客户端侧的写入会被半途掐断。
  let pending = 0;
  let stdinEnded = false;
  const exitWhenIdle = () => {
    if (stdinEnded && pending === 0) process.exit(0);
  };

  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;

      let message;
      try {
        message = JSON.parse(line);
      } catch (err) {
        log(`忽略非法 JSON 行: ${line.slice(0, 200)}`);
        continue;
      }

      pending += 1;
      enqueue(async () => {
        try {
          const response = await handle(message);
          if (response) send(response);
        } catch (err) {
          log(`处理消息失败: ${err.stack || err.message}`);
        } finally {
          pending -= 1;
          exitWhenIdle();
        }
      });
    }
  });

  process.stdin.on('end', () => {
    stdinEnded = true;
    exitWhenIdle();
  });
  log(`stdio 代理就绪，转发目标 ${HOST}:${PORT}`);
}

main();
