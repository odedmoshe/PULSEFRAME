# ADR-0035: «לטלפון ב־QR» — one finished file, read by the owner's phone over the home network

Status: **Decided by the owner (2026-11-26); designed and security-reviewed; not built.** Amends ADR-0002 (who may reach the
server) and ADR-0023 (the phone drop, until now the only door beyond loopback). Numbers 0030–0034 are reserved for the other
wave 8 tracks (the review booth, audience versions, sharp frame and still saving, growing up, the drawn clip kind).

## Context
- The owner asked, in their own words: as there is a way to upload videos by QR, they want a way to export / download finished
  videos to the phone from the system by QR.
- Until now nothing of the editor could be READ from the network: the phone drop only accepts uploads, and a review link on the
  home network was rejected in wave 5 because it exposed rendering and media beyond loopback. That rejection stands for
  everything except what this ADR allows.
- Design `.artifacts/wave8/pickup-plan.md`; its security verifier's corrections C1–C12 win (`pickup-verify.md`); the lead's
  binding decisions are in `.artifacts/wave8/decisions.md` under `pickup`.

## Decision
1. **What the door exposes:** the bytes and the name of ONE finished server-side export file, to one device, once the owner has
   pressed «לטלפון ב־QR» for that file.
2. **What it never exposes:** any other route, a listing, project data, source media, captions, credits, a preview or a render.
   Its own listener on its own port serves exactly `GET /` (a static page), `POST /hello` (the claim) and GET/HEAD `/f/<ticket>`;
   everything else is 404. No CORS, no cookies. The door's credentials are never valid on the editor's port, and the owner key,
   the editor's cookies and agent tokens are never valid on the door.
3. **One device per code.** The QR carries a 128-bit token; the first device that claims it gets a 256-bit ticket tied to its
   address and the token dies at that moment, as the drop's single-use code does. A link lives in server memory only: ten minutes
   to claim, thirty at most; it closes at shutdown, on «ביטול», when the dialog is closed while still waiting, when the file or the
   project is deleted (answers in flight are cut), and when the device has been sent the whole file.
4. **Agents and MCP can never create, see or close a link, or learn that one exists.** Only the owner's own session can.
5. **The page** strips the token from the address bar before it claims; its title never holds the film's name; the name reaches
   the phone only after a correct claim and never appears in a URL, the QR, a log or an event.
6. **Honest words on both screens:** the transfer is not encrypted on the home network; use it only on your own home network, not
   on a public, work or guest network; «נשלח במלואו» means every byte was handed to the network for that device, not that the phone
   kept the file.

## What this door does not protect against (said plainly)
- The film goes unencrypted to anyone on the same network who captures the transfer (on a WPA2 network: anyone who knows the
  Wi-Fi password), and to anyone who reads the QR before the phone claims it.
- Tying the ticket to the device's address protects against a leaked link, not against someone capturing the traffic.
- A private-range address is not proof of a home network: the owner chooses the network; the Windows firewall's private-only
  rule is the gate on public networks and has not been checked here.
- Someone nearby on the same network can close the owner's links by sending wrong tokens (the drop has the same weakness).
- Programs running as the same operating-system user are outside the boundary, as in ADR-0002.

## Any widening needs a new owner decision and a new ADR
More than one file per link, a listing, a preview, rendering, a link that survives a restart, more than one device without an
approval on the laptop, or any access for an agent.

## Not verified
Nothing is built. A real phone on the owner's Wi-Fi (iPhone and Android saving behaviour, Hebrew file names, the firewall prompt
for the second port, an insecure-download warning in the phone's browser): the laptop wave.
