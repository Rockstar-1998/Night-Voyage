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

// ─── DataContainer Defaults & Helpers (Agnostic Blueprint Engine) ───
function defaultDataContainer() {
  return {
    stats: {
      hp: 100,
      max_hp: 100,
      mp: 50,
      max_mp: 50,
      gold: 100,
      weight: 0,
      max_weight: 50,
    },
    inventory: [],
    flags: {},
    scratchpad: {},
  };
}

function getStat(state, name) {
  const key = name.startsWith('stats.') ? name.slice(6) : name;
  return typeof state.stats[key] === 'number' ? state.stats[key] : (parseFloat(state.stats[key]) || 0);
}

function setStat(state, name, val) {
  const key = name.startsWith('stats.') ? name.slice(6) : name;
  state.stats[key] = val;
}

function totalWeight(state) {
  return (state.inventory || []).reduce((sum, item) => sum + (Number(item.count) || 0) * (Number(item.unitWeight) || 0), 0);
}

function syncWeight(state) {
  const w = totalWeight(state);
  setStat(state, 'weight', w);
  return w;
}

function stripEnclosingDelimiters(expr) {
  let s = String(expr).trim();
  while (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    const matches = (first === '(' && last === ')') || (first === '[' && last === ']');
    if (!matches) break;
    let depth = 0;
    let fullyEnclosed = true;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '(' || ch === '[') {
        depth++;
      } else if (ch === ')' || ch === ']') {
        depth--;
        if (depth === 0 && i < s.length - 1) {
          fullyEnclosed = false;
          break;
        }
      }
    }
    if (fullyEnclosed && depth === 0) {
      s = s.slice(1, -1).trim();
    } else {
      break;
    }
  }
  return s;
}

function splitBinary(expr, ops) {
  let depth = 0;
  for (let i = expr.length - 1; i >= 1; i--) {
    const ch = expr[i];
    if (ch === ')' || ch === ']') {
      depth++;
      continue;
    }
    if (ch === '(' || ch === '[') {
      depth--;
      continue;
    }
    if (depth === 0 && ops.includes(ch)) {
      const left = expr.slice(0, i).trimEnd();
      if (!left) continue;
      const lastChar = left[left.length - 1];
      if (!/[a-zA-Z0-9_\])]/.test(lastChar)) continue;
      const right = expr.slice(i + 1).trim();
      if (!right) continue;
      return { left, op: ch, right };
    }
  }
  return null;
}

function isRelationalOp(op) {
  return ['>=', '<=', '==', '!=', '>', '<', '='].includes(String(op).trim());
}

function findRelationalOp(expr) {
  const s = stripEnclosingDelimiters(expr);
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '[') {
      depth++;
      continue;
    }
    if (ch === ')' || ch === ']') {
      depth--;
      continue;
    }
    if (depth === 0) {
      if (i + 1 < s.length) {
        const two = s.slice(i, i + 2);
        if (['>=', '<=', '==', '!='].includes(two)) {
          const left = s.slice(0, i).trim();
          const right = s.slice(i + 2).trim();
          if (left && right) return { left, op: two, right };
        }
      }
      if (ch === '>' || ch === '<') {
        if (i + 1 >= s.length || s[i + 1] !== '=') {
          const left = s.slice(0, i).trim();
          const right = s.slice(i + 1).trim();
          if (left && right) return { left, op: ch, right };
        }
      }
    }
  }
  return null;
}

function compareRelational(op, left, right) {
  const EPS = 1e-9;
  switch (String(op).trim()) {
    case '>=': return left >= right || Math.abs(left - right) < EPS;
    case '<=': return left <= right || Math.abs(left - right) < EPS;
    case '==':
    case '=': return Math.abs(left - right) < EPS;
    case '!=': return Math.abs(left - right) >= EPS;
    case '>': return left > right + EPS;
    case '<': return left < right - EPS;
    default: throw new Error(`不支持的关系运算符: \`${op}\``);
  }
}

function resolveOperand(expr, args = {}, state = { stats: {} }) {
  const trimmed = stripEnclosingDelimiters(expr);
  if (!trimmed) throw new Error('操作数表达式为空');

  // 二元运算符优先级：先 + -，再 * / %
  const precedence = [['+', '-'], ['*', '/', '%']];
  for (const ops of precedence) {
    const split = splitBinary(trimmed, ops);
    if (split) {
      const l = resolveOperand(split.left, args, state);
      const r = resolveOperand(split.right, args, state);
      switch (split.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/':
          if (r === 0) throw new Error('除数不可为零');
          return l / r;
        case '%':
          if (r === 0) throw new Error('模运算除数不可为零');
          return l % r;
        default: throw new Error(`不支持的运算符: ${split.op}`);
      }
    }
  }

  const num = Number(trimmed);
  if (!Number.isNaN(num) && /^-?\d+(\.\d+)?$/.test(trimmed)) {
    return num;
  }

  if (trimmed === 'd20') {
    return Math.floor(Math.random() * 20) + 1;
  }
  if (trimmed === 'slots') {
    return (state.inventory || []).length;
  }
  if (trimmed === 'weight' || trimmed === 'total_weight') {
    if (state && state.stats && state.stats[trimmed] !== undefined) {
      return getStat(state, trimmed);
    }
    return totalWeight(state);
  }

  const getArgNum = (k) => {
    if (args && args[k] !== undefined && args[k] !== null) {
      const v = Number(args[k]);
      if (!Number.isNaN(v)) return v;
      throw new Error(`参数 \`${k}\` 不是数值`);
    }
    return null;
  };

  if (trimmed.startsWith('args.')) {
    const k = trimmed.slice(5).trim();
    const val = getArgNum(k);
    if (val === null) throw new Error(`操作数或变量 \`${trimmed}\` 未定义（参数 \`${k}\` 不存在）`);
    return val;
  }
  if (trimmed.startsWith('stats.')) {
    const k = trimmed.slice(6).trim();
    if (state && state.stats && state.stats[k] !== undefined) {
      return getStat(state, k);
    }
    throw new Error(`操作数或变量 \`${trimmed}\` 未定义（属性 \`${k}\` 不存在）`);
  }
  if (trimmed.startsWith('inventory.')) {
    const k = trimmed.slice(10).trim();
    if (['len', 'length', 'count', 'slots'].includes(k)) {
      return (state.inventory || []).length;
    }
    if (['weight', 'total_weight'].includes(k)) {
      return totalWeight(state);
    }
    throw new Error(`操作数或变量 \`${trimmed}\` 未定义（inventory 属性 \`${k}\` 不存在，支持 len / weight）`);
  }
  if (trimmed.includes('.')) {
    throw new Error(`操作数或变量 \`${trimmed}\` 未定义（不支持的前缀，仅支持 args / stats / inventory）`);
  }

  const aVal = getArgNum(trimmed);
  if (aVal !== null) return aVal;
  if (state && state.stats && state.stats[trimmed] !== undefined) {
    return getStat(state, trimmed);
  }
  throw new Error(`操作数或变量 \`${trimmed}\` 未定义`);
}

function resolveDotted(path, obj) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    const part = p.trim();
    if (!part || cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}

function stringifyValue(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) {
    return val.map(stringifyValue).join('\n');
  }
  if (typeof val === 'object') {
    return Object.entries(val).map(([k, v]) => `${k}: ${stringifyValue(v)}`).join('\n');
  }
  return String(val);
}

function renderTemplate(template, ctx) {
  if (!template) return '';
  return template.replace(/\{([^{}]+)\}/g, (match, key) => {
    const trimmed = key.trim();
    const resolved = resolveDotted(trimmed, ctx);
    if (resolved !== undefined) {
      return stringifyValue(resolved);
    }
    if (ctx && ctx.args && ctx.args[trimmed] !== undefined) {
      return stringifyValue(ctx.args[trimmed]);
    }
    if (ctx && ctx.stats && ctx.stats[trimmed] !== undefined) {
      return stringifyValue(ctx.stats[trimmed]);
    }
    if (ctx && (ctx.args || ctx.stats)) {
      try {
        const val = resolveOperand(trimmed, ctx.args || {}, { stats: ctx.stats || {} });
        return stringifyValue(val);
      } catch (_) {}
    }
    throw new Error(`模板占位符 \`${trimmed}\` 无法解析`);
  });
}

function renderArgsTemplate(template, ctx) {
  if (typeof template === 'string') {
    return renderTemplate(template, ctx);
  }
  if (Array.isArray(template)) {
    return template.map((item) => renderArgsTemplate(item, ctx));
  }
  if (template && typeof template === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(template)) {
      out[k] = renderArgsTemplate(v, ctx);
    }
    return out;
  }
  return template;
}

function validateArgsAgainstSchema(args, schemaStr, toolName) {
  if (!schemaStr) return;
  let schema;
  try {
    schema = typeof schemaStr === 'string' ? JSON.parse(schemaStr) : schemaStr;
  } catch (e) {
    throw new Error(`契约 ${toolName} 的 parameters_schema 不是合法 JSON: ${e.message}`);
  }
  if (!schema || typeof schema !== 'object') {
    throw new Error(`契约 ${toolName} 的 parameters_schema 必须是 JSON 对象`);
  }

  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const field of required) {
    if (args[field] === undefined || args[field] === null) {
      throw new Error(`ToolCall \`${toolName}\` 缺少必填参数 \`${field}\`（契约 required: ${required.join(', ')}）`);
    }
  }

  if (schema.properties && typeof schema.properties === 'object') {
    for (const [field, spec] of Object.entries(schema.properties)) {
      if (args[field] === undefined || args[field] === null) continue;
      const val = args[field];
      const expected = spec.type;
      let ok = true;
      if (expected === 'string') ok = typeof val === 'string';
      else if (expected === 'number') ok = typeof val === 'number' && !Number.isNaN(val);
      else if (expected === 'integer') ok = Number.isInteger(Number(val));
      else if (expected === 'boolean') ok = typeof val === 'boolean';
      else if (expected === 'array') ok = Array.isArray(val);
      else if (expected === 'object') ok = typeof val === 'object' && val !== null && !Array.isArray(val);

      if (!ok) {
        throw new Error(`ToolCall \`${toolName}\` 的参数 \`${field}\` 类型应为 ${expected}，实际为 ${typeof val}`);
      }
    }
  }
}

function getNextNodeId(graph, sourceId, portName) {
  const edge = (graph.edges || []).find((e) => {
    const s = e.source || e.source_node_id;
    const sp = e.sourcePort || e.source_port || e.sourceHandle || e.port;
    return s === sourceId && (!portName || sp === portName);
  });
  return edge ? (edge.target || edge.target_node_id) : null;
}

function executeBlueprintToolPlan(database, sessionId, graph, toolName, parsedArgs) {
  // 1. 定位 ToolDefinition 节点
  const defNode = (graph.nodes || []).find((n) => {
    const cfg = n.config || n;
    const type = (n.type || cfg.type || '').toLowerCase();
    const name = cfg.tool_name || cfg.toolName || n.tool_name || n.toolName;
    return (type === 'tool_definition' || type === 'tooldefinition') && name === toolName;
  });

  if (!defNode) {
    throw new Error(`蓝图未定义契约「${toolName}」——当前会话预设的蓝图中没有该 ToolDefinition 链。请在蓝图中定义该契约后重试。`);
  }

  const defCfg = defNode.config || defNode;

  // 2. 参数 Schema 校验
  if (defCfg.parameters_schema || defCfg.parametersSchema) {
    validateArgsAgainstSchema(parsedArgs, defCfg.parameters_schema || defCfg.parametersSchema, toolName);
  }

  // 3. 收集步骤链
  const steps = [];
  let successReturn = null;
  let curId = getNextNodeId(graph, defNode.id, 'out');
  let hops = 0;
  while (curId && hops < 64) {
    hops++;
    const node = (graph.nodes || []).find((n) => n.id === curId);
    if (!node) break;
    const cfg = node.config || node;
    const type = (node.type || cfg.type || '').toLowerCase();

    if (type === 'calculator') {
      steps.push({ kind: 'Calculate', config: cfg });
      curId = getNextNodeId(graph, curId, 'out');
    } else if (type === 'condition_gate' || type === 'conditiongate') {
      steps.push({ kind: 'Gate', config: cfg });
      curId = getNextNodeId(graph, curId, 'pass');
    } else if (type === 'inspector') {
      steps.push({ kind: 'Inspect', config: cfg });
      curId = getNextNodeId(graph, curId, 'out');
    } else if (type === 'querier') {
      steps.push({ kind: 'Query', config: cfg });
      curId = getNextNodeId(graph, curId, 'out');
    } else if (type === 'writer') {
      steps.push({ kind: 'Write', config: cfg });
      curId = getNextNodeId(graph, curId, 'out');
    } else if (type === 'tool_return' || type === 'toolreturn') {
      successReturn = cfg;
      break;
    } else {
      throw new Error(`工具链到达非法节点类型 \`${type}\` (node: ${curId})；工具链仅允许 calculator / condition_gate / inspector / querier / writer / tool_return`);
    }
  }

  // 4. 读取会话当前游戏状态
  const row = database.prepare(`SELECT state_json FROM session_states WHERE session_id = ?`).get(sessionId);
  let state = defaultDataContainer();
  if (row && row.state_json) {
    try {
      state = JSON.parse(row.state_json);
      if (!state.stats) state.stats = {};
      if (!Array.isArray(state.inventory)) state.inventory = [];
      if (!state.flags) state.flags = {};
      if (!state.scratchpad) state.scratchpad = {};
    } catch (_) {
      state = defaultDataContainer();
    }
  }

  const initialStats = { ...(state.stats || {}) };
  const ctx = {
    tool_name: toolName,
    result: '执行成功',
    mutated_stats: {},
    args: parsedArgs,
    stats: state.stats,
    inspect: null,
    query: null,
  };

  // 5. 顺序执行步骤
  for (const step of steps) {
    const cfg = step.config;
    switch (step.kind) {
      case 'Inspect': {
        const inspectKind = cfg.inspect_kind || cfg.inspectKind || 'inventory';
        switch (inspectKind) {
          case 'inventory': {
            ctx.inspect = {
              items: state.inventory,
              total_weight: totalWeight(state),
              max_weight: getStat(state, 'max_weight'),
              gold: getStat(state, 'gold'),
            };
            break;
          }
          case 'stats': {
            ctx.inspect = { ...state.stats };
            break;
          }
          case 'item': {
            const keyExpr = cfg.key_expr || cfg.keyExpr || '';
            const resolvedKey = renderTemplate(keyExpr, { args: parsedArgs, stats: state.stats, inspect: ctx.inspect, query: ctx.query }) || keyExpr;
            const found = (state.inventory || []).find((i) => i.id === resolvedKey);
            if (!found) {
              throw new Error(`【查看失败】：背包中未找到 ID 为 [${resolvedKey}] 的物品`);
            }
            ctx.inspect = {
              id: found.id,
              name: found.name,
              count: found.count,
              unit_weight: found.unitWeight,
              unit_price: found.unitPrice,
            };
            break;
          }
          case 'scratchpad': {
            const keyExpr = cfg.key_expr || cfg.keyExpr || '';
            const resolvedKey = renderTemplate(keyExpr, { args: parsedArgs, stats: state.stats, inspect: ctx.inspect, query: ctx.query }) || keyExpr;
            const content = state.scratchpad ? state.scratchpad[resolvedKey] : undefined;
            if (content === undefined) {
              throw new Error(`工作区变量 \`${resolvedKey}\` 不存在`);
            }
            ctx.inspect = { key: resolvedKey, content };
            break;
          }
          default:
            throw new Error(`未知的 inspect_kind \`${inspectKind}\`（支持 inventory / stats / item / scratchpad）`);
        }
        break;
      }

      case 'Query': {
        const renderedArgs = renderArgsTemplate(cfg.args_template || cfg.argsTemplate || {}, {
          args: parsedArgs,
          stats: state.stats,
          inspect: ctx.inspect,
          query: ctx.query,
        });
        const queryResult = handleCommand('action_bridge_invoke', {
          command: cfg.command,
          args: renderedArgs,
          conversationId: sessionId,
        });
        ctx.query = queryResult;
        break;
      }

      case 'Gate': {
        const gateType = (cfg.gate_type || cfg.gateType || '').trim();
        const expression = (cfg.expression || '').trim();
        let passed = false;

        const exprRel = findRelationalOp(expression);
        const gateRel = findRelationalOp(gateType);

        if (exprRel) {
          const left = resolveOperand(exprRel.left, parsedArgs, state);
          const right = resolveOperand(exprRel.right, parsedArgs, state);
          passed = compareRelational(exprRel.op, left, right);
        } else if (gateRel) {
          const left = resolveOperand(gateRel.left, parsedArgs, state);
          const right = resolveOperand(gateRel.right, parsedArgs, state);
          passed = compareRelational(gateRel.op, left, right);
        } else if (isRelationalOp(gateType)) {
          let left;
          if (parsedArgs && parsedArgs.stat) {
            if (!state.stats || state.stats[parsedArgs.stat] === undefined) {
              throw new Error(`门禁判定缺少必需属性 \`${parsedArgs.stat}\``);
            }
            left = getStat(state, parsedArgs.stat);
          } else if (parsedArgs && parsedArgs.left !== undefined) {
            left = typeof parsedArgs.left === 'string' ? resolveOperand(parsedArgs.left, parsedArgs, state) : Number(parsedArgs.left);
          } else {
            throw new Error(`操作符门禁 \`${gateType}\` 缺少左操作数（需在 args 提供 stat 或 left）`);
          }
          const right = resolveOperand(expression || '0', parsedArgs, state);
          passed = compareRelational(gateType, left, right);
        } else {
          // 命名门禁与已知类型
          const threshold = resolveOperand(expression || '0', parsedArgs, state);
          if (gateType === 'gold') {
            if (!state.stats || state.stats.gold === undefined) {
              throw new Error('门禁判定缺少必需属性 `gold`');
            }
            passed = getStat(state, 'gold') >= threshold;
          } else if (gateType === 'weight') {
            if (!state.stats || state.stats.max_weight === undefined) {
              throw new Error('门禁判定缺少必需属性 `max_weight`');
            }
            passed = totalWeight(state) + threshold <= getStat(state, 'max_weight');
          } else if (gateType === 'slots') {
            passed = (state.inventory || []).length < threshold;
          } else if (gateType === 'd20') {
            const d20 = Math.floor(Math.random() * 20) + 1;
            const modifier = Number(parsedArgs.modifier) || 0;
            passed = (d20 + modifier) >= threshold;
          } else if (state.stats && state.stats[gateType] !== undefined) {
            passed = getStat(state, gateType) >= threshold;
          } else {
            throw new Error(`未知的门禁判定类型: ${gateType}`);
          }
        }

        if (!passed) {
          const reason = (cfg.block_reason || cfg.blockReason || '').trim() ||
            `【门禁拦截 - ${gateType}】判定未通过（表达式 \`${expression}\`）`;
          throw new Error(reason);
        }
        break;
      }

      case 'Calculate': {
        const op = cfg.op || 'set';
        if (op === 'add_item') {
          const item = {
            id: String(parsedArgs.item_id || cfg.item_id || ('item_' + Date.now())),
            name: String(parsedArgs.name || cfg.name || parsedArgs.item_id || '物品'),
            count: Number(parsedArgs.count ?? cfg.count ?? 1),
            unitWeight: Number(parsedArgs.unit_weight ?? cfg.unit_weight ?? 0),
            unitPrice: Number(parsedArgs.unit_price ?? cfg.unit_price ?? 0),
            icon: cfg.icon || '🗡️',
            properties: cfg.properties || {},
          };
          const existing = state.inventory.find((i) => i.id === item.id);
          if (existing) {
            existing.count += item.count;
          } else {
            state.inventory.push(item);
          }
          syncWeight(state);
        } else if (op === 'remove_item') {
          const itemId = String(parsedArgs.item_id || cfg.item_id || '');
          const count = Math.round(resolveOperand(cfg.operand_a || 'count', parsedArgs, state));
          const idx = state.inventory.findIndex((i) => i.id === itemId);
          if (idx === -1) throw new Error(`背包中不存在物品 ID: ${itemId}`);
          if (state.inventory[idx].count < count) {
            throw new Error(`物品 [${state.inventory[idx].name}] 数量不足！当前持有: ${state.inventory[idx].count}，尝试扣减: ${count}`);
          }
          state.inventory[idx].count -= count;
          if (state.inventory[idx].count === 0) {
            state.inventory.splice(idx, 1);
          }
          syncWeight(state);
        } else if (op === 'recompute_weight') {
          syncWeight(state);
        } else {
          const target = (cfg.target || '').replace(/^stats\./, '');
          const operand = resolveOperand(cfg.operand_a, parsedArgs, state);
          const cur = getStat(state, target);
          let newVal;
          switch (op) {
            case '+': case 'add': newVal = cur + operand; break;
            case '-': case 'sub': newVal = cur - operand; break;
            case '*': case 'mul': newVal = cur * operand; break;
            case '/':
              if (operand === 0) throw new Error('除数不可为零');
              newVal = cur / operand;
              break;
            case 'set': newVal = operand; break;
            default: throw new Error(`不支持的运算操作符: ${op}`);
          }
          setStat(state, target, newVal);
        }
        break;
      }

      case 'Write': {
        const key = renderTemplate(cfg.key_expr || cfg.keyExpr || '', {
          tool_name: toolName,
          result: '执行成功',
          args: parsedArgs,
          stats: state.stats,
          inspect: ctx.inspect,
          query: ctx.query,
        }).trim();
        if (!key) throw new Error('Writer 节点的 key_expr 渲染结果为空，拒绝写入（C2）');
        const value = renderTemplate(cfg.value_template || cfg.valueTemplate || '', {
          tool_name: toolName,
          result: '执行成功',
          args: parsedArgs,
          stats: state.stats,
          inspect: ctx.inspect,
          query: ctx.query,
        });
        state.scratchpad[key] = value;
        break;
      }
    }
  }

  // 收集执行过程中的属性变更，供 {mutated_stats} 占位符引用
  const mutatedStats = {};
  for (const [k, v] of Object.entries(state.stats || {})) {
    if (initialStats[k] !== v) {
      mutatedStats[k] = v;
    }
  }
  ctx.mutated_stats = mutatedStats;

  // 6. 持久化写回 SQLite
  database
    .prepare(
      `INSERT INTO session_states (session_id, state_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
    )
    .run(sessionId, JSON.stringify(state), Date.now());

  // 7. 回执装配
  if (successReturn && (successReturn.return_template || successReturn.returnTemplate)) {
    const tpl = (successReturn.return_template || successReturn.returnTemplate).trim();
    if (tpl) {
      return renderTemplate(tpl, {
        tool_name: toolName,
        result: '执行成功',
        mutated_stats: mutatedStats,
        args: parsedArgs,
        stats: state.stats,
        inspect: ctx.inspect,
        query: ctx.query,
      });
    }
  }

  if (steps.length === 0) {
    return `【${toolName}】参数校验通过（空链契约：仅注册校验，无容器变更）`;
  }
  return `【${toolName}】执行成功。`;
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

    case 'character_card_get': {
      const charId = args.id || args.characterId;
      const row = database
        .prepare(
          `SELECT id, name, card_type as cardType, image_path as imagePath, description,
                  created_at as createdAt, updated_at as updatedAt
           FROM character_cards WHERE id = ?`,
        )
        .get(charId);
      return row || null;
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
      return defaultDataContainer();
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
      const initial = defaultDataContainer();
      database
        .prepare(
          `INSERT INTO session_states (session_id, state_json, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
        )
        .run(sessionId, JSON.stringify(initial), Date.now());
      return initial;
    }

    case 'session_tool_call_execute': {
      const sessionId = args.sessionId || args.conversationId;
      if (!sessionId) {
        throw new Error('执行 ToolCall 必须指定 sessionId');
      }
      const toolName = args.toolName;
      if (!toolName) {
        throw new Error('执行 ToolCall 必须指定 toolName');
      }
      let parsedArgs = {};
      if (args.argumentsJson) {
        try {
          parsedArgs = typeof args.argumentsJson === 'string' ? JSON.parse(args.argumentsJson) : args.argumentsJson;
        } catch (e) {
          throw new Error(`ToolCall 参数不是合法 JSON（契约 ${toolName}）: ${e.message}`);
        }
      }

      const conv = database.prepare(`SELECT preset_id FROM conversations WHERE id = ?`).get(sessionId);
      if (!conv || !conv.preset_id) {
        throw new Error(`蓝图未定义契约「${toolName}」——当前会话 ${sessionId} 未绑定预设`);
      }

      const preset = database.prepare(`SELECT blueprint_graph FROM presets WHERE id = ?`).get(conv.preset_id);
      if (!preset || !preset.blueprint_graph) {
        throw new Error(`蓝图未定义契约「${toolName}」——当前预设 ${conv.preset_id} 未保存蓝图`);
      }

      let graph;
      try {
        graph = JSON.parse(preset.blueprint_graph);
      } catch (e) {
        throw new Error(`预设 ${conv.preset_id} 的蓝图 JSON 损坏: ${e.message}`);
      }

      return executeBlueprintToolPlan(database, sessionId, graph, toolName, parsedArgs);
    }

    case 'mcp_tool_names': {
      return [
        { name: 'nv_db_info', description: '报告本端点连接的 SQLite 库路径与关键表行数' },
        { name: 'nv_conversations_list', description: '列出库中全部会话' },
        { name: 'nv_session_state_raw', description: '读取 session_states.state_json 的原始字符串与长度' },
        { name: 'nv_session_state_get', description: '调用后端 load_session_state 解析会话状态' },
        { name: 'nv_tool_call_execute', description: '以指定参数执行一次 ToolCall 契约' },
        { name: 'nv_preset_gate_select', description: '切换或覆写会话在某个门禁节点上的选中分支' },
        { name: 'nv_session_state_reset', description: '重置会话状态为默认初始状态并广播' },
        { name: 'nv_messages_list', description: '读取指定会话的最近消息' },
        { name: 'nv_blueprint_get', description: '读取预设的蓝图图 JSON' },
        { name: 'nv_blueprint_save', description: '写回预设的蓝图图 JSON' },
        { name: 'nv_screenshot', description: '截取当前窗口' },
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
      const conversationId = args.conversationId || args.sessionId;

      // 1. 白名单检查（C2 约束：未注册严格显式报错）
      const whitelistRow = database.prepare(`SELECT value FROM settings WHERE key = 'action_bridge.command_whitelist'`).get();
      let whitelist = [];
      try {
        if (whitelistRow && whitelistRow.value) whitelist = JSON.parse(whitelistRow.value);
      } catch (_) {}

      if (!whitelist.includes(cmdName)) {
        throw new Error(`命令 \`${cmdName}\` 未在动作白名单注册（当前白名单: [${whitelist.join(', ')}]）；请在设置页登记后重试`);
      }

      // 2. 真实后端分发（真实查表，杜绝写死业务数据）
      switch (cmdName) {
        case 'get_character_detail': {
          let charId = cmdArgs.character_id;
          if (charId == null && conversationId) {
            const conv = database.prepare(`SELECT host_character_id FROM conversations WHERE id = ?`).get(conversationId);
            if (conv) charId = conv.host_character_id;
          }
          if (charId == null) {
            throw new Error('get_character_detail 缺少数值参数 character_id');
          }
          const card = database.prepare(`SELECT id, name, card_type as cardType, image_path as imagePath, description, created_at as createdAt, updated_at as updatedAt FROM character_cards WHERE id = ?`).get(charId);
          if (!card) {
            throw new Error(`未找到角色卡 (id: ${charId})`);
          }
          return card;
        }

        case 'create_world_book_entry': {
          if (!conversationId) {
            throw new Error('会话未绑定，无法创建条目');
          }
          const conv = database.prepare(`SELECT world_book_id FROM conversations WHERE id = ?`).get(conversationId);
          if (!conv || !conv.world_book_id) {
            throw new Error('会话未绑定世界书，无法创建条目');
          }
          const title = (cmdArgs.title || '').trim();
          const content = (cmdArgs.content || '').trim();
          if (!title) throw new Error('create_world_book_entry 缺少 title 参数');
          if (!content) throw new Error('create_world_book_entry 缺少 content 参数');

          const now = Date.now();
          const info = database
            .prepare(
              `INSERT INTO world_book_entries (world_book_id, title, content, trigger_mode, is_enabled, sort_order, created_at, updated_at)
               VALUES (?, ?, ?, 'any', 1, 0, ?, ?)`,
            )
            .run(conv.world_book_id, title, content, now, now);
          return {
            entryId: Number(info.lastInsertRowid),
            worldBookId: conv.world_book_id,
            title,
            content,
          };
        }

        case 'query_world_book_entries': {
          if (!conversationId) {
            throw new Error('会话未绑定，无法检索条目');
          }
          const conv = database.prepare(`SELECT world_book_id FROM conversations WHERE id = ?`).get(conversationId);
          if (!conv || !conv.world_book_id) {
            throw new Error('会话未绑定世界书，无法检索条目');
          }
          const keyword = (cmdArgs.keyword || '').trim();
          let rows;
          if (keyword) {
            rows = database.prepare(
              `SELECT id, title, content FROM world_book_entries WHERE world_book_id = ? AND is_enabled = 1 AND (title LIKE ? OR content LIKE ?) ORDER BY id ASC LIMIT 20`,
            ).all(conv.world_book_id, `%${keyword}%`, `%${keyword}%`);
          } else {
            rows = database.prepare(
              `SELECT id, title, content FROM world_book_entries WHERE world_book_id = ? AND is_enabled = 1 ORDER BY id ASC LIMIT 20`,
            ).all(conv.world_book_id);
          }
          return rows;
        }

        default:
          throw new Error(`命令 \`${cmdName}\` 已在白名单但没有后端分发实现；请检查白名单与注册表一致性`);
      }
    }

    default:
      console.warn(`[SqliteBridge] 未实现指令: ${cmd}`);
      return null;
  }
}
