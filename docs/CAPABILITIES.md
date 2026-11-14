# Capabilities by execution profile

Status words (SPEC §27): **tested** = implemented and exercised by a named check here · **setup-required** = implemented, needs something the operator provides ·
**experimental** · **unavailable** = not available in this profile · **not built** = no implementation yet.
Only one profile has been run: the development container. Nothing below is a claim about other machines.

## Profile measured: `dev-container-software` (2026-11-14)
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
| Import MP4/WebM video and common audio (upload, hash, ffprobe) | tested | Phase 0 proof. CFR, unrotated only; VFR, rotation and still images are rejected with a typed error |
| Timeline edits: add clip (linked audio), add/update text, move, trim, split, delete, transform, gain | tested | `core.test.ts`, proof. No ripple, roll, slip, slide, undo/redo |
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
| REST `/api/v1` subset | tested | Proof. No OpenAPI document yet |
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
| Any model-based workflow (BiRefNet, MoGe-2, SeedVR2, LTX, Wan, …) | not built · unavailable here | No GPU in this profile; no model has been downloaded, licence-reviewed or executed |
| Timeline attachment of provider outputs | not built | Outputs are validated blobs on the job only |
| Model packs, readiness for models, worker lease/prewarm | not built | |
| Every other AI capability in SPEC §18 (ASR, TTS, generation, …) | not built | No adapters, no credentials requested |

### Qualification dimensions (Amendment A1, FF-04) — current values

| Capability | schema-valid | dependency-ready | licence-reviewed | executed | quality-reviewed | Hebrew-qualified | hardware-qualified |
|---|---|---|---|---|---|---|---|
| `comfy.smoke.solid-image` 1.0.0 | pass | pass (no models, core nodes) | pass (no weights) | pass after a recorded run; evidence cites the job | n/a | n/a | pass **only** for the profile of the recorded run (CPU here) |

No Freefield workflow has any dimension assessed. Source review of that catalog was done by the addendum's author, not reproduced here.
