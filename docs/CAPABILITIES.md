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
| Import MP4/WebM video and common audio (upload, hash, ffprobe) | tested | Phase 0 proof. CFR, unrotated only; VFR and rotation are rejected with a typed error |
| Timeline edits: add clip (linked audio), add/update text, move, trim, split, delete, transform, gain | tested | `core.test.ts`, proof. No ripple, roll, slip, slide |
| Still images (PNG/JPEG/WebP) at ingest, rendered as image layers | tested (partial) | Seen through the shared compositor in the G0 proof check \"the attached provider image renders through the shared compositor…\". No dedicated upload test for stills yet |
| Undo/redo as compensating transactions, per actor | tested | `undo.test.ts`; proof checks \"agent undo:\", \"human undo (Ctrl+Z)…\", \"redo then undo…\". Refused with a conflict list when items changed later; other actors' edits survive. Buttons and Ctrl/Cmd+Z, Shift+Z, Y. No restore-as-branch, no drag coalescing. Undo-all/redo-all property test runs 60 times per test run; the 10,000-sequence nightly run is not set up |
| Rebase of stale edits via `baseRevision`; typed `conflict` | tested | `undo.test.ts`; proof checks beginning \"rebase:\" and \"conflict:\". Strict `expectedRevision` kept. Conflicts are per entity, not per property |
| Three-client convergence (2 REST+SSE, 1 MCP) | tested | `packages/evals/src/convergence.test.ts`, 15 seeds x 40 steps per run; the 1,000-seed nightly run is not set up. Offline drafts and revoked access not covered |
| Licence notices in the build | tested (partial) | Built web app ships `THIRD_PARTY_NOTICES.txt` with full licence texts for bundled third-party packages; `pnpm check:notices` is part of `pnpm check`. The build-fails-on-missing-licence path is untested |
| Storage migration v1 (`PRAGMA user_version`) | implemented, not runtime-qualified | Code only, no dedicated test |
| Exact rational time | tested | `time.test.ts` |
| Preview (shared evaluator + Canvas2D, WebCodecs decode) | tested | Proof reads the frame-index barcode from preview pixels. No effects, no proxies |
| Preview audio on the audio clock, monotonic fallback | tested (basic) | Proof checks playback advances; which clock was used is not asserted; A/V sync of *preview* is not measured |
| Hebrew/Latin bidi text with niqqud, word wrap, stroke, background | tested (visual) | Screenshots in `docs/evidence/`; no automated golden-image test yet |
| Hebrew default UI with EN toggle; RTL chrome, LTR timeline | tested | Proof. Activity summaries from the server are English only |
| Keyboard editing by physical key codes | tested (subset) | Space, arrows, Shift+arrows, Home/End, S, Delete, `[` `]`. Not remappable |
| Save/reload, op-log replay, restart recovery | tested | `store.test.ts`, proof |
| Server export MP4 H.264 High + AAC, BT.709 tagged | tested | Proof: 105/105 frames source-exact, A/V onset error 0.06 ms, PSNR 46.7 dB / SSIM 0.998 on one frame |
| Browser-side export | unavailable here / not built | AAC encode missing in this Chromium; route planned for Phase 4 |
| Export cancel, range export, stills, GIF, sidecars, archive | not built | |
| GPU compositor, effects, transitions, masks, keyframes, captions, audio DSP | not built | |

## Agent surface

| Capability | Status | Evidence / limits |
|---|---|---|
| REST `/api/v1` subset | tested | Proof |
| OpenAPI 3.1 at `GET /api/v1/openapi.json`, generated from the op registry | tested | Drift test in `apps/server/src/openapi.test.ts` |
| MCP over HTTP, protocol 2026-07-28, stateless | tested | Official client pinned to 2026-07-28 |
| MCP legacy (2025-11-25) clients | tested | Served by the SDK's stateless fallback |
| Tools generated from the op registry + senses `get_summary`, `get_timeline`, `describe_ops`, `render_frame` | tested | Only the official SDK client has been tried; no third-party MCP host |
| Scopes `observe` / `edit` enforced server-side | tested | No project/track/range scopes, budgets, Pause Agent, approvals |
| Live UI update from agent edits (SSE) | tested | ~39 ms commit-to-visible on loopback, single sample |

## Optional AI providers

| Capability | Status | Evidence / limits |
|---|---|---|
| ComfyUI provider connection | setup-required | Needs a running ComfyUI and `PF_COMFYUI_URL`. Without it the UI and API report "not configured" |
| `comfy.smoke.solid-image` (model-free diagnostic) | tested on CPU | `docs/evidence/g0-smoke-proof.json`, ComfyUI 0.45.0, CPU device. Not a creative capability |
| Workflow import (API-format JSON → draft + blockers) | tested (parse only) | Drafts are not stored and cannot be published or run yet |
| Any model-based workflow (BiRefNet, MoGe-2, SeedVR2, LTX, Wan, …) | blocked | `huggingface.co` is denied by the environment network policy (`docs/BLOCKERS.md` B-6) and there is no GPU (B-4). The authorised <=1 GB CPU trial did not start (0 bytes, 0 s). ComfyUI 0.45.0 has core `LoadBackgroundRemovalModel` / `RemoveBackground` nodes. No model has been downloaded, licence-reviewed or executed |
| Provider output attachment and stale-result protection (model-free) | tested on CPU | `docs/evidence/g0-smoke-proof.json` (35 checks). Outputs are imported as derived assets with lineage and attached through `add_clip` in their own revision; undo removes the clip and keeps the asset. If an entity the placement depends on changed while the job ran, nothing is placed and the asset stays a proposal. No proposal review UI |
| Media-input workflows (source-range staging, cost reservation, budget checks) | not built | In progress |
| Model packs, readiness for models, worker lease/prewarm | not built | |
| Every other AI capability in SPEC §18 (ASR, TTS, generation, …) | not built | No adapters, no credentials requested |

### Qualification dimensions (Amendment A1, FF-04) — current values

| Capability | schema-valid | dependency-ready | licence-reviewed | executed | quality-reviewed | Hebrew-qualified | hardware-qualified |
|---|---|---|---|---|---|---|---|
| `comfy.smoke.solid-image` 1.0.0 | pass | pass (no models, core nodes) | pass (no weights) | pass after a recorded run; evidence cites the job | n/a | n/a | pass **only** for the profile of the recorded run (CPU here) |

No Freefield workflow has any dimension assessed. Source review of that catalog was done by the addendum's author, not reproduced here.
