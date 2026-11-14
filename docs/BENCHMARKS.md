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

## Not measured
Preview frame rate, seek latency, large-timeline behaviour, memory growth, cold start, any GPU figure, any model workload.
