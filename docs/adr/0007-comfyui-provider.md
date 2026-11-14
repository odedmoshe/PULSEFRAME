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
