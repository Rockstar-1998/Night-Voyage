import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
import urllib.error

PROJECT_ROOT = r"D:\data\Night Voyage"
CACHE_DIR = os.path.join(PROJECT_ROOT, ".cache")
CARGO_TARGET_DIR = os.path.join(PROJECT_ROOT, "src-tauri", "target")
RELEASE_EXE = os.path.join(CARGO_TARGET_DIR, "release", "night-voyage.exe")
HEALTH_MAX_WAIT = 600
HEALTH_POLL_INTERVAL = 2
CHAT_TEST_TIMEOUT = 120
PROCESS_KILL_WAIT = 2
VITE_PORT = 1420
VITE_MAX_WAIT = 180
VITE_POLL_INTERVAL = 3


def get_dev_env():
    env = os.environ.copy()
    env["ROOT"] = PROJECT_ROOT
    env["CACHE_DIR"] = CACHE_DIR
    env["CARGO_TARGET_DIR"] = CARGO_TARGET_DIR
    cargo_home = os.path.join(CACHE_DIR, ".cargo")
    env["CARGO_HOME"] = cargo_home
    npm_cache = os.path.join(CACHE_DIR, "npm-cache")
    npm_logs = os.path.join(npm_cache, "_logs")
    env["NPM_CACHE_DIR"] = npm_cache
    env["NPM_LOGS_DIR"] = npm_logs
    env["NPM_CONFIG_CACHE"] = npm_cache
    env["npm_config_cache"] = npm_cache
    env["NPM_CONFIG_LOGS_DIR"] = npm_logs
    env["npm_config_logs_dir"] = npm_logs
    tmp_dir = os.path.join(CACHE_DIR, "tmp")
    env["TMP"] = tmp_dir
    env["TEMP"] = tmp_dir
    env["TMPDIR"] = tmp_dir
    env["RUSTC_TMPDIR"] = tmp_dir
    env["CARGO_TARGET_TMPDIR"] = tmp_dir
    env["XDG_CACHE_HOME"] = CACHE_DIR
    env["NIGHT_VOYAGE_DB_PATH"] = os.path.join(CACHE_DIR, "night-voyage-dev.sqlite3")
    return env


def kill_night_voyage():
    subprocess.run(
        ["taskkill", "/F", "/IM", "night-voyage.exe"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def kill_vite_on_port():
    try:
        output = subprocess.check_output(
            ["netstat", "-ano", "-p", "tcp"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
        pids = set()
        for line in output.splitlines():
            parts = line.split()
            if len(parts) >= 5 and f":{VITE_PORT}" in parts[1]:
                pid_str = parts[-1]
                if pid_str.isdigit():
                    pids.add(int(pid_str))
        for pid in pids:
            if pid > 0:
                try:
                    result = subprocess.check_output(
                        ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                        text=True,
                        stderr=subprocess.DEVNULL,
                    )
                    if "node.exe" in result.lower():
                        subprocess.run(
                            ["taskkill", "/F", "/PID", str(pid)],
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                        )
                except subprocess.CalledProcessError:
                    pass
    except subprocess.CalledProcessError:
        pass


def probe_tcp_port(host, port, timeout=3):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(timeout)
        s.connect((host, port))
        s.close()
        return True
    except (socket.error, OSError):
        return False


def poll_health(port, max_wait, poll_interval):
    url = f"http://127.0.0.1:{port}/health"
    elapsed = 0
    while elapsed < max_wait:
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if data.get("status") == "ready":
                    return data
        except (urllib.error.URLError, urllib.error.HTTPError, OSError, json.JSONDecodeError):
            pass
        time.sleep(poll_interval)
        elapsed += poll_interval
    return None


def call_chat_test(port, test_message, timeout):
    url = f"http://127.0.0.1:{port}/backdoor/chat-test"
    body = json.dumps({"testMessage": test_message}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, json.JSONDecodeError) as e:
        print(f"  Chat test HTTP error: {e}", flush=True)
        return None


def get_health_memory(port):
    try:
        url = f"http://127.0.0.1:{port}/health"
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            mem = data.get("memory", {})
            return {
                "workingSetBytes": mem.get("workingSetBytes", 0),
                "peakWorkingSetBytes": mem.get("peakWorkingSetBytes", 0),
                "uptimeMs": data.get("uptimeMs", 0),
            }
    except Exception:
        return None


def format_bytes(bytes_val):
    if bytes_val < 1024:
        return f"{bytes_val} B"
    if bytes_val < 1024 * 1024:
        return f"{bytes_val / 1024:.1f} KB"
    return f"{bytes_val / (1024 * 1024):.1f} MB"


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Night Voyage Memory Leak Detector")
    parser.add_argument("--port", type=int, default=17530, help="Backdoor API port")
    parser.add_argument("--chat-rounds", type=int, default=10, help="Number of chat test rounds")
    parser.add_argument("--idle-samples", type=int, default=20, help="Number of idle memory samples")
    parser.add_argument("--idle-interval", type=int, default=5, help="Seconds between idle samples")
    parser.add_argument("--memory-limit-mb", type=int, default=2048, help="Kill if memory exceeds this")
    parser.add_argument("--test-message", default="ping", help="Test message for chat")
    args = parser.parse_args()

    print("=" * 60, flush=True)
    print("  Night Voyage - Memory Leak Detector", flush=True)
    print("=" * 60, flush=True)
    print(f"  Chat rounds:     {args.chat_rounds}", flush=True)
    print(f"  Idle samples:    {args.idle_samples}", flush=True)
    print(f"  Idle interval:   {args.idle_interval}s", flush=True)
    print(f"  Memory limit:    {args.memory_limit_mb} MB", flush=True)
    print(f"  Port:            {args.port}", flush=True)
    print(flush=True)

    kill_night_voyage()
    kill_vite_on_port()
    time.sleep(PROCESS_KILL_WAIT)

    env = get_dev_env()
    env["NIGHT_VOYAGE_BACKDOOR_PORT"] = str(args.port)

    print("[Phase 1] Starting Vite dev server...", flush=True)
    vite_proc = subprocess.Popen(
        ["npm", "run", "dev:frontend"],
        env=env,
        cwd=PROJECT_ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
    )

    vite_ready = False
    vite_elapsed = 0
    while vite_elapsed < VITE_MAX_WAIT:
        if probe_tcp_port("127.0.0.1", VITE_PORT, timeout=3):
            vite_ready = True
            break
        time.sleep(VITE_POLL_INTERVAL)
        vite_elapsed += VITE_POLL_INTERVAL

    if not vite_ready:
        print("  ERROR: Vite dev server did not start", flush=True)
        vite_proc.kill()
        vite_proc.wait()
        return
    print(f"  Vite ready after {vite_elapsed}s", flush=True)

    print("[Phase 2] Starting Tauri dev...", flush=True)
    tauri_proc = subprocess.Popen(
        ["npm", "run", "tauri", "dev"],
        env=env,
        cwd=PROJECT_ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
    )

    print("[Phase 3] Waiting for backdoor health endpoint...", flush=True)
    health = poll_health(args.port, HEALTH_MAX_WAIT, HEALTH_POLL_INTERVAL)
    if health is None:
        print("  ERROR: Health probe timed out", flush=True)
        tauri_proc.kill()
        tauri_proc.wait()
        vite_proc.kill()
        vite_proc.wait()
        kill_night_voyage()
        kill_vite_on_port()
        return

    startup_mem = health.get("memory", {}).get("workingSetBytes", 0)
    print(f"  Backdoor ready! Startup memory: {format_bytes(startup_mem)}", flush=True)
    print(flush=True)

    # Phase 4: Idle memory baseline
    print(f"[Phase 4] Collecting idle memory baseline ({args.idle_samples} samples, {args.idle_interval}s interval)...", flush=True)
    idle_samples = []
    for i in range(args.idle_samples):
        mem = get_health_memory(args.port)
        if mem:
            ws = mem["workingSetBytes"]
            idle_samples.append(ws)
            if (i + 1) % 5 == 0 or i == 0:
                print(f"  Sample {i+1:3d}: {format_bytes(ws)}  (uptime: {mem['uptimeMs']/1000:.0f}s)", flush=True)
            if ws > args.memory_limit_mb * 1024 * 1024:
                print(f"  MEMORY LIMIT EXCEEDED during idle: {format_bytes(ws)} > {args.memory_limit_mb} MB", flush=True)
                break
        time.sleep(args.idle_interval)

    if not idle_samples:
        print("  ERROR: Could not collect idle memory samples", flush=True)
        tauri_proc.kill()
        tauri_proc.wait()
        vite_proc.kill()
        vite_proc.wait()
        kill_night_voyage()
        kill_vite_on_port()
        return

    idle_first = idle_samples[0]
    idle_last = idle_samples[-1]
    idle_growth = idle_last - idle_first
    idle_growth_pct = (idle_growth / idle_first * 100) if idle_first > 0 else 0
    print(f"  Idle baseline: first={format_bytes(idle_first)} last={format_bytes(idle_last)} growth={format_bytes(idle_growth)} ({idle_growth_pct:+.1f}%)", flush=True)
    print(flush=True)

    # Phase 5: Chat stress test
    print(f"[Phase 5] Running {args.chat_rounds} chat test rounds...", flush=True)
    chat_mem_before = get_health_memory(args.port)
    chat_results = []
    mem_after_each_chat = []

    for i in range(args.chat_rounds):
        mem_before = get_health_memory(args.port)
        result = call_chat_test(args.port, args.test_message, CHAT_TEST_TIMEOUT)
        mem_after = get_health_memory(args.port)

        if result is None:
            print(f"  Round {i+1:3d}: FAILED (no response)", flush=True)
            chat_results.append(None)
        else:
            ok = result.get("ok", False)
            total_ms = result.get("totalMs", 0)
            status = result.get("roundStatus", "unknown")
            ws_after = mem_after["workingSetBytes"] if mem_after else 0
            mem_after_each_chat.append(ws_after)
            chat_results.append(result)
            print(f"  Round {i+1:3d}: ok={str(ok).lower():5s} {total_ms:6d}ms  mem={format_bytes(ws_after)}", flush=True)

            if ws_after > args.memory_limit_mb * 1024 * 1024:
                print(f"  MEMORY LIMIT EXCEEDED: {format_bytes(ws_after)} > {args.memory_limit_mb} MB", flush=True)
                break

        time.sleep(2)

    # Phase 6: Post-chat idle memory
    print(flush=True)
    print(f"[Phase 6] Post-chat idle memory ({args.idle_samples} samples)...", flush=True)
    post_chat_samples = []
    for i in range(args.idle_samples):
        mem = get_health_memory(args.port)
        if mem:
            ws = mem["workingSetBytes"]
            post_chat_samples.append(ws)
            if (i + 1) % 5 == 0 or i == 0:
                print(f"  Sample {i+1:3d}: {format_bytes(ws)}  (uptime: {mem['uptimeMs']/1000:.0f}s)", flush=True)
        time.sleep(args.idle_interval)

    # Cleanup
    print(flush=True)
    print("[Cleanup] Stopping processes...", flush=True)
    tauri_proc.kill()
    tauri_proc.wait()
    vite_proc.kill()
    vite_proc.wait()
    kill_night_voyage()
    kill_vite_on_port()

    # Analysis
    print(flush=True)
    print("=" * 60, flush=True)
    print("  MEMORY LEAK ANALYSIS", flush=True)
    print("=" * 60, flush=True)

    print(flush=True)
    print("  1. Startup memory:", flush=True)
    print(f"     {format_bytes(startup_mem)}", flush=True)

    print(flush=True)
    print("  2. Idle memory drift (no activity):", flush=True)
    print(f"     First sample: {format_bytes(idle_first)}", flush=True)
    print(f"     Last sample:  {format_bytes(idle_last)}", flush=True)
    print(f"     Growth:       {format_bytes(idle_growth)} ({idle_growth_pct:+.1f}%)", flush=True)
    if idle_growth_pct > 10:
        print(f"     *** WARNING: Idle memory grew {idle_growth_pct:.1f}% - possible leak ***", flush=True)
    elif idle_growth_pct > 5:
        print(f"     *** CAUTION: Idle memory grew {idle_growth_pct:.1f}% - monitor ***", flush=True)
    else:
        print(f"     OK: Idle memory stable", flush=True)

    print(flush=True)
    print("  3. Chat stress test memory:", flush=True)
    if mem_after_each_chat:
        chat_first = mem_after_each_chat[0]
        chat_last = mem_after_each_chat[-1]
        chat_growth = chat_last - chat_first
        chat_growth_per_round = chat_growth / len(mem_after_each_chat) if mem_after_each_chat else 0
        chat_growth_pct = (chat_growth / chat_first * 100) if chat_first > 0 else 0

        print(f"     After round 1:  {format_bytes(chat_first)}", flush=True)
        print(f"     After round {len(mem_after_each_chat)}:  {format_bytes(chat_last)}", flush=True)
        print(f"     Total growth:   {format_bytes(chat_growth)} ({chat_growth_pct:+.1f}%)", flush=True)
        print(f"     Per-round avg:  {format_bytes(chat_growth_per_round)}", flush=True)

        if chat_growth_pct > 20:
            print(f"     *** CRITICAL: Chat memory grew {chat_growth_pct:.1f}% - likely leak ***", flush=True)
        elif chat_growth_pct > 10:
            print(f"     *** WARNING: Chat memory grew {chat_growth_pct:.1f}% - possible leak ***", flush=True)
        elif chat_growth_pct > 5:
            print(f"     *** CAUTION: Chat memory grew {chat_growth_pct:.1f}% - monitor ***", flush=True)
        else:
            print(f"     OK: Chat memory stable", flush=True)

        if len(mem_after_each_chat) >= 5:
            first_half = mem_after_each_chat[:len(mem_after_each_chat)//2]
            second_half = mem_after_each_chat[len(mem_after_each_chat)//2:]
            avg_first = sum(first_half) / len(first_half)
            avg_second = sum(second_half) / len(second_half)
            half_growth = avg_second - avg_first
            half_growth_pct = (half_growth / avg_first * 100) if avg_first > 0 else 0
            print(f"     First half avg:  {format_bytes(avg_first)}", flush=True)
            print(f"     Second half avg: {format_bytes(avg_second)}", flush=True)
            print(f"     Half-over-half:  {format_bytes(half_growth)} ({half_growth_pct:+.1f}%)", flush=True)

    print(flush=True)
    print("  4. Post-chat memory recovery:", flush=True)
    if post_chat_samples and idle_samples:
        post_first = post_chat_samples[0]
        post_last = post_chat_samples[-1]
        post_growth = post_last - post_first
        post_growth_pct = (post_growth / post_first * 100) if post_first > 0 else 0
        idle_avg = sum(idle_samples) / len(idle_samples)
        post_avg = sum(post_chat_samples) / len(post_chat_samples)
        retained = post_avg - idle_avg
        retained_pct = (retained / idle_avg * 100) if idle_avg > 0 else 0

        print(f"     Idle avg:        {format_bytes(idle_avg)}", flush=True)
        print(f"     Post-chat avg:   {format_bytes(post_avg)}", flush=True)
        print(f"     Retained growth: {format_bytes(retained)} ({retained_pct:+.1f}%)", flush=True)

        if retained_pct > 15:
            print(f"     *** CRITICAL: {retained_pct:.1f}% memory not released after chat - likely leak ***", flush=True)
        elif retained_pct > 5:
            print(f"     *** WARNING: {retained_pct:.1f}% memory not released after chat ***", flush=True)
        else:
            print(f"     OK: Memory returned to baseline", flush=True)

    print(flush=True)
    print("  5. Chat success rate:", flush=True)
    successful = sum(1 for r in chat_results if r is not None and r.get("ok"))
    total = len(chat_results)
    failed = sum(1 for r in chat_results if r is not None and not r.get("ok"))
    errors = sum(1 for r in chat_results if r is None)
    print(f"     Success: {successful}/{total}  Failed: {failed}  Errors: {errors}", flush=True)

    print(flush=True)
    print("=" * 60, flush=True)


if __name__ == "__main__":
    main()
