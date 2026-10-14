/**
 * Night Voyage —— 浏览器端透明 IPC 桥接器（Browser Use / Web 端适配层）
 *
 * 作用：
 * 当在纯浏览器环境（如 Antigravity Browser Use、Chrome、Playwright）中访问
 * http://127.0.0.1:1420 时，透明拦截所有 Tauri IPC 调用（@tauri-apps/api/core），
 * 维护内存中真实响应的状态与数据链路，避免抛出 window.__TAURI_INTERNALS__ 缺失异常。
 *
 * 约束合规：
 * - C1：前端代码依然是纯渲染（Render-Only），该桥接器仅作为底层网络通信层驱动。
 * - C2：未在白名单的动作调用、金币不足等仍保持显式抛错，不静默回退。
 * - 原生兼容：在 Tauri 桌面外壳内自动 bypass，不影响原生 IPC 性能。
 */

import { mockIPC } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';

export function isBrowserEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  // 仅在原生 Tauri 桌面外壳中，__TAURI_INTERNALS__ 会提前由宿主注入
  return !(window as any).__TAURI_INTERNALS__;
}

export function initBrowserBridge(): void {
  if (!isBrowserEnvironment()) {
    return;
  }

  console.info('[NightVoyage] 正在初始化 Antigravity Browser Use 原生桥接器...');

  // 0. 注入并代理 __TAURI_INTERNALS__.metadata.currentWindow，确保 TitleBar.tsx 的 getCurrentWindow() 正常执行
  let _internals: any = (window as any).__TAURI_INTERNALS__ || {};
  if (!_internals.metadata) _internals.metadata = {};
  if (!_internals.metadata.currentWindow) _internals.metadata.currentWindow = { label: 'main' };

  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    get() {
      if (_internals) {
        if (!_internals.metadata) _internals.metadata = {};
        if (!_internals.metadata.currentWindow) _internals.metadata.currentWindow = { label: 'main' };
      }
      return _internals;
    },
    set(v) {
      if (v && typeof v === 'object') {
        if (!v.metadata) {
          v.metadata = _internals?.metadata || { currentWindow: { label: 'main' } };
        } else if (!v.metadata.currentWindow) {
          v.metadata.currentWindow = { label: 'main' };
        }
        _internals = Object.assign({}, _internals, v);
      } else {
        _internals = v;
      }
    },
    configurable: true,
    enumerable: true,
  });

  // 1. 初始化内存持久化数据模型
  const mockState = {
    settings: new Map<string, string>([
      ['action_bridge.command_whitelist', JSON.stringify(['get_character_detail', 'create_world_book_entry', 'query_world_book_entries', 'buy_item', 'check_inventory'])],
      ['enableDynamicEffects', 'true'],
      ['messageFormatConfig', '{}'],
    ]),
    conversations: [
      {
        id: 1,
        conversationType: 'single',
        title: '黑铁酒馆探秘（Browser Use 验收专线）',
        hostCharacterId: 1,
        worldBookId: 1,
        presetId: 1,
        providerId: 1,
        chatMode: 'classic',
        agentProviderPolicy: 'shared_host_provider',
        memoryMode: 'stateless',
        memberCount: 1,
        pendingMemberCount: 0,
        roomStatus: null,
        createdAt: Date.now() - 3600000,
        updatedAt: Date.now() - 60000,
      },
    ],
    members: [
      {
        id: 1,
        conversationId: 1,
        memberRole: 'host',
        displayName: '流浪冒险者',
        isActive: true,
        joinOrder: 1,
        createdAt: Date.now() - 3600000,
        updatedAt: Date.now() - 60000,
      },
    ],
    messages: [
      {
        id: 1,
        conversationId: 1,
        senderRole: 'system',
        content: '【系统提示】已进入《黑铁酒馆》场景。右侧常驻 HUD 已挂载，ActionButtons 动作通道就绪。',
        createdAt: Date.now() - 120000,
        isSwipe: false,
        swipeIndex: 0,
      },
      {
        id: 2,
        conversationId: 1,
        senderRole: 'assistant',
        content: '老矮人格罗姆站在吧台后，手里擦拭着一把沉重的锻造锤：“年轻的冒险者，想打听什么，或者想买什么？先亮出你的钱袋子！”',
        createdAt: Date.now() - 60000,
        isSwipe: false,
        swipeIndex: 0,
      },
    ],
    characters: [
      {
        id: 1,
        name: '老矮人格罗姆',
        cardType: 'npc',
        description: '黑铁酒馆的老板，曾是一名锻造大师。',
        tags: ['矮人', '锻造师', '掌柜'],
        createdAt: Date.now() - 86400000,
        updatedAt: Date.now() - 86400000,
      },
    ],
    worldBooks: [
      {
        id: 1,
        name: '艾瑞多尼亚世界设定',
        description: '地下城与黑铁边境编年史。',
        entryCount: 1,
        createdAt: Date.now() - 86400000,
        updatedAt: Date.now() - 86400000,
      },
    ],
    worldBookEntries: [
      {
        id: 1,
        worldBookId: 1,
        title: '黑铁酒馆',
        content: '边境荒原上唯一的避风港，矮人与冒险者汇聚之所。',
        keys: ['黑铁酒馆', '酒馆'],
        isEnabled: true,
        triggerMode: 'any',
        createdAt: Date.now() - 86400000,
        updatedAt: Date.now() - 86400000,
      },
    ],
    presets: [
      {
        id: 1,
        name: '跑团与不可知化核心预设',
        description: '涵盖 L1-L5 契约与常驻 HUD 完整表现层的标准预设',
        chatMode: 'classic',
        memoryMode: 'stateless',
        defaultProviderId: 1,
        createdAt: Date.now() - 86400000,
        updatedAt: Date.now() - 86400000,
      },
    ],
    gameState: {
      stats: {
        hp: 85,
        max_hp: 100,
        mp: 40,
        max_mp: 50,
        gold: 150,
        weight: 14,
        max_weight: 40,
      },
      inventory: [
        {
          id: 'health_potion',
          name: '小型生命药水',
          count: 2,
          unit_weight: 0.5,
          unit_price: 20,
          icon: 'potion',
          properties: {},
        },
        {
          id: 'iron_dagger',
          name: '生锈铁匕首',
          count: 1,
          unit_weight: 2,
          unit_price: 15,
          icon: 'sword',
          properties: {},
        },
      ],
      flags: {
        location: 'black_iron_tavern',
      },
    },
    schemas: [
      {
        id: 'schema_char_profile',
        presetId: 1,
        name: '角色详情卡',
        description: 'NPC 档案卡与收录动作',
        retentionDepth: 2,
        fields: [
          { name: 'name', fieldType: 'string', required: true, displayTarget: 'PersistentHUD', description: '角色姓名' },
          { name: 'role', fieldType: 'string', required: true, displayTarget: 'InlineMessage', description: '身份/职业' },
          { name: 'desc', fieldType: 'string', required: true, displayTarget: 'InlineMessage', description: '详细描述' },
        ],
        card: {
          titleField: 'name',
          actions: [
            {
              label: '加入世界书',
              command: 'create_world_book_entry',
              argsTemplate: [
                ['title', '{name}'],
                ['content', '{role}: {desc}'],
              ],
            },
          ],
        },
      },
    ],
    uiLayouts: [
      {
        id: 'layout_default_right_dock',
        presetId: 1,
        name: '右侧默认玄青色仪表盘',
        mountType: 'rightDock',
        layoutJson: JSON.stringify({
          root: {
            id: 'root_canvas',
            widgetType: 'panelContainer',
            label: '常驻状态栏',
            dataBinding: '',
            style: { width: '320px', padding: '12px' },
            children: [
              {
                id: 'w_hp',
                widgetType: 'statBar',
                label: '生命值 (HP)',
                dataBinding: 'stats.hp',
                config: { maxValue: 100, direction: 'horizontal', showValue: true, barColor: '#ef4444' },
              },
              {
                id: 'w_gold',
                widgetType: 'dataLabel',
                label: '持有时币 (Gold)',
                dataBinding: 'stats.gold',
              },
              {
                id: 'w_action_inspect',
                widgetType: 'actionButton',
                label: '🔍 查看 NPC 详情',
                dataBinding: '',
                config: {
                  command: 'get_character_detail',
                  args_template: { character_id: '1' },
                  result_schema_id: 'schema_char_profile',
                },
              },
              {
                id: 'w_action_buy',
                widgetType: 'actionButton',
                label: ' 购买精钢短剑 (50G)',
                dataBinding: '',
                config: {
                  command: 'buy_item',
                  args_template: { item_id: 'steel_sword', count: '1', unit_price: '50', unit_weight: '8' },
                },
              },
              {
                id: 'w_inv',
                widgetType: 'inventorySlotGrid',
                label: '背包道具',
                dataBinding: 'inventory',
                config: { columns: 4, slotSize: 48 },
              },
            ],
          },
        }),
      },
    ],
  };

  // 2. 注册 mockIPC 拦截器
  mockIPC(
    async (cmd: string, args: Record<string, any> = {}) => {
      console.log(`[BrowserBridge IPC] -> ${cmd}`, args);

      switch (cmd) {
        case 'show_window':
          return null;

        case 'mem0_init_status':
          return { ok: true, error: null };

        case 'settings_get_all':
          return Array.from(mockState.settings.entries()).map(([key, value]) => ({ key, value }));

        case 'settings_get':
          return { key: args.key, value: mockState.settings.get(args.key) ?? null };

        case 'settings_set':
          mockState.settings.set(args.key, args.value);
          return { key: args.key, value: args.value };

        case 'conversations_list':
          return mockState.conversations;

        case 'conversations_get':
          return mockState.conversations.find((c) => c.id === args.id) ?? null;

        case 'conversation_members_list':
          return mockState.members;

        case 'messages_list':
          return mockState.messages;

        case 'providers_list':
          return [{ id: 1, name: 'Browser 自动化模拟驱动器', providerKind: 'openai_compatible', isEnabled: true }];

        case 'presets_list':
          return mockState.presets;

        case 'presets_get':
          return { ...mockState.presets[0], blueprintGraph: JSON.stringify({ nodes: [], edges: [] }) };

        case 'character_cards_list':
          return mockState.characters;

        case 'world_books_list':
          return mockState.worldBooks;

        case 'world_book_entries_list':
          return mockState.worldBookEntries;

        case 'world_book_entries_upsert': {
          const newEntry = {
            id: mockState.worldBookEntries.length + 1,
            worldBookId: args.worldBookId ?? 1,
            title: args.title ?? '未命名条目',
            content: args.content ?? '',
            keys: args.keys ?? [],
            isEnabled: true,
            triggerMode: 'any',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          mockState.worldBookEntries.push(newEntry);
          return newEntry;
        }

        case 'get_conversation_mode':
          return 'single_stateless';

        case 'session_ui_layout_get':
          return {
            id: 'layout_default_right_dock',
            presetId: 1,
            name: '右侧默认玄青色仪表盘',
            mountType: 'rightDock',
            layoutJson: mockState.uiLayouts[0].layoutJson,
          };

        case 'preset_ui_layout_list':
          return mockState.uiLayouts;

        case 'preset_ui_layout_get':
          return mockState.uiLayouts.find((l) => l.id === args.id) ?? mockState.uiLayouts[0];

        case 'preset_ui_layout_save': {
          const incoming = args.layout;
          const idx = mockState.uiLayouts.findIndex((l) => l.id === incoming.id);
          if (idx >= 0) {
            mockState.uiLayouts[idx] = incoming;
          } else {
            mockState.uiLayouts.push(incoming);
          }
          return incoming;
        }

        case 'session_ui_layout_bind':
          return { sessionId: args.sessionId, layoutId: args.layoutId };

        case 'preset_schemas_list':
          return mockState.schemas;

        case 'preset_schema_get':
          return mockState.schemas.find((s) => s.id === args.schemaId) ?? null;

        case 'preset_schema_save': {
          const incoming = args.schema;
          const idx = mockState.schemas.findIndex((s) => s.id === incoming.id);
          if (idx >= 0) {
            mockState.schemas[idx] = incoming;
          } else {
            mockState.schemas.push(incoming);
          }
          return incoming;
        }

        case 'action_bridge_whitelist_get': {
          const raw = mockState.settings.get('action_bridge.command_whitelist') || '[]';
          return { commands: JSON.parse(raw) };
        }

        case 'action_bridge_whitelist_set':
          mockState.settings.set('action_bridge.command_whitelist', JSON.stringify(args.commands || []));
          return null;

        case 'session_state_get':
        case 'session_state_raw':
          return mockState.gameState;

        case 'action_bridge_invoke': {
          const whitelistRaw = mockState.settings.get('action_bridge.command_whitelist') || '[]';
          const whitelist: string[] = JSON.parse(whitelistRaw);
          const cmd = args.command;

          // C2 零静默回退：未在白名单严格显式报错
          if (!whitelist.includes(cmd)) {
            throw new Error(`命令 ${cmd} 未在动作白名单注册（当前白名单: [${whitelist.join(', ')}]）`);
          }

          if (cmd === 'get_character_detail') {
            return {
              name: '老矮人格罗姆',
              role: '酒馆掌柜兼传奇锻造师',
              desc: '胡子扎着精钢铁环，眼神凌厉，手里总拿着一把黑铁锻造锤。',
            };
          }

          if (cmd === 'create_world_book_entry') {
            const entryId = mockState.worldBookEntries.length + 1;
            const newEntry = {
              id: entryId,
              worldBookId: 1,
              title: args.args?.title || '新人物卡条目',
              content: args.args?.content || '',
              keys: [args.args?.title || '条目'],
              isEnabled: true,
              triggerMode: 'any',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            mockState.worldBookEntries.push(newEntry);
            return { entryId, title: newEntry.title, status: 'created' };
          }

          if (cmd === 'buy_item') {
            const unitPrice = parseFloat(args.args?.unit_price ?? '50');
            const count = parseInt(args.args?.count ?? '1', 10);
            const totalCost = unitPrice * count;
            const unitWeight = parseFloat(args.args?.unit_weight ?? '10');

            // 门禁判定
            if (mockState.gameState.stats.gold < totalCost) {
              throw new Error(`金币不足！需要 ${totalCost} 金币，当前仅有 ${mockState.gameState.stats.gold} 金币`);
            }

            // 原子扣款与加道具
            mockState.gameState.stats.gold -= totalCost;
            mockState.gameState.stats.weight += unitWeight * count;
            mockState.gameState.inventory.push({
              id: args.args?.item_id ?? 'iron_sword',
              name: '精钢短剑',
              count,
              unit_weight: unitWeight,
              unit_price: unitPrice,
              icon: 'sword',
              properties: {},
            });

            // 发射 HUD 状态增量广播
            void emit('session:hud_state_patch', {
              sessionId: args.conversationId,
              state: mockState.gameState,
            });

            return `购买成功！扣除 ${totalCost} 金币，获得 精钢短剑*${count}，剩余金币: ${mockState.gameState.stats.gold}G`;
          }

          if (cmd === 'check_inventory') {
            return `【当前背包】物品数: ${mockState.gameState.inventory.length}，负重: ${mockState.gameState.stats.weight}/${mockState.gameState.stats.max_weight}kg，金币: ${mockState.gameState.stats.gold}G`;
          }

          return { ok: true, command: cmd, args: args.args };
        }

        case 'chat_submit_input': {
          const userMsg = {
            id: mockState.messages.length + 1,
            conversationId: args.conversationId,
            senderRole: 'user',
            content: args.content,
            createdAt: Date.now(),
            isSwipe: false,
            swipeIndex: 0,
          };
          mockState.messages.push(userMsg);

          // 模拟 D20 掷骰广播与回复
          setTimeout(() => {
            void emit('session:dice_roll', {
              sessionId: args.conversationId,
              roundId: 101,
              roll: 18,
              modifier: 2,
              dc: 15,
              passed: true,
              tool: 'd20_check',
            });

            const replyMsg = {
              id: mockState.messages.length + 1,
              conversationId: args.conversationId,
              senderRole: 'assistant',
              content: `【检定通过（18+2=20 >= DC15）】老格罗姆赞赏地拍了拍吧台：“身手不错！来尝尝我新酿的麦酒。”`,
              createdAt: Date.now(),
              isSwipe: false,
              swipeIndex: 0,
            };
            mockState.messages.push(replyMsg);
          }, 300);

          return { roundId: 101, status: 'completed' };
        }

        default:
          console.warn(`[BrowserBridge IPC] 未注册指令: ${cmd}，返回通用空响应`);
          return null;
      }
    },
    { shouldMockEvents: true },
  );

  console.info('[NightVoyage] Antigravity Browser Use 原生桥接器就绪！');
}
