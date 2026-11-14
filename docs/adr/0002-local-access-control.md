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
