# ADR-0023: Phone drop (QR upload on the home network) and the import queue

Status: **Accepted — built and verified (see PROGRESS)** (2026-11-18); **amends ADR-0002** (a second,
short-lived listener beyond loopback). Built by three workers on shared contracts, each reviewed and repaired,
merged.
Not verified on a real phone or home network (see below).

## Context
- Moving a phone's clips to the editor went through a vendor cloud or a cable. ADR-0002 binds the server to
  loopback and rejects any other Host; SPEC.md:280 already specifies Phone Drop as an expiring, revocable,
  upload-only token.
- Upload was one synchronous request that waited for conform, and almost every phone clip needs one (HEVC,
  rotation, variable frame rate).
- The plan (`.artifacts/phone-drop-plan.md`) came back "needs changes"; its Verifier and Corrected notes win.
  The owner approved plain HTTP in the home network, a single-use upload-only code for one phone and many
  files, closing after 10 idle minutes, and no self-signed certificate.

## Decision (amendment to ADR-0002)
1. **A second plain-HTTP listener exists only while an owner-issued code is live**, on the private IPv4
   address the owner confirms (`POST …/drop` takes the address). The main server is unchanged and still
   refuses non-loopback.
   The door is a separate `node:http` server with no shared router, cookie or auth. Its whole route table:
`GET /` (one static Hebrew page with a hash CSP), `POST /hello`, `POST /upload`, `POST /status`, `POST /bye`;
everything else is 404, empty, `Connection: close`.
2. **The code has one scope: upload into one project.** Only the owner session can issue it. The QR carries a
   token in the URL fragment; the page claims it once for a session tied to the claiming IP (a reload from
   that IP re-claims);
   a typed address plus PIN claims the same code, five wrong claims close it. It closes after 10 minutes
unclaimed, 10 idle minutes (`idleMs`), 60 minutes at most, by the owner or the phone, when replaced, or at
shutdown.
   Token, PIN and session are compared as digests in constant time and never logged. Phone uploads commit as
actor `phone:<dropId>`. Per-device connection limits (a device holds at most half the connections) and rate
limits apply; a slowloris hole found in review was fixed.
3. **Honest limit:** the owner's clips stay local (no cloud, no account); anyone on the home network can sniff
   the uploaded bytes or add files while the code is live; they can never read or edit anything.
4. **One import queue** for desktop, folder and phone imports (`importQueue.ts`): the upload returns once the
   original is stored and hashed; conform and the `import_asset` commit run in the background on the compute
   lane, one conversion at a time,
   durable and recovered after a restart (recovery by idempotency key `import:<jobId>` only when the found
transaction's actor is the queue's own). Cards show waiting, converting, ready, failed with the reason. Only
`disk_full`, `canceled` and `internal_error` are retryable.
5. **Background commits** use transaction kind `background`: they stay off the same actor's Ctrl+Z and do not
   abandon redo. A finished import is reversed with the library's remove button or by transaction id; Ctrl+Z
   no longer removes a file the owner just imported.
6. **Capture dates** for phone files come from `captureMeta.ts` `readCapture` on the ORIGINAL file (ADR-0021);
   `declaredLastModified` is never a capture source.

## Consequences / what is not promised
- HEIC, the Windows firewall prompt, busy temp files on Windows, a VPN as the default route, real phone
  pickers (some transcode or strip dates), Chrome's HTTPS exemption for private addresses and a real full disk
  are not verified (docs/BLOCKERS.md).
- ENOMEM is detected from ffmpeg's stderr text; a Windows ffmpeg may word it differently.

## Verified / not verified
- One run, this CPU: `pnpm proof:phone-drop` 31 pass, 0 fail, 2 blocked (editor key timing during a
  conversion; a full-disk seam). P4b reads the QR as shown on screen with an independent decoder (jsQR 1.4.0,
  test-only, installed after the owner approved it).
  20 clips imported exactly once after SIGKILL. Later fixes: uploads of unknown size count toward the storage
ceiling as they arrive; an unclaimed device's connections have a 30 s lifetime.
- Phase 0 55, Phase 4 22, browser export 26, editor interactions 49, accessibility 0 findings, 3526 unit tests
  (PROGRESS 19b). Product faults fixed: files lost by an early reset, a cache above a lowered cap, a sound mix
  exceeding the ceiling.
- Not verified: a real phone, a camera reading the QR, a real home network.
