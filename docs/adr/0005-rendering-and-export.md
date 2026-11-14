# ADR-0005: Shared evaluator, Canvas2D reference compositor, server export in pinned Chromium

Status: accepted for Phase 0–1; compositor backend to be revisited in Phase 2

## Decision
- `evaluate(doc, time) → RenderGraph` is pure (`packages/engine`). Preview, agent stills and export all call it.
- One compositor implementation, **Canvas2D**, draws the graph. The editor runs it on a visible canvas; export and `render_frame` run the
  same bundle in a headless Chromium (Playwright 1.63.0, Chromium 153) on a CPU-raster canvas (`willReadFrequently`).
- Source frames are decoded with WebCodecs through Mediabunny (`VideoSampleSink`), one decoder per clip.
- Export: render page → raw RGBA frames over loopback HTTP (ordered, size-checked, back-pressured) → `ffmpeg` stdin as a single well-defined
  rawvideo stream. Audio is mixed separately by ffmpeg into a sample-exact WAV and supplied as a second input. Output: H.264 High yuv420p BT.709 limited + AAC in MP4.
- Text is shaped by Chromium's own text stack using a bundled, hashed Heebo font. Preview and export therefore share one shaping implementation.

## Why not WebGPU now
Measured here: headless Chromium 153 returns **no WebGPU adapter** by default; an adapter appears only with SwiftShader flags including
`--enable-unsafe-webgpu`, which SPEC §9 says not to prescribe from memory. Canvas2D works identically in the editor and the worker today,
is deterministic on CPU, and is enough to prove the pipeline. Effects (Phase 7) need a GPU compositor; that decision needs a probe on real
target hardware (see docs/BLOCKERS.md B-1).

## Why server export first
Measured here: WebCodecs can encode H.264 High but **cannot encode AAC**, so a browser-only MP4 H.264+AAC export is not available in this
Chromium. The browser route is deferred to Phase 4.

## Known gaps
- ffmpeg audio mixing is a verified path for gain/trim/delay only; the shared DSP contract (SPEC §10) is not started.
- Preview audio decodes the whole file with `decodeAudioData`; fine for short clips, not for long media.
- The render page downloads each asset fully before decoding (no range reads yet).
- No colour management beyond "treat sources as SDR BT.709, tag output BT.709". HDR sources are not detected or tone-mapped.
- The headless browser uses Playwright's default launch settings in this container. A hosted deployment must isolate the render worker (SPEC §26); not designed yet.
