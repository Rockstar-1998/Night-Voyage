/**
 * Master test suite runner: nv_run_all_tests
 * Runs full compliance audit across all 5 milestones of agent-system-architecture-plan.md:
 * M1: Independent Schema & Retention Depth Reverse Sliding Pruner
 * M2: Structured DataContainer, Inspect/Mutate ToolCalls & Deterministic Gates
 * M3: Universal Persistent HUD Dual-Channel & Shadow DOM CSS Sandbox (C4)
 * M4: CSPRNG D20, Aho-Corasick Banned Words Self-Nudge & Scriptwriter/Director
 * M5: AppData Persistence & Live Logs Audit
 *
 * Adheres strictly to AGENTS.md composition over inheritance.
 */

const { createInspectDbTool } = require('./inspect_db.js');
const { createInspectLogsTool } = require('./inspect_logs.js');
const { createTestBlueprintTool } = require('./test_blueprint.js');
const { createTestSchemaRetentionTool } = require('./test_schema_retention.js');
const { createTestRpgEngineTool } = require('./test_rpg_engine.js');
const { createTestGuardsTool } = require('./test_guards.js');
const { createTestHudPatchTool } = require('./test_hud_patch.js');
const { resolveConfig } = require('../config.js');

function createRunAllTestsTool(config) {
  const activeConfig = config && config.testPresetPath ? config : resolveConfig();
  return {
    name: 'nv_run_all_tests',
    description:
      'Execute the complete automated test suite verifying all 5 architecture milestones in plans/agent-system-architecture-plan.md.',
    inputSchema: {
      type: 'object',
      properties: {
        verbose: {
          type: 'boolean',
          default: false,
          description: 'Whether to include detailed step payloads in the audit report'
        }
      }
    },
    async execute(args = {}) {
      const startTime = Date.now();
      const verbose = args.verbose || false;

      const results = {};
      const milestoneAudit = {
        milestone1_schema_system: { name: 'M1: 独立 Schema 与保留层数倒序裁剪', passed: false },
        milestone2_rpg_datacontainer: { name: 'M2: 数据容器与确定性 ToolCall 门禁', passed: false },
        milestone3_universal_hud: { name: 'M3: 全模式常驻 HUD 与 Shadow DOM 沙箱', passed: false },
        milestone4_guards_orchestrator: { name: 'M4: 确定性 D20、禁词自纠与 Agent 编排', passed: false },
        milestone5_appdata_and_blueprint: { name: 'M5: V2.2 核心预设拓扑与数据库留痕', passed: false }
      };

      // 1. Run Blueprint Tests (M5)
      try {
        const bpTool = createTestBlueprintTool(activeConfig);
        const bpRes = await bpTool.execute();
        const brokenCount = bpRes.graphStats ? bpRes.graphStats.brokenEdgesCount : 0;
        results.blueprint = {
          success: bpRes.success,
          totalNodes: bpRes.graphStats?.totalNodes,
          totalEdges: bpRes.graphStats?.totalEdges,
          brokenEdgesCount: brokenCount,
          newArchitectureNodes: bpRes.newArchitectureNodes,
          evaluation: bpRes.evaluation
        };
        if (bpRes.success && brokenCount === 0 && bpRes.evaluation?.graphTopologyIntact) {
          milestoneAudit.milestone5_appdata_and_blueprint.passed = true;
        }
      } catch (err) {
        results.blueprint = { success: false, error: err.message };
      }

      // 2. Run Schema Retention Tests (M1)
      try {
        const schemaTool = createTestSchemaRetentionTool(activeConfig);
        const schemaRes = await schemaTool.execute({ retention_depth: 3 });
        results.schema_retention = {
          success: schemaRes.success,
          totalTestCases: schemaRes.totalTestCases,
          casesPassed: schemaRes.casesPassed,
          specCompliance: schemaRes.specCompliance
        };
        if (schemaRes.success) {
          milestoneAudit.milestone1_schema_system.passed = true;
        }
      } catch (err) {
        results.schema_retention = { success: false, error: err.message };
      }

      // 3. Run RPG Engine & DataContainer Tests (M2)
      try {
        const rpgTool = createTestRpgEngineTool(activeConfig);
        const rpgRes = await rpgTool.execute();
        results.rpg_engine = {
          success: rpgRes.success,
          totalSteps: rpgRes.totalSteps,
          stepsPassed: rpgRes.stepsPassed,
          specCompliance: rpgRes.specCompliance,
          finalDataContainerState: rpgRes.finalDataContainerState
        };
        if (rpgRes.success) {
          milestoneAudit.milestone2_rpg_datacontainer.passed = true;
        }
      } catch (err) {
        results.rpg_engine = { success: false, error: err.message };
      }

      // 4. Run HUD Patch & Shadow DOM Tests (M3)
      try {
        const hudTool = createTestHudPatchTool(activeConfig);
        const hudRes = await hudTool.execute({ test_type: 'all' });
        const allHudPassed =
          hudRes.results.channel_a_test?.success &&
          hudRes.results.channel_b_test?.success &&
          hudRes.results.zero_garbage_cards_test?.success &&
          hudRes.results.layout_hierarchy_test?.success &&
          hudRes.results.css_sandbox_test?.success;

        results.universal_hud = {
          success: allHudPassed,
          channel_a_success: hudRes.results.channel_a_test?.success,
          channel_b_success: hudRes.results.channel_b_test?.success,
          zero_garbage_cards_success: hudRes.results.zero_garbage_cards_test?.success,
          layout_hierarchy_success: hudRes.results.layout_hierarchy_test?.success,
          css_sandbox_isolated: hudRes.results.css_sandbox_test?.success
        };
        if (allHudPassed) {
          milestoneAudit.milestone3_universal_hud.passed = true;
        }
      } catch (err) {
        results.universal_hud = { success: false, error: err.message };
      }

      // 5. Run Guards & Orchestrator Tests (M4)
      try {
        const guardsTool = createTestGuardsTool(activeConfig);
        const guardsRes = await guardsTool.execute({ test_type: 'all' });
        const allGuardsPassed =
          guardsRes.results.d20_test?.success &&
          guardsRes.results.banned_words_test?.success &&
          guardsRes.results.self_nudge_test?.success &&
          guardsRes.results.scriptwriter_test?.success &&
          guardsRes.results.director_actor_test?.success;

        results.guards_and_orchestrator = {
          success: allGuardsPassed,
          d20_success: guardsRes.results.d20_test?.success,
          banned_words_success: guardsRes.results.banned_words_test?.success,
          self_nudge_success: guardsRes.results.self_nudge_test?.success,
          scriptwriter_blackout_success: guardsRes.results.scriptwriter_test?.success,
          director_actor_pruning_success: guardsRes.results.director_actor_test?.success
        };
        if (allGuardsPassed) {
          milestoneAudit.milestone4_guards_orchestrator.passed = true;
        }
      } catch (err) {
        results.guards_and_orchestrator = { success: false, error: err.message };
      }

      // 6. Inspect Database Schema & Migrations (M5 supplement)
      try {
        const dbTool = createInspectDbTool(activeConfig);
        const dbRes = await dbTool.execute({ target: 'tables' });
        results.database = {
          success: dbRes.success,
          tablesFound: dbRes.data?.length || 0,
          hasPresetSchemas: dbRes.data?.some(t => t.name === 'preset_schemas'),
          hasSessionStates: dbRes.data?.some(t => t.name === 'session_states')
        };
      } catch (err) {
        results.database = { success: false, error: err.message };
      }

      // 7. Inspect AppData Logs (M5 supplement)
      try {
        const logsTool = createInspectLogsTool(activeConfig);
        const logsRes = await logsTool.execute({ logType: 'llm', limit: 3 });
        results.logs = {
          success: logsRes.success,
          totalFilesFound: logsRes.summary?.totalFilesFound || 0,
          latestLogFile: logsRes.summary?.latestLogFile || null
        };
      } catch (err) {
        results.logs = { success: false, error: err.message };
      }

      const durationMs = Date.now() - startTime;
      const allMilestonesPassed = Object.values(milestoneAudit).every(m => m.passed);

      return {
        success: allMilestonesPassed,
        overallStatus: allMilestonesPassed ? '100% COMPLIANT' : 'AUDIT FAILED',
        durationMs,
        milestoneAudit,
        summary: {
          milestonesTotal: Object.keys(milestoneAudit).length,
          milestonesPassed: Object.values(milestoneAudit).filter(m => m.passed).length
        },
        detailedResults: verbose ? results : {
          blueprint: results.blueprint,
          schema_retention: results.schema_retention,
          rpg_engine: results.rpg_engine,
          universal_hud: results.universal_hud,
          guards_and_orchestrator: results.guards_and_orchestrator,
          database: results.database,
          logs: results.logs
        }
      };
    }
  };
}

module.exports = { createRunAllTestsTool };
