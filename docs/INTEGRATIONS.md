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

## MCP clients
Official TypeScript SDK client 2.4.0: tested (modern pinned and legacy default). No other host (desktop apps, IDEs) has been tested; setup snippets for them are not written yet.

## Not integrated (no adapter, no credentials requested)
ASR/alignment (ivrit.ai faster-whisper, WhisperX), ElevenLabs, fal, Runway, Black Forest Labs, stock media, YouTube, TikTok, C2PA signing, LLM for the Director.
These remain exactly as described in SPEC §18/§25: candidates to verify when their phase starts.
