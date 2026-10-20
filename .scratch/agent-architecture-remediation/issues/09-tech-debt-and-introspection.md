# 09: Technical Debt Cleanup, Test Drawer Introspection & Middleware Deduplication

**What to build:** Clean up technical debt and hardcoded test fixtures across the project: update `AgentDebugDrawer` to dynamically load attributes and skills from the active character or schema (or leave inputs empty for manual entry), eliminate empty placeholder files and stub definitions, and align/deduplicate calculation logic in `sqlite_ipc_middleware.mjs`.

**Blocked by:** 03: Dynamic Operand Resolution & Expression Calculator, 04: Generic Expression ConditionGate & Zero Silent Fallbacks

**Status:** completed

- [x] `AgentDebugDrawer.tsx` removes hardcoded Chinese skill strings `'察觉'`, `12`, `3`, dynamically introspecting active schema or leaving inputs neutral/empty per C11.
- [x] Obsolete placeholder modules (`character_state_overlays.rs`, empty stub placeholders in `chat_service.rs`) are removed or cleanly replaced.
- [x] Hardcoded model ID list in `providers.rs` is replaced with dynamic capability querying or configuration.
- [x] `sqlite_ipc_middleware.mjs` deduplicates operand evaluation and condition logic to align strictly with the backend core engine.
