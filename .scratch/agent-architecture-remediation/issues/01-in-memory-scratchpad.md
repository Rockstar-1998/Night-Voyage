# 01: In-Memory Text Scratchpad & Native Tool Pipeline

**What to build:** Enable AI scriptwriter and director agents to perform intermediate drafting in an ephemeral, volatile in-memory scratchpad via native `read_text` and `write_text` tools. All intermediate drafts during turn reasoning must remain strictly in memory, producing zero disk I/O and leaving zero rows in the persistent SQLite `agent_drafts` table. All scratchpad memory buffers are automatically dropped upon turn completion.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Native `read_text(key: String)` and `write_text(key: String, content: String)` tools are exposed to LLM agents during pipeline execution.
- [ ] Scriptwriter pipeline stages store and retrieve intermediate drafts (`draft`, `critique`, `final`, etc.) exclusively through the in-memory scratchpad.
- [ ] Running a multi-step scriptwriter turn inserts zero rows into the `agent_drafts` database table.
- [ ] Volatile scratchpad buffers are dropped and deallocated when turn execution completes.
