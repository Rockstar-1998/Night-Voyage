# 04: Global Capability Pool & Per-Agent Tool Permissions Modal

**What to build:** Decouple tools from execution gate branches into a global capability repository (local tools, MCP server tools, ActionBridge queries). In every Agent node (`ActorDefinition`, `PipelineStage`, `DirectorConfig`), provide a "Tool Permissions" properties card and an editing modal (matching reference images) allowing creators to search and multiselect allowed tools. During LLM system prompt compilation, only tools explicitly permitted for that active subagent are injected into the Function Calling schema, enforcing strict sandbox isolation.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Global capability registry maintains all available local tools, MCP tools, and ActionBridge commands.
- [ ] Agent node configurations (`ActorDefinitionConfig`, `PipelineStageConfig`, `DirectorConfig`) support `tool_permissions` whitelists.
- [ ] Visual properties panel in PC and Mobile displays the "Tool Permissions" section with an "Edit Permissions" button.
- [ ] "Edit Tool Permissions" modal allows searching and multiselecting allowed tools across categories.
- [ ] Prompt compiler filters available Function Calling tool schemas strictly against the active subagent's whitelist.
