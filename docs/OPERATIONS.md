# Operations

This describes the one supported deployment profile: a single user, one machine, local SQLite (ADR-0001). Nothing here has been tested as a multi-user or internet-facing service.

## Configuration (environment variables)
| Variable | Default | Meaning |
|---|---|---|
| `PF_HOST` | `127.0.0.1` | Bind address. Only loopback addresses are accepted. |
| `PF_PORT` | `8787` | HTTP port. |
| `PF_DATA_DIR` | `./.data` | Database, media, exports, tokens. |
| `PF_WEB_DIST` | `apps/web/dist` | Built web bundle. The headless renderer loads the render page from here, so **stills and exports reflect the last `pnpm build`**. |
| `PF_EXTRA_ORIGINS` | none | Additional allowed browser origins (comma-separated). |
| `PF_MAX_UPLOAD_BYTES` | see `config.ts` | Largest accepted upload. |
| `PF_COMFYUI_URL`, `PF_COMFYUI_ALLOW_REMOTE`, `PF_COMFYUI_MODELS_DIR`, `PF_MODEL_HOSTS` | unset | Optional provider, see INTEGRATIONS.md. |
| `NODE_USE_ENV_PROXY=1` | unset | Needed only behind an HTTPS proxy, for model downloads. |

## Data directory
```
.data/
  pulseframe.sqlite (+ -wal, -shm)   projects, operation log, entity versions, jobs, grants, proposals
  blobs/                             media by content hash (original uploads are never modified)
  out/                               finished exports
  tmp/                               scratch; safe to delete while the server is stopped
  tokens.json                        bearer tokens for the built-in agent and observer credentials
```
`tokens.json` holds the built-in agent and observer tokens and the owner launch key (the secret in the owner link printed at start-up; anyone who can read this file can act as the owner). It and the database hold credentials (grant tokens are stored hashed). Keep the directory private (it is created with mode 0700).

## Backup and restore
The database runs in WAL mode, so copying the `.sqlite` file alone while the server runs can miss recent writes.

Stopped server (simplest, always consistent):
```bash
cp -a .data /path/to/backup/pulseframe-data-$(date +%Y%m%d)
```
Running server (consistent snapshot of the database, then the media):
```bash
sqlite3 .data/pulseframe.sqlite ".backup '/path/to/backup/pulseframe.sqlite'"
```
```bash
rsync -a .data/blobs .data/out .data/tokens.json /path/to/backup/
```
Restore: stop the server, put the files back under `PF_DATA_DIR`, start the server. Blobs are content-addressed and immutable, so an incremental copy of `blobs/` is safe.

Not built: automatic backups, garbage collection of unreferenced media, project archive export/import, disk quota. Deleting a clip never deletes its media.

**The restore procedure above has not been exercised by an automated test.** The parts that are tested: reopening a data directory after a restart, replaying a project from its operation log, and recovering interrupted export jobs (`store.test.ts`, Phase 0 and Phase 4 proofs).

## Verification commands
All proofs start their own server on their own port and data directory under `.artifacts/`, and write a JSON report to `docs/evidence/`. Run `pnpm build` first.

| Command | Covers |
|---|---|
| `pnpm check` | typecheck, unit tests, build, licence notices, Phase 0 proof |
| `pnpm proof:phase3` | editor interaction, visual baselines |
| `pnpm proof:phase4`, `pnpm proof:browser-export`, `pnpm conformance:parity` | export, browser export, preview/export parity |
| `pnpm proof:phase5` | agent permissions, pause, proposals |
| `pnpm proof:phase6` | captions, transcripts, silence, fonts |
| `pnpm proof:phase7` | effects, blends, masks, transitions, Lab |
| `pnpm proof:phase8` | audio plan, mixer, ducking, loudness, sound effects |
| `pnpm proof:phase9` | scene cuts and beats on synthetic corpora |
| `pnpm proof:phase11` | recipes |
| `pnpm proof:phase12` | linked formats, preflight |
| `pnpm proof:editor-interactions` | canvas overrides, beat snapping, manual beat edits, meter, batch export from the editor |
| `pnpm audit:a11y` | heuristic accessibility audit (he + en) |
| `pnpm soak` | 3,000-transaction session, replay, restart |
| `pnpm conformance:seek`, `pnpm conformance:avsync` | seek accuracy, 10-minute A/V sync |
| `pnpm proof:g0`, `pnpm trial:birefnet` | provider path; need a running ComfyUI (exit 2 = not available) |

Reading the evidence: every report states its scope and machine. They were produced on one CPU-only container; a timing in one report is one sample on that machine, not a performance claim.

Visual baselines in `docs/evidence/baselines/` change whenever the interface changes on purpose; refresh with `PF_UPDATE_BASELINES=1 pnpm proof:phase3` after looking at the new screenshots.
