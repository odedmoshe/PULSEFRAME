# ADR-0008: WebGPU effect passes behind the shared compositor

Status: **accepted** (2026-11-16) for steps 1–3; step 4: the owner ran both effects on the laptop on 2026-11-16 (preview and one export worked; which adapter was used was not recorded).

## Context (measured, with where each fact comes from)
- ADR-0005 keeps one evaluator and one Canvas2D compositor for preview, stills and export, and deferred the GPU decision to data from real hardware (B-1).
- Reference laptop, owner's Chrome 157 on Windows (`docs/evidence/owner-machine-gpu-check-2026-11-16.json`, and a second run with the corrected page): WebGPU with a real adapter, `float32-filterable`, 16384 px textures. The adapter is the integrated Intel UHD graphics; Chrome did not use the RTX 3050 in either run. One timing sample: 4.7 ms per full-frame pass of a simple shader at 1080×1920, 9 ms to read one frame back.
- The same fixed shader gave the same two pixels on that Intel adapter and on the software adapter in this container (`docs/evidence/worker-gpu-probe-linux-container.json`). One shader, two implementations: encouraging, not proof of cross-device equality for real effect chains.
- Render worker (the headless Chromium that makes stills and exports): in this container it gets a **software** WebGPU adapter as soon as `--enable-unsafe-webgpu` is passed (about 42–47 ms per pass, one sample each). On the reference laptop the earlier probe reported **no adapter** with the SwiftShader flag set. Which launch settings give the worker an adapter there is unknown; `pnpm probe:gpu` measures it.

## Data from step 1 (reference laptop, `docs/evidence/worker-gpu-probe-owner-laptop-2026-11-16.json`)
- Bundled Chromium, headless: no adapter, or the device cannot be created (`dxil.dll` cannot be loaded).
- Bundled Chromium with a real window placed off-screen: a hardware adapter; with `--force_high_performance_gpu` it is the RTX 3050 (0.34 ms per pass in one sample; the integrated Intel adapter gave 4.7 ms).
- Installed Chrome, headless with the GPU enabled: the RTX 3050 as well.
- The reference pixels match on Intel, on NVIDIA and on the software adapter.
Consequence: the worker's launch mode is found by the render host for projects that use a GPU effect (first of headless / window / installed Chrome whose browser can create a device), and can be forced by a setting (`PF_RENDER_GPU`: `auto`, `window`, `chrome`, `off`; see `apps/renderer/src/index.ts`). The default stays headless; on that laptop GPU effects in export need `window` (pinned browser) or `chrome` (text shaped by the installed Chrome's version).

## Found while building step 2
- Drawing a WebGPU canvas into the 2D canvas returned an empty picture and lost the device on the headless software adapter. The pass therefore renders into a texture and the result is read back through a buffer. This costs a readback per effect and makes applying an effect asynchronous.
- Because a frame now waits in the middle of drawing while the shared scratch buffers hold its layers, frames are serialised whenever one with a GPU effect is in flight (`drawGraph`); frames without one are drawn synchronously as before.

## Decision
1. **Layout, text and layering stay in the Canvas2D compositor.** Text shaping by Chromium's text stack is what makes Hebrew correct and identical in preview and export; it is not reimplemented in shaders.
2. **Effects that need per-pixel maths become WebGPU passes** applied to a layer's pixels: the layer is drawn to a canvas as today, uploaded as a texture, run through one WGSL pass per effect, and read back. One WGSL source per effect, used by the editor, stills and export alike. No second, CPU implementation of the same effect: two implementations of one look would drift apart.
3. **An effect of this family runs only where the adapter has proved itself**: the editor's browser and the render worker each ask for an adapter and must reproduce the reference pixels before any pass is used. (Built: the editor offers the effects only when its own check passed; the worker's state is discovered when a still or an export needs it, and is not yet reported to the editor beforehand.) Otherwise the effect is listed as unavailable with the reason (an honest setup state), and existing Canvas2D effects are untouched. A project that already uses such an effect on a machine without it shows the layer without the effect and says so; export refuses rather than silently dropping it.
4. **Determinism is a tested property, not an assumption**: `rgba8unorm` targets, no blending modes that depend on driver precision where avoidable, and the parity suite gains per-effect checks that preview, still and export agree within a stated tolerance on the machine at hand. Cross-machine equality is not promised.
5. **WebGL2 is not a second backend.** If a machine has no usable WebGPU in both places, the effect family is unavailable there. (SPEC §9 allows a documented fallback; this is the documented one.)

## Steps
1. `pnpm probe:gpu` on the reference laptop: which worker launch settings give an adapter (hardware or software), with matching pixels. This decides whether export there can run the passes at all, and on what.
2. A minimal pass pipeline in `packages/engine` (texture in → chain → texture out) with two effects that Canvas2D cannot do well, developed here on the software adapter; preview/still/export parity checks for them.
3. Capability reporting (editor and worker), gating in the catalogue and in export, wording in both languages.
4. The owner checks the two effects on the laptop. Only then more effects.

## Addendum: an effect with a second texture (colour tables, `color.lut`)
- An effect may sample one auxiliary texture besides the layer: `color.lut` binds the colour table at binding 3, where transitions bind their second picture, through the same sampler (linear, clamp). Only that effect's shader declares the binding (pipelines use the automatic layout).
- The table is not a parameter. The compositor's `FrameProvider` has an optional `lut(assetId)`; `drawGraph` loads the tables a frame names before the GPU gate and passes them through the effect environment. The texture is made once per table (keyed by content hash), kept on the GPU state (at most 8) and gone with the device.
- The pass has a tested model: core's `sampleStrip` is the same arithmetic in JavaScript, and `pnpm proof:gpu` compares stills against it. Every context turns file text into the strip with the one function `lutStrip` (which also resamples a non-unit input domain onto 0..1: on the file's own grid size when that loses nothing, otherwise on the smallest finer grid that holds every entry of the file, and on 65 entries per axis, as an approximation, when none up to 65 does; the strip's size is therefore the strip's own, read by the shader from the texture, and may be larger than the file's).
- Decision 3 extended: an effect whose own material is missing (a table that was named but could not be loaded) is unavailable in the same way, with its own reason (`unavailableReasons`), so a still or an export refuses and says it is the table, not the adapter. With no table chosen the effect is the picture unchanged and is not reported. The editor shows such a reason over the preview and draws the paused frame again after a wait (2 s, doubling, at most 30 s); the media pool gives the same error for a short while instead of fetching and parsing again for every drawn frame (1 s, doubling, at most 30 s), then asks the server afresh.

## What this does not decide
Performance targets (SPEC Appendix C2), HDR output, video memory budgets, use of the RTX 3050, and decoding straight to GPU textures. Each needs its own measurements.
