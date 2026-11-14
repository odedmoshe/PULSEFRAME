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

## Network constraints observed in the development environment

- `download.pytorch.org` is blocked by the network policy. PyTorch was installed from PyPI instead.
- GitHub clones of public repositories and the npm and PyPI registries are reachable.
