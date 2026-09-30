#!/usr/bin/env node
// 驱动 stdio 代理：确认客户端活着→(必要时启动)→截图 before→buy_item→截图 after
// 全部在一个进程内完成，避免跨 Bash 调用导致客户端被回收。
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = 'D:/data/Night Voyage';
const CACHE = 'D:/software_cache';

const proxy = spawn('node', ['scripts/nv_mcp_stdio_proxy.mjs'], {
  cwd: ROOT,
  stdio: ['pipe', 'pipe', 'inherit'],
});

let nextId = 1;
const pending = new Map();
let buffer = '';

function send(method, params) {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    proxy.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }) + '\n');
  });
}

proxy.stdout.setEncoding('utf8');
proxy.stdout.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function textOf(resp) {
  const c = resp?.result?.content;
  if (Array.isArray(c) && c[0]?.text) return c[0].text;
  return JSON.stringify(resp?.result || resp?.error || resp);
}

async function main() {
  await send('initialize', {});

  // 1) 确认客户端活着
  const db = await send('tools/call', { name: 'nv_db_info', arguments: {} });
  console.log('=== nv_db_info ===');
  console.log(textOf(db));

  // 2) 若未启动则启动（同一进程内，客户端 detached 会存活）
  if (db.result?.isError && /程序未启动/.test(textOf(db))) {
    const st = await send('tools/call', { name: 'nv_app_start', arguments: { instance: 'a' } });
    console.log('=== nv_app_start ===');
    console.log(textOf(st));
  }

  // 3) 截图 before
  const before = await send('tools/call', { name: 'nv_screenshot', arguments: { outputPath: path.join(CACHE, 'nv-before.png') } });
  console.log('=== nv_screenshot (before) ===');
  console.log(textOf(before));

  // 4) buy_item 会话 #34
  const buy = await send('tools/call', {
    name: 'nv_tool_call_execute',
    arguments: {
      sessionId: 34,
      toolName: 'buy_item',
      argumentsJson: JSON.stringify({ item_id: 'cyber_maint_kit', name: '义体维护套件', count: 2, unit_price: 30, unit_weight: 1 }),
    },
  });
  console.log('=== nv_tool_call_execute (buy_item #34) ===');
  console.log(textOf(buy));

  // 5) 截图 after
  const after = await send('tools/call', { name: 'nv_screenshot', arguments: { outputPath: path.join(CACHE, 'nv-after.png') } });
  console.log('=== nv_screenshot (after) ===');
  console.log(textOf(after));

  proxy.stdin.end();
}

// 整体安全超时：120s 无结果则强制退出
const failTimer = setTimeout(() => {
  console.error('[driver] 超时，强制退出');
  proxy.kill();
  process.exit(1);
}, 120_000);

main().then(() => {
  proxy.on('exit', () => { clearTimeout(failTimer); process.exit(0); });
  // 兜底：3s 后代理未退出也走人
  setTimeout(() => { clearTimeout(failTimer); process.exit(0); }, 3000);
}).catch((err) => {
  console.error('[driver] 异常:', err);
  clearTimeout(failTimer);
  process.exit(1);
});
