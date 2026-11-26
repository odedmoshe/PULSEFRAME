# ADR-0039: Picture models — a local model proposes eye points («הציעו עיניים»)

Status: **Accepted (lead, 2026-11-26); built by three workers on the lead's pre-pass, integrated and merged (a7c0692).** The lead
read `apps/server/tools/pf_picture.py` line by line and pinned its SHA-256 (4bb15a50…6e25, commit e9d7a90): one JSON line in on
stdin, one out on stdout, the model file opened read-only after its size and digest are checked, no subprocess, no file written,
errors as codes only (the Python-level network disarm does not cover onnxruntime's native code). `proof:picmodels` 16/16 and
`proof:growing` 22/22 on the integration branch, one run each, with a LABELLED TEST ADAPTER: no real model has run and nobody has
looked at a proposal. After ADR-0036 the routes read `actsAsOwner` (open mode: an editing agent may ask too); there is no MCP tool
for eye proposals yet (what it would take is listed below). The rule that eye marks are never stored is kept as built.

The integrator's text (amendment wording and the laptop gates PM0–PM12) follows.

Pre-pass, 2026-11-26. For the lead to paste (after reading) into `docs/adr/0007-comfyui-provider.md` as a new amendment section.
There is no separate search ADR; the search precedent lives in `.artifacts/wave7/search-decisions.md:69` (§3a) and in
`apps/server/src/search/contract.ts` ("The query is never logged, stored, written to a file, put in a job, an event or an error").

## Amendment text (proposed)

```markdown
## Amendment (2026-11-26, wave 8 picmodels): an unstored answer to the owner's own session is not a provider result
- **The reading.** The durable-job rule above is about results that *enter* project state or assets: they are downloaded, validated
  and committed through operations in a durable job. A local model's answer that enters nothing — shown once to the owner's own
  session as a proposal and dropped when the dialog closes — is not such a result and is not made a job. Making it a job would store
  it: a job row records its input ("this picture was searched for faces") and must store its output to be fetched, and the `job`
  event is broadcast on the project's shared event stream. What the owner then accepts becomes ordinary request data of an existing
  owner-only call (the growing plan/apply body), which is itself never stored.
- **Precedent.** Picture search's text query (wave 7): a synchronous, bounded, validated, labelled request outside a job, nothing
  stored (search decisions §3a; `search/contract.ts`); its text vectors are model output too.
- **The conditions such an answer keeps**, all of them, or it is a job: (1) a credential that acts as the owner (ADR-0036
  `actsAsOwner`, a policy site listed in `OPEN_GATES` as A17): in guarded mode the owner's own session only, in open mode also an
  agent credential that may edit; every other credential gets 403 `owner_required` before the body is read and does not see the
  model's setup row; no MCP tool (adding one is a later decision, see below); (2) nothing stored — no job row, event,
  derivative, file or log line, pixels inline on the worker's stdin, `Cache-Control: no-store`; (3) validated before it is shown,
  with a strict schema of the worker's line (an extra key is a failure, never dropped silently); (4) bounded — one request at a time,
  one worker process per request, killed on abort and on a timeout, no kept worker; (5) labelled — the answer names what made it,
  and a test stand-in names itself; (6) never fabricated — a failure is a refusal with a code, never "nothing found".
- **First user.** «הציעו עיניים» (eye positions for «גדלים מול העיניים», YuNet on the CPU through onnxruntime): two points per face,
  in shown coordinates, nothing else; more than eight faces gives no point at all. Picture maps (depth, mattes) are NOT covered by
  this reading: they are stored derivatives and will be durable jobs (laptop wave).
- **Open mode (ADR-0036).** The answer goes to whoever asked and to nobody else, so an open agent that asks gets it in its HTTP
  answer exactly as the owner's window does; nothing about the request or the answer is stored for either (the privacy test runs in
  both modes). An MCP tool for eye proposals would be the same call; it is not added here.
```

## Integration notes (2026-11-26, integrator)
- Merged W1 (2501ff5), W2 (e57b054), W3 (679a25a) into `wt/pic-int`; the only conflicts were the `refusals.ts` loop header (the
  lead's side was a superset, kept).
- `PICTURE_WORKER_SHA256` stays `null` (the lead reads `pf_picture.py` first), so `PICMODELS_SERVER_BUILT` stays false and core yunet
  stays `built: false`: a real server answers 501 `eyes_not_built`, and the marking view shows «הציעו עיניים» disabled with the
  not-built words beside it. Flip all three together after the read, in one commit, and rerun proof:picmodels (the seams do not
  read the flags) and `picmodels.test.ts` (its 501 row is skipped once the server flag is true).
- What an MCP tool `propose_eyes` would take: the route's server function called from mcp.ts with the same `actsAsOwner` check
  (one more OPEN_GATES row), `{assetId, frame}` in and the same `EyesAnswer` out as a text content block (an allow-list row in
  `packages/evals/src/drawnSites.test.ts` for the proof's parsing), no-store needs no header there but the MCP transport's own
  logging must be checked to keep condition (2); `picmodels.test.ts` "no MCP tool of this track exists" and proof E8's MCP row
  change; PICMODELS_MCP_TOOLS gets the name; peopleSurfaces gets an MCP row.

## Laptop gates PM0–PM12 (each a command, what it must print, which switch it turns on)

Synthetic pictures, or one consented picture of an adult (the owner). Each figure printed is one sample. A check that prints anything
else is a stop: the switch stays off and the finding goes to BLOCKERS. Depth and matte rows (PM6–PM10) wait for the laptop wave that
builds maps; they are listed so the table is complete.

| Gate | Command (Windows, repository root) | Must print | Turns on |
|---|---|---|---|
| PM0 | `nvidia-smi` and `"%PF_TOOLS_PYTHON%" -c "import sys;print(sys.version)"` | the RTX 3050 with 4096 MiB; `3.13.x` | the CUDA lock (map device `cuda`) — laptop wave |
| PM1 | `"%PF_TOOLS_PYTHON%" -m pip install --require-hashes --only-binary=:all: --no-deps -r apps\server\tools\requirements-picture-win-cpu.txt` then `"%PF_TOOLS_PYTHON%" -m pip check` | the three packages installed with no hash error; `No broken requirements found.` | with PM2: every row leaves `engine_not_working` |
| PM2 | `"%PF_TOOLS_PYTHON%" -I apps\server\tools\pf_picture.py probe` | one JSON line, `"ok": true`, versions of numpy (2.5.4) and onnxruntime (1.29.0), `"missing": null` | with PM1: every row leaves `engine_not_working` |
| PM3 | `pnpm proof:picmodels-real -- --setup` | one line per model: `yunet ready (232589 B verified)`; the depth and matte rows `not_built`; never a path | every row leaves `model_missing` |
| PM4 | `"%PF_TOOLS_PYTHON%" -I apps\server\tools\pf_picture.py inspect --model yunet --file model=<library>\models\face_detection\yunet\face_detection_yunet_2023mar.onnx` | the input name and shape and the twelve outputs `cls_8 … kps_32` with the shapes `decode_yunet` expects | `eyes` on (YuNet row `built: true`); any other list is a STOP: the decode is corrected first |
| PM5 | `pnpm proof:picmodels-real -- --eyes <consented picture of an adult>` | `faces: N`, each pair in shown pixels, the seconds of the request (one sample), then `data dir unchanged` | with PM12: eyes offered to the owner (the owner looks whether the rings sit on the eyes; nobody here can) |
| PM6 | `… pf_picture.py inspect --model da3-small` and `--model da3-base` | dtype, parameter count, `missing=0 unexpected=0` | depth `built: true` (after the DA3 code is vendored as one reviewed file, verify C6/C7) — laptop wave |
| PM7 | `pnpm proof:picmodels-real -- --depth` | Spearman ρ of nearness against a synthetic receding checkerboard (provisional pass ρ ≥ 0.8), on cpu and on cuda when present; seconds per picture | depth offered on the CPU — laptop wave |
| PM8 | `pnpm proof:picmodels-real -- --matte` | IoU of SAM 2.1 tiny's matte of a synthetic disc on noise with a centre click (provisional ≥ 0.9); `video: yes/no` with the error type | still mattes; its yes/no switches video propagation — laptop wave |
| PM9 | `pnpm proof:picmodels-real -- --memory`, once with ComfyUI idle and once right after a ComfyUI job | peak `torch.cuda.max_memory_allocated` for da3-small at 504 and sam2-tiny at 1024 with the search worker released; no out-of-memory; during an export `waiting for export` | map device `cuda` during real use — laptop wave |
| PM10 | `set CUDA_VISIBLE_DEVICES=` then PM3 and PM7 | the CPU sentence; seconds per picture on the CPU | depth offered on GPU vs CPU decided — laptop wave |
| PM11 | `pnpm proof:picmodels` from a clone on Windows | every check PASS with the labelled adapter | the Windows plumbing |
| PM12 | crash the worker: `"%PF_TOOLS_PYTHON%" -I apps\server\tools\pf_picture.py inspect --model yunet --file model=<a damaged copy>`, then `dir %LOCALAPPDATA%\CrashDumps` and `dir C:\ProgramData\Microsoft\Windows\WER\ReportArchive` | an error line with a code and no traceback; no new dump or report naming python.exe | with PM5: eyes offered to the owner |

Not provable before the laptop: YuNet's real output names and layout, the BGR order and 0–255 range it expects, its quality on
children's faces (profiles, glasses, small faces in group pictures at 640), the time of one request, the Windows install, crash dumps.
