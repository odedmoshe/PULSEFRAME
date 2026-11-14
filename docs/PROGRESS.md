# Progress

Last updated: 2026-11-14 (session 1). Read this first; then `docs/CAPABILITIES.md` and the relevant ADRs.

## Where things stand

| Milestone | State | Gate evidence |
|---|---|---|
| **Phase 0 — Readiness and spike** | **Exit gate met** on the development container | `pnpm check`: typecheck clean, 38 unit/property tests, web build, end-to-end proof **42/42** (`docs/evidence/phase0-proof.json`) |
| **Amendment A1 · G0, first half** (provider adapter + model-free smoke workflow) | **Verified on CPU** against a real ComfyUI 0.45.0 | `pnpm proof:g0`: **28/28** (`docs/evidence/g0-smoke-proof.json`) |
| Amendment A1 · G0, second half (one qualified *media* workflow, timeline attachment, stale-result) | Not started — blocked on B-4 and on Phase 1/2 work | — |
| Phase 1 — Authoritative core | Partly pre-built by Phase 0 (see below); not gated | — |
| Phases 2–13, G1–G3 | Not started | — |

Nothing beyond the rows marked met/verified is complete. `docs/REQUIREMENTS.md` has 199 rows; 15 are `done`.

## Phase 0: what was built and verified

Exit gate (SPEC Appendix D): *commands run; runtime capabilities recorded; a source frame, Hebrew text and audio produce a playable sample through the proposed path.*

- **Commands:** `pnpm install | dev | build | start | typecheck | test | proof | check | probe | fixtures` all run.
- **Capabilities recorded:** `docs/evidence/capability-probe.json`, summarised in `docs/CAPABILITIES.md`. Key facts: no WebGPU adapter by default, no GPU, WebCodecs H.264 encode yes but AAC encode no.
- **Architecture decisions:** ADR-0001 … 0007 in `docs/adr/`.
- **Smallest runnable proof** (`pnpm proof`, real server + real browser + real MCP client + real MP4):
  import (upload, sha256, ffprobe) → edit (UI add clip, keyboard split, Hebrew text with niqqud) → preview (barcode read back from canvas pixels) →
  external agent edit over MCP 2026-07-28 (4-op atomic transaction) → live UI update (~39 ms, playhead and selection untouched) →
  export started from the UI while editing continues (immutable snapshot) → H.264 High + AAC MP4 where **all 105 frames** show the exact source frame the evaluator selected,
  beeps land within 0.06 ms of the edited positions, and one frame compares at PSNR 46.7 dB / SSIM 0.998 with the compositor still.
  Also checked: 401/403 for missing credentials, wrong token, observe-only token, foreign origin and forged Host; idempotency; stale revision; op-log replay equals the stored document; restart persistence; 2025-era MCP client fallback.
- **Also in place:** brand tokens and original logo, Hebrew/English dictionaries (key-parity test), fixture generator with frame-index truth, licence inventory.

Screenshots: `docs/evidence/phase0-editor-he.png`, `phase0-editor-after-agent-he.png`, `phase0-editor-en.png`, `phase0-frame70-compositor.png`, `phase0-frame70-export.png`.

### Found and fixed during verification
- Text ran off the frame (no wrapping) → paragraph-level word wrap added.
- Export took 53.6 s for 3.5 s; cause measured (Chromium uploads typed-array bodies at ~18 MB/s, `Blob` bodies at ~266 MB/s) → 7.4 s.
- Op-log replay differed from the stored document by key order only → replay now canonicalises through the schema.
- Capability job loop kept polling after server shutdown and hit the closed database → runner now stops cleanly and leaves the job for recovery.

### Phase 0 items that are thin (true, but minimal)
- "Licensing inventory": automated listing plus known obligations; **no notices are emitted into the built bundle yet** (OFL and MPL texts) — open compliance item in `THIRD_PARTY_LICENSES.md`.
- "i18n": UI strings only; server-generated activity summaries are English.
- Visual QA was done by inspecting screenshots; there are no automated golden-image tests.
- Parity was measured on one frame; A/V sync on a 3.5 s clip.

## Unverified (built, but not proven by a check)
- Preview audio/video sync and which clock (audio vs monotonic) the preview used in the headless run.
- `pnpm dev` beyond a smoke test (Vite proxy, session cookie and project list worked).
- Behaviour on any other OS, browser, GPU, or real camera/phone footage (only the synthetic fixture was imported).
- Long media: preview decodes whole audio files and the render worker downloads whole assets.
- Any MCP host other than the official SDK client.
- The workers' documents (`docs/REQUIREMENTS.md`, `THIRD_PARTY_LICENSES.md`, `docs/TECH_RADAR.md`) were spot-checked by the lead, not line-audited; TECH_RADAR reference URLs were not fetched.

## Blocked
See `docs/BLOCKERS.md`: B-1 no GPU/WebGPU here (decision needed: reference machine) · B-2 no AAC in WebCodecs here · B-3 PyTorch CPU index blocked by network policy ·
B-4 **no model-based ComfyUI workflow can be qualified here** (decision needed: GPU/remote worker, or authorise a CPU functional attempt of one small workflow) · B-5 internal prerequisites.

## Amendment A1 (Freefield / ComfyUI): reconciliation

Saved verbatim as `docs/PULSEFRAME_FREEFIELD_INTEGRATION_ADDENDUM.md`; accepted into `docs/SPEC.md` ("Accepted amendments", A1); tracked as FF-01…FF-15, FFG-01…FFG-14, FF-X1…X6 in `docs/REQUIREMENTS.md`.

**What it changes:** adds one optional execution provider (ComfyUI) and creative workflows on top of the existing provider registry, job system, asset pipeline and operations. It changes nothing in the project document, time model, renderer or authorization design. No material conflict was found. Three points needed a decision, all recorded in ADR-0007 / INTEGRATIONS:
1. ComfyUI core is GPL-3.0 → it is never bundled; the operator runs it. (A process boundary is noted as architecture, not as a licence opinion.)
2. Direct ComfyUI HTTP API instead of the Comfy SDK or any Freefield server code.
3. "Runnable" vs "published": a capability may run when only the two run-earned dimensions (executed, hardware-qualified) are open, otherwise nothing could ever earn them. Every other blocker stops execution.

| Classification | Items |
|---|---|
| Already covered by the base spec (addendum adds candidates/constraints) | Background removal, depth, upscaling, interpolation, generation, dubbing, model manager, provider routing, Lab, durable jobs, stale-result protection |
| Planned requirements refined | FF-02, FF-04, FF-05, FF-06, FF-08, FF-09, FF-15 |
| Genuinely new | FF-01 (ComfyUI provider), FF-03 (reviewed import), FF-07 (worker admission/lease), FF-10 (Use in…), FF-11 (Reference Board), FF-12 (Generative Reframe), FF-13 (Relight/Mixed Media/Cinema), FF-14 (Motion Transfer/Recast) |
| Conditional / experimental | Camera Copy (Cameraman v2 excluded from the commercial profile), Reshoot, learned SDR→HDR, character LoRA training, audio repair/continuation, generative Hebrew dubbing |

**Where it sits in the phase plan**

| Sub-milestone | Phase mapping | Depends on |
|---|---|---|
| G0 first half — adapter, descriptors, import-as-draft, smoke job | done now, alongside Phase 0/1 | existing job rows and auth |
| G0 second half — one qualified media workflow, source-range staging, attachment via ops, cancellation of a running job, stale-result | alongside Phases 1–2, finishes in Phase 10 | Phase 1 entity versions; Phase 2 image/derived assets; B-4 |
| G1 — BiRefNet image, MoGe-2, SeedVR2 image; model packs; readiness | Phase 9 + model manager (§18) | G0, GPU profile, FF-05 downloader with digests |
| G2 — example replay, compare, Use in…, recipes, Reference Board; then Generative Reframe and one Relight/Mixed Media | Phases 7 (Lab), 11 (recipes), 12 (linked formats), 10 | G1, Lab, recipes |
| G3 — video upscale/interpolation, Motion Transfer, Recast (81-frame limit enforced), audio | Phase 10 | G2, worker lease (FF-07), budgets |

**Implemented for G0 so far** (`packages/providers`, `apps/server/src/capabilities.ts`):
descriptor with seven independent qualification dimensions and computed blockers · parse-only importer (always a draft; no network, execution or installs) ·
ComfyUI adapter · one reviewed model-free capability · durable capability jobs (intent and request id stored before dispatch; idempotency; restart resume; `submission-unknown` without blind retry;
outputs downloaded, hashed and probed before success) · same route for UI button, REST and MCP `run_capability`; no raw-graph route · commercial-profile exclusion of non-commercial models.

**Explicitly not done:** any model, any GPU run, media inputs/staging, timeline attachment, stale-result protection, worker lease/prewarm, model packs and digest-verified downloads, draft storage/review UI, UI-format import, cost reservation, Lab integration. Fault cases in the G0 proof (truncated/missing output, lost response) are **injected around the real provider** and labelled so in the evidence.

## Next executable step

**Phase 1 — authoritative core, starting with the pieces G0 also needs.** In order:
1. Entity versions on clips/tracks/assets + semantic preconditions in `applyTransaction` (enables safe rebasing and FFG-09 stale-result checks). *Lead.*
2. Undo/redo as compensating transactions with conflict refusal; property test: undo-all/redo-all restores the creative projection (Appendix C3). *Lead.*
3. OpenAPI document generated from the op registry and route schemas; `GET /api/v1/openapi.json`. *Balanced worker — contract is settled.*
4. Three-client convergence test with seeded interleavings, stale revisions and duplicate deliveries. *Balanced worker after 1.*
5. Then G0 second half groundwork: image + derived asset kinds, `attach_derived_asset` op, attachment-or-proposal on job completion.

First command for the next session: `pnpm install && pnpm check` (expect 38 tests, 42/42), then start item 1 in `packages/core/src/ops.ts` and `apps/server/src/store.ts`.

Decisions needed from the owner (work continues without them): reference hardware for B-1; how to proceed on B-4.

## Agent / model summary (session 1)

| Role | Work | Requested model | Resolved model | Usage reported by harness |
|---|---|---|---|---|
| Lead | Everything except the two rows below; integration, review, all proofs | session configured `claude-opus-5-5` | `claude-fable-5-2` (reported by the session as last served; the owner switched models) | not reported |
| Worker 1 | `docs/REQUIREMENTS.md` | `sonnet` | not observable | 144,776 tokens, 15 tool calls, 148 s |
| Worker 2 | `THIRD_PARTY_LICENSES.md`, `docs/TECH_RADAR.md` | `haiku` | not observable | 102,039 tokens, 10 tool calls, 74 s |

No cost figures are available; none are estimated. No paid provider call, model download or GPU wake-up was made. The policy in `docs/EXECUTION_POLICY.md` was adopted mid-session, so most of Phase 0 was done by the lead alone.
The two agent definitions in `.claude/agents/` were written this session and have not been loaded or exercised yet.
