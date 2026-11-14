# Progress

Last updated: 2026-11-14, checkpoint 3 (G0 complete on CPU; bounded model trial; Phase 2a). Read this first; then `docs/CAPABILITIES.md` and the relevant ADRs.

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
| A1 · G0 — media-input workflow with source staging (model-free blur) | **Verified-here** | `pnpm proof:g0` now 39/39 |
| A1 · model files: digest-verified readiness + explicit resumable download (FF-05 core, FFG-04) | **Verified-here** | `apps/server/src/models.test.ts`; trial |
| A1 · G1 — BiRefNet image matting | **Implemented, experimental; CPU functional trial passed** — not quality-reviewed, not GPU-qualified | `pnpm trial:birefnet` 13/13, `docs/evidence/g1-birefnet-cpu-trial.json` |
| Phase 2 — Media and playback | In progress: still images, ingest derivatives (thumbnails, waveform peaks, frame-identical proxy) done | `derive.test.ts`; proof 48/48 |
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

**Checkpoint 3 additions**
- Media-input staging: capability parameters of type image are project asset ids only (paths/URLs rejected); the source is streamed to the provider under a content-addressed name; job and derived asset record source hash and lineage; declared output-size contracts are enforced.
- Model store: ready = exact size + SHA-256; partial or one-bit-wrong files are never ready; explicit owner-only download bound to the exact byte count, resumable, host-restricted, verified before publish.
- Experimental status: open quality/Hebrew reviews do not block a run but label the capability and every result.
- Bounded BiRefNet trial (owner-authorised): 444 MB downloaded and verified in 29 s; one CPU inference ~30 s; matte IoU 0.9997 on one synthetic image with known truth; RGBA cutout attached and alpha pixel-checked through the shared compositor. Functional evidence only.
- Ingest derivatives (worker-built, lead-integrated): JPEG thumbnail sprite selected by frame index, 3-level waveform peaks, H.264 proxy with identical frame count/rate (every proxy frame barcode-checked), restart recovery, served via REST and announced over SSE. Not yet used by the UI or the preview.
- `GET /api/v1/openapi.json` does not list itself (known gap).

## In progress
- Phase 2b: range-read asset access and bounded decoder/frame caches; use the proxy for preview.
- Phase 2c: conformance fixtures and seeded seek tests; preview A/V sync measurement; long-media behaviour.

## Blocked / unverified (with what would unblock)

| Item | State | Affected criterion | Unblocked by |
|---|---|---|---|
| Quality review and GPU qualification of BiRefNet (and every other model workflow) | implemented, not runtime-qualified | A1 G1 gates, FFG-05, FFG-11 | Reviewed real-image fixtures (hair, edges, blur, occlusion) with usable licences; a GPU profile. Further model downloads need a new authorisation (the 1 GB trial grant is used: 0.44 GB) |
| GPU compositor, GPU/VRAM qualification, Appendix C2 performance targets | implementation can proceed; execution cannot be verified (B-1) | Phases 2, 4, 7, 13; FF-06 | A GPU reference machine |
| Browser MP4+AAC export | blocked here (B-2) | Phase 4 browser route | A Chrome build with AAC WebCodecs encode |
| Preview A/V sync; preview/export parity across many frames; long media; real camera/phone footage; other browsers; other MCP hosts | unverified | Phases 2–4 gates | Scheduled in Phase 2/4 below; other browsers are not installed here (Chromium only) |
| Worker lease / prewarm / budgets (FF-07) | not started | G3, Phase 10 | Phase 5 scopes + Phase 10 |
| No pull request | deferred by owner | — | Branch organisation later |

## Dependency-aware task list (next first)

1. **Phase 2b** (lead): HTTP range reads for assets in the editor and render worker (no whole-file download); bounded decoder + frame cache with explicit budgets; preview decodes the proxy, export decodes the original; resource-lifetime test.
2. **Phase 2c** (worker for fixtures, lead for evaluator rules): VFR / rotation conform route; fixtures for H.264/VP9/AV1, B-frames, 30000/1001; 1,000 seeded seeks per fixture against barcode truth; 10-minute flash/beep export sync fixture; preview A/V sync measurement.
3. **Phase 2 UI use of derivatives** (worker): filmstrip thumbnails and waveforms on timeline clips; per-asset processing state.
4. **Phase 2d** (lead): audio clock via AudioWorklet with shared render contract; remove whole-file `decodeAudioData`.
5. Phase 3 editor interaction → 4 export → 5 agent surface (scopes, proposals, Pause Agent, budgets; also FF-07 worker lease) → 6 typography/captions → 7 motion/catalog/Lab (FF-09) → 8 sound → 9 analysis (G1 remainder: MoGe-2, SeedVR2 — need new download authorisation and GPU) → 10 generative → 11 Director (FF-10, FF-11) → 12 delivery (FF-12) → 13 qualification.
6. Housekeeping: nightly large property/convergence runs; list `/openapi.json` in the document; real-image matting fixtures.

## Next executable action
`pnpm install && pnpm check` (expect 80 tests, proof 48/48); with ComfyUI running, `pnpm proof:g0` (39/39). Then task 1: add range support use in `apps/web/src/media.ts` (Mediabunny `UrlSource`) and cache budgets, starting from `apps/server/src/http.ts` `sendBlob` (already answers Range requests).

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

| 3 | Lead | media staging, model store, BiRefNet trial, integration | as above | as above | — |
| 3 | `pf-implementer` | ingest derivatives + tests | `sonnet` | not observable | 54,498 tok · 139 s |
| 3 | `pf-implementer` | REQUIREMENTS/CAPABILITIES sync (to checkpoint 2) | `sonnet` | not observable | 52,705 tok · 46 s |
| 3 | `pf-scout` | audit of evidence citations | `haiku` | not observable | 23,751 tok · 24 s |

The `pf-implementer` definition was exercised on three real tasks: each stayed inside its file scope and reported defects instead of patching shared code
(it found the undo-body 500 and the raw-JSON idempotency comparison; both fixed by the lead). `pf-scout` was exercised once, read-only, and found two citation mismatches (fixed).
No cost figures are available. No paid call or GPU wake-up has been made. One model download was made under the owner's explicit grant: 444,473,596 bytes.
