# 01: UI-First Data Contract Extraction & Static Compile-Time Guard

**What to build:** The UI Designer automatically analyzes bound widgets (gauges, progress bars, inventory grids, labels) and exports a formal `RequiredDataInterface` specification. When saving or compiling a blueprint, a static analyzer verifies that the graph's `InitialStateConfig` and tool outputs supply every declared stat, collection, and flag with compatible types. Any missing attribute or type mismatch displays a persistent red error banner on the canvas header and physically disables the "Save and Publish" and "Run" actions, preventing sessions from launching with missing data or undefined states (strict C2 Zero-Fallback).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] UI Designer serializes a `RequiredDataInterface` containing all `stats.*`, `flags.*`, and `inventory` dependencies declared by widgets in the layout.
- [ ] Backend blueprint compiler implements static contract validation comparing graph data definitions against the UI contract.
- [ ] Blueprint canvas header renders a reactive status indicator ("Contract Aligned" vs "N Missing Fields").
- [ ] Missing required attributes or type mismatches trigger structured error lists and disable the Save/Publish button.
- [ ] Dual-platform coverage: both desktop (`src/`) and mobile (`src-mobile/`) enforce contract verification prior to saving.
