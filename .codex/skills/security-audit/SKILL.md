---
name: "security-audit"
description: "General-purpose security audit for code. Audits repos, paths, or PR diffs. Invoke when user requests a security audit, vulnerability scan, or security review of a codebase."
---

# Security Audit

A general-purpose, project-agnostic security audit skill. Scans source code for exploitable vulnerabilities in three modes: pull-request diff, explicit path list, or full workspace. Produces a confidence-gated findings table; speculative results go to a Backlog queue.

The skill is non-patching: it identifies and explains; it does not write replacement code.

## 0. Operating Principles (Non-negotiable)

These rules govern every finding. A finding that violates any rule MUST be dropped.

- **Right-side line numbers only.** Every location refers to lines as they appear *at the time of audit*. Pre-audit line numbers are invalid.
- **Range form `[L_start, L_end]`.** A single-line issue collapses to identical start/end.
- **Audit surface depends on mode.** `pr_diff` mode limits findings to diff-introduced surface. `paths` and `workspace` modes audit everything inside the scope.
- **Reportable ⇔ Demonstrably exploitable.** If you cannot articulate (a) where attacker-controlled input enters and (b) where it reaches a dangerous sink or boundary, do not report.
- **Mode-dependent exclusions.** In `pr_diff` mode, availability/DoS, throttling, code style, and findings confined to test/fixture code are excluded by default. In `paths` and `workspace` modes, availability/DoS and missing-hardening findings ARE in scope (see §5.6).
- **Confidence floor = 0.80 for the main table.** Below that → Backlog table (0.70–0.79) or drop (< 0.70).
- **No patches.** Identify and explain. Do not write replacement code in the report.

## 1. Scope Resolution

Before reading any code, the audit scope must be unambiguous.

### 1.1 If the user already specified a scope

Use it verbatim — never broaden or narrow it. Valid scope forms:

- `pr_diff:<ref>` — diff against a named branch / commit (e.g., `pr_diff:origin/HEAD`, `pr_diff:main`, `pr_diff:HEAD~3`)
- `paths:<glob[, glob...]>` — explicit file or directory list
- `workspace` — entire repository

### 1.2 If the scope is missing or ambiguous

Prefer the `AskUserQuestion` tool with these three options:

1. Pull-request / diff against a named branch (ask for the branch / ref)
2. Explicit file or path list (ask for the paths)
3. Full workspace audit

If `AskUserQuestion` is unavailable, ask the same three options as numbered plain text.

### 1.3 Default fallback

If the user declines to specify and asks you to proceed, default to `workspace` mode. Always announce the chosen mode in the report header.

## 2. Data Collection

Data probes differ by mode.

### 2.1 `pr_diff` mode

| Probe | Command | Purpose |
|---|---|---|
| Working tree state | `git status` | Detect untracked / staged anomalies |
| Touched files | `git diff --name-only <ref>...` | Enumerate the file surface |
| Commit timeline | `git log --no-decorate <ref>...` | Reconstruct intent across commits |
| Authoritative diff | `git diff --merge-base <ref>` | The single source of truth for change content |

The diff from the last probe is the only authoritative change content. Inline snippets in chat are advisory; the diff overrides.

#### 2.1.1 Probe failure cascade

If the merge-base diff fails, walk down this list and stop at the first success:

1. `git diff <ref>...`
2. `git diff HEAD~1`
3. `git diff` (workspace)
4. Re-prompt the user via `AskUserQuestion` for an explicit scope.

### 2.2 `paths` mode

For each path in the list:

1. Verify the path exists.
2. Read the full file (or recursively list the directory).
3. Resolve all imported / referenced symbols via `SearchCodebase`.

### 2.3 `workspace` mode

1. Enumerate the repository root.
2. Detect language(s) and framework(s) from manifest files (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `pom.xml`, `build.gradle`, `*.csproj`, etc.).
3. Build a file inventory and read all source files (skip generated, vendored, dependency-locked, and `node_modules` / `target` / `dist` / `build` artifacts).
4. Use `SearchCodebase` to build a cross-file symbol index.

### 2.4 Probe failure

If a single auxiliary tool (e.g. `SearchCodebase`) is intermittently unavailable, continue with the rest and explicitly mark conclusions as evidence-bounded.

## 3. Context Acquisition (Mandatory before any finding)

Snippet-only reasoning is forbidden. Every candidate finding must be backed by repository-level evidence collected in this order:

1. Confirm scope (§1) and mode.
2. Collect the authoritative diff / file surface (§2).
3. Use `SearchCodebase` to locate (a) input entry points / trust boundaries, (b) existing sanitizer / validator / authZ helpers in the project.
4. Use `Read` to inspect the **full** body of in-scope files plus the relevant call-chain neighbors.
5. Only after the above is complete, draft findings.

For each candidate finding, you must collect:

- **Source-side evidence** — concrete attacker-controlled entry on the execution path.
- **Sink-side evidence** — the dangerous operation, security boundary crossing, or sensitive-data exposure that the input reaches.
- **Bypass-context evidence** — whether nearby code already sanitizes / encodes / validates / authorizes; whether existing project helpers neutralize the issue.
- **Callsite aggregation** (for `paths` / `workspace` modes) — how many other call sites share the same pattern. This informs class-level recommendations.

If either *source-side* or *sink-side* cannot be substantiated from repository code, the finding is dropped.

## 4. Author-Intent Reconstruction

Before classifying anything as a vulnerability, infer **why the author wrote this code**. The pattern of edits often disambiguates intent:

- New error handling / null-guards → defensive refactor; raise the bar for "missing-validation" findings.
- Algorithm or data-structure swap → behavior change; check invariants of callers.
- Dependency bump + adapter glue → API-shape migration; check if old security assumptions still hold.
- Variable / module rename → low semantic change; usually no security delta.

Hold the inferred intent as a one-sentence summary and use it as a tie-breaker when a candidate finding is ambiguous.

## 5. Vulnerability Surface

Audit only the categories below. Each category lists the patterns that count; anything not in the list is out of scope unless it composes one of these.

### 5.1 Untrusted-input handling

- SQL injection through unsanitized values.
- OS command injection in subprocess / shell-out paths.
- XML external entity (XXE) in XML parsers.
- Server-side template injection.
- NoSQL query injection.
- Path traversal in filesystem operations.

### 5.2 AuthN / AuthZ defects

- Authentication bypass via flawed predicate logic.
- Vertical / horizontal privilege escalation.
- Broken session lifecycle: fixation, reuse-after-logout, missing rotation.
- JWT misuse: weak secret, `alg=none`, missing `aud` / `iss` / `exp` checks.
- Object-level access gaps (IDOR-class).

### 5.3 Crypto & secret handling

- Hardcoded keys / passwords / tokens in source.
- Use of broken or weakened algorithms (MD5, SHA1, ECB, RC4, …).
- Insecure key persistence or transport.
- Predictable randomness in security contexts (`Math.random`, non-CSPRNG).
- Disabled or stubbed certificate validation.

### 5.4 Code execution & injection

- Remote code execution via unsafe deserialization (`pickle`, `ObjectInputStream`, …).
- YAML loaders that instantiate arbitrary types (`yaml.load` without `SafeLoader`).
- `eval` / `Function` / `exec` over untrusted strings.
- XSS — reflected / stored / DOM — in web surfaces (subject to the framework carve-outs in §8).

### 5.5 Sensitive-data exposure

- Secrets, credentials, or PII written to logs or persistent stores.
- Endpoint responses returning more than the consumer should see.
- Debug / stack / build-info leakage on production paths.

### 5.6 Availability and hardening (workspace / paths modes only)

- Resource exhaustion without bounds on trust boundaries.
- Missing rate limiting on trust boundaries.
- Unsafe defaults that disable security checks.
- Dependency manifests pinning known-vulnerable versions (in `paths` / `workspace` modes; `pr_diff` mode relies on diff evidence only).

> Local-network-only exploitability does **not** lower severity. A local-only RCE is still HIGH.

## 6. Audit Procedure

Three passes, in order. Do not interleave.

**Pass A — Project security baseline.** Identify the project's existing security primitives: which validators, escapers, ORMs, auth middleware, crypto wrappers are already in use. The project's *own* patterns are the comparison baseline.

**Pass B — Deviation map.** For each in-scope file, ask: does the new code use the project's established primitives, or does it introduce a fresh, ad-hoc handling that bypasses them? Deviations are the highest-yield finding generators.

**Pass C — Source-to-sink trace.** For each suspicious site, trace the control / data flow:

- where the value enters,
- which boundaries it crosses,
- whether any encoding / validation / authZ check exists on the path,
- where it lands.

Anything that does not survive Pass C is dropped.

## 7. Severity & Confidence

### 7.1 Severity bands

| Severity | Trigger |
|---|---|
| **HIGH** | Directly exploitable: RCE, authN bypass, large-scope data breach, vertical privilege escalation. |
| **MEDIUM** | Exploitable under specific but realistic conditions, with material impact. |
| **LOW** | Defense-in-depth gap with marginal direct impact. Reported only when the chain is concrete. |

### 7.2 Confidence

| Range | Meaning | Action |
|---|---|---|
| 0.90 – 1.00 | Concrete attack path, end-to-end traceable in this repo. | Main table. |
| 0.80 – 0.89 | Recognized vulnerable pattern, prerequisites plausibly satisfiable. | Main table. |
| 0.70 – 0.79 | Suspicious shape, prerequisites speculative. | Backlog table, marked `speculative`. |
| < 0.70 | Speculative. | Drop. |

> Bias toward false negatives. Missing a borderline finding is preferable to flooding the report; a noisy report destroys reviewer trust faster than a missed defense-in-depth issue.

## 8. Hard Exclusions (never report)

These are not waivable on a per-finding basis.

### 8.1 Out of scope by category

- Findings inside documentation files (`*.md`, design docs, RFCs).
- Findings confined to unit-test or fixture code.
- Race / TOCTOU patterns without a concrete reachable path.
- Regex injection and ReDoS in any form.
- Log entries containing un-sanitized user input ("log spoofing"); only secrets / credentials / PII in logs qualify.
- Including user-controlled content inside an AI system prompt.
- SSRF where only the URL **path** is controllable; SSRF counts only when host or protocol is influenceable.
- Outdated third-party dependencies in `pr_diff` mode (handled by separate tooling). In `workspace` and `paths` modes, outdated dependencies flagged via dependency manifests ARE reportable under §5.6.

### 8.2 Framework & language carve-outs

- React / Angular / Vue / Solid / Svelte are XSS-safe by default. A finding requires an explicit escape hatch — `dangerouslySetInnerHTML`, `bypassSecurityTrust*`, `v-html`, `innerHTML`, or equivalent.
- Missing authN / authZ in client-side JS / TS is **not** a vulnerability; those checks live on the server.
- Memory-safety issues (buffer overflow, UAF, double free) in memory-safe languages (Rust, Go, managed JVM/CLR/JS) are not reported.
- Command injection in shell scripts is unreachable by default; require a demonstrable untrusted-input entry point.
- Findings in `*.ipynb` are unreachable by default; same evidence bar as shell scripts.
- Environment variables and CLI flags are trusted inputs — any chain that depends on attacker-controlled env / flags is invalid.
- UUIDs are unguessable; do not flag missing UUID validation.
- GitHub Actions workflow issues require an explicit untrusted-trigger path before being reportable.

### 8.3 Subtle web bugs

Tabnabbing, XS-Leaks, prototype pollution, open redirect — only if the exploit chain is high-confidence and end-to-end visible. Default to drop.

### 8.4 Logging precedents

- Logging URLs is safe.
- Logging non-PII business values is safe even if the value "feels" sensitive.
- Only log entries exposing secrets / credentials / PII are reportable.

## 9. Output

### 9.1 Header

Always emit a header before any table:

```
# Security Audit Report
Mode: <pr_diff | paths | workspace>
Scope: <ref | path list | workspace root>
Files audited: <count>
Generated: <ISO date>
```

### 9.2 Clean audit

If nothing survives §3 → §8, emit a single-line summary:

> ✅ No exploitable issues found in the audited scope (`<mode>`: `<scope>`).

### 9.3 Findings — main table

Otherwise, output the main table (Confidence ≥ 0.80):

| # | Category | Title | Severity | Confidence | Evidence (Source → Sink) | Recommendation | Location |
|---|---|---|---|---|---|---|---|
| 1 | sql_injection | Concatenated query in `lookup_user` | HIGH | 0.92 | `req.query.q` (router L17) → string concat → `db.query` (svc L88) | Switch to parameterized query via the project's existing `db.safe_query` helper | [`services/user.py:L80-L95`](file:///abs/path/services/user.py#L80-L95) |

Column rules:

- **Category** uses the snake_case taxonomy from §5 (e.g. `xxe`, `idor`, `unsafe_deserialization`, `weak_crypto`).
- **Severity** ∈ {HIGH, MEDIUM, LOW} per §7.1.
- **Confidence** is the numeric value, two decimals.
- **Evidence** must encode both source and sink; "→" separates them.
- **Location** uses current-state line numbers and the `file:///…#Lstart-Lend` link form. For collapsed single-line issues, use `L42-L42`.
- **Recommendation** is prose, not code. No patches.

Findings are ordered by severity desc, then confidence desc.

### 9.4 Backlog table (workspace / paths modes only)

When the audit produces any 0.70–0.79 confidence findings, emit a second table marked clearly as speculative:

| # | Category | Title | Severity | Confidence | Evidence (Source → Sink) | Why speculative | Location |
|---|---|---|---|---|---|---|---|
| B1 | weak_crypto | MD5 used for password hashing in `legacy_login` | LOW | 0.75 | `req.body.password` (router L20) → `md5()` (svc L40) | No public-facing route yet, but the function is reachable from the same module's other entrypoints | [`services/auth.py:L40-L40`](file:///abs/path/services/auth.py#L40-L40) |

The `Why speculative` column explains what additional evidence would move this to the main table.

## 10. Final Self-Check (before emitting the table)

Run this checklist; remove or reclassify any row that fails any item.

1. Does the row's location use **current-state** line numbers?
2. Is the issue **inside the declared scope** for the chosen mode?
3. Are both **source** and **sink** present in the Evidence cell?
4. Is the Confidence ≥ 0.80 (main) or 0.70–0.79 (backlog)?
5. Does the row survive every Hard Exclusion in §8?
6. Is the Recommendation prose only, with **no code patch**?

If any answer is "no", drop the row (or move it to the backlog if it falls in the 0.70–0.79 range and the mode allows a backlog).
