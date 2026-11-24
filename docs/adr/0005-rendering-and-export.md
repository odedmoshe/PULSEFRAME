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

## Phase 2 additions
- Media is read by HTTP range requests (Mediabunny `UrlSource`) with a 16 MiB byte cache per decoder; no whole-file download for video.
- Budgets: at most 6 clip decoders in the editor (8 in the render worker), at most 16 decoded stills; least-recently-used are disposed promptly.
  *Amended 2026-11-17 (ADR-0011):* 10 clip decoders in the editor and 12 in the render worker and browser export, because a time effect on a video reads it through extra decode lanes. Each decoder still keeps its own 16 MiB byte cache; the memory this costs on the owner's laptop has not been measured.
- Preview decodes the **proxy** when one is ready (same frame count and rate, verified per frame at ingest); export and `render_frame` always decode the original.
  A proxy becoming ready invalidates that asset's preview decoders.
- Sources that the editor cannot decode directly are conformed at ingest (ADR-0003).
- Playback instrumentation reports which clock drove playback and how late frames were painted.

## Amendment 2026-11-24: draft playback of faded pictures and dissolves
Draft playback may differ from the full picture by at most 2 of 255 in faded pictures and dissolves (zero mean); the paused preview, stills and export are exact and identical to each other.

- What is exact: a picture below full opacity is placed opaque in a scratch buffer and faded there by one destination-in fill, and the dissolve fades each of its two pictures that way (weights (255 − k)/255 and k/255, k = round(255·p)), instead of drawing with `globalAlpha`, which Chromium's software canvas truncates (the frame came out on average half a level low, some bytes 2 off). Every byte is then within 1 of the exact mix at the nearest 8-bit alpha. The fill costs about 8 ms per 1920×1080 buffer on a CPU canvas, so it covers only the pixels the picture's placed box can touch (byte-identical to a fill of the whole buffer).
- What draft changes: `drawGraph(…, { quality: 'draft' })`, passed only by the player while it plays a reduced picture and by the angle viewer (the `pictureQuality()` rule that also picks proxy frames). A faded picture with the normal blend is copied into its buffer with `globalAlpha`, and the dissolve adds its two pictures with `globalAlpha`, without the fills. A faded picture with any other blend mode keeps the exact fill (the copied form's mean error there reached +0.28). Nothing else differs. The flash guard reads no pixels (it works from the render graph and from which effects were drawn, the same in both qualities).
- Measured (`pnpm conformance:opacity`, headless Chromium 153, every 256×256 byte pair):
  - full: checks 1–4 and 8 (stills; within 1 at the nearest 8-bit alpha; box fill equal to the whole-buffer fill over 54 placements, 182 million bytes);
  - draft: checks 5–7 (the lab page draws the same frames with the same `drawGraph`). Normal blend at 99 opacities: worst 2, mean error 0.000, 0.13% of bytes 2 off. Dissolve at 21 progress values: worst 2, mean 0.000, 0.14% 2 off. Draft against full: at most 2 apart on every frame. The lab's full frame equals the still.
- Cost, one sample on this machine (median ms per frame, preview canvas, load average about 4 on 4 CPUs):
  - 1920×1080, one faded clip: full 10–12, draft 3.4–3.8.
  - 1920×1080, three stacked faded clips: full 43–45, draft 18–22; three opaque clips: 2.5–2.8.
  - At the playing size of a 1080p project (1707×960, sources 960×540 like proxies): one faded clip full 22, draft 15; three faded clips full 71–72, draft 49–52. Three opaque clips already cost 37–41 there, from upscaling with `imageSmoothingQuality = 'high'`.
  - Full with a half-size faded picture: 12–14 with the box-limited fill, 15–18 with a fill of the whole buffer.
- Not measured: zoom and blur-dissolve (still `globalAlpha`); titles and time-effect taps (recorded as known); a GPU-backed canvas.

## Known gaps
- ffmpeg audio mixing is a verified path for gain/trim/delay only; the shared DSP contract (SPEC §10) is not started.
- Preview audio decodes the whole file with `decodeAudioData`; fine for short clips, not for long media.
- No colour management beyond "treat sources as SDR BT.709, tag output BT.709". HDR sources are not detected or tone-mapped.
- The headless browser uses Playwright's default launch settings in this container. A hosted deployment must isolate the render worker (SPEC §26); not designed yet.
