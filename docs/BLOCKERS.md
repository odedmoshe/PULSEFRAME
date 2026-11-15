# Blockers

Each entry: what is blocked, how to reproduce, impact, proposed way forward. Work that does not depend on an entry continues.

## B-1 — No GPU and no default WebGPU adapter in the development environment
- **Reproduce:** `pnpm probe` → `browserDefault.webgpu.adapter` is `null`; `nvidia-smi` is absent.
- **Impact:** a WebGPU compositor (needed from Phase 7 for effects) and the Appendix C2 preview/export performance targets cannot be developed against or measured on real hardware here. All current numbers are for a 4-vCPU software profile.
- **Proposed:** keep Canvas2D through Phase 1–2; run `pnpm probe` and the proofs on the intended reference laptop and record results; decide WebGPU vs WebGL2 from that data. Owner input needed: which machine is the reference profile.

## B-2 — Browser export cannot produce AAC here
- **Reproduce:** probe → `audioEncode.aac: false`.
- **Impact:** browser-only MP4 H.264+AAC export is unavailable in this Chromium build.
- **Proposed:** Phase 4 browser route to be qualified on real Chrome builds; otherwise Opus-in-MP4/WebM or server export. No workaround implemented.

## B-3 — `download.pytorch.org` is blocked by the environment's network policy
- **Reproduce:** `pip install torch --index-url https://download.pytorch.org/whl/cpu` → proxy 403.
- **Impact:** only the default PyPI wheel (bundles CUDA libraries, ~4 GB venv) can be installed. Not a product issue.
- **Proposed:** none needed unless disk matters; the host can be allowed in the environment's network settings.

## B-4 — No model-based ComfyUI workflow can be *qualified* here (GPU, quality) — functional CPU runs are possible
- **Reproduce:** `GET /api/v1/capabilities` → provider device is `cpu`.
- **Impact:** "one qualified media workflow" (G0), and every G1–G3 workflow, needs model downloads and, realistically, a GPU. Quality, VRAM and hardware qualification cannot be produced in this environment. No model has been downloaded: that needs an explicit decision (size, licence, cost).
- **Update 2026-11-14:** owner designated this machine a provisional CPU functional profile and authorised one bounded trial; BiRefNet image matting ran on CPU (functional evidence only). GPU memory/speed and quality review remain open for every workflow.
- **Proposed:** (a) the owner names a GPU machine or approved remote worker and a first workflow — BiRefNet image matte is the smallest candidate (0.44 GB of weights reported); or (b) authorise a CPU attempt of that single workflow here for functional (not performance) evidence. Until then, G0 continues with the parts that do not need a model: image/derived-asset support, attachment via operations, stale-result protection.

## B-5 — Preconditions inside the project (not external)
Stale-result protection (FFG-09) needs entity versions (Phase 1). Timeline attachment needs image/derived assets (Phase 2). Worker lease and budgets need Phase 5/10 work.

## B-6 — RESOLVED 2026-11-14: model host was denied by the environment network policy
The owner allowed the host. `huggingface.co` is reachable through the environment proxy. Node's built-in `fetch` ignores `HTTPS_PROXY` unless
`NODE_USE_ENV_PROXY=1` is set (Node ≥ 22.21), so model downloads from the server need that variable **in proxied environments only**.
The bounded BiRefNet trial then ran: see docs/INTEGRATIONS.md and `docs/evidence/g1-birefnet-cpu-trial.json`.

## B-7 — Speech recognition and alignment need an owner decision
- **What works without it:** typed or imported (SRT/VTT) transcripts, caption rendering, text corrections, word-based cuts when word times are supplied, all proven on a synthetic transcript (`docs/evidence/phase6-proof.json`).
- **What is blocked:** automatic transcription, forced alignment, Hebrew word-boundary accuracy (SPEC Appendix C target: median 80 ms, p95 200 ms), filler-word detection. No ASR adapter exists; none is faked.
- **Why blocked:** a local model is a new download (the single 1 GB trial grant was scoped to one workflow and is used); a hosted provider needs a credential and may cost money. Neither is covered by an existing grant.
- **Decision needed:** (a) approve one local ASR model download (name, size and licence will be shown before download; CPU-only here, so speed evidence would be functional, not performance), or (b) provide a provider credential through the environment's credential form.

## B-8 — Voice (narration, text-to-speech, cloning) needs an owner decision
- **What works without it:** mixing, fades, ducking, loudness, synthesised sound effects (`docs/evidence/phase8-proof.json`).
- **What is blocked:** any generated or cloned voice, Hebrew TTS quality, dubbing. No adapter exists and none is simulated.
- **Why blocked:** needs either a hosted provider (credential, per-use cost, and that provider's consent/verification rules for cloning) or a local model download (size and licence to approve). Neither is covered by an existing grant.
- **Decision needed:** which provider or model, and the spending limit if hosted.

## B-9 — A built-in natural-language Director needs a language-model provider
- **What works without it:** an external agent (any MCP client) can plan and edit through the 50+ tools; rule-based recipes apply multi-step edits with one undo (`docs/evidence/phase11-proof.json`).
- **What is blocked:** typing a request inside the editor and having the product plan the edit itself; Prompt-to-Draft; Long-to-Shorts selection by meaning.
- **Why blocked:** needs a hosted model credential (per-use cost) or a local model download. Neither is covered by an existing grant.
- **Decision needed:** provider and spending limit, or confirmation that the external-agent route is the intended Director.
