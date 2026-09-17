const path = require('node:path');
const os = require('node:os');

function resolveConfig() {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const appStorageDir = path.join(appData, 'com.nightvoyage.app');
  const sqliteDbPath = path.join(appStorageDir, 'night-voyage.sqlite3');
  const llmLogsDir = path.join(appStorageDir, 'llm_debug_logs');
  const chatLogsDir = path.join(appStorageDir, 'chat_debug_logs');
  const agentLogsDir = path.join(appStorageDir, 'agent_debug_logs');

  const projectRoot = path.resolve(__dirname, '..');
  const testPresetPath = path.join(
    projectRoot,
    '测试预设',
    'Night Voyage 全能进阶核心预设 V2.2.nvpreset.json'
  );
  const specPlanPath = path.join(
    projectRoot,
    'plans',
    'agent-system-architecture-plan.md'
  );

  return {
    appStorageDir,
    sqliteDbPath,
    llmLogsDir,
    chatLogsDir,
    agentLogsDir,
    projectRoot,
    testPresetPath,
    specPlanPath,
  };
}

module.exports = { resolveConfig };
