# 04: Generic Expression ConditionGate & Zero Silent Fallbacks

**What to build:** Allow condition gates to evaluate custom relational expressions (such as `>=, <=, ==, !=, >, <`) over arbitrary game stats and inventory attributes, completely eliminating hardcoded gate types (`"gold"`, `"weight"`, `"slots"`, `"d20"`) and removing silent fallback clamps (such as `max(10.0)`).

**Blocked by:** 02: Blueprint-Driven Initial State & Genre-Neutral Engine Models

**Status:** ready-for-agent

- [ ] Condition gate evaluation supports relational operators (`>=`, `<=`, `==`, `!=`, `>`, `<`) comparing state attributes against thresholds or variables.
- [ ] Hardcoded gate type matches (`"gold"`, `"weight"`, `"slots"`, `"d20"`) are deprecated in favor of expression evaluation.
- [ ] Silent fallback clamping (`max_weight.max(10.0)`) is removed entirely; missing stats or unsatisfied gates raise explicit errors per C2.
- [ ] Scenarios using non-fantasy attributes (e.g. `credits >= 100`, `radiation < 50`) pass or fail gates accurately based on true evaluation.
