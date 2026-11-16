# PULSEFRAME Studio: Requirement Traceability Map

Governing documents: `docs/SPEC.md` v3.0 (sections 0-30, Appendices A-D) with Amendment A1 (`docs/PULSEFRAME_FREEFIELD_INTEGRATION_ADDENDUM.md`). This file is the map required by SPEC section 1: requirement ID, phase, dependency, UI, op/job/tool, export path and evidence.

## How to read it

- One row is one requirement cluster, not one sentence of the spec. Rows are split as phases begin.
- **ID**: `R-<section>.<n>` for spec sections, `R-A.<n>` for Appendix A catalog targets, `R-C.<n>` for Appendix C test categories, `FF-xx` for addendum requirements, `FFG-xx` for addendum acceptance gates (section 9, in table order).
- **Phase**: Appendix D phase 0-13. Addendum delivery: G0 runs alongside phases 1-2 and completes in phase 10; G1 maps to phase 9 plus the model manager (spec 18); G2 maps to phases 7 (Lab examples), 11 (chaining, Reference Board), 12 (Generative Reframe) and 10 (Relight, Mixed Media); G3 maps to phase 10.
- **Depends on**: requirement IDs that must be correct first.
- **UI / Op, job, tool / Export path**: the surface, registered operation or job, REST/MCP tool, and output path that carry the requirement. "—" means not applicable.
- **Evidence**: a named test file or a check name from `docs/evidence/phase0-proof.json` ("P0: ..."). Empty evidence means none exists yet.

### Status vocabulary

| Status | Meaning |
|---|---|
| `done` | Implemented and verified by a named test or proof check. |
| `partial` | A real slice exists; the missing part is stated in the Requirement or Evidence cell. |
| `not started` | No implementation. |
| `conditional` | Addendum candidate that needs evidence or licensing before it may start. |

Evidence files today: `packages/time/src/time.test.ts`, `packages/core/src/core.test.ts`, `packages/engine/src/evaluate.test.ts`, `packages/i18n/src/i18n.test.ts`, `packages/providers/src/providers.test.ts`, `apps/server/src/store.test.ts`, `apps/server/src/undo.test.ts`, `apps/server/src/openapi.test.ts`, `packages/evals/src/convergence.test.ts`, `packages/evals/src/notices-check.ts` (`pnpm check:notices`), `packages/evals/src/phase0-proof.ts` producing `docs/evidence/phase0-proof.json` (52 checks), `packages/evals/src/g0-proof.ts` producing `docs/evidence/g0-smoke-proof.json` (39 checks, real ComfyUI on CPU), `docs/evidence/phase3-proof.json` (27 checks, editor interaction), `docs/evidence/g1-birefnet-cpu-trial.json` (13 checks, bounded CPU trial), `docs/evidence/phase4-proof.json` (19 checks, export), `docs/evidence/browser-export-proof.json` (23 checks, WebCodecs route), `docs/evidence/parity-suite.json`, `docs/evidence/seek-conformance.json`, `docs/evidence/av-sync-long.json`, `docs/evidence/phase5-proof.json` (24 checks, agent surface and human control), `docs/evidence/capability-probe.json`; also `apps/server/src/{models,derive,conform,browser-export,governance}.test.ts`, `packages/core/src/animation.test.ts`, `apps/web/src/editor/*.test.ts`. All evidence comes from the provisional CPU functional-validation profile, not a GPU reference.

---

## Section 0-1: Mission and method

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-00.1 | 0 | Import-edit-preview-export-agent-edit-live-UI loop runs end to end without paid AI | 0 | R-05.1, R-06.1 | Editor | REST, MCP, export job | Server MP4 | done | P0: full loop checks (agent edit, live UI update, export) |
| R-00.2 | 0 outcomes 1-8 | Eight demonstrated outcomes (vertical edit, long edit, shorts, linked formats, draft from brief, MCP co-edit) | 13 | R-C.14 | — | — | — | not started | Only the single-clip proof loop exists |
| R-01.1 | 1 | Memory files (PROGRESS, CAPABILITIES, TECH_RADAR, BLOCKERS, BENCHMARKS, INTEGRATIONS, licenses) maintained | 0 | — | — | — | — | partial | REQUIREMENTS and ADRs exist; other files lead-owned |
| R-01.2 | 1 | Vertical slices, buildable main, honest capability states, no fake controls | 0 | — | Capability surface | — | — | partial | Slice discipline in place; no capability surface in UI |

## Section 2: Workspaces and design

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-02.1 | 2 | Quick/Pro/Motion/Captions/Color/Sound/Deliver workspace presets over one document | 3 | R-05.1 | Workspace switcher | — | — | partial | Header switch with Pro, Quick, Captions, Sound and Deliver presets that narrow the Inspector panels; view-only, persisted per browser (phase3 proof "workspaces"; checkpoint 15c). No Motion or Color preset, no timeline/library changes per workspace. |
| R-02.2 | 2 | Original logo, wordmark, design tokens, configurable name, Cyber theme | 0 | — | Header brand | — | — | partial | `packages/brand` logo and tokens; no Cyber theme |
| R-02.3 | 2 main layout | Header, preview, transport, library, inspector, timeline, activity feed, jobs tray | 3 | R-06.1 | Editor shell | — | — | partial | Editor shell with library, preview, transport, inspector, timeline, activity feed (localised from operation names), presence ghost; three committed screenshot baselines compared by SSIM (`docs/evidence/baselines/`, `docs/evidence/phase3-proof.json` check "visual baselines…"). No jobs tray, source viewer, minimap Source viewer dialog with in/out marks (phase3 proof, a11y audit; checkpoint 14v). |
| R-02.4 | 2 | Canvas handles, crop, anchor, guides, safe areas, A/B compare, direct text edit | 3 | R-08.1 | Preview canvas | set_clip_transform | — | partial | Canvas move/scale/rotate handles, one transaction per drag (`apps/web/src/editor/interactions.math.test.ts`; phase3 proof "canvas handle…"); text handle bounds approximate. No crop, anchor, guides, safe areas, A/B compare or direct text edit |
| R-02.5 | 2 | Command palette, saved panel arrangements, density, tooltips, keyboard discovery | 3 | R-12.1 | Palette | — | — | partial | Command registry driving keyboard, palette and buttons; bilingual palette; shortcuts remappable per user (`apps/web/src/editor/commands.test.ts`, `palette.search.test.ts`; phase3 proof). No saved panel arrangements, density, tooltips system or workspaces |
| R-02.6 | 2 | Real empty/loading/offline/error/conflict/missing-media states; first-run demo and tour | 3 | R-07.2 | Editor | — | — | partial | Typed errors and first-project bootstrap; no demo, tour, offline or missing-media states |
| R-02.7 | 2 | Tablet layout and mobile capture/review surface | 12 | R-02.1 | Responsive UI | — | — | not started | |

## Section 3: Hebrew, typography direction, accessibility

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-03.1 | 3 | Hebrew default, persistent he/EN toggle, mirrored chrome, LTR timeline and timecodes | 0 | — | Language toggle | — | — | done | P0: UI boots in Hebrew RTL; timeline stays LTR; language toggle switches to English/LTR |
| R-03.2 | 3 | Translate every string with locale-aware plurals | 0 | R-03.1 | All UI | — | — | partial | `i18n.test.ts` key parity he/en; activity feed localised from operation names (phase3 proof "activity feed is written in the interface language…"); plurals not covered |
| R-03.3 | 3 | WCAG 2.2 AA: focus, names, contrast, SR announcements, reduced motion, DOM timeline outline | 3 | R-02.3 | Editor | — | — | not started | No accessibility audit |
| R-03.4 | 3 | Required shortcuts by physical key; disabled while typing; remappable | 3 | R-02.3 | Shortcuts | — | — | partial | Physical-key shortcuts, disabled while typing or while the palette is open, remappable per user (`commands.test.ts`; phase3 proof "remapped shortcut…", "editing shortcuts are inert while the palette is open"). Missing: J/K/L shuttle, I/O marks, markers, copy/paste |
| R-03.5 | 3 | Caption readability and flash intensity as creative controls with reduced-flash alternatives | 7 | R-16.1 | Inspector | — | — | not started | |
| R-03.6 | 3, 15 | Bidi isolation, shaping, graphemes, niqqud, mixed Hebrew/Latin text | 0 | R-15.1 | Text inspector | add_text, update_text | Chromium raster | partial | P0: Hebrew+niqqud+digits+Latin stored verbatim, preview and export; no grapheme animation |

## Section 4: Architecture and deployment

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-04.1 | 4 | Modular TypeScript repo with explicit package interfaces | 0 | — | — | — | — | partial | apps web/server/renderer and packages core/time/engine/brand/i18n/fixtures/evals/providers; audio, media, catalog, ai, agent, ui absent |
| R-04.2 | 4 | One primary deployment profile (local SQLite) documented | 0 | — | — | — | — | done | ADR-0001 plus `store.test.ts` |
| R-04.3 | 4 | Hosted/team profile: PostgreSQL, object storage, distributed workers | 13 | R-04.2 | — | — | — | not started | |
| R-04.4 | 4 | Safe local bind, origin validation, no unauthenticated remote writes | 1 | R-26.1 | — | — | — | done | P0: no credential 401; foreign Host 403; cross-origin session 403 |
| R-04.5 | 4 | Software-renderer / GPU worker profile pinned and measured | 4 | R-09.1 | — | probe | Headless Chromium | partial | `capability-probe.json`; no qualified software profile |

## Section 5: Canonical project and exact time

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-05.1 | 5 | Versioned ProjectDocument with migration entry point, stable ids, binaries outside | 1 | — | — | — | — | partial | Schema v1 for assets, sequences, tracks, clips, text, transform, gain, links (`core.test.ts`) and keyframes on x, y, scale, rotation, opacity (`packages/core/src/animation.test.ts`); no effects, transitions, masks, markers, captions, variants, compounds, buses |
| R-05.2 | 5 | Rational time; frame/sample exactness; half-open intervals; micros only at boundary | 1 | — | Timecode | — | — | done | `time.test.ts` unit and property tests; ADR-0003 |
| R-05.3 | 5 | Non-drop timecode mapping now; drop-frame display, VFR rules, source time maps and speed | 2 | R-05.2 | Transport | — | — | partial | Non-drop only; constant clip speed as an exact ratio with one source-time map (`speed-proof.json`, `speed.test.ts`); VFR handled only by conforming at ingest (`apps/server/src/conform.test.ts`). No drop-frame, ramps, freeze, reverse |
| R-05.4 | 5 | Reference/bounds/overlap/link/lock validation and nesting-cycle checks | 1 | R-05.1 | Typed errors | all ops | — | partial | Bounds, link and off-frame validation in ops; no nesting, track-lock policy per type, transition regions |
| R-05.5 | 5 | Responsive constraints and per-variant overrides for aspect changes | 12 | R-05.1 | Inspector | — | — | not started | |

## Section 6: Operations, transactions, concurrency

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-06.1 | 6 | Named registered pure typed ops, all-or-nothing batches, deterministic ids, one application layer | 1 | R-05.1 | Editor, REST, MCP | rename_project, add_track, add_clip, add_text, update_text, set_clip_transform, set_clip_gain, move_clip, trim_clip, split_clip, delete_clip | — | done | `core.test.ts`; P0: 4-op transaction commits atomically as one revision |
| R-06.2 | 6 | Actor derived from auth; typed actionable errors; dry-run validation | 1 | R-06.1, R-26.1 | Activity feed | POST operations/validate | — | partial | P0: actor attributed from auth; typed stale/off-frame errors; no dependency-aware diffs |
| R-06.3 | 6 | Op log and materialized doc in one transaction with transactional outbox; replay of any revision | 1 | R-06.1 | — | GET project?revision, history | — | done | `store.test.ts`; P0: replay from revision 0 reproduces document |
| R-06.4 | 6 | Idempotency keys and strict expectedRevision; no rebasing without semantic preconditions | 1 | R-06.3 | Conflict toast | transactions | — | done | `undo.test.ts` (entity versions, per-commit entity diff, `baseRevision` rebase, typed `conflict`, strict `expectedRevision`); `store.test.ts` (idempotency compares canonical ops); P0: "rebase:" and "conflict:" checks. Conflicts are entity-level, not property-level |
| R-06.5 | 6 | Undo/redo as compensating transactions preserving unrelated later edits | 3 | R-06.1 | Undo/redo buttons | undo, redo | — | done | `undo.test.ts` (per actor, refusal with conflict list, other actors' edits survive); P0: "agent undo:", "human undo (Ctrl+Z)…", "redo then undo…". No restore-as-branch, no drag coalescing |
| R-06.6 | 6 | Ripple, roll, slip, slide, insert/overwrite, markers, duplicate, ripple-delete, close gaps | 3 | R-06.1 | Timeline tools | new ops | — | partial | User markers (`add_marker`, `update_marker`, `remove_marker`; `markers.test.ts`, `editor-interactions-proof.json`), duplicate/copy/paste (`editor-interactions-proof.json`), range cut that closes the gap (`cut_range`, `phase6-proof.json`). Multi-clip move (`move_clips`, `moveclips.test.ts`). No ripple/roll/slip/slide tools, insert/overwrite modes or close-all-gaps Checkpoint 14w–14x: ripple insert (`insert_gap`; `insertgap.test.ts`, fuzz, phase3 proof "insert at the playhead"); ripple cuts and inserts move markers. Overwrite from the source viewer added in 14y (phase3 proof). Slip (`slip_clip`) added in 14z. Close gaps (`close_gaps`) added in 15b. Still missing: roll and slide as gestures, track targeting. |

## Section 7: Local media, offline work, ingestion

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-07.1 | 7 | Edit local files before upload finishes; OPFS/IndexedDB; quotas; local drafts with base revision | 2 | R-06.4 | Library, save state | — | — | not started | |
| R-07.2 | 7 | Streamed upload, sha256 content addressing, ffprobe; immutable originals (video/audio, CFR, unrotated) | 2 | R-04.2 | Library import | POST assets, import_asset | — | partial | P0: server probed and content-addressed the file; still images (PNG/JPEG/WebP) ingest with exact dimensions and render (`docs/evidence/g0-smoke-proof.json` "still image upload…"); rotation, VFR and non-decodable codecs (HEVC) go through the conform route with original bytes kept (`apps/server/src/conform.test.ts`). No HDR, resumable upload, dedup UI |
| R-07.3 | 7 | Ingestion routes: URL import, Phone Drop, recorder, folders, stock connectors | 3 | R-26.3 | Library | job | — | not started | |
| R-07.4 | 7 | Thumbnails, multiresolution waveforms, proxies, original/proxy/conform mapping | 2 | R-07.2 | Timeline badges | proxy job | — | done | Frame-indexed thumbnail sprite, 3-level waveform peaks, frame-identical H.264 proxy, restart recovery (`apps/server/src/derive.test.ts`; `docs/evidence/phase0-proof.json` "ingest derivatives…"); conform mapping recorded (`conform.test.ts`). Analysis caches and bins not covered here |
| R-07.5 | 7 | Bins, tags, favorites, usage counts, missing-media recovery, relink | 3 | R-07.2 | Library | — | — | not started | |
| R-07.6 | 7 | Analysis cache keyed by content, range, parameters and model version | 9 | R-20.1 | — | analysis job | — | not started | |

## Section 8: Render graph and visual contract

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-08.1 | 8 | Pure evaluator and one compositor shared by preview, render_frame and export | 2 | R-05.1 | Preview | render_frame | Server export | partial | `evaluate.test.ts`; Canvas2D only; no effects, blends, transitions, masks |
| R-08.2 | 8 | WebCodecs decode (Mediabunny); keyframe/B-frame/PTS-correct seek; reverse via GOP cache | 2 | R-08.1 | Preview | — | — | partial | P0: exact frame 60; "preview after reload decodes the proxy…" (range reads, 12 random seeks); "decoder count stays within its budget". `docs/evidence/seek-conformance.json` (`packages/evals/src/seek-conformance.ts`): 7 fixtures x 1,000 seeded random seeks plus sequential control, 0 mismatches, all fixtures pass (one seed, one run). HEVC not directly decodable (conformed); VFR only via conform; no reverse/GOP cache; no nightly runs Non-zero stream and container start times handled by the frame rule and decoders (`start-offset.json` 4 checks, `input-matrix.json` 25 shapes; before that such files failed to export or lost sync) |
| R-08.3 | 8 | WebGPU preferred, WebGL2 fallback, pooled targets, device-loss recovery, linear-light intermediates | 7 | R-08.1 | — | capability probe | — | not started | Canvas2D only |
| R-08.4 | 8 | SDR Rec.709 with explicit transfer/range metadata; documented HDR-to-SDR tone map | 2 | R-07.2 | — | — | Server MP4 | partial | BT.709 tagged export. HDR sources (PQ, HLG) are tone-mapped at import: reference white 203 nits → standard white, BT.2020 → BT.709, mobius roll-off of highlights; the method is stored on the asset (`conform.test.ts`, synthetic bars only). No HDR output |
| R-08.5 | 8 | Deterministic seeded noise; temporal effects window; seek equals sequential evaluation | 7 | R-13.1 | — | — | — | partial | Seeded grain is a pure function of seed + frame; random access byte-identical (`phase7-proof.json`, `look.test.ts`). No temporal effects exist yet |
| R-08.6 | 8 | Effect contract: id/version, params, budgets, fallback, cache key; unsupported effect is a blocker | 7 | R-12.1 | Inspector | — | — | partial | Registry with id/version/params/defaults/cost; unknown effect is a validation issue and an export blocker; manifest lists versions (`effects.test.ts`, `phase7-proof.json`). No budgets, fallbacks or cache keys |

## Section 9: Export

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-09.1 | 9 | Server export from immutable snapshot, durable job, headless Chromium to raw RGBA to ffmpeg libx264+AAC MP4, probe-validated | 4 | R-08.1, R-20.1 | Export button | export_project, POST exports, get_job | Server MP4 | done | P0: playable H.264+AAC MP4; pre-edit snapshot used; exact frames; decodes without errors; parity PSNR>=36 SSIM>=0.985; `docs/evidence/phase4-proof.json`: immutable manifest, preflight blockers, MP4/WebM/WAV/PNG, range/scale/quality |
| R-09.2 | 9 | Browser export route with tab lease/heartbeat; auto routing | 4 | R-08.2 | Export dialog | export job | OPFS / file stream | partial | `docs/evidence/browser-export-proof.json` (23 checks) and `apps/server/src/browser-export.test.ts`: WebCodecs route with tab lease and heartbeats, `lease_lost`, single-use completion, no takeover by another session; frames source-exact, SSIM >= 0.97 vs server route. H.264 + Opus in MP4 on this Chromium (no AAC encoder; declared substitution). Output buffered in memory (no OPFS/stream); no automatic routing; one Chromium only |
| R-09.3 | 9 | Cancellation, retry, range export, presets, estimate, measured stages | 4 | R-09.1, R-20.1 | Jobs tray | cancel_job | MP4 | partial | `docs/evidence/phase4-proof.json`: cancel (queued removed, running stopped, nothing published), retry from the same snapshot, frame-range export, scale/quality options, labelled estimate, editor Cancel/Retry. No jobs tray, no checkpoint/resume, stage measurements only in evidence files |
| R-09.4 | 9 | Stills, GIF/WebP, audio-only, subtitle sidecars, clean/captioned masters, project archive | 4 | R-09.1, R-16.1 | Export dialog | export job | PNG/JPEG/WebP/GIF/SRT/ZIP | partial | PNG still, WAV, GIF, SRT/VTT sidecars with clean or captioned picture, project archive, batch formats (`phase4-proof.json`, `phase6-proof.json`, `archive.test.ts`, `soak.json`). No JPEG/WebP stills, animated WebP |
| R-09.5 | 9 | Software-renderer profile with startup readback self-test | 4 | R-04.5 | Diagnostics | probe | Headless | partial | `capability-probe.json`; no self-test on every startup, no software qualification |

## Section 10: Audio

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-10.1 | 10 | Clip gain/trim/placement mix; WebAudio preview on audio clock with monotonic fallback | 2 | R-08.1 | Transport | set_clip_gain | ffmpeg mix | partial | P0: beats land within one frame; stream duration matches video; preview audio streamed with bounded lookahead on the audio clock, onsets within 0.06 ms of timeline positions, video paint lateness median ~15 ms / p95 ~21 ms ("preview audio (streamed…", "preview playback ran to the end…"); one 3.5 s run on the CPU profile. No pan, fades, buses, AudioWorklet DSP |
| R-10.2 | 10 | Shared DSP modules: EQ, compressor, gate, limiter, de-esser, denoise, reverb, delay, pitch | 8 | R-10.1 | Sound workspace | audio ops | Offline host | not started | |
| R-10.3 | 10 | Meters, loudness/true-peak normalization, ducking, buses, mute/solo | 8 | R-10.2 | Meters | loudness op | Mix | partial | Track gain/pan/mute, range-based speech ducking, R128 measurement, static-gain normalisation with true-peak ceiling, level meter, linear volume automation keys per clip (`phase8-proof.json`, `audio.test.ts`). No buses, solo, limiter, automation curves; meter not verified in live playback |
| R-10.4 | 10 | Music tools: beat grid, tap tempo, downbeat, fit-to-duration, stems; J/L edits, crossfades | 9 | R-10.1 | Timeline | beat job | — | partial | Beat grid with tempo and confidence, editable (`phase9-proof.json`, `beats.test.ts`, synthetic loops only); clip moves can snap to beats; bar starts (downbeats) from the loudest beat of each bar when the accent is regular (3 or 4 beats to the bar; synthetic accented loops only), editable; `fit_music` ends the music on a beat; sound crossfades exist. No tap tempo, no stems, no re-arranging of music; nothing verified on real music |
| R-10.5 | 10 | Procedural and licensed SFX with recipe/seed metadata; voice changers; censor bleep | 8 | R-10.2 | Sound drawer | add_clip | Mix | partial | 7 synthesised sounds as assets with recipe provenance (`phase8-proof.json`). No licensed library, voice changers or bleep |

## Section 11: Timeline and precise editing

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-11.1 | 11 | Track kinds video/audio/text; basic add/move/trim/split/delete with linked audio | 1 | R-06.1 | DOM timeline | add_track, add_clip, move_clip, trim_clip, split_clip, delete_clip | — | done | `core.test.ts`; P0: keyboard split splits picture and linked audio; add creates linked clips |
| R-11.2 | 11 | Image, caption, SFX, vector, adjustment, nested-sequence tracks | 3 | R-05.1 | Timeline | new track kinds | — | not started | |
| R-11.3 | 11 | Track controls: lock, visibility, mute, solo, rename, height, reorder, grouping | 3 | R-06.1 | Track header | update_track | — | partial | Lock/mute/hidden flags in schema; no ops or UI beyond creation |
| R-11.4 | 11 | Ripple/roll/slip/slide, insert/overwrite, J/L, detach, freeze/reverse, ramps | 3 | R-06.6, R-05.3 | Timeline tools | new ops | — | partial | Checkpoint 14m–14w: J/L shuttle up to 8× (silent; editor-interactions proof), freeze frame (speed proof), ripple insert from the source viewer (phase3 proof). Later: slip, overwrite, close gaps and picture reverse (`set_clip_reverse`, 15e) added. Detach (`unlink_clip`, 15g) added. Reversed sound (15m) and a stepped speed ramp (15s) added. Roll (15t), slide and relinking (15u) by keyboard/palette added. Missing: roll and slide by dragging, continuous ramps, K = stop. |
| R-11.5 | 11 | Transitions with handle model and explicit shortage policy; markers and protected ranges | 7 | R-06.6 | Timeline | transition ops, marker ops | — | partial | Transitions with a source-handle model and refusal with the usable length (`phase7-proof.json`); user markers (`editor-interactions-proof.json`). No protected ranges |
| R-11.6 | 11 | Filmstrips, waveforms, badges, minimap, keyframe lanes; virtualization by measurement | 3 | R-07.4 | Timeline | — | — | partial | Filmstrip thumbnails and waveforms on timeline clips (`apps/web/src/clipVisuals.math.test.ts` covers the index math; the drawing itself has no automated test). No minimap, keyframe lanes, virtualization measurement |

## Section 12: Catalog system and Lab

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-12.1 | 12 | Versioned catalog entries (schema, defaults, ranges, license, preview, export) generating inspectors, search, palette, API/MCP discovery | 7 | R-06.1 | Library drawers | list_catalog, GET catalog/:kind | — | partial | Effects, transitions, blends, masks, caption presets, motions, fonts discoverable via `GET /api/v1/catalog` and `list_catalog`; effect inspectors generated from schemas. No licence/preview metadata per entry, no search |
| R-12.2 | 12 | /lab with 16:9 and 9:16 fixtures, paired preview/export frames, contact sheets, loops | 7 | R-12.1, R-08.1 | /lab | — | PNG, loop | partial | `/lab.html`: 134 tiles, 16:9 + 9:16, default/extreme, transitions in 5 steps, drawn by the shared compositor (`phase7-proof.json`). No paired export frames, contact-sheet export or loops |
| R-12.3 | 12 | Hover preview, apply, intensity, bypass, before/after, reorder, favorites, recents, user presets | 7 | R-12.1 | Inspector | effect ops | — | partial | Apply, parameters, bypass, reorder, remove in the editor. No hover preview, before/after, favourites, recents, user presets |

## Section 13: Effects, masks, keying, transitions

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-13.1 | 13 | Effect families (camera, color, lens, blur, time, distortion, digital) with seeded determinism | 7 | R-08.6 | Effects drawer | effect ops | Compositor | partial | 12 Canvas2D effects (color, blur, light, stylize, digital), pixel-checked. Camera/lens/time/distortion families need a GPU compositor (B-1) |
| R-13.2 | 13 | Masks, mattes, chroma key with spill suppression, blend set | 7 | R-08.1 | Mask editor | mask ops | Compositor | partial | Rect/rounded/ellipse masks with feather/invert; 17 blend modes with arithmetic checks. No polygon/text masks, mattes or chroma key |
| R-13.3 | 13 | Subject workflows: cutout, background treatments, outline, echo, tracked blur | 9 | R-13.2, R-19.3 | Subject Stage | analysis, mask ops | Compositor | not started | |
| R-13.4 | 13 | Transition families incl. smart transitions; AI Bridge as separate async capability | 7 | R-11.5 | Transitions drawer | transition ops, bridge job | Compositor | partial | 12 transitions with exact-arithmetic checks and handle validation. No smart transitions, no audio crossfade, no AI Bridge |

## Section 14: Motion, velocity, depth, layouts

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-14.1 | 14 | Keyframes, easing, Bezier and spring curves, motion paths, graph editor | 7 | R-05.1 | Graph editor | keyframe ops | Compositor | partial | Keyframes for x, y, scale, rotation, opacity with linear/hold/ease easings; ops set_keyframe/delete_keyframe/clear_keyframes; exact preservation across trim and split (`packages/core/src/animation.test.ts`, `packages/engine/src/evaluate.test.ts`). No graph editor, Bezier/spring, motion paths, keyframes on crop/mask/effects/audio |
| R-14.2 | 14 | Time remapping: speed, ramps, reverse, freeze, boomerang, fit-to-duration, audio policy | 7 | R-05.3 | Inspector | time ops | Compositor, audio | partial | Constant speed 0.1–8×, freeze frame, reverse (picture and sound), stepped and continuous speed ramps, and a choice of sound policy: pitch follows speed, or pitch kept (`speed-proof.json`, `reverse-sound-proof.json`, `pitch-proof.json`; synthetic fixtures only). Continuous ramps exist, even or eased (`set_clip_speed_ramp`), and can be trimmed and cut. No boomerang, no fit-to-duration for picture |
| R-14.3 | 14 | Typed signal bindings (beat, band, speech, motion, landmark) baked to keys | 9 | R-14.1, R-20.1 | Motion workspace | binding ops | Compositor | not started | |
| R-14.4 | 14 | Depth features (2.5D parallax, haze, push) with stated limits | 9 | R-13.3 | Photo Motion | depth job | Compositor | not started | |
| R-14.5 | 14 | Native layouts with draggable dividers; responsive reflow; linked variants | 7 | R-05.5 | Canvas | layout ops | Compositor | not started | |

## Section 15: Text, fonts, elements, animation

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-15.1 | 15 | Shared shaping/layout contract for browser and export; pinned fonts | 6 | R-08.1 | Text inspector | add_text, update_text | Chromium raster | partial | Chromium shaping, bundled pinned Heebo; no HarfBuzz-shared contract; P0: Hebrew+niqqud text in preview and export |
| R-15.2 | 15 | Text style: direction, wrap, stroke, background (now); rich spans, fit-to-box, gradients, extrusion | 6 | R-15.1 | Text inspector | update_text | Compositor | partial | Direction, word wrap, stroke, background only |
| R-15.3 | 15 | Grapheme/word/line text animation, text on path, lower thirds, chips, end cards | 6 | R-14.1 | Text drawer | animation ops | Compositor | not started | |
| R-15.4 | 15 | Font catalog, uploads, manifests, script filters, emoji strategy | 6 | R-26.5 | Fonts drawer | font ops | Font manifest | not started | One bundled font only |
| R-15.5 | 15 | Native vectors; SVG, Lottie, GIF, APNG, animated WebP import with deterministic sampling | 7 | R-26.4 | Elements drawer | add_clip | Compositor | not started | |

## Section 16: Captions, transcript, Hebrew speech

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-16.1 | 16 | Caption data model, cues, SRT/VTT import/export, native rich captions, ASS export | 6 | R-05.1 | Captions workspace | cue ops | SRT/VTT/ASS | partial | `phase6-proof.json`, `subtitles.test.ts`, `captions.test.ts`: cue model, SRT/VTT import/export, ASS export, transcript-linked captions. No rich per-cue styling, no per-word manual timing UI |
| R-16.2 | 16 | ASR/alignment adapters, stable word ids, corrections, per-language timing corpus | 6 | R-18.1 | Transcript panel | asr job | — | partial | Stable word ids, corrections keeping the original, timing grades (`captions.test.ts`). ASR/alignment adapters and timing corpus blocked (B-7) Local recognition adapter with word times and confidence (`speech-proof.json`, 26 checks, functional on CPU); word timing for typed transcripts through recognition (`mode: align`); dedicated aligner and per-language timing corpus not built |
| R-16.3 | 16 | Transcript-guided edits, silence/filler candidates, caption remap after cuts | 6 | R-16.2, R-06.6 | Transcript panel | cleanup proposal | — | partial | `delete_transcript_range`, `cut_range`, silence candidates (`find_silences`) as reviewable ops; captions follow cuts by construction (`phase6-proof.json`, synthetic). Filler candidates by rule from the transcript (`find_filler_words`, `speech-proof.json`); not tried on real hesitant speech |
| R-16.4 | 16 | Caption styles (karaoke, current word), reading-speed rules, translation timing review | 6 | R-16.1 | Caption inspector | style ops | Compositor | partial | 7 presets incl. karaoke and current-word box (`phase6-proof.json` golden renders). No reading-speed rules, no translation review |

## Section 17: Narration, voices, localization

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-17.1 | 17 | TTS narration with takes, pronunciation, provider-gated controls, provenance | 8 | R-18.1, R-20.2 | Narration drawer | tts job | Mix | partial | Local voice model: narration job → audio asset with recipe in provenance, placed at a time; other seed = other take; Hebrew pointed automatically, hand-pointed text spoken as written (`voice-proof.json`, functional on CPU; nobody listened); script narrated sentence by sentence. No voice list with previews, no pronunciation dictionary, no delivery controls |
| R-17.2 | 17 | Voice cloning via real provider verification; revoke/delete | 8 | R-17.1, R-21.4 | Voice settings | approval, clone job | — | partial | Reference voice (editor form and REST): owner session, named speaker and ticked statement, consent statement stored in the asset's provenance, agents refused, minimum 5 s (`voice-proof.json`; tried with a synthetic reference only). No likeness check, no revoke/delete of takes made from a reference |
| R-17.3 | 17 | Dubbing pipeline (ASR, translation, speakers, synthesis, duration) and lip sync | 10 | R-17.1, R-16.2 | Dub panel | dub job | Mix | not started | |

## Section 18: AI tiers and capability registry

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-18.1 | 18 | Capability registry and adapter records (versions, limits, licenses, retention, pricing, test status) | 10 | R-12.1 | Capabilities panel | get_capabilities | — | partial | `packages/providers` descriptor and adapter contract (`providers.test.ts`); no registry persistence, no UI, no REST/MCP surface |
| R-18.2 | 18 | Browser/service/provider tiers; auto routing; local-only mode | 9 | R-18.1 | Settings | routing | — | not started | |
| R-18.3 | 18 | On-device model manager: pinned checksums, download, cancel, quota, removal | 9 | R-18.1 | Model manager | download job | — | partial | Resumable, host-restricted, size+SHA-256-verified download; explicit owner-only download bound to the exact byte count (`apps/server/src/models.test.ts`; `docs/evidence/g1-birefnet-cpu-trial.json`). Uninstall not built; cancel and quota not evidenced |

## Section 19: Signature creative workflows

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-19.1 | 19.1 | Rhythm Composer with confidence, tap tempo, range regeneration | 9 | R-10.4, R-14.3 | Rhythm panel | compose job | Compositor | partial | Beat markers with confidence, manual add/remove, scripted cut-on-bar-lines demo (`phase9-proof.json`). No Rhythm Composer UI, tap tempo or range regeneration |
| R-19.2 | 19.2 | Dance and Movement Lab (pose, trails, takes, multicam sync) | 9 | R-19.3 | Dance Lab | pose job | Compositor | not started | |
| R-19.3 | 19.3 | Subject Stage (mask/track, text behind subject, blur) | 9 | R-13.2 | Subject Stage | track job | Compositor | not started | |
| R-19.4 | 19.4, 19.5 | Depth and Photo Motion; Reference-to-Recipe | 9 | R-14.4, R-24.1 | Photo Motion | depth, reference job | Compositor | not started | |
| R-19.5 | 19.6, 19.7 | Hook Lab and Long-to-Shorts Studio | 11 | R-16.2, R-23.1 | Director | alternate sequences | Batch export | not started | |
| R-19.6 | 19.8 | Linked Format Studio (16:9, 9:16, 1:1, 4:5 with overrides) | 12 | R-05.5 | Format switcher | fork_variant | Batch export | partial | Variants with overrides surviving master edits, contain/cover, safe-area guides, batch export (`phase12-proof.json`, `variants.test.ts`). No per-format caption style or text; canvas override drag not browser-verified |
| R-19.7 | 19.9, 19.10 | Prompt-to-Draft; Smart B-roll and Semantic Media Room | 11 | R-17.1, R-07.6 | Director | draft job | — | not started | |
| R-19.8 | 19.11-19.13 | Scene-synced sound; Style Composer macros; Metadata and Thumbnail Studio | 11 | R-10.5, R-24.1 | Sound/Deliver | macro run | PNG, metadata | not started | |
| R-19.9 | 19.14 | Creative Preflight linking issues to objects and fixes; warnings vs blockers | 12 | R-08.6, R-07.2 | Preflight panel | preflight | — | partial | Preflight with blockers vs warnings vs notes, object ids and fix ops (`phase12-proof.json`). Eight checks only; no audio-clipping, contrast or platform-rule checks |

## Section 20: Durable jobs, spending, late results

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-20.1 | 20 | Durable job record, queue states, restart recovery of outbox and jobs | 1 | R-06.3 | Jobs tray | get_job, GET jobs/:id | Export | partial | `store.test.ts`; P0: restart persists jobs; no cancel-requested, awaiting-provider, submission-unknown |
| R-20.2 | 20 | Persist submission intent, provider idempotency, reconcile unknown submissions | 10 | R-20.1, R-18.1 | Jobs tray | reconcile_job | — | not started | |
| R-20.3 | 20 | Atomic budget reservation, usage reconciliation, signed webhooks, expiring result URLs | 10 | R-21.4 | Budget panel | reserve_budget | — | partial | Budget ledger (atomic reservation, settle/release, unknown outcomes stay counted) unit-tested only in `apps/server/src/governance.test.ts`; no paid provider, so not exercised end to end. No signed webhooks or expiring result URLs |
| R-20.4 | 20 | Late result revalidated against entity versions; proposed attachment, never overwrite | 10 | R-20.1, R-06.4 | Proposal review | attach op | — | partial | Model-free path only: `docs/evidence/g0-smoke-proof.json` stale-result checks (nothing placed, asset kept as proposal). No proposal review UI, no model-based or paid provider |

## Section 21: Director, proposals, human control

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-21.1 | 21 | Director chat with provider-neutral AgentRuntime and approved tools only | 11 | R-22.4 | Director panel | AgentRuntime | — | not started | |
| R-21.2 | 21 | Permission modes Observe/Propose/Edit/Autopilot with project/track/range/budget scopes | 5 | R-26.1 | Settings | grants | — | partial | Grants with Observe/Propose/Edit/Autopilot, project/track/time-range limits enforced from the entity diff, expiry and revocation (`apps/server/src/governance.test.ts`; `docs/evidence/phase5-proof.json` incl. scoped captions-only agent, revoked grant 401, project-limited grant on REST/MCP/job routes). Range limits only unit-tested; no grants management UI (REST only); budget scope unit-tested only, no paid provider |
| R-21.3 | 21 | Proposal branches, diffs, accept by transaction, ghost selection, Follow Agent | 5 | R-23.1 | Proposal review | proposal ops | — | partial | Presence only: agent/human ghost playhead and selection via REST and MCP `set_view`; opt-in Follow Agent that a manual seek ends (`apps/server/src/presence.ts`; phase3 proof). Proposals: Propose-mode edits return a proposal, owner reviews before/after stills in the editor and accepts or rejects; accepted proposals commit under the owner and are undoable; a proposal on changed content goes stale (`governance.test.ts`; phase5 proof goals 7a-7c and stale check). Follow Agent is opt-in and a manual seek ends it (phase3 proof). No proposal branches, no per-range accept |
| R-21.4 | 21 | Pause Agent, single-use approval records bound to action hash, rate limits | 5 | R-21.2 | Header | pause_agent, approval | — | partial | Pause Agent / Take Over is owner-only and server-side (`agent_paused`; reads and owner edits continue; an agent cannot resume itself) and approvals are single-use, expiring, bound to an action hash and decided only by the owner session (`governance.test.ts`; phase5 proof). The approval is NOT bound to a project revision. Used only for agent-requested model downloads. No rate limits; no approvals management UI Per-grant request budget (`ratelimit.test.ts`, owner-ui proof) and an approvals list in the editor (phase5 proof, reject path) added in checkpoints 14r–14u. |
| R-21.5 | 21 | Untrusted-content handling; versioned playbooks as resources/prompts | 5 | R-22.5 | — | MCP prompts | — | partial | Four playbook prompts (v1) and a guide resource, each stating that project text is data; prompts do not inline project text; playbooks name only existing tools (`mcp-resources.test.ts`). Not evaluated with a model; tool results are not marked or wrapped as untrusted |

## Section 22: REST, MCP, agent senses

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-22.1 | 22 | REST subset under /api/v1 (projects, summary, timeline, transactions, operations, validate, history, events, assets, frame, exports, jobs) | 1 | R-06.1 | — | REST routes | — | partial | P0 checks; missing capabilities, transcript, jobs POST/cancel, catalog; `GET /api/v1/openapi.json` now exists (`openapi.test.ts`) |
| R-22.2 | 22 | OpenAPI and MCP schemas generated from op/command/catalog definitions | 5 | R-06.1, R-12.1 | API/MCP dialog | GET openapi.json, describe_ops | — | done | OpenAPI 3.1 generated from the op registry at `GET /api/v1/openapi.json` with a drift test (`apps/server/src/openapi.test.ts`, checked both ways against the route table, 60 operations per PROGRESS); MCP tool schemas generated from the same registry. Catalog definitions do not exist yet |
| R-22.3 | 22 | Agent senses: summary, timeline, render_frame, describe_ops, get_job | 1 | R-08.1 | — | get_summary, get_timeline, render_frame, get_job, describe_ops | PNG | partial | P0: get_timeline exact times; render_frame PNG with revision; Phase 5 adds `describe_moment`, `render_contact_sheet`, `plan_export`, `get_controls` (35 MCP tools from one registry; `docs/evidence/phase5-proof.json`). No preview-clip, transcript or audio-analysis senses |
| R-22.4 | 22 | MCP 2026-07-28 via official SDK with deliberate legacy fallback; revision events separate from MCP | 1 | R-06.1 | — | MCP server | — | done | P0: negotiated 2026-07-28; 2025-era client served by legacy fallback; no credentials 401; SSE revision events (`store.test.ts`) |
| R-22.5 | 22 | MCP resources, prompts, annotations, Tasks extension when declared, optional MCP App | 5 | R-20.1 | — | MCP | — | partial | Resources (static + per-project templates with listing), prompts, read-only annotations, grant-scoped (`mcp-resources.test.ts`). No subscriptions, Tasks extension or MCP App |
| R-22.6 | 22 | Core / full / observe-only toolsets; API/MCP dialog with token management and diagnostics | 5 | R-21.2 | API/MCP dialog | token ops | — | partial | Bearer tokens with scopes and named grants (`governance.test.ts`); no toolset selection, no API/MCP dialog or token-management UI (REST only) |

## Section 23: History, collaboration, recovery

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-23.1 | 23 | Checkpoints, restored branches, alternative sequences, proposal diffs | 5 | R-06.5 | Versions panel | checkpoint, restore | — | not started | |
| R-23.2 | 23 | Revision events with replay on reconnect; readable history by actor | 1 | R-06.3 | Activity feed | GET events, history | — | done | `store.test.ts` SSE replay on reconnect; P0: activity feed attributes change to agent |
| R-23.3 | 23 | Save states (saving, saved, pending, upload incomplete, conflict) | 3 | R-07.1 | Header | — | — | not started | |
| R-23.4 | 23 | Roles, presence, timecoded comments, review links | 12 | R-26.1 | Review UI | comment ops | — | not started | |
| R-23.5 | 23 | Asset GC respecting references; project archive with manifests, import and relink tests | 13 | R-09.4 | Project menu | archive job | ZIP | partial | Project archive with manifest, verified import, restore on a second server (`archive.test.ts`, `soak.json`). No asset GC, no relink |

## Section 24: Recipes, brands, extensions

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-24.1 | 24 | Recipes compiling to native clips; slots; save-as-template; macros | 11 | R-12.1 | Templates drawer | run_recipe | Compositor | partial | Three rule-based recipes compiling to native clips/ops, one undo, alternatives, regeneration that keeps hand edits (`phase11-proof.json`). No slots, save-as-template or user macros |
| R-24.2 | 24 | Brand kits with logos, fonts, colors, captions, sound; per-instance overrides | 11 | R-24.1 | Brand drawer | brand ops | Compositor | not started | |
| R-24.3 | 24 | Trend packs (curated or reference-derived); extension manifests; trusted built-ins first | 13 | R-24.1 | Extensions | — | — | not started | |

## Section 25: Publishing, deliverables, provenance

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-25.1 | 25 | Platform profiles as data with safe-area overlays and checked dates | 12 | R-12.1 | Deliver workspace | profile ops | Profile preset | not started | |
| R-25.2 | 25 | YouTube/TikTok connectors with explicit visibility and authorization; tokens excluded from archives | 12 | R-26.2 | Publish dialog | publish job | Connector | not started | |
| R-25.3 | 25 | Asset provenance records and C2PA signing where supported | 12 | R-20.1 | Inspector | provenance | Signed MP4 | not started | |

## Section 26: Security, privacy, licensing

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-26.1 | 26 | Loopback bind, Host check, origin-checked cookie session, scoped bearer tokens on REST and MCP | 1 | — | Session | auth middleware | — | partial | ADR-0002; P0: 401, 403 scope, cross-origin 403, DNS-rebinding 403; owner session bound to a launch secret; strict content security policy and hardening headers on every response (`phase5-proof.json`, 33 checks). Optional per-credential request limit for agents, off by default (`ratelimit.test.ts`). No tenant authz, audit trail; cookie not `Secure` on loopback HTTP |
| R-26.2 | 26 | Encrypted secret store/OS keychain, key masking, rotation, error redaction | 10 | R-26.1 | Settings | secret ops | — | not started | |
| R-26.3 | 26 | SSRF-safe URL import, restricted worker egress | 3 | R-07.3 | Library | import job | — | not started | |
| R-26.4 | 26 | Sandboxed FFmpeg/font/SVG/archive parsing, quotas, path-traversal and archive-bomb defenses | 13 | R-26.1 | — | — | — | partial | ffmpeg run with argument arrays; archive path checks (`archive.test.ts`); optional whole-directory storage ceiling (`quota.test.ts`). No per-project quotas or sandbox verification |
| R-26.5 | 26 | License manifests, FFmpeg build record, notices, commercial-profile model policy | 13 | R-18.1 | Capabilities | — | — | partial | Commercial profile excludes non-commercial models at descriptor level (`providers.test.ts`). Built web app ships `THIRD_PARTY_NOTICES.txt` with full licence texts for bundled packages; `pnpm check:notices` (`notices-check.ts`) is part of `pnpm check`; the build-fails-on-missing-licence path is untested. No FFmpeg build record, no model manifests |

## Section 27-28: Provider-free core and delivery

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-27.1 | 27 | Provider-free core: import, timeline, text, audio, save/reload, baseline export | 0 | R-09.1 | Editor | all | Server MP4 | partial | P0: works without credentials; keyframes exist; no effects, caption editing |
| R-27.2 | 27 | Five honest AI capability states; mocks only in tests; labelled demo projects | 10 | R-18.1 | Capabilities panel | get_capabilities | — | partial | Seven-dimension descriptor with computed blockers (`providers.test.ts`); no UI |
| R-28.1 | 28 | Deliverables 1-12 (source, brand, OpenAPI, profiles, catalogs, manifests, containers, guidance) | 13 | all | — | — | — | not started | |

## Section 29-30: Glossary and tool coverage

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-29.1 | 29 | Core Hebrew glossary applied to UI strings | 0 | R-03.1 | All UI | — | — | partial | he/en dictionaries with key-parity test (`i18n.test.ts`); glossary conformance not audited |
| R-30.1 | 30 project/history | Project, history, markers, checkpoint, fork, proposals, undo/redo tools | 5 | R-06.5, R-23.1 | — | MCP/REST | — | partial | rename_project, marker ops, proposals, own-transaction undo/redo as MCP tools (`phase5-proof.json`, `markers.test.ts`). No checkpoint or fork tools |
| R-30.2 | 30 tracks, clips | Track ops and clip ops (import/add/move/trim/split/delete; slip, slide, duplicate, compound, insert) | 5 | R-11.4 | — | MCP/REST | — | partial | add_track, add_clip, move_clip, trim_clip, split_clip, delete_clip; rest missing `insert_gap` (14w), `slip_clip` (14z), `close_gaps` (15b), `unlink_clip` (15g), `update_track` and `remove_track` (15h) added. |
| R-30.3 | 30 time, animation, appearance | Speed, ramp, keyframe, effect, mask, blend, transition tools | 7 | R-14.1, R-13.1 | — | MCP/REST | — | partial | Every registered op is an MCP tool: keyframes, constant speed, effects and effect keyframes, mask, blend, transitions (`phase7-proof.json`, `speed-proof.json`). No ramps; mask/blend/transition are exercised through REST in the proofs, speed through REST and the editor |
| R-30.4 | 30 text, audio, analysis, elements, senses, jobs, permissions | Text/caption, audio, AI, recipe, sense, job and permission tool groups | 5 | R-22.3 | — | MCP/REST | — | partial | add_text, update_text, set_clip_gain, get_summary, get_timeline, render_frame, export_project, get_job; rest missing |

## Appendix A: Production catalog targets

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-A.1 | A catalog | At least 30 distinct effect primitives | 7 | R-08.6 | Effects drawer | effect ops | Compositor | partial 31 primitives registered (12 Canvas2D, 19 WebGPU), each with a proof check (`phase7-proof.json`, `gpu-proof.json`); the GPU ones verified on a software adapter, a few seen by the owner on hardware |
| R-A.2 | A catalog | At least 80 effect entries and curated presets | 7 | R-A.1 | Effects drawer | effect ops | Compositor | not started | |
| R-A.3 | A catalog | At least 45 transitions on at least 12 core kernels | 7 | R-13.4 | Transitions drawer | transition ops | Compositor | partial 45 transitions on 21 kernels (12 Canvas2D, 33 WebGPU), each rendered and checked (`phase7-proof.json`, `gpu-proof.json`); the GPU ones only on a software adapter so far |
| R-A.4 | A catalog | 40 text presets | 6 | R-15.3 | Text drawer | text ops | Compositor | partial 40 text styles as data on the five bundled fonts (`textPresets.ts`, `apply_text_preset`, `presets.test.ts`); not judged on video |
| R-A.5 | A catalog | 30 text animations | 6 | R-15.3 | Text drawer | animation ops | Compositor | not started | |
| R-A.6 | A catalog | 20 caption styles | 6 | R-16.4 | Captions drawer | caption style ops | Compositor | partial | 4 of 20 caption styles |
| R-A.7 | A catalog | 8 velocity presets (Montage, Hero, Bullet, Flash In, Flash Out, Jump Cut, Smooth Ramp, Stutter) | 7 | R-14.2 | Inspector | time ops | Compositor, audio | not started | |
| R-A.8 | A catalog | 40 color looks | 7 | R-13.1 | Effects drawer | grade ops | Compositor | partial 40 looks as settings of `color.grade` (`looks.ts`, `apply_look`); arithmetic of the grade is proven, the looks themselves were not judged on footage |
| R-A.9 | A catalog | 80 SFX assets, original or licensed | 8 | R-10.5 | Sound drawer | add_clip | Mix | not started | |
| R-A.10 | A catalog | 60 font families, 20 with verified Hebrew coverage | 6 | R-15.4 | Fonts drawer | font ops | Font manifest | partial | 5 of 60 families, 5 of 20 with Hebrew (declared subset + load check); `pnpm check:notices` |
| R-A.11 | A catalog | 120 original graphic elements | 7 | R-15.5 | Elements drawer | add_clip | Compositor | not started | |
| R-A.12 | A catalog | 12 layout recipes | 7 | R-14.5 | Layouts drawer | layout ops | Compositor | not started | |
| R-A.13 | A catalog | At least 24 named creative templates, each with slots and export test | 11 | R-24.1 | Templates drawer | run_recipe | Compositor | not started | |
| R-A.14 | A catalog | 8 platform output profiles | 12 | R-25.1 | Deliver workspace | profile ops | Profile preset | not started | |

## Appendix C: Validation and performance

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| R-C.1 | C1 | Benchmark contract: exact machine, versions, fixtures, median/p95, no silent target lowering | 13 | — | — | bench scripts | — | not started | `capability-probe.json` records the environment only |
| R-C.2 | C2 | Reference workload targets (preview, seek, large timeline, agent latency, startup, export, soak) | 13 | R-C.1 | — | bench scripts | — | not started | |
| R-C.3 | C3 operations | Unit and property tests; 10,000 nightly sequences; undo-all/redo-all projection compare | 1 | R-06.5 | — | test suites | — | partial | Time property tests, op unit tests, and undo-all/redo-all projection property test, 60 runs per test run (`undo.test.ts`; `PF_PROPERTY_RUNS` raises it). The 10,000-sequence nightly run is not set up |
| R-C.4 | C3 concurrency | Three-client random interleavings, 1,000 seeded schedules, offline conflicts | 3 | R-07.1 | — | test suites | — | partial | Three clients (2 REST+SSE, 1 MCP), 15 seeds x 40 steps per run (`packages/evals/src/convergence.test.ts`). The 1,000-seed nightly run is not set up; offline drafts and revoked access not covered |
| R-C.5 | C3 media | Barcode fixtures, 1,000 random seeks per fixture, codec/GOP/VFR/rotation matrix | 2 | R-08.2 | — | fixtures | — | partial | `packages/fixtures` barcode generator; `seek-conformance.ts` runs 7 fixtures (H.264 gop30/bf2, gop250/bf3, 29.97 fps, 60-in-30, VP9/WebM, AV1/MP4, 25 fps) x 1,000 seeded random seeks plus sequential control, 0 mismatches, all pass (`docs/evidence/seek-conformance.json`, seed 1, one run). HEVC conformed rather than decoded, VFR/rotation only via `conform.test.ts`; nightly/repeat runs not set up |
| R-C.6 | C3 sync | Ten-minute flash/beep A/V offset, no cumulative drift | 4 | R-10.1 | — | proof | — | partial | P0: beeps within one frame on a short fixture; `docs/evidence/av-sync-long.json`: one 10-minute 640x360 run with an edit, 563 flash/beep pairs, max offset 0.063 ms, drift 0 ms, pass. Single run on the CPU profile; no nightly or repeat runs |
| R-C.7 | C3 render parity | Raw preview vs headless (2/255) and decoded export (SSIM, PSNR) plus text/mask/temporal checks | 4 | R-09.1 | — | proof | — | partial | P0: lossy parity PSNR>=36, SSIM>=0.985; `docs/evidence/parity-suite.json`: preview vs headless byte-identical (within-2 fraction 1, no-video variant 30/30 exact), compositor vs decoded export min PSNR 36.78 / SSIM 0.997 over 47 frames. 14 px small text drops to ~29 dB in 4:2:0, recorded as a warning; text-size envelope is a characterisation. No mask/effect edge checks |
| R-C.8 | C3 temporal | Random-seek equals sequential for seeded temporal effects | 7 | R-08.5 | — | tests | — | not started | |
| R-C.9 | C3 audio DSP | Null tests, latency compensation, loudness within 0.5 LU | 8 | R-10.2 | — | tests | — | not started | |
| R-C.10 | C3 captions, beats | Word-boundary error (median 80 ms, p95 200 ms) and beat F1 corpora | 9 | R-16.2, R-10.4 | — | corpora | — | not started | |
| R-C.11 | C3 durability, money | Crash between commit, outbox, queue, event; provider timeout; budget races | 10 | R-20.2 | — | tests | — | partial | `store.test.ts` outbox and job restart recovery; no provider or budget cases |
| R-C.12 | C3 security | SSRF, archive traversal, webhook auth, secret redaction, origin checks | 13 | R-26.3 | — | tests | — | partial | Origin, Host and scope checks; archive import path checks (`archive.test.ts`); stored-markup and script-injection checks in the live page (`phase5-proof.json`). No URL import (so no SSRF surface yet), no webhooks, no secret store |
| R-C.13 | C3 accessibility | Automated and manual keyboard, screen-reader, RTL/LTR, niqqud, reduced-motion checks | 13 | R-03.3 | — | Playwright | — | partial | P0: RTL boot, LTR timeline, Hebrew+niqqud text; phase3 proof: keyboard-only import/arrange/trim/split/keyframe workflow, palette focus. No axe run, no screen-reader walkthrough, no automated a11y suite |
| R-C.14 | C4 | Ten repeatable acceptance demonstrations with script, fixtures, assertions, outcome | 13 | R-00.2 | — | demo scripts | — | not started | Phase 0 proof is not one of the ten |

## Addendum A1: Freefield / ComfyUI requirements

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| FF-01 | Addendum 4, FF-01 | ComfyUI as optional provider behind provider/job/op layers; no raw graph from untrusted agents | G0 (2, 10) | R-18.1, R-20.1 | Capabilities panel | provider job | — | partial | Smoke and media-input capabilities run as durable Studio jobs via UI, REST and MCP; no raw-graph route; media parameters accept only project asset ids (`docs/evidence/g0-smoke-proof.json` "media parameters accept only…"). Missing: video/audio range inputs, budget checks |
| FF-02 | FF-02 | Adapter contract: discover, probe, estimate, submit, status, cancel, collect; progress labelled; brief and prompt kept | G0 (10) | FF-01 | Jobs tray | adapter | — | partial | Contract + ComfyUI HTTP adapter: probe, submit, status, cancel, collect, reconcile by request id (`docs/evidence/g0-smoke-proof.json`). Missing: estimates from measurements, prompt/brief retention, remote workers. |
| FF-03 | FF-03 | Reviewed workflow import: draft only, review checklist, no install or execution | G0 (10) | FF-04 | Import review | import_workflow | — | partial | Parse-only API-format importer and `POST /capabilities/import` return drafts with blockers (`providers.test.ts`, `docs/evidence/g0-smoke-proof.json`). Missing: UI-format, persisted drafts, review UI, publication flow. |
| FF-04 | FF-04 | Descriptor with seven separate qualification statuses and publication blockers | G0 (10) | R-18.1 | Capabilities panel | descriptor | — | partial | Seven dimensions and computed blockers (`providers.test.ts`); open quality/Hebrew reviews do not block a run but label capability and results experimental (`apps/server/src/capabilities.ts`; `g1-birefnet-cpu-trial.json` "capability is listed as experimental…"). No persistence, no UI |
| FF-05 | FF-05 | Capability packs with shared dependencies, missing bytes, resumable digest-verified download | G1 (9) | FF-04, R-18.3 | Model manager | pack job | — | partial | Ready only with exact size + SHA-256; resumable, host-restricted verified downloads (`apps/server/src/models.test.ts`; `docs/evidence/g1-birefnet-cpu-trial.json`). Missing: shared-dependency accounting, uninstall, readiness report for disk/RAM/GPU |
| FF-06 | FF-06 | Resource metadata separating download, residency, host RAM, measured VRAM, stage time, cost | G1 (9) | FF-04 | Capability card | — | — | partial | Separate fields exposed by the API; one measured CPU stage-time profile (`docs/evidence/g0-smoke-proof.json`). No device-memory measurement (no GPU). |
| FF-07 | FF-07 | Worker admission: no billable wake from browsing, prewarm rules, lease, affinity | G0 (10) | R-20.3 | Jobs tray | worker lease | — | partial | Listing/polling submits nothing; queued cancel leaves the running job untouched (`docs/evidence/g0-smoke-proof.json`). Missing: worker lease, prewarm, affinity, multi-user ownership. |
| FF-08 | FF-08 | Durable job and media contract: bounded range transfer, probed outputs, canonical attachment | G0 (10) | R-20.1, R-20.4 | Jobs tray | provider job | Attached asset | partial | Durable intent before dispatch, idempotency key, restart resume, submission-unknown, outputs digested and probed before success (`docs/evidence/g0-smoke-proof.json`). Outputs become derived assets with lineage and attach through `add_clip` in their own revision; undo removes the clip and keeps the asset; stale-result check. Image inputs staged from project asset ids only, streamed under content-addressed names, declared output-size contracts ("media workflow ran…", "lineage:"). Missing: video/audio source-range staging, cost reservation |
| FF-09 | FF-09 | Lab examples from recorded runs: load, restore settings, compare, flag weak, replace | G2 (7) | R-12.2, FF-08 | /lab | example replay | — | not started | |
| FF-10 | FF-10 | Typed "Use in..." chaining and recipe chains with lineage and cached partial reuse | G2 (11) | FF-08, R-24.1 | Use in... menu | chain plan | — | not started | |
| FF-11 | FF-11 | Reference Board with role-typed sets and versions in history; LoRA training deferred | G2 (11) | FF-10 | Reference Board | reference ops | — | not started | |
| FF-12 | FF-12 | Generative Reframe as explicit mode beside Crop/Fit/Blur-fill; protected region; timing preserved | G2 (12) | FF-08, R-19.6 | Reframe mode | reframe job | Attached asset | not started | |
| FF-13 | FF-13 | Relight (image first), Mixed Media, Cinema controls as creative guidance | G2 (10) | FF-08 | Effects drawer | provider job | Attached asset | not started | |
| FF-14 | FF-14 | Motion Transfer and Recast with enforced segment limits; reject, never truncate | G3 (10) | FF-08 | Recast panel | provider job | Attached asset | not started | |
| FF-15 | FF-15 | Typed auxiliary outputs (matte, depth, normals, guide, audio, preview) with labelled visualisations | G1 (9) | FF-08 | Asset inspector | provider job | Aux assets | partial | Typed output bundle with RGBA cutout and matte role for `comfy.image.remove-background` (`docs/evidence/g1-birefnet-cpu-trial.json` "typed output bundle…"). No depth or normals, no numeric-encoding contract beyond the label |
| FF-X1 | Addendum 7 | Camera Copy, with Cameraman v2 excluded from commercial profile | G3 | FF-14, FFG-12 | — | — | — | conditional | Needs licensed implementation |
| FF-X2 | Addendum 7 | Novel-view Reshoot with warp guide and synthesized-hole display | G3 | FF-14 | — | — | — | conditional | Model terms unresolved |
| FF-X3 | Addendum 7 | Learned SDR-to-HDR with real high-bit-depth pipeline | G3 | R-08.4 | — | — | — | conditional | Needs HDR export path |
| FF-X4 | Addendum 7 | Character LoRA training (deferred research) | G3 | FF-11 | — | — | — | conditional | Unverified training workflow |
| FF-X5 | Addendum 7 | Sound Repair and Extend (inpainting, continuation) | G3 | FF-08, R-10.2 | — | — | — | conditional | Needs evaluation |
| FF-X6 | Addendum 7 | Generative Hebrew dubbing qualified independently | G3 | R-17.3 | — | — | — | conditional | "Any language" is not Hebrew qualification |

## Addendum A1: Acceptance gates (section 9, in table order)

| ID | Spec ref | Requirement | Phase | Depends on | UI | Op / job / tool | Export path | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| FFG-01 | Addendum 9 | Provider boundary: UI, REST and MCP create the same authoritative job shape | G0 (10) | FF-01 | Jobs tray | provider job | — | done | `docs/evidence/g0-smoke-proof.json`: MCP and UI job shapes equal the REST job shape |
| FFG-02 | Addendum 9 | Structural import: unbound controls and unknown models block publication | G0 (10) | FF-03 | Import review | import_workflow | — | done | `providers.test.ts` structural blockers |
| FFG-03 | Addendum 9 | No implicit execution: import performs no install, node execution or GPU wake | G0 (10) | FF-03 | — | import_workflow | — | done | `providers.test.ts` (no network on import); `docs/evidence/g0-smoke-proof.json`: check "import executed nothing on the provider" |
| FFG-04 | Addendum 9 | Model integrity: partial or corrupt file fails digest and is never ready | G1 (9) | FF-05 | Model manager | pack job | — | done | `apps/server/src/models.test.ts`: partial download resumed, digest mismatch refused, never ready until size + SHA-256 verified; `g1-birefnet-cpu-trial.json` "model downloaded by an explicit owner action and verified…" |
| FFG-05 | Addendum 9 | Resource qualification: download, residency and measured VRAM shown separately | G1 (9) | FF-06 | Capability card | — | — | partial | `docs/evidence/g0-smoke-proof.json`: fields are separate in the API; no measured device memory exists yet (CPU only) |
| FFG-06 | Addendum 9 | Worker isolation: concurrent jobs cannot unload or interrupt another's worker | G0 (10) | FF-07 | — | worker lease | — | partial | `docs/evidence/g0-smoke-proof.json`: cancelling a queued job does not interrupt the job owning the worker. No lease; ComfyUI interrupt is global |
| FFG-07 | Addendum 9 | Recovery: restart preserves known jobs; ambiguous submissions reconciled without blind retry | G0 (10) | R-20.2 | Jobs tray | reconcile_job | — | partial | `docs/evidence/g0-smoke-proof.json`: restart resumes a known job without resubmission; lost-response and never-received cases via injected faults. Not tested: real crash inside the submit call; paid providers |
| FFG-08 | Addendum 9 | Output integrity: missing or malformed outputs cannot attach as success | G0 (10) | FF-08 | — | provider job | — | done | `docs/evidence/g0-smoke-proof.json`: truncated and missing outputs fail the job (injected faults); successful outputs are probed before import and attachment. Model-free path only |
| FFG-09 | Addendum 9 | Stale result: finished job never overwrites a newer clip edit | G0 (10) | R-20.4 | Proposal review | attach op | — | done | `docs/evidence/g0-smoke-proof.json`: "stale result: … nothing placed, newer edit intact" and "…output is kept as a derived asset". Model-free path only; no proposal review UI |
| FFG-10 | Addendum 9 | Temporal correctness: reframe, slow-motion, recast preserve duration and audio/caption timing | G2 (12) | FF-12, FF-14 | — | provider job | — | not started | |
| FFG-11 | Addendum 9 | Visual quality: reviewed fixtures for hair, dance motion, cuts, text, occlusion, style drift | G2 (12) | FF-09 | /lab | — | — | not started | |
| FFG-12 | Addendum 9 | Licensing: Cameraman-dependent workflow unavailable in default commercial profile | G0 (10) | FF-04 | Capabilities panel | descriptor | — | done | `providers.test.ts` commercial-profile exclusion (descriptor level) |
| FFG-13 | Addendum 9 | Example replay: restored inputs match saved recipe; changed versions disclosed | G2 (7) | FF-09 | /lab | example replay | — | not started | |
| FFG-14 | Addendum 9 | Privacy: local-only blocks cloud routing; history and assets scoped to user/project | G0 (10) | R-18.2, R-26.1 | Settings | routing | — | partial | `providers.test.ts`: non-loopback provider refused unless explicitly enabled. No per-user/project scoping of history and assets |

## Coverage notes

- Rows are section-granular. Each row bundles several spec sentences; they will be split into finer IDs (for example R-06.5 into undo, redo and compensation conflicts) as the owning phase begins, and existing IDs will keep their meaning.
- Every spec section 2-27 has at least one row; sections 28-30 and Appendices A, C and D are covered by R-28.1, R-29.1, R-30.x, R-A.x, R-C.x and the Phase column. Section 19 sub-workflows are paired (19.4 with 19.5, and so on) until each starts.
- Appendix B (source coverage) and Appendix E (references) are informational and carry no requirement rows.
- Status never exceeds the evidence named in the row. A `done` row names a test or proof check; anything verified only by inspection is `partial`.
- The six `FF-X` rows track the conditional directions in addendum section 7; they are not part of the FF-01..FF-15 set.
