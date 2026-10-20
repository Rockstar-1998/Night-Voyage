# 05: Data-Driven ToolReturn Templating & Neutral Receipts

**What to build:** Allow scenario creators to customize tool execution feedback receipts via `ToolReturn` blueprint node templates, and replace the hardcoded fantasy RPG return string with a genre-neutral, data-driven fallback message when no template is configured.

**Blocked by:** 02: Blueprint-Driven Initial State & Genre-Neutral Engine Models, 03: Dynamic Operand Resolution & Expression Calculator

**Status:** completed

- [x] Tool return messages are dynamically formatted using the template configured on the blueprint `ToolReturn` node.
- [x] Template placeholders (e.g. `{tool_name}`, `{result}`, `{mutated_stats}`) are substituted with actual execution outputs.
- [x] Hardcoded fantasy receipt string (`"【{}】执行成功。当前金币: {}G，当前负重: {}/{}kg"`) is completely removed.
- [x] When no template is provided, a neutral status receipt is returned with execution status and modified keys, without assuming currency or weight units.
