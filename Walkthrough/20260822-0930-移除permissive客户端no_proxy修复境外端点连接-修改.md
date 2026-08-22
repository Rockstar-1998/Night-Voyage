# Walkthrough: 移除 permissive HTTP 客户端 .no_proxy() 修复境外端点连接失败

- 修改类型: 修改
- 日期: 2026-08-22
- 主题: NVIDIA 等境外自定义 provider `connection error` 根因修复

## 1. 改动摘要

**问题**：自定义 provider `integrate.api.nvidia.com` 每次 POST 都报
`connection error`（connect=false, request=true），即便禁用 keep-alive 池 + 传输层重试一次仍失败。
禁池方案（commit 4803672）已排除"复用死连接"假设。

**根因**：`http_client.rs` 的 `shared_http_client()` 与 `shared_permissive_http_client()`
硬编码 `.no_proxy()`，完全禁用系统/环境变量代理。NVIDIA 为境外节点，用户本机开虚拟网卡
（全局模式 VPN），国际流量须经代理/隧道；客户端裸连被路由拦截，故 `connection error`。
佐证：本沙箱 `curl` 直连与走 `HTTPS_PROXY` 均返回 401（TLS/TCP 正常），说明端点与协议无问题，
差异仅在客户端的 `no_proxy()`。

**改动文件与函数**：

- `src-tauri/src/services/http_client.rs`
  - `shared_http_client()`：移除 `.no_proxy()`。
  - `shared_permissive_http_client()`：移除 `.no_proxy()`。保留 `pool_max_idle_per_host(0)`
    （单次握手）及原注释约束（agent 模式禁用此线路，未来应改「保留池 + 传输层对 connection error
    重试一次」）。

移除后 reqwest 默认尊重系统/环境变量代理（`HTTPS_PROXY` / `HTTP_PROXY` / Windows 系统代理）；
未配置代理时等价于无代理，无副作用。

## 2. 改动动机

用户确认"开了虚拟网卡"（全局模式 VPN），印证代理为境外流量必经路径。移除 `no_proxy()` 后
客户端可经代理/隧道到达 NVIDIA，应消除 `connection error`。

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 纯后端网络层改动 |
| C2 Zero-Fallback Errors | √ | 未引入静默回退 |
| C3 Responsiveness | √ | 不改请求同步性 |
| C4 AI UI Isolation | √ | 不涉及 |
| C5 Mobile Frontend Independence | √ | 后端共享，双端受益 |
| C6 Project Cache Location | √ | 无缓存写入 |
| C7 PC/Android Coverage | √ | 共享 HTTP 客户端，双端均受益 |

## 4. 验收记录

- 构建命令（沙箱代理验证）：
  ```
  export PATH="/d/data/Night Voyage/.cache/cargo/bin:$PATH"
  cd "D:\data\Night Voyage/src-tauri"
  export CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS=""
  cargo check --message-format=short
  ```
- 实际结果：`Finished dev profile ... target(s)`，exit 0。
- 预期效果：本机重装后，NVIDIA 自定义 provider 请求经代理/VPN 到达，不再 `connection error`。
- 验收方式（必须在用户机器确认，沙箱是另一张网络无法复现）：
  重装运行一次 NVIDIA 请求，观察日志是否仍有 `connection error`。
  - 若仍失败：请告知 VPN 工具及其模式（系统代理 / 纯 TUN）。必要时在错误日志加 OS 级 errno
    （Connection refused / No route / TLS failed）精确定位。

## 5. 已知限制或后续待办

- 若用户 VPN 为**纯 TUN 网卡路由**（不设系统 HTTP 代理），`.no_proxy()` 本不影响 TCP 层，
  移除后可能仍失败——问题会落到 DNS / 出口 IP 被封 / TUN 未捕获 Tauri 后端进程流量。
  届时需按上节「验收方式」追加 OS errno 日志定位。
- agent 模式线路仍受 `pool_max_idle_per_host(0)` 约束（单次握手），密集串行调用有握手累积延迟；
  未来应改回「保留池 + 传输层对 connection error 重试一次」。
