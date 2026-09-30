# Tasks

- [x] Task 1: 修改 `tauri.conf.json` 的 `beforeDevCommand` 为空字符串
  - [x] SubTask 1.1: 将 `"beforeDevCommand": "npm run dev"` 改为 `"beforeDevCommand": ""`

- [x] Task 2: 修改 `start-dev.bat` 启动流程
  - [x] SubTask 2.1: 在 `npm run tauri dev` 之前，先启动 Vite dev server（`start /b npm run dev:frontend`）
  - [x] SubTask 2.2: 添加 HTTP 探测循环，等待 `http://127.0.0.1:1420` 可访问（使用 PowerShell `Invoke-WebRequest`）
  - [x] SubTask 2.3: Vite 就绪后，使用 `tauri dev --no-dev-server-wait` 启动 Tauri（跳过 dev server 等待，直接连接已运行的 Vite）
  - [x] SubTask 2.4: Tauri 退出后，清理 Vite 子进程（使用 PowerShell 查找并终止匹配的 node.exe）

- [ ] Task 3: 验证启动流程
  - [ ] SubTask 3.1: 确认 `tauri dev --no-dev-server-wait` 能正确连接到已运行的 Vite
  - [ ] SubTask 3.2: 确认 Tauri 退出后 Vite 进程被清理

# Task Dependencies

- Task 2 依赖 Task 1（需要先确认 beforeDevCommand 配置）
- Task 3 依赖 Task 1, Task 2
