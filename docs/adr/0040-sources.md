# ADR-0040: Stock sources and import from a direct link

Status: **Accepted (lead, 2026-11-26); built by three workers on the lead's pre-pass, integrated and merged (e0a272f).** On the
integration branch, one run each: `pnpm proof:sources` 18/18 on LABELLED DOUBLES (check 15 in Chromium), `proof:library` 18/18,
`proof:musicfit` 23/23. After the merge to the main branch only typecheck and the unit tests were rerun. No real service has been
contacted and no real key used. Amends ADR-0007 for reads from outside services; the library's fail-closed licence refusals stay
with ADR-0036. Lead's answers to the integrator: the open-mode download rule is accepted (the limit follows the upload limit in
effect; with none set, the owner's setting alone, or none — the disk reserve and the storage ceiling still hold); offering the
"archive for yourself" choice to open-mode agents and joining the connectors' key store with the agent's are follow-ups.

## Context
The owner wants a general-purpose editor that finds and places stock pictures, video and sound by itself (decisions of
2026-11-26: autonomy first, no approval steps, warn and continue). Files from outside services carry licences that the editor
must keep with the file and say at export. Verification `sources-verify.md` (C1–C17) corrected the plan; this track builds part A.

## Decisions
1. **Three searchable services and pasted links.** Openverse (anonymous by default, the owner may connect a client), Pixabay (the
   owner's key; video and photos), Wikimedia Commons (no key; the contact line the owner types goes in the User-Agent, to
   Wikimedia only; the editor never invents one). Direct links (Dropbox `dl=0` is fetched as `dl=1`). Each service is a
   descriptor (`packages/providers/src/connectors/sources.ts`); `apiHosts` bind API calls only; a file or preview URL from a
   service's own answer is held behind a handle server-side and passes the address floor only (C10).
2. **Every outside read goes through one safe downloader** (`apps/server/src/connectors/fetch.ts`, node:http/https): the lookup
   hook checks every returned address (Node 22 `all: true`), IPv4-mapped IPv6 normalised; loopback, unspecified, link-local,
   multicast and the machine's own interface addresses are refused (`link_address_refused`) — the editor's own doors, a fact, not
   policy; home-network addresses import with the warning `link_private_network`; at most 5 redirects, each re-checked; header and
   idle timers; bytes capped while streaming; Content-Type and magic bytes; no Referer, no cookies. The test address policy comes
   only from `SourcesDeps.test` (tests and the proof), never from the environment or a route.
3. **A durable job, `source_fetch`**, as ADR-0007 asks of provider results: resolving (the service is asked again; licence and
   author from that fresh answer) → downloading into `tmp/src_<job>.part` (free space before and every 64 MiB; resume with Range +
   If-Range; a 200 restarts) → importing through `imports.receive` with the record and the expected sha256 → placing (`add_clip`,
   as the credential that asked). A pasted link lives in a 0600 sidecar, never in the job row, the record's page or a log (C11).
   `.part` and `.link` go on success, cancel and failure, and at start for finished jobs. `idempotencyKey` returns the first job.
4. **The record on the asset, `provenance.source`**, written only by the internal op `use_source_item` (registered, undoable,
   generic undo): service, item, kind, title, author, page, licence as the service named it, credit, flags, terms, fetch time,
   sha256, size. Refusals only for data facts (`source_no_record`, `source_hash_mismatch`, `source_record_weaker`,
   `source_credit_missing`). Same bytes as a library copy: the library record is kept and nothing attached.
5. **Every credit reader reads source records** (`licensedOrigins`): credits, `creditDue`, `shareable`, the export reminder, the
   on-screen check, `add_credits_card`, the archive plan, the agent summary and music fit (a shortened source song carries its one
   source's record). Library-only answers stay byte-identical (the credits golden, recorded before the change).
6. **The download limit follows the upload limit in effect** (reconciled with ADR-0036 I9 at integration): the owner's setting
   (Settings › «חיבורים», or `PF_SOURCES_MAX_BYTES`), never above `uploadCapFor(cfg)`. In open mode with no upload limit set there
   is none: the setting alone, and with no setting `null` (no byte limit of its own); the disk reserve, the free-space checks and
   the storage ceiling still hold. Guarded mode, or a set upload limit: at most that limit.
7. **Who may do what.** Search, preview, import, place, cancel one's own download and set the download limit: any credential that
   may edit the project (governance `job`; a grant limited to tracks or a range, a propose-mode grant and an observer are refused
   with a next step). Storing or removing a service's key or contact line: the owner's own session in both modes
   (`isOwnerFloor`, FLOOR_SITES C9c) — a readable key is used elsewhere in the owner's name. Keys live in
   `<dataDir>/connectors/keys/` (0600; `connectors` is never backed up); `connectors.json` (settings, no secret) is backed up.

## The one licence rule
A licence finding is never a refusal. It is a warning that names the licence as the service wrote it and quotes the licence's own
deed sentence (`SOURCE_TERMS` `cc.nd`, `cc.sa`, read 2026-11-26; Hebrew marked «(תרגום)»), with its link: on the search row, the
import answer, the asset badge, music fit and at export (`licence_no_derivatives`, `licence_share_alike`, `licence_unknown`,
`licence_unconfirmed`, `source_terms`, `non_commercial_content`). The editor never concludes what a licence means for a video.
A sharing archive leaves out files whose record says not shareable (as the library does), and says so. The library's own
fail-closed refusal of SA / ND / unknown licences (ADR-0029 §6) is re-decided to this rule in ADR-0036, not here.

## Not built
Publish (YouTube upload, thumbnail, folder destination, schedule) — its own track. Video-site links (yt-dlp) — the `engines`
track. Freesound and other services (Pexels, Unsplash, Coverr) — later rows. The «הספרייה שלי» chip. A DNS double (a name
answering a public and a loopback address is covered by a unit test with an injected lookup, not end to end).

## Verified (integration, 2026-11-26; labelled doubles on 127.0.0.9/10, port 0; synthetic fixtures)
`pnpm proof:sources` 18/18 (checks 1–15 with 1b, 3b, 9b; check 15 in Chromium: the «מאגר» tab by keyboard, Space previews without
autoplay, Enter places, the link box imports, «חיבורים» stores a key from the owner's session, RTL). `proof:library` 18/18 and
`proof:musicfit` 23/23 unchanged. Unit tests: server contract and both server modes (open: an agent searches, imports and places
over REST and MCP with no approval step; guarded: grant limits refuse), downloader, import branch, core op and duties, fuzz
(an accepted unknown licence included), wording, the editor's parts. `audit:testids` PASS; `audit:a11y` with the states
`sources-tab`, `sources-results` (an audit fixture answers the search), `sources-connections`.

## Not verified (laptop rows)
S1 real Openverse / Pixabay / Commons answers, their licence fields and live limits (Openverse's deployed throttle against the
source default 5/hour); S2 Hebrew queries on Pixabay; S3 Pixabay's licence page and CDN hosts; S4 one large Pixabay download (one
sample); S5 Windows file names under `tmp/` with real-time virus scanning; S6 Windows file permissions (ACL) of
`connectors/keys`; S7 the owner's own key and contact line typed by the owner, and the real services' error statuses for a wrong
key (the doubles answer 401).
