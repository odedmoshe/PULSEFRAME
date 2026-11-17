# ADR-0007: ComfyUI as an optional workflow provider (Amendment A1)

Status: accepted (2026-11-14); G0 first slice implemented, see docs/PROGRESS.md

## Decision
- ComfyUI is reached only through `packages/providers`, behind a provider adapter contract (FF-02). It is one provider among future ones.
- PULSEFRAME talks to ComfyUI's own HTTP API (`POST /prompt`, `GET /history/{id}`, `GET /view`, `GET /object_info`, `GET /system_stats`, `POST /interrupt`, `POST /queue`).
  We do not adopt Freefield's server, gateway or web shell, and we do not use the Comfy SDK for now: the direct API is small, and one less dependency to qualify.
- A capability is a **reviewed descriptor** stored in our registry: pinned API-format graph + digest, typed inputs bound to graph fields with bounds, typed outputs,
  model artifacts, required node classes, and seven independent qualification flags (FF-04). Nothing is "ready" because its JSON parses.
- Agents and the UI can only run a published capability by id with validated parameters. There is no route that accepts a raw graph for execution (FF-01).
- Importing a graph is pure parsing (FF-03): no network, no execution, no installs. The result is a draft with explicit blocking reasons.
- Execution is a durable PULSEFRAME job. Outputs are downloaded, digested and probed before the job can succeed; results enter the project only through operations.
- ComfyUI is **not bundled or redistributed** (GPL-3.0 core; nodes and weights carry their own terms). The user or operator runs it; we store its URL.
  A separate process is an architecture boundary, not a licence opinion — see docs/INTEGRATIONS.md.

## Additions after G0
- **Runnable vs published.** Structural, dependency, licence and egress blockers always stop execution. Dimensions that can only be earned from outputs
  (executed, hardware-qualified, quality-reviewed, Hebrew-qualified) do not, but while a *review* dimension is open the capability is `experimental` and every recipe says so.
- **Media inputs** are project asset ids only; the server stages the bytes itself under content-addressed names. A caller can never pass a path or URL.
- **Results** are imported as derived assets with lineage, then attached with ordinary operations, or kept as a proposal when recorded entity versions changed (stale-result protection).
- **Model files** (local provider): ready = exact size + SHA-256; downloads are explicit owner actions bound to the exact byte count, never available to agent credentials or over MCP.

## Consequences / open items
- Worker lease, prewarm, affinity (FF-07), model packs and digests (FF-05), stale-result protection and budget reservation depend on Phase 1/5/10 work.
- Attaching generated media to the timeline needs image/derived-asset support (Phase 2).
- No GPU exists in the development environment, so only CPU, model-free execution can be verified here (docs/BLOCKERS.md B-4).

## Amendment (2026-11-17, with ADR-0017)
- **Local provider.** A capability descriptor is a union on `provider`: `'comfyui'` (a reviewed graph, as above) or `'local'` (a PULSEFRAME-owned tool run on this machine: a Python worker, an operator-installed engine binary, or FFmpeg). A local tool carries a `codeDigest`, the SHA-256 of its reviewed code files with CRLF read as LF; a mismatch blocks it exactly as a changed `graphDigest` blocks a graph. Engines are installed by the operator and only verified by the product (digest in `verifiedBinaries`); the product never downloads or installs an executable.
- **Video through frame jobs.** A ComfyUI capability that works on video never receives a raw file path: the server cuts an exact half-open frame range into numbered chunks (PNG-in-MKV, rgb24, counted), stages each under a content-named file in ComfyUI's input folder, collects the frames from `PreviewImage` outputs (streamed to disk, hashed, counted), and assembles and validates the result itself. Staged chunks are deleted afterwards when ComfyUI runs on this machine.
- **One compute lane** per server: speech, narration, local tools and each ComfyUI chunk hold it one at a time; a running server export pauses new chunks.
- **`POST /free`** (unload models) before speech or tool jobs on a GPU, so two resident models never share a 4 GB card: wave 2, on the owner's laptop.
