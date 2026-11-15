# PULSEFRAME Studio

A browser-based video editor with a Hebrew-first interface and full agent access (REST and MCP). One document, one command path: the editor, the REST API and MCP tools all make the same recorded, undoable edits, and preview, stills and export are drawn by the same compositor.

**Status: a working editor on a CPU-only development profile, not a finished product.** Every phase so far is partial. What is built, what was measured, and what is missing are listed without rounding up in:

- [docs/PROGRESS.md](docs/PROGRESS.md) — state per phase, what was verified, open scope, next step
- [docs/CAPABILITIES.md](docs/CAPABILITIES.md) — each capability with its evidence and limits
- [docs/BLOCKERS.md](docs/BLOCKERS.md) — what needs a decision, hardware or credentials (GPU, speech recognition, voice, language model, generative providers)
- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) — the spec mapped to status

## What works today (see the linked evidence for limits)
- Import, timeline editing with exact rational time, keyframes, undo/redo per actor, live multi-client updates; multi-select, markers, copy/paste
- Clip speed (0.1–8×, sound pitch follows speed), freeze frame, reverse playback (picture and sound), stepped speed ramps
- Source viewer with in/out marks; insert, overwrite, slip, ripple insert, close gaps, detach picture from sound; marquee selection; J/L shuttle
- Tracks: add, rename, lock, hide, mute; project frame size and background can be changed; library files can be renamed and removed
- Media input: MP4, MOV, Matroska, WebM, MPEG-TS, AVI; common sound formats; files with shifted timestamps, non-square pixels or unusual pixel formats are handled or converted at import (tested with synthetic files only — see `docs/evidence/input-matrix.json`)
- Export: MP4 (H.264 + AAC), WebM, WAV, PNG; frame ranges, scaling, cancel/retry; browser-side WebM export
- Titles and captions with Hebrew and mixed-direction text, five bundled OFL fonts, SRT/VTT import, SRT/VTT/ASS export
- Transcript-based editing (typed or imported transcripts; no speech recognition is built in)
- 12 effects, 17 blend modes, masks, 12 transitions on a Canvas2D compositor (no GPU effects)
- Sound: gain, pan, fades, volume automation, speech ducking, loudness measurement and normalisation, 7 synthesised sound effects
- Model-free analysis: silence, scene cuts, beats
- Linked output formats (9:16, 1:1, 4:5, 16:9) with per-format overrides (position, title and caption wording), safe-area guides, preflight
- Rule-based recipes (beat montage, social pack, tidy speech)
- Agents: MCP tools generated from the same operation registry, plus resources (guide, operation schemas, per-project views) and playbook prompts; permission modes (observe / propose / edit), pause, proposals with review, change notifications, per-grant request and export limits
- Optional local ComfyUI provider path (one experimental matting workflow; nothing is qualified on a GPU)

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
Open the **"Editor (owner)" link printed at start-up** (`http://127.0.0.1:8787/?key=…`). The key proves you are the owner; the bare address without a session only shows a message. Agent tokens are written to `.data/tokens.json`; the MCP endpoint is `http://127.0.0.1:8787/mcp` (send `Authorization: Bearer <token>`). Other pages: `/lab.html` (every effect, blend and transition as drawn by the compositor) and `/selftest.html` (browser audio self-test).

## Verify
```bash
pnpm check
```
Type checking, unit/property tests, the web build, the licence-notice check and the Phase 0 end-to-end proof. The per-phase proofs (`pnpm proof:phase3` … `pnpm proof:phase12`), the conformance runs (`pnpm conformance:inputs`, `:seek`, `:parity`, `:start-offset`, `:long`) and how to read their evidence are in [docs/OPERATIONS.md](docs/OPERATIONS.md); the full list with expected check counts is at the end of [docs/PROGRESS.md](docs/PROGRESS.md).

Back up a running installation with `pnpm backup <destination>`, or set `PF_BACKUP_DIR` for automatic backups with dated snapshots (see `docs/OPERATIONS.md`).

Operations (configuration, data, backup): [docs/OPERATIONS.md](docs/OPERATIONS.md). Optional ComfyUI provider: [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md). Licences: [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
