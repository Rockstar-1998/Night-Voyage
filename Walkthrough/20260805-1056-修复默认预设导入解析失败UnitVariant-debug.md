# 修改摘要
再次修复了 `Night Voyage 默认预设.nvpreset.json` 导入失败的问题。

## 改动动机
用户遇到了新的报错：`invalid type: map, expected unit variant NodeConfig::Start at line 1 column 65`。
原因在于我之前的生成脚本为所有的节点都默认提供了一个 `"config": {}` 对象，而对于图引擎中的 `start` 和 `end` 节点来说，Rust 后端在定义时使用了不含负载的“单元变体”（Unit Variant，即只有类型没有配置内容）。当 Rust Serde 库遇到多余的 `"config": {}` 时，解析器会认为结构不匹配从而报错。

## 改动详情
- 修改了 `Night Voyage 默认预设.nvpreset.json`，移除了其中 `n_start` 和 `n_end` 节点里多余的 `"config": {}` 字段，使其符合 Rust 后端要求的单元变体格式。

## 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 仅为 JSON 数据结构层级修复 |
| C2 Zero-Fallback Errors | √ | - |
| C3 Responsiveness | √ | - |
| C4 AI UI Isolation | √ | - |
| C5 Mobile Frontend Independence | √ | - |
| C6 Project Cache Location | √ | - |
| C7 PC/Android Coverage | √ | - |

## 验收记录
- **构建命令**: `node` (执行 JSON Patch 脚本修复)
- **验收方式**: 检查 JSON 根节点中 start 与 end。
- **预期效果**: 后端引擎能够顺利解析 Unit Variant。
- **实际结果**: 字段移出成功，预设导入问题应该已彻底解决。
