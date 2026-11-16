# Integrations

What each external system needs, and what has actually been tested. "Contract-tested" means our adapter was exercised against the real service.

## ComfyUI (optional workflow provider — Amendment A1, ADR-0007)

| Item | Value |
|---|---|
| Status | Adapter implemented; live-tested on CPU with two model-free workflows and **one model workflow as a bounded functional trial** (BiRefNet image matting) |
| Tested version | ComfyUI 0.45.0, commit `eee59185ff4f43ae2d9ad122b245619d27d9daad`, PyTorch 2.15.0, Python 3.13, device `cpu` |
| API used | `GET /system_stats`, `GET /object_info`, `POST /prompt`, `GET /history[/id]`, `GET /queue`, `POST /queue` (delete), `POST /interrupt`, `GET /view` |
| Configuration | `PF_COMFYUI_URL=http://127.0.0.1:8188`. Non-loopback hosts are refused unless `PF_COMFYUI_ALLOW_REMOTE=1` (media would leave the machine). `PF_PROFILE=commercial` (default) or `research` selects licence eligibility |
| Licence | ComfyUI core is GPL-3.0. PULSEFRAME does not bundle or redistribute it; the operator installs and runs it. Custom nodes and model weights carry their own terms and are reviewed per capability |
| Data sent | The resolved graph of a reviewed capability plus the specific source assets it names, streamed under content-addressed names. No project document, no credentials. Only still-image inputs are supported; video/audio range staging is not built |
| Cost | Local execution: no provider fee; hardware, power and downloads still cost. No cost estimates are produced yet |
| Cancellation | Queued job: removed from the provider queue (tested). Running job: ComfyUI's interrupt is global — safe only for a single-user worker; needs a worker lease before multi-user use |
| Reconciliation | Every submission carries a Studio request id (`extra_data.pulseframe_request`), stored before dispatch. Lost responses are matched by that id; if nothing matches the job becomes `submission-unknown` and is not retried |

How to run it for development (not committed; ~4 GB with PyTorch):

```bash
git clone https://github.com/comfyanonymous/ComfyUI .artifacts/comfyui
```
```bash
cd .artifacts/comfyui && python3 -m venv .venv && .venv/bin/pip install torch torchvision torchaudio && .venv/bin/pip install -r requirements.txt
```
```bash
.venv/bin/python main.py --cpu --listen 127.0.0.1 --port 8188 --disable-auto-launch
```
```bash
PF_COMFYUI_URL=http://127.0.0.1:8188 PF_COMFYUI_MODELS_DIR=.artifacts/comfyui/models pnpm proof:g0
```
```bash
PF_COMFYUI_URL=http://127.0.0.1:8188 PF_COMFYUI_MODELS_DIR=.artifacts/comfyui/models pnpm trial:birefnet
```
Behind an HTTPS proxy add `NODE_USE_ENV_PROXY=1` to the last command (Node's `fetch` ignores `HTTPS_PROXY` otherwise).

### Model files (FF-05, gate FFG-04) — implemented for a local provider
`PF_COMFYUI_MODELS_DIR` points at the local ComfyUI `models` directory. A model is ready only when the file at its pinned path has the reviewed byte size **and** SHA-256
(`apps/server/src/models.ts`, `models.test.ts`). Downloads are an explicit owner action (`POST …/capabilities/{id}/models/download` with `confirmBytes` equal to the exact missing
bytes; agent credentials are refused; not exposed over MCP), resumable, restricted to `PF_MODEL_HOSTS` (default `huggingface.co,.hf.co`) including redirect targets, and verified before the file is moved into place.
Not built: shared-dependency accounting across capabilities, uninstall, disk-space/readiness report, remote-worker model management.

### Experimental capabilities
Structural, dependency, licence and egress blockers always stop execution. Open *review* dimensions (quality, Hebrew) do not stop a run — otherwise nothing could be evaluated —
but the capability is listed `experimental`, and every job recipe carries `experimental: true` with the open reviews.

### Bounded model trial — BiRefNet image matting on CPU (owner-authorised, 2026-11-14)
Evidence: `docs/evidence/g1-birefnet-cpu-trial.json` (13/13 checks), output `docs/evidence/g1-birefnet-cutout-synthetic.png`.

| Item | Result |
|---|---|
| Limits | ≤ 1 GB download, ≤ 10 min inference. Used: 444,473,596 bytes (one file), ~30 s of inference including model load |
| Model | `background_removal/birefnet.safetensors`, SHA-256 `9ab37426…56a154`, from `Comfy-Org/BiRefNet@884af709`; byte-identical to `ZhengPeng7/BiRefNet` `model.safetensors`; not gated |
| Licence evidence | Original publisher's model card is tagged `license:mit`. Metadata-level check only; training-data terms not reviewed; pending owner/legal confirmation |
| Runtime | ComfyUI 0.45.0 core nodes `LoadBackgroundRemovalModel` + `RemoveBackground` (no custom node), PyTorch 2.15.0, device `cpu`, 4 vCPU |
| Download | 29 s wall through the environment proxy (network-dependent, single sample) |
| Functional result | RGBA cutout + matte, both source-sized, digested; matte IoU 0.9997 against the known shape on **one synthetic image** (a shaded disc on a gradient) |
| In the product | Cutout imported as a derived RGBA asset with source lineage, attached via `add_clip`, alpha honoured by the shared compositor (pixel-checked) |
| Not established | Anything about hair, fine edges, motion blur, occlusion, real photos, video, GPU memory, GPU speed, or quality. Qualification status: executed = pass for this CPU profile; quality-reviewed = not assessed; hardware-qualified = this CPU profile only |

### Decisions taken for the Freefield material
- **Adopted:** optional provider boundary, reviewed-import-as-draft, separate qualification dimensions, separate resource quantities, request-id reconciliation.
- **Not adopted:** Freefield's server/gateway/web shell, its catalog as an install list, its "ready" flag, the Comfy SDK (direct API is enough for now).
- **Nothing copied:** no Freefield code, manifests or workflows are in this repository. If any are reused later, its MIT notice and each workflow's origin must be recorded here first.

### Workflow candidates (from the addendum §3) — none qualified
Unless a row says otherwise: source-reviewed by the addendum only; **not** schema-imported, executed, quality-reviewed, Hebrew-qualified or hardware-qualified by this project.

| Candidate | Sub-milestone | Blocking facts recorded now |
|---|---|---|
| BiRefNet image matte | G1 | **Implemented as `comfy.image.remove-background` 0.1.0, experimental**: CPU functional trial passed; quality review and GPU qualification open |
| MoGe-2 depth/normals | G1 | Must return numeric geometry, not only an RGB visualisation |
| SeedVR2 image upscale | G1 | Image and video qualified separately |
| BiRefNet / SeedVR2 video, FILM | G3 | Reported peak VRAM 6.7–27.7 GB on L40S/H100 (repository-reported, not reproduced); FILM upstream archived |
| LTX in/outpainting (Generative Reframe) | G2 | Reported 40 GB of model files, 44 GB peak on H100 (not reproduced) |
| Qwen Image Edit relight, FLUX + LTX mixed media | G2 | Image relight first |
| Wan Animate 2 motion transfer | G3 | Reported 24.9 GB files / 37 GB peak (not reproduced) |
| SCAIL-2 recast | G3 | Selected graph processes only the **first 81 frames**; longer inputs must be rejected, not truncated |
| MiniMax Music 3, Stable Audio 3 | G3 | Community licences with commercial conditions; original licence governs over repack tags |
| LTX DubIt | conditional | "Any language" is not a Hebrew qualification |
| Camera Copy (Cameraman v2 LoRA) | conditional | Publisher marks it research-only: **excluded from the commercial profile** (enforced by `publicationBlockers`, unit-tested) |
| Reshoot / novel view, learned SDR→HDR, character LoRA training | conditional | Unresolved model terms / needs real HDR pipeline / unverified training workflow |

Model file size is a download figure. It is not runtime VRAM, and neither number is a hardware recommendation.

## Local speech recognition (optional — SPEC §16, B-7)
Without it everything else works; the Speech tab says recognition is not installed. Nothing here is downloaded or installed automatically.

**Engine.** A Python environment with `faster-whisper==1.2.1` (pulls CTranslate2 4.9.0); the server starts `apps/server/speech/pf_speech.py` in it per job with `python -I`.
```bash
python3 -m venv .artifacts/speech/venv && .artifacts/speech/venv/bin/pip install faster-whisper==1.2.1
PF_SPEECH_PYTHON=.artifacts/speech/venv/bin/python pnpm start
```
On Windows the interpreter is `.artifacts\speech\venv\Scripts\python.exe`. Relative paths in `PF_SPEECH_PYTHON`, `PF_VOICE_PYTHON` and `PF_SPEECH_MODELS_DIR` are taken from the repository root. Settings: `PF_SPEECH_PYTHON` (interpreter; unset = not configured), `PF_SPEECH_MODELS_DIR` (default `<data dir>/speech-models`), `PF_SPEECH_DEVICE` (`auto` | `cpu` | `cuda`; auto uses a CUDA device when CTranslate2 sees one).
GPU use needs the NVIDIA cuBLAS and cuDNN libraries that CTranslate2 expects; **not tried** (no GPU here), so the steps for the owner's RTX 3050 laptop are unverified.

**Model.** One reviewed model: `asr.ivrit-turbo` = `ivrit-ai/whisper-large-v3-turbo-ct2@72ad623a`, five files, 1,621,665,181 bytes, each pinned by size and SHA-256 in `speech.ts`; Apache-2.0 by its model card (metadata-level check; training-data terms not reviewed). Fine-tuned for Hebrew; other languages unchecked.
Download is the owner's action in the Speech tab (or `POST /api/v1/projects/{id}/speech/models/{modelId}/download` with `confirmBytes` equal to the exact missing bytes from `GET /api/v1/speech`): agent credentials are refused, it is not an MCP tool, hosts are limited to `PF_MODEL_HOSTS`, files are verified before they are moved into place. Behind an HTTPS proxy start the server with `NODE_USE_ENV_PROXY=1`.

**Recognition.** `POST /api/v1/projects/{id}/assets/{assetId}/transcribe` (`language` default `he`, `overwrite`) or MCP `transcribe_asset` starts a job: ffmpeg writes 16 kHz mono on the asset's own clock, the worker recognises with word times (voice-activity filter on, no conditioning on earlier text), the server makes times obey the transcript rules by moving them only onto a neighbour or the end of the media, leaves out phrases that are repetition, and attaches the rest with `attach_transcript`. One recognition runs at a time. The worker process stays alive for `PF_SPEECH_KEEP_SECONDS` (default 120; 0 = a new process per job) after a job, so consecutive jobs do not load the model again; a loaded model holds roughly 2–4 GB of memory until then.

**Alignment and fillers.** `mode: "align"` on the same route keeps an existing typed or imported transcript's text and gives its words the heard times (phrases with estimated words become approximate). `POST /api/v1/projects/{id}/analysis/fillers` lists filler candidates by rule from any word-timed transcript.

**Evidence and limits.** `pnpm proof:speech` (26 checks) and `pnpm check:media <folder>`; see `docs/evidence/speech-proof.json`. Sample speech for the proof: the first ~14 MB of `google/fleurs` `data/he_il/audio/dev.tar.gz` plus `dev.tsv`, unpacked to `.artifacts/speech/fleurs` (CC BY 4.0; not committed).
Not established: accuracy beyond clean read sentences, word-timing accuracy, speed on a GPU. PyAV is bypassed on purpose: faster-whisper 1.2.1's own decoder fails with the PyAV version pip resolves today, so the worker passes samples directly.

## Local narration / text to speech (optional — SPEC §17, B-8)
Same shape as speech recognition: optional, nothing installed or downloaded automatically, an honest setup state in the Sound tab.

**Engine.** A separate Python environment (its pinned PyTorch differs from the recognition engine's needs):
```bash
python3 -m venv .artifacts/speech/tts-venv
.artifacts/speech/tts-venv/bin/pip install chatterbox-tts==0.1.7 phonikud-onnx==1.0.6 setuptools==80.9.0
PF_VOICE_PYTHON=.artifacts/speech/tts-venv/bin/python PF_SPEECH_PYTHON=.artifacts/speech/venv/bin/python pnpm start
```
`setuptools==80.9.0` is needed because the engine's watermarker imports `pkg_resources`; without it the engine cannot load, and the setup state says so. The environment is about 6 GB on Linux (PyTorch 2.6.0 with its CUDA libraries). `PF_VOICE_PYTHON` unset = the speech interpreter is tried.

**Model.** `tts.chatterbox-multilingual`: five files of `ResembleAI/chatterbox@5bb1f6ee` (3,207,031,585 bytes; MIT by its model card) and `Phonikud/phonikud-onnx@b806189f` `phonikud-1.0.int8.onnx` (307,844,158 bytes; MIT by its model card), each pinned by size and SHA-256. Licence checks are metadata-level; training-data terms were not reviewed. Download is the owner's action, exactly as for the recognition model.

**Narration.** `POST /api/v1/projects/{id}/narration` (`text` up to 300 characters, `language`, `seed`, optional `start`/`trackId`) or MCP `generate_narration`: a job speaks the text, the result is checked (has a length, is not silence), converted to 48 kHz mono WAV and imported as a generated audio asset whose provenance holds the text, the pointed text that was actually spoken, engine, model revisions, seed and the engine's watermark note. Same text, voice and seed reproduced the same bytes on this machine.
Hebrew: the voice model garbles unpointed Hebrew (a second model recovered 8 of 18 words), so unpointed Hebrew is vowel-pointed first (17 of 18). Text that already has points is spoken as written: that is the way to fix a misread word.

**Script.** `POST /api/v1/projects/{id}/narration/script` (`text` up to 6,000 characters, `start`, `gapFrames`) or MCP `narrate_script`: split into sentences, one job and clip per sentence, in order.

**Reference voice.** `referenceAssetId` + `consent: { speaker, confirmed: true }`: owner session only (agents get 403 `human_approval_required`), at least 5 s of sound, first 30 s used; the consent statement, who made it and when are stored in the asset's provenance. Available in the Sound tab (named speaker and ticked statement required) and over REST; never over MCP. Tried with a synthetic reference; likeness to a real speaker was not assessed.

**Evidence and limits.** `pnpm proof:voice` (23 checks), `docs/evidence/voice-proof.json`, sample `docs/demo/narration-sample-he.m4a`. Nobody has listened to the output. Not established: pronunciation, stress, naturalness, numbers and foreign words, other languages, GPU speed (CPU, single run: about 37 s for the first sentence including the model load, about 15 s for each following one while the worker stays alive).

## Running on the owner's GPU laptop (RTX 3050, 4 GB) — untested guidance
Nothing below has been run; it is the intended procedure, to be corrected by the first real run.
1. Install Node 22, pnpm, FFmpeg and Python 3.11–3.13; clone, `pnpm install && pnpm build`.
2. `pnpm probe` and send the output: it reports the browser's WebGPU adapter, codecs and encoders, which decides the GPU compositor route (B-1).
3. Recognition on the GPU: create the environment above, add `pip install nvidia-cublas-cu12 nvidia-cudnn-cu12`, set `PF_SPEECH_DEVICE=cuda`. The model in half precision is about 1.6 GB of video memory.
4. Narration on the GPU: the voice model needs roughly 3–4 GB in full precision, which may not fit beside anything else in 4 GB; `PF_SPEECH_DEVICE=cpu` remains the fallback.
5. `PF_SPEECH_PYTHON=… pnpm proof:speech` and `PF_VOICE_PYTHON=… pnpm proof:voice`, then send `docs/evidence/*.json`.

## MCP clients
Official TypeScript SDK client 2.4.0: tested (modern pinned and legacy default). No other host (desktop apps, IDEs) has been tested; setup snippets for them are not written yet.

## Not integrated (no adapter, no credentials requested)
Forced alignment (WhisperX), hosted voice providers (ElevenLabs), fal, Runway, Black Forest Labs, stock media, YouTube, TikTok, C2PA signing, LLM for the Director.
These remain exactly as described in SPEC §18/§25: candidates to verify when their phase starts.
