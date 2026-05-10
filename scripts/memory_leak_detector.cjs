const http = require("http");
const { execSync, spawn } = require("child_process");
const net = require("net");

const PROJECT_ROOT = "D:\\data\\Night Voyage";
const CACHE_DIR = `${PROJECT_ROOT}\\.cache`;
const CARGO_TARGET_DIR = `${PROJECT_ROOT}\\src-tauri\\target`;
const DEFAULT_PORT = 17530;
const CHAT_TEST_TIMEOUT = 120000;
const HEALTH_MAX_WAIT = 600000;

function httpGet(url, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function httpPost(url, body, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname, port: urlObj.port, path: urlObj.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout,
    };
    const req = http.request(options, (res) => {
      let responseData = "";
      res.on("data", (chunk) => (responseData += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(responseData)); } catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(data);
    req.end();
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function killAll() {
  try { execSync("C:\\Windows\\System32\\taskkill.exe /F /IM night-voyage.exe", { stdio: "ignore" }); } catch {}
  try {
    const output = execSync("C:\\Windows\\System32\\netstat.exe -ano -p tcp", { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
    const pids = new Set();
    for (const line of output.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5 && (parts[1].includes(":1420") || parts[1].includes(":17530"))) {
        const pid = parseInt(parts[parts.length - 1], 10);
        if (pid > 0) pids.add(pid);
      }
    }
    for (const pid of pids) {
      try { execSync(`C:\\Windows\\System32\\taskkill.exe /F /PID ${pid}`, { stdio: "ignore" }); } catch {}
    }
  } catch {}
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function pollHealth(port, maxWait, pollInterval) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const data = await httpGet(`http://127.0.0.1:${port}/health`, 5000);
      if (data.status === "ready") return data;
    } catch {}
    await sleep(pollInterval);
  }
  return null;
}

async function getHealthMemory(port) {
  try {
    const data = await httpGet(`http://127.0.0.1:${port}/health`, 5000);
    const mem = data.memory || {};
    return { workingSetBytes: mem.workingSetBytes || 0, peakWorkingSetBytes: mem.peakWorkingSetBytes || 0, uptimeMs: data.uptimeMs || 0 };
  } catch { return null; }
}

async function callChatTest(port, testMessage, providerId, timeout) {
  try {
    const body = { testMessage };
    if (providerId != null) body.providerId = providerId;
    return await httpPost(`http://127.0.0.1:${port}/backdoor/chat-test`, body, timeout);
  } catch (e) {
    console.log(`  Chat test error: ${e.message}`);
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  let port = DEFAULT_PORT;
  let chatRounds = 10;
  let idleSamples = 10;
  let idleInterval = 5;
  let memoryLimitMb = 2048;
  let testMessage = "ping";
  let providerId = null;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--port": port = parseInt(args[++i]); break;
      case "--chat-rounds": chatRounds = parseInt(args[++i]); break;
      case "--idle-samples": idleSamples = parseInt(args[++i]); break;
      case "--idle-interval": idleInterval = parseInt(args[++i]); break;
      case "--memory-limit-mb": memoryLimitMb = parseInt(args[++i]); break;
      case "--test-message": testMessage = args[++i]; break;
      case "--provider-id": providerId = parseInt(args[++i]); break;
    }
  }

  console.log("============================================================");
  console.log("  Night Voyage - Memory Leak Detector");
  console.log("============================================================");
  console.log(`  Chat rounds:     ${chatRounds}`);
  console.log(`  Idle samples:    ${idleSamples}`);
  console.log(`  Idle interval:   ${idleInterval}s`);
  console.log(`  Memory limit:    ${memoryLimitMb} MB`);
  console.log(`  Port:            ${port}`);
  console.log();

  killAll();
  await sleep(3000);

  const nodeBinDir = "C:\\Program Files\\nodejs";
  const rustupBinDir = "D:\\data\\Night Voyage\\.cache\\rustup\\toolchains\\stable-x86_64-pc-windows-msvc\\bin";
  const pathAddition = `${nodeBinDir};${rustupBinDir};${process.env.PATH || ""}`;

  const env = Object.assign({}, process.env, {
    ROOT: PROJECT_ROOT,
    CACHE_DIR,
    CARGO_TARGET_DIR,
    CARGO_HOME: `${CACHE_DIR}\\cargo`,
    RUSTUP_HOME: `${CACHE_DIR}\\rustup`,
    NIGHT_VOYAGE_DB_PATH: `${CACHE_DIR}\\night-voyage-dev.sqlite3`,
    NIGHT_VOYAGE_BACKDOOR_PORT: String(port),
    PATH: pathAddition,
  });

  console.log("[Phase 1] Starting tauri dev (includes Vite via beforeDevCommand)...");
  const tauriProc = spawn("npm", ["run", "tauri", "dev"], {
    cwd: PROJECT_ROOT,
    env,
    stdio: "ignore",
    shell: true,
    windowsHide: true,
  });

  console.log("[Phase 2] Waiting for backdoor health endpoint...");
  const health = await pollHealth(port, HEALTH_MAX_WAIT, 3000);
  if (!health) {
    console.log("  ERROR: Health probe timed out after 10 minutes");
    tauriProc.kill();
    killAll();
    return;
  }

  const startupMem = (health.memory || {}).workingSetBytes || 0;
  const startupPeakMem = (health.memory || {}).peakWorkingSetBytes || 0;
  const uptimeSec = Math.round((health.uptimeMs || 0) / 1000);
  console.log(`  Backdoor ready! Uptime: ${uptimeSec}s`);
  console.log(`  Startup memory: ${formatBytes(startupMem)} (peak: ${formatBytes(startupPeakMem)})`);
  console.log();

  // Phase 3: Idle memory baseline
  console.log(`[Phase 3] Collecting idle memory baseline (${idleSamples} samples, ${idleInterval}s interval)...`);
  const idleSamplesData = [];
  for (let i = 0; i < idleSamples; i++) {
    const mem = await getHealthMemory(port);
    if (mem) {
      idleSamplesData.push(mem.workingSetBytes);
      if (i === 0 || (i + 1) % 5 === 0) {
        console.log(`  Sample ${String(i + 1).padStart(3)}: ${formatBytes(mem.workingSetBytes)}  (uptime: ${Math.round(mem.uptimeMs / 1000)}s)`);
      }
      if (mem.workingSetBytes > memoryLimitMb * 1024 * 1024) {
        console.log(`  *** MEMORY LIMIT EXCEEDED during idle: ${formatBytes(mem.workingSetBytes)} > ${memoryLimitMb} MB ***`);
        break;
      }
    }
    await sleep(idleInterval * 1000);
  }

  if (idleSamplesData.length === 0) {
    console.log("  ERROR: Could not collect idle memory samples");
    tauriProc.kill();
    killAll();
    return;
  }

  const idleFirst = idleSamplesData[0];
  const idleLast = idleSamplesData[idleSamplesData.length - 1];
  const idleGrowth = idleLast - idleFirst;
  const idleGrowthPct = idleFirst > 0 ? (idleGrowth / idleFirst) * 100 : 0;
  console.log(`  Idle baseline: first=${formatBytes(idleFirst)} last=${formatBytes(idleLast)} growth=${formatBytes(idleGrowth)} (${idleGrowthPct >= 0 ? "+" : ""}${idleGrowthPct.toFixed(1)}%)`);
  console.log();

  // Phase 4: Chat stress test
  console.log(`[Phase 4] Running ${chatRounds} chat test rounds...`);
  const chatResults = [];
  const memAfterEachChat = [];

  for (let i = 0; i < chatRounds; i++) {
    const result = await callChatTest(port, testMessage, providerId, CHAT_TEST_TIMEOUT);
    const memAfter = await getHealthMemory(port);

    if (result === null) {
      console.log(`  Round ${String(i + 1).padStart(3)}: FAILED (no response)`);
      chatResults.push(null);
    } else {
      const ok = result.ok || false;
      const totalMs = result.totalMs || 0;
      const wsAfter = memAfter ? memAfter.workingSetBytes : 0;
      memAfterEachChat.push(wsAfter);
      chatResults.push(result);
      console.log(`  Round ${String(i + 1).padStart(3)}: ok=${String(ok).padEnd(5)} ${String(totalMs).padStart(6)}ms  mem=${formatBytes(wsAfter)}`);

      if (wsAfter > memoryLimitMb * 1024 * 1024) {
        console.log(`  *** MEMORY LIMIT EXCEEDED: ${formatBytes(wsAfter)} > ${memoryLimitMb} MB ***`);
        break;
      }
    }
    await sleep(2000);
  }

  // Phase 5: Post-chat idle memory
  console.log();
  console.log(`[Phase 5] Post-chat idle memory (${idleSamples} samples)...`);
  const postChatSamples = [];
  for (let i = 0; i < idleSamples; i++) {
    const mem = await getHealthMemory(port);
    if (mem) {
      postChatSamples.push(mem.workingSetBytes);
      if (i === 0 || (i + 1) % 5 === 0) {
        console.log(`  Sample ${String(i + 1).padStart(3)}: ${formatBytes(mem.workingSetBytes)}  (uptime: ${Math.round(mem.uptimeMs / 1000)}s)`);
      }
    }
    await sleep(idleInterval * 1000);
  }

  // Cleanup
  console.log();
  console.log("[Cleanup] Stopping processes...");
  tauriProc.kill();
  killAll();

  // Analysis
  console.log();
  console.log("============================================================");
  console.log("  MEMORY LEAK ANALYSIS");
  console.log("============================================================");

  console.log();
  console.log("  1. Startup memory:");
  console.log(`     Working set: ${formatBytes(startupMem)}`);
  console.log(`     Peak:        ${formatBytes(startupPeakMem)}`);

  console.log();
  console.log("  2. Idle memory drift (no activity):");
  console.log(`     First sample: ${formatBytes(idleFirst)}`);
  console.log(`     Last sample:  ${formatBytes(idleLast)}`);
  console.log(`     Growth:       ${formatBytes(idleGrowth)} (${idleGrowthPct >= 0 ? "+" : ""}${idleGrowthPct.toFixed(1)}%)`);
  if (idleGrowthPct > 10) console.log(`     *** WARNING: Idle memory grew ${idleGrowthPct.toFixed(1)}% - possible leak ***`);
  else if (idleGrowthPct > 5) console.log(`     *** CAUTION: Idle memory grew ${idleGrowthPct.toFixed(1)}% - monitor ***`);
  else console.log(`     OK: Idle memory stable`);

  console.log();
  console.log("  3. Chat stress test memory:");
  if (memAfterEachChat.length > 0) {
    const chatFirst = memAfterEachChat[0];
    const chatLast = memAfterEachChat[memAfterEachChat.length - 1];
    const chatGrowth = chatLast - chatFirst;
    const chatGrowthPerRound = chatGrowth / memAfterEachChat.length;
    const chatGrowthPct = chatFirst > 0 ? (chatGrowth / chatFirst) * 100 : 0;

    console.log(`     After round 1:  ${formatBytes(chatFirst)}`);
    console.log(`     After round ${memAfterEachChat.length}:  ${formatBytes(chatLast)}`);
    console.log(`     Total growth:   ${formatBytes(chatGrowth)} (${chatGrowthPct >= 0 ? "+" : ""}${chatGrowthPct.toFixed(1)}%)`);
    console.log(`     Per-round avg:  ${formatBytes(chatGrowthPerRound)}`);

    if (chatGrowthPct > 20) console.log(`     *** CRITICAL: Chat memory grew ${chatGrowthPct.toFixed(1)}% - likely leak ***`);
    else if (chatGrowthPct > 10) console.log(`     *** WARNING: Chat memory grew ${chatGrowthPct.toFixed(1)}% - possible leak ***`);
    else if (chatGrowthPct > 5) console.log(`     *** CAUTION: Chat memory grew ${chatGrowthPct.toFixed(1)}% - monitor ***`);
    else console.log(`     OK: Chat memory stable`);

    if (memAfterEachChat.length >= 5) {
      const half = Math.floor(memAfterEachChat.length / 2);
      const firstHalf = memAfterEachChat.slice(0, half);
      const secondHalf = memAfterEachChat.slice(half);
      const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      const halfGrowth = avgSecond - avgFirst;
      const halfGrowthPct = avgFirst > 0 ? (halfGrowth / avgFirst) * 100 : 0;
      console.log(`     First half avg:  ${formatBytes(avgFirst)}`);
      console.log(`     Second half avg: ${formatBytes(avgSecond)}`);
      console.log(`     Half-over-half:  ${formatBytes(halfGrowth)} (${halfGrowthPct >= 0 ? "+" : ""}${halfGrowthPct.toFixed(1)}%)`);
    }
  }

  console.log();
  console.log("  4. Post-chat memory recovery:");
  if (postChatSamples.length > 0 && idleSamplesData.length > 0) {
    const idleAvg = idleSamplesData.reduce((a, b) => a + b, 0) / idleSamplesData.length;
    const postAvg = postChatSamples.reduce((a, b) => a + b, 0) / postChatSamples.length;
    const retained = postAvg - idleAvg;
    const retainedPct = idleAvg > 0 ? (retained / idleAvg) * 100 : 0;

    console.log(`     Idle avg:        ${formatBytes(idleAvg)}`);
    console.log(`     Post-chat avg:   ${formatBytes(postAvg)}`);
    console.log(`     Retained growth: ${formatBytes(retained)} (${retainedPct >= 0 ? "+" : ""}${retainedPct.toFixed(1)}%)`);

    if (retainedPct > 15) console.log(`     *** CRITICAL: ${retainedPct.toFixed(1)}% memory not released after chat - likely leak ***`);
    else if (retainedPct > 5) console.log(`     *** WARNING: ${retainedPct.toFixed(1)}% memory not released after chat ***`);
    else console.log(`     OK: Memory returned to baseline`);
  }

  console.log();
  console.log("  5. Chat success rate:");
  const successful = chatResults.filter((r) => r !== null && r.ok).length;
  const failed = chatResults.filter((r) => r !== null && !r.ok).length;
  const errors = chatResults.filter((r) => r === null).length;
  console.log(`     Success: ${successful}/${chatResults.length}  Failed: ${failed}  Errors: ${errors}`);

  console.log();
  console.log("============================================================");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
