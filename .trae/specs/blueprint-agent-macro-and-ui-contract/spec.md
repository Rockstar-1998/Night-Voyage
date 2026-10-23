# Specification: Blueprint Agent Macro Architecture, UI-First Data Contract, and Rejection Pipelines

**Triage Label**: `ready-for-agent`  
**Reference Documents**: `plans/agent-system-architecture-plan.md`, `AGENTS.md` (C1, C2, C3, C4, C5, C7, C8, C9, C10, C11)  
**Execution Constraint**: When creating or modifying blueprints, only MCP tools may be used. Direct `.ps1` scripts, direct SQLite database edits, and Python scripts are strictly prohibited.

---

## Problem Statement

Creators attempting to build modular, production-grade agent workflows and tabletop RPG systems in Night Voyage currently encounter four severe architectural bottlenecks in the blueprint and runtime systems:

1. **Pseudo-Agent Prompt Camouflage**: In existing presets (such as V2.2), multi-agent modes (Director-Actor and Scriptwriter) are disguised as mutually exclusive branches under a `MutexGate` leading merely to plain-text `Prompt` nodes. The session engine possesses no visibility into true multi-agent execution, while the visual canvas completely lacks structural agent definitions, roles, and isolated subagent scopes.
2. **Disconnected Data Lifecycle & Missing UI Contracts**: Tools (such as inventory checks and stat mutations) are currently defined in a vacuum without any declared data destination. When UI is not designed first, tool mutations occur without visual manifestation or type validation. Conversely, when UI widgets require specific attributes, missing or mismatched data causes silent rendering failures or application freeze instead of failing fast.
3. **Mutex Gate Anti-Pattern for Toolsets**: Blueprint tools are wired into mutually exclusive branches of a `MutexGate`, meaning an active session can only activate a single tool branch (e.g. choosing inventory operations permanently disables player stat checks or schema invocations in that turn). Tools are not exposed as a coherent, parallel capability pool.
4. **Graph Spaghetti & Lack of Subgraph Encapsulation**: Implementing a complete atomic tool chain (parameter parsing, operand pre-calculation, condition gating, state mutation, and receipt templating) requires 5 to 7 interconnected nodes. Authoring multiple tools turns the visual canvas into an unreadable, unmaintainable web of nodes due to the total absence of a visual macro or subgraph encapsulation mechanism.
5. **Absence of Pipeline Rejection Loops**: Multi-stage generation pipelines are strictly linear. There is no first-class canvas representation or runtime scheduling mechanism to reject substandard drafts back to an upstream stage with critique feedback and circuit-breaker loop protection.

---

## Solution

Deliver a cohesive, UI-contract-driven, and macro-encapsulated blueprint architecture that provides full visual sovereignty over agent orchestration:

1. **Sovereign Blueprint Topology & Coarse Session Agnosticism**: The session runtime only differentiates between `legacy` (single-turn sliding window) and `agent` (multi-phase orchestration) tracks alongside optional `mem0` memory. The exact multi-agent architecture (Single, Director-Actor, Scriptwriter) is 100% authored through visual blueprint graph topology using dedicated structural nodes (`AgentModeSwitch`, `DirectorConfig`, `ActorDefinition`, `ScriptwriterPipeline`) rather than prompt text hacks.
2. **UI-First Data Contract & Static Compile-Time Enforcement**: Establish a UI-first lifecycle. UI layouts designed in the UI Designer automatically aggregate and expose a `RequiredDataInterface` specifying mandatory attributes and data structures. The blueprint compiler statically validates that the graph's `InitialStateConfig` and tool outputs satisfy all required fields; any missing attribute or type mismatch triggers a visual red compile error and physically blocks saving and session launch (strict C2 Zero-Fallback).
3. **Global Capability Pool & Per-Agent Permission Whitelisting**: Replace mutually exclusive tool branches with a global capability repository. All custom tools, MCP tools, and ActionBridge commands are registered globally, while every Agent node exposes a dedicated "Tool Permissions" modal allowing creators to multiselect allowed tools. Unchecked tools remain strictly hidden from the LLM during that agent's reasoning.
4. **UE5-Style Inline Expanded Blueprint Macros**: Introduce a first-class visual Macro system modeled after Unreal Engine 5. Presets maintain a dedicated macro library where subgraphs begin with an `Inputs` node and terminate with an `Outputs` node. Macros feature white triangular Exec flow pins and four distinct typed data pins (Number, String, Boolean, Object). During compilation, macros are inlined without runtime stack overhead, collapsing sprawling multi-node chains into clean, reusable single nodes.
5. **Execution Pipeline with Rejection Loops & Circuit Breakers**: Enable cyclical feedback loops within visual pipelines. Reviewer nodes provide `Approved` and `Reject` execution pins; `Reject` pins wire back-edges to upstream generators while injecting structured `{feedback}`. Built-in `max_loop_count` guards prevent infinite loops and enforce deterministic fallback.
6. **Strict MCP-Driven Modification Protocol**: All blueprint creation, graph topology updates, and verification operations must proceed exclusively through MCP tool invocations, prohibiting external ad-hoc script execution or direct database hacking.

---

## User Stories

### UI-First Data Contract & Type Safety

1. As a tabletop RPG creator, I want the UI Designer to automatically aggregate all bound widget fields into a `RequiredDataInterface`, so that my interface's data requirements are formally documented without manual double-entry.
2. As a creator, I want the blueprint compiler to statically verify that `InitialStateConfig` supplies every stat and collection declared in the UI data interface, so that sessions never launch with undefined or missing variables.
3. As a creator, I want the blueprint canvas to immediately highlight missing or type-mismatched UI fields with a persistent red banner and node badges, so that I can resolve contract errors before testing.
4. As a creator, I want the editor to physically disable the "Save and Publish" action whenever UI contract verification fails, so that broken presets cannot be saved or distributed.
5. As an end player, I want the HUD to reliably display all configured gauges and inventory grids immediately upon session start, so that I never experience blank widgets or NaN values.

### Global Tool Pool & Per-Agent Permission Whitelisting

6. As a creator, I want to define all custom tools (e.g. `buy_item`, `cast_spell`, `check_inventory`) in a parallel global capability pool, so that tools are not trapped in mutually exclusive execution branches.
7. As a creator, I want each Agent node (`ActorDefinition`, `PipelineStage`, `DirectorConfig`) to display an integrated "Tool Permissions" section in its properties panel, so that I can manage capabilities on a per-agent basis.
8. As a creator, I want to open an "Edit Tool Permissions" modal featuring categorised lists (Local Tools, MCP Servers, ActionBridge Queries) with search and multiselect checkboxes, so that I can rapidly configure tool whitelists.
9. As a security-conscious creator, I want tools not explicitly whitelisted for an agent to be completely excluded from that agent's LLM function-calling schema, so that subagents cannot invoke unauthorized or destructive mutations.
10. As a player in a multi-agent session, I want critic and reviewer subagents to only possess read-only inspection tools, so that audit phases can never inadvertently deduct gold or alter inventory.

### UE5-Style Blueprint Macros

11. As a creator, I want to create, name, and manage reusable Macro assets within the preset's Macro Library, so that I can modularise recurring logic across my blueprints.
12. As a creator, I want to double-click any Macro instance on the canvas to open its dedicated subgraph canvas, so that I can view and edit its internal logic in isolation.
13. As a creator, I want every Macro subgraph to be bounded by a single `Inputs` entry node and one or more `Outputs` exit nodes, so that entry and exit semantics match industry-standard visual scripting.
14. As a creator, I want to add custom Exec pins to Macro input and output nodes, so that a macro can represent multiple branching exit paths (e.g. `Pass` vs `Blocked`).
15. As a creator, I want to define typed Data Pins on Macro inputs and outputs with standard types (`Number`, `String`, `Boolean`, `Object/Any`), so that data can be cleanly passed into and out of the macro.
16. As a creator, I want typed Data Pins to display distinct color-coded sockets and enforce type matching during wire dragging, so that I am prevented from wiring incompatible data types.
17. As an engine runtime developer, I want the blueprint compiler to inline Macro instances into the parent graph topology during compile time, so that macro execution introduces zero runtime call-stack overhead or dynamic indirection.
18. As a creator, I want to collapse a sprawling 6-node tool evaluation chain (`Calculator -> ConditionGate -> Calculator -> ToolReturn`) into a single `[Macro: ItemPurchaseRule]` node, so that my top-level canvas remains clean and readable.

### Sovereign Multi-Agent Orchestration & Rejection Loops

19. As a creator, I want the blueprint canvas to clearly branch from an `AgentModeSwitch` node into distinct structural pathways (`SingleAgent`, `DirectorActor`, `ScriptwriterPipeline`), so that the active multi-agent architecture is visually self-evident.
20. As a creator, I want to place explicit `ActorDefinition` nodes linked to a `DirectorConfig` node, so that each NPC or persona has an observable definition on the canvas rather than an invisible prompt snippet.
21. As a creator, I want reviewer nodes (`Critic`, `QualityGate`) in a scriptwriter pipeline to expose both `Approved` and `Reject` Exec output pins, so that content quality gates can be explicitly routed.
22. As a creator, I want to draw a directional back-edge from a `Reject` pin to an upstream generator node (e.g. `Drafter`), so that substandard content is automatically routed back for revision.
23. As a creator, I want a rejection loop to automatically inject the reviewer's feedback text into an ephemeral `{feedback}` variable, so that the upstream generator can incorporate specific revision instructions.
24. As an engine operator, I want every rejection loop to enforce a configurable `max_loop_count` (defaulting to 2), so that failed revisions trigger a deterministic circuit-breaker termination rather than an infinite generation loop.
25. As an author, I want the `AgentDebugDrawer` timeline to clearly annotate rejection events (`nudge_retry` / `loop_reject`) with iteration counts, so that I can verify loop progression and circuit-breaker behavior in real time.

### Authoring Tooling & MCP Integrity

26. As an automated agent or creator, I want all blueprint graph mutations (adding nodes, updating configurations, wiring edges, managing macros) to be fully supported via dedicated MCP tools, so that graph operations are safe and auditable.
27. As a project auditor, I want a strict ban on direct database SQL modifications and script-based graph injection, so that the blueprint graph's integrity and schema invariants are never corrupted.

---

## Implementation Decisions

### 1. UI-First Contract Architecture & Static Linting

- **UI Contract Extractor**:
  The UI Designer serializer will analyze all container widgets (`PanelContainer`, `GridContainer`, `TabsContainer`) and leaf controls (`StatBar`, `DataLabel`, `InventorySlotGrid`, `Badge`, `AvatarFrame`). Any bound state path starting with `stats.` or `flags.`, as well as inventory dependencies, will be gathered into a formal interface:
  ```json
  {
    "required_stats": {
      "credits": { "type": "number", "min": 0 },
      "sanity": { "type": "number", "min": 0, "max": 100 }
    },
    "required_inventory": true,
    "required_flags": ["location"]
  }
  ```
- **Blueprint Static Verifier**:
  A new static analysis stage will execute during blueprint graph compilation and pre-save validation. It will verify that:
  - An `InitialStateConfig` node exists and declares all entries in `required_stats` with compatible initial values.
  - If `required_inventory` is true, inventory support is configured in `InitialStateConfig`.
  - Missing declarations or scalar/collection type mismatches produce structured compile errors associated with specific node IDs.
- **Visual Error Indicators**:
  The frontend `BlueprintCanvas` header will display a reactive contract badge (green "Contract Aligned" vs red "N Missing Fields"). When errors exist, the "Save" and "Run" buttons will be disabled, and missing fields will be listed in an inspector drawer.

### 2. UE5-Style Blueprint Macro Subsystem

- **Macro Definition Model**:
  The preset schema will incorporate a top-level `macros` dictionary:
  ```rust
  pub struct BlueprintMacro {
      pub id: String,
      pub name: String,
      pub description: String,
      pub category: String,
      pub inputs: Vec<MacroPinDefinition>,
      pub outputs: Vec<MacroPinDefinition>,
      pub nodes: Vec<BlueprintNode>,
      pub edges: Vec<BlueprintEdge>,
  }
  
  pub struct MacroPinDefinition {
      pub id: String,
      pub name: String,
      pub pin_type: PinType, // Exec | Number | String | Boolean | Object
  }
  ```
- **Graph Inlining Pipeline**:
  The blueprint compilation pass in the backend engine will incorporate an early inline expansion step:
  - For each `NodeType::MacroInstance` node, retrieve the referenced `BlueprintMacro` by ID.
  - Clone the macro's internal nodes and edges with namespaced unique IDs (`macro_inst_{id}_{node_id}`).
  - Rewire external incoming edges targeting the macro's input pins to the internal `Inputs` proxy node's corresponding output sockets.
  - Rewire internal edges targeting the internal `Outputs` proxy node to the external target nodes connected to the macro's output pins.
  - Remove the `MacroInstance`, `Inputs`, and `Outputs` proxy nodes.
  - This ensures that execution, evaluation, and condition engines operate on a single flat topological graph without specialized runtime call-stack management.

### 3. Rejection Loop Execution & Circuit Breakers

- **Back-Edge Graph Semantics**:
  The graph validator will relax strict Directed Acyclic Graph (DAG) requirements solely for edges originating from `Reject` pins and designated loop-back sockets.
- **Loop Context State**:
  The execution engine will track loop iteration state within the session's active turn context:
  ```rust
  pub struct RejectionLoopState {
      pub loop_id: String,
      pub current_iteration: u32,
      pub max_iterations: u32,
      pub last_critique: Option<String>,
  }
  ```
- **Feedback Injection Protocol**:
  When a rejection transition fires:
  - `current_iteration` increments.
  - The critique text generated by the reviewer stage is stored in the ephemeral scratchpad under `{feedback}` and `{stage_id.critique}`.
  - If `current_iteration > max_iterations`, the circuit breaker trips: the execution aborts the loop, emits an `agent:timeline_event` with status `blocked` / `circuit_breaker_tripped`, and executes the designated fallback terminal path (or forces progression with an explicit warning).

### 4. Global Capability Repository & Per-Agent Tool Permissions

- **Preset Capability Registry**:
  Tools will no longer be attached exclusively as downstream children of execution gates. The preset asset will maintain a global capability list comprising:
  - Local atomic blueprint tool definitions (`ToolDefinition` chains or Tool Macros).
  - Configured MCP Server tools.
  - Whitelisted ActionBridge system queries.
- **Agent Permission Whitelists**:
  Every agent definition (`ActorDefinitionConfig`, `PipelineStageConfig`, `DirectorConfig`) will feature an explicit `tool_permissions` block:
  ```rust
  pub struct AgentToolPermissions {
      pub allow_all: bool,
      pub allowed_tools: Vec<String>,
      pub require_approval: Vec<String>,
  }
  ```
- **Prompt Compiler Enforcement**:
  When compiling the system prompt and Function Calling definitions for a specific subagent turn, the compiler will filter the global tool registry against that agent's `allowed_tools`. Unlisted tools will be entirely omitted from the API request payload.

### 5. Canvas Modernization & Preset V2.2 Deprecation

- The obsolete V2.2 preset (`Night Voyage 全能进阶核心预设 V2.2`) with pseudo-agent prompt gates and mutex-wrapped tools will be formally deprecated and superseded by a compliant `Night Voyage 全能核心预设 V3.0 (宏化智能体与契约驱动版)`.
- All blueprint updates will be scripted exclusively through MCP commands calling Tauri backend service endpoints, completely eschewing ad-hoc `.ps1` scripts, Python scripts, or direct SQLite queries.

---

## Testing Decisions

### What Makes a Good Test

- Tests must assert external observable behaviors: rendered UI contract validation errors, emitted Tauri timeline events (`agent:timeline_event`), structured JSON-RPC responses, and mutated state container snapshots.
- Tests must never assert internal private helper functions or volatile DOM CSS class names.
- Tests must verify failure modes: missing UI contract fields must halt compilation, unwhitelisted tools must be absent from LLM payloads, and rejection loops exceeding limits must trip circuit breakers deterministically.

### Proposed Testing Seams

1. **Blueprint Compilation & Static Contract Seam (Highest Backend Seam)**:
   - **Invocation**: Invoke `blueprint_executor::compile_and_validate_blueprint` with varied preset graphs (matching UI vs missing UI attributes, valid macros vs invalid pin connections).
   - **Verification**:
     - Confirm that missing UI fields return structured contract mismatch errors.
     - Confirm that valid macro graphs successfully inline into flat topological execution orders.
     - Confirm that invalid data pin connections (e.g. Number wired to Object) fail compile validation.
2. **Rejection Pipeline & Circuit Breaker Execution Seam**:
   - **Invocation**: Run an orchestrated turn with a rejection loop where the reviewer subagent repeatedly returns rejection verdicts.
   - **Verification**:
     - Confirm that iterations 1 and 2 re-invoke the generator stage with updated `{feedback}` scratchpad text.
     - Confirm that iteration 3 trips the circuit breaker and terminates without crashing or deadlocking.
     - Confirm zero disk writes to SQLite `agent_drafts`.
3. **Agent Tool Whitelist Filtering Seam**:
   - **Invocation**: Build provider payloads for two distinct subagents in the same session (e.g. Drafter with `write_text` vs Critic with `read_text`).
   - **Verification**:
     - Verify that the serialized OpenAI/Anthropic tool schemas contain strictly the permitted tools for that subagent.
4. **End-to-End MCP Blueprint Manipulation Seam**:
   - **Invocation**: Use MCP blueprint tools to construct a macro, wire it into a graph, attach tool permissions, and save.
   - **Verification**:
     - Verify that the resulting preset JSON parses cleanly and passes full contract validation.

### Prior Art

- Existing unit tests in `src-tauri/src/services/blueprint_executor.rs` and `src-tauri/src/models/tool_plan.rs`.
- ActionBridge router tests in `src-tauri/src/services/action_bridge.rs`.
- SolidJS component test patterns in `src/components/blueprint/` and `src-mobile/components/blueprint/`.

---

## Out of Scope

- Implementing a visual real-time physics engine or 3D canvas viewport.
- Supporting arbitrary recursive macro loops (macros invoking themselves), which remains strictly forbidden to preserve compile-time determinism.
- Writing Python or PowerShell batch migration scripts (all authoring and verification will be performed via MCP tools per user constraint).
- Undoing the database migration 0050 (`STATELESS` consolidation into `LEGACY` remains canonical).

---

## Further Notes

- Strict adherence to `AGENTS.md` is mandatory throughout implementation.
- All errors across contract validation, tool permissions, and circuit breakers must adhere to Constraint C2 (Zero-Fallback Errors): never default to undefined values, never clamp silently, and never suppress failure.
- Both desktop (`src/`) and mobile (`src-mobile/`) frontends must maintain independent implementations (Constraint C5) while achieving 100% parity across macro inspection and tool permission modals (Constraint C7).
