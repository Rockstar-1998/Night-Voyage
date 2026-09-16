# 修复预设导入反序列化 InventoryItem 驼峰命名错误 Walkthrough

## 1. 改动摘要
- **修改文件**: `测试预设/Night Voyage 全能进阶核心预设 V2.2.nvpreset.json`
- **改动位置**: 蓝图图中的确定性物品运算器节点 `n_calc_add_potion` 的 `config.item_def` 配置项
- **改动详情**:
  - 将 `item_def` 中的 `unit_weight: 0.5` 修改为 `unitWeight: 0.5`
  - 将 `item_def` 中的 `unit_price: 25.0` 修改为 `unitPrice: 25.0`

## 2. 改动动机
在导入预设时，Tauri 后端 `PresetService::import` 触发 `validate_blueprint_graph`，通过 `serde_json::from_str::<BlueprintGraph>` 反序列化校验图数据。
`CalculatorConfig` 中引用的 `Option<crate::models::game_state::InventoryItem>` 结构体定义携带了 `#[serde(rename_all = "camelCase")]` 属性：
```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryItem {
    pub id: String,
    pub name: String,
    pub count: i64,
    pub unit_weight: f64,
    pub unit_price: f64,
    pub icon: Option<String>,
    #[serde(default)]
    pub properties: HashMap<String, String>,
}
```
因此 Serde 在反序列化 `item_def` 时严格要求键名为驼峰命名 `unitWeight` 与 `unitPrice`。原预设 JSON 中误写为下划线命名 `unit_weight` 与 `unit_price`，导致报出 `missing field unitWeight at line 1 column 56348` 错误。将预设中的字段精准对齐 Rust Serde 协议的驼峰命名后修复该反序列化异常。

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 未修改任何前端逻辑，仅修复预设数据契约 |
| C2 Zero-Fallback Errors | √ | 严格对齐 Serde 数据反序列化类型安全契约，零静默容错 |
| C3 Responsiveness | √ | 预设 JSON 导入秒级完成，纯结构化校验 |
| C4 AI UI Isolation | √ | 无关 |
| C5 Mobile Frontend Independence | √ | 预设为双端共享数据资产，双端皆可正常导入 |
| C6 Project Cache Location | √ | 无任何系统盘写入 |
| C7 PC/Android Coverage | √ | 统一生效于 PC 与移动端共享的 Tauri/Rust 预设解析层 |

## 4. 验收记录
- **拓扑与规范检验**: `python "测试预设\validate_v22.py"`
  - 预期效果: 19 个 Gate 全部合法 Merge，108 个节点 151 条连线全部拓扑连通。
  - 实际结果: `ALL CHECKS PASSED`
- **Rust Serde 严格对齐校验**: `python "scratch\verify_serde.py"`
  - 预期效果: 全部 108 个节点的字段命名均与 Rust Serde 类型定义严格对齐。
  - 实际结果: `SERDE VALIDATION PASSED: All 108 nodes strictly adhere to Rust deserialization models!`
- **六大场景运行时图仿真**: `python "scratch\test_adapted_graph.py"`
  - 预期效果: 6/6 场景测试用例全部绿灯通过。
  - 实际结果: `ALL SIMULATION AND ASSERTION TESTS PASSED COMPLETELY (6/6)!`

## 5. 已知限制或后续待办
- 无。可直接在客户端导入该预设。
