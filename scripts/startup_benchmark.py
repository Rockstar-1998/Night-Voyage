import argparse
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
HEALTH_POLL_INTERVAL = 1
CHAT_TEST_TIMEOUT = 120
PROCESS_KILL_WAIT = 2
VITE_PORT = 1420
VITE_MAX_WAIT = 180
VITE_POLL_INTERVAL = 3
MEMORY_CHECK_INTERVAL = 5
DEFAULT_MEMORY_LIMIT_MB = 2048


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


def get_release_env(port):
    env = os.environ.copy()
    env["NIGHT_VOYAGE_BACKDOOR_PORT"] = str(port)
    env["NIGHT_VOYAGE_DB_PATH"] = os.path.join(CACHE_DIR, "night-voyage-release.sqlite3")
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
        print(f"  Chat test failed: {e}", flush=True)
        return None


def get_process_memory_mb(pid):
    try:
        output = subprocess.check_output(
            ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
        if not output.strip():
            return None
        parts = output.strip().split(",")
        if len(parts) >= 5:
            mem_str = parts[4].strip().strip('"').replace(" ", "").replace(",", "")
            mem_kb = int(mem_str)
            return mem_kb / 1024
    except (subprocess.CalledProcessError, ValueError, IndexError):
        pass
    return None


def check_memory_and_kill(proc, memory_limit_mb):
    try:
        pid = proc.pid
        mem_mb = get_process_memory_mb(pid)
        if mem_mb is not None and mem_mb > memory_limit_mb:
            print(f"  MEMORY LIMIT EXCEEDED: {mem_mb:.0f} MB > {memory_limit_mb} MB - killing process", flush=True)
            proc.kill()
            proc.wait()
            kill_night_voyage()
            return True, mem_mb
    except Exception:
        pass
    return False, None


def run_release_benchmark(port, test_message, memory_limit_mb):
    kill_night_voyage()
    time.sleep(PROCESS_KILL_WAIT)

    if not os.path.isfile(RELEASE_EXE):
        print(f"  ERROR: Release exe not found at {RELEASE_EXE}", flush=True)
        return None

    env = get_release_env(port)
    t0 = time.monotonic()

    proc = subprocess.Popen(
        [RELEASE_EXE],
        env=env,
        cwd=PROJECT_ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    health = None
    health_elapsed = 0
    while health_elapsed < HEALTH_MAX_WAIT:
        health = poll_health(port, 1, 0.1)
        if health is not None:
            break
        health_elapsed += 1

        killed, mem_mb = check_memory_and_kill(proc, memory_limit_mb)
        if killed:
            return {
                "cold_start_ms": None,
                "chat_available_ms": None,
                "llm_response_ms": None,
                "chat_result": None,
                "memory_exceeded": True,
                "peak_memory_mb": mem_mb,
                "failure_reason": f"memory_exceeded_{mem_mb:.0f}mb",
            }

        if proc.poll() is not None:
            print(f"  ERROR: Process exited prematurely with code {proc.returncode}", flush=True)
            kill_night_voyage()
            return None

    t1 = time.monotonic()

    if health is None:
        print("  ERROR: Health probe timed out", flush=True)
        proc.kill()
        proc.wait()
        kill_night_voyage()
        return None

    peak_memory_mb = 0.0
    mem_info = health.get("memory", {})
    if mem_info.get("workingSetBytes"):
        peak_memory_mb = max(peak_memory_mb, mem_info["workingSetBytes"] / (1024 * 1024))

    chat_result = call_chat_test(port, test_message, CHAT_TEST_TIMEOUT)
    t2 = time.monotonic()

    if chat_result is None:
        print("  ERROR: Chat test returned no result - startup NOT confirmed", flush=True)
        proc.kill()
        proc.wait()
        kill_night_voyage()
        return {
            "cold_start_ms": int((t1 - t0) * 1000),
            "chat_available_ms": None,
            "llm_response_ms": None,
            "chat_result": None,
            "memory_exceeded": False,
            "peak_memory_mb": peak_memory_mb,
            "failure_reason": "chat_test_no_response",
        }

    if not chat_result.get("ok"):
        print(f"  ERROR: Chat test ok=false, roundStatus={chat_result.get('roundStatus')} - startup NOT confirmed", flush=True)
        proc.kill()
        proc.wait()
        kill_night_voyage()
        return {
            "cold_start_ms": int((t1 - t0) * 1000),
            "chat_available_ms": None,
            "llm_response_ms": None,
            "chat_result": chat_result,
            "memory_exceeded": False,
            "peak_memory_mb": peak_memory_mb,
            "failure_reason": f"chat_test_failed_{chat_result.get('roundStatus', 'unknown')}",
        }

    proc.kill()
    proc.wait()
    kill_night_voyage()
    time.sleep(PROCESS_KILL_WAIT)

    cold_start_ms = int((t1 - t0) * 1000)
    chat_available_ms = int((t2 - t0) * 1000)
    llm_response_ms = int((t2 - t1) * 1000)

    return {
        "cold_start_ms": cold_start_ms,
        "chat_available_ms": chat_available_ms,
        "llm_response_ms": llm_response_ms,
        "chat_result": chat_result,
        "memory_exceeded": False,
        "peak_memory_mb": peak_memory_mb,
        "failure_reason": None,
    }


def run_debug_benchmark(port, test_message, memory_limit_mb):
    kill_night_voyage()
    kill_vite_on_port()
    time.sleep(PROCESS_KILL_WAIT)

    env = get_dev_env()
    env["NIGHT_VOYAGE_BACKDOOR_PORT"] = str(port)

    t0 = time.monotonic()

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
        kill_vite_on_port()
        kill_night_voyage()
        return None

    tauri_proc = subprocess.Popen(
        ["npm", "run", "tauri", "dev"],
        env=env,
        cwd=PROJECT_ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
    )

    health = None
    health_elapsed = 0
    while health_elapsed < HEALTH_MAX_WAIT:
        health = poll_health(port, 1, 0.1)
        if health is not None:
            break
        health_elapsed += 1

        killed, mem_mb = check_memory_and_kill(tauri_proc, memory_limit_mb)
        if killed:
            vite_proc.kill()
            vite_proc.wait()
            kill_vite_on_port()
            kill_night_voyage()
            return {
                "cold_start_ms": None,
                "chat_available_ms": None,
                "llm_response_ms": None,
                "chat_result": None,
                "memory_exceeded": True,
                "peak_memory_mb": mem_mb,
                "failure_reason": f"memory_exceeded_{mem_mb:.0f}mb",
            }

        if tauri_proc.poll() is not None:
            print(f"  ERROR: Tauri process exited prematurely with code {tauri_proc.returncode}", flush=True)
            vite_proc.kill()
            vite_proc.wait()
            kill_vite_on_port()
            kill_night_voyage()
            return None

    t1 = time.monotonic()

    if health is None:
        print("  ERROR: Health probe timed out", flush=True)
        tauri_proc.kill()
        tauri_proc.wait()
        vite_proc.kill()
        vite_proc.wait()
        kill_night_voyage()
        kill_vite_on_port()
        return None

    peak_memory_mb = 0.0
    mem_info = health.get("memory", {})
    if mem_info.get("workingSetBytes"):
        peak_memory_mb = max(peak_memory_mb, mem_info["workingSetBytes"] / (1024 * 1024))

    chat_result = call_chat_test(port, test_message, CHAT_TEST_TIMEOUT)
    t2 = time.monotonic()

    if chat_result is None:
        print("  ERROR: Chat test returned no result - startup NOT confirmed", flush=True)
        tauri_proc.kill()
        tauri_proc.wait()
        vite_proc.kill()
        vite_proc.wait()
        kill_night_voyage()
        kill_vite_on_port()
        return {
            "cold_start_ms": int((t1 - t0) * 1000),
            "chat_available_ms": None,
            "llm_response_ms": None,
            "chat_result": None,
            "memory_exceeded": False,
            "peak_memory_mb": peak_memory_mb,
            "failure_reason": "chat_test_no_response",
        }

    if not chat_result.get("ok"):
        print(f"  ERROR: Chat test ok=false, roundStatus={chat_result.get('roundStatus')} - startup NOT confirmed", flush=True)
        tauri_proc.kill()
        tauri_proc.wait()
        vite_proc.kill()
        vite_proc.wait()
        kill_night_voyage()
        kill_vite_on_port()
        return {
            "cold_start_ms": int((t1 - t0) * 1000),
            "chat_available_ms": None,
            "llm_response_ms": None,
            "chat_result": chat_result,
            "memory_exceeded": False,
            "peak_memory_mb": peak_memory_mb,
            "failure_reason": f"chat_test_failed_{chat_result.get('roundStatus', 'unknown')}",
        }

    tauri_proc.kill()
    tauri_proc.wait()
    vite_proc.kill()
    vite_proc.wait()
    kill_night_voyage()
    kill_vite_on_port()
    time.sleep(PROCESS_KILL_WAIT)

    cold_start_ms = int((t1 - t0) * 1000)
    chat_available_ms = int((t2 - t0) * 1000)
    llm_response_ms = int((t2 - t1) * 1000)

    return {
        "cold_start_ms": cold_start_ms,
        "chat_available_ms": chat_available_ms,
        "llm_response_ms": llm_response_ms,
        "chat_result": chat_result,
        "memory_exceeded": False,
        "peak_memory_mb": peak_memory_mb,
        "failure_reason": None,
    }


def format_chat_result(chat_result):
    if chat_result is None:
        return "ok=false, roundStatus=error"
    ok = chat_result.get("ok", False)
    round_status = chat_result.get("roundStatus", "unknown")
    return f"ok={str(ok).lower()}, roundStatus={round_status}"


def print_run_result(run_index, total_runs, result):
    print(f"Run {run_index}/{total_runs}:", flush=True)
    if result is None:
        print("  FAILED (process error)", flush=True)
        return
    if result.get("memory_exceeded"):
        print(f"  FAILED: Memory exceeded {result['peak_memory_mb']:.0f} MB", flush=True)
        return
    if result.get("failure_reason"):
        print(f"  FAILED: {result['failure_reason']}", flush=True)
        if result.get("cold_start_ms") is not None:
            print(f"  Cold start (health only): {result['cold_start_ms']} ms", flush=True)
        return
    print(f"  Cold start:    {result['cold_start_ms']} ms", flush=True)
    print(f"  Chat available: {result['chat_available_ms']} ms  <-- TRUE startup time", flush=True)
    print(f"  LLM response:  {result['llm_response_ms']} ms", flush=True)
    print(f"  Peak memory:   {result['peak_memory_mb']:.1f} MB", flush=True)
    print(f"  Chat test result: {format_chat_result(result['chat_result'])}", flush=True)


def print_summary(results, total_runs):
    valid = [r for r in results if r is not None and r.get("failure_reason") is None]
    n = len(valid)
    mem_exceeded = sum(1 for r in results if r is not None and r.get("memory_exceeded"))
    chat_failed = sum(1 for r in results if r is not None and r.get("failure_reason") and not r.get("memory_exceeded"))
    process_errors = sum(1 for r in results if r is None)

    print(f"\nSummary ({n}/{total_runs} successful runs):", flush=True)
    if mem_exceeded:
        print(f"  {mem_exceeded} run(s) killed for memory limit", flush=True)
    if chat_failed:
        print(f"  {chat_failed} run(s) failed chat test (startup NOT confirmed)", flush=True)
    if process_errors:
        print(f"  {process_errors} run(s) had process errors", flush=True)
    if n == 0:
        print("  No successful runs to summarize.", flush=True)
        return
    for key, label in [
        ("cold_start_ms", "Cold start"),
        ("chat_available_ms", "Chat available"),
        ("llm_response_ms", "LLM response"),
    ]:
        values = [r[key] for r in valid if r.get(key) is not None]
        if not values:
            continue
        avg = sum(values) // len(values)
        mn = min(values)
        mx = max(values)
        print(f"  {label:15s} avg={avg} ms  min={mn} ms  max={mx} ms", flush=True)
    mem_values = [r["peak_memory_mb"] for r in valid]
    if mem_values:
        print(f"  {'Peak memory':15s} avg={sum(mem_values)/len(mem_values):.1f} MB  min={min(mem_values):.1f} MB  max={max(mem_values):.1f} MB", flush=True)


def main():
    parser = argparse.ArgumentParser(description="Night Voyage startup benchmark")
    parser.add_argument("--mode", required=True, choices=["debug", "release"], help="Which build to test")
    parser.add_argument("--runs", type=int, default=1, help="Number of cold-start test runs")
    parser.add_argument("--port", type=int, default=17530, help="Backdoor API port")
    parser.add_argument("--test-message", default="ping", help="Test message to send")
    parser.add_argument("--memory-limit", type=int, default=DEFAULT_MEMORY_LIMIT_MB, help="Memory limit in MB (kill if exceeded)")
    args = parser.parse_args()

    print(f"Night Voyage Startup Benchmark", flush=True)
    print(f"  Mode:          {args.mode}", flush=True)
    print(f"  Runs:          {args.runs}", flush=True)
    print(f"  Port:          {args.port}", flush=True)
    print(f"  Test message:  {args.test_message}", flush=True)
    print(f"  Memory limit:  {args.memory_limit} MB", flush=True)
    print(f"  Success criteria: API must respond to chat test (window appearance does NOT count)", flush=True)
    print(flush=True)

    results = []
    for i in range(1, args.runs + 1):
        if args.mode == "release":
            result = run_release_benchmark(args.port, args.test_message, args.memory_limit)
        else:
            result = run_debug_benchmark(args.port, args.test_message, args.memory_limit)
        print_run_result(i, args.runs, result)
        results.append(result)
        if i < args.runs:
            print(flush=True)

    print_summary(results, args.runs)


if __name__ == "__main__":
    main()
