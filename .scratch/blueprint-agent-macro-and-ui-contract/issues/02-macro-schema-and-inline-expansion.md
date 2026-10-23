# 02: UE5 Blueprint Macro Schema & Inline Expansion Engine

**What to build:** Introduce the data model and compiler pipeline for UE5-style Blueprint Macros in the Rust backend. A preset maintains a `macros` library containing named macro definitions bounded by `Inputs` and `Outputs` nodes. The compiler performs static inline expansion (Inline Expansion) during graph traversal, replacing `MacroInstance` nodes with their cloned internal topologies, remapping edges, and validating pin connections across Exec flow pins and 4 typed Data pins (Number, String, Boolean, Object) with zero runtime call-stack overhead.

**Blocked by:** None (can start immediately)

**Status:** completed

- [x] Preset and blueprint models define `BlueprintMacro`, `MacroPinDefinition`, and `PinType` (Exec, Number, String, Boolean, Object).
- [x] Compiler implements graph inline expansion algorithm replacing `NodeType::MacroInstance` nodes with inlined subgraphs and rewired pin connections.
- [x] Type validation checks verify that data pin connections match expected types and disallow incompatible wirings.
- [x] Comprehensive unit tests assert macro expansion correctness, pin remapping, and recursive macro cycle rejection.
