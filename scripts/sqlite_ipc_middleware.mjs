import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const DB_PATH = 'D:\\data\\Night Voyage\\.cache\\instances\\instance-a\\night-voyage.sqlite3';

let db = null;
function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
  }
  return db;
}

export function createSqliteIpcMiddleware() {
  return (req, res, next) => {
    if (req.url !== '/__sqlite_ipc' || req.method !== 'POST') {
      next();
      return;
    }

    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        const { cmd, args = {} } = JSON.parse(raw);
        const result = handleCommand(cmd, args);
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, data: result }));
      } catch (err) {
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
      }
    });
  };
}

function mapMountTypeToFrontend(m) {
  if (!m) return 'rightDock';
  const lower = m.toLowerCase();
  if (lower === 'rightdock') return 'rightDock';
  if (lower === 'topsticky') return 'topSticky';
  if (lower === 'floatinghud') return 'floatingHUD';
  if (lower === 'mobiledrawer') return 'mobileDrawer';
  if (lower === 'mobilebottomsticky') return 'mobileBottomSticky';
  return 'rightDock';
}

function mapMountTypeToDb(m) {
  if (!m) return 'RightDock';
  const lower = m.toLowerCase();
  if (lower === 'rightdock') return 'RightDock';
  if (lower === 'topsticky') return 'TopSticky';
  if (lower === 'floatinghud') return 'FloatingHUD';
  if (lower === 'mobiledrawer') return 'MobileDrawer';
  if (lower === 'mobilebottomsticky') return 'MobileBottomSticky';
  return 'RightDock';
}

function rowToUiLayoutDef(r) {
  let rootContainer = {
    id: 'root',
    kind: 'rootCanvas',
    layoutMode: 'flex',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    children: [],
  };
  try {
    if (r.layout_json) {
      rootContainer = JSON.parse(r.layout_json);
    }
  } catch (err) {
    console.error('Failed to parse layout_json:', err);
  }
  return {
    id: r.id,
    presetId: r.preset_id,
    name: r.name,
    mountType: mapMountTypeToFrontend(r.mount_type),
    theme: r.theme || 'xuanqing',
    customCss: r.custom_css || '',
    rootContainer,
  };
}

function handleCommand(cmd, args) {
  const database = getDb();

  switch (cmd) {
    case 'show_window':
      return null;

    case 'mem0_init_status':
      return { ok: true, error: null };

    case 'get_conversation_mode':
      return 'single_legacy';

    // ─── Conversations ───
    case 'conversations_list': {
      const rows = database
        .prepare(
          `SELECT c.id, c.conversation_type as conversationType, c.title, c.host_character_id as hostCharacterId,
                  c.world_book_id as worldBookId, c.preset_id as presetId, c.provider_id as providerId,
                  c.chat_mode as chatMode, c.agent_provider_policy as agentProviderPolicy, c.memory_mode as memoryMode,
                  c.created_at as createdAt, c.updated_at as updatedAt,
                  r.status as roomStatus
           FROM conversations c
           LEFT JOIN rooms r ON r.conversation_id = c.id
           ORDER BY c.updated_at DESC`,
        )
        .all();
      return rows.map((r) => ({
        ...r,
        memberCount: 1,
        pendingMemberCount: 0,
        roomStatus: r.roomStatus === 'waiting' ? 'open' : r.roomStatus,
      }));
    }

    case 'conversations_get': {
      const r = database
        .prepare(
          `SELECT c.id, c.conversation_type as conversationType, c.title, c.host_character_id as hostCharacterId,
                  c.world_book_id as worldBookId, c.preset_id as presetId, c.provider_id as providerId,
                  c.chat_mode as chatMode, c.agent_provider_policy as agentProviderPolicy, c.memory_mode as memoryMode,
                  c.created_at as createdAt, c.updated_at as updatedAt,
                  r.status as roomStatus
           FROM conversations c
           LEFT JOIN rooms r ON r.conversation_id = c.id
           WHERE c.id = ?`,
        )
        .get(args.id);
      if (!r) return null;
      return {
        ...r,
        memberCount: 1,
        pendingMemberCount: 0,
        roomStatus: r.roomStatus === 'waiting' ? 'open' : r.roomStatus,
      };
    }

    case 'conversation_members_list': {
      const rows = database
        .prepare(
          `SELECT id, conversation_id as conversationId, member_role as memberRole, display_name as displayName,
                  player_character_id as playerCharacterId, join_order as joinOrder, is_active as isActive,
                  created_at as createdAt, updated_at as updatedAt, guest_character_json as guestCharacterJson
           FROM conversation_members WHERE conversation_id = ? ORDER BY join_order ASC`,
        )
        .all(args.conversationId || args.id);
      return rows.map((r) => ({ ...r, isActive: !!r.isActive }));
    }

    // ─── Messages ───
    case 'messages_list': {
      const convId = args.conversationId || args.id;
      const rows = database
        .prepare(
          `SELECT id, conversation_id as conversationId, round_id as roundId, role, content,
                  is_swipe as isSwipe, swipe_index as swipeIndex, reply_to_id as replyToId,
                  message_kind as messageKind, is_hidden as isHidden, display_name as displayName,
                  created_at as createdAt
           FROM messages WHERE conversation_id = ? ORDER BY id ASC`,
        )
        .all(convId);
      return rows.map((r) => ({
        id: r.id,
        conversationId: r.conversationId,
        roundId: r.roundId,
        senderRole: r.role,
        content: r.content,
        isSwipe: !!r.isSwipe,
        swipeIndex: r.swipeIndex || 0,
        replyToId: r.replyToId,
        messageKind: r.messageKind,
        isHidden: !!r.isHidden,
        displayName: r.displayName,
        createdAt: r.createdAt,
      }));
    }

    // ─── Presets ───
    case 'presets_list': {
      const rows = database
        .prepare(
          `SELECT id, name, description, response_mode as responseMode, is_builtin as isBuiltin,
                  version, temperature, max_output_tokens as maxOutputTokens, top_p as topP,
                  thinking_enabled as thinkingEnabled, thinking_budget_tokens as thinkingBudgetTokens,
                  created_at as createdAt, updated_at as updatedAt
           FROM presets ORDER BY updated_at DESC`,
        )
        .all();
      return rows.map((r) => ({ ...r, isBuiltin: !!r.isBuiltin, thinkingEnabled: !!r.thinkingEnabled }));
    }

    case 'presets_get': {
      const row = database
        .prepare(
          `SELECT id, name, description, system_prompt_template as systemPromptTemplate,
                  jailbreak_prompt as jailbreakPrompt, blueprint_graph as blueprintGraph,
                  structured_output_schema as structuredOutputSchema, structured_output_display as structuredOutputDisplay,
                  response_mode as responseMode, temperature, max_output_tokens as maxOutputTokens,
                  created_at as createdAt, updated_at as updatedAt
           FROM presets WHERE id = ?`,
        )
        .get(args.id);
      return row || null;
    }

    // ─── Providers ───
    case 'providers_list': {
      const rows = database
        .prepare(
          `SELECT id, name, provider_kind as providerKind, is_enabled as isEnabled,
                  created_at as createdAt, updated_at as updatedAt
           FROM api_providers ORDER BY id ASC`,
        )
        .all();
      return rows.map((r) => ({ ...r, isEnabled: !!r.isEnabled }));
    }

    // ─── Characters ───
    case 'character_cards_list': {
      const rows = database
        .prepare(
          `SELECT id, name, card_type as cardType, image_path as imagePath, description,
                  created_at as createdAt, updated_at as updatedAt
           FROM character_cards ORDER BY id ASC`,
        )
        .all();
      return rows.map((r) => ({ ...r, tags: [] }));
    }

    // ─── World Books ───
    case 'world_books_list': {
      const rows = database
        .prepare(
          `SELECT id, name, description, created_at as createdAt, updated_at as updatedAt
           FROM world_books ORDER BY id ASC`,
        )
        .all();
      return rows;
    }

    case 'world_book_entries_list': {
      const rows = database
        .prepare(
          `SELECT id, world_book_id as worldBookId, title, content, is_enabled as isEnabled,
                  trigger_mode as triggerMode, created_at as createdAt, updated_at as updatedAt
           FROM world_book_entries WHERE world_book_id = ? ORDER BY id ASC`,
        )
        .all(args.worldBookId);
      return rows.map((r) => ({ ...r, isEnabled: !!r.isEnabled, keys: [] }));
    }

    case 'world_book_entries_upsert': {
      const now = Date.now();
      if (args.id) {
        database
          .prepare(
            `UPDATE world_book_entries SET title = ?, content = ?, is_enabled = ?, trigger_mode = ?, updated_at = ? WHERE id = ?`,
          )
          .run(args.title, args.content, args.isEnabled ? 1 : 0, args.triggerMode || 'any', now, args.id);
        return { ...args, updatedAt: now };
      } else {
        const info = database
          .prepare(
            `INSERT INTO world_book_entries (world_book_id, title, content, is_enabled, trigger_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(args.worldBookId, args.title, args.content, args.isEnabled !== false ? 1 : 0, args.triggerMode || 'any', now, now);
        return { ...args, id: Number(info.lastInsertRowid), createdAt: now, updatedAt: now };
      }
    }

    // ─── Settings ───
    case 'settings_get_all': {
      return database.prepare(`SELECT key, value FROM settings`).all();
    }

    case 'settings_get': {
      const row = database.prepare(`SELECT key, value FROM settings WHERE key = ?`).get(args.key);
      return row ? { key: row.key, value: row.value } : null;
    }

    case 'settings_set': {
      database
        .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
        .run(args.key, args.value);
      return { key: args.key, value: args.value };
    }

    // ─── Action Bridge Whitelist ───
    case 'action_bridge_whitelist_get': {
      const row = database.prepare(`SELECT value FROM settings WHERE key = 'action_bridge.command_whitelist'`).get();
      let commands = [];
      try {
        if (row && row.value) commands = JSON.parse(row.value);
      } catch (_) {}
      return { commands };
    }

    case 'action_bridge_whitelist_set': {
      const json = JSON.stringify(args.commands || []);
      database
        .prepare(`INSERT INTO settings (key, value) VALUES ('action_bridge.command_whitelist', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
        .run(json);
      return null;
    }

    // ─── Preset Schemas (M5 / L4) ───
    case 'preset_schemas_list': {
      const rows = database
        .prepare(
          `SELECT id, preset_id as presetId, name, description, retention_depth as retentionDepth,
                  fields_json as fieldsJson, card_json as cardJson, created_at as createdAt, updated_at as updatedAt
           FROM preset_schemas WHERE preset_id = ? ORDER BY id ASC`,
        )
        .all(args.presetId);
      return rows.map((r) => {
        let fields = [];
        let card = null;
        try {
          if (r.fieldsJson) fields = JSON.parse(r.fieldsJson);
          if (r.cardJson) card = JSON.parse(r.cardJson);
        } catch (_) {}
        return {
          id: r.id,
          presetId: r.presetId,
          name: r.name,
          description: r.description,
          retentionDepth: r.retentionDepth,
          fields,
          card,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };
      });
    }

    case 'preset_schema_get': {
      const r = database
        .prepare(
          `SELECT id, preset_id as presetId, name, description, retention_depth as retentionDepth,
                  fields_json as fieldsJson, card_json as cardJson, created_at as createdAt, updated_at as updatedAt
           FROM preset_schemas WHERE id = ?`,
        )
        .get(args.schemaId);
      if (!r) return null;
      let fields = [];
      let card = null;
      try {
        if (r.fieldsJson) fields = JSON.parse(r.fieldsJson);
        if (r.cardJson) card = JSON.parse(r.cardJson);
      } catch (_) {}
      return {
        id: r.id,
        presetId: r.presetId,
        name: r.name,
        description: r.description,
        retentionDepth: r.retentionDepth,
        fields,
        card,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    }

    case 'preset_schema_save': {
      const schema = args.schema;
      const now = Date.now();
      const fieldsJson = JSON.stringify(schema.fields || []);
      const cardJson = schema.card ? JSON.stringify(schema.card) : null;
      database
        .prepare(
          `INSERT INTO preset_schemas (id, preset_id, name, description, retention_depth, fields_json, card_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name, description = excluded.description, retention_depth = excluded.retention_depth,
             fields_json = excluded.fields_json, card_json = excluded.card_json, updated_at = excluded.updated_at`,
        )
        .run(
          schema.id,
          schema.presetId,
          schema.name,
          schema.description || '',
          schema.retentionDepth || null,
          fieldsJson,
          cardJson,
          now,
          now,
        );
      return schema;
    }

    case 'preset_schema_delete': {
      database.prepare(`DELETE FROM preset_schemas WHERE id = ?`).run(args.schemaId);
      return null;
    }

    case 'preset_schema_reorder_fields': {
      const { schemaId, fieldNames = [] } = args;
      const schema = handleCommand('preset_schema_get', { schemaId });
      if (!schema) throw new Error(`Schema ${schemaId} not found`);
      const fieldMap = new Map((schema.fields || []).map((f) => [f.name, f]));
      const reordered = [];
      for (const name of fieldNames) {
        if (fieldMap.has(name)) {
          reordered.push(fieldMap.get(name));
          fieldMap.delete(name);
        }
      }
      for (const f of fieldMap.values()) {
        reordered.push(f);
      }
      schema.fields = reordered;
      return handleCommand('preset_schema_save', { schema });
    }

    // ─── UI Layouts (M3 / M4) ───
    case 'preset_ui_layout_list': {
      const rows = database
        .prepare(
          `SELECT id, preset_id, name, mount_type, theme, custom_css,
                  layout_json, created_at, updated_at
           FROM preset_ui_layouts WHERE preset_id = ? ORDER BY id ASC`,
        )
        .all(args.presetId);
      return rows.map(rowToUiLayoutDef);
    }

    case 'preset_ui_layout_get': {
      const layoutId = args.layoutId || args.id;
      const row = database
        .prepare(
          `SELECT id, preset_id, name, mount_type, theme, custom_css,
                  layout_json, created_at, updated_at
           FROM preset_ui_layouts WHERE id = ?`,
        )
        .get(layoutId);
      if (!row) throw new Error(`未找到 UI 布局 ID: ${layoutId}`);
      return rowToUiLayoutDef(row);
    }

    case 'preset_ui_layout_save': {
      const layout = args.layout;
      const now = Date.now();
      const id = layout.id || `uil_${Date.now().toString(16)}_${Math.floor(Math.random() * 1000).toString(16)}`;
      const mountStr = mapMountTypeToDb(layout.mountType);
      const layoutJson = JSON.stringify(
        layout.rootContainer || {
          id: 'root',
          kind: 'rootCanvas',
          layoutMode: 'flex',
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          children: [],
        },
      );
      database
        .prepare(
          `INSERT INTO preset_ui_layouts (id, preset_id, name, mount_type, theme, custom_css, layout_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name, mount_type = excluded.mount_type, theme = excluded.theme,
             custom_css = excluded.custom_css, layout_json = excluded.layout_json, updated_at = excluded.updated_at`,
        )
        .run(
          id,
          layout.presetId,
          layout.name,
          mountStr,
          layout.theme || 'xuanqing',
          layout.customCss || '',
          layoutJson,
          now,
          now,
        );
      return { ...layout, id, mountType: mapMountTypeToFrontend(mountStr) };
    }

    case 'preset_ui_layout_delete': {
      database.prepare(`DELETE FROM preset_ui_layouts WHERE id = ?`).run(args.layoutId);
      return null;
    }

    case 'preset_ui_layout_activate': {
      const sessionId = args.sessionId;
      const layoutId = args.layoutId;
      const layout = handleCommand('preset_ui_layout_get', { layoutId });
      const now = Date.now();
      database
        .prepare(
          `INSERT INTO session_ui_layouts (session_id, layout_id, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET layout_id = excluded.layout_id, updated_at = excluded.updated_at`,
        )
        .run(sessionId, layoutId, now);
      return layout;
    }

    case 'preset_ui_layout_for_conversation': {
      const convId = args.conversationId;
      const bound = database
        .prepare(`SELECT layout_id FROM session_ui_layouts WHERE session_id = ? LIMIT 1`)
        .get(convId);
      if (bound && bound.layout_id) {
        return handleCommand('preset_ui_layout_get', { layoutId: bound.layout_id });
      }
      const conv = database.prepare(`SELECT preset_id FROM conversations WHERE id = ?`).get(convId);
      if (conv && conv.preset_id) {
        const firstLayout = database
          .prepare(`SELECT id FROM preset_ui_layouts WHERE preset_id = ? ORDER BY id ASC LIMIT 1`)
          .get(conv.preset_id);
        if (firstLayout) {
          handleCommand('preset_ui_layout_activate', { sessionId: convId, layoutId: firstLayout.id });
          return handleCommand('preset_ui_layout_get', { layoutId: firstLayout.id });
        }
      }
      throw new Error(`会话 ${convId} 尚未绑定常驻 HUD 布局；请在预设详情页的「UI 设计器」里创建布局并绑定`);
    }

    case 'session_ui_layout_get': {
      const sessionId = args.sessionId;
      const row = database
        .prepare(
          `SELECT su.session_id as sessionId, su.layout_id as layoutId, pu.name, pu.mount_type as mountType,
                  pu.theme, pu.custom_css as customCss, pu.layout_json as layoutJson
           FROM session_ui_layouts su
           LEFT JOIN preset_ui_layouts pu ON su.layout_id = pu.id
           WHERE su.session_id = ?`,
        )
        .get(sessionId);
      if (!row) return null;
      return {
        id: row.layoutId,
        name: row.name,
        mountType: mapMountTypeToFrontend(row.mountType),
        theme: row.theme,
        customCss: row.customCss,
        layoutJson: row.layoutJson,
      };
    }

    case 'session_ui_layout_bind': {
      return handleCommand('preset_ui_layout_activate', { sessionId: args.sessionId, layoutId: args.layoutId });
    }

    // ─── DataContainer / GameState (L1 / M2) ───
    case 'session_game_state_get':
    case 'session_state_get':
    case 'session_state_raw': {
      const sessionId = args.sessionId || args.conversationId;
      const row = database.prepare(`SELECT state_json FROM session_states WHERE session_id = ?`).get(sessionId);
      if (row && row.state_json) {
        try {
          return JSON.parse(row.state_json);
        } catch (_) {}
      }
      return {
        stats: { hp: 100, max_hp: 100, mp: 50, max_mp: 50, gold: 10, weight: 3, max_weight: 50 },
        inventory: [
          { id: 'item_1', name: '铁铸长剑', count: 1, unitWeight: 2.5, unitPrice: 50, icon: '🗡️' },
          { id: 'item_2', name: '微光治疗药剂', count: 2, unitWeight: 0.25, unitPrice: 20, icon: '🧪' },
        ],
        flags: {},
        scratchpad: {},
      };
    }

    case 'session_game_state_save': {
      const sessionId = args.sessionId || args.conversationId;
      const state = args.data || args.state;
      const now = Date.now();
      database
        .prepare(
          `INSERT INTO session_states (session_id, state_json, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
        )
        .run(sessionId, JSON.stringify(state), now);
      return null;
    }

    case 'session_game_state_reset': {
      const sessionId = args.sessionId || args.conversationId;
      const initial = {
        stats: { hp: 100, max_hp: 100, mp: 50, max_mp: 50, gold: 10, weight: 3, max_weight: 50 },
        inventory: [
          { id: 'item_1', name: '铁铸长剑', count: 1, unitWeight: 2.5, unitPrice: 50, icon: '🗡️' },
          { id: 'item_2', name: '微光治疗药剂', count: 2, unitWeight: 0.25, unitPrice: 20, icon: '🧪' },
        ],
        flags: {},
        scratchpad: {},
      };
      database
        .prepare(
          `INSERT INTO session_states (session_id, state_json, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
        )
        .run(sessionId, JSON.stringify(initial), Date.now());
      return initial;
    }

    case 'session_tool_call_execute': {
      const sessionId = args.sessionId || 35;
      const toolName = args.toolName;
      let parsedArgs = {};
      try {
        if (args.argumentsJson) parsedArgs = JSON.parse(args.argumentsJson);
      } catch (_) {}
      return handleCommand('action_bridge_invoke', {
        command: toolName,
        args: parsedArgs,
        conversationId: sessionId,
      });
    }

    case 'mcp_tool_names': {
      return [
        { name: 'buy_item', description: '向商店购买指定道具（触发金币充足门禁校验与原子扣除）' },
        { name: 'check_inventory', description: '查看角色背包中的所有物品道具清单、金币与负重' },
        { name: 'get_character_detail', description: '获取当前NPC角色的详细外貌、身份与背景资料' },
        { name: 'query_world_book_entries', description: '检索当前世界书中包含的所有设定条目与词条知识' },
        { name: 'create_world_book_entry', description: '向当前世界书新增一条设定词条并落库' },
      ];
    }

    case 'agent_dice_roll': {
      const { skill = 'athletics', dc = 12, modifier = 2 } = args;
      const d20 = Math.floor(Math.random() * 20) + 1;
      const total = d20 + modifier;
      const isSuccess = total >= dc;
      return {
        skill,
        d20Roll: d20,
        modifier,
        total,
        dc,
        isSuccess,
        isCriticalSuccess: d20 === 20,
        isCriticalFailure: d20 === 1,
        formula: `1d20(${d20}) + ${modifier} = ${total} (vs DC ${dc})`,
        summary: isSuccess ? `检定成功！(${total} >= ${dc})` : `检定失败！(${total} < ${dc})`,
      };
    }

    case 'agent_validate_banned_words': {
      return null;
    }

    case 'round_state_get': {
      return { status: 'completed' };
    }

    case 'plot_summaries_list': {
      return [];
    }

    case 'get_conversation_token_usage': {
      return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    }

    case 'room_get_guest_history': {
      return [];
    }

    case 'plugin:window|is_maximized': {
      return false;
    }

    // ─── Blueprints ───
    case 'blueprint_get': {
      const row = database.prepare(`SELECT blueprint_graph FROM presets WHERE id = ?`).get(args.presetId);
      return row && row.blueprint_graph ? row.blueprint_graph : null;
    }

    case 'blueprint_save': {
      database
        .prepare(`UPDATE presets SET blueprint_graph = ?, updated_at = ? WHERE id = ?`)
        .run(args.graphJson, Date.now(), args.presetId);
      return null;
    }

    // ─── Action Bridge Invoke (L3 / M4 / C2) ───
    case 'action_bridge_invoke': {
      const cmdName = args.command;
      const cmdArgs = args.args || {};

      // 1. 白名单检查（C2 约束：未注册严格显式报错）
      const whitelistRow = database.prepare(`SELECT value FROM settings WHERE key = 'action_bridge.command_whitelist'`).get();
      let whitelist = [];
      try {
        if (whitelistRow && whitelistRow.value) whitelist = JSON.parse(whitelistRow.value);
      } catch (_) {}

      if (!whitelist.includes(cmdName)) {
        throw new Error(`命令 ${cmdName} 未在动作白名单注册（当前白名单: [${whitelist.join(', ')}]）`);
      }

      // 2. 命令路由
      if (cmdName === 'get_character_detail') {
        return {
          name: '老矮人格罗姆',
          role: '黑铁酒馆掌柜兼传奇锻造大师',
          desc: '胡子扎着三个精钢铁环，腰间别着沉重的矮人锻造锤。',
        };
      }

      if (cmdName === 'create_world_book_entry') {
        const now = Date.now();
        const worldBookId = 1;
        const info = database
          .prepare(
            `INSERT INTO world_book_entries (world_book_id, title, content, is_enabled, trigger_mode, created_at, updated_at)
             VALUES (?, ?, ?, 1, 'any', ?, ?)`,
          )
          .run(worldBookId, cmdArgs.title || '新人物档案', cmdArgs.content || '', now, now);
        return { entryId: Number(info.lastInsertRowid), title: cmdArgs.title, status: 'created' };
      }

      if (cmdName === 'query_world_book_entries') {
        const rows = database.prepare(`SELECT id, title, content FROM world_book_entries LIMIT 10`).all();
        return rows;
      }

      if (cmdName === 'buy_item') {
        const sessionId = args.conversationId || 35;
        const row = database.prepare(`SELECT state_json FROM session_states WHERE session_id = ?`).get(sessionId);
        let state = {
          stats: { hp: 100, max_hp: 100, mp: 50, max_mp: 50, gold: 10, weight: 3, max_weight: 50 },
          inventory: [],
          flags: {},
          scratchpad: {},
        };
        if (row && row.state_json) {
          try {
            state = JSON.parse(row.state_json);
          } catch (_) {}
        }

        const unitPrice = parseFloat(cmdArgs.unit_price ?? '50');
        const count = parseInt(cmdArgs.count ?? '1', 10);
        const totalCost = unitPrice * count;
        const unitWeight = parseFloat(cmdArgs.unit_weight ?? '2');

        // ConditionGate 金币充足门禁（确定性判定）
        if (state.stats.gold < totalCost) {
          throw new Error(`交易失败: 金币不足！需要 ${totalCost} 金币，当前仅有 ${state.stats.gold} 金币`);
        }

        // 放行：原子扣款与加道具
        state.stats.gold -= totalCost;
        state.stats.weight = (state.stats.weight || 0) + unitWeight * count;
        state.inventory.push({
          id: cmdArgs.item_id || 'item_' + Date.now(),
          name: cmdArgs.name || cmdArgs.item_id || '新道具',
          count,
          unitWeight,
          unitPrice,
          icon: '🗡️',
          properties: {},
        });

        // 真实写回 SQLite
        database
          .prepare(
            `INSERT INTO session_states (session_id, state_json, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(session_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
          )
          .run(sessionId, JSON.stringify(state), Date.now());

        return `购买成功！扣除 ${totalCost} 金币，已获得道具*${count}，当前金币: ${state.stats.gold}G，当前负重: ${state.stats.weight}/${state.stats.max_weight}kg`;
      }

      if (cmdName === 'check_inventory') {
        const sessionId = args.conversationId || 35;
        const row = database.prepare(`SELECT state_json FROM session_states WHERE session_id = ?`).get(sessionId);
        let state = { stats: {}, inventory: [] };
        if (row && row.state_json) {
          try {
            state = JSON.parse(row.state_json);
          } catch (_) {}
        }
        const invList = (state.inventory || []).map((i) => `${i.name}*${i.count}`).join('、') || '空';
        return `【背包清单】物品: ${invList}；金币: ${state.stats.gold || 0}G；负重: ${state.stats.weight || 0}kg`;
      }

      return { ok: true, command: cmdName, args: cmdArgs };
    }

    default:
      console.warn(`[SqliteBridge] 未实现指令: ${cmd}`);
      return null;
  }
}
