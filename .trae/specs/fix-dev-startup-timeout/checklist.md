# Checklist

## beforeDevCommand 配置

- [x] `tauri.conf.json` 的 `beforeDevCommand` 设置为空字符串（不执行任何命令）
- [x] `tauri dev` 不再启动 Vite（由 `start-dev.bat` 负责）

## 启动流程

- [x] `start-dev.bat` 先启动 Vite dev server
- [x] 启动脚本使用 HTTP 探测等待 Vite 就绪（无硬编码超时）
- [x] Vite 就绪后启动 `tauri dev --no-dev-server-wait`
- [x] Tauri 退出后 Vite 子进程被清理
- [x] 端口 1420 在 Tauri 退出后被释放

## 功能验证

- [ ] 冷启动（Vite 需要超过 180 秒）不再报 "Could not connect after 180s" 错误
- [ ] 热启动（Vite 快速就绪）正常工作
- [ ] Ctrl+C 终止启动脚本时，Vite 和 Tauri 进程都被清理
