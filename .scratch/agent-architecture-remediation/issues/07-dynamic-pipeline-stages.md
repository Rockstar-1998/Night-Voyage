# 07: Dynamic Scriptwriter Pipeline Stages & Schema Beat Extraction

**What to build:** Generalize the scriptwriter pipeline runner to execute an arbitrary sequence of dynamic stages defined by the blueprint node, replace hardcoded JSON extraction strings in the director actor with formal `InvokeSchema` node validation, and provide PC creators with a visual stage list manager in `NodeConfigPanel`.

**Blocked by:** 01: In-Memory Text Scratchpad & Native Tool Pipeline

**Status:** ready-for-agent

- [ ] Scriptwriter pipeline runner executes an arbitrary ordered list of stages from the blueprint configuration instead of hardcoded 3-phase execution.
- [ ] Director actor enforces scene beat extraction via standard `InvokeSchema` structured schema validation, removing hardcoded prompt text directives.
- [ ] Desktop `NodeConfigPanel` renders a visual stage list editor (add, remove, reorder, configure) for `ScriptwriterPipeline` nodes, eliminating raw JSON editing.
- [ ] Multi-stage pipeline runs end-to-end with dynamic stages passing text through the in-memory scratchpad.
