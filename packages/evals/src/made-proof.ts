/**
 * proof:made — «קליפ מקוד» end to end (wave 8 motioncode). PRE-PASS STUB: the checks are named here, in order, as W2 writes them (from the
 * contract only, synthetic pages made at proof time) and W1's harness makes them pass. Until MADE_BUILT.harness and MADE_BUILT.routes it
 * prints every check as todo and exits 2 (blocked: not built). Needs `pnpm build`. The gates G0 (made-g0.ts) and G1 (made-g1.ts) are
 * separate scripts and already pass; G2 is apps/server/src/alphaVideo.test.ts.
 * Run through /home/user/PULSEFRAME/.artifacts/heavy. Evidence: docs/evidence/made-proof.json (first line says how the browser was
 * protected: chromium / chromium-dropped-uid / none).
 */
import { MADE_BUILT } from '@pulseframe/core';

export const MADE_PROOF_CHECKS = [
  // G3 (W1): network channels, judged by Chromium's net-log (zero host-resolver jobs, socket connects, UDP, URL requests other than
  // made.invalid) plus loopback TCP and UDP listeners; every name string-built so the static scan does not see them
  'G3.1 fetch, XHR, Image, CSS url(), remote @font-face, WebSocket, EventSource, sendBeacon to 127.0.0.1, localhost and pf-probe.localhost: zero in the net-log and at the listeners',
  'G3.2 RTCPeerConnection with STUN on 127.0.0.1, in the page and in an about:blank iframe: zero UDP (G0 measured 3 datagrams without the init-script lock)',
  'G3.3 WebTransport, link prefetch and dns-prefetch, speculation rules, a blob: Worker: zero',
  'G3.4 location.href, window.open, form submit: the job fails with made_navigated on any framenavigated after load; zero requests',
  'G3.5 the editor\'s own port: a page cannot reach the server it was submitted to (route abort + dead proxy for loopback)',
  'G3.6 internet files: a page naming an https URL gets it fetched ONCE before drawing (recorded url + sha256, served from https://made.invalid/fetched/); while drawing the net-log stays at zero; a failing address fails the job with made_fetch_failed naming it',
  // G4 (W1): determinism
  'G4.1 the five built-in pages: two passes equal byte for byte (or pixel for pixel) at frames 0, n/2, n-1 and three frames from a per-job seed',
  'G4.2 a page that counts render calls fails with made_not_deterministic naming a compared frame',
  'G4.3 fonts are loaded before frame 0: Canvas text in frame 0 is drawn in Heebo 700 (document.fonts.check true in the report); an unlisted family warns made_font_missing and still renders',
  'G4.4 clock reads through string-built names (Date.now, Math.random, requestAnimationFrame, Intl.DateTimeFormat, document.timeline) are reported as made_clock warnings with API and frame',
  // G-webgl (W1; owner addition 2026-11-26)
  'G-webgl.1 a three.js page (three@0.187.0 served at https://made.invalid/lib/) renders N frames WITH alpha here on the software renderer; time per frame recorded (one sample, labelled)',
  'G-webgl.2 two passes of that page on this machine: differing pixels counted; a difference is the warning made_webgl_differs, never a failure',
  // plan checks, as corrected
  '1 a Canvas title page (Hebrew text, a colour), 2 s at 30 fps, 640x360: 60 frames, VP9 with alpha, duration T.frameTime(60, rate) exactly, colour tagged bt709',
  '2 a CSS @keyframes page: a 20 px square from x=0 to x=600 over 60 frames; first opaque column within 1 px of 10k in decoded frame k',
  '5 SMIL (<animate>) is seeked or warned, never wall-clock',
  '7 flashing page (white/transparent every 2 frames at 30 fps): the job SUCCEEDS with made_flash warning and its measured rate on black and on white (decision 3)',
  '8 empty page: made_empty',
  '10 infinite loop in render(5): made_frame_timeout within 2 s + 10 s; the next job succeeds; an export started meanwhile completes',
  '11 memory hog: made_crashed; the next job succeeds',
  '12 cancel at frame 20 of 120: canceled, nothing imported, no context left open, blobs not pinned after dismissal',
  '13 apply with place at frame 30 as an AGENT credential: one top track and one clip, committed as that agent; undo removes clip, track and asset; render_frame shows the background through; the paused preview equals render_frame at 3 frames; draft playback uses the original (no proxy)',
  '14 edit and re-render, apply replace with 2 clips (one in a second sequence): ids, starts, durations, effects kept; one undo restores both',
  '15 agents over MCP: submit_made_clip with then.place applies itself (open semantics); view_made_clip returns 3 images to the submitter, 403 to another agent; an observer is refused; a second active render 429 made_busy; agents paused: refused',
  '16 archive and collector: the archive holds the page blob; an import as a new project reopens the page; storage clean-up does not list it',
  '17 a transparent WebM made by another tool (the G1 file) imported through the ordinary upload composites with alpha in render_frame',
  '18 all five built-in pages render with Hebrew and with English values; pictures written for the integrator to look at (RTL: the first opaque column of «טיול לגליל 2026» sits on the right)',
] as const;

if (import.meta.url === `file://${process.argv[1]}`) {
  const built = MADE_BUILT.harness && MADE_BUILT.routes;
  for (const c of MADE_PROOF_CHECKS) console.log(`${built ? 'TODO-WRITE' : 'todo'} ${c}`);
  if (!built) { console.log(`\nproof:made — blocked: the harness and the routes are not built in this build (${MADE_PROOF_CHECKS.length} checks named)`); process.exit(2); }
  console.error('proof:made: the checks are named but not written yet (W2)'); process.exit(1);
}
