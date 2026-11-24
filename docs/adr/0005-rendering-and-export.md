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
  - At the size a 1080p project played at until the playing-size rule below (1707×960, sources 960×540 like proxies, given as bitmaps): one faded clip full 22, draft 15; three faded clips full 71–72, draft 49–52. Three opaque clips already cost 37–41 there, from upscaling with `imageSmoothingQuality = 'high'`.
  - Full with a half-size faded picture: 12–14 with the box-limited fill, 15–18 with a fill of the whole buffer.
- Not measured: zoom and blur-dissolve (still `globalAlpha`); titles and time-effect taps (recorded as known); a GPU-backed canvas.

### The playing size (same day)
While it plays, the preview composites at the scale of the proxies: the frame's short side is at most 540 px, the height of a proxy (`apps/web/src/pictureSize.ts`, one rule for the player's pump, for `pictureQuality()` and for the lab's bench). Until now the height was at most 960.

- Sizes: 1920×1080 and 3840×2160 play at 960×540 (before: 1707×960); 1080×1920 at 540×960 (as before); 1080×1080 at 540×540 (before: 960×960); 1280×720 at 960×540. Paused, the project's own size, as before.
- Why: in a landscape or square project a picture fitted to the frame is then exactly its proxy's size and is drawn from it pixel for pixel. Before, every layer was resampled 1.78× up per frame, and that was the larger part of a playing frame; every scratch buffer, fill and composite of a faded picture also covered 3.2 times the pixels. The browser scales the one finished canvas to the layout (the canvas is sized by CSS, not by its pixel size).
- What draft may differ by, all of it: (1) resolution, as above: titles, captions, masks and effects are rasterised at the playing size; the geometry is the same, because every placement is a fraction of the frame and both sides are rounded from one scale (the playing picture has the project's shape within a pixel); (2) the source: proxy frames (frame-identical by index, verified at ingest); (3) faded pictures and dissolves, at most 2 of 255 with zero mean (above). The smoothing is the same in both qualities.
- Which projects are draft: those whose short side is over 540. New: a project with a short side over 540 and a height of at most 960 (1280×720, 960×960) played at full size and full quality from the originals and now plays draft from its proxies. A project with a short side of at most 540 plays the full picture at full size, as before (a frame higher than 960 but at most 540 wide was reduced before and is not now).
- Unchanged: `drawGraph` and the engine (no line of the compositor changed), so the paused preview, stills and export are what they were: `pnpm conformance:parity` Test 1 exact (30 of 30 frames, with and without video), `pnpm conformance:opacity` 8/8. The flash guard decides from the render graph before the player sets the drawing size on a copy of it, and from which effects were drawn; it reads no pixels and no size (`pnpm proof:gpu` 92/92, its shuttle check plays through the player).
- Measured (`pnpm bench:playback`, `docs/evidence/playback-bench.json`; headless Chromium 153, CPU canvases, 4 CPUs shared, load average 1.7–2.7 during the samples; median ms per playing frame: evaluate, `drawGraph` draft, the copy to the visible canvas; three samples each):
  - 1920×1080 project, proxies given as I420 video frames (what the decoder gives): three opaque clips 20.4–31.9 → 6.2–6.4; one faded clip over one opaque 16.4–18.0 → 4.9–5.7; three faded clips 36.4–36.8 → 9.7–11.2.
  - The same with the pictures given as bitmaps (as the figures above were taken): three opaque 40.9–43.6 → 1.5–1.7; one faded over one opaque 22.3–28.3 → 1.9–2.1; three faded 51.1–54.0 → 5.6–5.7.
  - 1080×1920 project (540×960 before and after, proxies 304×540 as video frames): three opaque 7.5–8.1; one faded over one opaque 5.4–7.0; three faded 11.5–15.8.
  - The editor itself playing three stacked 1080p clips for 4.5 s (`--editor`; one sample each; load 3.8–4.6 before, 2.0–2.8 after): opaque, 131 of 143 frames painted, median 55 ms late → 134 of 139, 16 ms; faded, 88 of 144, 112 ms late → 138 of 138, 25 ms. The 1080×1920 project: 139 of 139 and 138 of 147 before, 139 of 140 and 127 of 138 after (the same size: run-to-run variation).
- Where the time went (the bench's profile, `drawImage` alone, one layer, two runs): a 960×540 video frame drawn at 1707×960 costs 5.9–8.0 ms and at 960×540 2.1–2.5; a bitmap 13–19 and 0.3–0.4. A video frame is converted and scaled by a path that does not follow `imageSmoothingQuality` (high 5.9–8.0, low 6.2–7.0), so a lower smoothing in draft would not have helped video; it helps bitmaps (13–19 → 5), but without the size change a frame of three video layers stayed near 19 ms, and on a photo scaled down 'low' aliases. Not taken.
- Also measured and not taken: a playing height of 720 for 1080p (three opaque video layers 14–16 ms, three faded 22–26: every layer still resampled); a 1080×1920 project at its proxies' own 304×540 (three opaque 4.0–4.7 against 7.5–8.1: little to gain, and titles would be drawn 304 px wide).
- Known: while playing, a title is drawn at the playing size, so on a preview shown larger than 960×540 device pixels it is softer than before until the pause. A vertical source's proxy is 304×540, so a 1080×1920 project still resamples each layer 1.78× up (a proxy rule by the short side would remove that; not changed here). A clip whose proxy is not ready is drawn from its original, scaled down per frame (one 1920×1080 video frame to 960×540: about 9 ms). Not measured: a GPU-backed canvas.

## Known gaps
- ffmpeg audio mixing is a verified path for gain/trim/delay only; the shared DSP contract (SPEC §10) is not started.
- Preview audio decodes the whole file with `decodeAudioData`; fine for short clips, not for long media.
- No colour management beyond "treat sources as SDR BT.709, tag output BT.709". HDR sources are not detected or tone-mapped.
- The headless browser uses Playwright's default launch settings in this container. A hosted deployment must isolate the render worker (SPEC §26); not designed yet.
