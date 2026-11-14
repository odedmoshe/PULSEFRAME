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
| Timeline edits: add clip (linked audio), add/update text, move, trim, split, delete, transform, gain | tested | `core.test.ts`, proof. No ripple, roll, slip, slide, cross-track drag, multi-select, copy/paste, groups, markers |
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
| Seek conformance: 7 fixtures (H.264 gop30/bf2, gop250/bf3, 29.97 fps, 60-in-30, VP9/WebM, AV1/MP4, 25 fps) x 1,000 seeded random seeks + sequential control | tested (report not committed) | `packages/evals/src/seek-conformance.ts`; 0 mismatches in the run reported by the worker on this profile, report at `.artifacts/conformance/seek-conformance.json` (not committed). HEVC is not directly decodable here (conformed instead); VFR handled only via conform |
| Ten-minute A/V sync export test | implemented, not runtime-qualified | `packages/evals/src/av-sync-long.ts` written; `docs/evidence/av-sync-long.json` does not exist, run pending |
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
| Browser-side export | unavailable here / not built | AAC encode missing in this Chromium; route planned for Phase 4 |
| Export cancel, range export, stills, GIF, sidecars, archive | not built | |
| GPU compositor, effects, transitions, masks, captions, audio DSP, OPFS/offline drafts, tablet/mobile layouts, first-run demo/tour | not built | |

## Agent surface

| Capability | Status | Evidence / limits |
|---|---|---|
| REST `/api/v1` subset | tested | Proof |
| OpenAPI 3.1 at `GET /api/v1/openapi.json`, generated from the op registry | tested | Checked in both directions against the real route table (`apps/server/src/openapi.test.ts`) |
| MCP over HTTP, protocol 2026-07-28, stateless | tested | Official client pinned to 2026-07-28 |
| MCP legacy (2025-11-25) clients | tested | Served by the SDK's stateless fallback |
| Tools generated from the op registry + senses `get_summary`, `get_timeline`, `describe_ops`, `render_frame` | tested | Only the official SDK client has been tried; no third-party MCP host |
| Scopes `observe` / `edit` enforced server-side | tested | No project/track/range scopes, budgets, Pause Agent, approvals |
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
