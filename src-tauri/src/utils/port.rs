use std::process::Command;

/// 查询占用指定端口的进程名（Windows 平台）。
///
/// 返回 `None` 表示查询失败或端口未被占用。实际进程查询（netstat/tasklist）
/// 通过 `spawn_blocking` 在阻塞线程池执行，避免卡住异步运行时（C3 响应性保护）。
pub async fn get_port_occupant(port: u16) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        tokio::task::spawn_blocking(move || query_port_occupant_windows(port))
            .await
            .ok()?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = port;
        None
    }
}

#[cfg(target_os = "windows")]
fn query_port_occupant_windows(port: u16) -> Option<String> {
    // 1. netstat -ano 查找占用端口的 PID
    // 输出格式: 协议  本地地址  外部地址  状态  PID
    let output = Command::new("netstat")
        .args(["-ano"])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    let pid: u32 = stdout
        .lines()
        .filter(|line| line.contains("LISTENING"))
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            // fields: [0]=proto [1]=local_addr [2]=foreign_addr [3]=state [4]=pid
            if fields.len() < 5 {
                return None;
            }
            let local_addr = fields[1];
            // local_addr 形如 "0.0.0.0:12345" 或 "[::]:12345"，取最后一个 ':' 之后的部分作为端口
            let addr_port = local_addr.rsplit(':').next()?;
            if addr_port.parse::<u16>().ok() == Some(port) {
                fields.last().and_then(|s| s.parse::<u32>().ok())
            } else {
                None
            }
        })
        .next()?;

    // 2. tasklist 获取进程名
    let output = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {}", pid), "/FO", "CSV", "/NH"])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let first_line = stdout.lines().next()?;
    // CSV 格式: "进程名","PID","会话名","会话#","内存使用"
    let process_name = first_line.split(',').next()?.trim_matches('"');
    if process_name.is_empty() {
        None
    } else {
        Some(process_name.to_string())
    }
}
