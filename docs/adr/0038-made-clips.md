# ADR-0038: «קליפ מקוד» — a page of code drawn once into a transparent clip

Status: **Accepted (lead, 2026-11-26); built by three workers on the lead's pre-pass, integrated and merged (28af55d).**
On the integration branch, one run each: `pnpm proof:made` 25 passed, 0 failed, 1 skipped (G3.6, no fetch URL given); `proof:made-g0`,
`proof:made-g1` and `proof:phase5` 34/34 pass; `audit:a11y` 0 findings with the made states. After the merge to the main branch only
typecheck and the unit tests were rerun. Measured in the Linux container only; nobody has looked at a page for design. Amends ADR-0007
(a page of code is rendered by a durable job in a sandbox, never executed in the editor).

## Context
Creators and agents want titles, lower thirds, counters, intro plates, end cards and small motion graphics that the built-in effects do not cover. A language model writes HTML/CSS/JS, Canvas, SVG and WebGL well. The editor needs the result as an ordinary, undoable media clip with transparency, drawn the same way every time, without the page reaching the network or the editor while it draws.

## Decisions
1. **A page is drawn ONCE, offline, into a VP9-with-alpha WebM asset** (`made.render`, a durable job on the compute lane). Nothing runs at playback or export: the clip is a media clip whose asset carries `provenance.made` (page sha256, template id/version, typed values, fields, asset ids, fetched files with sha256, checks). Re-render («עריכה ויצירה מחדש») reads the page back from its blob.
2. **The made browser** is a separate Chromium from the export browser, launched with Chromium's sandbox where it starts: on Linux as root it drops to uid 65534 through `setpriv` (G0: renderer in its own user and network namespace, Seccomp 2); where it cannot, the job warns `noSandbox` and continues (no refusal). Per job a fresh context: page CSP (`connect-src 'none'`, `form-action 'none'`, `worker-src 'none'`…), `context.route` serving only `page.html`, catalogue fonts, pinned libraries (`/lib/<name>@<ver>/<file>`), the project's own media read-only (`/assets/<id>`) and files fetched once before drawing (`/fetched/<n>`); everything else aborted; WebSocket routes closed; an init-script network lock in every frame (G0 measured 3 STUN datagrams without it, 0 with it).
3. **Internet files** a page names are fetched ONCE by the server before drawing, recorded by url and sha256; never loopback, private or link-local addresses, names resolving to them, or redirects to them (a fact of the sandbox protecting the editor's doors and the home network, not a policy gate). A failed fetch fails the job naming the address.
4. **Determinism, facts and warnings.** Fonts are loaded before frame 0; animations and SMIL are paused and seeked; two passes are compared at frames 0, n/2, n−1 and three seeded frames. Facts fail the job (empty clip, a frame not finished in 2 s, a page error or crash — `made_crashed` with the error in `failure.detail`, navigation, the 15-minute budget, wrong frame count, a file that does not decode back, an ordinary page that draws a compared frame differently). Everything else is a warning with its numbers: flashing over black and white (decision 3: never a refusal), clock or random reads, fonts outside the catalogue, no sandbox, a WebGL page that differs between passes. More than 200 animations is not refused: the frame budget bounds the seek.
5. **Open semantics (ADR-0036).** Any credential that may edit renders and applies its own result through `apply_made_clip` (an internal op), committed as that credential in ONE undoable transaction; `then` applies on success (only the routes' watcher does it). Capacity, not permission: 1 active render per credential, 3 in all (429 `made_busy`); agent renders yield to the owner's own renders; agents paused by the owner are refused. Reading a job (report, stills, file) and applying it: the owner or the submitter in guarded mode; anyone for whom `actsAsOwner` is true in open mode (OPEN_GATES M1). REST and MCP share one service (`bindMade`), and the generic cancel (REST `/jobs/:id/cancel`, MCP `cancel_job`) dispatches a made render to its own cancel.
6. **Libraries**: gsap 3.15.1 (Webflow "Standard no charge" licence, not open source; NOTICE row quotes its prohibited-use sentence) and three 0.187.0 (MIT), pinned exactly in `apps/renderer/package.json`, served locally. HyperFrames' page runtime is OUT (it fetches while rendering; its package.json has no licence field): HyperFrames compositions return in the `engines` track as a separate program.
7. **Six built-in pages** for general use (rising title, lower third, counter, intro plate, end card, a 3D title card drawn with three.js), catalogue fonts only, text drawn as Canvas/SVG text from typed values (never markup), Hebrew and English samples, direction from the value's first strong letter.
8. **CSP of the editor and render page**: `worker-src 'self' blob:` (mediabunny's alpha merger runs in a blob: worker pool with no hook to self-host it). It lets script already running under `script-src 'self'` start a string as worker code (no DOM, the same `connect-src`); `script-src` keeps no `blob:`; `proof:phase5` asserts worker-src is exactly `'self' blob:`.
9. **ADR-0007 amended**: "No route accepts a raw workflow graph for execution. A page of code is accepted only by the made routes, drawn in the sandboxed made browser offline as described here, and its output validated before it becomes an asset. Model-written engine code (FFmpeg graphs, Manim, Blender, Remotion) is the `engines` track's ADR."
10. **ADR-0005 note**: transparent video (VP9/VP8 alpha WebM, ProRes 4444) keeps alpha through import (`video.hasAlpha`), no proxy, conform to VP9 `yuva420p` or a refusal in words, and draws with alpha in preview, `render_frame` and export through the same evaluate + compositor. Server-side ffmpeg decodes must use `-c:v libvpx-vp9` where alpha matters (the native decoder drops it).

## Not built
- HyperFrames runtime in pages (decision 7); three.js add-ons (loaders, 3D text fonts) are not served.
- Long text is fitted to the frame only by the intro plate (version 2) and the 3D card; the rising title, counter label, lower third and end card draw a long value as it is.
- The page check is advisory (warnings with offsets); refusals only for size, NUL, not UTF-8.
- WebM variable-frame-rate reporting with dropped frames (pre-pass finding 5): its own small fix later.
- The owner-enabled engines: their own track.

## Verified here (Linux container, 4 shared CPUs, heavily loaded; timings are samples, not facts about the product)
- `proof:made-g0` 3 PASS + 1 INFO (sandbox: browser uid 65534, renderer own net and user namespace, Seccomp 2; net-log zero for a blank page; attack page with the lock: 0 DNS, 0 connects, 0 UDP; without the lock: 3 UDP datagrams, recorded).
- `proof:made-g1` PASS (render_frame and the paused preview: 37,920/37,920 left pixels red within 2/255, right plate within 10/255).
- `proof:made` 25 passed, 0 failed, 1 skipped (G3.6 without `PF_MADE_PROOF_FETCH_URL`); G-webgl one sample 0.163 s per frame on SwiftShader, 0 differing pixels between passes.
- `proof:phase5` 34/34 (worker-src exactly `'self' blob:`). `check:notices` PASS (19 packages).
- Pictures of check 18 looked at by the integrator (twelve stills): Hebrew drawn right to left with joined letters in order; digits LTR inside RTL; the RTL lower third on the right. Not judged for design.

## Not verified
- Anything on Windows; real GPU drawing of WebGL pages; whether the built-in pages look right to the owner; internet fetch-once against a real host (G3.6 skipped); MCP listen behaviour under a mode switch with a render running.

## Only on the owner's laptop (L1–L6)
- **L1** `chromiumSandbox: true` launches on Windows 11 as the owner's user, and the G3 channel rows pass there with the sandbox on.
- **L2** `--host-resolver-rules` and the WebRTC policy hold on Windows (port 9 free; resolver; STUN).
- **L3** capture and encode time for a 5 s 1080p title: three samples, reported as samples.
- **L4** alpha decode in the owner's Chrome-based editor tab and in the GPU export browser (the merger workers run there too).
- **L5** the six pages look as intended in the owner's eyes, in Hebrew; the result `<video>` shows the checkerboard through.
- **L6** memory of 4 merger workers per alpha decoder alongside a full timeline.
