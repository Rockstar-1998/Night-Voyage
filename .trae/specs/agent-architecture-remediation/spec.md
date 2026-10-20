# Specification: Agent Architecture & Remediation (Audit Fixes)

**Triage Label**: `completed`  
**Reference Document**: `plans/agent-system-architecture-plan.md`  
**Compliance Standards**: `AGENTS.md` (C1, C2, C3, C4, C5, C7, C8, C9, C10, C11)

---

## Problem Statement

When creators and players use the agent-driven tabletop role-playing system, the system currently fails to honor its architectural promises of genre neutrality, zero-disk volatile execution, and dual-platform coverage. Specifically:

1. **Genre Lock-in**: Creators designing non-fantasy genres (such as cyberpunk, sci-fi, horror, or survival) find that the engine hardcodes fantasy RPG mechanics (HP, MP, Gold, Weight) directly into the core state machine, calculation operands, condition evaluation, and execution receipts. There is no blueprint mechanism to define custom initial stats, currencies, or starting inventories.
2. **Memory Leakage and Unwanted Disk I/O**: The scriptwriter pipeline promises zero-disk intermediate text handling, but intermediate drafting phases actually write every draft into persistent SQLite database tables (`agent_drafts`) rather than ephemeral memory scratchpads. Furthermore, model agents lack standard `read_text` and `write_text` tools to read and write scratchpad buffers.
3. **Rigid Scriptwriting and Evaluation**: Multi-stage pipelines are hardcoded to fixed phases (draft, critique, polish) with hardcoded JSON extraction prompts, rather than allowing authors to define dynamic pipeline stages and enforce structured schemas.
4. **Mobile Exclusion & Incomplete Desktop Authoring**: Mobile users cannot configure 8 essential agent blueprint nodes or access schema, UI designer, and action whitelist modals. PC users are forced to hand-edit raw JSON strings for query templates and pipeline stages due to missing visual configuration forms.
5. **Hardcoded Test Fixtures & Code Smells**: Debug tooling contains hardcoded business skill checks and values, while middleware duplicates backend calculation logic and dead placeholder files clutter the codebase.

*(Note: Per confirmed architectural direction, `STATELESS` has been intentionally merged into `LEGACY`. The system officially recognizes `LEGACY` and `AGENTS` as the two core session tracks, alongside an optional `MEM0` memory enhancement extension).*

---

## Solution

A fully genre-neutral, data-driven, and dual-platform compliant agent runtime and blueprint authoring suite that remediates all architectural deviations while respecting the `LEGACY` / `AGENTS` / optional `MEM0` system baseline:

1. **Dynamic Initial State & Genre Independence**: Provide blueprint-driven initial state configuration that allows creators to define arbitrary attribute dictionaries (e.g. sanity, credits, ammunition, fuel) and starting inventories. Remove all fantasy-specific hardcodings and silent fallbacks across the core engine.
2. **Ephemeral In-Memory Scratchpad**: Provide native `read_text` and `write_text` tools exposed to the model that operate exclusively on an in-memory scratchpad lifecycle. Intermediate pipeline drafts remain strictly in memory and are discarded at the end of the turn with zero disk I/O.
3. **Generic Rule & Calculator Evaluation**: Transition condition gates and calculation operands to expression-based evaluation driven by blueprint nodes, eliminating hardcoded formula names and silent fallback clamping.
4. **Template-Driven Tool Returns**: Format tool call receipts entirely through blueprint-configured templates, providing neutral, generic fallback receipts when no template is specified.
5. **Extensible ActionBridge Dispatch**: Transform the action bridge into an open, whitelist-controlled dispatch router capable of proxying any authorized system command.
6. **Dynamic Pipeline Stages & Schema Validation**: Support arbitrary N-stage pipeline execution loops configured by blueprint nodes, utilizing schema enforcement for structured extraction instead of hardcoded prompts.
7. **Ratified Dual-Track Mode Structure**: Formally solidify the session memory baseline into `LEGACY` (classic sliding window) and `AGENTS` (orchestrated multi-turn agent flow), with `MEM0` available as an optional memory extension.
8. **Dual-Platform Authoring Parity**: Deliver full visual configuration forms on both PC and mobile for all 8 agent blueprint node types, along with mobile-native modals for Schema Editor, UI Designer, and Action Whitelists.
9. **Elimination of Hardcoded Artifacts**: Replace static debug data with dynamic introspection and clean up duplicate logic and placeholder modules across the stack.

---

## User Stories

1. As a tabletop scenario creator, I want to define arbitrary initial stats (e.g., `sanity`, `fuel`, `credits`) in my blueprint, so that I can create sci-fi, horror, or survival games without fantasy RPG attributes appearing.
2. As a tabletop scenario creator, I want to define starting inventory items and equipment in the blueprint, so that players begin scenarios with genre-appropriate belongings.
3. As a tabletop scenario creator, I want my intermediate scriptwriter drafts to stay in volatile memory, so that writing operations incur zero disk I/O and leave no storage residue.
4. As an AI scriptwriter agent, I want access to `read_text` and `write_text` tools during my turn, so that I can inspect and refine draft texts across reasoning phases.
5. As an AI scriptwriter agent, I want my scratchpad buffers to be automatically dropped at the end of the turn, so that memory usage remains strictly bounded.
6. As a scenario creator, I want to configure custom arithmetic expressions for tool parameters (e.g., calculating ammo expenditure or fuel consumption), so that the engine does not assume `unit_price * count`.
7. As a scenario creator, I want condition gates to evaluate custom relational expressions (such as `credits >= cost` or `radiation_level < max_threshold`), so that rules are evaluated accurately without hardcoded attribute checks.
8. As a scenario creator, I want condition gates to return explicit error signals when attributes are missing, so that invalid blueprint designs are caught immediately without silent default clamping.
9. As a player, I want tool execution feedback to use the scenario creator's customized message template, so that I see genre-appropriate narrative feedback rather than hardcoded gold and weight receipts.
10. As a scenario creator, I want a neutral, data-driven fallback message when no template is configured, so that generic tools do not output fantasy RPG currency labels.
11. As a scenario creator, I want the ActionBridge to route any whitelisted system command, so that blueprints can read and modify world books, character sheets, and custom system records dynamically.
12. As a scenario creator, I want to define a custom number of stages for the scriptwriter pipeline (e.g., Outline -> Scene Detail -> Sensory Polish -> Tone Check), so that the agent's workflow fits my narrative style.
13. As a scenario creator, I want the director agent to enforce scene beat outputs through structured schema definitions rather than brittle prompt text requests, so that outputs are reliably parseable.
14. As a scenario creator, I want to choose between `LEGACY` mode for classic schema dialogue and `AGENTS` mode for multi-stage orchestration, with optional `MEM0` memory enrichment, so that execution follows the intended session track.
15. As a desktop blueprint creator, I want visual form inputs for `Querier` node argument templates, so that I do not need to manually edit raw JSON strings.
16. As a desktop blueprint creator, I want a visual stage list builder for `ScriptwriterPipeline` nodes, so that I can add, reorder, and configure pipeline stages intuitively.
17. As a mobile player and creator, I want visual configuration panels for all 8 agent blueprint node types (`inspector`, `querier`, `writer`, `banned_words_config`, `scriptwriter_pipeline`, `agent_mode_switch`, `director_config`, `actor_definition`), so that I can build and edit agent presets on my mobile device.
18. As a mobile creator, I want to open and use the Schema Editor on mobile, so that I can configure structured outputs on the go.
19. As a mobile creator, I want to open and use the UI Designer on mobile, so that I can customize the persistent HUD layout on mobile screens.
20. As a mobile creator, I want to manage preset action whitelists on mobile, so that I can control security permissions for blueprints from any device.
21. As a system tester, I want the debug drawer to load candidate attributes and skills dynamically from active character sheets or remain blank for manual input, so that tests do not rely on hardcoded Chinese skill strings or fixed DC numbers.
22. As a developer, I want all IPC and simulation middleware to share unified evaluation logic with the backend, so that rule evaluation behaviors never diverge across runtimes.
23. As a developer, I want all obsolete placeholder modules and hardcoded provider models removed, so that the codebase remains clean, maintainable, and free of false implementations.

---

## Implementation Decisions

### 1. In-Memory Scratchpad & Tool Calling System
- Introduce an ephemeral scratchpad registry in the session context, holding named text buffers (`draft`, `critique`, `final`, and arbitrary creator-defined keys) strictly in volatile memory.
- Register two native agent tools exposed to language models during pipeline execution:
  - `read_text(key: String) -> Result<String, ToolError>`: retrieves content from the ephemeral scratchpad.
  - `write_text(key: String, content: String) -> Result<(), ToolError>`: sets or overwrites content in the ephemeral scratchpad.
- Remove all intermediate database inserts into `agent_drafts` from the turn execution flow. Only the final selected narrative beat or explicit save action may write to permanent storage.
- Automatically discard the entire scratchpad container when the turn execution completes or aborts.

### 2. Generic Initial State Configuration Node
- Define a new blueprint node type and schema representation for initial state configuration:
```json
{
  "type": "initial_state_config",
  "stats": {
    "<stat_name>": {
      "initial": 100.0,
      "min": 0.0,
      "max": 100.0
    }
  },
  "inventory": [
    {
      "id": "starter_item",
      "name": "Item Name",
      "quantity": 1,
      "attributes": {}
    }
  ],
  "custom_flags": {}
}
```
- Remove all hardcoded default values (`hp`, `mp`, `gold`, `weight`, etc.) from the game state constructor. When no blueprint initial state is supplied, initialize the game state with an empty attribute map rather than fantasy defaults.

### 3. Dynamic Operand Resolution & Expression Calculator
- Decouple the tool plan evaluator from specific variable names. Remove the hardcoded matches for `"total_cost"` and `"added_weight"` in operand resolution.
- Enable operand evaluation to resolve through:
  - Direct argument lookup from the tool call payload.
  - State attribute lookup from the active game state container.
  - Mathematical expression evaluation supplied by blueprint `Calculator` nodes or formula strings (e.g. `[op1] * [op2]`).
- Fail with a descriptive error if an operand references a variable that does not exist in arguments, state, or expression context.

### 4. Expression-Based Condition Gates & Zero Silent Fallbacks
- Replace the static gate type matching (`"gold"`, `"weight"`, `"slots"`, `"d20"`) with a relational expression parser that supports:
  - Operators: `>=`, `<=`, `>`, `<`, `==`, `!=`.
  - Left operand: attribute key or expression.
  - Right operand: numerical threshold or variable expression.
- Abolish all silent fallback behaviors, specifically removing the `max(10.0)` clamp on missing attributes. Missing attributes or malformed conditions must fail immediately with clear diagnostic context.

### 5. Template-Driven Tool Return Formatting
- Require tool return messages to be formatted via the blueprint `ToolReturn` template renderer.
- The template renderer replaces placeholders (e.g. `{tool_name}`, `{result}`, `{mutated_stats}`) with actual execution outcomes.
- When no template is defined on the node, generate a neutral, genre-agnostic fallback message indicating tool execution status and affected keys, with zero references to specific currency or weight units.

### 6. Extensible ActionBridge Dispatch Router
- Redesign the action bridge dispatcher from a static string match to a registered command router.
- Commands declared in the preset whitelist are looked up in the command registry. Registered command handlers take `(database_handle, session_context, arguments)` and return structured JSON results.
- Unregistered or unwhitelisted commands are rejected with explicit authorization or missing-handler errors.

### 7. Dynamic Pipeline Execution & Schema Extraction
- Refactor the scriptwriter pipeline runner to iterate over an arbitrary ordered list of pipeline stage descriptors provided by the blueprint node:
```json
{
  "stages": [
    { "name": "outline", "role": "planner", "system_prompt": "...", "input_key": "user_prompt", "output_key": "draft" },
    { "name": "refine", "role": "critic", "system_prompt": "...", "input_key": "draft", "output_key": "final" }
  ]
}
```
- Replace hardcoded JSON prompt directives in the director actor with standard `InvokeSchema` node definitions, validating model responses against formal JSON schemas.

### 8. Architectural Ratification: LEGACY and AGENTS Dual-Track with Optional MEM0
- Reaffirm the approved consolidation of session modes:
  - **`LEGACY`**: Single-call sliding window memory model with schema override flow. Migration 0050 merging `stateless` into `legacy` is ratified as intended design.
  - **`AGENTS`**: Multi-stage director/scriptwriter orchestration backed by the `DataContainer` tool-call flow.
  - **`MEM0`**: Optional cross-session vector & graph retrieval layer attachable to either mode.
- Update blueprint node definitions and mode selectors so the UI clearly exposes `LEGACY` and `AGENTS` modes, along with a toggle for `MEM0`.

### 9. Dual-Platform UI Parity
- **PC Frontend**:
  - Add visual argument template builder to `NodeConfigPanel.tsx` for `Querier` nodes.
  - Add interactive stage list editor (add, remove, reorder, edit) to `NodeConfigPanel.tsx` for `ScriptwriterPipeline` nodes.
- **Mobile Frontend**:
  - Extend the mobile config dispatcher in `MobileNodeConfigForms.tsx` to render dedicated forms for all 8 missing node variants.
  - Implement mobile adaptations of `SchemaEditorModal`, `UiDesignerModal`, and `PresetActionWhitelistModal` within `MobilePresetDetailView.tsx`.
- **Debug Drawer**:
  - Update `AgentDebugDrawer.tsx` to read skills and attributes from the active session schema, defaulting to empty input fields when no schema is active.
- **Code Cleanliness**:
  - Delete empty placeholder files and stub definitions (`character_state_overlays.rs`, unused placeholders in `chat_service.rs`).
  - Retrieve available model IDs from provider capability endpoints rather than hardcoded string arrays.
  - Align `sqlite_ipc_middleware.mjs` with the unified rule definitions or retire redundant evaluation duplicates.

---

## Testing Decisions

### What Makes a Good Test
- Tests must verify external observable behavior (API outputs, state mutations, error codes, and rendered UI states) rather than internal private variables.
- Tests must assert that memory-only operations leave zero records in persistent SQLite tables.
- Tests must verify that custom non-fantasy attribute sets run successfully from initialization through tool mutations without triggering fantasy defaults.
- Tests must verify error conditions: missing attributes must produce structured errors, not clamped defaults.

### Proposed Testing Seams

1. **Agent Pipeline & Turn Execution Seam (Highest Backend Seam)**:
   - **Invocation**: Invoke the session pipeline execution entry point (`execute_agent_turn` / `run_agent_pipeline`) with a complete test preset, memory mode (`LEGACY` vs `AGENTS`, with/without `MEM0`), and user message.
   - **Verification**:
     - Confirm returned narrative text and structured schema output.
     - Confirm state container mutations match tool executions.
     - Confirm ephemeral scratchpad drops completely without creating rows in `agent_drafts`.
     - Confirm execution follows the designated mode pipeline (`LEGACY` vs `AGENTS`).
2. **Tool Plan & Condition Gate Evaluation Seam**:
   - **Invocation**: Pass a `ToolPlan` with generic conditions and custom expressions to the plan evaluation runner.
   - **Verification**:
     - Verify dynamic mathematical resolution without hardcoded formulas.
     - Verify relational operator evaluation across custom attribute names (`sanity`, `credits`).
     - Verify explicit error generation when an operand or attribute is missing.
3. **Dual-Platform Blueprint Configuration Seam**:
   - **Invocation**: Mount node configuration forms across both desktop (`src/`) and mobile (`src-mobile/`) components for all node types.
   - **Verification**:
     - Confirm all 8 previously missing mobile node forms render valid interactive controls.
     - Confirm PC `Querier` and `ScriptwriterPipeline` forms allow adding and editing templates and stages without opening JSON modals.
     - Confirm saving updates the preset blueprint object faithfully.

### Prior Art
- Existing unit and integration tests in `src-tauri/src/services/blueprint_executor.rs` and `src-tauri/src/models/tool_plan.rs`.
- SolidJS component rendering tests in `src/components/blueprint/` and `src-mobile/components/blueprint/`.

---

## Out of Scope

- Re-introducing a standalone `STATELESS` enum or undoing migration 0050 (consolidated `LEGACY` / `AGENTS` + optional `MEM0` remains the canonical design).
- Redesigning the core Tauri IPC architecture or replacing SQLite.
- Introducing a visual visual graph editor for mobile (mobile remains focused on list/card-based form configuration per mobile UX design).
- Implementing multi-agent real-time networking (room sync) beyond existing local single-player orchestration.

---

## Further Notes

- All changes must strictly adhere to `AGENTS.md` and `plans/agent-system-architecture-plan.md`.
- No silent fallbacks or soft clamps are permitted under constraint C2 (Zero-Fallback Errors).
- PC and Mobile codebases must maintain strict UI code independence under constraint C5 (Mobile Frontend Independence) while achieving 100% feature coverage parity under constraint C7 (Dual-Platform Coverage).
