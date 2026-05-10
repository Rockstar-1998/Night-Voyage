# Night Voyage Agent Rules

## Mandatory Skill

- Before doing any work in this repository, read and apply D:/data/Night Voyage/.codex/skills/night-voyage-guardrails/SKILL.md.
- Treat night-voyage-guardrails as mandatory for every task in this repository.
- If the skill requires refusal or risk escalation, stop immediately and follow it.

## Skills

### Available skills

- night-voyage-guardrails: Mandatory project guardrails for model whitelist, Tauri 2 + Rust core, SolidJS host, Motion One animations, isolated AI-generated UI layers, frontend/backend boundaries, performance rules, risk escalation, zero-fallback error handling, and PC/Android considerations. Use for every task in this repo. (file: D:/data/Night Voyage/.codex/skills/night-voyage-guardrails/SKILL.md)

## Technical Baseline

- Core shell: `Tauri 2.0 + Rust` for all networking, database work, LLM access, parsing, storage, and other non-rendering logic.
- Frontend host: `SolidJS`.
- Animation engine: `Motion One`.
- AI-generated UI: isolate inside `iframe` or `Shadow DOM`; allow `HTML + Tailwind` inside the sandboxed layer without affecting the `SolidJS` host.

## Delivery Workflow

- Frontend first: define and validate the UI flow, loading/error states, and sandbox boundaries before backend implementation.
- Before any frontend runtime rewrite, create or update `D:/data/Night Voyage/plans/gemini-frontend-rewrite-handoff.md`.
- Before any backend AI integration work, create or update `D:/data/Night Voyage/plans/backend-ai-handoff.md`.
- Runtime frontend files in `src/**` and `index.html` may be rewritten by Gemini, OpenAI ChatGPT 系列或 Anthropic Claude.
- Runtime backend files in `src-tauri/**` may only be rewritten by OpenAI ChatGPT 系列或 Anthropic Claude；Gemini 严禁修改后端运行时代码。
