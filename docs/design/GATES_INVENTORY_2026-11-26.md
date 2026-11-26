# Gates inventory, 2026-11-26

Read-only inventory for the "autonomy first, open by default" ADR (owner decision, `docs/BLOCKERS.md:93`; `CLAUDE.md` "Product scope"). It lists where the product stops, narrows, hides or asks before acting. It classifies and cites; it recommends nothing. Searched: `apps/server/src`, `packages/core/src`, `packages/providers/src`, `apps/web/src`, `docs/adr/*.md`, `docs/SPEC.md` (section 26 and headings), `CLAUDE.md`, `docs/BLOCKERS.md`. Nothing was built, run or tested. Test files were read only as pointers.

## Counts

106 rows. Per family: A who may act 25 | B approvals and proposals 12 | C what agents may see 13 | D what may leave the computer 12 | E what code may run 9 | F doors to other devices 6 | G content safety 8 | H licence gates 6 | I limits and budgets 15.

Per kind: policy 80 | fact 15 | security floor 9 | not checked 2.
Per family (policy / fact / floor / not checked): A 20/2/3/0 | B 11/1/0/0 | C 13/0/0/0 | D 8/3/0/1 | E 5/0/3/1 | F 3/1/2/0 | G 6/2/0/0 | H 5/1/0/0 | I 9/5/1/0.
Row F4 (phone pickup) is counted as policy but also holds a security-floor part (its own port and exact routes); row F3 likewise (wrong-claim close). Rows G4, H4, I1, I2 are policy that already warns or is off by default.

## Not checked

- D11 URL-import blocking of private/metadata networks (SPEC section 26): no URL-import code found by search.
- E9 FFmpeg/parser isolation (SPEC section 26): spec text only, code not audited.
- Pickup (F4): ADR-0035 exists, no pickup file in `apps/server/src`; BLOCKERS.md:89 says not built.
- `apps/web/src`: only one `confirm(` call found (TrackPicker.tsx:165, a key handler, not a gate). Dialogs, plan screens and strings in the editor that ask before acting were not read.
- A10 and A19: exact route lines not opened one by one (http.ts cancel route; lines 309-310, 338, 760, 769 read only in outline).
- I14 domain refusals: not listed op by op.
- Op-by-op "refused" wording inside each ADR's Decision (ADR-0010 to 0020 and 0024) was sampled by search, not read in full.
- SPEC.md headings other than section 26 were not walked.

Columns: ID | Gate | Where (file:line / ADR) | What it stops today | Protects | Kind | If opened: what the owner notices; what becomes possible. Kinds: policy, fact, security floor, not checked. Line numbers marked "~" are approximate.

## A. Who may act (scopes, modes, owner-only routes)

| ID | Gate | Where | What it stops today | Protects | Kind | If opened |
|---|---|---|---|---|---|---|
| A1 | Built-in `observer` token reads only; `agent` token reads and edits | auth.ts:14,107-108,121; ADR-0002 Decision | Observer writes: 403 insufficient_scope | owner's data | policy | Nothing visible; every token could edit. |
| A2 | Grant modes observe / propose / edit / autopilot; observe and propose cannot commit or run jobs | governance.ts:15,141-148,187-188 | 403 insufficient_scope; propose mode gets a proposal instead of a commit | owner's data | policy | Every grant edits directly; proposals stop appearing. |
| A3 | Optional grant limits to projects, tracks, a time range | governance.ts:21-22,150-170; ADR-0002:32 | Edits outside the limit: 403 out_of_scope | owner's data | policy | Grants could touch the whole library (limits exist only if the owner sets them). |
| A4 | A track/range-limited grant is refused uploads, sound-effect import, analysis data, provider jobs | governance.ts:153-157; ADR-0002:32 | 403 out_of_scope: those changes cannot be checked against clip limits | product's own correctness | fact | Only matters while A3 is used. |
| A5 | Only the owner session creates or revokes grants | governance.ts:59,82; http.ts:646 | An agent minting itself a stronger token: 403 owner_required | owner's data / computer | security floor | An agent could promote itself; the owner key would mean nothing. |
| A6 | Only the owner pauses or resumes agents; paused agents get 423 | governance.ts:127-146 | Agents resuming themselves or acting while paused | owner's data | policy | The Pause switch (an owner opt-in) could be undone by an agent. |
| A7 | Owner session needs the launch secret (owner link `?key=`); tokens in `tokens.json` mode 0600 | auth.ts:33,74; ADR-0002 Amendment 2026-11-15 | A local program or agent minting an owner cookie | owner's data / computer | security floor | Any local program could act as the owner. |
| A8 | Host header must be a loopback name; Origin allow-listed; SameSite cookie; MCP origin check | auth.ts:56,73,115; mcp.ts:364; ADR-0002 | DNS rebinding, cross-site pages driving the editor (403 forbidden_host / forbidden_origin) | owner's data / computer | security floor | A web page the owner visits could drive the editor. |
| A9 | Agents may undo/redo only their own transactions | governance.ts:192-194; ADR-0002:32 | An agent undoing the owner's edits | owner's data | policy | Agents could undo anything in the history. |
| A10 | Agents may cancel only their own jobs (exception: the owner's in-tab export), not while paused | ADR-0002:32,36; http.ts cancel route | Cancelling other actors' jobs | owner's data | policy | An agent could stop any job. |
| A11 | Translation "reviewed" mark is owner-only (403 human_approval_required) | http.ts:143,687; ADR-0017:30 | An agent marking a machine translation reviewed | viewers | policy | An agent could mark its own translation reviewed. |
| A12 | Full-size `still` export owner-only, REST and MCP | export.ts:283-288; mcp.ts:241; ADR-0032:48 | 403 owner_required to agents | people in the footage | policy | Agents export full-size stills. |
| A13 | `apply_lesson` refused to every agent (403 lesson_owner_only); lesson routes owner-only; no MCP tool | lessons/guard.ts:1-10; lessons/routes.ts:5,32 | Agents replaying the owner's recorded macros | owner's data | policy | Agents reuse the owner's learned edits. |
| A14 | Saved versions: rename/delete owner-only; save/restore refused in propose mode; no MCP tool | craft/versions.ts:113,120; craft/contract.ts:50-51,83 | Agents renaming/deleting versions | owner's data | policy | Agents manage versions. |
| A15 | An older version's still/diff is refused (403 version_privacy_changed) to non-owners when privacy regions changed since | craft/contract.ts:14-16,43; craft/versions.ts:41,72 | Agents seeing a picture from before a redaction was added | people in the footage | policy | Agents view un-redacted older versions. |
| A16 | Review booth owner-only on every route; no MCP tool | booth/contract.ts:37-38,66,79-81; booth/routes.ts:3 | Agents opening the booth | owner's data | policy | Agents run the booth self-check. |
| A17 | Own templates, find-by-picture search, picture-model/eyes routes, instruments "heard" owner-only; no MCP tool | ownTemplates.ts:31-33; search/routes.ts:32; search/runtime.ts:171; picmodels/routes.ts:24; picmodels/contract.ts:50-52; instruments/heard.ts:40 | 403 owner_required to agents | owner's data / people in the footage | policy | Agents search footage by picture and save templates. |
| A18 | Library folder set owner-only | library/contract.ts:61,95-97 | Agents pointing the server at another folder | owner's computer | policy | Agents change the folder the server reads. |
| A19 | Cross-project reads owner-only: people-suggestions, on-this-day, family-check, backup POST, grants list | http.ts:309-310,338,646,760,769; lifeline.ts:43,65 | Agents reading every project (no grant covers it) | owner's data / people in the footage | policy | Agents read birth dates and dated pictures of all projects. |
| A20 | Storage actions owner-only | storage.ts:51 | Agents freeing or deleting stored data | owner's data | policy | Agents clean storage. |
| A21 | Speech engine install and its stop owner-only; no MCP tool | http.ts:1030,1500; openapi.ts:229-230 | Agents installing software into the data dir | owner's computer | policy | Agents install the speech engine. |
| A22 | Language assistant: set up, use, local check, "taken", budget release, cancel owner-only | assistant/routes.ts:49,54,93; assistant/visibility.ts:71-75; http.ts:281,972; ADR-0027 Note 2026-11-24 | 403 owner_required to agents | owner's data (key, money) | policy | Agents set it up, spend its budget, cancel its jobs. |
| A23 | Phone codes (drop and pickup) issued, seen, closed only by the owner session; agents never learn one exists | importRoutes.ts:38; drop.ts:612; ADR-0023:25; ADR-0035:27 | Agents opening a home-network door | owner's computer | policy | Agents open the phone drop. |
| A24 | Retry/dismiss of a file sent from a phone owner-only | importContracts.ts:220 | Agents acting on phone uploads | owner's data | policy | No visible change. |
| A25 | Propose-mode credentials refused on templates, family film, perform, shorts, built-in music, library add | templates.ts:112; familyFilm.ts:88; perform.ts:29; shorts.ts:184; music.ts:350; library/routes.ts:201 | A proposal cannot carry internal steps | product's own correctness | fact | Disappears with propose mode (B1). |

## B. Approvals and proposals (asks before acting)

| ID | Gate | Where | What it stops today | Protects | Kind | If opened |
|---|---|---|---|---|---|---|
| B1 | Propose mode: agent edits become proposals the owner accepts or rejects | governance.ts:178-188,201; ADR-0002 | Direct commit by propose-mode credentials | owner's data | policy | Edits land at once (still undoable); the Accept queue is empty. |
| B2 | Accepting/rejecting proposals owner-only | governance.ts:250 | An agent accepting its own proposal | owner's data | policy | Nothing to accept if B1 is open. |
| B3 | Approvals: single-use, bound to the exact action, expire | governance.ts:277-312 | Reusing an approval for another action | owner's data | policy | Only model downloads use it today (http.ts:129-138,699). |
| B4 | Agents can only request a model download (MCP request_model_download, REST models/request); owner approves | mcp.ts:312; http.ts:129-138; capabilities.ts:256; ADR-0017:38-39 | Agent starting a download | owner's computer (disk, network) | policy | Agent fetches missing models itself. |
| B5 | Paid work needs an Autopilot grant with a budget | governance.ts:324-328; capabilities.ts:427 | 403 insufficient_scope; 402 budget_exceeded | owner's money | policy | Agents run paid providers. |
| B6 | Command-bar assistant is a propose-only principal with no token; accepted proposals commit as the owner | ADR-0027:33-34; governance.ts:354-355 | The model editing directly | owner's data | policy | Model edits land without Accept. |
| B7 | Command bar never starts an export; export opens the sheet | ADR-0027:21-22 | The model starting an export | owner's computer | policy | "Export it" would run. |
| B8 | Stale preview (409) asks the owner to check again; no rebase | ADR-0027:19-21 | Applying an edit to a changed project | product's own correctness | fact | Would apply unseen changes. |
| B9 | Ambiguous requests ask instead of guessing | ADR-0027:18-19 | Guessing a time or target | product's own correctness | policy | The model picks a reading and goes on. |
| B10 | ASSISTANT_EXCLUDED_OPS: about 60 ops the assistant may not propose (library, settings, transcripts/captions, redaction, motion tracks, people, ranges, lessons, ink, grade curves, audiences, trip map ...) plus PERSON_OPS; many entries say "keep the reviewed prompt digest unchanged" | core assistantContract.ts:44-85; assistant/prompt.ts:5; assistant/validate.ts:7 | Proposals containing those ops | owner's data / people in the footage | policy | Assistant edits transcripts, redaction, library. |
| B11 | Long AI run needs confirmation (confirm_long_run) | framePlan.ts ~246; capabilities.ts:324 | A run over aiConfirmMinutes without confirmLongRun | owner's computer (time) | policy | Long runs start without a prompt. |
| B12 | First run of a tool on a machine is capped (first_run_limit) until measured | framePlan.ts ~245; ADR-0017:41 | Long first runs | owner's computer | policy | First run no longer capped. |

## C. What agents may see (privacy filters)

| ID | Gate | Where | What it stops today | Protects | Kind | If opened |
|---|---|---|---|---|---|---|
| C1 | Names-only document: credentials without `people: 'full'` read the project without birth dates and word choices; every surface (read, render_frame, describe_moment, contact sheet, preflight, plans) computed from it | peoplePrivacy.ts:1-30 (rules 1, 2a); peopleSurfaces.ts; ADR-0021:46-51 | Agents seeing birth dates and ages in titles | people in the footage | policy | Agents see ages and dates; {age} titles render. |
| C2 | Names-only credentials may not write birth dates, word choice, range labels | peoplePrivacy.ts:165-167 | Agents setting people details | people in the footage | policy | Agents fill in people details. |
| C3 | Export/film whose titles show an age refused (403 people_scope_required) to names-only credentials | peoplePrivacy.ts:227-229; browser-export.ts:153; familyFilm.ts:40; ADR-0021:51; ADR-0026:73; ADR-0028:57 | An autonomous "make the family film and export" | people in the footage | policy | The film with ages exports. |
| C4 | Scrubbing of proposals, REST answers, MCP results, events | peoplePrivacy.ts rule 3 | Birth dates in any agent-readable row | people in the footage | policy | No visible change. |
| C5 | Archive for agents carries names, no birth dates; owner's archive «בלי פרטי משפחה» omits people and ranges | archive.ts:15,86; peoplePrivacy.ts rule 4 | Agent taking the full archive | people in the footage | policy | Agents get the whole archive. |
| C6 | Person tags on source ranges, edits of tagged ranges, remove_person of a tagged person are owner-only even for `people: full` (403 human_tag_required) | peoplePrivacy.ts:206 (rule 5) | Any agent tagging people | people in the footage | policy | Agents tag people in clips. |
| C7 | Assistant job/proposal rows hidden from agents (stub only); status says connected or not | assistant/visibility.ts:38-62 | Agents reading what the owner asked the assistant | owner's data | policy | Agents read the owner's assistant history. |
| C8 | Assistant summary allow-list: birth dates, capture dates, events, file names, transcripts, media never sent; titles/markers/people names only behind two switches, default off | assistant/summary.ts:9-12,57,122; ADR-0027:29-32 | The model seeing footage details | owner's data / people in the footage | policy | The language model sees transcripts, names, titles. |
| C9 | Provider API key never returned by a route, never logged, 0600 file, kept out of backups | ADR-0027:11,33; backup.ts:22,95; SPEC §26 | Agents or logs reading the key | owner's money | policy | An agent could read a saved key (the owner key stays separate). |
| C10 | "Never stored": eyes (no job row, no event), voice activity, booth mic take, typed command text (intent id only), phone file names/tokens (never in URL/log) | picmodels/contract.ts:17-20; ADR-0028:24; ADR-0030:53; ADR-0027:12; ADR-0035:5 | Keeping data the owner never asked to keep | people in the footage | policy | History/logs hold more; no behaviour change. |
| C11 | Lessons never learn people/privacy ops (NOT_LEARNED_WHY) | core lessonContract.ts:99,187,202 | Macros containing people edits | people in the footage | policy | Lessons could include people ops. |
| C12 | Face recognition, face embeddings, grouping children's faces and voice prints rejected; person tags manual only | docs/research/2026-11-25-library-models.md:195,316; core sourceRangesContract.ts:133 | A feature that does not exist (no code gate; a lead decision) | people in the footage | policy | "Who is in this clip?" could be automatic once built. |
| C13 | The owner's footage, frames, sound, transcripts never used by agents and never leave the computer (standing rule, partly superseded by the 2026-11-26 decision (1)-(2)) | BLOCKERS.md:91,93; ADR-0027:29 | Agents and services using footage | owner's data / people in the footage | policy | Agents and connected services work on the footage. |

## D. What may leave the computer (providers, hosts, models)

| ID | Gate | Where | What it stops today | Protects | Kind | If opened |
|---|---|---|---|---|---|---|
| D1 | Model downloads only from hosts in PF_MODEL_HOSTS | capabilities.ts:268; models.ts:75; config.ts:149; ADR-0017:38 | 409 host_not_allowed / 403 model_host_not_allowed | owner's computer | policy | Models from any host. |
| D2 | Model downloads owner-session only | capabilities.ts:256; http.ts:1022,1041; speech.ts:343-355; ADR-0007 Additions; ADR-0017:38 | 403 human_approval_required | owner's computer | policy | Agents download models (see B4). |
| D3 | Download bound to exact bytes (confirmBytes) and pinned SHA-256 | capabilities.ts:265; models.ts:63; speech.ts:344 | Unverified or changed files | owner's computer / product's own correctness | fact | Unpinned files accepted. |
| D4 | Free-disk margin before a download | capabilities.ts:270 | A download that fills the disk | owner's computer | fact | Disk could fill. |
| D5 | ComfyUI must be loopback unless PF_COMFYUI_ALLOW_REMOTE=1 | comfy.ts:3,32; config.ts:147 | Sending frames to a remote host | owner's data | policy | Remote ComfyUI without a flag. |
| D6 | Assistant hosts: exact allow-list PF_ASSISTANT_HOSTS (empty default); nothing sent until key, both money limits and host are set | config.ts:22,150; assistant/job.ts:94; assistant/routes.ts:58; ADR-0027:9 | Sending the summary anywhere | owner's data | policy | Connecting a service becomes the consent (BLOCKERS.md:93 (2)). |
| D7 | Local assistant only on 127.0.0.1 | openapi.ts:276; assistant/local | A non-local model server | owner's data | policy | Remote "local" assistant. |
| D8 | Egress blockers always stop capability execution | capabilities.ts:35,355 | Capabilities with unreviewed egress | owner's data | policy | Such capabilities run. |
| D9 | "Local models only" for speech, translation, tools (local provider) | ADR-0017; ADR-0007 Amendment; providers/src/local-registry.ts | Cloud models for these jobs | owner's data | policy | Cloud speech etc. once connected. |
| D10 | Reference voice (cloning): owner session, consent statement, 5 s minimum (422 consent_required) | speech.ts:509-517 | Cloning a recorded person's voice without a statement | people in the footage | policy | Voice from a recording without a statement. |
| D11 | URL import blocks unsafe schemes and private/metadata networks | SPEC §26 (text) | SSRF | owner's computer | not checked (no URL-import code found by search) | not checked |
| D12 | Remote MCP / OAuth not built | ADR-0002 "Not yet done" | Remote agents | owner's data | fact | Needs building. |

## E. What code may run

| ID | Gate | Where | What it stops today | Protects | Kind | If opened |
|---|---|---|---|---|---|---|
| E1 | No route accepts a raw graph or code for execution; run a published capability by id with validated parameters | ADR-0007 Decision; capabilities.ts:353-355 | Model-written graphs, Python, FFmpeg commands | owner's computer | policy | Agents run arbitrary tools (BLOCKERS.md:92: owner-enabled mode, own ADR). |
| E2 | Graph import is parsing only, always a draft with blockers | ADR-0007; providers/src/import.ts:3,91 | Executing an imported graph | owner's computer | policy | Imports run at once. |
| E3 | A draft capability cannot run; descriptors are reviewed | capabilities.ts:353 | Unreviewed descriptors | owner's computer / product's own correctness | policy | Drafts run. |
| E4 | Media inputs are asset ids only; never a path or URL from the caller | ADR-0007 Additions; capabilities.ts:441-452 | Reading any file by path | owner's computer | security floor | An agent could read any file. |
| E5 | Local tool codeDigest / search worker SHA must match reviewed code (code_digest_mismatch, engine_unverified) | ADR-0007 Amendment; localtools.ts:67; search/runtime.ts:5 | Running changed tool code | owner's computer | policy | Edited tool code runs. |
| E6 | Model-written Python (Manim, Blender) and FFmpeg commands ruled out | BLOCKERS.md:92-93 | Feature not built | owner's computer | policy | New engines (own ADR). |
| E7 | CSP: script-src 'self', no WASM; data routes `default-src 'none'; sandbox; frame-ancestors 'none'` | http.ts:149-151,201; ADR-0010:14 | Injected or third-party script, framing | owner's computer | security floor | A page or injected content could run script. |
| E8 | Render worker gets a single-purpose token per session | ADR-0002 Decision | Worker reading beyond one snapshot | owner's data | security floor | Worker could read any asset. |
| E9 | FFmpeg/parser isolation: argument arrays, restricted protocols, scratch paths | SPEC §26 (text) | Shell injection, path traversal | owner's computer | not checked (spec text only; code not audited) | not checked |

## F. Doors to other devices

| ID | Gate | Where | What it stops today | Protects | Kind | If opened |
|---|---|---|---|---|---|---|
| F1 | Main server binds loopback only | config.ts:137-138; ADR-0001:20 | Any other device reaching the editor | owner's data / computer | security floor | Anyone on the network reaches the API. |
| F2 | Phone drop: second plain-HTTP listener only while an owner code is live; upload-only route table, else 404; no cookies/CORS; Origin and Sec-Fetch-Site checks | ADR-0023:20-31; drop.ts:17,560 | The phone or a stranger reading project data | owner's data | security floor | A stranger on Wi-Fi could read or edit. |
| F3 | Drop code: one project, single use; 10 min unclaimed / 10 idle / 60 max; 5 wrong claims close it | ADR-0023:25-31 | Long-lived or guessed access | owner's data | policy | Codes last longer (the wrong-claim close is a floor item). |
| F4 | Phone pickup: ONE finished export, one device, 10-30 min, own port serving only /, /hello, /f/ticket; any widening needs a new ADR. Code not found in apps/server/src (BLOCKERS.md:89: not built) | ADR-0035:8-45 | More than one file, a listing, a preview, agent access | owner's data | policy (scope); security floor (own port, exact routes) | Phone gets more than one file. |
| F5 | A review link on the home network was rejected | ADR-0035:11 | Network preview | owner's data | policy | Phone/TV review links. |
| F6 | Plain HTTP: not encrypted, owner chooses the network, no self-signed cert | ADR-0023; ADR-0035:6,33-40 | Nothing (told to the owner) | owner's data | fact | Already informs. |

## G. Content safety checks

| ID | Gate | Where | What it stops today | Protects | Kind | If opened |
|---|---|---|---|---|---|---|
| G1 | Strobe hard limit: no strobe decides when it flashes; at most about 3 starts a second across the timeline; extra flashes are dropped | ADR-0009 Decision 1; packages/engine strobeSchedule.ts | A faster strobe in preview, stills, export, agent frames | viewers | policy | Fast strobes render as asked. |
| G2 | FlashGuard in the editor player holds back rises less than 1/3 s apart | ADR-0009 Decision 2; apps/web/src/editor/EffectGallery.tsx (FlashGuard referenced) | Fast flashing on the owner's screen | viewers | policy | Preview shows what the file shows. |
| G3 | Built-ins safe at their defaults (flicker, wave, pulse, beat-montage minimum length) | ADR-0009 Decision 3 | Default settings above the limit | viewers | policy | Presets could flash fast. |
| G4 | Export flash check is report-only; preflight warns, does not block | export.ts:641,706,750; ADR-0009 Decision 4 | Nothing (already warn-and-continue) | viewers | policy (already open) | none |
| G5 | Tab's photosensitivity report must match its own rule (422 invalid_photosensitivity) | browser-export.ts:199,204 | A mismatched report | product's own correctness | fact | Wrong reports accepted. |
| G6 | Export blockers (render_blocked): live field without data, missing media; browser route refuses loudness target, sidecar captions, other formats | browser-export.ts:165-169; ADR-0021 (field blocker); ADR-0024:46 | Exports that would be wrong | product's own correctness | fact | Wrong or empty film. |
| G7 | Wording rules held by tests: no praise of sounds, no songs/lyrics, no predictions | ADR-0029:50; ADR-0022:29; ADR-0018:52 | Strings in the interface | other people's rights | policy | Strings could say these. |
| G8 | A proposal cannot remove a redaction (set_redact_region, motion tracks excluded) | assistantContract.ts:44-85 (see B10) | The model removing a privacy blur | people in the footage | policy | Model edits redaction. |

## H. Licence gates

| ID | Gate | Where | What it stops today | Protects | Kind | If opened |
|---|---|---|---|---|---|---|
| H1 | Distribution profile (commercial default, research): model files with a disallowed licence cannot download or run (409 capability_blocked / licence_blocked) | capabilities.ts:40,199,264,355; localtools.ts:99,323-324; config.ts:164; SPEC §26 | Non-commercial or unknown weights in the commercial profile | other people's rights | policy (refuses; the licence text is the fact) | Such models usable, with a notice. |
| H2 | Search picture model licence must be in LICENCES_ALLOWED | search/runtime.ts:95 | Search with another model | other people's rights | policy | Another model usable. |
| H3 | Library: share-alike, no-derivatives, unknown licences refuse the whole kit (fail closed) | ADR-0029:42; core libraryDuties.ts:63; library/index.ts:12 | Using such items or kits | other people's rights | policy | Usable with duties told. |
| H4 | Credits/duties flags (diskOnly, nonCommercial, shareAlike, aiGenerated) inform | core libraryCredits.ts:103; musicKits.ts:193 | Nothing (informs) | other people's rights | policy (already informs) | none |
| H5 | ComfyUI not bundled (GPL); the user runs it | ADR-0007 Decision | Redistribution | other people's rights | fact | Not applicable. |
| H6 | Reviewer sets commercialUse/licenseReviewed; 'pending' blocks | providers/src/local-registry.ts:29; builtin.ts:167 | Unreviewed models | other people's rights | policy | Pending models run. |

## I. Limits and budgets

| ID | Gate | Where | What it stops today | Protects | Kind | If opened |
|---|---|---|---|---|---|---|
| I1 | Requests per minute per credential (server default off; per-grant optional): 429 rate_limited | auth.ts:84-98; config.ts:153; governance.ts:25 | Bursts of agent calls | owner's computer | policy | none (off by default). |
| I2 | Exports per day per grant (default none): 429 export_quota_exceeded | governance.ts:24,110-122 | More exports | owner's computer | policy | none by default. |
| I3 | Grant budget in cents, default 0: paid work refused; 402 budget_exceeded | governance.ts:23,324-336 | Paid provider work | owner's money | policy | Paid work without a cap. |
| I4 | Assistant monthly limit and per-request cap; prices typed by the owner, > 0 | governance.ts:354-361; ADR-0027:9 | 402 budget_exceeded; nothing sent until set | owner's money | policy | Assistant runs without a ceiling. |
| I5 | Agents: at most 2 AI jobs queued/running (PF_AI_AGENT_MAX_QUEUED) | capabilities.ts:363; config.ts:80,175 | 409 agent_limit | owner's computer | policy | Agents queue many jobs. |
| I6 | Agents: at most 300 frames per AI run (PF_AI_AGENT_MAX_FRAMES) | framePlan.ts ~244; config.ts:79,174 | 409 agent_limit | owner's computer | policy | Agents process whole videos. |
| I7 | Assistant proposal holds at most 50 ops | core assistantContract.ts:29 | Larger proposals | owner's data | policy | Longer assistant edits. |
| I8 | Scratch budget per AI job; free-disk check | framePlan.ts ~246-248 | A run that fills the disk | owner's computer | fact | Run fails on disk. |
| I9 | Upload cap 2 GiB; storage cap (default none) | config.ts:145,152 | Larger uploads | owner's computer | policy | Larger files accepted. |
| I10 | Analysis/render queue "busy" 429 | analysis.ts:23 | A flooded queue | owner's computer | fact | Queue unbounded. |
| I11 | Narration script max 60 sentences per request | speech.ts:105,556 | Longer scripts in one request | owner's computer | policy | Whole script in one go. |
| I12 | Clip loudness: 1 hour of clips per request | clipLoudness.ts:71 | Longer measurements | owner's computer | fact | Longer measurements. |
| I13 | Compute lane: one heavy job at a time | ADR-0007 Amendment | Parallel GPU jobs | owner's computer | fact | Jobs would clash on a 4 GB GPU. |
| I14 | Domain refusals (frame alignment, stale undo, audio-fx on time-mapped clips, adjustment-layer limits, multicam 1000 cuts, still size 16..8192, template_blocked ...). Not listed op by op | ADR-0003:12; ADR-0010:82; ADR-0012:44; ADR-0016:22-55; ADR-0018:41; ADR-0020:36; ADR-0032:43 | Edits that would make the document invalid | product's own correctness | fact | Invalid documents. |
| I15 | Phone drop per-device connection and rate limits | ADR-0023:31 | Flooding the door | owner's computer | security floor | Door could be flooded. |
