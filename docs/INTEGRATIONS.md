# Integrations

What each external system needs, and what has actually been tested. "Contract-tested" means our adapter was exercised against the real service.

## ComfyUI (optional workflow provider — Amendment A1, ADR-0007)

| Item | Value |
|---|---|
| Status | Adapter implemented; **live-tested on CPU with a model-free graph only** |
| Tested version | ComfyUI 0.45.0, commit `eee59185ff4f43ae2d9ad122b245619d27d9daad`, PyTorch 2.15.0, Python 3.13, device `cpu` |
| API used | `GET /system_stats`, `GET /object_info`, `POST /prompt`, `GET /history[/id]`, `GET /queue`, `POST /queue` (delete), `POST /interrupt`, `GET /view` |
| Configuration | `PF_COMFYUI_URL=http://127.0.0.1:8188`. Non-loopback hosts are refused unless `PF_COMFYUI_ALLOW_REMOTE=1` (media would leave the machine). `PF_PROFILE=commercial` (default) or `research` selects licence eligibility |
| Licence | ComfyUI core is GPL-3.0. PULSEFRAME does not bundle or redistribute it; the operator installs and runs it. Custom nodes and model weights carry their own terms and are reviewed per capability |
| Data sent | Only the resolved graph of a reviewed capability. No project document, no credentials. Media staging is not implemented, so no user media is sent yet |
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
PF_COMFYUI_URL=http://127.0.0.1:8188 pnpm proof:g0
```

### Decisions taken for the Freefield material
- **Adopted:** optional provider boundary, reviewed-import-as-draft, separate qualification dimensions, separate resource quantities, request-id reconciliation.
- **Not adopted:** Freefield's server/gateway/web shell, its catalog as an install list, its "ready" flag, the Comfy SDK (direct API is enough for now).
- **Nothing copied:** no Freefield code, manifests or workflows are in this repository. If any are reused later, its MIT notice and each workflow's origin must be recorded here first.

### Workflow candidates (from the addendum §3) — none qualified
All rows: source-reviewed by the addendum only; **not** schema-imported, executed, quality-reviewed, Hebrew-qualified or hardware-qualified by this project.

| Candidate | Sub-milestone | Blocking facts recorded now |
|---|---|---|
| BiRefNet image matte | G1 (first media workflow candidate) | Needs GPU or a CPU-feasibility measurement; licence evidence per original publisher; alpha output handling (FF-15) |
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
