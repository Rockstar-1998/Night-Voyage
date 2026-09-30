# Tasks

- [x] Task 1: 删除根目录下废弃的构建脚本
  - [x] 删除 build-debug.bat
  - [x] 删除 build-release.bat
  - [x] 删除 run-release.bat

- [x] Task 2: 删除根目录下一次性修复脚本（fix_*.py）
  - [x] 删除 fix.py, fix2.py
  - [x] 删除 fix_animations_and_sizes.py, fix_character.py, fix_colors.py, fix_imports.py
  - [x] 删除 fix_new_chat.py, fix_onchange.py, fix_parenthesis.py, fix_parenthesis_2.py
  - [x] 删除 fix_remaining_cards.py, fix_settings.py, fix_settings3.py, fix_stuck_rounds.sql
  - [x] 删除 fix_syntax_final.py, fix_ui.py, fix_wb.py, fix_worldbook_app.py

- [x] Task 3: 删除根目录下一次性和调试脚本（refactor_*.py、trace*.py、其他）
  - [x] 删除 read_diff.py, rewrite_settings.py
  - [x] 删除 refactor.py, refactor_charactersidebar.py, refactor_detail.py, refactor_icons.py
  - [x] 删除 refactor_newchat.py, refactor_params.py, refactor_selects_1.py, refactor_selects_smart.py, refactor_worldbook.py
  - [x] 删除 trace.py, trace2.py, trace3.py

- [x] Task 4: 删除根目录下调试产物和临时文件
  - [x] 删除 cargo-build-log.txt
  - [x] 删除 diff.txt
  - [x] 删除 llm.txt

- [x] Task 5: 删除根目录下错放的角色卡 JSON 文件
  - [x] 删除 V9.4 [preview] 狐神抚 · 毓忻.json（文件已不存在）
  - [x] 删除 狐神抚 V9.4 [Night Voyage].json（文件已不存在）

- [x] Task 6: 删除 scripts/ 下未使用的脚本
  - [x] 删除 build-android-x86-debug.ps1, build-android-x86_64.ps1, build-android.ps1
  - [x] 删除 memory_leak_detector.cjs, memory_leak_detector.py
  - [x] 删除 mock-tauri-ws-server.js
  - [x] 删除 quick-install.ps1, sign-existing-apk.ps1, sign-release.ps1
  - [x] 删除 startup_benchmark.py, windows-build-release-with-timeout.ps1

- [x] Task 7: 删除 src-tauri/ 下一次性工具脚本
  - [x] 删除 fix-vendor-builds.py
  - [x] 删除 update-checksums.py

- [x] Task 8: 更新 scripts/README.md
  - [x] 重写 README.md，只保留当前使用的脚本说明

# Task Dependencies
- Task 8 依赖 Task 6（先删除脚本再更新 README）
- 其余任务相互独立，可并行执行
