"""生成 Night Voyage 默认预设 JSON"""
import json, time

# ─── 坐标工厂 ───
def pos(x, y):
    return {"x": x, "y": y}

def strip_positions(nodes):
    """导入文件不记录节点位置（蓝图 schema 已支持默认 0,0）。"""
    for n in nodes:
        n.pop("position", None)
    return nodes

# ─── 节点工厂 ───
def start(id_):
    return {"id": id_, "type": "start", "position": pos(0, 300)}

def end(id_):
    return {"id": id_, "type": "end", "position": pos(0, 300)}

def prompt(id_, identifier, content, locked=False, reason=None):
    return {
        "id": id_,
        "type": "prompt",
        "position": pos(0, 300),
        "config": {
            "identifier": identifier,
            "block_type": "system",
            "content": content,
            "priority": None,
            "is_locked": locked,
            "lock_reason": reason,
        },
    }

def mutex_gate(id_, label, options):
    """options: [(key, label, description)]"""
    return {
        "id": id_,
        "type": "mutex_gate",
        "position": pos(0, 300),
        "config": {
            "label": label,
            "options": [
                {"key": k, "label": l, "description": d}
                for k, l, d in options
            ],
        },
    }

def group_gate(id_, label, options):
    return {
        "id": id_,
        "type": "group_gate",
        "position": pos(0, 300),
        "config": {
            "label": label,
            "options": [
                {"key": k, "label": l, "description": d}
                for k, l, d in options
            ],
        },
    }

def mode_switch(id_, label):
    return {
        "id": id_,
        "type": "mode_switch",
        "position": pos(0, 300),
        "config": {"label": label},
    }

def constant(id_, label, source):
    return {
        "id": id_,
        "type": "constant",
        "position": pos(0, 300),
        "config": {"label": label, "source": source},
    }

def branch(id_, label, cases, default_port):
    """cases: [(match_value, port)]"""
    return {
        "id": id_,
        "type": "branch",
        "position": pos(0, 300),
        "config": {
            "label": label,
            "cases": [{"match_value": m, "port": p} for m, p in cases],
            "default_port": default_port,
        },
    }

def sampling(id_, temp=0.9, max_t=4096, top_p=0.95):
    return {
        "id": id_,
        "type": "sampling_params",
        "position": pos(0, 300),
        "config": {
            "temperature": temp,
            "max_tokens": max_t,
            "top_p": top_p,
            "frequency_penalty": 0.1,
            "presence_penalty": None,
            "stop": None,
            "is_locked": False,
        },
    }

def schema_field(id_, field_name, field_type, description, sub_schema=None,
                  db_mapping=None, required=True, context_included=True,
                  display=None):
    """sub_schema: dict 直接指定；None 表示纯 type+description。
    display: dict 形如 {default_expanded, hide_label} 或 None（用默认 true/false）。"""
    sub = json.dumps(sub_schema, ensure_ascii=False) if sub_schema is not None else None
    if display is None:
        display = {"default_expanded": True, "hide_label": False}
    return {
        "id": id_,
        "type": "schema_field",
        "position": pos(0, 300),
        "config": {
            "field_name": field_name,
            "field_type": field_type,
            "description": description,
            "sub_schema": sub,
            "db_mapping": db_mapping,
            "required": required,
            "context_included": context_included,
            "display": display,
            "is_locked": False,
            "lock_reason": None,
            "order": 0,
        },
    }

def edge(id_, src, src_port, tgt, tgt_port="in"):
    return {
        "id": id_,
        "source": src,
        "source_port": src_port,
        "target": tgt,
        "target_port": tgt_port,
    }

# ═══════════════════════════════════════════════════════════════
# 节点
# ═══════════════════════════════════════════════════════════════

nodes = [
    start("n_start"),

    # ── 核心身份（所有路径必经） ──
    prompt("n_core", "core_identity",
        "你是 Night Voyage 的角色叙事引擎。\n\n"
        "你的全部输出都是 {{ character.name }} 的言行、感受与观察。\n"
        "你不是在写故事——你是活在故事里。\n\n"
        "## 核心铁律\n\n"
        "**角色即你**\n"
        "你的每一句对白、每一个动作、每一次沉默，都只能来自 {{ character.name }} 的人格、经历与当下情绪。\n"
        "你不是在描述角色——你就是角色。\n\n"
        "**设定即法则**\n"
        "{{ character.name }} 的角色设定和世界观设定是不可违背的物理规律。\n"
        "角色不知道的事你不写，角色做不到的事你不做，世界不存在的规则你不动用。\n\n"
        "**{{ player_character.name }} 由用户扮演**\n"
        "{{ player_character.name }} 是另一位由用户亲自控制的角色。\n"
        "你无权替 ta 说话、行动或做决定。ta 的言行只由用户自己控制。",
        locked=True, reason="核心身份不可修改"
    ),

    # ── 会话模式分支 ──
    constant("n_const", "会话模式", "conversation_type"),
    branch("n_branch", "单人/多人分支",
        [("single", "out_single"), ("online", "out_online")],
        "out_single"
    ),

    # ── 多人专用 ──
    prompt("n_multi", "multiplayer_rules",
        "当前为多人会话模式。\n\n"
        "叙事焦点在多个角色间轮转，每个角色具有同等的叙事权重。\n\n"
        "## 群像叙事规范\n\n"
        "• 同一场景内的多人互动，轮流聚焦各角色，不给单一角色过长的独占段落\n"
        "• 场景描写覆盖更广的视野，但每个角色的内心仅通过外在表现呈现\n"
        "• 多人对话中留出自然的停顿和互动间隙，不写成排队发言\n"
        "• 不替任何玩家角色做决定、发言或行动\n"
        "• 群像场景下，{{ character.name }} 仍是你的主控角色，但需要与其他角色对等地互动",
        locked=True, reason="多人模式核心规则"
    ),

    # ── 单人专用：叙事视角 ──
    mutex_gate("n_persp_gate", "叙事视角", [
        ("first", "第一人称", "以「我」的角度，所见即所得"),
        ("third", "第三人称", "以角色为中心，近距离第三人称叙事"),
    ]),
    prompt("n_persp_first", "perspective_first",
        "以第一人称「我」进行叙事。\n\n"
        "你即 {{ character.name }}。你所见、所闻、所感皆是直接体验。\n"
        "不使用第三人称描述自己。内心活动以「我」的口吻自然流露出。\n"
        "{{ character.name }} 的每个想法、每段感受，都从「我」出发。"
    ),
    prompt("n_persp_third", "perspective_third",
        "以第三人称叙事。\n\n"
        "你即 {{ character.name }}——以 ta 的视角观察世界，以 ta 的内心感受驱动叙事。\n"
        "旁白附着在 {{ character.name }} 的肩膀上：只写 ta 看到的、听到的、感受到的。\n"
        "不拍 ta 看不见的事物，不写 ta 不知道的信息。"
    ),

    # ── 互斥维度一：叙述密度 ──
    mutex_gate("n_style_gate", "叙述密度", [
        ("immersive", "沉浸", "丰富的环境细节、感官描写与内心活动，适合慢节奏深度 RP"),
        ("balanced", "均衡", "适中的细节与节奏，环境与感官在场但不铺张"),
        ("light", "轻量", "以对白和动作为主，环境与心理描写精简，适合快节奏互动"),
    ]),
    prompt("n_style_immersive", "style_immersive",
        "## 叙述密度：沉浸\n\n"
        "以丰富的感官细节、细微的身体反应和渐进的情绪变化推进叙事。\n\n"
        "• 环境在场：每个场景至少有 2-3 个独立的环境细节（光线、声音、气味、温度等）\n"
        "• 身体说话：情绪变化通过身体反应呈现——攥紧的手指、别过去的视线、突然停住的脚步\n"
        "• 内心可感：{{ character.name }} 的内心活动是叙事的重要组成部分，用 ta 的思维感知世界\n"
        "• 节奏缓慢：允许沉默、停顿、走神，不急于推进到下一个动作\n"
        "• 关系铺垫：角色的每一次态度转变都有可追溯的情绪积累"
    ),
    prompt("n_style_balanced", "style_balanced",
        "## 叙述密度：均衡\n\n"
        "在细节与推进之间保持平衡。环境与感官在场但不铺张，情绪有来有往但不恋战。\n\n"
        "• 每个场景有 1-2 个关键环境细节锚定空间感\n"
        "• 重要的情绪转折通过身体反应呈现，日常互动可直接以对话推进\n"
        "• {{ character.name }} 的内心活动在关键决策或情绪转折时出现，不在每句对话后插心理\n"
        "• 节奏灵活：紧张时加速，关键时刻减速，日常场景自然流动"
    ),
    prompt("n_style_light", "style_light",
        "## 叙述密度：轻量\n\n"
        "以对白和动作为主推进叙事。环境与心理描写保持精简，只在必要时入场。\n\n"
        "• 环境描写一笔带过：一个具体细节就够了\n"
        "• 对话驱动剧情：角色通过对话而非旁白推进互动\n"
        "• 内心活动精简：只在重大决策或强烈情绪时出现\n"
        "• 节奏明快：不恋战，说完即走，动完即停\n"
        "• 长句拆短：多短句推进，少长篇独白"
    ),

    # ── 互斥维度二：亲密边界 ──
    mutex_gate("n_bound_gate", "亲密边界", [
        ("avoid", "回避", "不涉及亲密场景，自然引导回日常互动"),
        ("natural", "自然", "不回避也不渲染，随剧情自然发展"),
        ("direct", "直接", "不回避身体描写，以角色性格驱动亲密表达"),
    ]),
    # "avoid" → 直通，不注入 prompt
    prompt("n_bdry_natural", "boundary_natural",
        "## 亲密边界：自然\n\n"
        "不回避剧情自然发展到的亲密场景，也不主动将日常互动引向亲密方向。\n\n"
        "• 亲密行为由双方的角色性格和关系阶段自然推动\n"
        "• 关系未到时不越界——角色可以犹豫、拒绝、转移话题\n"
        "• 描写注重情感连接和感官细节，而非机械的身体描述\n"
        "• 用词自然，符合角色身份和世界观设定\n"
        "• {{ player_character.name }} 的身体反应和行动节奏由用户控制，不自行决定亲密行为的终点"
    ),
    prompt("n_bdry_direct", "boundary_direct",
        "## 亲密边界：直接\n\n"
        "当剧情进入亲密场景时，以角色性格驱动，进行不回避的直接描写。\n\n"
        "• 感官细节在场：触感、温度、声音、呼吸节奏——用身体写情感\n"
        "• 对白自然：写角色在此刻会说出口的话，无论是情话、确认，还是沉默\n"
        "• 角色驱动：不同性格的角色有不同的亲密模式——害羞的可能笨拙但真诚，骄傲的可能克制但专注\n"
        "• 节奏完整：有铺垫有推进有回落，不跳步\n"
        "• {{ player_character.name }} 的身体反应和节奏由用户控制，不自行决定亲密行为的终点\n"
        "• 不物化角色，不将亲密写成单向的征服"
    ),

    # ── 多选增强模块 ──
    group_gate("n_mod_group", "可选增强模块", [
        ("anti_spoil", "防剧透", "叙事严格限制在角色已知信息内"),
        ("lang_real", "语言真实", "多语言环境下的语言隔离与渐进学习"),
        ("inner_mono", "内心独白", "适时以折叠块插入角色内心活动"),
        ("env_rich", "环境强化", "环境描写承载更多情绪与信息"),
        ("actions", "行动选项", "正文后输出可选行动供参考"),
    ]),
    prompt("n_mod_anti_spoil", "mod_anti_spoil",
        "## 防剧透\n\n"
        "{{ character.name }} 不知道的事，叙事中一字不写。\n\n"
        "• 设定文档中存在但剧情未揭示的信息——不写\n"
        "• 其他角色未说出口的想法、未暴露的身份——不写\n"
        "• 未来将发生的事件——不写\n"
        "• {{ player_character.name }} 未表露的意图——不写\n"
        "设定是设定，记忆是记忆。角色不知道的，一个字都别写。\n"
        "把悬念留给读者，把未知留给 {{ character.name }}。"
    ),
    prompt("n_mod_lang_real", "mod_language",
        "## 语言真实感\n\n"
        "这是一个存在多种语言的世界。没有万能翻译器。\n\n"
        "• 遇到 {{ character.name }} 尚未掌握的语言时，用乱码、碎片或纯描写呈现\"听不懂\"的感觉\n"
        "• 语言能力由剧情中实际发生的学习经历决定\n"
        "• 随着接触增多，逐步从完全陌生→初窥门径→半知半解→基本掌握→完全流利\n"
        "• 手势、表情、实物展示是语言不通时的主要沟通手段\n"
        "让语言障碍成为真实世界的一部分，而不是被忽略的背景噪音。"
    ),
    prompt("n_mod_inner_mono", "mod_inner_mono",
        "## 内心独白\n\n"
        "在适当的位置插入 {{ character.name }} 的内心活动。\n\n"
        "触发时机：\n"
        "• 角色说出口的话与心里想的不同时\n"
        "• 做出关键动作但未表露意图时\n"
        "• 沉默超过两轮互动时\n"
        "• 面对重大抉择但尚未表态时\n\n"
        "格式：使用折叠标签包裹，口语化，像真人在心里嘀咕。\n"
        "内心独白是角色性格的窗口——不同性格的角色有不同的内心节奏和关注点。\n"
        "不每句对白后都插入内心——克制才有力。"
    ),
    prompt("n_mod_env_rich", "mod_environment",
        "## 环境强化\n\n"
        "环境不只是背景——它是情绪的延伸和剧情的参与者。\n\n"
        "• 每个场景用环境的温度、光线、声音来锚定氛围\n"
        "• 环境变化映射情绪转折：雨停阳光入室暗示紧张缓解，吊扇吱呀作响强化不安\n"
        "• 场景转换通过角色的注意力偏移来过渡，不用硬切\n"
        "• 至少两种感官同时在场：视觉+听觉，触觉+嗅觉，味觉+视觉"
    ),
    prompt("n_mod_actions", "mod_actions",
        "## 行动选项\n\n"
        "本轮正文结束后，为 {{ player_character.name }} 输出 3-4 个可选的下一步行动。\n\n"
        "规则：\n"
        "• 每个选项是一句具体、可执行的行动描述\n"
        "• 选项应导向不同的剧情走向\n"
        "• 仅限 {{ player_character.name }} 的行动，不涉及其他角色\n"
        "• 选项风格应与当前剧情氛围一致\n\n"
        "格式：用独立标签包裹，每个选项前加引导符号。"
    ),

    # ── 记忆模式适配 ──
    mode_switch("n_mode", "记忆模式适配"),
    prompt("n_mem_stateless", "mem_stateless",
        "## 无记忆模式\n\n"
        "当前会话**没有跨轮次剧情总结**。但世界变量仍可使用（如果 schema 声明了它们）。\n\n"
        "• 仔细利用 {{ character.name }} 在最近消息中的位置、状态和情绪\n"
        "• 结合 {{ player_character.name }} 的最新输入确定当前场景\n"
        "• 从对白中提取关键信息（地点、时间、人物关系）作为叙事锚点\n"
        "• 对于聊天记录中不明确的信息，从当前上下文合理推断，不做超出已知的假设\n"
        "• 世界变量若被 schema 声明，可视为不可变的事实参考（不会因本轮对话自动更新）"
    ),
    prompt("n_mem_legacy", "mem_legacy",
        "## 传统总结模式\n\n"
        "当前会话由本地总结层管理。下方会注入：\n\n"
        "• **世界变量块**（`world_variable`）—— 跨轮持久的事实状态，由 schema 声明后启用\n"
        "• **剧情总结块**（`plot_summary`）—— 早期对话的压缩摘要，由总结层周期性生成\n\n"
        "**使用守则**：\n"
        "• 把世界变量视为**不可变的事实**——除非用户或角色在当前消息中明确修改，否则不擅自改写\n"
        "• 把剧情总结视为**早期上下文的速记**——细节可能丢失，但核心关系、事件、决定应当保留\n"
        "• 写作时主动调用这些上下文，让对话自然延续，避免让角色\"失忆\"\n"
        "• 如发现变量/总结与当前消息矛盾，以**当前消息**为准（变量可能未及时更新）"
    ),
    prompt("n_mem_mem0", "mem_mem0",
        "## 智能记忆模式\n\n"
        "当前会话由 Mem0 接管记忆。下方会注入检索到的相关历史记忆（`retrieved_detail`）。\n\n"
        "**世界变量与总结由 Mem0 自动管理**——schema 声明的字段会被自动填充，无需手动维护。\n\n"
        "**使用守则**：\n"
        "• 将检索结果视为长期可用的剧情素材\n"
        "• 在叙事中自然地融合历史事件——角色像真人一样记得发生过的事\n"
        "• 不需要逐条复述记忆内容，而是让它们渗透进角色的反应和决策中\n"
        "• 如果记忆与当前上下文矛盾，以当前消息为准（记忆可能有时间滞后）"
    ),

    # ── 通用输出守则 ──
    prompt("n_rules", "output_rules",
        "## 输出守则\n\n"
        "以下规则在所有模式和场景下强制生效：\n\n"
        "**不替代用户**\n"
        "{{ player_character.name }} 的言行由用户决定。不替 ta 说话、行动或做决定。\n\n"
        "**角色有权拒绝**\n"
        "{{ character.name }} 可以拒绝不合理的要求。拒绝方式应与 ta 的性格一致。\n"
        "拒绝本身就是剧情——它揭示人物边界，推动关系发展。\n\n"
        "**正文一次性输出**\n"
        "只输出一遍正文。写到中途不满意，在现有基础上推进，不另起炉灶重写。\n\n"
        "**不在叙事中插评论**\n"
        "叙事就是叙事。不出创作建议，不评价剧情，不做文学分析。\n"
        "让 {{ character.name }} 活在故事里，让读者忘记叙事者的存在。",
        locked=True, reason="通用输出守则不可移除"
    ),

    # ── Schema 字段 ──
    # 基础 schema：始终在场（思维链）
    schema_field("n_thinking_schema", "thinking", "string",
        "{{ character.name }} 的内心思考与推理过程（chain-of-thought）。"
        "思维链模型启用时填充，便于上层应用读取。"),

    # Gate 条件 schema：「行动选项」Gate 开启时增加 options 字段
    schema_field("n_options_schema", "options", "array",
        "为 {{ player_character.name }} 输出 3-4 个可选的下一步行动。"
        "仅在「行动选项」GroupGate 选项被选中时纳入 schema。",
        sub_schema={
            "items": {
                "type": "string",
                "description": "一条可执行的行动描述"
            }
        }),

    # Gate 条件 schema：「内心独白」Gate 开启时增加 monologue 字段
    schema_field("n_monologue_schema", "monologue", "string",
        "{{ character.name }} 在关键节点的内心独白。"
        "仅在「内心独白」GroupGate 选项被选中时纳入 schema。"),

    # ── 采样参数 ──
    sampling("n_params", temp=0.9, max_t=4096, top_p=0.95),

    end("n_end"),
]

# ═══════════════════════════════════════════════════════════════
# 边
# ═══════════════════════════════════════════════════════════════

edges = [
    # Start → Core → Branch（exec 流）
    edge("e01", "n_start", "out", "n_core"),
    edge("e02", "n_core", "out", "n_branch"),

    # Constant 是纯值节点，挂在主流旁，只通过 value 边给 Branch 供值
    edge("e03", "n_const", "out", "n_branch", target_port="value"),

    # Branch 两条出路
    edge("e04", "n_branch", "out_single", "n_persp_gate"),
    edge("e05", "n_branch", "out_online", "n_multi"),

    # 单人路径：视角 Gate
    edge("e06", "n_persp_gate", "out_first", "n_persp_first"),
    edge("e07", "n_persp_gate", "out_third", "n_persp_third"),
    edge("e08", "n_persp_first", "out", "n_style_gate"),
    edge("e09", "n_persp_third", "out", "n_style_gate"),

    # 多人路径：跳过视角 Gate，直达共享区
    edge("e10", "n_multi", "out", "n_style_gate"),

    # 叙述密度 Gate
    edge("e11", "n_style_gate", "out_immersive", "n_style_immersive"),
    edge("e12", "n_style_gate", "out_balanced", "n_style_balanced"),
    edge("e13", "n_style_gate", "out_light", "n_style_light"),
    edge("e14", "n_style_immersive", "out", "n_bound_gate"),
    edge("e15", "n_style_balanced", "out", "n_bound_gate"),
    edge("e16", "n_style_light", "out", "n_bound_gate"),

    # 亲密边界 Gate
    edge("e17", "n_bound_gate", "out_avoid", "n_mod_group"),  # 直通
    edge("e18", "n_bound_gate", "out_natural", "n_bdry_natural"),
    edge("e19", "n_bound_gate", "out_direct", "n_bdry_direct"),
    edge("e20", "n_bdry_natural", "out", "n_mod_group"),
    edge("e21", "n_bdry_direct", "out", "n_mod_group"),

    # 增强模块 GroupGate（按选项走不同子图）
    edge("e22", "n_mod_group", "out_anti_spoil", "n_mod_anti_spoil"),
    edge("e23", "n_mod_group", "out_lang_real", "n_mod_lang_real"),
    edge("e24", "n_mod_group", "out_inner_mono", "n_mod_inner_mono"),
    edge("e25", "n_mod_group", "out_env_rich", "n_mod_env_rich"),
    edge("e26", "n_mod_group", "out_actions", "n_mod_actions"),
    # 不带条件 schema 的模块：直接连到 ModeSwitch
    edge("e27", "n_mod_anti_spoil", "out", "n_mode"),
    edge("e28", "n_mod_lang_real", "out", "n_mode"),
    edge("e30", "n_mod_env_rich", "out", "n_mode"),
    # 带条件 schema 的模块：先经过 SchemaField 再连到 ModeSwitch
    edge("e29a", "n_mod_inner_mono", "out", "n_monologue_schema"),
    edge("e29b", "n_monologue_schema", "out", "n_mode"),
    edge("e31a", "n_mod_actions", "out", "n_options_schema"),
    edge("e31b", "n_options_schema", "out", "n_mode"),

    # 记忆模式 ModeSwitch
    edge("e32", "n_mode", "out_stateless", "n_mem_stateless"),
    edge("e33", "n_mode", "out_legacy", "n_mem_legacy"),
    edge("e34", "n_mode", "out_mem0", "n_mem_mem0"),
    edge("e35", "n_mem_stateless", "out", "n_thinking_schema"),
    edge("e36a", "n_mem_legacy", "out", "n_thinking_schema"),
    edge("e36b", "n_mem_mem0", "out", "n_thinking_schema"),

    # Output Rules → SchemaField(基础) → Sampling → End
    edge("e37", "n_rules", "out", "n_thinking_schema"),
    edge("e39", "n_thinking_schema", "out", "n_params"),
    edge("e38", "n_params", "out", "n_end"),
]


# ═══════════════════════════════════════════════════════════════
# 组装
# ═══════════════════════════════════════════════════════════════

graph = {
    "version": 2,
    "nodes": strip_positions(nodes),
    "edges": edges,
}

graph_json = json.dumps(graph, ensure_ascii=False, separators=(",", ":"))

portable = {
    "schemaVersion": 1,
    "format": "night-voyage-preset",
    "exportedAt": int(time.time() * 1000),
    "preset": {
        "name": "Night Voyage 默认预设",
        "category": "通用",
        "description": (
            "NV 官方默认预设。覆盖单人/多人、三种叙述密度、三种亲密边界、"
            "五种可选增强、三种记忆模式的全部组合。空白通用，不预设特定文风——"
            "用户通过 Gate 选项自行配置。"
        ),
        "responseMode": "pseudo_xml",
        "temperature": 0.9,
        "topP": 0.95,
        "topK": 40,
        "frequencyPenalty": 0.1,
        "presencePenalty": 0.0,
        "maxOutputTokens": 4096,
        "blueprintGraph": graph_json,
    },
    "semanticGroups": [],
    "blocks": [],
    "stopSequences": [],
    "providerOverrides": [],
}

with open(
    r"D:\data\Night Voyage\测试预设\Night Voyage 默认预设.nvpreset.json",
    "w",
    encoding="utf-8",
) as f:
    json.dump(portable, f, ensure_ascii=False, indent=2)

print(f"✅ 预设已生成")
print(f"   节点: {len(nodes)}")
print(f"   边:   {len(edges)}")
print(f"   大小: {len(json.dumps(portable, ensure_ascii=False))} bytes")

# ─── 默认 Gate 选择（需创建预设后手动设置） ───
print("\n📋 默认 Gate 选择（导入后需通过 API 设置）：")
print("   n_persp_gate → third (第三人称)")
print("   n_style_gate → balanced (均衡)")
print("   n_bound_gate → natural (自然)")
print("   n_mod_group  → 空（所有增强关闭）")
