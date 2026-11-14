# PULSEFRAME Studio

Browser-based video studio with Hebrew-first authoring and full agent access (REST + MCP). **Status: Phase 0 of 14 complete — a working vertical proof, not a product.**
See [docs/PROGRESS.md](docs/PROGRESS.md) for exactly what works and [docs/CAPABILITIES.md](docs/CAPABILITIES.md) for tested limits.

## Requirements
Node ≥ 22.12, pnpm 10, FFmpeg/ffprobe with libx264 on `PATH`, and a Playwright Chromium (`pnpm exec playwright install chromium` on a normal machine).

## Run
```bash
pnpm install
```
```bash
pnpm build
```
```bash
pnpm start
```
Open http://127.0.0.1:8787. Agent tokens are written to `.data/tokens.json`; the MCP endpoint is `http://127.0.0.1:8787/mcp` (send `Authorization: Bearer <token>`).

## Verify
```bash
pnpm check
```
Runs type checking, unit/property tests, the web build and the end-to-end proof (import → edit → preview → export → MCP agent edit → live UI update).

Optional ComfyUI provider: [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md). Licences: [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
