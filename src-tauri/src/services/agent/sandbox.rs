#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};

/// C6 强制约束根目录：沙盒目录统一落在 D:\software_cache\night_voyage\sandbox\<conversation_id>\
pub const SANDBOX_CACHE_ROOT: &str = r"D:\software_cache\night_voyage\sandbox";

/// 沙盒工作区三级隔离目录
#[derive(Debug, Clone)]
pub struct AgentSandbox {
    conversation_id: i64,
    base_dir: PathBuf,
    plan_dir: PathBuf,
    scratch_dir: PathBuf,
    output_dir: PathBuf,
}

impl AgentSandbox {
    /// 初始化指定会话的沙盒环境。若目录不存在则自动递归创建。
    /// 绝对遵循 C6 约束，严禁写入系统盘。
    pub fn new(conversation_id: i64) -> Result<Self, String> {
        let base_dir = Path::new(SANDBOX_CACHE_ROOT).join(conversation_id.to_string());
        let plan_dir = base_dir.join("plan");
        let scratch_dir = base_dir.join("scratch");
        let output_dir = base_dir.join("output");

        fs::create_dir_all(&plan_dir)
            .map_err(|e| format!("无法创建沙盒 plan 目录 ({}): {}", plan_dir.display(), e))?;
        fs::create_dir_all(&scratch_dir)
            .map_err(|e| format!("无法创建沙盒 scratch 目录 ({}): {}", scratch_dir.display(), e))?;
        fs::create_dir_all(&output_dir)
            .map_err(|e| format!("无法创建沙盒 output 目录 ({}): {}", output_dir.display(), e))?;

        Ok(Self {
            conversation_id,
            base_dir,
            plan_dir,
            scratch_dir,
            output_dir,
        })
    }

    pub fn conversation_id(&self) -> i64 {
        self.conversation_id
    }

    pub fn base_dir(&self) -> &Path {
        &self.base_dir
    }

    pub fn plan_dir(&self) -> &Path {
        &self.plan_dir
    }

    pub fn scratch_dir(&self) -> &Path {
        &self.scratch_dir
    }

    pub fn output_dir(&self) -> &Path {
        &self.output_dir
    }

    /// 写入 plan 目录文件（导演大纲、意图解析草案、检定规格等）
    pub fn write_plan(&self, filename: &str, content: &str) -> Result<PathBuf, String> {
        let target = self.plan_dir.join(filename);
        fs::write(&target, content)
            .map_err(|e| format!("沙盒 plan 文件写入失败 ({}): {}", target.display(), e))?;
        Ok(target)
    }

    /// 读取 plan 目录文件
    pub fn read_plan(&self, filename: &str) -> Result<String, String> {
        let target = self.plan_dir.join(filename);
        fs::read_to_string(&target)
            .map_err(|e| format!("沙盒 plan 文件读取失败 ({}): {}", target.display(), e)) }

    /// 写入 scratch 目录文件（中间草稿、思维链、Critic 评审批注等）
    pub fn write_scratch(&self, filename: &str, content: &str) -> Result<PathBuf, String> {
        let target = self.scratch_dir.join(filename);
        fs::write(&target, content)
            .map_err(|e| format!("沙盒 scratch 文件写入失败 ({}): {}", target.display(), e))?;
        Ok(target)
    }

    /// 读取 scratch 目录文件
    pub fn read_scratch(&self, filename: &str) -> Result<String, String> {
        let target = self.scratch_dir.join(filename);
        fs::read_to_string(&target)
            .map_err(|e| format!("沙盒 scratch 文件读取失败 ({}): {}", target.display(), e))
    }

    /// 写入 output 目录文件（已校验定稿正文快照）
    pub fn write_output(&self, filename: &str, content: &str) -> Result<PathBuf, String> {
        let target = self.output_dir.join(filename);
        fs::write(&target, content)
            .map_err(|e| format!("沙盒 output 文件写入失败 ({}): {}", target.display(), e))?;
        Ok(target)
    }

    /// 读取 output 目录文件
    pub fn read_output(&self, filename: &str) -> Result<String, String> {
        let target = self.output_dir.join(filename);
        fs::read_to_string(&target)
            .map_err(|e| format!("沙盒 output 文件读取失败 ({}): {}", target.display(), e))
    }

    /// 提交某一轮次的定稿，保存为 `turn_{round_index}.md`
    pub fn commit_turn(&self, round_index: i64, content: &str) -> Result<PathBuf, String> {
        let filename = format!("turn_{round_index}.md");
        self.write_output(&filename, content)
    }

    /// 列出 scratch 中所有的草稿或评审版本文件列表
    pub fn list_scratch_files(&self) -> Result<Vec<String>, String> {
        let mut files = Vec::new();
        let entries = fs::read_dir(&self.scratch_dir)
            .map_err(|e| format!("读取 scratch 目录失败: {}", e))?;
        for entry in entries.filter_map(Result::ok) {
            if let Ok(file_name) = entry.file_name().into_string() {
                files.push(file_name);
            }
        }
        files.sort();
        Ok(files)
    }

    /// 列出 output 中所有的定稿记录
    pub fn list_output_files(&self) -> Result<Vec<String>, String> {
        let mut files = Vec::new();
        let entries = fs::read_dir(&self.output_dir)
            .map_err(|e| format!("读取 output 目录失败: {}", e))?;
        for entry in entries.filter_map(Result::ok) {
            if let Ok(file_name) = entry.file_name().into_string() {
                files.push(file_name);
            }
        }
        files.sort();
        Ok(files)
    }
}
