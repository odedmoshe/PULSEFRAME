# ADR-0002: Access control in the local profile

Status: accepted (Phase 0)

## Decision
No visible login, but no unauthenticated writes (SPEC §4, §26):
- Bind to loopback only; reject requests whose `Host` is not a loopback name (DNS-rebinding defence).
- Browser UI: `GET /api/v1/session` issues an HttpOnly, SameSite=Strict cookie only to allow-listed origins. Cookie auth is rejected for other origins.
- Agents and scripts: bearer tokens generated on first start and stored `0600` in `<dataDir>/tokens.json`.
  Two tokens exist: `agent` (observe + edit) and `observer` (observe only).
- Scopes are checked server-side on every REST route and MCP tool. Actor identity comes from the credential, never from the request body.
- Internal operations (`import_asset`) can only be issued by trusted server code.
- The render worker gets a random single-purpose token per render session that can read one snapshot's assets and post that job's frames.

## Not yet done
Per-project/track/range scopes, budgets, Pause Agent, approval records, rate limiting, OAuth for remote MCP, encrypted secret store,
`Secure` cookies/TLS (needed for hosted), audit log beyond the op log. The cookie session map is in memory, so a server restart signs the browser out
(the UI re-requests a session on reload).

## Trade-off
Any local process running as the same OS user can read `tokens.json`. That matches the trust level of the data directory itself.

## Amendment 2026-11-15 — the owner session needs a launch secret
**Problem found by an independent review.** `GET /api/v1/session` gave the owner cookie to any request with an allowed or absent `Origin` header. A browser cannot forge that header, but any local program can, including an agent holding only an observe or propose credential. As owner it could create grants, accept its own proposals, approve downloads and resume paused agents, which defeats the control model in ADR-0002 and SPEC §21.

**Decision.** The session is issued only when the request also carries the launch secret (`tokens.owner`, header `x-pf-owner-key`). The server prints an owner link (`http://127.0.0.1:8787/?key=…`) at start-up; the editor sends the key once, receives the cookie and removes the key from the address bar. A browser that already holds a valid session needs no key. Agents receive bearer tokens or grants, never this secret.

**What this does and does not protect.** It stops an agent that talks to the server over HTTP/MCP from promoting itself to owner. It does not protect against a program that can read the data directory as the same OS user (it can read `tokens.json`, including the owner key, and the database). That remains the documented trust boundary of the local profile.

**Consequences.** After a server restart the session map is empty, so the owner link must be opened again. Opening the bare address without a session shows a message explaining this.

Other fixes from the same review (all covered by checks in `pnpm proof:phase5`): grants limited to tracks or a time range are refused for uploads, sound-effect import, analysis data and provider jobs (those changes cannot be checked against clip limits); undo/redo by transaction id is limited to the caller's own transactions for agents; agents may only cancel their own jobs and not while paused; two MCP tools now check project limits; heavy read-only work (analysis, loudness, stills) is limited to two at a time with a bounded queue and analysis processes time out; every ffmpeg call on user files uses a protocol whitelist; uploads must be self-contained media containers (playlists are refused).

**Budget ledger (fixed afterwards):** it is now wired to capability jobs through a declared per-run cost; see PROGRESS checkpoint 13c for what is and is not exercised. The export render queue is serial but exports themselves have no per-credential quota. Rate limiting per credential does not exist.
