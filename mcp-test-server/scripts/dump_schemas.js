const fs = require('node:fs');
const path = require('node:path');
const { resolveConfig } = require('../config.js');
const { createRegistry } = require('../registry.js');

const { createInspectDbTool } = require('../tools/inspect_db.js');
const { createInspectLogsTool } = require('../tools/inspect_logs.js');
const { createTestBlueprintTool } = require('../tools/test_blueprint.js');
const { createTestSchemaRetentionTool } = require('../tools/test_schema_retention.js');
const { createTestRpgEngineTool } = require('../tools/test_rpg_engine.js');
const { createTestGuardsTool } = require('../tools/test_guards.js');
const { createTestHudPatchTool } = require('../tools/test_hud_patch.js');
const { createRunAllTestsTool } = require('../tools/run_all_tests.js');

const config = resolveConfig();
const registry = createRegistry();

registry.register(createInspectDbTool(config));
registry.register(createInspectLogsTool(config));
registry.register(createTestBlueprintTool(config));
registry.register(createTestSchemaRetentionTool(config));
registry.register(createTestRpgEngineTool(config));
registry.register(createTestGuardsTool(config));
registry.register(createTestHudPatchTool(config));
registry.register(createRunAllTestsTool(config));

const tools = registry.getTools();
const targetDir = 'C:\\Users\\Administrator\\.gemini\\antigravity-ide\\mcp\\night-voyage-mcp';

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

for (const tool of tools) {
  const schemaObj = {
    name: tool.name,
    description: tool.description,
    parameters: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      ...tool.inputSchema
    }
  };
  const filePath = path.join(targetDir, `${tool.name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(schemaObj, null, 2), 'utf-8');
  console.log(`Generated: ${filePath}`);
}

console.log('All 8 tool schemas exported successfully.');
