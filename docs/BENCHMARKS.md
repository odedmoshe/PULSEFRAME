# Benchmarks

Measured values only. These are **not** the Appendix C2 targets and say nothing about other hardware.
Source of truth: `docs/evidence/phase0-proof.json`, `docs/evidence/g0-smoke-proof.json` (rewritten by every proof run, so values vary slightly).

## Machine `dev-container-software`
Linux 6.18 x64 · Intel Xeon @ 2.10 GHz, 4 logical CPUs · 15.7 GiB RAM · no GPU · Node 22.23.4 · Chromium 153.0.8010.12 headless · FFmpeg 6.1.1-3ubuntu5 (libx264 preset medium, crf 16) · warm caches · run of 2026-11-14.

## Fixture
`packages/fixtures`: 640×360, 30 fps, 120 frames, H.264 High with B-frames (GOP 30) + AAC 48 kHz; frame-index barcode in every frame; 1 kHz 100 ms beep at each whole second. Generated per run.

## Phase 0 proof workload
1080×1920 project, 30 fps, 105 frames (3.5 s): two video clips (one trimmed and moved), one text layer, two audio clips.

| Measurement | Value | Samples | Notes |
|---|---|---|---|
| Export wall time | 7.4 s for 3.5 s of video = **0.47× real time** | 1 | Software path. Appendix C2's 2× target is for a hardware-encoder profile and is not met or attempted here |
| – draw (evaluate + composite) | 0.66 s (≈160 frames/s) | 105 frames | Canvas2D, CPU raster, decode included |
| – readback (`getImageData`) | 0.69 s | 105 frames | |
| – frame transfer + encode | 5.2 s | 105 frames | 871 MB of RGBA over loopback HTTP into ffmpeg; this is the bottleneck |
| Frame transfer, typed-array body vs `Blob` body | 18–20 MB/s vs 266 MB/s | 192 MB each | Chromium 153 `fetch` upload; switching to `Blob` cut export time from 53.6 s to 7.4 s |
| Source-frame exactness in export | 105 / 105 frames correct | all frames | Barcode decoded from the MP4 vs the pure evaluator |
| A/V sync | max onset error 0.06 ms | 3 beeps | Frame is 33.3 ms. Short clip; the 10-minute drift fixture (C3) is not built |
| Parity, compositor PNG vs decoded H.264 | PSNR 46.7 dB, SSIM 0.998 | 1 frame | One frame, not a suite; no raw-vs-raw test yet |
| REST commit latency (loopback) | median 5.9 ms, p95 10.1 ms, max 10.8 ms | 30 | Target p95 < 100 ms |
| Agent edit: MCP request → committed | 14.5 ms | 1 | 4-op transaction |
| Agent edit: request → visible in the open editor | 38.9 ms | 1 | Includes Playwright polling; target < 150 ms |
| Editor shell load → project shown | 185 ms | 1 | Loopback, warm, headless; not the C2 startup profile |

## G0 provider smoke (ComfyUI 0.45.0, CPU)
`comfy.smoke.solid-image`, 320×192, batch 1: preparing 0.21 s · submit 0.01 s · queue+inference 0.47 s (200 ms polling granularity) · transfer 0.01 s · validation 0.06 s. Peak device memory: not measurable on a CPU device.

## Phase 2 measurements (same machine, 2026-11-14)

| Measurement | Value | Samples | Notes |
|---|---|---|---|
| Random-seek correctness | 0 wrong of 7,000 | 7 fixtures × 1,000 seeded seeks | Through the real decode + export path; each single-frame clip is its own decoder. `docs/evidence/seek-conformance.json` |
| Random-seek export time | 24–44 s per 1,000-frame export at 640×360 | 7 | Long GOP (250) is the slow one (44 s) |
| Ten-minute export | 163 s for 562.6 s of 640×360 video = **3.45× real time** | 1 | draw 30 s, readback 11 s, transfer+encode 115 s. `docs/evidence/av-sync-long.json` |
| A/V sync over ten minutes | max offset 0.063 ms; drift 0 ms | 563 flash/beep pairs | One edit in the middle |
| Preview audio onset error | 0.06 ms | 3 beeps, 1 run | Sample-accurate tap on the audio clock, headless |
| Preview frame paint lateness | median 5–15 ms, p95 21–24 ms, max 24–28 ms | 104 frames × 2 runs | 1080×1920 project previewed at 540×960 from the proxy; software raster |
| Ingest derivatives (90-frame 640×360 clip) | 0.64 s for thumbnails + waveform + proxy | 1 | Worker-reported |
| BiRefNet image matting, CPU | ~30 s including model load, 640×480 input | 1 | Functional trial only; not a GPU figure |

## Phase 4 measurements (same machine, 2026-11-14)

| Measurement | Value | Samples | Notes |
|---|---|---|---|
| Server export 1920×1080, 600 frames, quality high | 38.5 s = **0.52× real time** | 1 | draw 5.6 s, readback 3.7 s, transfer+encode 27.9 s. Software everything |
| Browser export 640×360, 105 frames (WebCodecs H.264 + Opus) | 0.59 s ≈ 5.9× real time | 1 | Worker-reported; in-memory output; software encoder in headless Chromium |
| Cancel a running export | 166 ms to `canceled`, no leftovers | 1 | |
| Paused preview vs headless still | byte-identical, 30/30 frames | 2 scenes | Same compositor, two hosts |
| Compositor vs H.264 high export | min PSNR 36.8 dB, min SSIM 0.997 | 47 frames | 640×360 synthetic scene with Hebrew text, alpha image, rotation, keyframes |
| Quality ladder (min PSNR / min SSIM) | standard 35.7 / 0.993 · draft 32.0 / 0.979 · WebM standard 35.65 / 0.985 | 38 frames each | Report only |
| Small text region, H.264 4:2:0 | 14 px: 29.1–31.4 dB · 28.8 px @720p: 33.9 dB · 43 px @1080p: 35.8 dB | flash frames | One synthetic scene; content-dependent |
| Size estimate vs actual | 22.3 MB estimated vs 0.75 MB actual (1080p synthetic) | 1 | The heuristic is far off for flat synthetic content; it is labelled an estimate |

## Not measured
Preview frames per second, interactive seek latency (ms to the correct frame), large-timeline behaviour, memory growth/soak, cold start, any GPU figure, any model workload on a GPU.
