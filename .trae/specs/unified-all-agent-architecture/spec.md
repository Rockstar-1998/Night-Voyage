# Specification: Unified All-Agent Architecture, Graph-Semantic Orchestration, and Code-Defined Presets

**Triage Label**: `ready-for-agent`  
**Reference Standards**: `AGENTS.md` (C1, C2, C3, C5, C7, C8, C9, C10, C11), `GLOSSARY.md`  
**Execution Constraint**: All backend modifications must adhere strictly to the Rust Idiomatic Style (Composition over inheritance, type-driven design, minimal branching) and Night Voyage Guardrails. All graph operations must proceed via sanctioned MCP tools without direct database hacking.

---

## Problem Statement

Creators and developers building interactive tabletop RPG and narrative agent workflows in Night Voyage currently encounter five structural architectural bottlenecks:

1. **Dual-Track Runtime Schism**: The engine separates execution into two mutually exclusive tracks: single-turn legacy/stateless flow and multi-agent orchestration. This schism forces creators to duplicate parallel business graphs on the canvas and forces the Rust backend to maintain two disparate execution engines (`stream_processor.rs` vs `subagent.rs`), creating cognitive and maintenance debt.
2. **Hardcoded Pipeline Anti-Pattern**: Multi-agent workflows (such as Director-Actor and Scriptwriter Reviewer pipelines) are hardcoded as static Rust enumerations and bespoke functions (`run_director_actor_pipeline`, `run_scriptwriter_pipeline`). Creators cannot freely compose custom multi-agent topologies (e.g. four-stage review, duel referee loops, peer debate) without modifying Rust backend source code.
3. **Fragile Schema and Pseudo-XML Extraction**: Model providers across the ecosystem (e.g. OpenRouter gateways, DeepSeek, Qwen, Ollama) provide inconsistent and brittle support for JSON Schema / Structured Outputs. Creators are forced to devise regex-based pseudo-XML fallback parsers (e.g. `<action>...</action>`), leading to parsing crashes and lost state mutations.
4. **Streaming versus Tool Execution Collision**: In single-turn interactions, models cannot simultaneously stream narrative dialogue with zero latency and safely trigger state mutation tools without risking causal hallucinations (e.g. dialogue announcing success before a gated tool failure) or empty dialogue bubbles when models emit tool calls exclusively.
5. **Monolithic JSON Serialization Anti-Pattern**: Exported presets are serialized as monolithic 3500+ line JSON blobs (`.nvpreset.json`). These files couple visual coordinates, UUID strings, UI layouts, and prompt texts into an unreadable web. Large Language Models (LLMs) assisting creators frequently hallucinate non-existent node IDs, corrupt edge connections, and produce syntax errors when attempting to modify presets.

---

## Solution

Deliver a universal, graph-semantic, and code-defined Agent architecture that unifies all session execution under a single cohesive model:

1. **Single-Core Agent Cycle Runtime**: Unify all LLM interactions under a single `AgentCycleRuntime` driven by a dynamic step budget (`max_steps`). A single-turn narrative is modeled as a fast-track `Single-Pass Agent` (`max_steps = 1`), while complex multi-turn deliberation is modeled as a `Multi-Pass Agent` (`max_steps >= 2`), completely eliminating legacy dual-track branches.
2. **First-Class StepBudget Control Nodes**: Introduce a visual `StepBudgetNode` in the blueprint canvas. Placed downstream of branch routers, it physically stamps `max_steps` and `short_circuit_on_tools` onto the execution context, providing hardware-level quota enforcement while decoupling business modes from backend code.
3. **Divide-and-Conquer Streaming & Fallback Narrative**: In single-pass execution, decouple the SSE token stream: stream dialogue characters (`delta.content`) directly to the frontend with zero latency, while silently buffering tool arguments (`delta.tool_calls`). Upon stream termination, execute tools atomically and trigger HUD updates. If a model emits tool calls without dialogue text, synthesize a zero-delay behavioral narrative on the backend without invoking a second API round.
4. **Universal ToolCall State Carrier**: Deprecate reliance on brittle JSON Schema / Structured Outputs and pseudo-XML extraction. All game state updates (currencies, item transactions, stat shifts, todo items) are normalized into standardized Function/Tool Calling payloads.
5. **Pure Blueprint-Semantic Multi-Agent Orchestration**: Eradicate hardcoded Rust pipeline functions. Multi-agent turn dispatch, perspective isolation, quality review gates, and iterative loop-backs are expressed entirely through visual graph topology (Exec pins, typed Data pins, and back-edges).
6. **Code-Defined Presets (`.nv.ts`) via Native Rust AST Parser**: Maintain SQLite (`presets.blueprint_graph`) as the sole physical storage authority on disk. For external export, sharing, and AI assistant editing via MCP, transpile the graph bi-directionally to compact, declarative TypeScript code (`.nv.ts`) using a pure-Rust, zero-Node.js parser (`oxc_parser`), compressing 3500-line JSON blobs into ~150 lines of human- and AI-readable code.
7. **Data-Driven Capability Matrix Adaptation**: Align `MODE_CAPABILITIES` (Edit, Regenerate, Fork, Delete, Rewind, SubmitAbort) with tool-induced state mutations via transactional state snapshots. Maintain zero runtime backward-compatibility clutter in production code, isolating legacy migration into a standalone offline tool (`nv-converter`).

---

## User Stories

### Single-Core Agent Runtime & Step Budget
1. As an end player, I want character dialogue to stream onto the screen with immediate typewriter responsiveness, so that I never perceive lag or application freeze during regular conversation.
2. As an end player, I want inventory and currency displays to update instantly and atomically the moment a character completes their trade dialogue, so that game state never desynchronizes from the narrative.
3. As a tabletop RPG creator, I want to drop a `StepBudgetNode` onto any execution branch on the canvas, so that I can visually dictate the exact maximum reasoning steps allowed for that branch.
4. As a creator, I want to configure `max_steps = 1` and `short_circuit_on_tools = true` on fast narrative paths, so that simple interactions terminate deterministically in exactly one API turn without unnecessary token expenditure.
5. As an engine operator, I want any reasoning loop that exceeds its allotted step budget to trip a circuit breaker and emit a visible error, so that runaway subagent loops can never deplete API balances or cause infinite hangs (C2 Zero-Fallback).
6. As an end player, I want the system to automatically generate a brief descriptive action narrative if a model emits only tool calls without dialogue text, so that I never see an empty message bubble on screen.

### Pure Graph-Semantic Orchestration
7. As a creator, I want to connect an upstream drafting agent to a downstream critic agent using standard Exec and Data pins on the canvas, so that multi-agent pipelines are visually self-evident without Rust code changes.
8. As a creator, I want to route a critic agent's `Reject` output pin back to an upstream generator node with an iteration counter limit, so that iterative revision loops can be authored visually.
9. As a creator, I want each agent node to expose an explicit tool permissions whitelist, so that subagents only receive schemas for tools they are authorized to invoke.
10. As a player, I want critic and auditing subagents to operate strictly in read-only inspection mode, so that internal content evaluation phases cannot inadvertently modify my character's gold or inventory.
11. As a creator, I want to package complex multi-node tool evaluation chains into reusable Macro assets, so that top-level multi-agent graphs remain readable and organized.

### ToolCall as Universal State Carrier
12. As a creator using third-party model gateways (such as DeepSeek or Qwen via OpenRouter), I want state updates to execute via standard Function/Tool Calling, so that I am not blocked by broken or unsupported JSON Schema implementations.
13. As a creator, I want to eliminate regex-based XML tag parsing rules from my prompts, so that prompt context space is preserved for narrative guidelines rather than format workarounds.
14. As an end player, I want all tool calls made during a turn to be inspectable in the Agent Timeline drawer, so that I have complete transparency over behind-the-scenes state mutations.

### Code-Defined Presets (`.nv.ts`) & AI-Assisted Authoring
15. As an AI coding assistant interacting with Night Voyage via MCP, I want to inspect presets as clean TypeScript code (`.nv.ts`), so that I can read the entire preset logic in 150 lines without hallucinating node IDs or syntax errors.
16. As an AI assistant, I want to modify prompts, add tools, or configure step budgets by editing TypeScript code and submitting it via `nv_preset_import_code`, so that I can reliably assist creators in upgrading their blueprints.
17. As an advanced creator, I want to export my preset as a `.nv.ts` file, inspect it in VSCode, commit it to Git with clean diffs, and re-import it into Night Voyage without loss of functionality.
18. As a desktop or mobile user, I want Night Voyage to parse and compile `.nv.ts` files in memory without needing Node.js or npm installed on my device, so that code-defined presets function seamlessly on Windows and Android APKs.
19. As a creator importing a `.nv.ts` script without manual coordinate metadata, I want the canvas to automatically lay out nodes in a clean topological hierarchy using an integrated Dagre layout engine, so that I do not have to manually arrange overlapping nodes.

### Capability Matrix & State Transactional Integrity
20. As a player clicking "Regenerate" on a turn where gold was deducted, I want the deducted gold to be automatically restored before the new generation starts, so that retrying a turn never causes duplicate charges.
21. As a player clicking "Rewind" or "Delete" on a historical turn, I want all character stats and inventory items to roll back to that exact historical snapshot, so that the game state remains coherent with the visible chat history.
22. As a player branching a conversation using "Fork", I want the new branch to clone the game state snapshot at that specific turn, so that the parallel storyline starts with accurate historical data.
23. As a player clicking "Abort" while a multi-step agent is deliberating, I want the in-flight HTTP stream to terminate immediately and any uncommitted tool buffers to be discarded, so that aborted turns leave zero corrupted state.

---

## Implementation Decisions

### 1. Single-Core Agent Loop Runtime (`AgentCycleRuntime`)

- **Unified Cycle Configuration**:
  The execution layer in `services::agent` will expose a single cycle runner replacing `run_multi_agent_round` and legacy branching in `stream_processor.rs`:
  ```rust
  pub struct AgentCycleConfig {
      pub max_steps: usize,
      pub short_circuit_on_first_step: bool,
      pub system_blocks: Vec<String>,
      pub user_prompt: String,
      pub allowed_tools: Vec<LlmToolDefinition>,
  }

  pub enum AgentCycleOutcome {
      TextDelivered { text: String, steps_taken: usize },
      ShortCircuitedWithTools { text: String, executed_tools: Vec<ExecutedToolReceipt> },
      CircuitBreakerTripped { steps_taken: usize, reason: String },
  }
  ```
- **Cycle Execution Invariant**:
  - Step 1 initiates an HTTP streaming request with authorized tool definitions.
  - If `finish_reason == "stop"` and no tool calls exist, finalize dialogue and return `TextDelivered`.
  - If `finish_reason == "tool_calls"`:
    - Execute tools atomically against the session state container: tool effects stage into an in-memory working copy and land as one write at round end (round-scoped all-or-nothing; no SQLite transaction is held open across LLM/tool round-trips).
    - If `short_circuit_on_first_step == true` (enforced when `max_steps == 1`), commit transaction, emit HUD patches, and immediately return `ShortCircuitedWithTools` without round 2.
    - If `max_steps > 1` and `current_step < max_steps`, append `LlmContentPart::ToolResult` to history and loop to the next step.
    - If `current_step >= max_steps`, trip the circuit breaker and return `CircuitBreakerTripped` with structured diagnostics (C2).

### 2. Physical Step Budget Node (`StepBudgetNode`)

- **Blueprint Model Schema**:
  Add `NodeType::StepBudget` to `models::blueprint`:
  ```rust
  pub struct StepBudgetConfig {
      pub max_steps: usize,
      pub short_circuit_on_tools: bool,
      pub is_locked: bool,
  }
  ```
- **Pin Definitions**:
  - One input Exec pin (`in`).
  - One output Exec pin (`out`).
- **Compiler Traversal Semantics**:
  In `blueprint_executor::traverse`, encountering a `StepBudget` node mutates `BlueprintExecutionResult`:
  - `result.step_budget = cfg.max_steps;`
  - `result.short_circuit_on_first_step = cfg.short_circuit_on_tools;`
  - Traversal immediately advances to the connected `out` node without branch interruption.

### 3. Divide-and-Conquer Streaming Pipeline

- **Stream Demuxing**:
  `stream_processor.rs` will process incoming SSE deltas via two distinct paths:
  - Text tokens (`delta.content`): Emitted immediately to the SolidJS frontend via `llm-stream-chunk` for typewriter rendering.
  - Tool tokens (`delta.tool_calls`): Diverted to an in-memory `StreamingToolAccumulator` buffer without emitting dialogue events.
- **Stream Termination & Atomic Commit**:
  When the SSE stream signals `[DONE]`:
  - Validate and parse JSON payloads in `StreamingToolAccumulator`.
  - Execute tool plans sequentially against `AppState`.
  - Emit `session:hud_state_patch` to trigger reactive SolidJS HUD updates.
  - Emit `agent:timeline_event` to record tool execution trace.
  - If `short_circuit_on_first_step` is active, terminate the turn immediately.
- **Zero-Delay Fallback Narrative**:
  If `assistant_content.trim().is_empty()` and executed tools are present, the backend synthesizes a compact action summary string (`*（完成了交互结算：[工具回执摘要]）*`) and commits it as the assistant message body, preventing blank UI bubbles without incurring second-round latency.

### 4. Code-Defined Presets (`.nv.ts`) via `oxc_parser`

- **Storage versus Interchange Separation**:
  - SQLite `presets.blueprint_graph` retains the canonical in-memory graph representation.
  - External export/import and AI MCP operations operate on `.nv.ts` scripts conforming to the `@night-voyage/blueprint` DSL specification.
- **Pure-Rust AST Transpiler Engine**:
  - Integrate `oxc_parser` into `services::blueprint_codec` (no Node.js or V8 runtime dependencies).
  - **AST to Graph**: Parse top-level statements (`definePreset.state`, `Macro.define`, `Tools.define`, `flow.branch`), extract parameters, and construct the node/edge topology. Auto-generate visual coordinates using the built-in layered topological layout approximation in `blueprint_codec` (no external Dagre dependency).
  - **Graph to AST**: Traverse `BlueprintGraph` nodes and macros, formatting clean, idiomatic TypeScript source code with standardized indentation.
- **MCP Endpoints**:
  - `nv_preset_export_code(preset_id)`: Serializes SQLite graph to `.nv.ts` string.
  - `nv_preset_import_code(preset_id, code_ts)`: Compiles `.nv.ts` string, runs static validation, updates SQLite, and emits `blueprint:refreshed`.
- **Front-Mounted Authoring Surfaces (C10)**: The blueprint editors on desktop and mobile expose `.nv.ts` export/import buttons that call the same service path as the MCP tools (`blueprint_export_preset_code` / `blueprint_import_preset_code`) and listen to `blueprint:refreshed` to reload the open graph when external imports land.

### 5. Data-Driven Capability Matrix & Snapshot Rollback

- **Matrix Re-Alignment (`MODE_CAPABILITIES`)**:
  - Update `services::chat::mode::MODE_CAPABILITIES` to account for agent tool mutations.
  - Add `RoundSnapshotRepository` capturing SQLite state deltas per turn.
- **Transactional State Operations**:
  - `Regenerate`: Roll back `game_state` using the round's pre-execution snapshot before launching the replacement cycle.
  - `Rewind` & `Delete`: Cascade state rollbacks across all undone/deleted rounds.
  - `SubmitAbort`: Cut transport connection and discard uncommitted `StreamingToolAccumulator` buffers immediately.
- **Zero Production Legacy Shims**:
  - Remove legacy branching flags from `stream_processor.rs`.
  - Package old preset/session migration logic into a standalone offline converter binary (`nv-converter`), keeping the production codebase clean.

### 6. Graph-Semantic Orchestration Semantics

- **Pipeline Enum As Compile-Route Label**: `AgentPipeline` remains a data-side label whose only duty is selecting which plan the compiler builds (single-pass cycle vs director plan). It carries no execution logic of its own; runtime dispatch is fully graph-driven via `graph_orchestrator`.
- **FanOut Actor-Miss Degradation**: When a director FanOut stage references an actor name that no `ActorDefinition` node binds, the stage performs as an empty persona (no system-prompt specialization) instead of failing the whole run. The degradation is never silent (C2): it logs explicitly, writes a `fanout:actor_def_missed` marker into the director Scratchpad, and emits a timeline Info event visible in the Agent Timeline.
- **Invalid Agent-Loop Configurations Fail At Compile Time**: `StepBudget.max_steps == 0` and `AgentModeSwitch.max_tool_rounds < 1` are invalid budgets (the loop would not allow even one step); both hard-error during graph compilation (`InvalidStepBudget` / `InvalidToolRounds`) and are never silently clamped to 1 at runtime (C2).

### 7. Execution-Route Value Source and Tool Exposure Policy

- **`agent_pipeline` Constant Source**: `BlueprintExecutionContext.agent_pipeline` carries the architecture key (`"single"` / `"director_actor"` / `"scriptwriter"`) resolved from the `AgentModeSwitch` node's Gate selection (falling back to `default_mode`), using the exact same pure decision (`resolve_pipeline_key`) as the runtime `resolve_pipeline`. The constant source `"agent_pipeline"` exposes this key to graph `Branch` nodes, so the exec flow routes by the real pipeline: the stateless single-pass branch stamps `StepBudget(max_steps=1, short_circuit_on_tools=true, tool_policy=settlement_only)` before the rule chain, while `director_actor` / `scriptwriter` branches reach the shared rule chain unstamped. A graph using this source without a declared `agent_mode_switch` hard-errors (C2).
- **ToolKind Classification**: every `ToolDefinition` carries an explicit `tool_kind` (`"settlement"` = state-mutating contracts such as purchases and workspace writes; `"query"` = read-only lookups that feed multi-step reasoning). Unclassified tools (legacy graphs) never enter a settlement-only whitelist. The bidirectional `.nv.ts` codec round-trips `tool_kind` verbatim; absent key means unclassified.
- **StepBudget Tool Policy**: `StepBudgetConfig.tool_policy` (`"all"` default / `"settlement_only"`) is stamped into `BlueprintExecutionResult` during traversal. Under `settlement_only`, the single-pass cycle exposes only settlement-class contracts in the request whitelist — the model produces prose and state-mutating tool calls in one request, tool receipts are never fed back, so query tools have no consumer. Compile preview applies the same filter: the preview whitelist IS the runtime request whitelist (C2: one source of truth, no dual bookkeeping).
- **Macro Multi-Instance Identifier Legality**: prompt `identifier` uniqueness is validated on the pre-expansion graph only. Multiple instances of the same macro (e.g. the schema-on and schema-off rails each mounting one 思维链规则 instance) expand to repeated identifiers by design and must not be rejected; hand-written duplicates in the top-level graph still hard-error.

---

## Testing Decisions

### What Makes a Good Test
- Tests must assert external observable behaviors: emitted Tauri events (`llm-stream-chunk`, `game-state:patch`, `agent:timeline_event`), final database state snapshots, and HTTP protocol payloads.
- Tests must never assert internal private helper functions, AST token offsets, or transient buffer memory pointers.
- Tests must rigorously verify failure and boundary conditions: circuit breaker tripping upon exceeding `max_steps`, fallback narrative injection when content is empty, and transactional state rollback on abort.

### Proposed Testing Seams

1. **Cycle Runtime & Step Budget Seam (Highest Backend Seam)**:
   - **Invocation**: Invoke `AgentCycleRuntime::run_cycle` with mocked LLM providers configured with varying responses (pure text, single tool call, repeated tool loops).
   - **Verification**:
     - Confirm that `max_steps = 1` terminates after step 1 with executed tools and zero follow-up requests.
     - Confirm that `max_steps = 3` loops twice upon tool calls and terminates on the third text response.
     - Confirm that exceeding `max_steps` returns a `CircuitBreakerTripped` error without deadlocking.
2. **Streaming Demux & Fallback Seam**:
   - **Invocation**: Feed synthetic mixed SSE chunks containing both `delta.content` and `delta.tool_calls` into `stream_processor`.
   - **Verification**:
     - Assert that text events fire immediately per chunk.
     - Assert that tool calls execute only after stream completion.
     - Assert that empty text streams with valid tool calls produce the synthesized fallback narrative in SQLite.
3. **AST Bidirectional Codec Seam**:
   - **Invocation**: Compile a `.nv.ts` fixture into `BlueprintGraph`, then transpile it back to `.nv.ts`.
   - **Verification**:
     - Assert that all macros, tools, and branch pipelines round-trip losslessly.
     - Assert that invalid TypeScript syntax returns structured compiler errors with line and column numbers.
4. **State Transactional Rollback Seam**:
   - **Invocation**: Execute a tool-calling turn that mutates player gold, then trigger `ChatService::regenerate_round`.
   - **Verification**:
     - Confirm that player gold rolls back to its exact pre-round baseline in SQLite before the new turn executes.

### Prior Art
- Unit tests in `src-tauri/src/services/blueprint_executor.rs`.
- Mode capability tests in `src-tauri/src/services/chat/mode.rs`.
- Stream processor error recovery tests in `src-tauri/src/services/stream_processor.rs`.

---

## Out of Scope

- Implementing an in-browser live TypeScript execution sandbox (the `.nv.ts` format is strictly a declarative AST specification, not an arbitrary JS runtime).
- Modifying user-owned blueprint preset files or assets without explicit user confirmation.
- Maintaining runtime compatibility shims for obsolete legacy formats within the primary production executable (handled exclusively via the standalone `nv-converter` tool).
- Modifying SQLite migrations predating migration 0050.

---

## Further Notes

- Full compliance with `AGENTS.md` (Constraints C1 through C11) is mandatory across all implementation phases.
- The desktop frontend (`src/`) and mobile frontend (`src-mobile/`) must remain strictly decoupled (Constraint C5) while receiving identical event streams from the backend (Constraint C7).
