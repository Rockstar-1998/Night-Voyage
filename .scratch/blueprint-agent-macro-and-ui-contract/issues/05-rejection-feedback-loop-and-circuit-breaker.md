# 05: Rejection Feedback Loop & Circuit Breaker Execution

**What to build:** Support cyclical rejection loops within multi-stage scriptwriter pipelines on both the visual canvas and the runtime execution engine. Reviewer nodes expose `Approved` and `Reject` Exec output pins; `Reject` pins allow drawing directed back-edges to upstream generator nodes (`Drafter`). When a rejection fires, critique text is stored in the ephemeral scratchpad under `{feedback}`, and an iteration counter increments. If the loop exceeds `max_loop_count` (defaulting to 2), the circuit breaker triggers deterministic termination, preventing infinite loops or UI freeze.

**Blocked by:** 04: Global Capability Pool & Per-Agent Tool Permissions Modal

**Status:** ready-for-agent

- [ ] Graph validator permits directed back-edges originating exclusively from rejection and loop-back sockets.
- [ ] Execution context maintains turn-level `RejectionLoopState` tracking iteration count and critique history.
- [ ] Rejection transitions inject critique text into the ephemeral scratchpad (`{feedback}`) for upstream generator consumption.
- [ ] Exceeding `max_loop_count` trips a circuit breaker emitting a timeline event and executing fallback/warning completion.
- [ ] Unit and integration tests verify rejection loop iteration, feedback injection, zero SQLite draft rows, and circuit breaker activation.
