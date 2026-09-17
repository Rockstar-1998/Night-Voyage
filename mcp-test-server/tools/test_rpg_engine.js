/**
 * RPG Engine & DataContainer ToolCall Pipeline Simulator & Test
 * Corresponds to Section 2 and Section 5 of agent-system-architecture-plan.md
 */

function createInitialDataContainer() {
  return {
    stats: {
      hp: 40,
      max_hp: 100,
      mp: 20,
      max_mp: 50,
      gold: 150,
      weight: 18,
      max_weight: 40,
    },
    inventory: [
      {
        id: 'wooden_staff',
        name: '木杖',
        count: 1,
        unit_weight: 3.0,
        unit_price: 15.0,
        properties: { type: 'weapon' },
      },
      {
        id: 'healing_potion',
        name: '初级治疗药水',
        count: 2,
        unit_weight: 0.5,
        unit_price: 20.0,
        properties: { effect: 'heal', value: '50' },
      },
    ],
    flags: {
      current_location: '迷雾镇旅馆',
      main_quest_stage: '1',
    },
  };
}

function executeToolCall(dataContainer, toolName, args) {
  const container = JSON.parse(JSON.stringify(dataContainer)); // Clone
  const patches = [];

  if (toolName === 'check_inventory') {
    const itemsSummary = container.inventory
      .map((item) => `${item.name}*${item.count} (${item.unit_weight * item.count}kg)`)
      .join(', ');
    return {
      success: true,
      dataContainer: container,
      toolResult: `背包道具: ${itemsSummary || '空'} | 金币: ${container.stats.gold} | 负重: ${container.stats.weight}/${container.stats.max_weight}kg`,
      patches,
      blocked: false,
    };
  }

  if (toolName === 'get_player_stats') {
    return {
      success: true,
      dataContainer: container,
      toolResult: `生命值: ${container.stats.hp}/${container.stats.max_hp} | 魔法值: ${container.stats.mp}/${container.stats.max_mp} | 金币: ${container.stats.gold} | 负重: ${container.stats.weight}/${container.stats.max_weight}kg`,
      patches,
      blocked: false,
    };
  }

  if (toolName === 'buy_item') {
    const { item_id, name, count = 1, unit_price = 0, unit_weight = 0 } = args;
    const totalCost = count * unit_price;
    const addedWeight = count * unit_weight;

    // ConditionGate 1: Gold check
    if (container.stats.gold < totalCost) {
      const shortage = totalCost - container.stats.gold;
      return {
        success: false,
        blocked: true,
        gateFailed: 'ConditionGate_Gold',
        dataContainer, // Unmutated
        toolResult: `[门禁拦截] 金币不足！需要 ${totalCost} 金币，当前仅有 ${container.stats.gold} 金币（差额 ${shortage} 金币），无法购买。`,
        patches: [],
      };
    }

    // ConditionGate 2: Weight check
    const currentWeight = container.stats.weight;
    const maxWeight = container.stats.max_weight;
    if (currentWeight + addedWeight > maxWeight) {
      const excess = currentWeight + addedWeight - maxWeight;
      return {
        success: false,
        blocked: true,
        gateFailed: 'ConditionGate_Weight',
        dataContainer, // Unmutated
        toolResult: `[门禁拦截] 背包超重！当前负重 ${currentWeight}kg，新增 ${addedWeight}kg 将超出最大承重 ${maxWeight}kg（超重 ${excess}kg），无法购买。`,
        patches: [],
      };
    }

    // Calculator: Deduct gold
    container.stats.gold -= totalCost;

    // Calculator: Add/merge item into inventory
    let existingItem = container.inventory.find((i) => i.id === item_id);
    if (existingItem) {
      existingItem.count += count;
    } else {
      container.inventory.push({
        id: item_id,
        name: name || item_id,
        count,
        unit_weight,
        unit_price,
        properties: {},
      });
    }

    // Calculator: Recompute weight atomically
    let totalW = 0;
    for (const it of container.inventory) {
      totalW += (it.unit_weight || 0) * (it.count || 0);
    }
    container.stats.weight = Math.round(totalW * 10) / 10;

    // Persistent HUD patch event
    patches.push({
      type: 'session:hud_state_patch',
      patch: {
        stats: {
          gold: container.stats.gold,
          weight: container.stats.weight,
        },
        inventory: container.inventory,
      },
    });

    return {
      success: true,
      blocked: false,
      dataContainer: container,
      toolResult: `[购买成功] 已购买 ${name || item_id}*${count}，扣除 ${totalCost} 金币，剩余金币: ${container.stats.gold}，当前负重: ${container.stats.weight}/${container.stats.max_weight}kg`,
      patches,
    };
  }

  if (toolName === 'use_item') {
    const { item_id } = args;
    const itemIndex = container.inventory.findIndex((i) => i.id === item_id);
    if (itemIndex === -1) {
      return {
        success: false,
        blocked: true,
        gateFailed: 'ConditionGate_ItemNotFound',
        dataContainer,
        toolResult: `[使用失败] 背包中没有找到物品: ${item_id}`,
        patches: [],
      };
    }

    const item = container.inventory[itemIndex];
    let healAmount = 0;
    if (item.properties?.effect === 'heal') {
      healAmount = Number(item.properties.value) || 30;
      container.stats.hp = Math.min(container.stats.hp + healAmount, container.stats.max_hp);
    }

    item.count -= 1;
    if (item.count <= 0) {
      container.inventory.splice(itemIndex, 1);
    }

    // Recompute weight
    let totalW = 0;
    for (const it of container.inventory) {
      totalW += (it.unit_weight || 0) * (it.count || 0);
    }
    container.stats.weight = Math.round(totalW * 10) / 10;

    patches.push({
      type: 'session:hud_state_patch',
      patch: {
        stats: {
          hp: container.stats.hp,
          weight: container.stats.weight,
        },
        inventory: container.inventory,
      },
    });

    return {
      success: true,
      blocked: false,
      dataContainer: container,
      toolResult: `[使用成功] 使用了 ${item.name}，恢复 ${healAmount} 生命值，当前生命值: ${container.stats.hp}/${container.stats.max_hp}，负重: ${container.stats.weight}kg`,
      patches,
    };
  }

  return {
    success: false,
    error: `Unknown tool: ${toolName}`,
  };
}

function createTestRpgEngineTool(config) {
  return {
    name: 'nv_test_rpg_engine',
    description:
      'Test the DataContainer, ToolDefinition, Calculator, and ConditionGate deterministic pipeline (Section 2 & Section 5).',
    inputSchema: {
      type: 'object',
      properties: {
        runFullScenario: {
          type: 'boolean',
          description: 'Run full multi-step RPG transaction scenarios (default: true)',
          default: true,
        },
      },
    },
    async execute(args = {}) {
      let state = createInitialDataContainer();
      const scenarioSteps = [];

      // Step 1: Check stats
      const step1 = executeToolCall(state, 'get_player_stats', {});
      scenarioSteps.push({
        step: 1,
        tool: 'get_player_stats',
        expectedSuccess: true,
        actualSuccess: step1.success,
        output: step1.toolResult,
      });

      // Step 2: Check inventory
      const step2 = executeToolCall(state, 'check_inventory', {});
      scenarioSteps.push({
        step: 2,
        tool: 'check_inventory',
        expectedSuccess: true,
        actualSuccess: step2.success,
        output: step2.toolResult,
      });

      // Step 3: Buy iron sword (Cost: 50 gold, Weight: 10kg) -> Should PASS
      const step3 = executeToolCall(state, 'buy_item', {
        item_id: 'iron_sword',
        name: '精钢长剑',
        count: 1,
        unit_price: 50,
        unit_weight: 10,
      });
      state = step3.dataContainer;
      scenarioSteps.push({
        step: 3,
        tool: 'buy_item (valid purchase)',
        expectedSuccess: true,
        actualSuccess: step3.success && !step3.blocked,
        goldAfter: state.stats.gold,
        weightAfter: state.stats.weight,
        hudPatchEmitted: step3.patches.length > 0,
        output: step3.toolResult,
      });

      // Step 4: Buy legendary dragon shield (Cost: 500 gold, User has 100) -> Should be BLOCKED by ConditionGate_Gold
      const step4 = executeToolCall(state, 'buy_item', {
        item_id: 'dragon_shield',
        name: '龙鳞巨盾',
        count: 1,
        unit_price: 500,
        unit_weight: 5,
      });
      scenarioSteps.push({
        step: 4,
        tool: 'buy_item (insufficient gold gate check)',
        expectedSuccess: false,
        expectedBlocked: true,
        actualBlocked: step4.blocked,
        gateFailed: step4.gateFailed,
        dataContainerRemainedIntact: step4.dataContainer.stats.gold === 100,
        output: step4.toolResult,
      });

      // Step 5: Buy heavy iron ore (Weight: 25kg, remaining capacity 40-28=12kg) -> Should be BLOCKED by ConditionGate_Weight
      const step5 = executeToolCall(state, 'buy_item', {
        item_id: 'heavy_iron_ore',
        name: '沉重铁矿石',
        count: 1,
        unit_price: 10,
        unit_weight: 30,
      });
      scenarioSteps.push({
        step: 5,
        tool: 'buy_item (overweight gate check)',
        expectedSuccess: false,
        expectedBlocked: true,
        actualBlocked: step5.blocked,
        gateFailed: step5.gateFailed,
        dataContainerRemainedIntact: step5.dataContainer.stats.weight === state.stats.weight,
        output: step5.toolResult,
      });

      // Step 6: Use healing potion -> HP restored from 40 to 90 (max 100), potion count reduced, weight reduced
      const step6 = executeToolCall(state, 'use_item', {
        item_id: 'healing_potion',
      });
      state = step6.dataContainer;
      scenarioSteps.push({
        step: 6,
        tool: 'use_item (healing potion)',
        expectedSuccess: true,
        actualSuccess: step6.success,
        hpAfter: state.stats.hp,
        weightAfter: state.stats.weight,
        hudPatchEmitted: step6.patches.length > 0,
        output: step6.toolResult,
      });

      const allStepsPassed =
        scenarioSteps[0].actualSuccess &&
        scenarioSteps[1].actualSuccess &&
        scenarioSteps[2].actualSuccess &&
        scenarioSteps[3].actualBlocked &&
        scenarioSteps[4].actualBlocked &&
        scenarioSteps[5].actualSuccess;

      return {
        success: allStepsPassed,
        totalSteps: scenarioSteps.length,
        stepsPassed: scenarioSteps.filter((s) => s.actualSuccess || s.actualBlocked).length,
        scenarioSteps,
        finalDataContainerState: state,
        specCompliance: {
          section: 'Section 2 & 5: DataContainer & Deterministic Gates',
          goldGateDeterministicBlocked: scenarioSteps[3].actualBlocked,
          weightGateDeterministicBlocked: scenarioSteps[4].actualBlocked,
          calculatorDeterministicArithmetic: state.stats.gold === 100,
          hudStatePatchDispatched: scenarioSteps[2].hudPatchEmitted && scenarioSteps[5].hudPatchEmitted,
        },
      };
    },
  };
}

module.exports = { createTestRpgEngineTool, executeToolCall, createInitialDataContainer };
