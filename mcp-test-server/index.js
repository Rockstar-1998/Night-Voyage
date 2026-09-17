/**
 * Night Voyage MCP Test Server Entrypoint
 *
 * Implements:
 * 1. Model Context Protocol (MCP) JSON-RPC 2.0 over standard I/O (stdio).
 * 2. Standalone CLI test mode (--test or --run-all) for instant verification.
 * 3. Functional composition over inheritance (compliant with AGENTS.md).
 */

const readline = require('node:readline');
const { resolveConfig } = require('./config.js');
const { createRegistry } = require('./registry.js');

// Tool factories
const { createInspectDbTool } = require('./tools/inspect_db.js');
const { createInspectLogsTool } = require('./tools/inspect_logs.js');
const { createTestBlueprintTool } = require('./tools/test_blueprint.js');
const { createTestSchemaRetentionTool } = require('./tools/test_schema_retention.js');
const { createTestRpgEngineTool } = require('./tools/test_rpg_engine.js');
const { createTestGuardsTool } = require('./tools/test_guards.js');
const { createTestHudPatchTool } = require('./tools/test_hud_patch.js');
const { createCaptureScreenshotTool } = require('./tools/capture_screenshot.js');
const { createTestBlueprintExecutionTool } = require('./tools/test_blueprint_execution.js');
const { createTestAgentMultistepTool } = require('./tools/test_agent_multistep.js');
const { createRunAllTestsTool } = require('./tools/run_all_tests.js');

function setupServer() {
  const config = resolveConfig();
  const registry = createRegistry();

  // Register all tools via functional composition
  registry.register(createInspectDbTool(config));
  registry.register(createInspectLogsTool(config));
  registry.register(createTestBlueprintTool(config));
  registry.register(createTestSchemaRetentionTool(config));
  registry.register(createTestRpgEngineTool(config));
  registry.register(createTestGuardsTool(config));
  registry.register(createTestHudPatchTool(config));
  registry.register(createCaptureScreenshotTool(config));
  registry.register(createTestBlueprintExecutionTool(config));
  registry.register(createTestAgentMultistepTool(config));
  registry.register(createRunAllTestsTool(config));

  return { config, registry };
}

async function runCliTest() {
  const { registry } = setupServer();
  console.log('===============================================================');
  console.log('       Night Voyage MCP Architecture Compliance Test Suite     ');
  console.log('===============================================================');
  console.log('Running all 5 architecture milestones...\n');

  try {
    const report = await registry.callTool('nv_run_all_tests', { verbose: false });
    console.log(JSON.stringify(report, null, 2));

    if (report.success) {
      console.log('\n[PASS] All architecture milestones verified 100% compliant.');
      process.exit(0);
    } else {
      console.error('\n[FAIL] One or more architecture milestones failed verification.');
      process.exit(1);
    }
  } catch (err) {
    console.error('\n[ERROR] Test suite execution failed with exception:', err);
    process.exit(1);
  }
}

function startStdioServer() {
  const { registry } = setupServer();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  const sendResponse = (response) => {
    process.stdout.write(JSON.stringify(response) + '\n');
  };

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let req;
    try {
      req = JSON.parse(trimmed);
    } catch (err) {
      sendResponse({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: `Parse error: ${err.message}` }
      });
      return;
    }

    const { id, method, params } = req;

    // Handle notifications (no response needed)
    if (method === 'notifications/initialized') {
      return;
    }

    // Handle MCP Methods
    if (method === 'initialize') {
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'night-voyage-mcp-test-server',
            version: '1.0.0'
          }
        }
      });
      return;
    }

    if (method === 'tools/list') {
      const tools = registry.getTools();
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: { tools }
      });
      return;
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};

      try {
        const result = await registry.callTool(toolName, toolArgs);
        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }
            ]
          }
        });
      } catch (err) {
        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: err.message }, null, 2)
              }
            ]
          }
        });
      }
      return;
    }

    // Unhandled method
    sendResponse({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method '${method}' not found` }
    });
  });
}

// Main execution switch
if (process.argv.includes('--test') || process.argv.includes('--run-all')) {
  runCliTest();
} else {
  startStdioServer();
}
