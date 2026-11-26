# PULSEFRAME Studio — working notes for coding agents

Start of session: read `docs/PROGRESS.md` (state + next step), then `docs/CAPABILITIES.md` and the ADRs relevant to your task.
The governing spec is `docs/SPEC.md` (v3.0 + accepted amendments at the end; Amendment A1 full text in `docs/PULSEFRAME_FREEFIELD_INTEGRATION_ADDENDUM.md`). Do not paste the spec into prompts; cite sections.
How work is split across agents and models: `docs/EXECUTION_POLICY.md`.

## Product scope (owner, 2026-11-26)
A general-purpose video editor for any creator's work (YouTube, short clips, social formats, tutorials, music clips, family films): do not narrow features, defaults or wording to one niche. Autonomy first, open by default: the owner wants the system to do as much as possible by itself (a language model now, skills later), with every tool available and no approval steps unless the owner switches one on. Do not design new gates, owner-only limits or refusals-by-policy; warn and continue instead. Keep: every edit a registered op (undoable), the owner key on the server, validated results. Details and what is being re-decided: `docs/BLOCKERS.md`, owner decisions of 2026-11-26.
Tool radar: the lead looks for fitting tools, engines, models and services before the owner has to name them (a research pass at the start of each wave and each new track; `docs/design/TOOL_RADAR_*.md`, summary in `docs/TECH_RADAR.md`).

## Commands
- `pnpm install` · `pnpm dev` (server :8787 + Vite :5173) · `pnpm build` · `pnpm start`
- `pnpm typecheck` · `pnpm test` (Vitest) · `pnpm proof` (Phase 0 end-to-end; needs `pnpm build`) · `pnpm check` (all of these)
- `pnpm proof:g0` (needs a running ComfyUI, see `docs/INTEGRATIONS.md`; exits 2 = blocked if absent) · `pnpm probe` · `pnpm fixtures`

## Layout
`packages/time` exact rationals · `packages/core` schema, ops, transactions · `packages/engine` evaluator + Canvas2D compositor · `packages/providers` capability descriptors, importer, ComfyUI adapter ·
`packages/brand`, `packages/i18n`, `packages/fixtures`, `packages/evals` (proofs) · `apps/server` (Hono, SQLite, REST, SSE, MCP, export, capability jobs) · `apps/renderer` (headless Chromium worker, probe) · `apps/web` (editor + render page).

## Invariants (do not break)
- Every persistent edit is a registered op applied through `Store.commit`. UI, REST and MCP share that path. No second authority for project state.
- Times are rationals `{value: string, timescale}`; never store float seconds; never accumulate rounded durations (ADR-0003).
- Preview, `render_frame` and export use the same `evaluate` + compositor (ADR-0005).
- Actor and scopes come from the credential. No unauthenticated writes, even on loopback (ADR-0002).
- Provider results enter via durable jobs, are validated before success, and are never fabricated. No route accepts a raw workflow graph for execution (ADR-0007).
- A missing provider/feature is an honest setup state. Mocks stay in tests and are labelled.
- Pin exact dependency versions. Read the installed package's types/docs before using an API: several pinned versions are newer than model training data.

## End of session
Update `docs/PROGRESS.md` with what was actually verified and the next runnable step; keep `docs/CAPABILITIES.md`, `docs/REQUIREMENTS.md` and `docs/BLOCKERS.md` truthful.
