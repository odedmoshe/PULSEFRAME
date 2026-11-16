# Blockers

Each entry: what is blocked, how to reproduce, impact, proposed way forward. Work that does not depend on an entry continues.

## B-1 — No GPU and no default WebGPU adapter in the development environment
- **Reproduce:** `pnpm probe` → `browserDefault.webgpu.adapter` is `null`; `nvidia-smi` is absent.
- **Impact:** a WebGPU compositor (needed from Phase 7 for effects) and the Appendix C2 preview/export performance targets cannot be developed against or measured on real hardware here. All current numbers are for a 4-vCPU software profile.
- **Update 2026-11-16:** the owner named the reference machine: their laptop with an NVIDIA GeForce RTX 3050 Laptop GPU (4 GB). The editor has since been installed and opened there (Windows 11, Node 22.17). `pnpm probe` there shows only a software renderer because it uses a headless browser; the page `/gpu.html`, opened in the owner's own Chrome, is what reports the real adapter. First result (`docs/evidence/owner-machine-gpu-check-2026-11-16.json`): WebGPU works in the owner's Chrome with a real adapter, but that adapter is the integrated Intel UHD graphics; the RTX 3050 was not used. Making Chrome use it is a Windows graphics setting on the owner's side. 4 GB of video memory bounds which model workflows can be qualified there.
- **Proposed:** keep Canvas2D through Phase 1–2; run `pnpm probe` and the proofs on the intended reference laptop and record results; decide WebGPU vs WebGL2 from that data. Owner input needed: which machine is the reference profile.

## B-2 — Browser export cannot produce AAC here
- **Reproduce:** probe → `audioEncode.aac: false` on this Linux build. On the owner's Windows machine the same bundled Chromium reports `aac: true` (2026-11-16), so this is specific to this environment; the browser route has still not been run there.
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

## B-7 — Speech recognition: PARTLY RESOLVED 2026-11-16 (local recognition works; timing accuracy and alignment remain)
- **Resolved:** the owner authorised a local model download (up to 5 GB). Recognition runs locally with faster-whisper and `ivrit-ai/whisper-large-v3-turbo-ct2` (1.62 GB, Apache-2.0 by its model card): `docs/INTEGRATIONS.md`, `docs/evidence/speech-proof.json`, `docs/evidence/real-media-check.json`.
- **Still open:** Hebrew word-boundary accuracy against SPEC Appendix C (median 80 ms, p95 200 ms) is unmeasured because no reference timings exist here; word timing for typed transcripts is done through recognition (not a dedicated aligner) and filler candidates are rule-based, both checked only on clean read speech; conversational, noisy, English or mixed-language speech was not checked; GPU speed is unmeasured.
- **Needed to go further:** a few recordings with hand-checked word times (or the owner's judgement of karaoke captions on their own clips), and a run on the GPU laptop.

## B-8 — Voice: PARTLY RESOLVED 2026-11-16 (local narration works; nobody has listened to it)
- **Resolved:** the owner authorised a local voice model (up to 5 GB). Narration runs locally with Chatterbox Multilingual (MIT by its model card, 3.21 GB) plus a Hebrew vowel-pointing model (Phonikud, MIT by its model card, 0.31 GB): `docs/INTEGRATIONS.md`, `docs/evidence/voice-proof.json`. Used 3.52 GB of the 5 GB allowed.
- **Update 2026-11-16:** the owner listened to `docs/demo/narration-sample-he.m4a` (three sentences) and said the Hebrew sounds fine. One listener, three sentences; longer texts, numbers, names and a reference voice have not been heard by anyone.
- **Still open:** pronunciation beyond that sample. Speed is unmeasured on a GPU; on this CPU a sentence takes about 40 s.
- **Reference voice (cloning):** the rules are built (owner only, consent recorded) and one take was made from a synthetic reference. Whether the result resembles a real speaker was not assessed. The editor form requires a named speaker and a ticked statement. Using a real person's voice stays the owner's decision each time.
- **Not built:** voice list with previews, pronunciation dictionary, dubbing. (Script narration sentence by sentence is built.)

## B-9 — CLOSED AS A DECISION 2026-11-16: the external agent is the Director
The owner chose the external-agent route: any MCP client plans and edits through the tools; the editor does not embed a language model. Prompt-to-Draft and Long-to-Shorts by meaning are therefore done by that agent, not by a built-in feature. Reopen only on request (it would need a provider credential and a spending limit).
