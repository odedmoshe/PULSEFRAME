/**
 * proof:made — «קליפ מקוד» end to end (wave 8 motioncode). Written by W2 from the CONTRACT ONLY (core madeContract.ts, server
 * made/contract.ts, the REST routes and the two MCP tools): no harness internals are read. Every page is synthetic and written here, at
 * proof time; every file is made and deleted in a temporary folder. Needs `pnpm build`; run through /home/user/PULSEFRAME/.artifacts/heavy.
 * Until MADE_BUILT.harness and MADE_BUILT.routes it prints the checks and exits 2 (blocked: not built).
 *
 * How the checks judge (each is a sentence that can fail; numbers are printed either way):
 * - G3 (network): loopback TCP and UDP listeners on random ports count connections, bytes and datagrams; each attack page also paints
 *   one 8 px square per attempt — green when the attempt failed or got no answer within 800 ms, red when it got an answer — so the
 *   decoded frame says what the page itself saw. The net-log the harness keeps is not in the contract: G3 is judged here by the
 *   listeners and the page's own squares (the integrator adds the net-log count if W1 puts it in the report).
 * - Files are decoded with ffmpeg's libvpx-vp9 (the native decoder drops alpha) to RGBA.
 * - A report's `why` is the key of core MADE_JOB_FAILURES / MADE_WARNINGS (MadeJobReport's type), e.g. 'frameTimeout' for the row made_frame_timeout.
 * - Times are one sample on this machine.
 * Evidence: docs/evidence/made-proof.json. Its FIRST LINE says how the browser was protected (record.sandbox of the first render).
 * Pictures for the integrator to look at (check 18): docs/evidence/made-proof/*.png. Nobody has looked at them.
 * Exit 0 = every check passed; 1 = a check failed; 2 = blocked (not built, no bundle, Chromium will not start).
 */
import { execFileSync } from 'node:child_process';
import dgram from 'node:dgram';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { MADE_BUILT, MADE_LIBRARIES, MADE_LIMITS, type MadeJobReport } from '@pulseframe/core';

export const MADE_PROOF_CHECKS = [
  // G3 (W1): network channels, judged by loopback TCP and UDP listeners and by the page's own outcome squares; every name string-built so
  // the static scan does not see them (the harness's net-log is not in the contract: see the header)
  'G3.1 fetch, XHR, Image, CSS url(), remote @font-face, WebSocket, EventSource, sendBeacon to 127.0.0.1, localhost and pf-probe.localhost: zero at the listeners, every attempt failed in the page',
  'G3.2 RTCPeerConnection with STUN on 127.0.0.1, in the page and in an about:blank iframe: zero UDP (G0 measured 3 datagrams without the init-script lock)',
  'G3.3 WebTransport, link prefetch and dns-prefetch, speculation rules, a blob: Worker: zero',
  'G3.4 location.href, window.open, form submit: the job fails with made_navigated on any framenavigated after load; zero requests',
  'G3.5 the editor\'s own port: a page cannot reach the server it was submitted to (every attempt failed in the page)',
  'G3.6 internet files: a page naming an https URL gets it fetched ONCE before drawing (recorded url + sha256); a failing address fails the job with made_fetch_failed naming it',
  // G4 (W1): determinism
  'G4.1 the five built-in pages: two passes compared at frames 0, n/2, n-1 and three frames from a per-job seed (the record lists them)',
  'G4.2 a page that counts render calls fails with made_not_deterministic naming a compared frame',
  'G4.3 fonts are loaded before frame 0: a Heebo 700 page has no made_font_missing; an unlisted family warns made_font_missing and still renders',
  'G4.4 clock reads through string-built names (Date.now, Math.random, requestAnimationFrame, Intl.DateTimeFormat, document.timeline) are reported as made_clock warnings with API and frame',
  // G-webgl (W1; owner addition 2026-11-26)
  'G-webgl.1 a three.js page (three@0.187.0 served at https://made.invalid/lib/) renders N frames WITH alpha here on the software renderer; time per frame recorded (one sample, labelled)',
  'G-webgl.2 two passes of that page on this machine: differing pixels counted; a difference is the warning made_webgl_differs, never a failure',
  // plan checks, as corrected
  '1 a Canvas title page (Hebrew text, a colour), 2 s at 30 fps, 640x360: 60 frames, VP9 with alpha, duration T.frameTime(60, rate) exactly, colour tagged bt709',
  '2 a CSS @keyframes page: a 20 px square from x=0 to x=600 over 60 frames; first opaque column within 1 px of 10k in decoded frame k',
  '5 SMIL (<animate>) is warned at submit and never wall-clock (two renders give the same columns)',
  '7 flashing page (white/transparent every 2 frames at 30 fps): the job SUCCEEDS with made_flash warning and its measured rate on black and on white (decision 3)',
  '8 empty page: made_empty',
  '10 infinite loop in render(5): made_frame_timeout within 2 s + 10 s; the next job succeeds; an export started meanwhile completes',
  '11 memory hog: made_crashed; the next job succeeds',
  '12 cancel at frame 20 of 120: canceled, nothing imported, blobs not pinned after dismissal',
  '13 apply with place at frame 30 as an AGENT credential: one top track and one clip, committed as that agent; undo removes clip, track and asset; redo restores; render_frame shows the background through; the paused preview equals render_frame at 3 frames; draft playback uses the original (no proxy)',
  '14 edit and re-render, apply replace with 2 clips (one in a second sequence): ids, starts, durations, effects kept; one undo restores both',
  '15 agents over MCP: submit_made_clip with then.place applies itself (open semantics); view_made_clip returns 3 images to the submitter, an error to another agent; an observer is refused; a second active render 429 made_busy; agents paused: refused',
  '16 archive and collector: the archive holds the page blob; an import as a new project reopens the page; storage clean-up does not list it',
  '17 a transparent WebM made by another tool (the G1 file) imported through the ordinary upload composites with alpha in render_frame',
  '18 all five built-in pages render with Hebrew and with English values; pictures written for the integrator to look at (RTL: the opaque box of «טיול לגליל 2026» recorded beside the English one)',
] as const;

// ---------------------------------------------------------------- synthetic pages (from the contract: window.PF, PF.render(frame, t))
/** A page that draws `body` into a full-size canvas each frame (ctx, W, H, frame, t and F = PF.fields in scope). */
export const canvasPage = (body: string, head = '') => `<!doctype html><html><head><meta charset="utf-8">${head}<style>html,body{margin:0;background:transparent}</style></head><body><canvas id="c"></canvas><script>
const c = document.getElementById('c'); c.width = PF.width; c.height = PF.height; const ctx = c.getContext('2d'); const W = PF.width, H = PF.height, F = PF.fields;
PF.render = async (frame, t) => { ctx.clearRect(0, 0, W, H); ${body} };
</script></body></html>`;
/** Page 1: a Hebrew title in a colour, rising with the frame number. */
export const TITLE_PAGE = canvasPage(`ctx.direction = /[\\u0590-\\u05ff]/.test(F.title) ? 'rtl' : 'ltr'; ctx.textAlign = 'center'; ctx.fillStyle = F.colour; ctx.font = '700 48px Heebo'; ctx.fillText(F.title, W / 2, H / 2 + 40 - Math.min(40, frame));`);
export const TITLE_FIELDS = [
  { key: 'title', kind: 'text', label: { he: 'כותרת', en: 'Title' }, default: 'טיול לגליל 2026' },
  { key: 'colour', kind: 'colour', label: { he: 'צבע', en: 'Colour' }, default: '#ffcc00' },
] as const;
/** Page 2: CSS @keyframes, a 20 px square from x=0 to x=600 over 2 s, linear (seeked by the harness). */
export const KEYFRAMES_PAGE = `<!doctype html><html><head><style>html,body{margin:0;background:transparent}#s{position:absolute;top:0;left:0;width:20px;height:20px;background:#00ff00;animation:m 2s linear forwards}@keyframes m{from{left:0}to{left:600px}}</style></head><body><div id="s"></div></body></html>`;
/** Check 5: SMIL. */
export const SMIL_PAGE = `<!doctype html><html><body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect y="0" width="20" height="20" fill="#00ff00"><animate attributeName="x" from="0" to="600" dur="2s" fill="freeze"/></rect></svg></body></html>`;
/** Check 7: full-frame white and transparent alternating every 2 frames. */
export const FLASH_PAGE = canvasPage(`if (Math.floor(frame / 2) % 2 === 0) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); }`);
export const EMPTY_PAGE = canvasPage('');
export const LOOP_PAGE = canvasPage(`ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 20, 20); if (frame === 5) { for (;;) {} }`);
export const HOG_PAGE = canvasPage(`ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 20, 20); const keep = []; for (;;) keep.push(new Float64Array(1 << 20));`);
export const COUNTER_STATE_PAGE = `<!doctype html><html><body style="margin:0"><canvas id="c"></canvas><script>const c = document.getElementById('c'); c.width = PF.width; c.height = PF.height; const ctx = c.getContext('2d'); let calls = 0;
PF.render = (frame) => { calls++; ctx.clearRect(0, 0, c.width, c.height); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 10 * calls, 10); };</script></body></html>`;
export const fontPage = (family: string) => canvasPage(`ctx.fillStyle = '#ffffff'; ctx.font = '700 40px ${family}'; ctx.fillText('שלום', 20, 60);`);
/** G4.4: clock reads through string-built names; the drawing itself depends on the frame only. */
export const CLOCK_PAGE = canvasPage(`const w = window; void w['Da' + 'te']['n' + 'ow'](); void w['Ma' + 'th']['ran' + 'dom'](); try { w['request' + 'AnimationFrame'](() => {}); } catch {} try { new w['In' + 'tl']['Date' + 'TimeFormat']().format(); } catch {} void document['time' + 'line']?.currentTime;
ctx.fillStyle = '#ffffff'; ctx.fillRect(frame, 0, 10, 10);`);

/**
 * G3: an attack page. Each attempt is a function returning a promise that resolves true when the attempt got an answer and false when
 * it failed; the page races each against 800 ms and paints square i (8 px, row 0) green for failed or no answer, red for answered.
 * Names are string-built so the static scan does not see them.
 */
export function attackPage(attempts: string[], extraHead = '') {
  return canvasPage(`const w = window, d = document, g = (o, k) => o[k];
const tries = [${attempts.map((a) => `() => (${a})`).join(',\n')}];
const outcome = await Promise.all(tries.map((f) => { let p; try { p = Promise.resolve(f()); } catch { p = Promise.resolve(false); } return Promise.race([p.then((x) => !!x, () => false), new Promise((r) => setTimeout(r, 800, false))]); }));
outcome.forEach((answered, i) => { ctx.fillStyle = answered ? '#ff0000' : '#00ff00'; ctx.fillRect(i * 8, 0, 8, 8); });
ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 20, 40, 40);`, extraHead);
}
const FETCH = (url: string) => `g(w, 'fe' + 'tch')(${JSON.stringify(url)}).then(() => true)`;
const XHR = (url: string) => `new Promise((r) => { const x = new (g(w, 'XMLHttp' + 'Request'))(); x.onload = () => r(true); x.onerror = () => r(false); x.open('GET', ${JSON.stringify(url)}); x.send(); })`;
const IMG = (url: string) => `new Promise((r) => { const i = new (g(w, 'Im' + 'age'))(); i.onload = () => r(true); i.onerror = () => r(false); i.src = ${JSON.stringify(url)}; })`;
const WS = (url: string) => `new Promise((r) => { const s = new (g(w, 'Web' + 'Socket'))(${JSON.stringify(url)}); s.onopen = () => r(true); s.onerror = () => r(false); })`;
const ES = (url: string) => `new Promise((r) => { const s = new (g(w, 'Event' + 'Source'))(${JSON.stringify(url)}); s.onopen = () => r(true); s.onerror = () => r(false); })`;
const BEACON = (url: string) => `(g(navigator, 'send' + 'Beacon').call(navigator, ${JSON.stringify(url)}, 'x'), false)`;
const CSSURL = (url: string) => `new Promise((r) => { const e = d.createElement('div'); e.style.backgroundImage = 'url(' + ${JSON.stringify(url)} + ')'; d.body.appendChild(e); setTimeout(() => r(false), 300); })`;
const FONTFACE = (url: string) => `new (g(w, 'Font' + 'Face'))('pfprobe', 'url(' + ${JSON.stringify(url)} + ')').load().then(() => true)`;
const STUN = (port: number, inFrame: boolean) => `new Promise((r) => { const host = ${inFrame} ? (() => { const f = d.createElement('iframe'); f.src = 'about:blank'; d.body.appendChild(f); return f.contentWindow; })() : w; const PC = host && g(host, 'RTCPeer' + 'Connection'); if (!PC) return r(false); const pc = new PC({ iceServers: [{ urls: 'stun:127.0.0.1:${port}' }] }); pc.createDataChannel('x'); pc.createOffer().then((o) => pc.setLocalDescription(o)); setTimeout(() => r(false), 600); })`;

// ---------------------------------------------------------------- the run
if (import.meta.url === `file://${process.argv[1]}`) await main();

async function main() {
  const built = MADE_BUILT.harness && MADE_BUILT.routes;
  if (!built) {
    for (const c of MADE_PROOF_CHECKS) console.log(`todo ${c}`);
    console.log(`\nproof:made — blocked: the harness and the routes are not built in this build (${MADE_PROOF_CHECKS.length} checks named)`);
    process.exit(2);
  }
  const root = path.resolve(import.meta.dirname, '../../..');
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) { console.error('web bundle missing: run `pnpm build` first'); process.exit(2); }
  const { startServer } = await import('@pulseframe/server');
  const { jobPins, storageReport } = await import('../../../apps/server/src/storage.ts');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-made-proof-'));
  const pics = path.join(root, 'docs/evidence/made-proof');
  fs.mkdirSync(pics, { recursive: true });
  const R = { num: 30, den: 1 }, W = 640, H = 360, f = (n: number) => T.frameTime(n, R);
  const results: { check: string; pass: boolean | 'skipped'; numbers: Record<string, unknown> }[] = [];
  let sandbox = 'unknown';
  const s = await startServer({ port: 0, dataDir: path.join(work, 'data') });
  const OWNER = { actor: 'user:local', kind: 'user' as const, scopes: ['observe', 'edit'] as ('observe' | 'edit')[] };
  const cookie = s.auth.issueSession(new Request(`${s.url}/api/v1/session`, { headers: { origin: s.url, 'x-pf-owner-key': s.auth.tokens.owner } })).split(';')[0]!;
  type Who = Record<string, string>;
  const owner: Who = { origin: s.url, cookie, connection: 'close' };
  const bearer = (t: string): Who => ({ authorization: `Bearer ${t}`, connection: 'close' });
  const grant = (name: string, mode: 'edit' | 'propose' | 'observe' = 'edit') => bearer(s.governance.createGrant({ name, mode }, OWNER).token);
  const agentA = grant('proof-a'), agentB = grant('proof-b'), observer = bearer(s.auth.tokens.observer);
  const call = async (who: Who, method: string, p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method, headers: { ...who, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const raw = Buffer.from(await r.arrayBuffer());
    return { status: r.status, retryAfter: r.headers.get('retry-after'), raw, body: (r.headers.get('content-type') ?? '').includes('json') ? JSON.parse(raw.toString()) : null } as { status: number; retryAfter: string | null; raw: Buffer; body: any };
  };
  const tx = async (who: Who, pid: string, ops: unknown[]) => { const r = await call(who, 'POST', `/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`transaction: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
  const newProject = async (name: string) => (await call(owner, 'POST', '/projects', { name, width: W, height: H, frameRate: R })).body.project.id as string;
  const doc = async (pid: string) => (await call(owner, 'GET', `/projects/${pid}`)).body.project;
  const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { input, maxBuffer: 1 << 30 });
  const probe = (file: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=codec_name,width,height,nb_read_frames,color_space,color_primaries,color_transfer:stream_tags', '-of', 'json', file]).toString()).streams[0];
  /** decoded RGBA frames of a WebM (libvpx-vp9 keeps the alpha) */
  const decode = (file: string, w: number, h: number) => { const b = ff(['-c:v', 'libvpx-vp9', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']); const n = b.length / (w * h * 4); return { n, frame: (k: number) => b.subarray(k * w * h * 4, (k + 1) * w * h * 4) }; };
  const px = (fr: Buffer, w: number, x: number, y: number) => { const i = (y * w + x) * 4; return [fr[i]!, fr[i + 1]!, fr[i + 2]!, fr[i + 3]!]; };
  const firstOpaqueColumn = (fr: Buffer, w: number, y: number) => { for (let x = 0; x < w; x++) if (px(fr, w, x, y)[3]! > 128) return x; return -1; };
  const opaqueBox = (fr: Buffer, w: number, h: number) => { let x0 = w, x1 = -1, y0 = h, y1 = -1; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (fr[(y * w + x) * 4 + 3]! > 128) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return x1 < 0 ? null : { x0, x1, y0, y1 }; };
  const record = (check: string, pass: boolean | 'skipped', numbers: Record<string, unknown> = {}) => { results.push({ check, pass, numbers }); console.log(`${pass === true ? 'PASS' : pass === 'skipped' ? 'SKIP' : 'FAIL'} ${check} ${JSON.stringify(numbers).slice(0, 900)}`); };
  const guard = async (check: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { record(check, false, { error: String((e as Error)?.stack ?? e).slice(0, 600) }); } };

  const render = async (who: Who, pid: string, body: Record<string, unknown>) => {
    const t0 = Date.now();
    const r = await call(who, 'POST', `/projects/${pid}/made/render`, { name: 'proof', seconds: 2, ...body });
    if (r.status !== 202) return { submit: r, jobId: '', t0 };
    return { submit: r, jobId: r.body.jobId as string, t0 };
  };
  const TERMINAL = new Set(['succeeded', 'failed', 'canceled']);
  const wait = async (who: Who, pid: string, jobId: string, onProgress?: (rep: MadeJobReport) => Promise<boolean | void>, limitMs = MADE_LIMITS.jobMs + 60_000) => {
    const until = Date.now() + limitMs;
    for (;;) {
      const r = await call(who, 'GET', `/projects/${pid}/made/jobs/${jobId}`);
      if (r.status !== 200) throw new Error(`report: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
      const rep = r.body as MadeJobReport & { autoApply?: { status: string } };
      if (rep.record?.sandbox && sandbox === 'unknown') sandbox = rep.record.sandbox;
      if (onProgress && (await onProgress(rep))) continue;
      if (TERMINAL.has(rep.status)) return rep;
      if (Date.now() > until) throw new Error(`job ${jobId} did not finish in ${limitMs} ms (stage ${rep.stage})`);
      await new Promise((ok) => setTimeout(ok, 250));
    }
  };
  const fileOf = async (who: Who, pid: string, jobId: string, name: string) => { const r = await call(who, 'GET', `/projects/${pid}/made/jobs/${jobId}/file`); if (r.status !== 200) throw new Error(`file: ${r.status}`); const p = path.join(work, name); fs.writeFileSync(p, r.raw); return p; };
  const renderDone = async (who: Who, pid: string, body: Record<string, unknown>) => { const j = await render(who, pid, body); if (!j.jobId) return { ...j, rep: null as MadeJobReport | null }; return { ...j, rep: await wait(who, pid, j.jobId) as MadeJobReport | null }; };
  const warnWhys = (rep: MadeJobReport | null) => (rep?.warnings ?? []).map((w) => w.why);

  // loopback listeners for G3
  let tcpConnections = 0, tcpBytes = 0, udpDatagrams = 0;
  const tcp = net.createServer((sock) => { tcpConnections++; sock.on('data', (d) => { tcpBytes += d.length; }); sock.on('error', () => {}); });
  await new Promise<void>((ok) => tcp.listen(0, '127.0.0.1', ok));
  const P = (tcp.address() as net.AddressInfo).port;
  const udp = dgram.createSocket('udp4');
  udp.on('message', () => { udpDatagrams++; });
  await new Promise<void>((ok) => udp.bind(0, '127.0.0.1', ok));
  const U = udp.address().port;
  const listeners = () => ({ tcpConnections, tcpBytes, udpDatagrams });
  /** decoded frame 0 of a finished attack page: are all n squares green (every attempt failed)? */
  const squares = async (who: Who, pid: string, jobId: string, n: number) => {
    const file = await fileOf(who, pid, jobId, `${jobId}.webm`);
    const fr = decode(file, W, H).frame(0);
    const colours = Array.from({ length: n }, (_, i) => { const [r, g] = px(fr, W, i * 8 + 4, 4); return g! > 128 && r! < 128 ? 'failed' : r! > 128 ? 'ANSWERED' : 'unclear'; });
    return { allFailed: colours.every((c) => c === 'failed'), colours };
  };

  try {
    const pid = await newProject('made proof');
    const hosts = [`127.0.0.1:${P}`, `localhost:${P}`, `pf-probe.localhost:${P}`];

    await guard(MADE_PROOF_CHECKS[0], async () => {
      const before = listeners();
      const tries = hosts.flatMap((h) => [FETCH(`http://${h}/f`), XHR(`http://${h}/x`), IMG(`http://${h}/i.png`), CSSURL(`http://${h}/c.png`), FONTFACE(`http://${h}/font.woff2`), WS(`ws://${h}/w`), ES(`http://${h}/e`), BEACON(`http://${h}/b`)]);
      const { rep } = await renderDone(owner, pid, { page: attackPage(tries), seconds: 0.1 });
      const sq = rep?.status === 'succeeded' ? await squares(owner, pid, rep.jobId, tries.length) : null;
      const after = listeners();
      record(MADE_PROOF_CHECKS[0], after.tcpConnections === before.tcpConnections && after.tcpBytes === before.tcpBytes && (sq?.allFailed ?? true), { listeners: after, job: rep?.status, failure: rep?.failure?.why, squares: sq?.colours });
    });
    await guard(MADE_PROOF_CHECKS[1], async () => {
      const before = listeners();
      const { rep } = await renderDone(owner, pid, { page: attackPage([STUN(U, false), STUN(U, true)]), seconds: 0.1 });
      record(MADE_PROOF_CHECKS[1], listeners().udpDatagrams === before.udpDatagrams, { udpDatagrams: listeners().udpDatagrams - before.udpDatagrams, job: rep?.status, failure: rep?.failure?.why });
    });
    await guard(MADE_PROOF_CHECKS[2], async () => {
      const before = listeners();
      const h = hosts[0]!;
      const head = `<link rel="prefetch" href="http://${h}/pre"><link rel="dns-prefetch" href="//pf-probe.localhost"><script type="speculationrules">{"prefetch":[{"source":"list","urls":["http://${h}/spec"]}]}</script>`;
      const tries = [`(g(w, 'Web' + 'Transport') ? new (g(w, 'Web' + 'Transport'))('https://${h}/wt').ready.then(() => true) : false)`,
        `new Promise((r) => { const src = 'fetch("http://${h}/wk").then(() => postMessage(1), () => postMessage(0))'; const k = new (g(w, 'Wor' + 'ker'))(URL.createObjectURL(new Blob([src]))); k.onmessage = (e) => r(e.data === 1); k.onerror = () => r(false); })`];
      const { rep } = await renderDone(owner, pid, { page: attackPage(tries, head), seconds: 0.1 });
      const sq = rep?.status === 'succeeded' ? await squares(owner, pid, rep.jobId, tries.length) : null;
      const after = listeners();
      record(MADE_PROOF_CHECKS[2], after.tcpConnections === before.tcpConnections && after.udpDatagrams === before.udpDatagrams && (sq?.allFailed ?? true), { listeners: after, job: rep?.status, failure: rep?.failure?.why, squares: sq?.colours });
    });
    await guard(MADE_PROOF_CHECKS[3], async () => {
      const out: Record<string, unknown> = {};
      let ok = true;
      for (const [name, js] of [['location', `w['loca' + 'tion']['hr' + 'ef'] = 'http://${hosts[0]}/nav'`], ['window.open', `w['op' + 'en']('http://${hosts[0]}/open')`], ['form', `(() => { const f = d.createElement('fo' + 'rm'); f.action = 'http://${hosts[0]}/form'; f.method = 'post'; d.body.appendChild(f); f.submit(); })()`]] as const) {
        const before = listeners();
        const { rep } = await renderDone(owner, pid, { page: canvasPage(`if (frame === 1) { ${js}; } ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 20, 20);`), seconds: 0.2 });
        const zero = listeners().tcpConnections === before.tcpConnections;
        // window.open opens no frame of this page, so it need not fail the job; a navigation of the page itself must
        const navigatedOrNoNav = name === 'window.open' ? true : rep?.failure?.why === 'navigated';
        out[name] = { job: rep?.status, failure: rep?.failure?.why, zeroAtListeners: zero };
        ok &&= zero && navigatedOrNoNav;
      }
      record(MADE_PROOF_CHECKS[3], ok, out);
    });
    await guard(MADE_PROOF_CHECKS[4], async () => {
      const e = new URL(s.url).host;
      const tries = [FETCH(`http://${e}/api/v1/made/templates`), XHR(`http://${e}/api/v1/projects`), IMG(`http://${e}/favicon.ico`), WS(`ws://${e}/api/v1/events`), FETCH(`http://localhost:${new URL(s.url).port}/`)];
      const { rep } = await renderDone(owner, pid, { page: attackPage(tries), seconds: 0.1 });
      const sq = rep?.status === 'succeeded' ? await squares(owner, pid, rep.jobId, tries.length) : null;
      record(MADE_PROOF_CHECKS[4], !!sq?.allFailed, { job: rep?.status, failure: rep?.failure?.why, squares: sq?.colours, note: 'judged by the page\'s own outcome squares (the editor port has no listener of ours)' });
    });
    await guard(MADE_PROOF_CHECKS[5], async () => {
      const bad = 'https://pf-proof.invalid/none.png';
      const { rep } = await renderDone(owner, pid, { page: canvasPage(`const i = new Image(); i.src = ${JSON.stringify(bad)}; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 9, 9);`), seconds: 0.1 });
      const failedRight = rep?.failure?.why === 'fetchFailed' && rep.failure.message.includes(bad);
      const good = process.env.PF_MADE_PROOF_FETCH_URL;
      if (!good) { record(MADE_PROOF_CHECKS[5], failedRight ? 'skipped' : false, { failingAddress: { job: rep?.status, failure: rep?.failure }, reachable: 'not run: no internet file named here (set PF_MADE_PROOF_FETCH_URL to an https picture)' }); return; }
      const before = listeners();
      const g = await renderDone(owner, pid, { page: canvasPage(`const i = new Image(); i.src = ${JSON.stringify(good)}; await i.decode().catch(() => {}); ctx.drawImage(i, 0, 0, 64, 64);`), seconds: 0.2 });
      const fetched = g.rep?.record?.fetched ?? [];
      record(MADE_PROOF_CHECKS[5], failedRight && g.rep?.status === 'succeeded' && fetched.length === 1 && fetched[0]!.url === good && /^sha256:[0-9a-f]{64}$/.test(fetched[0]!.sha256) && listeners().tcpConnections === before.tcpConnections, { failingAddress: rep?.failure, fetched });
    });

    await guard(MADE_PROOF_CHECKS[6], async () => {
      const out: Record<string, unknown> = {};
      let ok = true;
      const templates = (await call(owner, 'GET', '/made/templates')).body.templates as { id: string; seconds: number }[];
      for (const t of templates) {
        const { rep } = await renderDone(owner, pid, { page: { templateId: t.id }, seconds: t.seconds });
        const frames = rep?.record?.checks.determinism.frames ?? [];
        const n = rep?.record?.frames ?? 0;
        const fixed = [0, Math.floor(n / 2), n - 1].every((k) => frames.includes(k)) || frames.length === 0;
        out[t.id] = { job: rep?.status, failure: rep?.failure?.why, frames, n };
        ok &&= rep?.status === 'succeeded' && fixed && frames.length === MADE_LIMITS.determinismFrames;
      }
      record(MADE_PROOF_CHECKS[6], ok, out);
    });
    await guard(MADE_PROOF_CHECKS[7], async () => {
      const { rep } = await renderDone(owner, pid, { page: COUNTER_STATE_PAGE, seconds: 1 });
      const m = /frame (\d+)/.exec(rep?.failure?.message ?? '');
      record(MADE_PROOF_CHECKS[7], rep?.failure?.why === 'notDeterministic' && !!m, { job: rep?.status, failure: rep?.failure });
    });
    await guard(MADE_PROOF_CHECKS[8], async () => {
      const heebo = await renderDone(owner, pid, { page: fontPage('Heebo'), seconds: 0.2 });
      const other = await renderDone(owner, pid, { page: fontPage('PfNoSuchFamily'), seconds: 0.2 });
      const named = (other.rep?.warnings ?? []).find((w) => w.why === 'fontMissing');
      record(MADE_PROOF_CHECKS[8], heebo.rep?.status === 'succeeded' && !warnWhys(heebo.rep).includes('fontMissing') && other.rep?.status === 'succeeded' && !!named?.message.includes('PfNoSuchFamily'), { heebo: { job: heebo.rep?.status, warnings: warnWhys(heebo.rep) }, unlisted: { job: other.rep?.status, warning: named } });
    });
    await guard(MADE_PROOF_CHECKS[9], async () => {
      const { rep } = await renderDone(owner, pid, { page: CLOCK_PAGE, seconds: 0.2 });
      const clocks = (rep?.warnings ?? []).filter((w) => w.why === 'clock').map((w) => w.message);
      const named = ['Date.now', 'Math.random', 'requestAnimationFrame', 'Intl.DateTimeFormat', 'document.timeline'].map((api) => [api, clocks.some((m) => m.includes(api) && /frame \d+/.test(m))] as const);
      record(MADE_PROOF_CHECKS[9], named.every(([, x]) => x), { job: rep?.status, failure: rep?.failure?.why, named: Object.fromEntries(named), clocks });
    });

    await guard(MADE_PROOF_CHECKS[10], async () => {
      const three = MADE_LIBRARIES.find((l) => l.name === 'three')!;
      if (!three.installed) { record(MADE_PROOF_CHECKS[10], false, { blocked: `three@${three.version} is pinned but not installed in this build (MADE_LIBRARIES.installed false)` }); record(MADE_PROOF_CHECKS[11], false, { blocked: 'needs G-webgl.1' }); return; }
      const page = `<!doctype html><html><body style="margin:0;background:transparent"><script type="module">
import * as THREE from 'https://made.invalid/lib/three@${three.version}/build/three.module.js';
const r = new THREE.WebGLRenderer({ alpha: true, preserveDrawingBuffer: true }); r.setSize(PF.width, PF.height); r.setClearColor(0x000000, 0); document.body.appendChild(r.domElement);
const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(50, PF.width / PF.height, 0.1, 100); cam.position.z = 4;
const cube = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), new THREE.MeshNormalMaterial()); scene.add(cube);
PF.render = (frame) => { cube.rotation.set(frame * 0.05, frame * 0.07, 0); r.render(scene, cam); };
</script></body></html>`;
      const { rep } = await renderDone(owner, pid, { page, seconds: 1, capabilities: { webgl: true, libraries: [`three@${three.version}`] } });
      const n = rep?.record?.frames ?? 0;
      record(MADE_PROOF_CHECKS[10], rep?.status === 'succeeded' && rep.record?.webgl === true && rep.record.checks.alpha === true && n === 30, { job: rep?.status, failure: rep?.failure, frames: n, secondsPerFrameOneSample: rep?.seconds && n ? rep.seconds / n : null });
      const differing = rep?.record?.checks.determinism.differingPixels;
      record(MADE_PROOF_CHECKS[11], rep?.status === 'succeeded' && typeof differing === 'number' && (differing === 0 || warnWhys(rep).includes('webglDiffers')), { differingPixels: differing, warnings: warnWhys(rep) });
    });

    // 1: the title page, as the owner, kept in the library
    let titleJob = '';
    await guard(MADE_PROOF_CHECKS[12], async () => {
      const { rep, jobId } = await renderDone(owner, pid, { page: TITLE_PAGE, fields: TITLE_FIELDS, values: { title: 'טיול לגליל 2026', colour: '#ffcc00' }, seconds: 2 });
      titleJob = jobId;
      if (rep?.status !== 'succeeded') { record(MADE_PROOF_CHECKS[12], false, { job: rep?.status, failure: rep?.failure }); return; }
      const file = await fileOf(owner, pid, jobId, 'title.webm');
      const st = probe(file);
      const applied = await call(owner, 'POST', `/projects/${pid}/made/jobs/${jobId}/apply`, { library: true });
      const asset = (await doc(pid)).assets[applied.body?.output?.assetId];
      const exact = !!asset && T.eq(asset.duration, f(60));
      record(MADE_PROOF_CHECKS[12], st.codec_name === 'vp9' && Number(st.nb_read_frames) === 60 && st.width === W && st.height === H && String(st.tags?.alpha_mode ?? st.tags?.ALPHA_MODE) === '1' && st.color_space === 'bt709' && exact && rep.record?.frames === 60,
        { stream: st, assetDuration: asset?.duration, apply: applied.status, warnings: warnWhys(rep), sandbox: rep.record?.sandbox });
    });
    await guard(MADE_PROOF_CHECKS[13], async () => {
      const { rep, jobId } = await renderDone(owner, pid, { page: KEYFRAMES_PAGE, seconds: 2 });
      if (rep?.status !== 'succeeded') { record(MADE_PROOF_CHECKS[13], false, { job: rep?.status, failure: rep?.failure }); return; }
      const d = decode(await fileOf(owner, pid, jobId, 'keyframes.webm'), W, H);
      const cols = [0, 15, 30, 45, 59].map((k) => ({ k, col: firstOpaqueColumn(d.frame(k), W, 10), want: 10 * k }));
      record(MADE_PROOF_CHECKS[13], d.n === 60 && cols.every((c) => Math.abs(c.col - c.want) <= 1), { frames: d.n, cols });
    });
    await guard(MADE_PROOF_CHECKS[14], async () => {
      const a = await renderDone(owner, pid, { page: SMIL_PAGE, seconds: 2 });
      const warned = (a.submit.body?.warnings ?? []).some((w: { what: string }) => w.what.includes('SMIL'));
      if (a.rep?.status !== 'succeeded') { record(MADE_PROOF_CHECKS[14], warned && a.rep?.failure?.why === 'notDeterministic', { warned, job: a.rep?.status, failure: a.rep?.failure }); return; }
      const b = await renderDone(owner, pid, { page: SMIL_PAGE, seconds: 2 });
      const cols = async (jobId: string) => { const d = decode(await fileOf(owner, pid, jobId, `${jobId}.webm`), W, H); return [0, 30, 59].map((k) => firstOpaqueColumn(d.frame(k), W, 10)); };
      const ca = await cols(a.jobId), cb = b.rep?.status === 'succeeded' ? await cols(b.jobId) : null;
      record(MADE_PROOF_CHECKS[14], warned && !!cb && JSON.stringify(ca) === JSON.stringify(cb), { warned, first: ca, second: cb, seekedLike10k: ca.map((c, i) => Math.abs(c - [0, 300, 590][i]!) <= 1) });
    });
    await guard(MADE_PROOF_CHECKS[15], async () => {
      const { rep } = await renderDone(owner, pid, { page: FLASH_PAGE, seconds: 2 });
      const flash = rep?.record?.checks.flash;
      record(MADE_PROOF_CHECKS[15], rep?.status === 'succeeded' && warnWhys(rep).includes('flash') && !!flash && Math.max(flash.black.general, flash.white.general) > MADE_LIMITS.flashPerSecond, { job: rep?.status, flash, warnings: (rep?.warnings ?? []).filter((w) => w.why === 'flash') });
    });
    await guard(MADE_PROOF_CHECKS[16], async () => {
      const { rep } = await renderDone(owner, pid, { page: EMPTY_PAGE, seconds: 0.5 });
      record(MADE_PROOF_CHECKS[16], rep?.failure?.why === 'empty', { job: rep?.status, failure: rep?.failure });
    });
    await guard(MADE_PROOF_CHECKS[17], async () => {
      const xpid = await newProject('made proof export');
      await tx(owner, xpid, [{ op: 'add_text', args: { text: 'export', start: f(0), duration: f(30) } }]);
      let frame5At = 0;
      const loop = await render(owner, pid, { page: LOOP_PAGE, seconds: 1 });
      const exp = await call(owner, 'POST', `/projects/${xpid}/exports`, {});
      const rep = await wait(owner, pid, loop.jobId, async (r) => { if (!frame5At && (r.progress?.frame ?? 0) >= 5) frame5At = Date.now(); });
      const end = Date.now();
      const next = await renderDone(owner, pid, { page: TITLE_PAGE, fields: TITLE_FIELDS, seconds: 0.5 });
      let expStatus = '';
      for (let i = 0; i < 1200 && !['succeeded', 'failed', 'canceled'].includes(expStatus); i++) { expStatus = (await call(owner, 'GET', `/jobs/${exp.body.jobId}`)).body?.status ?? 'none'; await new Promise((ok) => setTimeout(ok, 250)); }
      const within = frame5At ? end - frame5At : end - loop.t0;
      record(MADE_PROOF_CHECKS[17], rep.failure?.why === 'frameTimeout' && within <= MADE_LIMITS.frameMs + 10_000 && next.rep?.status === 'succeeded' && expStatus === 'succeeded', { failure: rep.failure, msFromFrame5ToEnd: within, measuredFrom: frame5At ? 'progress frame 5 seen' : 'submit (frame 5 never seen in progress)', next: next.rep?.status, export: expStatus });
    });
    await guard(MADE_PROOF_CHECKS[18], async () => {
      const { rep } = await renderDone(owner, pid, { page: HOG_PAGE, seconds: 0.5 });
      const next = await renderDone(owner, pid, { page: TITLE_PAGE, fields: TITLE_FIELDS, seconds: 0.5 });
      record(MADE_PROOF_CHECKS[18], rep?.failure?.why === 'crashed' && next.rep?.status === 'succeeded', { failure: rep?.failure, next: next.rep?.status });
    });
    await guard(MADE_PROOF_CHECKS[19], async () => {
      const assetsBefore = Object.keys((await doc(pid)).assets).length;
      const j = await render(owner, pid, { page: canvasPage(`ctx.fillStyle = '#ffffff'; ctx.fillRect(frame, 0, 20, 20);`), seconds: 4 });
      let asked = false, cancelAt = -1;
      const rep = await wait(owner, pid, j.jobId, async (r) => { if (!asked && (r.progress?.frame ?? 0) >= 20) { asked = true; cancelAt = r.progress!.frame; await call(owner, 'POST', `/jobs/${j.jobId}/cancel`, {}); } });
      const dismissed = await call(owner, 'POST', `/projects/${pid}/made/jobs/${j.jobId}/dismiss`, {});
      const row = s.store.db.prepare('SELECT type, status, output, error, updated_at FROM jobs WHERE id = ?').get(j.jobId) as { type: string; status: string; output: string | null; error: string | null; updated_at: string };
      const assetsAfter = Object.keys((await doc(pid)).assets).length;
      record(MADE_PROOF_CHECKS[19], rep.status === 'canceled' && assetsAfter === assetsBefore && !jobPins(row, Date.now()), { status: rep.status, cancelAskedAtFrame: cancelAt, frames: rep.progress?.frames, assetsBefore, assetsAfter, dismiss: dismissed.status, pinned: jobPins(row, Date.now()), note: 'whether a made browser context stays open is the harness\'s to show (not in the contract)' });
    });

    // 13: as an AGENT credential: place, undo, redo, render_frame, the paused preview
    let placedAsset = '', placedClip = '';
    const bgPid = await newProject('made proof place');
    await guard(MADE_PROOF_CHECKS[20], async () => {
      const bgPng = path.join(work, 'bg.png'); ff(['-f', 'lavfi', '-i', `color=c=0x2040c0:s=${W}x${H}`, '-frames:v', '1', '-y', bgPng]);
      const up = await (await fetch(`${s.url}/api/v1/projects/${bgPid}/assets`, { method: 'POST', headers: { ...owner, 'x-filename': 'bg.png' }, body: fs.readFileSync(bgPng) })).json() as { assetId: string };
      await tx(owner, bgPid, [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0), duration: f(120) } }]);
      const before = await doc(bgPid);
      const tracksBefore = before.sequences[before.mainSequenceId].tracks.map((t: { id: string }) => t.id);
      const { rep, jobId } = await renderDone(agentA, bgPid, { page: TITLE_PAGE, fields: TITLE_FIELDS, seconds: 2 });
      if (rep?.status !== 'succeeded') { record(MADE_PROOF_CHECKS[20], false, { job: rep?.status, failure: rep?.failure }); return; }
      const a = await call(agentA, 'POST', `/projects/${bgPid}/made/jobs/${jobId}/apply`, { place: { start: f(30) } });
      const after = await doc(bgPid);
      const tracks = after.sequences[after.mainSequenceId].tracks as { id: string; kind: string; clips: { id: string; start: T.RationalTime; duration: T.RationalTime }[] }[];
      const newTracks = tracks.filter((t) => !tracksBefore.includes(t.id));
      const clip = newTracks[0]?.clips[0];
      const video = tracks.filter((t) => t.kind === 'video');
      const actor = (s.store.db.prepare('SELECT actor FROM transactions WHERE project_id = ? AND revision = ?').get(bgPid, a.body?.revision) as { actor: string } | undefined)?.actor;
      placedAsset = a.body?.output?.assetId ?? ''; placedClip = clip?.id ?? '';
      const placeOk = a.status === 200 && newTracks.length === 1 && video.at(-1)?.id === newTracks[0]!.id && newTracks[0]!.clips.length === 1 && !!clip && T.eq(clip.start, f(30)) && T.eq(clip.duration, f(60)) && actor === 'agent:proof-a';
      // render_frame over the background: a pixel far from the title shows the background
      const still = await call(owner, 'GET', `/projects/${bgPid}/frame?index=45`);
      const rgba = ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], still.raw);
      const corner = px(rgba, W, 5, H - 5);
      const throughOk = Math.abs(corner[0]! - 0x20) <= 3 && Math.abs(corner[1]! - 0x40) <= 3 && Math.abs(corner[2]! - 0xc0) <= 3;
      // undo removes clip, track and asset; redo restores them
      const undo = await call(agentA, 'POST', `/projects/${bgPid}/undo`, {});
      const undone = await doc(bgPid);
      const undoOk = undo.status === 200 && JSON.stringify(undone.sequences) === JSON.stringify(before.sequences) && !undone.assets[placedAsset];
      const redo = await call(agentA, 'POST', `/projects/${bgPid}/redo`, {});
      const redone = await doc(bgPid);
      const redoOk = redo.status === 200 && JSON.stringify(redone.sequences) === JSON.stringify(after.sequences) && !!redone.assets[placedAsset];
      // the paused preview equals render_frame at 3 frames, and draft playback reads the original
      const preview = await previewParity(s.ownerUrl, bgPid, [35, 60, 85], async (k) => (await call(owner, 'GET', `/projects/${bgPid}/frame?index=${k}`)).raw, W, H);
      record(MADE_PROOF_CHECKS[20], placeOk && throughOk && undoOk && redoOk && preview.pass, { placeOk, actor, start: clip?.start, duration: clip?.duration, corner, throughOk, undoOk, redoOk, preview });
    });
    await guard(MADE_PROOF_CHECKS[21], async () => {
      if (!placedAsset) { record(MADE_PROOF_CHECKS[21], false, { blocked: 'needs check 13' }); return; }
      const page = await call(agentA, 'GET', `/projects/${bgPid}/made/assets/${placedAsset}/page`);
      const seq = await tx(agentA, bgPid, [{ op: 'add_sequence', args: { name: 'short' } }]);
      const sid = seq.results[0].output.sequenceId as string;
      const second = await tx(agentA, bgPid, [{ op: 'add_clip', args: { sequenceId: sid, assetId: placedAsset, start: f(0), duration: f(60), withLinkedAudio: false } }]);
      const clip2 = second.results[0].output.clipId as string;
      await tx(agentA, bgPid, [{ op: 'add_effect', args: { clipId: placedClip, type: 'color.grayscale' } }]);
      const before = await doc(bgPid);
      const snap = (d: any, id: string) => { for (const sq of Object.values(d.sequences) as any[]) for (const t of sq.tracks) for (const c of t.clips) if (c.id === id) return { start: c.start, duration: c.duration, effects: c.effects, assetId: c.assetId }; return null; };
      const rec = page.body?.record;
      const { rep, jobId } = await renderDone(agentA, bgPid, { page: page.body?.page, fields: rec?.fields, values: { ...rec?.values, title: 'גרסה שנייה' }, seconds: 2 });
      if (rep?.status !== 'succeeded') { record(MADE_PROOF_CHECKS[21], false, { page: page.status, job: rep?.status, failure: rep?.failure }); return; }
      const a = await call(agentA, 'POST', `/projects/${bgPid}/made/jobs/${jobId}/apply`, { replaceAssetId: placedAsset });
      const after = await doc(bgPid);
      const newId = a.body?.output?.assetId as string;
      const kept = [placedClip, clip2].every((id) => { const x = snap(before, id), y = snap(after, id); return !!x && !!y && JSON.stringify({ ...x, assetId: newId }) === JSON.stringify(y); });
      await call(agentA, 'POST', `/projects/${bgPid}/undo`, {});
      const undone = await doc(bgPid);
      const restored = [placedClip, clip2].every((id) => JSON.stringify(snap(undone, id)) === JSON.stringify(snap(before, id)));
      record(MADE_PROOF_CHECKS[21], page.status === 200 && a.status === 200 && kept && restored && JSON.stringify(a.body.output.replacedClipIds?.sort()) === JSON.stringify([placedClip, clip2].sort()), { replaced: a.body?.output?.replacedClipIds, kept, restored });
    });

    await guard(MADE_PROOF_CHECKS[22], async () => {
      const mpid = await newProject('made proof mcp');
      let rpcId = 0;
      const rpc = async (who: Who, name: string, args: Record<string, unknown>) => {
        const r = await fetch(`${s.url}/mcp`, { method: 'POST', headers: { ...who, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) });
        const text = await r.text();
        return JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text).result as { isError?: boolean; content: { type: string; text?: string; data?: string }[] };
      };
      const sub = await rpc(agentA, 'submit_made_clip', { projectId: mpid, page: { templateId: 'lower-third' }, seconds: 2, name: 'mcp', then: { place: { start: f(0) } } });
      const jobId = JSON.parse(sub.content[0]!.text!).jobId as string;
      const busy = await call(agentA, 'POST', `/projects/${mpid}/made/render`, { page: { templateId: 'counter' }, seconds: 1, name: 'second' });
      let rep = await wait(agentA, mpid, jobId);
      for (let i = 0; i < 40 && (rep as { autoApply?: { status: string } }).autoApply?.status === 'waiting'; i++) { await new Promise((ok) => setTimeout(ok, 250)); rep = (await call(agentA, 'GET', `/projects/${mpid}/made/jobs/${jobId}`)).body; }
      const auto = (rep as { autoApply?: { status: string; revision?: number } }).autoApply;
      const actor = auto?.revision ? (s.store.db.prepare('SELECT actor FROM transactions WHERE project_id = ? AND revision = ?').get(mpid, auto.revision) as { actor: string } | undefined)?.actor : undefined;
      const view = await rpc(agentA, 'view_made_clip', { projectId: mpid, jobId });
      const other = await rpc(agentB, 'view_made_clip', { projectId: mpid, jobId });
      const obs = await rpc(observer, 'submit_made_clip', { projectId: mpid, page: { templateId: 'counter' }, seconds: 1, name: 'obs' });
      await call(owner, 'POST', `/projects/${mpid}/agents/pause`, {});
      const paused = await rpc(agentB, 'submit_made_clip', { projectId: mpid, page: { templateId: 'counter' }, seconds: 1, name: 'paused' });
      await call(owner, 'POST', `/projects/${mpid}/agents/resume`, {});
      const types = view.content.map((c) => c.type);
      record(MADE_PROOF_CHECKS[22], rep.status === 'succeeded' && auto?.status === 'applied' && actor === 'agent:proof-a' && JSON.stringify(types) === JSON.stringify(['text', 'image', 'image', 'image']) && !!other.isError && !!obs.isError && busy.status === 429 && busy.body?.error?.code === 'made_busy' && !!busy.retryAfter && !!paused.isError && (paused.content[0]?.text ?? '').includes('made_agents_paused'),
        { job: rep.status, autoApply: auto, actor, viewTypes: types, otherAgent: other.content[0]?.text?.slice(0, 120), observer: obs.content[0]?.text?.slice(0, 120), busy: { status: busy.status, code: busy.body?.error?.code, retryAfter: busy.retryAfter }, paused: paused.content[0]?.text?.slice(0, 120) });
    });

    await guard(MADE_PROOF_CHECKS[23], async () => {
      const apid = await newProject('made proof archive');
      const { rep, jobId } = await renderDone(owner, apid, { page: TITLE_PAGE, fields: TITLE_FIELDS, seconds: 0.5 });
      if (rep?.status !== 'succeeded') { record(MADE_PROOF_CHECKS[23], false, { job: rep?.status }); return; }
      const a = await call(owner, 'POST', `/projects/${apid}/made/jobs/${jobId}/apply`, { library: true });
      const assetId = a.body.output.assetId as string;
      const pageHex = ((await doc(apid)).assets[assetId].provenance.made.pageSha256 as string).slice(7);
      const arc = await call(owner, 'GET', `/projects/${apid}/archive`);
      const inArchive = arc.raw.includes(Buffer.from(pageHex));
      const imp = await fetch(`${s.url}/api/v1/projects/import`, { method: 'POST', headers: { ...owner, 'content-type': 'application/x-tar' }, body: new Uint8Array(arc.raw) });
      const imported = (await imp.json()) as any;
      const newPid = imported?.project?.id as string;
      const back = newPid ? await call(owner, 'GET', `/projects/${newPid}/made/assets/${assetId}/page`) : null;
      const hashes = (storageReport(s.store, OWNER).unreferenced as unknown as { hashes: string[] }).hashes.map((h) => h.replace(/^sha256:/, ''));
      record(MADE_PROOF_CHECKS[23], inArchive && imp.status === 201 && back?.status === 200 && back.body.page === TITLE_PAGE && !hashes.includes(pageHex), { inArchive, import: imp.status, reopened: back?.status, samePage: back?.body?.page === TITLE_PAGE, listedForCleanUp: hashes.includes(pageHex) });
    });
    await guard(MADE_PROOF_CHECKS[24], async () => {
      const gpid = (await call(owner, 'POST', '/projects', { name: 'made proof g1', width: 320, height: 240, frameRate: R })).body.project.id as string;
      const file = path.join(work, 'other-tool.webm');
      ff(['-f', 'lavfi', '-i', 'color=c=0x2060e0:s=320x240:r=30:d=1', '-vf', "scale=out_color_matrix=bt709:out_range=tv,format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lt(X,160),0,255)'", '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-b:v', '0', '-crf', '10', '-metadata:s:v:0', 'alpha_mode=1', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-y', file]);
      const red = path.join(work, 'red.png'); ff(['-f', 'lavfi', '-i', 'color=c=red:s=320x240', '-frames:v', '1', '-y', red]);
      const up = async (p: string) => ((await (await fetch(`${s.url}/api/v1/projects/${gpid}/assets`, { method: 'POST', headers: { ...owner, 'x-filename': path.basename(p) }, body: fs.readFileSync(p) })).json()) as { assetId: string }).assetId;
      const redId = await up(red), alphaId = await up(file);
      await tx(owner, gpid, [{ op: 'add_clip', args: { assetId: redId, start: f(0), duration: f(30) } }]);
      const trackId = (await tx(owner, gpid, [{ op: 'add_track', args: { kind: 'video' } }])).results[0].output.trackId as string;
      await tx(owner, gpid, [{ op: 'add_clip', args: { assetId: alphaId, trackId, start: f(0), duration: f(30), withLinkedAudio: false } }]);
      const still = await call(owner, 'GET', `/projects/${gpid}/frame?index=10`);
      const b = ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], still.raw);
      const left = px(b, 320, 40, 120), right = px(b, 320, 280, 120);
      record(MADE_PROOF_CHECKS[24], still.status === 200 && left[0]! >= 253 && left[1]! <= 2 && left[2]! <= 2 && right[0]! < 100, { left, right, hasAlpha: (await doc(gpid)).assets[alphaId]?.video?.hasAlpha });
    });
    await guard(MADE_PROOF_CHECKS[25], async () => {
      const templates = (await call(owner, 'GET', '/made/templates')).body.templates as { id: string; seconds: number; samples: { he: Record<string, string>; en: Record<string, string> } }[];
      const out: Record<string, unknown> = {};
      let ok = true;
      for (const t of templates) for (const lang of ['he', 'en'] as const) {
        const { rep, jobId } = await renderDone(owner, pid, { page: { templateId: t.id }, values: t.samples[lang], seconds: t.seconds });
        if (rep?.status !== 'succeeded') { ok = false; out[`${t.id}.${lang}`] = { job: rep?.status, failure: rep?.failure }; continue; }
        const d = decode(await fileOf(owner, pid, jobId, `${t.id}-${lang}.webm`), W, H);
        const last = d.frame(d.n - 1);
        const shot = path.join(pics, `${t.id}-${lang}.png`);
        ff(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', 'pipe:0', '-frames:v', '1', '-y', shot], Buffer.from(last));
        out[`${t.id}.${lang}`] = { frames: d.n, opaqueBoxLastFrame: opaqueBox(last, W, H), warnings: warnWhys(rep), picture: path.relative(root, shot) };
      }
      record(MADE_PROOF_CHECKS[25], ok, { ...out, note: 'functional only; the pictures are for the integrator to look at (nobody has)' });
    });
    void titleJob;
  } finally {
    tcp.close(); udp.close();
    await s.close?.();
    fs.rmSync(work, { recursive: true, force: true });
    const evidence = path.join(path.resolve(import.meta.dirname, '../../..'), 'docs/evidence/made-proof.json');
    fs.writeFileSync(evidence, `{"sandbox": ${JSON.stringify(sandbox)}, "checks": [\n${results.map((r) => JSON.stringify(r)).join(',\n')}\n]}\n`);
  }
  const failed = results.filter((r) => r.pass === false);
  const skipped = results.filter((r) => r.pass === 'skipped');
  console.log(`\nproof:made — ${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped (browser protection: ${sandbox})`);
  process.exit(failed.length ? 1 : 0);
}

/** Check 13's preview part: the editor (owner link) paused at each frame; its canvas equals render_frame byte for byte; the source is the original. */
async function previewParity(ownerUrl: string, pid: string, frames: number[], still: (k: number) => Promise<Buffer>, W: number, H: number) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
    await page.goto(`${ownerUrl}&project=${pid}`);
    await page.locator('[data-testid=ruler]').waitFor({ timeout: 60_000 });
    const out: { frame: number; equal: boolean; source: string | undefined; differing: number }[] = [];
    for (const k of frames) {
      await page.evaluate((x) => { const el = document.querySelector('[data-testid=ruler]')!; const r = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + x, clientY: r.top + 5, bubbles: true })); el.dispatchEvent(new PointerEvent('pointerup', { clientX: r.left + x, clientY: r.top + 5, bubbles: true })); }, (k / 30) * 90 + 0.5);
      await page.waitForFunction((want) => { const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement; return c?.dataset.frame === String(want) && c.dataset.quality === 'full'; }, k, { timeout: 30_000 }).catch(() => {});
      const shot = await page.evaluate(async () => {
        const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement;
        const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
        const data: string = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]!); fr.readAsDataURL(blob); });
        return { source: c.dataset.source, data, w: c.width, h: c.height };
      });
      const rgba = (png: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { input: png, maxBuffer: 1 << 28 });
      const ref = rgba(await still(k));
      let differing = -1;
      if (shot.w === W && shot.h === H) {
        const mine = rgba(Buffer.from(shot.data, 'base64'));
        differing = 0;
        for (let i = 0; i < ref.length; i++) if (ref[i] !== mine[i]) differing++;
      }
      out.push({ frame: k, equal: differing === 0, source: shot.source, differing });
    }
    return { pass: out.every((o) => o.equal && o.source === 'original'), frames: out };
  } finally { await browser.close().catch(() => {}); }
}
