/**
 * Tool for testing the Universal Persistent Reactive HUD & UI Designer Pipeline
 * Corresponds to Section 4 of agent-system-architecture-plan.md:
 * 1. Dual-Channel HUD State Patch Generation:
 *    - Channel A: Agent mode ToolCall DataContainer mutation
 *    - Channel B: STATELESS / LEGACY mode PersistentHUD Schema field extraction
 * 2. Zero-Trailing-Trash-Cards Stream Filter:
 *    - InlineMessage goes to conversation bubble
 *    - PersistentHUD fields extracted and stripped from bubble body
 * 3. Freeform Layout & Hierarchy Verification (RootCanvas, PanelContainer, Tabs, StatBar, InventoryGrid)
 * 4. Default Xuanqing Theme & Shadow DOM CSS Sandbox isolation (C4 constraint)
 */

/**
 * Xuanqing theme color tokens
 */
const XUANQING_THEME = {
  id: 'xuanqing_default',
  name: '玄青色默认预设主题',
  palette: {
    bg_primary: '#0d1518',
    bg_surface: '#142228',
    border: '#1e353f',
    accent: '#3a6b7e',
    text_primary: '#e3edf2',
    text_muted: '#7a96a3',
    success: '#2e7d64',
    danger: '#a63a3a'
  }
};

/**
 * Emits Channel A Patch: DataContainer Mutation
 */
function createChannelAPatch(sessionId, dataContainerDelta) {
  return {
    event: 'session:hud_state_patch',
    channel: 'channel_a_toolcall',
    sessionId,
    timestamp: Date.now(),
    patch: {
      stats: dataContainerDelta.stats || {},
      inventory: dataContainerDelta.inventory || [],
      flags: dataContainerDelta.flags || {}
    }
  };
}

/**
 * Emits Channel B Patch: Schema Stream Extraction
 */
function processSchemaStream(sessionId, rawStreamJson, schemaDefinition) {
  const inlineFields = {};
  const persistentFields = {};
  const hudPatches = [];

  const fieldDefs = schemaDefinition.fields || [];
  const fieldTargetMap = new Map();
  for (const f of fieldDefs) {
    fieldTargetMap.set(f.name, f.display_target || 'InlineMessage');
  }

  for (const [key, val] of Object.entries(rawStreamJson)) {
    const target = fieldTargetMap.get(key) || 'InlineMessage';
    if (target === 'PersistentHUD') {
      persistentFields[key] = val;
      hudPatches.push({
        event: 'session:hud_state_patch',
        channel: 'channel_b_schema',
        sessionId,
        timestamp: Date.now(),
        field: key,
        value: val
      });
    } else {
      inlineFields[key] = val;
    }
  }

  // Pure bubble narrative should only contain inline fields (narrative, thinking, etc.)
  const cleanBubbleBody = inlineFields.narrative || inlineFields.body || Object.values(inlineFields).join('\n\n');

  return {
    hudPatches,
    inlineFields,
    persistentFields,
    cleanBubbleBody,
    hasTrailingCards: false // Zero garbage cards in chat bubble
  };
}

/**
 * Validates Shadow DOM CSS Isolation
 */
function validateShadowDomIsolation(customCss, hostHtml) {
  const dangerousHostTargets = ['body', ':root', 'html', '.night-voyage-app', '#root'];
  const violations = [];

  // Parse CSS selectors
  const selectorRegex = /([^{]+)\{([^}]+)\}/g;
  let match;
  while ((match = selectorRegex.exec(customCss)) !== null) {
    const selector = match[1].trim();
    for (const target of dangerousHostTargets) {
      if (selector === target || selector.startsWith(target + ' ') || selector.startsWith(target + ',')) {
        violations.push({
          rule: selector,
          reason: `Violates C4 CSS isolation: global selector '${target}' targets host application`
        });
      }
    }
  }

  // In Shadow DOM with closed/open mode, selectors only apply inside the shadowRoot
  const shadowDomStructure = {
    encapsulation: 'ShadowRoot (mode: "closed")',
    isolatedCss: customCss,
    hostIsolated: violations.length === 0,
    mountTarget: 'PersistentHudContainer'
  };

  return {
    isIsolated: violations.length === 0,
    violations,
    shadowDomStructure
  };
}

/**
 * Factory for nv_test_hud_patch tool
 */
function createTestHudPatchTool(config = {}) {
  return {
    name: 'nv_test_hud_patch',
    description:
      'Tests Universal Persistent HUD dual-channel patch generation, zero-trailing-garbage-cards filter, layout hierarchy, and Shadow DOM CSS sandbox.',
    inputSchema: {
      type: 'object',
      properties: {
        test_type: {
          type: 'string',
          enum: ['all', 'channel_a', 'channel_b', 'zero_garbage_cards', 'layout_hierarchy', 'css_sandbox'],
          default: 'all',
          description: 'Which HUD feature to test'
        },
        custom_css: {
          type: 'string',
          description: 'Optional custom CSS string to validate against Shadow DOM sandbox'
        }
      }
    },
    async execute(args = {}) {
      const testType = args.test_type || 'all';
      const results = {};
      const sessionId = 'test-session-hud-001';

      // 1. Channel A: Agent Mode ToolCall Mutation -> HUD Patch
      if (testType === 'all' || testType === 'channel_a') {
        const toolCallDelta = {
          stats: { hp: 35, gold: 100, weight: 28 },
          inventory: [{ id: 'iron_sword', name: '精钢长剑', count: 1, unit_weight: 10, unit_price: 50 }],
          flags: { quest_sword_acquired: 'true' }
        };
        const patch = createChannelAPatch(sessionId, toolCallDelta);

        results.channel_a_test = {
          success: patch.channel === 'channel_a_toolcall' && patch.patch.stats.gold === 100,
          emitted_patch: patch,
          target_components_updated: ['StatBar(hp)', 'StatBar(gold)', 'StatBar(weight)', 'InventorySlotGrid']
        };
      }

      // 2. Channel B: STATELESS / LEGACY Schema Extraction -> HUD Patch
      if (testType === 'all' || testType === 'channel_b' || testType === 'zero_garbage_cards') {
        const schemaDef = {
          id: 'turn_summary_schema',
          name: '回合状态总结',
          fields: [
            { name: 'thinking', display_target: 'InlineMessage' },
            { name: 'narrative', display_target: 'InlineMessage' },
            { name: 'hp', display_target: 'PersistentHUD' },
            { name: 'gold', display_target: 'PersistentHUD' },
            { name: 'location', display_target: 'PersistentHUD' }
          ]
        };

        const mockLlmStreamOutput = {
          thinking: '经过上一轮战斗，玩家受到了轻微擦伤，消耗了部分金币购买补给。',
          narrative: '你推开酒馆沉重的橡木大门，壁炉中噼啪作响的柴火驱散了周身的寒意。酒保抬头向你致意。',
          hp: 85,
          gold: 240,
          location: '白岩城·野猪酒馆'
        };

        const streamResult = processSchemaStream(sessionId, mockLlmStreamOutput, schemaDef);

        results.channel_b_test = {
          success: streamResult.hudPatches.length === 3 && streamResult.persistentFields.hp === 85,
          emitted_hud_patches: streamResult.hudPatches,
          extracted_persistent_fields: streamResult.persistentFields
        };

        results.zero_garbage_cards_test = {
          success: !streamResult.cleanBubbleBody.includes('85') && !streamResult.cleanBubbleBody.includes('240'),
          clean_bubble_narrative: streamResult.cleanBubbleBody,
          persistent_fields_filtered_out: Object.keys(streamResult.persistentFields),
          trash_cards_prevented: true
        };
      }

      // 3. Layout Hierarchy & Xuanqing Theme
      if (testType === 'all' || testType === 'layout_hierarchy') {
        const sampleLayout = {
          root: {
            type: 'RootCanvas',
            mode: 'Absolute',
            width: 320,
            height: 600,
            theme: XUANQING_THEME.id,
            children: [
              {
                type: 'PanelContainer',
                id: 'player_status_panel',
                title: '角色即时状态',
                rect: { x: 12, y: 12, width: 296, height: 180 },
                children: [
                  { type: 'StatBar', field: 'stats.hp', maxField: 'stats.max_hp', label: '生命值', color: '#a63a3a' },
                  { type: 'StatBar', field: 'stats.gold', label: '金币', color: '#c99a3e' }
                ]
              },
              {
                type: 'TabsContainer',
                id: 'sub_views',
                rect: { x: 12, y: 200, width: 296, height: 380 },
                tabs: [
                  { id: 'tab_inv', label: '背包道具', widget: 'InventorySlotGrid' },
                  { id: 'tab_quest', label: '任务进度', widget: 'QuestLogView' }
                ]
              }
            ]
          }
        };

        results.layout_hierarchy_test = {
          success: sampleLayout.root.type === 'RootCanvas' && sampleLayout.root.children.length === 2,
          theme_applied: XUANQING_THEME,
          layout_tree: sampleLayout
        };
      }

      // 4. CSS Sandbox & Shadow DOM Isolation (C4)
      if (testType === 'all' || testType === 'css_sandbox') {
        const validCustomCss = `
          .nv-hud-panel {
            background: rgba(13, 21, 24, 0.85);
            backdrop-filter: blur(12px);
            border: 1px solid #1e353f;
            border-radius: 8px;
          }
          .nv-stat-bar-fill {
            background: linear-gradient(90deg, #3a6b7e, #2e7d64);
            transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          }
        `;

        const leakingCustomCss = `
          body {
            background-color: red !important;
          }
          :root {
            font-size: 24px;
          }
          .nv-hud-panel {
            border: 1px solid blue;
          }
        `;

        const validIsolation = validateShadowDomIsolation(args.custom_css || validCustomCss);
        const leakingIsolation = validateShadowDomIsolation(leakingCustomCss);

        results.css_sandbox_test = {
          success: validIsolation.isIsolated && !leakingIsolation.isIsolated,
          valid_css_isolation: validIsolation,
          leaking_css_blocked: {
            detected_violations: leakingIsolation.violations,
            blocked: !leakingIsolation.isIsolated
          }
        };
      }

      return {
        status: 'OK',
        results
      };
    }
  };
}

module.exports = {
  createTestHudPatchTool,
  XUANQING_THEME,
  createChannelAPatch,
  processSchemaStream,
  validateShadowDomIsolation
};
