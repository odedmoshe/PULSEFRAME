# Blockers

Each entry: what is blocked, how to reproduce, impact, proposed way forward. Work that does not depend on an entry continues.

## B-1 — No GPU and no default WebGPU adapter in the development environment
- **Reproduce:** `pnpm probe` → `browserDefault.webgpu.adapter` is `null`; `nvidia-smi` is absent.
- **Impact:** a WebGPU compositor (needed from Phase 7 for effects) and the Appendix C2 preview/export performance targets cannot be developed against or measured on real hardware here. All current numbers are for a 4-vCPU software profile.
- **Update 2026-11-16:** the owner named the reference machine: their laptop with an NVIDIA GeForce RTX 3050 Laptop GPU (4 GB). The editor has since been installed and opened there (Windows 11, Node 22.17). `pnpm probe` there shows only a software renderer because it uses a headless browser; the page `/gpu.html`, opened in the owner's own Chrome, is what reports the real adapter. First result (`docs/evidence/owner-machine-gpu-check-2026-11-16.json`): WebGPU works in the owner's Chrome with a real adapter, but that adapter is the integrated Intel UHD graphics; the RTX 3050 was not used. The owner then set Chrome to "high performance" in Windows; the browser page still reported Intel. `pnpm probe:gpu` showed that the render worker can reach the RTX 3050 (a window off-screen with the high-performance flag, or the installed Chrome headless), and the first GPU effects are built and verified on the software adapter here (`docs/evidence/gpu-proof.json`). They have not run on the laptop yet. 4 GB of video memory bounds which model workflows can be qualified there.
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

- **Update 2026-11-16:** a second descriptor exists (`comfy.image.upscale-4x`, Real-ESRGAN, 67 MB) and has never been run. Two things are the owner's: (1) permission to download that file here for one CPU functional trial (the earlier 1 GB trial grant was for BiRefNet and is spent; the speech and voice grants do not cover it); (2) confirmation of its licence against the original publisher (the mirror says BSD-3-Clause; the publisher's repository could not be read from this environment). Depth (for parallax) and frame interpolation need custom node packs, which the product never installs by itself; nothing was built for them.

- **Update 2026-11-17 (owner, in the session):** "מאשר לך להוריד כל מה שנחוץ לך (מודלים וכו') עד ל-30gb, מאשר גם Real-ESRGAN" — downloads of whatever models are needed, up to 30 GB in total, Real-ESRGAN included. Conditions kept: each model's licence is checked against its original publisher before download (non-commercial weights are not used in the default profile); downloads are recorded with size and digest; nothing is installed into ComfyUI automatically for users of the product. Practical limit here: this container's writable disk has about 8 GB free (speech and ComfyUI use about 20 GB), so the downloads made here stay well under 30 GB.

- **Grant use, 2026-11-17 (licences checked at the publisher first; `docs/evidence/ai-wave-pins.json`):** Real-ESRGAN x4plus (67,040,989 B; sha256 identical to the digest pinned from the mirror, so the publisher's file and the mirror's are the same bytes) and realesr-general-x4v3 (4,885,111 B; md5 equals the publisher's), both BSD-3-Clause at the publisher, placed in this machine's ComfyUI models folder; the DeepFilterNet3 model (7,983,136 B, MIT or Apache-2.0). Total so far 0.08 GB of the 30 GB. Residual risk recorded for the owner: the Real-ESRGAN training data includes DIV2K, which its publisher labels academic-research-only (the same footing on which BiRefNet was accepted: weights licence checked, training-data terms not).
- **Not installed:** the `deep-filter` engine binary (36,417,296 B, sha256 70775e25…f7da) was downloaded from the publisher's release but **not run**: running a downloaded executable in this container was refused by the session's safety check, so it was deleted unexecuted. The AI voice-cleanup tool therefore reports "engine not configured" here. To enable it, the owner installs that engine (the product verifies the digest) on the laptop, or approves running it here.

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
