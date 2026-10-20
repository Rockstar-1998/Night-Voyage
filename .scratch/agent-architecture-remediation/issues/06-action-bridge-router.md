# 06: Extensible ActionBridge Whitelist Router & Visual Query Config

**What to build:** Transform the ActionBridge from a static 3-branch command dispatcher into an extensible, whitelist-controlled dispatch router, and provide desktop creators with an intuitive visual form in `NodeConfigPanel` for `Querier` node argument templates instead of requiring raw JSON editing.

**Blocked by:** None (can start immediately)

**Status:** completed

- [x] ActionBridge dispatcher uses a command router registry supporting any authorized system command declared in the preset whitelist.
- [x] Attempting to dispatch an unwhitelisted or unregistered command returns an explicit authorization or dispatch error.
- [x] Desktop `NodeConfigPanel` renders an interactive visual builder for `Querier` node `args_template`, replacing the "经蓝图 JSON 编辑" placeholder text.
- [x] Whitelisted queries and actions execute successfully through the dynamic dispatch bridge.
