# Tech radar

Versions are the exact pins in the manifests / lockfile as of 2026-11-14. "Checked" means exercised by the test suite or the Phase 0 proof in this repository, not a general endorsement.

Licence column: SPDX identifier read from the package's `package.json` where the package is in the lockfile. "Not determined" means no licence was read for that item. Reference URLs are project homepages or specifications named for orientation; they were not fetched while preparing this page.

| Area | Choice | Version | Licence | Official reference (URL) | How it was checked | Status |
|---|---|---|---|---|---|---|
| Runtime | Node.js | v22.23.4 | Not determined | https://nodejs.org | All tests | adopted |
| Package manager | pnpm | 10.28.0 | Not determined | https://pnpm.io | Not recorded | adopted |
| Language | TypeScript | 7.0.2 | Apache-2.0 | https://www.typescriptlang.org | `pnpm typecheck` | adopted |
| Schemas | zod | 4.6.7 | MIT | https://zod.dev | `z.toJSONSchema` generates REST/MCP schemas; unit tests | adopted |
| API server | hono + @hono/node-server | 4.13.18 + 2.1.8 | MIT | https://hono.dev | Phase 0 proof | adopted |
| Persistence | better-sqlite3 (SQLite 3.54.1, WAL) | 13.2.0 | MIT (better-sqlite3); SQLite is public domain | https://github.com/WiseLibs/better-sqlite3 | Store tests | adopted |
| MCP | @modelcontextprotocol/server and @modelcontextprotocol/client | 2.4.0 | Apache-2.0 | https://modelcontextprotocol.io/specification/2026-07-28 | Phase 0 proof negotiates 2026-07-28 and legacy 2025-11-25 | adopted |
| MCP (old package) | @modelcontextprotocol/sdk | 1.32.2 | Not determined | Not recorded | Not in lockfile; implements only up to protocol 2025-11-25 | rejected |
| Media I/O | mediabunny | 1.66.0 | MPL-2.0 | https://mediabunny.dev/guide/introduction | Phase 0 proof: frame-exact check on 105 frames; WebCodecs decode in preview and render worker | adopted |
| UI | react, react-dom | 19.3.1 | MIT | https://react.dev | Phase 0 proof drives the built app | adopted |
| Build | vite, @vitejs/plugin-react | 8.3.8, 6.3.0 | MIT | https://vite.dev | Phase 0 proof drives the built app | adopted |
| Fonts | @fontsource/heebo | 5.3.0 | OFL-1.1 | https://fontsource.org | Hebrew + niqqud render check in proof screenshots | adopted |
| Headless renderer | playwright / Chromium | 1.63.0 / 153.0.8010.12 | Apache-2.0 (Playwright); Chromium is BSD-3-Clause plus third-party licences | https://playwright.dev | Used for the software export profile | adopted |
| Encoder | System FFmpeg (libx264, native aac) | 6.1.1 | GPL (build configured with `--enable-gpl`) | https://ffmpeg.org/legal.html | Phase 0 proof validates output | adopted |
| Tests | vitest, fast-check | 5.1.0, 4.10.2 | MIT | https://vitest.dev, https://fast-check.dev | Test suite | adopted |
| TS runner | tsx | 4.23.15 | MIT | https://tsx.is | Dev and server start | adopted |
| Compositor | Canvas2D | Browser API | Not determined | https://html.spec.whatwg.org/multipage/canvas.html | Phases 0–1 (see docs/adr/0005) | adopted |
| Compositor | WebGPU / WGSL | Browser API | Not determined | https://www.w3.org/TR/webgpu/ | No adapter in headless Chromium here without SwiftShader flags (docs/evidence/capability-probe.json) | candidate |
| Browser export | WebCodecs | Browser API | Not determined | https://www.w3.org/TR/webcodecs/ | H.264 High encode supported; AAC encode NOT supported in this Chromium (probe) | candidate |
| Queue | In-process durable job rows | n/a (in-repo) | n/a | Not recorded | Local profile | adopted |
| Queue | Redis / BullMQ | Not pinned | Not determined | https://redis.io, https://bullmq.io | Not evaluated | candidate |
| Optional provider | ComfyUI (commit eee59185ff4f43ae2d9ad122b245619d27d9daad), direct HTTP API | 0.45.0 | GPL-3.0 | https://github.com/comfyanonymous/ComfyUI | CPU with a model-free graph only | adopted (optional provider, docs/adr/0007) |
| Comfy SDK | Not adopted (direct API used) | Not pinned | Not determined | Not recorded | Not applicable | rejected (not adopted) |
| Text shaping | HarfBuzz-compatible shared text shaping | Not pinned | Not determined | Not recorded | Not evaluated | candidate |
| ML runtime | ONNX Runtime Web | Not pinned | Not determined | https://onnxruntime.ai | Not evaluated | candidate |
| ML runtime | Transformers.js | Not pinned | Not determined | https://huggingface.co/docs/transformers.js | Not evaluated | candidate |
| ML runtime | MediaPipe | Not pinned | Not determined | https://ai.google.dev/edge/mediapipe | Not evaluated | candidate |
| Speech-to-text | ivrit.ai faster-whisper | Not pinned | Not determined | Not recorded | Not evaluated | candidate |
| Speech synthesis | ElevenLabs | Not pinned | Not determined | https://elevenlabs.io | Not evaluated | candidate |
| Generative video | fal | Not pinned | Not determined | https://fal.ai | Not evaluated | candidate |
| Generative video | Runway | Not pinned | Not determined | https://runwayml.com | Not evaluated | candidate |
| Animation | Lottie renderer | Not pinned | Not determined | https://lottiefiles.com | Not evaluated | candidate |
| Hosted persistence | PostgreSQL + object storage | Not pinned | Not determined | https://www.postgresql.org | Not evaluated | candidate |

## Radar pass of 2026-11-26 (the lead's standing duty; nothing below is installed, run or measured)

Full tables with a source and a read date per row: `docs/design/TOOL_RADAR_ENGINES_2026-11-26.md` (about 190 engines and libraries)
and `docs/design/TOOL_RADAR_AI_2026-11-26.md` (models, cloud services, agent ecosystem, competitor gaps). Read by two research
workers from registries, licence files and official pages; Hebrew quality and fit on a 4 GB GPU are unmeasured for every model.
Where each find goes (state `candidate` for all; the track's designer reads the licence at source again before anything is pinned):

| Track | Finds assigned to it |
|---|---|
| Code-made clips (pages) | D3 / Observable Plot / Chart.js, Mermaid, KaTeX, Shiki, dotLottie / lottie-web, three postprocessing, troika-three-text, PixiJS + pixi-filters |
| Engines (free-running, logged) | auto-editor, ffmpeg-normalize + libebur128, PySceneDetect then TransNetV2, Silero VAD, WhisperX, Demucs, DeepFilterNet, Typst, OpenColorIO, libass / pysubs2 |
| Transitions | gl-transitions (about 100 GLSL transitions; MIT per npm) through the existing GPU pass contract |
| Interchange (new track) | OpenTimelineIO + plugins (EDL, FCP7 XML, AAF); whether Resolve or Premiere open the results is not confirmed |
| Capture (new track) | FFmpeg ddagrab, obs-websocket-js; a cursor and click log for automatic zoom (pattern seen in OpenScreen, MIT) ; teleprompter |
| Understand footage (new track) | shot list, small local vision model for keyframe captions (Qwen3-VL 2B/4B, SmolVLM2), Gemini video understanding on the owner's key, Tesseract heb / RapidOCR, TwelveLabs; feeds search by words, picture and on-screen text, highlight finding, automatic B-roll |
| Generate | Runway API (routes to several video models), Gemini Omni 1.2 Flash, an image adapter (FLUX, gpt-image, Nano Banana 2), ElevenLabs (speech, effects, music, dubbing), ACE-Step 1.5 local music, BFL erase / deblur / upscale |
| Speech | Hebrew speech trials ZONOS3-Mini and VoxCPM2 (Apache-2.0, cards list Hebrew), MADLAD-400 3B for translation |
| In-editor agent and skills | Agent Skills `SKILL.md` as the saved-skill format, Playwright MCP / Chrome DevTools MCP, an own edit-eval set after Timeline-Bench / AgenticVBench with a state-diff checker |
| Publish | YouTube upload connector with the AI-disclosure field |
| People & subject | MuseTalk 1.5 lip sync (after cloud dubbing), avatars (HeyGen / Synthesia) |

Licence notes read on that date: GSAP's standard licence has a prohibited-use clause (tools that let users build visual animations
without code in competition with Webflow) — quoted in the NOTICE row, as decided; Pedalboard and DawDreamer are GPL-3.0 (separate
program only); LYGIA shaders and madmom's models are non-commercial (out); the open video generators read are 18 GB or more and
several exclude regions (out for this laptop). Reported by the research, not checked by the lead: OpenAI's Videos API (Sora 2) closed
on 2026-09-24 and Veo 3.1 preview left the Gemini API.

## Network constraints observed in the development environment

- `download.pytorch.org` is blocked by the network policy. PyTorch was installed from PyPI instead.
- GitHub clones of public repositories and the npm and PyPI registries are reachable.
