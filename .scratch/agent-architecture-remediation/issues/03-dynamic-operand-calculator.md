# 03: Dynamic Operand Resolution & Expression Calculator

**What to build:** Allow tool plan actions and parameters to calculate dynamic operands via blueprint `Calculator` nodes and mathematical expressions, removing hardcoded business variable formulas (such as `total_cost = unit_price * count` and `added_weight = unit_weight * count`) from the core evaluator.

**Blocked by:** 02: Blueprint-Driven Initial State & Genre-Neutral Engine Models

**Status:** completed

- [x] `resolve_operand` is decoupled from hardcoded matches for `"total_cost"` and `"added_weight"`.
- [x] Operand evaluation supports generic variable lookup from tool arguments and active game state attributes.
- [x] Mathematical expressions (e.g. `[op1] * [op2]`) or blueprint `Calculator` outputs resolve dynamically.
- [x] Attempting to evaluate an undefined variable returns a descriptive error rather than silent failure.
