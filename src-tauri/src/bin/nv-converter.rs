//! nv-converter：独立离线单向格式转换器（工单 06）。
//!
//! 把历史遗留的旧版蓝图图 JSON 单向升级为现行图语义（version 2 + value
//! 引脚数据流拓扑），并可直接产出新版 `.nv.ts` 代码预设（经工单 05 的
//! `blueprint_codec`）。本工具与主程序生产路径完全解耦：主程序不做任何
//! 旧格式运行时兼容，旧数据的升级只发生在这里、一次性、结果可见。
//!
//! 用法：
//!   nv-converter <input.json> [--output <file>] [--to-code] [--name <预设名>]
//!
//! - 默认输出升级后的新图 JSON（未指定 --output 时写 stdout）；
//! - `--to-code` 输出 `.nv.ts` 源码；`--name` 为代码中的预设名（缺省取
//!   输入文件主名）；
//! - 转换报告（做了哪些升级、哪些遗留项需人工关注）逐行打印到 stderr，
//!   失败退出码 1，绝不静默吞掉不可转换的输入（C2）。
//!
//! 已知旧格式差异（本工具的处理）：
//! 1. `version` 缺失或为 1 → 升级为 2（现行模型只接受 version 2）；
//! 2. 旧式拓扑：Constant 节点串在 exec 链上、直连 Branch 的 exec 入口 →
//!    改写为 value 引脚数据流（复用主程序同一条拓扑改写规则
//!    `normalize_legacy_value_edges`，单一事实来源，不另抄一份）；
//! 3. legacy `sampling_params` 节点：现行模型仍可加载（保留兼容变体），
//!    转换器原样保留并在报告中列出警告，建议人工按协议拆分——转换器不
//!    猜测目标协议、不做有损改写。

use std::process::ExitCode;

use serde_json::{json, Value};

use night_voyage_lib::{
    export_graph_to_code, normalize_legacy_value_edges, BlueprintGraph, NodeConfig,
};

/// 一次转换的可见报告：实际发生的升级动作与需人工关注的遗留项。
#[derive(Debug, Default)]
pub struct ConversionReport {
    pub changes: Vec<String>,
    pub warnings: Vec<String>,
}

/// 把旧图 JSON（serde_json::Value）单向升级为现行 `BlueprintGraph`。
///
/// 升级后经现行模型反序列化校验：能在主程序中加载是本函数的成功定义。
pub fn upgrade_legacy_graph(input: &Value) -> Result<(BlueprintGraph, ConversionReport), String> {
    let mut report = ConversionReport::default();
    let mut root = input.clone();
    let obj = root
        .as_object_mut()
        .ok_or_else(|| "旧图 JSON 顶层必须是对象".to_string())?;

    match obj.get("version") {
        None => {
            obj.insert("version".to_string(), json!(2));
            report
                .changes
                .push("缺少 version 字段：按 v1 旧图升级为 version=2".to_string());
        }
        Some(v) if v.as_i64() == Some(1) => {
            obj.insert("version".to_string(), json!(2));
            report.changes.push("version 1 -> 2".to_string());
        }
        Some(v) if v.as_i64() == Some(2) => {}
        Some(v) => {
            return Err(format!(
                "不支持的蓝图图版本: {}（仅可升级 version 缺失 / 1 / 2）",
                v
            ));
        }
    }

    let mut graph: BlueprintGraph = serde_json::from_value(root).map_err(|e| {
        format!("旧图数据未通过现行蓝图模型校验（无法升级）: {}", e).replace('\\', "/")
    })?;

    let rewritten = normalize_legacy_value_edges(&mut graph);
    if rewritten > 0 {
        report.changes.push(format!(
            "旧式 Constant->Branch exec 连线改写为 value 引脚数据流拓扑（{} 处）",
            rewritten
        ));
    }

    for node in &graph.nodes {
        if matches!(node.config, NodeConfig::SamplingParams(_)) {
            report.warnings.push(format!(
                "节点 {} 为 legacy sampling_params：已原样保留（现行模型可加载），建议人工按目标协议拆分为 sampling_params_openai / sampling_params_anthropic",
                node.id
            ));
        }
    }

    Ok((graph, report))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() || args.iter().any(|a| a == "--help" || a == "-h") {
        eprintln!(
            "用法: nv-converter <input.json> [--output <file>] [--to-code] [--name <预设名>]"
        );
        return ExitCode::from(2);
    }

    let input_path = &args[0];
    let mut output_path: Option<String> = None;
    let mut to_code = false;
    let mut preset_name: Option<String> = None;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--output" => {
                i += 1;
                match args.get(i) {
                    Some(path) => output_path = Some(path.clone()),
                    None => {
                        eprintln!("--output 缺少文件路径");
                        return ExitCode::from(2);
                    }
                }
            }
            "--to-code" => to_code = true,
            "--name" => {
                i += 1;
                match args.get(i) {
                    Some(name) => preset_name = Some(name.clone()),
                    None => {
                        eprintln!("--name 缺少预设名");
                        return ExitCode::from(2);
                    }
                }
            }
            other => {
                eprintln!("未知参数: {}", other);
                return ExitCode::from(2);
            }
        }
        i += 1;
    }

    let raw = match std::fs::read_to_string(input_path) {
        Ok(raw) => raw,
        Err(err) => {
            eprintln!("读取输入文件失败 {}: {}", input_path, err);
            return ExitCode::from(1);
        }
    };
    let input: Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(err) => {
            eprintln!("输入不是合法 JSON: {}", err);
            return ExitCode::from(1);
        }
    };

    let (graph, report) = match upgrade_legacy_graph(&input) {
        Ok(done) => done,
        Err(err) => {
            eprintln!("转换失败: {}", err);
            return ExitCode::from(1);
        }
    };
    for change in &report.changes {
        eprintln!("[upgrade] {}", change);
    }
    for warning in &report.warnings {
        eprintln!("[warning] {}", warning);
    }
    if report.changes.is_empty() {
        eprintln!("[upgrade] 输入已是现行格式，无拓扑/版本升级（仍完成校验与再输出）");
    }

    let output = if to_code {
        let name = preset_name.unwrap_or_else(|| {
            std::path::Path::new(input_path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("converted-preset")
                .to_string()
        });
        match export_graph_to_code(&graph, &name) {
            Ok(code) => code,
            Err(err) => {
                eprintln!("导出 .nv.ts 失败: {}", err);
                return ExitCode::from(1);
            }
        }
    } else {
        match serde_json::to_string_pretty(&graph) {
            Ok(text) => text,
            Err(err) => {
                eprintln!("序列化新图失败: {}", err);
                return ExitCode::from(1);
            }
        }
    };

    match output_path {
        Some(path) => {
            if let Err(err) = std::fs::write(&path, &output) {
                eprintln!("写入输出文件失败 {}: {}", path, err);
                return ExitCode::from(1);
            }
            eprintln!("[done] 已写入 {}", path);
        }
        None => println!("{}", output),
    }
    ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 旧图夹具：version 1 + Constant 串在 exec 链上的旧式拓扑。
    fn legacy_fixture() -> Value {
        json!({
            "version": 1,
            "nodes": [
                { "id": "start1", "type": "start", "position": { "x": 0.0, "y": 0.0 } },
                { "id": "const1", "type": "constant", "config": { "label": "金币", "source": "stats.gold" }, "position": { "x": 200.0, "y": 0.0 } },
                { "id": "branch1", "type": "branch", "config": { "label": "金币分支", "cases": [{ "match_value": "rich", "port": "rich" }], "default_port": "poor" }, "position": { "x": 400.0, "y": 0.0 } }
            ],
            "edges": [
                { "id": "e1", "source": "start1", "source_port": "out", "target": "const1", "target_port": "in", "order": 0 },
                { "id": "e2", "source": "const1", "source_port": "out", "target": "branch1", "target_port": "in", "order": 0 }
            ]
        })
    }

    /// 工单 06 核心断言：旧预设被完整升级为新图语义且可在主程序加载。
    #[test]
    fn test_legacy_v1_graph_upgrades_to_loadable_v2() {
        let (graph, report) = upgrade_legacy_graph(&legacy_fixture()).expect("upgrade");

        assert_eq!(graph.version, 2);
        assert!(report.changes.iter().any(|c| c.contains("version 1 -> 2")));
        assert!(report
            .changes
            .iter()
            .any(|c| c.contains("value 引脚")));

        // 拓扑改写：const1 -> branch1 落到 value 入口；start1 的 exec 边重定向到 branch1
        let e2 = graph.edges.iter().find(|e| e.id == "e2").expect("e2");
        assert_eq!(e2.target_port, "value");
        let e1 = graph.edges.iter().find(|e| e.id == "e1").expect("e1");
        assert_eq!(e1.target, "branch1");
        assert_eq!(e1.target_port, "in");

        // 主程序加载等价校验：新图 JSON 可被现行模型再次反序列化
        let json_text = serde_json::to_string(&graph).expect("serialize upgraded");
        let reloaded: BlueprintGraph =
            serde_json::from_str(&json_text).expect("upgraded graph must load in main program");
        assert_eq!(reloaded.version, 2);
        assert_eq!(reloaded.nodes.len(), 3);
    }

    /// 升级后的旧预设可直接产出 .nv.ts，且代码可被主程序编译回同一张图。
    #[test]
    fn test_legacy_preset_converts_to_nv_ts_and_back() {
        let (graph, _) = upgrade_legacy_graph(&legacy_fixture()).expect("upgrade");
        let code = export_graph_to_code(&graph, "旧预设").expect("export code");
        assert!(code.contains("flow.branch"), "分支节点应走 DSL: {}", code);
        let back = night_voyage_lib::import_code_to_graph(&code).expect("import back");
        assert_eq!(
            serde_json::to_value(&back).expect("value"),
            serde_json::to_value(&graph).expect("value"),
            "旧图升级 -> .nv.ts -> 回导入必须逐值一致"
        );
    }

    #[test]
    fn test_missing_version_is_upgraded_and_unknown_version_rejected() {
        let mut fixture = legacy_fixture();
        fixture.as_object_mut().expect("obj").remove("version");
        let (graph, report) = upgrade_legacy_graph(&fixture).expect("upgrade missing version");
        assert_eq!(graph.version, 2);
        assert!(report.changes.iter().any(|c| c.contains("缺少 version")));

        let mut bad = legacy_fixture();
        bad["version"] = json!(99);
        let err = upgrade_legacy_graph(&bad).expect_err("version 99 must be rejected");
        assert!(err.contains("不支持的蓝图图版本"), "实际: {}", err);
    }

    #[test]
    fn test_legacy_sampling_params_warns_but_loads() {
        let fixture = json!({
            "version": 1,
            "nodes": [
                { "id": "start1", "type": "start", "position": { "x": 0.0, "y": 0.0 } },
                { "id": "sp1", "type": "sampling_params", "config": { "temperature": 0.7, "top_p": 1.0, "max_tokens": null, "presence_penalty": 0.0, "frequency_penalty": 0.0, "stop": null, "thinking_enabled": null, "thinking_budget_tokens": null, "is_locked": false }, "position": { "x": 200.0, "y": 0.0 } }
            ],
            "edges": []
        });
        // 若夹具字段与现行 SamplingParamsConfig 不符，升级会在模型校验处报错——
        // 该断言同时锁定夹具与真实模型的一致性。
        let (graph, report) = upgrade_legacy_graph(&fixture).expect("upgrade sampling fixture");
        assert_eq!(graph.version, 2);
        assert!(report.warnings.iter().any(|w| w.contains("sampling_params")));
    }
}
