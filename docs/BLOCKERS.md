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

## B-4 — No model-based ComfyUI workflow can be qualified here (Amendment A1 G0 second half, G1–G3)
- **Reproduce:** `GET /api/v1/capabilities` → provider device is `cpu`.
- **Impact:** "one qualified media workflow" (G0), and every G1–G3 workflow, needs model downloads and, realistically, a GPU. Quality, VRAM and hardware qualification cannot be produced in this environment. No model has been downloaded: that needs an explicit decision (size, licence, cost).
- **Proposed:** (a) the owner names a GPU machine or approved remote worker and a first workflow — BiRefNet image matte is the smallest candidate (0.44 GB of weights reported); or (b) authorise a CPU attempt of that single workflow here for functional (not performance) evidence. Until then, G0 continues with the parts that do not need a model: image/derived-asset support, attachment via operations, stale-result protection.

## B-5 — Preconditions inside the project (not external)
Stale-result protection (FFG-09) needs entity versions (Phase 1). Timeline attachment needs image/derived assets (Phase 2). Worker lease and budgets need Phase 5/10 work.

## B-6 — Model hosts are denied by the environment network policy
- **Reproduce:** `curl https://huggingface.co/api/models/ZhengPeng7/BiRefNet` → `CONNECT tunnel failed, response 403`; GitHub release downloads also 403.
- **Impact:** the authorised bounded trial (one small CPU workflow, ≤ 1 GB, ≤ 10 min) could not start: no model weights can be fetched. 0 bytes downloaded, 0 s of inference used.
  ComfyUI 0.45.0 already includes core `LoadBackgroundRemovalModel` and `RemoveBackground` nodes and a `models/background_removal` folder, so the workflow itself needs no custom node.
- **Unblocked by:** allowing `huggingface.co` (and the CDN host it redirects downloads to) in the environment's network settings, or placing a licence-reviewed
  BiRefNet weight file with a known SHA-256 in `.artifacts/comfyui/models/background_removal/`.
- **Meanwhile:** the source-staging path is built and tested with a model-free image workflow, so only the weights and the qualification run are missing.
