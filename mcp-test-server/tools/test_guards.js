/**
 * Tools for testing deterministic guards and agent orchestrator mechanics:
 * 1. Deterministic D20 dice checks (CSPRNG, DC check, criticals, tamper-proof signature).
 * 2. Aho-Corasick banned words detection and self-nudge critique retry loop.
 * 3. Scriptwriter Pipeline (Drafter -> Critic -> Refiner with Layer 1 anchor blackout).
 * 4. Director-Actor context pruning and slot assembly.
 *
 * Adheres strictly to AGENTS.md composition-over-inheritance rules.
 */

const crypto = require('node:crypto');

/**
 * Aho-Corasick trie node factory (composition, no classes)
 */
function createAcNode() {
  return {
    children: new Map(),
    fail: null,
    outputs: []
  };
}

/**
 * Build Aho-Corasick automaton
 */
function buildAhoCorasick(keywords) {
  const root = createAcNode();

  // 1. Insert keywords into trie
  for (const word of keywords) {
    if (!word) continue;
    let curr = root;
    for (const char of word) {
      if (!curr.children.has(char)) {
        curr.children.set(char, createAcNode());
      }
      curr = curr.children.get(char);
    }
    curr.outputs.push(word);
  }

  // 2. Build failure pointers using BFS queue
  const queue = [];
  for (const [char, child] of root.children) {
    child.fail = root;
    queue.push(child);
  }

  while (queue.length > 0) {
    const curr = queue.shift();
    for (const [char, child] of curr.children) {
      let f = curr.fail;
      while (f && !f.children.has(char)) {
        f = f.fail;
      }
      child.fail = f ? f.children.get(char) : root;
      if (child.fail && child.fail.outputs.length > 0) {
        child.outputs = child.outputs.concat(child.fail.outputs);
      }
      queue.push(child);
    }
  }

  return {
    search(text) {
      const matches = [];
      let curr = root;
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        while (curr && !curr.children.has(char)) {
          curr = curr.fail;
        }
        curr = curr ? curr.children.get(char) : root;
        if (curr && curr.outputs.length > 0) {
          for (const matchWord of curr.outputs) {
            matches.push({
              word: matchWord,
              startIndex: i - matchWord.length + 1,
              endIndex: i + 1
            });
          }
        }
      }
      return matches;
    }
  };
}

/**
 * Deterministic D20 Roll Simulator
 */
function rollD20(modifier = 0, dc = 10, seed = null) {
  // Use CSPRNG randomInt (1 to 20 inclusive)
  let rawRoll;
  if (seed !== null) {
    const hash = crypto.createHash('sha256').update(String(seed)).digest();
    rawRoll = (hash.readUInt32BE(0) % 20) + 1;
  } else {
    rawRoll = crypto.randomInt(1, 21);
  }

  const total = rawRoll + modifier;
  const isCritical = rawRoll === 20;
  const isFumble = rawRoll === 1;
  const passed = isCritical ? true : isFumble ? false : total >= dc;

  const cardPayload = {
    type: 'd20_check',
    roll: rawRoll,
    modifier,
    total,
    dc,
    passed,
    is_critical: isCritical,
    is_fumble: isFumble,
    timestamp: Date.now()
  };

  const signature = crypto.createHash('sha256')
    .update(JSON.stringify(cardPayload) + 'NV_TAMPER_PROOF_SALT')
    .digest('hex');

  return {
    ...cardPayload,
    signature
  };
}

/**
 * Scriptwriter Layer 1 Anchor Blackout
 * Replaces stable preceding text with `[前文背景已锁定]`, keeping the last 50 characters as tail anchor
 */
function applyLayer1AnchorBlackout(precedingText, tailAnchorLength = 50) {
  if (!precedingText || precedingText.length <= tailAnchorLength) {
    return precedingText || '';
  }
  const tailAnchor = precedingText.slice(-tailAnchorLength);
  return `[前文背景已锁定]\n...${tailAnchor}`;
}

/**
 * Director-Actor context pruner and slot assembly
 */
function pruneActorContext(worldSetting, actorPersona, actorCueCard) {
  // Actor subagent must NOT receive full omniscient world setting or hidden GM state
  return {
    subagent_role: 'actor',
    actor_persona: actorPersona,
    cue_card: actorCueCard,
    omitted_world_secrets: true
  };
}

function assembleDirectorSlots(environmentSlot, actorDialogueSlot, plotAdvancementSlot) {
  return [
    environmentSlot.trim(),
    actorDialogueSlot.trim(),
    plotAdvancementSlot.trim()
  ].filter(Boolean).join('\n\n');
}

/**
 * Factory for nv_test_guards tool
 */
function createTestGuardsTool(config = {}) {
  return {
    name: 'nv_test_guards',
    description: 'Tests deterministic D20 dice checks, Aho-Corasick banned words detection & self-nudge critique retries, and Scriptwriter/Director-Actor orchestration.',
    inputSchema: {
      type: 'object',
      properties: {
        test_type: {
          type: 'string',
          enum: ['all', 'd20', 'banned_words', 'self_nudge', 'scriptwriter', 'director_actor'],
          default: 'all',
          description: 'Which guardrail / agent feature to test'
        },
        custom_banned_words: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional custom banned words list for testing'
        },
        sample_text: {
          type: 'string',
          description: 'Optional custom draft text to test for banned words'
        },
        d20_sim_count: {
          type: 'number',
          default: 1000,
          description: 'Number of D20 rolls to simulate distribution'
        }
      }
    },
    async execute(args = {}) {
      const testType = args.test_type || 'all';
      const results = {};

      // 1. Test D20 Deterministic Rolls
      if (testType === 'all' || testType === 'd20') {
        const simCount = Math.min(args.d20_sim_count || 1000, 10000);
        const counts = Array(21).fill(0);
        let sum = 0;
        let criticalPassCount = 0;
        let fumbleCount = 0;

        for (let i = 0; i < simCount; i++) {
          const res = rollD20(0, 10);
          counts[res.roll]++;
          sum += res.roll;
          if (res.is_critical) criticalPassCount++;
          if (res.is_fumble) fumbleCount++;
        }

        const mean = sum / simCount;
        const allInRange = counts.slice(1).every(c => c > 0);
        const zeroIndexEmpty = counts[0] === 0;

        // Deterministic check card verification
        const sampleCheck = rollD20(3, 15, 'deterministic_seed_42');

        results.d20_test = {
          success: allInRange && zeroIndexEmpty && Math.abs(mean - 10.5) < 1.0,
          sim_count: simCount,
          mean: Number(mean.toFixed(2)),
          expected_mean: 10.5,
          critical_pass_count: criticalPassCount,
          fumble_count: fumbleCount,
          sample_tamper_proof_card: sampleCheck
        };
      }

      // 2. Test Aho-Corasick Banned Words
      if (testType === 'all' || testType === 'banned_words' || testType === 'self_nudge') {
        const bannedWords = args.custom_banned_words || ['涉暴暴力违禁词', '作弊外挂', '非法注入', '破坏平衡'];
        const ac = buildAhoCorasick(bannedWords);

        const dirtyDraft = args.sample_text || '玩家试图使用非法注入破坏平衡，并在地下城中使用涉暴暴力违禁词进行攻击。';
        const matches = ac.search(dirtyDraft);

        const cleanDraft = '玩家手持精钢长剑在地下城中向哥布林发起攻击，敏捷地避开了迎面袭来的石块。';
        const cleanMatches = ac.search(cleanDraft);

        results.banned_words_test = {
          success: matches.length >= 3 && cleanMatches.length === 0,
          dirty_text: dirtyDraft,
          matches_found: matches,
          clean_text: cleanDraft,
          clean_matches_count: cleanMatches.length
        };
      }

      // 3. Test Self-Nudge Retry Loop
      if (testType === 'all' || testType === 'self_nudge') {
        const bannedWords = ['恶性违禁词', '作弊代码'];
        const ac = buildAhoCorasick(bannedWords);

        // Simulation of agent self-nudge workflow
        const draftHistory = [
          '第一次生成初稿：玩家启动了恶性违禁词进行攻击。', // Round 1: Dirty
          '第二次生成修改稿：玩家输入了作弊代码来提升属性。', // Round 2: Still Dirty (Retry 1)
          '第三次生成定稿：玩家集中精力，全力以赴掷出飞刃击退敌人。' // Round 3: Clean (Retry 2 success)
        ];

        const log = [];
        let finalOutput = null;
        let retryCount = 0;
        const maxRetries = 2;

        for (let round = 0; round < draftHistory.length; round++) {
          const draft = draftHistory[round];
          const hits = ac.search(draft);
          if (hits.length > 0) {
            const hitWords = [...new Set(hits.map(h => h.word))];
            const nudgePrompt = `[门禁拦截] 检测到命中违禁词: [${hitWords.join(', ')}]，请在保持剧情连贯性的前提下改写替换上述词汇。`;
            log.push({
              round: round + 1,
              status: 'BLOCKED_BY_GATE',
              hit_words: hitWords,
              nudge_generated: nudgePrompt
            });
            retryCount++;
            if (retryCount > maxRetries) {
              log.push({ status: 'HARD_FAILURE_MAX_RETRIES_EXCEEDED' });
              break;
            }
          } else {
            log.push({
              round: round + 1,
              status: 'PASSED_CLEAN',
              final_text: draft
            });
            finalOutput = draft;
            break;
          }
        }

        results.self_nudge_test = {
          success: finalOutput !== null && retryCount === 2,
          retries_used: retryCount,
          max_retries: maxRetries,
          execution_log: log
        };
      }

      // 4. Test Scriptwriter Pipeline & Layer 1 Anchor Blackout
      if (testType === 'all' || testType === 'scriptwriter') {
        const longPrecedingStory = '在大陆北方的冰封峭壁上，寒风呼啸。'.repeat(15) + '队伍终于抵达了黑曜石神殿的入口，古老的符文在大门上微微泛着苍蓝色的光芒。';
        const blackedOut = applyLayer1AnchorBlackout(longPrecedingStory, 50);

        const textWorkspace = {
          draft: '初稿：勇士推开沉重大门，寒气迎面扑来。',
          critique: '审阅批注：描写略显单薄，增加对门内幽暗氛围与石雕特征的刻画。',
          final: '润色定稿：勇士双臂发力推开沉重的黑曜石大门，刺骨寒气伴随着陈腐的尘埃迎面扑来，殿堂两侧伫立着手持巨斧的巨石守卫像，眼眶中的幽火明灭不定。'
        };

        results.scriptwriter_test = {
          success: blackedOut.startsWith('[前文背景已锁定]') && blackedOut.length < longPrecedingStory.length,
          original_length: longPrecedingStory.length,
          blacked_out_length: blackedOut.length,
          blacked_out_preview: blackedOut,
          in_memory_text_workspace: textWorkspace
        };
      }

      // 5. Test Director-Actor Context Pruning & Slot Assembly
      if (testType === 'all' || testType === 'director_actor') {
        const worldSecrets = 'GM秘密：神殿地下埋藏着上古魔王的心脏，国王其实是幕后主使。';
        const actorPersona = '年轻法师莉娜：性格谨慎，擅长冰系法术，对古代符文充满好奇。';
        const cueCard = '发现大门上的符文是三阶封印，提醒队长不要贸然触发。';

        const prunedContext = pruneActorContext(worldSecrets, actorPersona, cueCard);
        const assembled = assembleDirectorSlots(
          '【场景】狂风卷着雪沫撞击在神殿台阶上。',
          '莉娜紧盯着门上的流光，急促地喊道：“队长等等！这是三阶连锁封印，不能强攻！”',
          '【推进】队伍立刻停下脚步，游侠抽出破除卷轴，准备配合破解。'
        );

        results.director_actor_test = {
          success: !JSON.stringify(prunedContext).includes('上古魔王') && assembled.includes('【场景】') && assembled.includes('莉娜'),
          pruned_context: prunedContext,
          assembled_output: assembled
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
  createTestGuardsTool,
  buildAhoCorasick,
  rollD20,
  applyLayer1AnchorBlackout,
  pruneActorContext,
  assembleDirectorSlots
};
