# Progress

Last updated: 2026-11-14, checkpoint 2 (Phase 1 gate). Read this first; then `docs/CAPABILITIES.md` and the relevant ADRs.

Status words: **verified-here** = checked on the current CPU profile · **implemented, not qualified** = code exists, needs a runtime/target we lack ·
**blocked** · **not started**. Nothing is "verified on target profile" yet: no GPU reference machine exists.

## Profile used for all evidence (provisional CPU functional-validation profile)
Linux 6.18 x64 · Intel Xeon @ 2.10 GHz, 4 logical CPUs · 15.7 GiB RAM · no GPU · Node 22.23.4 · Chromium 153.0.8010.12 headless (Playwright 1.63.0) ·
FFmpeg 6.1.1-3ubuntu5 · SQLite 3.54.1 · ComfyUI 0.45.0 / PyTorch 2.15.0 on CPU. This is **not** the GPU performance reference.

## Milestones

| Milestone | State | Evidence |
|---|---|---|
| Phase 0 — Readiness and spike | **Gate met, verified-here** | `pnpm proof` (now 47 checks), probe, ADR-0001…0007 |
| Phase 1 — Authoritative core | **Gate met, verified-here** | 69 unit/property/integration tests; convergence 15 seeds × 40 steps (60 seeds also run once); proof 47/47 |
| A1 · G0 — provider path on a model-free workflow, attachment, stale-result | **Verified-here (model-free)** | `pnpm proof:g0` 35/35 against real ComfyUI on CPU |
| A1 · G0 — media-*input* workflow (source staging) | In progress (next) | — |
| A1 · G0/G1 — any model-based workflow | **Blocked** (B-4, B-6): no GPU; model hosts denied by network policy | — |
| Phase 2 — Media and playback | Started (still-image assets done) | — |
| Phases 3–13, G1–G3 | Not started | — |

## Completed and verified-here

**Phase 0** — toolchain and scripts; capability probe; brand tokens/logo; he/en i18n; fixture generator with frame-index truth; end-to-end loop
import → edit → preview → MCP agent edit → live UI update → export (all 105 exported frames source-exact; beeps within 0.06 ms; one-frame PSNR 46.7 dB / SSIM 0.998).

**Phase 1** (ADR-0004 updated)
- Entity versions: every commit records the exact entity-level diff; `entity_versions` tracks last change (and deletion) per entity.
- Semantic rebase: `baseRevision` accepts a stale base only when nothing the edit reads or writes changed since; otherwise `conflict` naming entity, revision and actor. Strict `expectedRevision` kept.
- Undo/redo as compensating transactions, per actor; refused with a conflict list if the items changed later or the restore would be invalid; other actors' later edits survive. Replayable from the op log.
- Property test: random op sequences, undo-all then redo-all restore the exact creative projection at every step (60 runs per test run; `PF_PROPERTY_RUNS` raises it). The 10,000-sequence nightly run is not set up.
- Convergence: two REST+SSE clients and one MCP client, seeded interleavings with stale intents, duplicate deliveries, strict-stale sends, reconnects and undo; asserts typed errors only, no lost accepted commits, rebase safety from history, replica convergence, replay equality, authorization. No server bug found.
- OpenAPI 3.1 generated from the op registry (`GET /api/v1/openapi.json`, 26 paths), with a drift test against the running server.
- Idempotency compares canonical operations (key order and unreduced times no longer matter).
- Storage migration step (`PRAGMA user_version` 1).
- UI: undo/redo buttons, Ctrl/Cmd+Z, Shift+Z, Y; edits use `baseRevision` so a concurrent agent edit elsewhere no longer causes a conflict.

**Licence notices (actionable gap closed)** — the web build emits `THIRD_PARTY_NOTICES.txt` with full texts for every bundled third-party package
(Heebo OFL-1.1, Mediabunny MPL-2.0 with source location and "unmodified" statement, react, react-dom, scheduler, zod); the build fails if a bundled package has no licence;
`pnpm check:notices` verifies the built artifact and is part of `pnpm check`. The "build fails on missing licence" path itself is untested.

**Amendment A1 · G0 (model-free)** — provider adapter, descriptors with seven separate qualification dimensions, import-as-draft, durable capability jobs,
same job shape from UI/REST/MCP, cancellation of a queued job, restart resume, ambiguous-submission handling (injected faults, labelled),
output validation, **derived assets with lineage**, **attach-or-propose through `add_clip`**, **stale-result protection** (dependency edited while the job waited → nothing placed, asset kept as proposal),
attached provider image verified by pixel through `render_frame`, undo of the placement.

## In progress
- G0 media-input staging: a reviewed model-free image workflow that takes a project asset as input (source hash, lineage, bounded transfer).
- Phase 2 media foundation (see task list).

## Blocked / unverified (with what would unblock)

| Item | State | Affected criterion | Unblocked by |
|---|---|---|---|
| Any model-based workflow incl. the authorised ≤1 GB BiRefNet CPU trial | blocked (B-6) | A1 G0 "one qualified media workflow", G1 | `huggingface.co` (and GitHub release downloads) are denied by the environment's network policy (proxy 403). Allow `huggingface.co` + its CDN host in the environment's network settings. ComfyUI 0.45.0 already ships core `LoadBackgroundRemovalModel` / `RemoveBackground` nodes, so no custom node is needed. Trial stopped cleanly: 0 bytes downloaded, 0 s inference |
| GPU compositor, GPU/VRAM qualification, Appendix C2 performance targets | implementation can proceed; execution cannot be verified (B-1) | Phases 2, 4, 7, 13; FF-06 | A GPU reference machine |
| Browser MP4+AAC export | blocked here (B-2) | Phase 4 browser route | A Chrome build with AAC WebCodecs encode |
| Preview A/V sync; preview/export parity across many frames; long media; real camera/phone footage; other browsers; other MCP hosts | unverified | Phases 2–4 gates | Scheduled in Phase 2/4 below; other browsers are not installed here (Chromium only) |
| Worker lease / prewarm / budgets (FF-07) | not started | G3, Phase 10 | Phase 5 scopes + Phase 10 |
| No pull request | deferred by owner | — | Branch organisation later |

## Dependency-aware task list (next first)

1. **G0 media-input staging** (lead) — needs: derived assets ✓. Unlocks: every source-based workflow.
2. **Phase 2a ingest artefacts** (worker, contract = `describeMedia` + blob store): thumbnails, multiresolution waveform peaks, proxies as derived blobs with exact original↔proxy mapping; per-asset state.
3. **Phase 2b decode scheduling + bounded caches** (lead): range-read asset access (no whole-file download), decoder/frame cache budgets, resource-lifetime test.
4. **Phase 2c A/V conformance** (lead + worker for fixtures): VFR/rotation conform route via ffmpeg; fixtures for H.264/VP9/AV1, B-frames, fractional rates; 1,000 seeded seeks per fixture; 10-minute flash/beep sync fixture; preview A/V sync measurement.
5. **Phase 2d audio clock + shared audio contract** (lead): AudioWorklet playback path replacing whole-file decode.
6. Phase 3 editor interaction → Phase 4 export (cancel, range, browser route where possible, parity suite) → Phase 5 agent surface (scopes, proposals, Pause Agent, budgets) → Phase 6 typography/captions → Phase 7 motion/catalog/Lab → Phase 8 sound → Phase 9 analysis → Phase 10 generative → Phase 11 Director → Phase 12 delivery → Phase 13 qualification.
7. Housekeeping: sync `docs/REQUIREMENTS.md` / `docs/CAPABILITIES.md` rows to this checkpoint (worker); nightly large property/convergence runs.

## Next executable action
`pnpm install && pnpm check` (expect 69 tests, proof 47/47), start ComfyUI (docs/INTEGRATIONS.md) and `pnpm proof:g0` (35/35); then task 1 in `packages/providers/src/builtin.ts`, `packages/providers/src/comfy.ts` (`/upload/image`) and `apps/server/src/capabilities.ts`.

## Agent / model summary

| Checkpoint | Role | Work | Requested | Resolved | Harness-reported usage |
|---|---|---|---|---|---|
| 1 | Lead | Phase 0, G0 first slice, integration | session `claude-opus-5-5` | `claude-fable-5-2` (session-reported) | — |
| 1 | Worker | REQUIREMENTS.md | `sonnet` | not observable | 144,776 tok · 148 s |
| 1 | Worker | licences + tech radar | `haiku` | not observable | 102,039 tok · 74 s |
| 2 | Lead | entity versions, rebase, undo, attachment, stale-result, image assets, integration and review | as above | as above | — |
| 2 | `pf-implementer` | licence notices plugin + check | definition: `sonnet` | not observable | 26,190 tok · 54 s |
| 2 | `pf-implementer` | OpenAPI generation + drift test | definition: `sonnet` | not observable | 37,410 tok · 70 s |
| 2 | `pf-implementer` | convergence test | definition: `sonnet` | not observable | 80,056 tok · 296 s |

The `pf-implementer` definition was exercised on three real tasks: each stayed inside its file scope and reported defects instead of patching shared code
(it found the undo-body 500 and the raw-JSON idempotency comparison; both fixed by the lead). `pf-scout` has not been exercised yet.
No cost figures are available. No paid call, model download or GPU wake-up has been made.
