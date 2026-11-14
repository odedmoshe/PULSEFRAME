# Progress

Last updated: 2026-11-14, checkpoint 4 (Phase 2 and Phase 3 gate criteria met on the CPU profile; Phase 4 next).

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
| Phase 2 — Media and playback | **Gate criteria met, verified-here**; scope items still open (below) | seek conformance 7 fixtures × 1,000 random seeks, 0 wrong (`docs/evidence/seek-conformance.json`); 10-minute A/V sync export (`docs/evidence/av-sync-long.json`); proof 52/52 |
| Phase 3 — Editor interaction | **Gate criteria met, verified-here**; scope items still open (below) | `pnpm proof:phase3` 27/27 (`docs/evidence/phase3-proof.json`), baselines in `docs/evidence/baselines/` |
| Phase 4 — Production export | Next | — |
| Phases 5–13, G2–G3 | Not started | — |

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

**Checkpoint 4 — Phase 2 (media and playback)**
- Conform route at ingest for variable frame rate, rotation metadata and codecs the editor cannot decode (HEVC): original bytes kept, constant-rate upright H.264 copy edited, mapping recorded (`conform.test.ts`).
- Media read by HTTP range requests; budgets of 6 clip decoders (8 in the render worker), 16 stills, 16 MiB byte cache per decoder; preview decodes the frame-identical proxy, export the original.
- Preview audio decoded as a stream with ~1.5 s lookahead on the audio clock (no whole-file decode).
- **Seek conformance:** H.264 (GOP 30 / B2, GOP 250 / B3), 29.97 fps, 60 fps source in a 30 fps project, VP9/WebM, AV1/MP4, 25 fps — 1,000 seeded random seeks each through the real decode + export path plus a sequential control: 0 wrong frames in 7,000 + 1,950 checks. HEVC is not decoded directly (it is conformed).
- **Ten-minute A/V sync export** (640×360, 16,879 frames after a 37 s + 11 frame cut): 563 flash/beep pairs, max offset 0.063 ms, drift first-third→last-third 0 ms, export 3.45× real time on this CPU.
- **Preview sync, one 3.5 s headless run:** beep onsets within 0.06 ms of timeline positions on the audio clock (sample-accurate AudioWorklet tap); frames painted a median 5–15 ms and p95 ≈ 21–24 ms after the clock reached them (two runs). Not a general performance claim.
  A first measurement with a ScriptProcessor tap showed a false 45 ms lag; it was the instrument, confirmed before changing any playback code.
- Open Phase 2 scope: disk storage quota/garbage collection, OPFS/offline drafts, URL import, Phone Drop, recorder, resumable upload, bins/tags, analysis caches, HDR detection/tone-mapping, memory soak test, monotonic-clock fallback not exercised, real camera/phone footage (none available with a usable licence).

**Checkpoint 4 — Phase 3 (editor interaction)**
- Keyframes (x, y, scale, rotation, opacity; linear/hold/ease) with `set_keyframe` / `delete_keyframe` / `clear_keyframes`; animation is preserved exactly across trim and split (property test); available over REST/MCP automatically.
- Editor rebuilt around a session store and a command registry that drives keyboard, palette and buttons.
- Keyboard-only workflow proven: reach import by Tab, add to timeline with Enter, select, split, trim, nudge (linked audio follows), add text, set keyframes, edit an animated value, step between keys, undo.
- Bilingual command palette (search in either language, niqqud-insensitive), remappable shortcuts stored per user, shortcuts inert while typing or while the palette is open.
- Direct manipulation: timeline drag move/trim with snapping and a ghost; canvas move/scale/rotate handles with keyboard equivalents; each gesture is exactly one transaction.
- Presence: other participants' playhead and selection as labelled ghosts (REST + MCP `set_view`); opt-in Follow Agent that any manual seek or selection ends.
- Activity feed described in the interface language from operation names.
- Filmstrips and waveforms on timeline clips from the ingest derivatives.
- Visual baselines: three deterministic screenshots (reduced motion), compared by SSIM on every run.
- Found by looking at screenshots, then fixed: palette screenshot taken mid-fade (now deterministic), English activity text in the Hebrew UI, 17-decimal drag values.
- Open Phase 3 scope: source viewer, minimap, loop range, J/K/L shuttle, I/O marks, markers, copy/paste, groups, multi-select/marquee, cross-track drag, workspaces (Quick/Pro/Motion), saved layouts, tooltips, first-run demo, tablet/mobile layouts, automated accessibility audit and screen-reader walkthrough (not run), text handle bounds approximate.

## In progress
- Phase 4: export options (range, scale, quality, codec), cancellation and retry, asset/font manifest with render-blocker preflight, full-quality paused preview, parity suite across frames, browser export route where the browser can encode.

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

1. **Phase 4a** (lead): export options + immutable manifest (asset hashes, font hashes, compositor/op versions) + preflight blockers; cancel and retry; stills and audio-only; estimated size labelled as an estimate.
2. **Phase 4b** (worker, after 4a contract): parity suite — raw preview vs raw headless frame (needs full-quality paused preview, lead), and compositor vs decoded export across ≥ 20 frames including text edges, alpha images, rotation and animated layers.
3. **Phase 4c** (worker): browser export route (WebCodecs + Mediabunny mux) with tab lease/heartbeat; capability-gated (this Chromium has no AAC encoder → Opus or server route).
4. **Phase 5** (lead for authorization): per-project/track/range scopes, proposals and branches, Pause Agent, budgets and approvals, worker lease (FF-07), contact sheet / preview clip / describe_moment senses, ten scripted MCP goals.
5. Phase 6 typography/captions → 7 motion/catalog/Lab (FF-09) → 8 sound → 9 analysis → 10 generative → 11 Director (FF-10, FF-11) → 12 delivery (FF-12) → 13 qualification.
6. Carry-over scope from Phases 2–3 listed above; nightly large property/convergence runs; real-image matting fixtures; a11y audit.

## Next executable action
`pnpm install && pnpm check` (expect 143 tests, proof 52/52), `pnpm proof:phase3` (27/27); with ComfyUI running `pnpm proof:g0` (39/39). Then Phase 4a in `apps/server/src/export.ts` (options, manifest, cancel/retry) and `apps/server/src/http.ts`.

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
| 4 | Lead | conform route, range/proxy media, streamed audio + sync measurement, keyframes, editor store/commands, presence, integration, all proofs | as above | as above | — |
| 4 | `pf-implementer` ×6 | seek conformance (61,746 tok · 704 s); filmstrips/waveforms (48,146 · 109 s); OpenAPI sync (36,716 · 33 s); command palette (46,357 · 92 s); drag + canvas handles (53,525 · 121 s); status-doc sync (79,350 · 113 s) | `sonnet` | not observable | as listed |

The `pf-implementer` definition was exercised on three real tasks: each stayed inside its file scope and reported defects instead of patching shared code
(it found the undo-body 500 and the raw-JSON idempotency comparison; both fixed by the lead). `pf-scout` was exercised once, read-only, and found two citation mismatches (fixed).
No cost figures are available. No paid call or GPU wake-up has been made. One model download was made under the owner's explicit grant: 444,473,596 bytes.
