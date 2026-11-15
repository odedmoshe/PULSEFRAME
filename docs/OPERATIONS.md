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
| `PF_MAX_STORAGE_BYTES` | `0` (off) | Ceiling for the whole data directory. At the ceiling, uploads, imports and exports are refused with `507 storage_quota_exceeded`; editing continues. Free space by deleting projects and running the storage clean-up. |
| `PF_SECURE_COOKIE` | unset (off) | `1` adds `Secure` to the owner session cookie; use behind a TLS-terminating proxy. |
| `PF_BACKUP_DIR` | unset (off) | Directory for automatic backups; must be outside the data directory (the server refuses to start otherwise). |
| `PF_BACKUP_EVERY_HOURS` | `24` | Hours between automatic backups when `PF_BACKUP_DIR` is set; `0` turns the schedule off ("Back up now" still works). |
| `PF_BACKUP_KEEP` | `14` | Dated database snapshots to retain (at least 1). |
| `PF_AGENT_RPM` | `0` (off) | Requests per minute allowed per agent credential, REST and MCP together. Over the limit the server answers `429 rate_limited` with `Retry-After`. Ten seconds' worth may be sent as a burst. The owner's browser session is never limited. Off by default: fast local scripts are normal for this tool. |
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
Running server (recommended; tested by `apps/server/src/backup.test.ts`):
```bash
pnpm backup /path/to/backup/pulseframe-data
```
It takes a consistent snapshot of the database with SQLite's online backup (including writes still in the WAL), then copies media and finished exports and `tokens.json`. Run it again into the same place and only new files are copied. The copy contains credentials; keep it private. It reads `PF_DATA_DIR` like the server does.

The same by hand, if you prefer your own tools (this variant is **not** covered by a test; the `sqlite3` command-line tool is not part of this project):
```bash
sqlite3 .data/pulseframe.sqlite ".backup '/path/to/backup/pulseframe.sqlite'"
```
```bash
rsync -a .data/blobs .data/out .data/tokens.json /path/to/backup/
```
Automatic (tested by `apps/server/src/backup.test.ts`): start the server with `PF_BACKUP_DIR=/path/to/backup`. While the server runs it repeats the backup above every `PF_BACKUP_EVERY_HOURS` hours and also keeps `snapshots/pulseframe-<UTC time>.sqlite`, one database per run, deleting all but the newest `PF_BACKUP_KEEP`. The first run is due one interval after the newest existing snapshot (at once if there is none). Media and exports in the backup are never deleted by this, so every retained snapshot finds its files; the backup therefore only grows, and removing media nobody needs from it is manual. A failed run is logged, shown in the editor (Projects → Automatic backup) and in `GET /api/v1/backup`, and tried again at the next interval. The owner can start a run from that panel or with `POST /api/v1/backup`. It only runs while the server is running; nothing checks that the destination is a different disk.
To go back to an older state: stop the server, copy the chosen snapshot over `pulseframe.sqlite` in the backup directory, and restore as below.

Restore: stop the server, put the files back under `PF_DATA_DIR` (or point `PF_DATA_DIR` at the copy), start the server. Blobs are content-addressed and immutable, so an incremental copy of `blobs/` is safe.

### Moving or backing up one project
The editor's Deliver tab has "Download archive" and "Import archive as a new project" (REST: `GET /api/v1/projects/{id}/archive`, `POST /api/v1/projects/import`). An archive is one tar file with the project and all its media; every file is verified on import. Edit history, exports and credentials are not included.

### Deleting a project and reclaiming space (owner only)
In the editor: the Projects button in the header (delete asks you to type the project name; storage clean-up shows what would be removed first). The same over REST:
Deleting is permanent; download the archive first if you may want it back.
These routes need the owner session (the cookie obtained with the owner link), not an agent token. From a terminal:
```bash
curl -s -c /tmp/pf.cookie -H "origin: http://127.0.0.1:8787" -H "x-pf-owner-key: <owner key from tokens.json>" http://127.0.0.1:8787/api/v1/session
```
```bash
curl -s -b /tmp/pf.cookie -H "origin: http://127.0.0.1:8787" http://127.0.0.1:8787/api/v1/storage
```
- `POST /api/v1/projects/{id}/delete` with `{"confirmName": "<exact project name>"}`
- `GET /api/v1/storage` to see what is in use and what nothing refers to
- `POST /api/v1/storage/gc` with `{}` for a dry run, `{"apply": true}` to remove unreferenced media

Deleting a clip never deletes its media. Not built: an editor control for deleting media, verification of a backup after it is written, off-machine copies.

**The whole-data-directory copy above has not been exercised by an automated test.** Tested instead: restoring a single project from its archive onto a second server with an empty data directory (`pnpm soak`), and reopening a data directory after a restart, replaying a project from its operation log, and recovering interrupted export jobs (`store.test.ts`, Phase 0 and Phase 4 proofs).

## Browser security headers
The built server (`pnpm start`) sends a strict content security policy with its pages and `nosniff`, `no-referrer` and a frame ban with every response; API and stored-file responses are sandboxed. Consequences for operators:
- Put nothing in front of the server that injects inline scripts or styles into pages (some proxies and "optimisers" do); it will be blocked.
- The Vite dev server (`pnpm dev`, port 5173) does not apply the policy. Check policy-sensitive changes against `pnpm build && pnpm start`.
- Behind a TLS-terminating proxy, start the server with `PF_SECURE_COOKIE=1` so the owner session cookie carries `Secure`, and add the public `https://…` origin to `PF_EXTRA_ORIGINS` (the session is only issued to listed origins). Tested for the attribute and the origin rule only (`apps/server/src/session.test.ts`); no proxy deployment has been run.

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
| `pnpm proof:speed` | clip speed and freeze frame on exported frames and sound |
| `pnpm conformance:inputs` | 29 synthetic media shapes on the server export, the browser export and the editor preview, against references built from each input (about ten minutes) |
| `pnpm conformance:start-offset` | files whose picture or sound does not start at time 0 |
| `pnpm conformance:images` | 24 ways of storing one still picture: rendered still and preview |
| `pnpm conformance:projects` | 15 project frame rates and sizes: exported frames and sound |
| `pnpm conformance:render-fuzz` | random editing sessions on a live server; every resulting project must render (about ten minutes) |
| `pnpm conformance:long` | one synthetic 20-minute file: ingest, background analysis, long timeline, seek to the end (about 90 s) |
| `pnpm proof:editor-interactions` | canvas overrides, beat snapping, manual beat edits, meter, batch export, multi-select, markers, volume keys, archive from the editor |
| `pnpm proof:owner-ui` | agent access panel, project manager, crossfade control, loop playback |
| `pnpm audit:a11y` | heuristic accessibility audit (he + en) |
| `pnpm soak` | 3,000-transaction session, replay, restart |
| `pnpm conformance:seek`, `pnpm conformance:avsync` | seek accuracy (1,000 random seeks on seven codec/rate configurations, about 4.5 minutes), 10-minute A/V sync |
| `pnpm proof:g0`, `pnpm trial:birefnet` | provider path; need a running ComfyUI (exit 2 = not available) |

Reading the evidence: every report states its scope and machine. They were produced on one CPU-only container; a timing in one report is one sample on that machine, not a performance claim.

Visual baselines in `docs/evidence/baselines/` change whenever the interface changes on purpose; refresh with `PF_UPDATE_BASELINES=1 pnpm proof:phase3` after looking at the new screenshots.
