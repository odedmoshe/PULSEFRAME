# Capabilities by execution profile

Status words (SPEC §27): **tested** = implemented and exercised by a named check here · **setup-required** = implemented, needs something the operator provides ·
**experimental** · **unavailable** = not available in this profile · **not built** = no implementation yet.
Only one profile has been run: the development container. Nothing below is a claim about other machines.

## Four evidence levels
1. **Blocked implementation**: the code cannot be written or run to completion because something outside the code is missing (hardware, network access, licence).
2. **Implemented, not runtime-qualified**: code exists but has not been run on a runtime that exercises it.
3. **Verified on the current profile**: a named test or proof check passed on the profile below (CPU, no GPU).
4. **Verified on the required target profile**: passed on the GPU reference machine.

Nothing is at level 4 yet. Rows below marked "tested" are level 3.

## Profile measured: `dev-container-software` (2026-11-14)
This machine is the owner-designated *provisional CPU functional-validation profile*. It is not the GPU performance reference; GPU qualification is pending.

Linux x64, 4 vCPU Intel Xeon @ 2.10 GHz, 15.7 GiB RAM, **no GPU**; Node 22.23.4; Chromium 153.0.8010.12 (Playwright 1.63.0, headless);
FFmpeg 6.1.1-3ubuntu5 (GPL build, libx264). Raw probe: `docs/evidence/capability-probe.json` (`pnpm probe`).

| Probe result | Value |
|---|---|
| WebGPU adapter (default headless launch) | **none** |
| WebGPU adapter with SwiftShader flags (`--enable-unsafe-webgpu` …) | present, software; not adopted |
| WebGL2 | present (ANGLE on SwiftShader, software) |
| WebCodecs decode 1080p | H.264, VP8, VP9, AV1: yes · HEVC: no |
| WebCodecs encode 1080p30 | H.264 High, VP8, VP9, AV1: yes · HEVC: no |
| WebCodecs audio encode | Opus: yes · **AAC: no** · MP3: no |
| Canvas2D known-pattern readback self-test | exact |
| OPFS, OffscreenCanvas, AudioWorklet, Intl.Segmenter | present (not used yet) |
| FFmpeg encoders | libx264, aac, libopus, libvpx-vp9, libsvtav1, libx265 |

## Editor core (no AI provider needed)

| Capability | Status | Evidence / limits |
|---|---|---|
| Import MP4/WebM video and common audio (upload, hash, ffprobe) | tested | Phase 0 proof. Rotation, variable frame rate and non-decodable codecs (HEVC) are conformed to a constant-rate H.264 copy, original bytes kept, mapping recorded (`apps/server/src/conform.test.ts`). No HDR, resumable upload, URL import, Phone Drop, recorder, bins/tags, OPFS/offline drafts |
| Timeline edits: add clip (linked audio), add/update text, move, trim, split, delete, transform, gain | tested | `core.test.ts`, proof. No ripple, roll, slip, slide, cross-track drag or groups (multi-select, copy/paste and markers were added later; see their own rows) |
| Keyframes on x, y, scale, rotation, opacity (linear/hold/ease); `set_keyframe`, `delete_keyframe`, `clear_keyframes` | tested | `packages/core/src/animation.test.ts`, `packages/engine/src/evaluate.test.ts` (exact preservation across trim and split; random seek equals sequential), `docs/evidence/phase3-proof.json`. No graph editor, Bezier/spring, motion paths, keyframes on crop/mask/effects/audio |
| Keyboard-only import/arrange/trim/split/keyframe workflow | tested | `phase3-proof.json` (27 checks). No axe run, no screen-reader walkthrough |
| Command registry, bilingual command palette, per-user remappable shortcuts | tested | `apps/web/src/editor/commands.test.ts`, `palette.search.test.ts`, phase3 proof. No J/K/L shuttle, I/O marks, saved layouts, density, tooltips system, workspaces |
| Timeline drag move/trim with snapping; canvas move/scale/rotate handles (one transaction each) | tested | `apps/web/src/editor/interactions.math.test.ts`, phase3 proof. No cross-track drag, no marquee; text handle bounds approximate |
| Presence: agent/human ghost playhead and selection (REST and MCP `set_view`), opt-in Follow Agent ended by a manual seek | tested | `apps/server/src/presence.ts`, phase3 proof |
| Activity feed localised from operation names; three committed screenshot baselines compared by SSIM | tested | phase3 proof; `docs/evidence/baselines/` |
| Filmstrip thumbnails and waveforms on timeline clips | tested (partial) | Index math in `apps/web/src/clipVisuals.math.test.ts`; the drawing itself has no automated test. No minimap, keyframe lanes |
| Still images (PNG/JPEG/WebP) at ingest, rendered as image layers | tested | `docs/evidence/g0-smoke-proof.json` checks "still image upload…" (exact dimensions) and "the attached provider image renders through the shared compositor…" |
| Ingest derivatives: frame-indexed thumbnail sprite, 3-level waveform peaks, frame-identical H.264 proxy, restart recovery | tested | `apps/server/src/derive.test.ts`; `phase0-proof.json` "ingest derivatives…" |
| Range-read media access, bounded decoder/still caches; preview decodes the proxy, export the original | tested | `phase0-proof.json` "preview after reload decodes the proxy…", "decoder count stays within its budget" |
| Seek conformance: 7 fixtures (H.264 gop30/bf2, gop250/bf3, 29.97 fps, 60-in-30, VP9/WebM, AV1/MP4, 25 fps) x 1,000 seeded random seeks + sequential control | tested | `packages/evals/src/seek-conformance.ts`; `docs/evidence/seek-conformance.json`: 0 mismatches, all 7 fixtures pass (seed 1, one run on this profile; no nightly runs). HEVC is not directly decodable here (conformed instead); VFR handled only via conform |
| Ten-minute A/V sync export test | tested | `docs/evidence/av-sync-long.json`: one 640x360 run with an edit, 16,879 frames, 563 flash/beep pairs, max offset 0.063 ms, drift 0 ms, export 3.45x real time on this CPU. Single run; no repeat or nightly runs |
| Undo/redo as compensating transactions, per actor | tested | `undo.test.ts`; proof checks \"agent undo:\", \"human undo (Ctrl+Z)…\", \"redo then undo…\". Refused with a conflict list when items changed later; other actors' edits survive. Buttons and Ctrl/Cmd+Z, Shift+Z, Y. No restore-as-branch, no drag coalescing. Undo-all/redo-all property test runs 60 times per test run; the 10,000-sequence nightly run is not set up |
| Rebase of stale edits via `baseRevision`; typed `conflict` | tested | `undo.test.ts`; proof checks beginning \"rebase:\" and \"conflict:\". Strict `expectedRevision` kept. Conflicts are per entity, not per property |
| Three-client convergence (2 REST+SSE, 1 MCP) | tested | `packages/evals/src/convergence.test.ts`, 15 seeds x 40 steps per run; the 1,000-seed nightly run is not set up. Offline drafts and revoked access not covered |
| Licence notices in the build | tested (partial) | Built web app ships `THIRD_PARTY_NOTICES.txt` with full licence texts for bundled third-party packages; `pnpm check:notices` is part of `pnpm check`. The build-fails-on-missing-licence path is untested |
| Storage migration v1 (`PRAGMA user_version`) | implemented, not runtime-qualified | Code only, no dedicated test |
| Exact rational time | tested | `time.test.ts` |
| Preview (shared evaluator + Canvas2D, WebCodecs decode) | tested | Proof reads the frame-index barcode from preview pixels. No effects, no HDR tone-mapping, no WebGPU compositor |
| Preview audio streamed with bounded lookahead on the audio clock | tested | `phase0-proof.json` "preview audio (streamed…" and "preview playback ran to the end…": in one headless 3.5 s run on this CPU profile, beep onsets within 0.06 ms of timeline positions; video paint lateness median ~15 ms, p95 ~21 ms. Single run, not a general latency claim. No AudioWorklet DSP graph |
| Hebrew/Latin bidi text with niqqud, word wrap, stroke, background | tested (visual) | Screenshots in `docs/evidence/`; no automated golden-image test yet |
| Hebrew default UI with EN toggle; RTL chrome, LTR timeline | tested | Proof. Activity feed is localised from operation names (phase3 proof) |
| Keyboard editing by physical key codes | tested (subset) | Space, arrows, Shift+arrows, Home/End, S, Delete, `[` `]`, K keyframe, undo/redo; remappable per user (see above). Not covered: J/K/L, I/O, copy/paste |
| Save/reload, op-log replay, restart recovery | tested | `store.test.ts`, proof |
| Server export MP4 H.264 High + AAC, BT.709 tagged | tested | Proof: 105/105 frames source-exact, A/V onset error 0.06 ms, PSNR 46.7 dB / SSIM 0.998 on one frame |
| Server export planning: immutable manifest, preflight blockers, MP4 H.264+AAC, WebM VP9+Opus, WAV, PNG still, frame range, scale, quality | tested | `docs/evidence/phase4-proof.json` (19 checks): typed refusals (missing media, non-bundled font), range audio cut by absolute samples, PNG identical to `render_frame`. Size estimate is labelled an estimate |
| Export cancel and retry (REST, MCP, editor) | tested | `phase4-proof.json`: queued removed, running stopped with nothing published, retry renders the original immutable snapshot. No checkpoint/resume |
| Browser-side export (WebCodecs + Mediabunny, tab lease with heartbeats) | tested (limited) | `docs/evidence/browser-export-proof.json` (23 checks), `apps/server/src/browser-export.test.ts`. On this Chromium it writes H.264 + **Opus** in MP4 because AAC encode is unavailable (declared substitution, not MP4+AAC). Output buffered in memory; lease state in memory only; no automatic routing; Chromium only |
| Preview/export parity | tested | `docs/evidence/parity-suite.json`: paused preview vs headless still byte-identical on 30/30 frames with and without video; compositor vs decoded H.264 export min PSNR 36.8 dB / SSIM 0.997 on this synthetic scene. 14 px text over saturated edges ~29 dB (warning); the text-size envelope is a characterisation, not a guarantee |
| Animated GIF export; subtitle sidecars with a clean picture (`captions` option) | tested | `docs/evidence/phase6-proof.json` |
| Clip duplicate / copy / paste with everything on the clip | tested | `variants.test.ts`, `editor-interactions-proof.json` |
| Streaming output, animated WebP, hardware encoder profile, export checkpoint/resume | not built | |
| Captions: manual cues and transcript-linked tracks, 4 presets (classic, karaoke, word-pop, box-highlight), Hebrew/mixed-direction word layout, SRT/VTT import, SRT/VTT/ASS export | tested | `docs/evidence/phase6-proof.json` (26 checks), `packages/*/src/captions.test.ts`, `subtitles.test.ts`. Six golden renders; one bundled font |
| Transcript editing: typed/imported transcripts in source time, corrections that keep the original, delete words → ripple cut of picture, sound and captions, `cut_range` | tested (synthetic transcript) | `phase6-proof.json`: frame-exact cut, audio onset error 0.042 ms on one fixture. Real speech not exercised |
| Silence candidates (ffmpeg measurement → reviewable timeline cuts), REST + MCP + editor | tested (synthetic) | `phase6-proof.json`; `cleanup.test.ts`. Real recordings not exercised |
| Entrance/exit animation presets as editable keyframes (`animate_clip`) | tested | `cleanup.test.ts`, `phase6-proof.json` |
| Font catalog: 5 OFL Hebrew-capable families, pinned, licence-checked at build, load-verified | tested | `pnpm check:notices`, `phase6-proof.json` |
| Speech recognition, forced alignment, filler detection, translation | not built | Blocked on B-7 |
| Look system: 12 effects, 17 blend modes, rect/ellipse masks (feather, invert), 12 transitions, one Canvas2D implementation for preview and export | tested | `docs/evidence/phase7-proof.json` (30 checks, pixel arithmetic), `effects.test.ts`, `look.test.ts`; `/lab.html`. One synthetic fixture; 1080p+ cost unmeasured |
| Catalog discovery (`GET /api/v1/catalog`, MCP `list_catalog`) and generated effect inspectors | tested | `phase7-proof.json` |
| Sound: track gain/pan/mute, clip fades, speech ducking, one audio plan shared by server export, preview and browser export | tested (synthetic signals) | `docs/evidence/phase8-proof.json` (17 checks), `audio.test.ts`, `/selftest.html`; live playback level measured at six points in headless Chromium. No real audio device |
| Loudness: EBU R128 measurement and static-gain normalisation with true-peak ceiling (server export only) | tested (synthetic) | `phase8-proof.json`: −16.0 LUFS for a −16 target; ceiling respected. No compressor/limiter |
| Built-in synthesised sound effects (7) as real assets | tested | `phase8-proof.json` |
| Narration, TTS, voice cloning, EQ/dynamics, noise reduction, recording | not built | Voice blocked on B-8 |
| Scene-cut detection (hard cuts) and beat tracking, model-free, stored as editable source-linked data; split into shots; timeline markers; cut on the beat | tested (synthetic corpora) | `docs/evidence/phase9-proof.json` (12 checks): 5/5 cuts exact; beat F1 0.97–1.00 on six synthetic loops. Dissolves not detected; real footage/music untested |
| Reframe, subject tracking, segmentation, pose, depth, semantic search, assisted colour | not built | Need models (B-4) |
| Linked output formats (variants) with per-clip overrides that survive master edits; contain/cover; generic safe-area guides; variant stills, export and batch export | tested | `docs/evidence/phase12-proof.json` (13 checks), `variants.test.ts`. Safe-area numbers are generic guides |
| Creative preflight with object links and mechanical fixes (REST, MCP, editor) | tested | `phase12-proof.json`. Eight checks listed in its `scope`; text extents estimated |
| Publishing connectors, thumbnails/metadata, provenance manifests | not built | |
| Rule-based recipes (beat montage, social pack, tidy speech): plan, apply as one undo, regenerate keeping hand edits | tested | `docs/evidence/phase11-proof.json` (11 checks). No language model involved |
| Natural-language Director, Prompt-to-Draft, Long-to-Shorts, brand kits | not built | Blocked on B-9 |
| Project manager (list, create, delete with typed confirmation, storage clean-up) and agent access panel (create/revoke grants, token shown once) in the editor | tested | `docs/evidence/owner-ui-proof.json`, `storage.test.ts`, `phase5-proof.json`. Approval requests (model downloads) are listed in the review panel with size and Reject verified; Approve in the editor is not exercised |
| Optional storage ceiling (`PF_MAX_STORAGE_BYTES`): uploads, imports and exports refused with a typed 507 at the ceiling; total and ceiling shown in the project manager | tested | `quota.test.ts`. Off by default; exports are checked only when they start; no per-project quota |
| Backup of the whole data directory while the server runs (`pnpm backup`), restore by starting a server on the copy | tested | `apps/server/src/backup.test.ts` (state at the backup moment, media bytes, credentials, edit after restore, incremental repeat). Manual only: no schedule, retention or encryption |
| Source viewer: preview a library file, mark in and out on whole frames, add that range to the end of the timeline | tested | `pnpm proof:phase3` (barcode frames in the viewer and on the timeline), accessibility audit. Video file only; no insert/overwrite at the playhead |
| Marquee selection: drag a box on empty timeline space; Shift adds; Escape restores; click clears | tested | `pnpm proof:editor-interactions`. Locked-track exclusion, touch and scrolling during the drag are not checked; pointer-only |
| A project change during playback (own edit, agent edit, undo) does not stop playback | tested | `pnpm proof:editor-interactions` (normal speed and 2× shuttle). Sound gap at the change not measured |
| Shuttle with J / L: backwards and forwards at 1, 2, 4, 8 times real time, silent except normal forward playback | tested | `pnpm proof:editor-interactions` (2× forwards and 1× backwards measured on one 12 s timeline; 4× and 8× only by indicator and by reaching the start). No sound while shuttling; K is not stop |
| Request budget per agent grant (`requestsPerMinute` on the grant; replaces the server-wide setting for that credential) | tested | `apps/server/src/ratelimit.test.ts`, `pnpm proof:owner-ui` (field in the editor's grant form) |
| `Secure` attribute on the owner session cookie (`PF_SECURE_COOKIE=1`) for use behind a TLS proxy | tested (attribute and origin rule only) | `apps/server/src/session.test.ts`. No proxy deployment was run |
| Automatic backups on an interval with retention of dated database snapshots (`PF_BACKUP_DIR`, off by default); status and "Back up now" in the editor and over REST (owner only) | tested | `apps/server/src/backup.test.ts` (retention, an older snapshot restores, failure recorded without stopping the server, restart waits for the interval), `pnpm proof:owner-ui`. The interval itself was exercised only for the immediate first run, not over real hours. The database copy is integrity-checked after writing; media is compared by size only |
| Portable project archive (export, verified import as a new project) | tested | `archive.test.ts`, `docs/evidence/soak.json` (restore on a second server, frame byte-identical), `editor-interactions-proof.json`. History not included; no GC or quota |
| Accessibility (automated heuristic audit, he + en): names, contrast, focus visibility, tab semantics on the resting editor and four transient states; focus containment, Escape and focus return for the two modal dialogs | tested (heuristic) | `docs/evidence/a11y-audit.json`; self-checks with planted defects for names, contrast and focus rings. Not a WCAG conformance claim; no screen-reader testing; confirmation forms, error and busy states not covered |
| Long-session stability: 3,000 transactions, replay, restart | tested (one run) | `docs/evidence/soak.json`. Commit time grows with project size: ≈20 ms median at ~700 clips on this machine |
| Owner session bound to a launch secret; restricted grants refused for non-clip side doors; own-transaction undo and own-job cancel for agents; concurrency limit on heavy read-only work; container allowlist | tested | `docs/evidence/phase5-proof.json` (six review checks), `phase0-proof.json`, `analysis.test.ts`; ADR-0002 amendment. One code review, not a penetration test; browser-side security not reviewed |
| MCP resources (guide, operation schemas, catalog, per-project summary and timeline) and four versioned playbook prompts, grant-scoped like the tools | tested | `packages/evals/src/mcp-resources.test.ts` (real MCP client). Playbooks not evaluated with a model (B-9); no subscriptions, Tasks extension or MCP App |
| Browser hardening: strict content security policy on pages (same-origin code only, no inline/eval/blob scripts), sandboxed policy on API and stored files, nosniff / no-referrer / frame ban on every response | tested | `docs/evidence/phase5-proof.json` (headers on page, JSON and media; stored markup inert; five injection attempts blocked in the live page). Built server only (not the Vite dev server); cookie not `Secure` on loopback HTTP; one review, not a penetration test |
| Keyframed effect parameters; audio crossfade; cut/copy/paste/duplicate | tested | `phase7-proof.json`, `phase8-proof.json`, `editor-interactions-proof.json`, `effects.test.ts`, `audio.test.ts` |
| Multi-select in the timeline: Shift/Ctrl-click, select all, drag / nudge / delete several clips as one transaction (`move_clips`) | tested | `moveclips.test.ts`, `docs/evidence/editor-interactions-proof.json`. No marquee selection or cross-track group drag; Inspector shows the first selected clip |
| User timeline markers (name, five colours, one per frame): add with M, jump with Shift+M / Alt+M, edit and remove from the marker bar; ordinary ops for agents; undoable; included in the timeline query and the project archive | tested | `markers.test.ts`, `docs/evidence/editor-interactions-proof.json`. Timeline markers only (no clip markers, ranges or export as chapters); markers do not move when clips are rippled |
| Volume automation on sound clips (level keys, straight lines between, 0–4), applied identically by export and the WebAudio chain | tested | `docs/evidence/phase8-proof.json` (exported levels, trim, clear), `audio.test.ts`, `/selftest.html`, `editor-interactions-proof.json`. Linear only; no drawing on the clip; no track automation |
| Clip speed 0.1–8× as an exact ratio (slow motion, speed-up), picture and linked sound together; sound is varispeed (pitch follows speed) | tested | `docs/evidence/speed-proof.json` (exported frames, pitch, captions, markers, preview seeks), `speed.test.ts`. No ramps, reverse or pitch-preserving stretch; preview playback sound at speed not measured |
| Input shapes: 30 synthetic variants (sound layouts and rates, sound longer or shorter than the picture, MOV / Matroska / MPEG-TS / AVI / WebM, non-square pixels, 10-bit, 4:4:4, 4:2:2, interlaced, odd size, BT.601 and full-range colour, seven sound-only formats) exported with the right frames, onsets, colour (≤ 7 of 255) and level (≤ 0.14 dB) against references built from each input file | tested (synthetic; server export, browser export and editor preview) | `docs/evidence/input-matrix.json`: 28 correct, 2 noted (AVI early-frame difference; untagged colour read as BT.709), the same on all three routes. Mono is at full level in both channels on every route. Not verified: preview colour and level, frames during playback, 5.1 down-mix coefficients, HDR, real camera files |
| Editing operations hold their invariants under random sequences: 45 operations at five frame rates, with validation, usability and undo checked after every step | tested | `packages/evals/src/ops-fuzz.test.ts` (60 seeds × 70 steps in `pnpm test`; a 600 × 120 run passed once) and `store-fuzz.test.ts` (through the store: undo all, redo all, replay; 25 × 40 in `pnpm test`, 200 × 80 once). Structure only — no rendering; grants, conflicts and concurrent actors not fuzzed |
| Projects produced by random editing sessions render: stills, export with the exact frame count and rate, sound-only export, preflight, linked formats | tested (shape only) | `docs/evidence/render-fuzz.json` (10 sessions × 160 steps at five frame rates, real media). Does not check that the rendered content is right; transitions and effects thinly represented |
| On those random projects the paused editor preview equals the server still and the exported frame is close to it | tested (agreement between routes, no independent reference) | `docs/evidence/render-fuzz.json`: 24 frames in 8 of 10 projects; preview 0 difference, export ≤ 1.89 of 255; 2 projects had no non-black frame sampled |
| Project frame rates 12–60 fps including 23.976 / 29.97 / 59.94, and sizes from 160×90 to 1920×1080 and 1080×1920: exact rate, frame count, frames and sound in the exported file | tested (synthetic) | `docs/evidence/project-matrix.json` (15 settings on the server export, every frame read; 7 of them — the non-integer and extreme rates, vertical, odd size — also on the browser export and the editor preview). Odd sizes are exported at the next even size. Not verified: captions/effects at non-integer rates |
| Subtitle and transcript files in UTF-8, UTF-16, Windows-1255 (Hebrew) or Windows-1252, detected at import; the editor says when it had to guess | tested | `apps/web/src/textDecode.test.ts`, `docs/evidence/editor-interactions-proof.json`. Heuristic; five encodings only; no manual override |
| Still images: PNG (incl. transparency, indexed, greyscale, 16-bit), JPEG (incl. progressive, greyscale, CMYK, orientation tags, 20 megapixels), WebP, and — converted to PNG at import — BMP, TIFF, single-frame GIF, AVIF; shown upright and unstretched | tested (synthetic) | `docs/evidence/image-matrix.json` (22 of 24 shown correctly on rendered still and preview; animated WebP and SVG refused), `conform.test.ts`. Not verified: colour profiles, HDR, HEIC, EXIF orientation outside JPEG, real photographs |
| Import notices: the library and agent summaries say when a file was converted (and why), when picture or sound is offset, and when the file does not state its colour encoding | tested | `notices.test.ts`, `conform.test.ts`, `docs/evidence/input-matrix.json` (expected notices per shape). Informational only: no colour choice; not shown for assets imported earlier |
| Files whose picture or sound does not start at time 0 (remuxes, Matroska, B-frames without an edit list): picture placed the nearest whole frame late, sound on the file's own clock, on every route | tested (synthetic remuxes) | `docs/evidence/start-offset.json` (4 checks), `startOffset.test.ts`. Before these fixes a late-starting picture failed to export and late-starting sound was exported early. Sound that starts late is heard at the same time on server export, preview playback and browser export. Not tested: picture frames during playback, negative start times, real camera files; assets imported earlier need re-import |
| Long media: one synthetic 20-minute file through ingest, background analysis, a 20-shot timeline and a seek to the last frame | tested (one run, synthetic) | `docs/evidence/long-media.json` (times measured once on the CPU profile). No long export, no real footage, nothing past 20 minutes; files with a non-zero first video timestamp are unverified |
| Scene/beat analysis as a durable background job (restart-safe, protects hand corrections, cancel) in addition to the in-request path | tested | `apps/server/src/analysisJobs.test.ts`. Mechanism tested on 12 s of audio; no long media analysed; no progress reporting |
| Caption style per format (size, position and any other style field for one format only; master untouched) | tested | `docs/evidence/phase12-proof.json` (rendered rows per format, editor), `variants.test.ts`. Editor exposes position and size only; no per-format caption text |
| Title wording and text style per format (master and other formats untouched) | tested | `variants.test.ts`, `pnpm proof:editor-interactions` (rendered frames). Editor exposes wording and size; other style fields only through the op |
| Freeze frame: hold one picture for a chosen time, inserting that time across the sequence | tested | `docs/evidence/speed-proof.json` (every exported frame, silent hold, shifted sound, undo, Inspector), `speed.test.ts`. Always inserts time; preview playback across a hold not measured |
| GPU compositor, shader effect families, keying, speed ramps, OPFS/offline drafts, tablet/mobile layouts, first-run demo/tour | not built | |

## Agent surface

| Capability | Status | Evidence / limits |
|---|---|---|
| REST `/api/v1` subset | tested | Proof |
| OpenAPI 3.1 at `GET /api/v1/openapi.json`, generated from the op registry | tested | Checked in both directions against the real route table (`apps/server/src/openapi.test.ts`); 60 operations per PROGRESS (count not asserted in the test) |
| MCP over HTTP, protocol 2026-07-28, stateless | tested | Official client pinned to 2026-07-28 |
| MCP legacy (2025-11-25) clients | tested | Served by the SDK's stateless fallback |
| Tools generated from the op registry + senses `get_summary`, `get_timeline`, `describe_ops`, `render_frame`, `describe_moment`, `render_contact_sheet`, `plan_export`, `get_controls` | tested | 35 MCP tools from one registry (`docs/evidence/phase5-proof.json`). Only the official SDK client has been tried; no third-party MCP host. No transcript, audio-analysis or preview-clip senses; no MCP Tasks extension, resources, prompts or playbooks; no OAuth |
| Agent grants: Observe / Propose / Edit / Autopilot, project/track/range limits, expiry, revocation | tested | `apps/server/src/governance.test.ts` (12 tests), phase5 proof. Limits enforced from the entity diff; range limit only unit-tested. Management is REST only (no UI) |
| Pause Agent / Take Over | tested | Owner-only, server-side `agent_paused`; reads and owner edits continue (phase5 proof) |
| Proposals with before/after stills, owner accept/reject, stale detection | tested | Accepted proposals commit under the owner and are undoable (phase5 proof, `governance.test.ts`). No proposal branches |
| Single-use approvals bound to an action hash | tested (limited) | Expiring, owner-only, single use; bound to the action hash and owner identity, not to a project revision. Used for agent-requested model downloads only |
| Budget ledger | tested (unit only) | Reservation/settle/release in `governance.test.ts`; not exercised end to end, no paid provider exists |
| Ten scripted MCP goals | tested | Deterministic script over the official MCP client, not a language model (phase5 proof). No Director (LLM) |
| Live UI update from agent edits (SSE) | tested | ~39 ms commit-to-visible on loopback, single sample (the latest proof run recorded ~43 ms) |

## Optional AI providers

| Capability | Status | Evidence / limits |
|---|---|---|
| ComfyUI provider connection | setup-required | Needs a running ComfyUI and `PF_COMFYUI_URL`. Without it the UI and API report "not configured" |
| `comfy.smoke.solid-image` (model-free diagnostic) | tested on CPU | `docs/evidence/g0-smoke-proof.json`, ComfyUI 0.45.0, CPU device. Not a creative capability |
| Workflow import (API-format JSON → draft + blockers) | tested (parse only) | Drafts are not stored and cannot be published or run yet |
| BiRefNet image matting `comfy.image.remove-background` 0.1.0 | tested on CPU (experimental) | `docs/evidence/g1-birefnet-cpu-trial.json`, 13/13 checks, bounded CPU functional trial on this profile: 444,473,596-byte model downloaded by an explicit owner action and verified by size + SHA-256; ~30 s CPU inference; matte IoU 0.9997 on ONE synthetic image; RGBA cutout attached as a derived asset with lineage and its alpha honoured by the compositor; typed output bundle with a matte role. NOT quality-reviewed, NOT GPU-qualified; one image says nothing about hair, motion or real footage |
| Other model-based workflows (MoGe-2, SeedVR2, LTX, Wan, …) | not built / unreviewed | No model downloaded, licence-reviewed or executed for these; GPU absent (`docs/BLOCKERS.md` B-4) |
| Experimental labelling | tested | Open quality/Hebrew reviews do not block a run but label the capability and its results (`apps/server/src/capabilities.ts`; trial check "capability is listed as experimental…") |
| Provider output attachment and stale-result protection | tested on CPU | `docs/evidence/g0-smoke-proof.json` (39 checks). Outputs are imported as derived assets with lineage and attached through `add_clip` in their own revision; undo removes the clip and keeps the asset. If an entity the placement depends on changed while the job ran, nothing is placed and the asset stays a proposal. No proposal review UI |
| Image media-input staging | tested on CPU | `g0-smoke-proof.json` (39 checks): image parameters are project asset ids only (paths/URLs rejected), streamed to the provider under content-addressed names, lineage on derived assets, declared output-size contracts ("media workflow ran…", "lineage:", "media parameters accept only…"). Video/audio source-range staging, cost reservation and budget checks are not built |
| Model files | tested | Ready only with exact size + SHA-256; resumable, host-restricted, verified downloads; explicit owner-only download bound to the exact byte count (`apps/server/src/models.test.ts`; trial evidence). Not built: shared-dependency accounting, uninstall, readiness report for disk/RAM/GPU |
| Worker lease/prewarm | not built | |
| Every other AI capability in SPEC §18 (ASR, TTS, generation, …) | not built | No adapters, no credentials requested |

### Qualification dimensions (Amendment A1, FF-04) — current values

| Capability | schema-valid | dependency-ready | licence-reviewed | executed | quality-reviewed | Hebrew-qualified | hardware-qualified |
|---|---|---|---|---|---|---|---|
| `comfy.smoke.solid-image` 1.0.0 | pass | pass (no models, core nodes) | pass (no weights) | pass after a recorded run; evidence cites the job | n/a | n/a | pass **only** for the profile of the recorded run (CPU here) |
| `comfy.image.remove-background` 0.1.0 (BiRefNet) | pass | pass (size + SHA-256 verified model) | pass at metadata level (weights tagged MIT by the original publisher; training-data terms not reviewed; pending owner/legal confirmation) | pass for the CPU trial run (one synthetic image) | **open** (experimental) | open | **not** GPU-qualified; CPU functional profile only |

No other Freefield workflow has any dimension assessed. Source review of that catalog was done by the addendum's author, not reproduced here.
