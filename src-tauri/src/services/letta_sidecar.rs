use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const LETTA_PORT: u16 = 8283;
const PYTHON_VERSION: &str = "3.11.9";
const PYTHON_DOWNLOAD_URL: &str = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip";

/// run_letta.py 脚本内容，启动时写入缓存目录
const RUN_LETTA_PY: &str = r#"#!/usr/bin/env python3
"""Letta sidecar 启动脚本 — 由 Rust 写入缓存目录后执行。"""
import os
import sys
import types

# ── STEP 1: 环境变量 ──────────────────────────────────────────────
os.environ["LETTA_PG_URI"] = ""
os.environ.setdefault("LETTA_DEBUG", "false")

db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "letta.db")
os.environ["LETTA_DB_PATH"] = db_path

log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sidecar.log")

# ── STEP 2: 重定向 stdout/stderr 到 sidecar.log ──────────────────
# 保留原始 stdout/stderr 的 fileno 引用，因为 letta 在 import 时会调用
# faulthandler.enable()，后者需要 sys.stdout.fileno()。
_orig_stdout = sys.stdout
_orig_stderr = sys.stderr
log_file = open(log_path, "a", encoding="utf-8")
class _DualWriter:
    def __init__(self, orig, log):
        self._orig = orig
        self._log = log
    def write(self, data):
        for s in (self._orig, self._log):
            try:
                s.write(data)
                s.flush()
            except Exception:
                pass
    def flush(self):
        for s in (self._orig, self._log):
            try:
                s.flush()
            except Exception:
                pass
    def fileno(self):
        # 委托给原始 stdout，让 faulthandler.enable() 正常工作
        return self._orig.fileno()
    def isatty(self):
        return self._orig.isatty()
    def __getattr__(self, name):
        return getattr(self._orig, name)

sys.stdout = _DualWriter(_orig_stdout, log_file)
sys.stderr = _DualWriter(_orig_stderr, log_file)

print(f"\n{'='*60}", flush=True)
print(f"[run_letta] starting at {os.popen('echo %DATE% %TIME%').read().strip()}", flush=True)
print(f"[run_letta] db_path={db_path}", flush=True)
print(f"[run_letta] log_path={log_path}", flush=True)

# ── STEP 3: Mock asyncpg（在 import letta 之前） ─────────────────
asyncpg_mod = types.ModuleType("asyncpg")
asyncpg_excs = types.ModuleType("asyncpg.exceptions")

class _MockPostgresError(Exception):
    sqlstate = None

class _MockInterfaceError(Exception): pass
class _MockOperationalError(Exception): pass
class _MockUndefinedColumnError(_MockPostgresError): pass
class _MockUndefinedTableError(_MockPostgresError): pass

asyncpg_excs.PostgresError = _MockPostgresError
asyncpg_excs.InterfaceError = _MockInterfaceError
asyncpg_excs.OperationalError = _MockOperationalError
asyncpg_excs.UndefinedColumnError = _MockUndefinedColumnError
asyncpg_excs.UndefinedTableError = _MockUndefinedTableError
asyncpg_excs.UniqueViolationError = _MockPostgresError

asyncpg_mod.exceptions = asyncpg_excs
asyncpg_mod.connect = lambda *a, **kw: None
asyncpg_mod.create_pool = lambda *a, **kw: None

sys.modules["asyncpg"] = asyncpg_mod
sys.modules["asyncpg.exceptions"] = asyncpg_excs
print("[run_letta] asyncpg mocked", flush=True)

# ── STEP 4: 导入 letta 并 patch database_utils ───────────────────
import letta
print(f"[run_letta] letta version: {letta.__version__}", flush=True)

try:
    from letta.utils import database_utils
    _orig_resolve = getattr(database_utils, "resolve_uri_with_env_vars", None)
    def _patched_resolve(uri):
        if uri and uri.startswith("postgresql"):
            return uri
        if uri and not uri.startswith("sqlite"):
            uri = f"sqlite://{uri}"
        return uri
    if _orig_resolve:
        database_utils.resolve_uri_with_env_vars = _patched_resolve
    print("[run_letta] database_utils patched", flush=True)
except Exception as e:
    print(f"[run_letta] database_utils patch failed (non-fatal): {e}", flush=True)

# ── STEP 5: 导入 FastAPI app ─────────────────────────────────────
from letta.server.rest_api.app import app
print("[run_letta] FastAPI app imported", flush=True)

# ── STEP 6: 添加 CORS 中间件 ─────────────────────────────────────
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
print("[run_letta] CORS middleware added", flush=True)

# ── STEP 7: 自定义 /v1/internal/register-model 端点 ──────────────
from pydantic import BaseModel
from typing import Optional

class _RegisterModelRequest(BaseModel):
    provider_name: str
    model_name: str
    model_endpoint_type: str = "openai"
    context_window: int = 128000

@app.post("/v1/internal/register-model")
async def _register_model(req: _RegisterModelRequest):
    """直接在 Letta 数据库中注册模型，绕过自动发现。"""
    handle = f"{req.provider_name}/{req.model_name}"
    try:
        from letta.settings import LettaSettings
        from letta.orm import ProviderORM, ProviderModelORM
        from letta.orm.sqlalchemy_base import Session as _S
        from letta.schemas.provider import PydanticProviderModel
        from letta.constants import LettaPropertyType

        # 使用 Letta 的数据库 session
        from letta.server.db import db_registry
        async with db_registry.async_session() as session:
            # 查找 provider
            from sqlalchemy import select
            result = await session.execute(
                select(ProviderORM).where(ProviderORM.name == req.provider_name)
            )
            provider = result.scalars().first()
            if not provider:
                return {"ok": False, "error": f"provider '{req.provider_name}' not found"}

            # 检查模型是否已存在
            result = await session.execute(
                select(ProviderModelORM).where(ProviderModelORM.handle == handle)
            )
            existing = result.scalars().first()
            if existing:
                return {"ok": True, "handle": handle, "status": "exists"}

            # 创建新模型
            pydantic_model = PydanticProviderModel(
                handle=handle,
                display_name=req.model_name,
                name=req.model_name,
                provider_id=provider.id,
                organization_id=None,
                model_type="llm",
                enabled=True,
                model_endpoint_type=req.model_endpoint_type,
                max_context_window=req.context_window,
                supports_token_streaming=True,
                supports_tool_calling=True,
            )
            model = ProviderModelORM(**pydantic_model.model_dump(to_orm=True))
            session.add(model)
            await session.commit()
            return {"ok": True, "handle": handle, "status": "created"}
    except Exception as e:
        print(f"[run_letta] register-model error: {e}", flush=True)
        return {"ok": False, "error": str(e)}

print("[run_letta] /v1/internal/register-model endpoint registered", flush=True)

# ── STEP 8: 启动 uvicorn ─────────────────────────────────────────
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8283
host = "127.0.0.1"

print(f"[run_letta] starting uvicorn on {host}:{port}", flush=True)

import uvicorn
uvicorn.run(app, host=host, port=port, log_level="info")
"#;

/// Letta sidecar 运行状态
pub struct LettaSidecarState {
    pub child: Mutex<Option<Child>>,
    pub url: Mutex<Option<String>>,
}

impl Default for LettaSidecarState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            url: Mutex::new(None),
        }
    }
}

/// 解析缓存目录：统一存放至项目缓存根目录 D:\software_cache\letta
/// （遵循项目缓存硬约束，禁止写入 C 盘或系统盘）
pub fn resolve_cache_dir() -> Result<PathBuf, String> {
    let cache_dir = PathBuf::from(r"D:\software_cache\letta");
    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    Ok(cache_dir)
}

/// 确保 run_letta.py 脚本存在（总是覆盖以应用更新）
pub fn ensure_run_letta_script(cache_dir: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(cache_dir).map_err(|e| e.to_string())?;
    let script_path = cache_dir.join("run_letta.py");
    std::fs::write(&script_path, RUN_LETTA_PY).map_err(|e| e.to_string())?;
    Ok(script_path)
}

/// 确保 Python embeddable 环境存在
pub fn ensure_python_env(cache_dir: &Path) -> Result<PathBuf, String> {
    let python_dir = cache_dir.join("python");
    let python_exe = python_dir.join("python.exe");

    if python_exe.exists() {
        // 检查 letta 模块是否已安装
        let check = Command::new(&python_exe)
            .args(["-c", "import letta; print(letta.__version__)"])
            .output();

        if let Ok(output) = check {
            if output.status.success() {
                return Ok(python_exe);
            }
        }
    }

    // 下载 Python embeddable
    let zip_path = cache_dir.join("python_embed.zip");
    if !python_dir.exists() {
        std::fs::create_dir_all(&python_dir).map_err(|e| e.to_string())?;
    }

    if !python_exe.exists() {
        eprintln!("[letta-sidecar] downloading Python embeddable...");
        download_file(PYTHON_DOWNLOAD_URL, &zip_path)?;

        eprintln!("[letta-sidecar] extracting Python...");
        extract_zip(&zip_path, &python_dir)?;

        // 修改 ._pth 文件取消 import site 注释
        let pth_files: Vec<_> = std::fs::read_dir(&python_dir)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .ends_with("._pth")
            })
            .collect();

        for pth_file in pth_files {
            let path = pth_file.path();
            let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let new_content = content.replace("#import site", "import site");
            std::fs::write(&path, new_content).map_err(|e| e.to_string())?;
        }
    }

    // 安装 pip
    let pip_script = cache_dir.join("get-pip.py");
    if !pip_script.exists() {
        eprintln!("[letta-sidecar] downloading get-pip.py...");
        download_file("https://bootstrap.pypa.io/get-pip.py", &pip_script)?;
    }

    eprintln!("[letta-sidecar] installing pip...");
    let pip_result = Command::new(&python_exe)
        .args([pip_script.to_str().unwrap(), "--no-warn-script-location"])
        .output()
        .map_err(|e| e.to_string())?;

    if !pip_result.status.success() {
        let err = String::from_utf8_lossy(&pip_result.stderr);
        return Err(format!("pip installation failed: {}", err));
    }

    // 安装依赖
    eprintln!("[letta-sidecar] installing setuptools, wheel...");
    let _ = Command::new(&python_exe)
        .args([
            "-m",
            "pip",
            "install",
            "setuptools",
            "wheel",
            "--no-warn-script-location",
        ])
        .output();

    eprintln!("[letta-sidecar] installing letta and dependencies...");
    let letta_result = Command::new(&python_exe)
        .args([
            "-m",
            "pip",
            "install",
            "letta",
            "aiosqlite",
            "uvicorn",
            "fastapi",
            "--no-warn-script-location",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !letta_result.status.success() {
        let err = String::from_utf8_lossy(&letta_result.stderr);
        eprintln!("[letta-sidecar] letta installation stderr: {}", err);
        return Err(format!("letta installation failed: {}", err));
    }

    // 清理 zip
    let _ = std::fs::remove_file(&zip_path);

    eprintln!("[letta-sidecar] Python environment ready");
    Ok(python_exe)
}

/// 下载文件
fn download_file(url: &str, dest: &Path) -> Result<(), String> {
    let response = reqwest::blocking::get(url).map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("download failed: HTTP {}", response.status()));
    }
    let bytes = response.bytes().map_err(|e| e.to_string())?;
    std::fs::write(dest, bytes).map_err(|e| e.to_string())?;
    Ok(())
}

/// 用 PowerShell 解压 zip
fn extract_zip(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let output = Command::new("powershell")
        .args([
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &format!(
                "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                zip_path.display(),
                dest_dir.display()
            ),
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("extract failed: {}", err));
    }
    Ok(())
}

/// 清理端口占用
fn kill_port_occupant(port: u16) {
    let output = Command::new("netstat")
        .args(["-ano", "-p", "TCP"])
        .output();

    if let Ok(output) = output {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let listen_prefix = format!("  TCP    127.0.0.1:{}           0.0.0.0:0              LISTENING", port);

        for line in stdout.lines() {
            if line.contains(&format!(":{}", port)) && line.contains("LISTENING") {
                let pid: Vec<&str> = line.split_whitespace().collect();
                if let Some(pid_str) = pid.last() {
                    if let Ok(pid_num) = pid_str.parse::<u32>() {
                        if pid_num > 0 {
                            eprintln!(
                                "[letta-sidecar] killing port {} occupant PID {}",
                                port, pid_num
                            );
                            let _ = Command::new("taskkill")
                                .args(["/F", "/PID", &pid_num.to_string()])
                                .output();
                        }
                    }
                }
            }
        }
    }
}

/// 启动 sidecar 进程，返回 (child, url)
pub fn start_sidecar(cache_dir: &Path, port: u16) -> Result<(Child, String), String> {
    kill_port_occupant(port);

    let script_path = ensure_run_letta_script(cache_dir)?;
    let python_exe = ensure_python_env(cache_dir)?;

    let url = format!("http://127.0.0.1:{}", port);

    eprintln!(
        "[letta-sidecar] starting: python={} script={} port={}",
        python_exe.display(),
        script_path.display(),
        port
    );

    let child = Command::new(&python_exe)
        .arg(&script_path)
        .arg(port.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok((child, url))
}

/// 健康检查
pub async fn health_check(url: &str, max_attempts: u32) -> Result<(), String> {
    let health_url = format!("{}/v1/health/", url);
    let client = reqwest::Client::new();

    let initial_wait = Duration::from_secs(5);
    tokio::time::sleep(initial_wait).await;

    let interval = Duration::from_secs(2);
    let mut last_error = String::new();

    for attempt in 1..=max_attempts {
        match client.get(&health_url).timeout(Duration::from_secs(5)).send().await {
            Ok(resp) if resp.status().is_success() => {
                eprintln!("[letta-sidecar] health check passed after {} attempts", attempt);
                return Ok(());
            }
            Ok(resp) => {
                last_error = format!("HTTP {}", resp.status());
            }
            Err(e) => {
                last_error = e.to_string();
            }
        }

        if attempt < max_attempts {
            tokio::time::sleep(interval).await;
        }
    }

    let msg = format!(
        "Letta sidecar 健康检查超时（{}次尝试）: 最后错误: {}",
        max_attempts, last_error
    );
    eprintln!("[letta-sidecar] {}", msg);
    Err(msg.replace('\\', "/"))
}

/// 规范化 Windows UNC 路径
pub fn normalize_path(path: &Path) -> PathBuf {
    let s = path.to_string_lossy().to_string();
    if s.starts_with("\\\\?\\") {
        PathBuf::from(s[4..].replace('\\', "/"))
    } else {
        PathBuf::from(s.replace('\\', "/"))
    }
}
