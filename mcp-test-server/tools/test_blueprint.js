const fs = require('node:fs');

function createTestBlueprintTool(config) {
  return {
    name: 'nv_test_blueprint',
    description:
      'Validate and test Night Voyage V2.2 core preset blueprint graph, node types, edges, schema definitions, and branch topologies.',
    inputSchema: {
      type: 'object',
      properties: {
        presetPath: {
          type: 'string',
          description: 'Path to the preset JSON file (default: config.testPresetPath)',
        },
      },
    },
    async execute(args = {}) {
      const presetPath = args.presetPath || config.testPresetPath;

      if (!fs.existsSync(presetPath)) {
        return {
          success: false,
          error: `Preset file not found at: ${presetPath}`,
        };
      }

      let rawContent;
      let rawData;
      try {
        rawContent = fs.readFileSync(presetPath, 'utf-8');
        rawData = JSON.parse(rawContent);
      } catch (err) {
        return {
          success: false,
          error: `Failed to parse preset JSON: ${err.message}`,
        };
      }

      const preset = rawData.preset || rawData;
      const name = preset.name || 'Unnamed';
      const version = rawData.format || preset.version || '2.2';

      let blueprintGraph = preset.blueprint_graph || preset.blueprintGraph;
      if (typeof blueprintGraph === 'string') {
        try {
          blueprintGraph = JSON.parse(blueprintGraph);
        } catch (e) {
          return {
            success: false,
            error: `Failed to parse blueprintGraph JSON string: ${e.message}`,
          };
        }
      }

      if (!blueprintGraph || !Array.isArray(blueprintGraph.nodes)) {
        return {
          success: false,
          error: 'Preset does not contain a valid blueprint_graph.nodes array',
        };
      }

      const nodes = blueprintGraph.nodes || [];
      const edges = blueprintGraph.edges || [];

      // Collect node types and index
      const nodeTypeCounts = {};
      const nodeMap = new Map();
      const newArchitectureNodes = {
        invoke_schema: [],
        tool_definition: [],
        calculator: [],
        condition_gate: [],
        tool_return: [],
        ui_layout_config: [],
        mode_switch: [],
      };

      for (const node of nodes) {
        const rawType = (node.type || node.nodeType || 'Unknown').toLowerCase();
        nodeTypeCounts[rawType] = (nodeTypeCounts[rawType] || 0) + 1;
        nodeMap.set(node.id, node);

        if (rawType === 'invoke_schema' || rawType === 'invokeschema') {
          newArchitectureNodes.invoke_schema.push({ id: node.id, config: node.config });
        }
        if (rawType === 'tool_definition' || rawType === 'tooldefinition') {
          newArchitectureNodes.tool_definition.push({ id: node.id, config: node.config });
        }
        if (rawType === 'calculator') {
          newArchitectureNodes.calculator.push({ id: node.id, config: node.config });
        }
        if (rawType === 'condition_gate' || rawType === 'conditiongate') {
          newArchitectureNodes.condition_gate.push({ id: node.id, config: node.config });
        }
        if (rawType === 'tool_return' || rawType === 'toolreturn') {
          newArchitectureNodes.tool_return.push({ id: node.id, config: node.config });
        }
        if (rawType === 'ui_layout_config' || rawType === 'uilayoutconfig') {
          newArchitectureNodes.ui_layout_config.push({ id: node.id, config: node.config });
        }
        if (rawType === 'mode_switch' || rawType === 'modeswitch') {
          newArchitectureNodes.mode_switch.push({ id: node.id, config: node.config });
        }
      }

      // Check edges integrity
      let brokenEdgesCount = 0;
      const brokenEdges = [];
      const outgoingEdges = new Map();
      const incomingEdges = new Map();

      for (const edge of edges) {
        const src = edge.sourceNodeId || edge.source;
        const tgt = edge.targetNodeId || edge.target;
        const sourceExists = nodeMap.has(src);
        const targetExists = nodeMap.has(tgt);

        if (!sourceExists || !targetExists) {
          brokenEdgesCount++;
          brokenEdges.push({ edge, sourceExists, targetExists });
        } else {
          if (!outgoingEdges.has(src)) outgoingEdges.set(src, []);
          outgoingEdges.get(src).push(edge);

          if (!incomingEdges.has(tgt)) incomingEdges.set(tgt, []);
          incomingEdges.get(tgt).push(edge);
        }
      }

      // Check key gates and branching
      const hasAgentGate = nodeMap.has('n_agent_gate');
      const hasRpgEngineGate = nodeMap.has('n_rpg_engine_gate');
      const hasModeSwitch = nodeMap.has('n_mode_switch');

      // Analyze agent gate branches
      let agentGateBranches = [];
      if (hasAgentGate) {
        const agentGateNode = nodeMap.get('n_agent_gate');
        const outEdges = outgoingEdges.get('n_agent_gate') || [];
        agentGateBranches = outEdges.map((e) => ({
          branchKey: e.sourceHandle || e.branchKey,
          targetNode: e.targetNodeId || e.target,
        }));
      }

      // Analyze mode switch branches
      let modeSwitchBranches = [];
      if (hasModeSwitch) {
        const outEdges = outgoingEdges.get('n_mode_switch') || [];
        modeSwitchBranches = outEdges.map((e) => ({
          branchKey: e.sourceHandle || e.branchKey,
          targetNode: e.targetNodeId || e.target,
        }));
      }

      // Analyze RPG tool flow
      const toolFlows = newArchitectureNodes.tool_definition.map((t) => {
        const nextEdges = outgoingEdges.get(t.id) || [];
        return {
          toolId: t.id,
          toolName: t.config?.toolName || t.config?.tool_name || t.id,
          connectedTargets: nextEdges.map((e) => e.targetNodeId || e.target),
        };
      });

      return {
        success: brokenEdgesCount === 0,
        presetName: name,
        presetVersion: version,
        fileSizeBytes: rawContent.length,
        graphStats: {
          totalNodes: nodes.length,
          totalEdges: edges.length,
          brokenEdgesCount,
          brokenEdges: brokenEdges.slice(0, 5),
          nodeTypeCounts,
        },
        newArchitectureNodes: {
          invokeSchemaCount: newArchitectureNodes.invoke_schema.length,
          toolDefinitionCount: newArchitectureNodes.tool_definition.length,
          calculatorCount: newArchitectureNodes.calculator.length,
          conditionGateCount: newArchitectureNodes.condition_gate.length,
          toolReturnCount: newArchitectureNodes.tool_return.length,
          uiLayoutConfigCount: newArchitectureNodes.ui_layout_config.length,
          modeSwitchCount: newArchitectureNodes.mode_switch.length,
          hasAgentGate,
          hasRpgEngineGate,
          hasModeSwitch,
        },
        branchingAnalysis: {
          agentGate: {
            exists: hasAgentGate,
            branches: agentGateBranches,
          },
          modeSwitch: {
            exists: hasModeSwitch,
            branches: modeSwitchBranches,
          },
          rpgToolFlows: toolFlows,
        },
        evaluation: {
          allNewNodeTypesPresent:
            newArchitectureNodes.invoke_schema.length > 0 &&
            newArchitectureNodes.tool_definition.length > 0 &&
            newArchitectureNodes.calculator.length > 0 &&
            newArchitectureNodes.condition_gate.length > 0 &&
            newArchitectureNodes.tool_return.length > 0 &&
            newArchitectureNodes.ui_layout_config.length > 0,
          dualAgentGateConfigured: hasAgentGate,
          rpgEngineGateConfigured: hasRpgEngineGate,
          triStateModeSwitchConfigured: hasModeSwitch,
          graphTopologyIntact: brokenEdgesCount === 0,
        },
      };
    },
  };
}

module.exports = { createTestBlueprintTool };
