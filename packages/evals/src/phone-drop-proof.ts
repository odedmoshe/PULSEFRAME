/**
 * `pnpm proof:phone-drop` — the end-to-end proof of the phone drop and the import queue (ADR-0023, amends ADR-0002), on a CPU,
 * with no model. Evidence: docs/evidence/phone-drop-proof.json. Written and run by the lead's wiring worker after W1–W3 merged
 * (plan §9 with the verifier's corrections, which win). Exit 0 = every check passed; 1 = a check failed (its numbers are in the
 * evidence); 2 = a check could not run here and is listed as `blocked` with its reason (it proves nothing).
 *
 * How it is run, and what that means:
 * - The server is a CHILD process started by phone-drop-server.ts, which passes cfg.dropAdmitAddresses from its own argv
 *   (main.ts untouched; no environment variable can set it). This container has no private address (eth0 is 192.0.2.2, a
 *   documentation address), so the door is bound to the admitted 127.0.0.1: the loopback interface is a /8, so a "second
 *   device" is a client bound to 127.0.0.3. The evidence records that the override was used. P3b proves the real rule: WITHOUT
 *   the override, POST …/drop answers 409 no_private_network here.
 * - The phone is a Playwright Chromium context with a phone's viewport and user agent (iPhone 390×844, Android 360×800), locale
 *   he-IL. It is not a phone: real pickers, iOS/Android behaviour, the camera reading the QR, the Windows firewall, a VPN as
 *   the default route, router client isolation and HEIC are recorded as not verified.
 * Fixtures (made here by ffmpeg; each source's sha256 recorded): A = HEVC, display rotation 90°, variable rate, AAC, creation_time
 * and com.apple.quicktime.creationdate (the baseline's own A); B = H.264 constant rate with creation_time (the baseline's B);
 * C = JPEG with EXIF DateTimeOriginal 2023:12:31 21:45:10, OffsetTimeOriginal +02:00 and Orientation 6 (an APP1 block written
 * here, then read back by an independent reader, ffprobe -show_frames, before use); 20 two-second HEVC clips; junk bytes named .mp4.
 * Expected values are typed here from the fixtures, never computed by the code under test.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { chromium, devices, type Browser, type BrowserContext, type Page } from 'playwright';
import { loadConfig, startServer } from '@pulseframe/server';
import { buildOpenApi } from '../../../apps/server/src/openapi.ts';
import { Store } from '../../../apps/server/src/store.ts';
import { DROP_PAGE_TESTIDS } from '../../../apps/server/src/drop-page/testids.ts';
import { encodeQr, qrSvgPath } from '../../../apps/web/src/qr.ts';
import { IMPORT_TESTIDS, PHONE_DROP_TESTIDS } from '../../../apps/web/src/editor/imports.testids.ts';
import { makeApi, ownerApi, sleep, type Api } from './incremental-fixtures.ts';
import { makeBaselineFixtures } from './phone-drop-baseline.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/phone-drop');
const evidenceFile = path.join(root, 'docs/evidence/phone-drop-proof.json');
const PORT = Number(process.env.PF_PROOF_PORT ?? 8951);
const DROP_PORT = PORT + 1;
const DOOR = '127.0.0.1';
const SECOND_DEVICE = '127.0.0.3';
const MiB = 1024 ** 2;

// ---- expected values, typed from the fixtures ----
const EXPECT_CAPTURE = {
  A: { at: '2025-08-14T18:03:22', utcOffsetMinutes: 180, source: 'container' }, // com.apple.quicktime.creationdate 18:03:22+0300
  B: { at: '2024-03-01T11:30:00', utcOffsetMinutes: null, source: 'container', assumedZone: 'Asia/Jerusalem' }, // creation_time 09:30:00Z, Israel winter time +2
  C: { at: '2023-12-31T21:45:10', utcOffsetMinutes: 120, source: 'exif' }, // DateTimeOriginal + OffsetTimeOriginal +02:00
} as const;
const HE = { saved: 'נשמר במחשב', tooLarge: 'הקובץ גדול מדי להעלאה.', waiting: 'ממתין', converting: 'ממיר', ready: 'מוכן', failed: 'נכשל', skipped3: 'דילגנו על 3 קבצים שאינם מדיה' };

interface Check { id: string; name: string; pass: boolean | null; numbers: unknown; blocked?: string }
const checks: Check[] = [];
const notes: Record<string, unknown> = {};
function check(id: string, name: string, pass: boolean, numbers: unknown = {}) { checks.push({ id, name, pass, numbers }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${name}${pass ? '' : `\n      ${JSON.stringify(numbers).slice(0, 1200)}`}`); }
function blocked(id: string, name: string, why: string) { checks.push({ id, name, pass: null, numbers: {}, blocked: why }); console.log(`BLOCKED  ${id}  ${name}: ${why}`); }
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const shaFile = (f: string) => sha(fs.readFileSync(f));
const ff = (args: string[]) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-y', ...args], { maxBuffer: 1 << 28 }); if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}: ${r.stderr}`); };
const dirBytes = (dir: string): number => { let n = 0; if (!fs.existsSync(dir)) return 0; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); try { n += e.isDirectory() ? dirBytes(p) : e.isFile() ? fs.statSync(p).size : 0; } catch { /* gone */ } } return n; };
const percentile = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? NaN; };
const stackTrace = /\bat [^\n]+\.(?:ts|js):\d+|node:internal/;

// ---------------------------------------------------------------------------------------------------------------- the server
interface Child { proc: ChildProcess; url: string; ownerUrl: string; agent: string; ownerKey: string }
let child: Child | null = null;
let agent: Api, owner: Api;
const dataDir = path.join(art, 'data');
async function startChild(extra: string[] = []): Promise<Child> {
  const proc = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'packages/evals/src/phone-drop-server.ts'), '--data', dataDir, '--port', String(PORT), '--drop-port', String(DROP_PORT), '--admit', DOOR, ...extra], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
  const line = await new Promise<string>((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('the server child did not start in 90 s')), 90_000);
    proc.stdout!.on('data', (d) => { buf += d; const i = buf.indexOf('\n'); if (i >= 0 && buf.startsWith('{')) { clearTimeout(t); resolve(buf.slice(0, i)); } });
    proc.once('exit', (code) => { clearTimeout(t); reject(new Error(`the server child exited ${code} before it listened`)); });
  });
  proc.stdout!.resume();
  const info = JSON.parse(line);
  child = { proc, url: info.url, ownerUrl: info.ownerUrl, agent: info.agent, ownerKey: info.ownerKey };
  agent = makeApi(child.url, child.agent);
  owner = await ownerApi(child.url, child.ownerKey);
  notes.admittedOverride = info.admitted;
  return child;
}
async function stopChild(signal: NodeJS.Signals = 'SIGTERM'): Promise<number | null> {
  if (!child) return null;
  const c = child.proc;
  child = null;
  const exited = new Promise<number | null>((r) => c.once('exit', (code) => r(code)));
  c.kill(signal);
  return Promise.race([exited, sleep(60_000).then(() => { c.kill('SIGKILL'); return -1; })]);
}
const refused = (host: string, port: number) => new Promise<boolean>((resolve) => {
  const s = net.connect({ host, port });
  s.once('connect', () => { s.destroy(); resolve(false); });
  s.once('error', (e: NodeJS.ErrnoException) => resolve(e.code === 'ECONNREFUSED'));
  s.setTimeout(5000, () => { s.destroy(); resolve(false); });
});

// ---------------------------------------------------------------------------------------------------------------- the door, on the wire
interface DoorRes { status: number; headers: http.IncomingHttpHeaders; body: Buffer; error?: string; json?: any }
const doorBodies: string[] = [];
/** One request to the door as a phone's browser sends it (Host exactly address:port). `body` may be a size: that many random bytes are streamed until the door answers. */
function door(method: string, p: string, o: { headers?: Record<string, string>; body?: Buffer | number; localAddress?: string; port?: number } = {}): Promise<DoorRes> {
  const port = o.port ?? DROP_PORT;
  return new Promise((resolve) => {
    let answered = false;
    const size = typeof o.body === 'number' ? o.body : o.body?.length ?? 0;
    const req = http.request({ host: DOOR, port, method, path: p, localAddress: o.localAddress, agent: false, headers: { host: `${DOOR}:${port}`, connection: 'close', ...(size || method === 'POST' ? { 'content-length': String(size) } : {}), ...o.headers } }, (res) => {
      answered = true;
      const parts: Buffer[] = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => { const body = Buffer.concat(parts); doorBodies.push(body.toString('utf8')); let json: any; try { json = JSON.parse(body.toString('utf8')); } catch { /* not JSON */ } resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json }); });
      res.on('error', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts) }));
    });
    req.on('error', (e: NodeJS.ErrnoException) => { if (!answered) resolve({ status: 0, headers: {}, body: Buffer.alloc(0), error: e.code ?? e.message }); });
    if (typeof o.body === 'number') {
      let sent = 0;
      const chunk = randomBytes(MiB);
      const pump = () => { while (sent < size && !answered) { const n = Math.min(chunk.length, size - sent); sent += n; if (!req.write(chunk.subarray(0, n))) { req.once('drain', pump); return; } } if (!answered) req.end(); };
      pump();
    } else req.end(o.body);
  });
}
const tokenOf = (url: string) => url.slice(url.indexOf('#') + 1);
async function hello(token: string, localAddress?: string) { return door('POST', '/hello', { headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ token })), localAddress }); }
async function uploadVia(session: string, file: string, name = path.basename(file)) {
  return door('POST', '/upload', { headers: { authorization: `Bearer ${session}`, 'x-filename': encodeURIComponent(name) }, body: fs.readFileSync(file) });
}

// ---------------------------------------------------------------------------------------------------------------- fixtures
function exifJpeg(out: string) {
  const base = path.join(art, 'c-base.jpg');
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x240', '-frames:v', '1', base]);
  const le16 = (v: number) => { const b = Buffer.alloc(4); b.writeUInt16LE(v, 0); return b; }, le32 = (v: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(v, 0); return b; };
  const asc = (s: string) => Buffer.from(`${s}\0`, 'latin1');
  const ifd = (entries: [number, number, number, Buffer][], start: number) => {
    const head = Buffer.alloc(2 + entries.length * 12 + 4); head.writeUInt16LE(entries.length, 0);
    const data: Buffer[] = []; let off = start + head.length;
    entries.forEach(([tag, type, count, val], i) => { const o = 2 + i * 12; head.writeUInt16LE(tag, o); head.writeUInt16LE(type, o + 2); head.writeUInt32LE(count, o + 4); if (val.length <= 4) val.copy(head, o + 8); else { head.writeUInt32LE(off, o + 8); data.push(val); off += val.length; if (val.length % 2) { data.push(Buffer.alloc(1)); off++; } } });
    return Buffer.concat([head, ...data]);
  };
  const ifd0 = ifd([[0x0112, 3, 1, le16(6)], [0x8769, 4, 1, le32(38)]], 8); // Orientation 6; Exif IFD at 8 + 30
  const exif = ifd([[0x9003, 2, 20, asc('2023:12:31 21:45:10')], [0x9011, 2, 7, asc('+02:00')]], 38);
  const tiff = Buffer.concat([Buffer.from('II*\0', 'latin1'), le32(8), ifd0, exif]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255]), payload]);
  const jpg = fs.readFileSync(base);
  fs.writeFileSync(out, Buffer.concat([jpg.subarray(0, 2), app1, jpg.subarray(2)]));
  // the independent reader: ffprobe's own EXIF parser must read back what the helper wrote
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_frames', '-of', 'json', out], { encoding: 'utf8' });
  const tags = JSON.parse(r.stdout).frames?.[0]?.tags ?? {};
  return { dateTimeOriginal: tags.DateTimeOriginal ?? null, orientation: String(tags.Orientation ?? '').trim() || null };
}
const X265 = ['-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'pools=1:frame-threads=1:log-level=none', '-tag:v', 'hvc1'];

// ---------------------------------------------------------------------------------------------------------------- helpers on the project
const projectOf = async (pid: string) => (await agent.call(`/projects/${pid}`)).body.project;
async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 120_000, every = 250): Promise<T> {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`); await sleep(every); }
}
const readJobs = (where = "type = 'import'") => {
  const store = new Store(dataDir);
  try { return (store.db.prepare(`SELECT id, status, attempt, actor, input, output, error FROM jobs WHERE ${where} ORDER BY created_at, rowid`).all() as any[]).map((r) => ({ ...r, input: JSON.parse(r.input), output: r.output ? JSON.parse(r.output) : null, error: r.error ? JSON.parse(r.error) : null })); } finally { store.close(); }
};
async function openCode(pid: string): Promise<any> { const r = await owner.call(`/projects/${pid}/drop`, { address: DOOR }); if (r.status !== 201) throw new Error(`open code: ${r.status} ${JSON.stringify(r.body)}`); return r.body.drop; }

// =====================================================================================================================
async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const started = Date.now();
  let freeDisk: number | null = null;
  try { const s = fs.statfsSync(art); freeDisk = s.bavail * s.bsize; } catch { /* not measurable */ }
  const evidence: Record<string, unknown> = {
    ranAt: new Date().toISOString(), machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpus: os.cpus().length, memoryGiB: +(os.totalmem() / 2 ** 30).toFixed(1), loadAtStart: os.loadavg() }, freeDiskBytesAtStart: freeDisk,
    ffmpeg: spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).stdout.split('\n')[0],
    notVerifiedHere: ['a real phone and its pickers (iOS, Android; whether they hand over the original HEVC with its date)', 'HEIC pictures', 'the camera reading the on-screen QR', 'a real home network, router client isolation', 'the Windows firewall prompt and the "public network" profile', 'a VPN as the default route', 'a phone browser\'s own local-network permission prompt', 'the laptop\'s ffmpeg (this run used the container\'s)', 'Chrome\'s HTTPS-by-default exemption for private addresses'],
  };

  // ---- fixtures
  const fx = makeBaselineFixtures(path.join(art, 'fixtures'));
  const A = fx.find((f) => f.key === 'A')!.file, B = fx.find((f) => f.key === 'B')!.file;
  const C = path.join(art, 'fixtures', 'C-exif.jpg');
  const cRead = exifJpeg(C);
  const clips = Array.from({ length: 20 }, (_, i) => { const f = path.join(art, 'fixtures', `clip-${String(i).padStart(2, '0')}.mp4`); ff(['-f', 'lavfi', '-i', `testsrc2=size=320x240:rate=30`, '-f', 'lavfi', '-i', `sine=frequency=${300 + i * 20}:sample_rate=48000`, '-t', '2', '-vf', `hue=h=${i * 17}`, ...X265, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f]); return f; });
  // files nobody imported before (conform reuse would skip their conversion): one long rotated HEVC for the cards, six for the load
  const hevc = (name: string, seconds: number, size: string, hue: string) => { const f = path.join(art, 'fixtures', name); ff(['-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30`, '-t', String(seconds), '-vf', `hue=h=${hue}`, ...X265, '-pix_fmt', 'yuv420p', f.replace(/\.mp4$/, '-0.mp4')]); ff(['-display_rotation', '90', '-i', f.replace(/\.mp4$/, '-0.mp4'), '-c', 'copy', f]); fs.rmSync(f.replace(/\.mp4$/, '-0.mp4')); return f; };
  const cardClip = hevc('card-hevc.mp4', 8, '1280x720', '200');
  const busyClips = Array.from({ length: 6 }, (_, i) => hevc(`busy-${i}.mp4`, 4, '960x540', String(20 + i * 40)));
  const junk = path.join(art, 'fixtures', 'junk.mp4');
  fs.writeFileSync(junk, randomBytes(512 * 1024));
  evidence.fixtures = { A: shaFile(A), B: shaFile(B), C: shaFile(C), cReadByFfprobe: cRead, clips: clips.length };
  check('F0', 'the EXIF fixture is what it says, read by an independent reader (ffprobe -show_frames): DateTimeOriginal 2023:12:31 21:45:10, Orientation 6', cRead.dateTimeOriginal === '2023:12:31 21:45:10' && cRead.orientation === '6', cRead);

  // ---- P1, P2: the main server stays on loopback; no code, no door
  await startChild();
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address ?? null;
  const lanRefused = lan ? await refused(lan, PORT) : null;
  const spoof = await fetch(`${child!.url}/api/v1/session`, { headers: { host: `evil.example:${PORT}`, connection: 'close' } });
  const spoofBody = (await spoof.json().catch(() => ({}))) as any;
  let hostThrows = false;
  try { loadConfig({ ...process.env, PF_HOST: '0.0.0.0' }); } catch { hostThrows = true; }
  check('P1', 'the main server: its port on the machine\'s network address is refused, a spoofed Host gets 403 forbidden_host, PF_HOST=0.0.0.0 refuses to start', (lanRefused ?? true) && spoof.status === 403 && spoofBody?.error?.code === 'forbidden_host' && hostThrows, { lan, lanRefused, spoof: spoof.status, code: spoofBody?.error?.code, hostThrows });
  check('P2', 'no code: the door port refuses connections', await refused(DOOR, DROP_PORT), { port: DROP_PORT });

  // ---- P3: who may open a code
  const pid = (await agent.call('/projects', { name: 'phone drop', width: 640, height: 360 })).body.project.id as string;
  const byAgent = await agent.call(`/projects/${pid}/drop`, { address: DOOR });
  const code0 = await openCode(pid);
  const life = (Date.parse(code0.expiresAt) - Date.parse(code0.issuedAt)) / 1000;
  check('P3', 'an agent token cannot open a code (403 owner_required); the owner can; it expires 600 s after it was issued', byAgent.status === 403 && byAgent.body?.error?.code === 'owner_required' && !!code0.url && life === 600, { agent: byAgent.status, code: byAgent.body?.error?.code, lifeSeconds: life });
  await owner.call(`/projects/${pid}/drop/${code0.dropId}/close`, {});
  check('P3c', 'closing the code closes its listener', await refused(DOOR, DROP_PORT));

  // ---- P3b (and P8b): the real address rule, and the lifetime, on a second server in this process without the override
  {
    const dir = path.join(art, 'data-noadmit');
    const s2 = await startServer({ port: PORT + 2, dataDir: dir, dropPort: PORT + 3 });
    const o2 = await ownerApi(s2.url, s2.auth.tokens.owner);
    const p2 = (await o2.call('/projects', { name: 'no admit' })).body.project.id;
    const r = await o2.call(`/projects/${p2}/drop`, { address: DOOR });
    const addr = (await o2.call('/drop/addresses')).body.addresses;
    await s2.close();
    check('P3b', 'without the override this machine has no private address: GET /drop/addresses is empty and POST …/drop answers 409 no_private_network', r.status === 409 && r.body?.error?.code === 'no_private_network' && Array.isArray(addr) && addr.length === 0, { status: r.status, code: r.body?.error?.code, addresses: addr });
    // P8b: a code with the shortest lifetime the configuration allows (1 minute) is gone after it, unclaimed
    const s3 = await startServer({ port: PORT + 4, dataDir: path.join(art, 'data-ttl'), dropPort: PORT + 5, dropAdmitAddresses: [DOOR], dropTtlMinutes: 1 });
    const o3 = await ownerApi(s3.url, s3.auth.tokens.owner);
    const p3 = (await o3.call('/projects', { name: 'ttl' })).body.project.id;
    const c3 = (await o3.call(`/projects/${p3}/drop`, { address: DOOR })).body.drop;
    const openAtStart = !(await refused(DOOR, PORT + 5));
    await sleep(61_500);
    const after = (await o3.call(`/projects/${p3}/drop`)).body.drop;
    const portGone = await refused(DOOR, PORT + 5);
    await s3.close();
    check('P8b', 'an unclaimed code with a 1-minute lifetime (PF_DROP_TTL_MINUTES=1, the shortest allowed) is gone 61.5 s after it was issued, and its port refuses (the 10-minute default is held by drop.test.ts with a fake clock)', openAtStart && after === null && portGone && (Date.parse(c3.expiresAt) - Date.parse(c3.issuedAt)) === 60_000, { openAtStart, after, portGone });
  }

  // ---- P4: the dialog in the editor
  const browser = await chromium.launch();
  let code: any = null;
  try {
    const ed = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'he-IL' });
    const page = await ed.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.goto(`${child!.ownerUrl}&project=${pid}`);
    await page.getByTestId('timecode').waitFor({ timeout: 60_000 });
    await page.getByTestId('import-more').click();
    await page.getByTestId(IMPORT_TESTIDS.phoneDropOpen).click();
    await page.getByTestId(PHONE_DROP_TESTIDS.dialog).waitFor({ timeout: 15_000 });
    await page.getByTestId(PHONE_DROP_TESTIDS.address).waitFor({ timeout: 15_000 });
    await page.getByTestId(PHONE_DROP_TESTIDS.address).selectOption(DOOR);
    await page.getByTestId(PHONE_DROP_TESTIDS.start).click();
    await page.getByTestId(PHONE_DROP_TESTIDS.qr).waitFor({ timeout: 15_000 });
    code = (await owner.call(`/projects/${pid}/drop`)).body.drop;
    const d = await page.locator(`[data-testid=${PHONE_DROP_TESTIDS.qr}] svg path`).getAttribute('d');
    const expected = qrSvgPath(encodeQr(code.url)).d;
    const typed = (await page.getByTestId(PHONE_DROP_TESTIDS.typedAddress).textContent())?.trim();
    const pinText = (await page.getByTestId(PHONE_DROP_TESTIDS.pin).textContent())?.replace(/\s/g, '');
    const dialogName = await page.getByTestId(PHONE_DROP_TESTIDS.dialog).evaluate((el) => { const d = el.closest('[role=dialog]') ?? el; const id = d.getAttribute('aria-labelledby'); return (d.getAttribute('role') ?? '') + '|' + (id ? document.getElementById(id)?.textContent ?? '' : d.getAttribute('aria-label') ?? ''); });
    const focusInside = await page.evaluate((id) => !!document.querySelector(`[data-testid=${id}]`)?.closest('[role=dialog]')?.contains(document.activeElement), PHONE_DROP_TESTIDS.dialog);
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    await page.screenshot({ path: path.join(art, 'p4-dialog-he.png') });
    check('P4', 'the dialog (1440×900, Hebrew): the QR drawn is the encoding of exactly the issued URL (same modules), the typed address and the PIN match the code, the dialog is named and holds the focus', d === expected && typed === `${DOOR}:${DROP_PORT}` && pinText === code.pin && dialogName.startsWith('dialog|') && dialogName.length > 7 && focusInside, { qrPathEqual: d === expected, typed, pinMatches: pinText === code.pin, dialogName, focusInside });
    blocked('P4b', 'the QR pixels decoded by an independent decoder', 'no independent QR decoder is installed here (adding jsqr@1.4.0 as a dev dependency was refused by the permission system in this session); the encoder is held by qr.test.ts against a reader written from the standard');
    // Esc hides the dialog and leaves the chip with the time left; the chip reopens it
    await page.keyboard.press('Escape');
    await page.getByTestId(PHONE_DROP_TESTIDS.chip).waitFor({ timeout: 8000 });
    const chip = (await page.getByTestId(PHONE_DROP_TESTIDS.chip).textContent()) ?? '';
    await page.getByTestId(PHONE_DROP_TESTIDS.chip).click();
    const reopened = await page.getByTestId(PHONE_DROP_TESTIDS.dialog).waitFor({ timeout: 8000 }).then(() => true, () => false);
    check('P4c', 'Esc hides the dialog and leaves the chip in the drawer header with the time left (m:ss); the chip opens it again', /\d+:\d{2}/.test(chip) && reopened, { chip, reopened });
    await page.keyboard.press('Escape');

    // ---- P5–P7: the phone uploads A, B and C
    const { defaultBrowserType: _webkit, ...iphone } = devices['iPhone 13'];
    const phone = await browser.newContext({ ...iphone, locale: 'he-IL' });
    const ph = await phone.newPage();
    await ph.goto(code.url);
    await ph.getByTestId(DROP_PAGE_TESTIDS.pickMedia).waitFor({ state: 'attached', timeout: 15_000 });
    const langDir = await ph.evaluate(() => `${document.documentElement.lang}|${document.documentElement.dir}`);
    const t0 = Date.now();
    await ph.getByTestId(DROP_PAGE_TESTIDS.pickMedia).setInputFiles([A, B, C]);
    // the moment A's row says it is stored, A's import job must still be waiting or converting (the 201 does not wait for it)
    await waitFor('A stored on the phone page', async () => ((await ph.getByTestId(DROP_PAGE_TESTIDS.file(0)).textContent().catch(() => '')) ?? '').includes(HE.saved), 120_000, 50);
    const aSavedMs = Date.now() - t0;
    const listAtA = (await owner.call(`/projects/${pid}/imports`)).body.imports as any[];
    const aJob = listAtA.find((j) => j.name === path.basename(A));
    await waitFor('all three stored', async () => { for (let i = 0; i < 3; i++) if (!((await ph.getByTestId(DROP_PAGE_TESTIDS.file(i)).textContent()) ?? '').includes(HE.saved)) return false; return true; }, 180_000);
    const allSavedMs = Date.now() - t0;
    const cookies = await phone.cookies();
    await ph.screenshot({ path: path.join(art, 'p5-phone-he.png') });
    check('P5', 'the phone (iPhone viewport, he-IL): the page is Hebrew, right to left, sets no cookie, and stores A, B and C; A\'s 201 arrives while its job is still waiting or converting', langDir === 'he|rtl' && cookies.length === 0 && !!aJob && (aJob.state === 'waiting' || aJob.state === 'converting'), { langDir, cookies: cookies.length, aJobAtItsSave: aJob && { state: aJob.state, waitingFor: aJob.waitingFor }, aSavedMs, allSavedMs });

    const doc = await waitFor('three phone assets', async () => { const d = await projectOf(pid); const a = Object.values<any>(d.assets).filter((x) => x.provenance?.upload?.via === 'phone'); return a.length === 3 ? d : null; }, 300_000, 500);
    const byName = (n: string) => Object.values<any>(doc.assets).find((x) => x.name === n);
    const aa = byName(path.basename(A)), bb = byName(path.basename(B)), cc = byName(path.basename(C));
    const original = (x: any) => shaFile(path.join(dataDir, 'blobs', String(x.conform?.originalContentHash ?? x.contentHash).replace(/^sha256:/, '')));
    check('P6', 'each stored original (A, B and C) equals its source byte for byte; A is converted for editing and names its original; B is stored as it is', original(aa) === shaFile(A) && original(bb) === shaFile(B) && original(cc) === shaFile(C) && aa.conform?.originalContentHash === `sha256:${shaFile(A)}` && !bb.conform && bb.contentHash === `sha256:${shaFile(B)}`, { A: { converted: !!aa.conform, reasons: aa.conform?.reasons }, B: { converted: !!bb.conform }, C: { kind: cc.kind, converted: !!cc.conform } });
    const cap = (x: any) => x.capture && { at: x.capture.at, utcOffsetMinutes: x.capture.utcOffsetMinutes, source: x.capture.source, ...(x.capture.assumedZone ? { assumedZone: x.capture.assumedZone } : {}) };
    const tagsAfter = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', path.join(dataDir, 'blobs', shaFile(A))], { encoding: 'utf8' }).stdout).format?.tags ?? {};
    check('P7', 'capture dates read from the ORIGINAL files: A from Apple\'s creationdate (18:03:22, +3 h), B from creation_time (UTC, worn as Israel time, zone recorded), C from EXIF (21:45:10, +2 h); the stored original still carries its tags', JSON.stringify(cap(aa)) === JSON.stringify(EXPECT_CAPTURE.A) && JSON.stringify(cap(bb)) === JSON.stringify(EXPECT_CAPTURE.B) && JSON.stringify(cap(cc)) === JSON.stringify(EXPECT_CAPTURE.C) && tagsAfter['com.apple.quicktime.creationdate'] === '2025-08-14T18:03:22+0300', { A: cap(aa), B: cap(bb), C: cap(cc), storedOriginalTags: tagsAfter });

    // ---- P8: one phone, many files; another device is refused
    await ph.reload();
    await ph.getByTestId(DROP_PAGE_TESTIDS.pickMedia).waitFor({ state: 'attached', timeout: 15_000 });
    await ph.getByTestId(DROP_PAGE_TESTIDS.pickMedia).setInputFiles([clips[0]!]);
    const afterReload = await waitFor('the file after a reload', async () => { const t = (await ph.getByTestId(DROP_PAGE_TESTIDS.file(0)).textContent().catch(() => '')) ?? ''; return t.includes(HE.saved) || t.includes(HE.failed) ? t : null; }, 120_000).catch(() => 'timeout');
    const second = await hello(tokenOf(code.url), SECOND_DEVICE);
    const pinAgain = await door('POST', '/hello', { headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ pin: code.pin })), localAddress: SECOND_DEVICE });
    check('P8', 'a reload in the phone continues the batch (same address: the original token claims again); a second device (127.0.0.3) is refused 409 code_already_used, and the PIN no longer works', afterReload.includes(HE.saved) && second.status === 409 && second.json?.error?.code === 'code_already_used' && pinAgain.status >= 400 && pinAgain.status !== 429, { afterReload, second: [second.status, second.json?.error?.code], pin: [pinAgain.status, pinAgain.json?.error?.code] });
    notes.secondDeviceInABrowser = 'not verified: a browser from another address cannot be made in this container; the page\'s Hebrew text for 409 is held by dropPage.test.ts';

    // ---- P9, P10: nothing else on the door
    const session = await ph.evaluate(() => sessionStorage.getItem('pfdrop.s'));
    const paths = [...Object.keys((buildOpenApi() as any).paths).map((p) => p.replace(/\{[^}]+\}/g, 'x')), '/mcp', '/index.html', '/api/v1/session', '/render.html', '/assets/index.js', '/%2e%2e/%2e%2e/etc/passwd', '/../package.json', '//etc/passwd', '/upload/', '/HELLO', '/hello?x=1'];
    let n = 0; const bad: unknown[] = [];
    for (const p of paths) for (const m of ['GET', 'POST', 'PUT', 'DELETE']) {
      if ((m === 'POST' && ['/hello', '/upload', '/status', '/bye'].includes(p)) || (m === 'GET' && p === '/')) continue;
      // the door's rate buckets are per peer address (other: 30 at once, 60 a minute): each request comes from its own loopback address
      const r = await door(m, p, { headers: session ? { authorization: `Bearer ${session}` } : {}, localAddress: `127.0.${1 + Math.floor(n / 200)}.${10 + (n % 200)}` });
      n++;
      if (r.status !== 404 || r.body.length !== 0 || r.headers['set-cookie'] || Object.keys(r.headers).some((h) => h.startsWith('access-control-'))) bad.push({ m, p, status: r.status, bytes: r.body.length });
    }
    const pageBody = (await door('GET', '/')).body.toString('utf8');
    const leaks = [pid, 'phone drop', child!.agent, child!.ownerKey].filter((x) => pageBody.includes(x));
    check('P9', `every API path and method of the main server, plus /mcp, the app's pages and traversal forms, answers 404 on the door with an empty body, no cookie and no CORS header (${n} requests); the page holds no project id or name and no main-server token`, bad.length === 0 && leaks.length === 0 && n > 400, { requests: n, bad: bad.slice(0, 10), leaks });
    const readUpload = await door('GET', '/upload', { headers: { authorization: `Bearer ${session}` } });
    const readApi = await door('GET', `/api/v1/projects/${pid}`, { headers: { authorization: `Bearer ${session}` } });
    check('P10', 'a valid session can read nothing: GET /upload and an API path are 404', !!session && readUpload.status === 404 && readApi.status === 404, { session: !!session, upload: readUpload.status, api: readApi.status });

    // ---- P17 (phone case): an owner edit, then a phone file lands: Ctrl+Z undoes the owner's edit, the file stays
    const mark = await owner.call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_marker', args: { time: { value: '1', timescale: 1 } } }] });
    const phoneUp = await uploadVia((await hello(tokenOf(code.url))).json?.session, clips[1]!, 'phone-after-edit.mp4');
    await waitFor('the phone file after the edit', async () => Object.values<any>((await projectOf(pid)).assets).some((x) => x.name === 'phone-after-edit.mp4'), 180_000, 500);
    const undoPhone = await owner.call(`/projects/${pid}/undo`, {});
    const after17 = await projectOf(pid);
    check('P17b', 'the phone case: owner edit, then a phone import lands; the owner\'s Ctrl+Z undoes the owner\'s edit and the phone file stays', mark.status === 200 && phoneUp.status === 201 && undoPhone.status === 200 && Object.keys(after17.markers ?? {}).length === 0 && Object.values<any>(after17.assets).some((x) => x.name === 'phone-after-edit.mp4'), { mark: mark.status, phone: phoneUp.status, undo: undoPhone.status, markers: Object.keys(after17.markers ?? {}).length });
    await phone.close();

    // ---- P15, P16: the cards in the editor
    const p15 = (await agent.call('/projects', { name: 'cards', width: 640, height: 360 })).body.project.id as string;
    const cards = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'he-IL' });
    const cp = await cards.newPage();
    await cp.goto(`${child!.ownerUrl}&project=${p15}`);
    await cp.getByTestId('timecode').waitFor({ timeout: 60_000 });
    const seen: string[] = [];
    let watching = true;
    const watch = (async () => { while (watching) { const t = await cp.locator(`[data-testid^=import-card-] [data-testid=${IMPORT_TESTIDS.state}]`).first().textContent().catch(() => null); if (t && seen.at(-1) !== t) seen.push(t); await sleep(40); } })();
    await cp.getByTestId('file-input').setInputFiles([cardClip]);
    const assetCard = await cp.locator('.assets li').first().waitFor({ timeout: 300_000 }).then(() => true, () => false);
    await sleep(300);
    watching = false; await watch;
    const pct = seen.map((s) => /(\d+)%/.exec(s)?.[1]).filter(Boolean).map(Number);
    const increasing = pct.length >= 2 && pct.some((v, i) => i > 0 && v > pct[i - 1]!);
    const order = [HE.waiting, HE.converting, HE.ready].map((w) => seen.findIndex((s) => s.startsWith(w)));
    check('P15', 'a converted file\'s card in the editor goes «ממתין» → «ממיר N%» (at least two increasing percentages) → «מוכן», then the asset card', assetCard && order.every((i) => i >= 0) && order[0]! < order[1]! && order[1]! < order[2]! && increasing, { states: seen, percentages: pct, assetCard });
    await cp.getByTestId('file-input').setInputFiles([junk]);
    const failedCard = await cp.locator(`[data-testid^=import-card-]:has([data-testid=${IMPORT_TESTIDS.state}]:text("${HE.failed}"))`).first().waitFor({ timeout: 120_000 }).then(() => true, () => false);
    const reason = failedCard ? await cp.locator('.pf-imp-card[data-state=attention] .pf-imp-detail').first().textContent().catch(() => null) : null;
    if (failedCard) await cp.locator(`[data-testid^=import-card-] [data-testid=${IMPORT_TESTIDS.dismiss}]`).first().click();
    const removed = await cp.locator(`[data-testid^=import-card-]:has([data-testid=${IMPORT_TESTIDS.state}]:text("${HE.failed}"))`).count().then((c) => c === 0);
    check('P15b', 'random bytes named .mp4 end as «נכשל» with a reason, and «הסרה» removes the card', failedCard && !!reason && removed, { failedCard, reason, removed });
    blocked('P15c', 'a retry after an injected disk_full succeeds', 'the running server has no seam to inject a full disk (freeBytes is fixed to statfs in index.ts); retry after disk_full is covered by importQueue.test.ts with an injected freeBytes');
    // P16: a folder of 25 files, 3 of them not media
    const folder = path.join(art, 'fixtures', 'folder');
    fs.mkdirSync(path.join(folder, 'sub'), { recursive: true });
    for (let i = 0; i < 22; i++) ff(['-f', 'lavfi', '-i', `color=c=0x${(i * 11).toString(16).padStart(2, '0')}4080:s=64x48`, '-frames:v', '1', path.join(folder, i % 2 ? 'sub' : '', `pic-${i}.png`)]);
    for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(folder, `notes-${i}.txt`), 'not media');
    await cp.getByTestId(IMPORT_TESTIDS.folderInput).setInputFiles(folder);
    const skipped = await cp.getByTestId(IMPORT_TESTIDS.skipped).textContent({ timeout: 30_000 }).catch(() => null);
    const folderAssets = await waitFor('22 folder imports', async () => { const d = await projectOf(p15); const n = Object.values<any>(d.assets).filter((x) => x.provenance?.upload?.via === 'folder').length; return n === 22 ? n : null; }, 300_000, 500).catch(() => -1);
    check('P16', 'a folder of 25 files (3 not media): 22 imports and the skipped notice «דילגנו על 3 קבצים שאינם מדיה»', folderAssets === 22 && skipped?.includes(HE.skipped3) === true, { folderAssets, skipped });
    await cards.close();
    await ed.close();
  } finally {
    await browser.close();
  }

  // ---- P17: the same actor, background import vs the synchronous route (control)
  {
    const p17 = (await owner.call('/projects', { name: 'undo', width: 640, height: 360 })).body.project.id as string;
    const edit = await owner.call(`/projects/${p17}/transactions`, { ops: [{ op: 'add_marker', args: { time: { value: '1', timescale: 1 } } }] });
    const own = await ownerSession();
    const bg = await fetch(`${child!.url}/api/v1/projects/${p17}/imports`, { method: 'POST', headers: { ...own, 'x-filename': 'bg.mp4', 'content-type': 'application/octet-stream' }, body: new Uint8Array(fs.readFileSync(B)) });
    const bgJob = ((await bg.json()) as any).job;
    await waitFor('the background import', async () => { const j = (await owner.call(`/jobs/${bgJob.jobId}`)).body; return j.status === 'succeeded'; }, 120_000);
    const u1 = await owner.call(`/projects/${p17}/undo`, {});
    const d1 = await projectOf(p17);
    const redo = await owner.call(`/projects/${p17}/redo`, {});
    const markerUndone = Object.keys(d1.markers ?? {}).length === 0, bgKept = Object.values<any>(d1.assets).some((x) => x.name === 'bg.mp4');
    // control: the synchronous route commits as an edit, so the same actor's Ctrl+Z removes the import
    const sync = await fetch(`${child!.url}/api/v1/projects/${p17}/assets`, { method: 'POST', headers: { ...own, 'x-filename': 'sync.mp4' }, body: new Uint8Array(fs.readFileSync(clips[2]!)) });
    const u2 = await owner.call(`/projects/${p17}/undo`, {});
    const d2 = await projectOf(p17);
    const syncRemoved = sync.status === 201 && !Object.values<any>(d2.assets).some((x) => x.name === 'sync.mp4');
    check('P17', 'one actor: owner edit, then the owner\'s background import (POST …/imports): Ctrl+Z undoes the edit, the import stays, redo is available; control: the synchronous POST …/assets (kind edit) is removed by Ctrl+Z', edit.status === 200 && u1.status === 200 && markerUndone && bgKept && redo.status === 200 && syncRemoved && u2.status === 200, { edit: edit.status, undo: u1.status, markerUndone, bgKept, redo: redo.status, control: { sync: sync.status, undo: u2.status, removed: syncRemoved } });
  }

  // ---- P11, P12: ceilings and budgets, refused while the phone is still sending
  {
    const pid2 = (await agent.call('/projects', { name: 'limits' })).body.project.id as string;
    await stopChild();
    const used = dirBytes(dataDir);
    await startChild(['--max-storage', String(used + 40 * MiB), '--max-upload', String(64 * MiB)]);
    const c = await openCode(pid2);
    const s1 = (await hello(tokenOf(c.url))).json?.session as string;
    const blobs0 = dirBytes(path.join(dataDir, 'blobs')), jobs0 = readJobs().length;
    const over = await door('POST', '/upload', { headers: { authorization: `Bearer ${s1}`, 'x-filename': 'big.bin' }, body: 80 * MiB });
    const blobs1 = dirBytes(path.join(dataDir, 'blobs')), jobs1 = readJobs().length;
    // in a browser on the phone: the page knows the cap from /hello and refuses a 64 MiB file itself, in Hebrew; and the browser
    // reads the door's own early refusal while it is still sending a 64 MiB body (fetch from the page with its session)
    const big = path.join(art, 'fixtures', 'big-80m.mp4');
    fs.writeFileSync(big, randomBytes(80 * MiB));
    const browser2 = await chromium.launch();
    let pageText = '', inBrowser: unknown = null;
    try {
      const { defaultBrowserType: _chromium, ...pixel } = devices['Pixel 5'];
      const ctx = await browser2.newContext({ ...pixel, viewport: { width: 360, height: 800 }, locale: 'he-IL' });
      const ph = await ctx.newPage();
      await ph.goto(c.url);
      await ph.getByTestId(DROP_PAGE_TESTIDS.pickMedia).waitFor({ state: 'attached', timeout: 15_000 });
      await ph.getByTestId(DROP_PAGE_TESTIDS.pickMedia).setInputFiles([big]);
      pageText = await waitFor('the page refuses the big file', async () => { const t = (await ph.getByTestId(DROP_PAGE_TESTIDS.file(0)).textContent().catch(() => '')) ?? ''; return t.includes(HE.failed) ? t : null; }, 60_000).catch(() => 'timeout');
      inBrowser = await ph.evaluate(async (bytes) => { const s = sessionStorage.getItem('pfdrop.s'); try { const r = await fetch('/upload', { method: 'POST', headers: { authorization: `Bearer ${s}`, 'x-filename': 'b.bin' }, body: new Blob([new Uint8Array(bytes)]) }); return { status: r.status, body: await r.text() }; } catch (e) { return { error: String(e) }; } }, 80 * MiB);
      await ctx.close();
    } finally { await browser2.close(); }
    const blobs2 = dirBytes(path.join(dataDir, 'blobs'));
    check('P12', 'the per-file cap (64 MiB): an 80 MiB body is refused 413 upload_too_large before it is read, while the client is still sending (a JSON answer, not a reset); the phone page refuses the file itself in Hebrew; a browser still sending reads the door\'s refusal', over.status === 413 && over.json?.error?.code === 'upload_too_large' && pageText.includes(HE.tooLarge) && (inBrowser as any)?.status === 413, { wire: [over.status, over.json?.error?.code, over.error], pageText, inBrowser });
    check('P11', 'a refused upload stores nothing: the blobs directory and the job rows are as before, without running clean-up', blobs0 === blobs1 && blobs1 === blobs2 && jobs0 === jobs1, { blobs: [blobs0, blobs1, blobs2], jobs: [jobs0, jobs1] });
    // the storage ceiling (40 MiB of room): a 20 MiB file is accepted; a declared 50 MiB one (under the 64 MiB cap) is refused 507
    const f20 = path.join(art, 'fixtures', 'junk-20m.mp4'); fs.writeFileSync(f20, randomBytes(20 * MiB));
    const first = await uploadVia(s1, f20, 'junk-20m.mp4');
    const ceiling = await door('POST', '/upload', { headers: { authorization: `Bearer ${s1}`, 'x-filename': 'more.bin' }, body: 50 * MiB });
    check('P11b', 'the storage ceiling: with 40 MiB of room, a 20 MiB file is accepted and a declared 50 MiB file (under the per-file cap) is refused 507 storage_quota_exceeded while it is still being sent', first.status === 201 && ceiling.status === 507 && ceiling.json?.error?.code === 'storage_quota_exceeded', { first: first.status, second: [ceiling.status, ceiling.json?.error?.code, ceiling.error] });
    // junk bytes are refused as unsupported and their original goes at once: the blobs directory returns to its earlier size
    await waitFor('the junk import fails', async () => readJobs().some((j) => j.input.name === 'junk-20m.mp4' && j.status === 'failed'), 120_000).catch(() => false);
    const blobs3 = dirBytes(path.join(dataDir, 'blobs'));
    check('P11c', 'a junk upload that was accepted and then refused as unsupported leaves the blobs directory at its earlier size, with no clean-up run', blobs3 === blobs0, { before: blobs0, after: blobs3, job: readJobs().find((j) => j.input.name === 'junk-20m.mp4')?.error?.code });
    await stopChild();
    // the code budget, on its own server in this process (PF_DROP_CODE_BYTES 10 MiB): a declared 12 MiB file is refused 413 code_budget
    const s4 = await startServer({ port: PORT + 7, dataDir: path.join(art, 'data-budget'), dropPort: PORT + 8, dropAdmitAddresses: [DOOR], dropCodeBytes: 10 * MiB });
    const o4 = await ownerApi(s4.url, s4.auth.tokens.owner);
    const p4 = (await o4.call('/projects', { name: 'budget' })).body.project.id;
    const c4 = (await o4.call(`/projects/${p4}/drop`, { address: DOOR })).body.drop;
    const h4 = await door('POST', '/hello', { port: PORT + 8, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ token: tokenOf(c4.url) })) });
    const budget = await door('POST', '/upload', { port: PORT + 8, headers: { authorization: `Bearer ${h4.json?.session}`, 'x-filename': 'b.bin' }, body: 12 * MiB });
    await s4.close();
    check('P12b', 'the code budget (10 MiB): a declared 12 MiB file is refused 413 code_budget while it is still being sent', budget.status === 413 && budget.json?.error?.code === 'code_budget', { status: budget.status, code: budget.json?.error?.code, error: budget.error });
    await startChild();
  }

  // ---- P13: SIGKILL during a conversion; every file imports exactly once after the restart
  {
    const pid3 = (await agent.call('/projects', { name: 'restart' })).body.project.id as string;
    const c = await openCode(pid3);
    const s = (await hello(tokenOf(c.url))).json?.session as string;
    for (const f of clips) { const r = await uploadVia(s, f); if (r.status !== 201) throw new Error(`clip ${f}: ${r.status}`); }
    const converting = await waitFor('a conversion running', async () => { const l = (await owner.call(`/projects/${pid3}/imports`)).body.imports as any[]; return l.find((j) => j.state === 'converting') ?? null; }, 120_000, 50).catch(() => null);
    const t0 = Date.now();
    const killedPid = child!.proc.pid;
    await stopChild('SIGKILL');
    const orphan = spawnSync('pgrep', ['-f', `ffmpeg.*${path.join(dataDir, 'tmp')}`], { encoding: 'utf8' }).stdout.trim();
    await startChild();
    const doorClosed = await refused(DOOR, DROP_PORT);
    await waitFor('20 imports after the restart', async () => readJobs(`type = 'import' AND project_id = '${pid3}'`).filter((j) => j.status === 'succeeded').length === 20, 900_000, 1000).catch(() => false);
    const jobs = readJobs(`type = 'import' AND project_id = '${pid3}'`);
    const d = await projectOf(pid3);
    const phoneAssets = Object.values<any>(d.assets).filter((x) => x.provenance?.upload?.via === 'phone');
    const originals = new Set(phoneAssets.map((x) => String(x.conform?.originalContentHash ?? x.contentHash).replace(/^sha256:/, '')));
    const sources = new Set(clips.map(shaFile));
    const interrupted = jobs.find((j) => j.attempt >= 2);
    if (orphan) await waitFor('the orphan ffmpeg to exit', async () => !spawnSync('pgrep', ['-f', `ffmpeg.*${path.join(dataDir, 'tmp')}`], { encoding: 'utf8' }).stdout.trim(), 120_000).catch(() => false);
    const leftovers = fs.readdirSync(path.join(dataDir, 'tmp')).filter((f) => /^(imp|up)_/.test(f));
    check('P13', 'killed with SIGKILL during a conversion and restarted: the code is gone (its port refuses), all 20 files import exactly once (20 assets whose originals are the 20 sources), the interrupted job ran again (attempt 2), and no temporary file is left once any orphan ffmpeg has exited', doorClosed && jobs.length === 20 && jobs.every((j) => j.status === 'succeeded') && phoneAssets.length === 20 && originals.size === 20 && [...originals].every((h) => sources.has(h)) && !!interrupted && leftovers.length === 0, { killedPid, convertingSeen: !!converting, doorClosed, jobs: jobs.length, succeeded: jobs.filter((j) => j.status === 'succeeded').length, assets: phoneAssets.length, distinctOriginals: originals.size, interruptedAttempt: interrupted?.attempt, orphanFfmpegAfterKill: orphan || null, leftovers, secondsToAllImported: (Date.now() - t0) / 1000 });
  }

  // ---- P14: responsiveness of owner commits while imports convert and a 300 MB upload arrives
  {
    const pid4 = (await owner.call('/projects', { name: 'latency' })).body.project.id as string;
    const lat = async (n: number) => { const out: number[] = []; for (let i = 0; i < n; i++) { const t = performance.now(); const r = await owner.call(`/projects/${pid4}/transactions`, { ops: [{ op: 'add_marker', args: { time: { value: String(i % 50), timescale: 10 } } }] }); out.push(performance.now() - t); if (r.status !== 200) throw new Error(`commit ${r.status}`); await owner.call(`/projects/${pid4}/undo`, {}); } return out; };
    const idle = await lat(200);
    const own = await ownerSession();
    for (const [i, f] of busyClips.entries()) await fetch(`${child!.url}/api/v1/projects/${pid4}/imports`, { method: 'POST', headers: { ...own, 'x-filename': `conv-${i}.mp4`, 'content-type': 'application/octet-stream' }, body: new Uint8Array(fs.readFileSync(f)) });
    const busy = await lat(200);
    const c = await openCode(pid4);
    const s = (await hello(tokenOf(c.url))).json?.session as string;
    const bigUp = door('POST', '/upload', { headers: { authorization: `Bearer ${s}`, 'x-filename': 'big-300m.mp4' }, body: 300 * MiB });
    const during = await lat(200);
    const big = await bigUp;
    const stat = (xs: number[]) => ({ p50: +percentile(xs, 0.5).toFixed(1), p95: +percentile(xs, 0.95).toFixed(1), max: +Math.max(...xs).toFixed(1) });
    const limit = Math.max(4 * percentile(idle, 0.95), 120);
    check('P14', 'owner commits stay responsive: while imports convert and while a 300 MB phone upload arrives, p95 <= max(4 × idle p95, 120 ms) and the slowest <= 1 s', percentile(busy, 0.95) <= limit && percentile(during, 0.95) <= limit && Math.max(...busy, ...during) <= 1000 && big.status === 201, { idle: stat(idle), convertingImports: stat(busy), during300MBUpload: stat(during), limitMs: +limit.toFixed(1), upload: big.status, load: os.loadavg() });
    blocked('P14b', 'in the editor, key-to-DOM time of split and move during a conversion (p95 <= 150 ms) with the picker enabled', 'not built in this run: the editor-interactions proof measures key-to-DOM without a conversion; this proof measured the server side only');
  }

  // ---- P18: the queue gives the same asset as the synchronous route did before it (the step-0 baseline)
  {
    await stopChild();
    const r = spawnSync('pnpm', ['proof:phone-drop-baseline', '--check'], { cwd: root, encoding: 'utf8', env: { ...process.env, PF_PROOF_PORT: String(PORT + 6) }, timeout: 900_000 });
    const lines = `${r.stdout}`.split('\n').filter((l) => /^[A-E]: /.test(l));
    check('P18', 'the same assets as before the queue: A–E uploaded in a fresh data directory through today\'s POST …/assets (the queue) equal the step-0 record (docs/evidence/phone-drop-baseline.json, recorded before ingest.ts changed), conformed bytes included', r.status === 0 && lines.length === 5 && lines.every((l) => l.includes('same asset')), { exit: r.status, lines, stderr: r.stderr.slice(-600) });
    notes.p18Frames = 'barcode frames at three positions between preview, server still and export: not run in this proof (the parity suite and proof:phase4 hold the shared compositor)';
    await startChild();
  }

  // ---- P19: the page is named and worded; no door answer ever carried a stack trace
  {
    const browser3 = await chromium.launch();
    const pid5 = (await agent.call('/projects', { name: 'a11y' })).body.project.id as string;
    const c = await openCode(pid5);
    const found: Record<string, unknown> = {};
    try {
      for (const lang of ['he', 'en'] as const) {
        const ctx = await browser3.newContext({ viewport: { width: 390, height: 844 }, locale: lang === 'he' ? 'he-IL' : 'en-US' });
        const ph = await ctx.newPage();
        await ph.goto(c.url);
        await ph.getByTestId(DROP_PAGE_TESTIDS.pickMedia).waitFor({ state: 'attached', timeout: 15_000 });
        found[lang] = await ph.evaluate(() => {
          const nameOf = (el: Element) => { const h = el as HTMLElement; const lb = h.id ? document.querySelector(`label[for="${h.id}"]`)?.textContent : null; return (h.getAttribute('aria-label') ?? lb ?? h.closest('label')?.textContent ?? h.textContent ?? '').trim(); };
          const controls = [...document.querySelectorAll('button, input, select, a[href]')].filter((e) => !(e as HTMLElement).hidden && !(e.closest('[hidden]')));
          return { lang: document.documentElement.lang, dir: document.documentElement.dir, controls: controls.length, unnamed: controls.filter((c) => !nameOf(c)).map((c) => (c as HTMLElement).dataset.testid ?? c.tagName), live: !!document.querySelector('[role=status]') };
        });
        await ph.screenshot({ path: path.join(art, `p19-page-${lang}.png`) });
        await ctx.close();
      }
    } finally { await browser3.close(); }
    const traces = doorBodies.filter((b) => stackTrace.test(b));
    const ok = (f: any) => f && f.unnamed.length === 0 && f.live && f.controls > 0;
    check('P19', 'the phone page in Hebrew and in English: every visible control has a name, a status live region exists (Hebrew first: he/rtl for a Hebrew phone); no door answer carried a stack trace (the editor dialog and cards are audited by audit:a11y)', ok(found.he) && ok(found.en) && (found.he as any).lang === 'he' && (found.he as any).dir === 'rtl' && traces.length === 0, { ...found, doorAnswersRead: doorBodies.length, stackTraces: traces.length });
    notes.pageLanguage = 'the page follows navigator.language: an English-locale phone gets the English page first (review item; the owner decides whether a Hebrew household with en-US phones should get Hebrew first)';
  }

  // ---- P20: shutdown closes the listener and leaves no temp files
  {
    const pid6 = (await agent.call('/projects', { name: 'shutdown' })).body.project.id as string;
    const c = await openCode(pid6);
    const s = (await hello(tokenOf(c.url))).json?.session as string;
    const inFlight = door('POST', '/upload', { headers: { authorization: `Bearer ${s}`, 'x-filename': 'slow.mp4' }, body: 200 * MiB });
    await sleep(300);
    const code = await stopChild('SIGTERM');
    const r = await inFlight;
    const leftovers = fs.readdirSync(path.join(dataDir, 'tmp')).filter((f) => /^(imp|up)_/.test(f));
    check('P20', 'SIGTERM with an upload in flight: the server exits, the door port refuses, the upload does not end as stored, and no temporary file is left', code === 0 && (await refused(DOOR, DROP_PORT)) && r.status !== 201 && leftovers.length === 0, { exit: code, upload: [r.status, r.error, r.json?.error?.code], leftovers });
  }

  evidence.checks = checks;
  evidence.notes = notes;
  evidence.seconds = Math.round((Date.now() - started) / 1000);
  finish(evidence);
}

/** The owner's session headers (cookie and origin), for raw fetches with a body. */
async function ownerSession(): Promise<Record<string, string>> {
  const r = await fetch(`${child!.url}/api/v1/session`, { headers: { origin: child!.url, 'x-pf-owner-key': child!.ownerKey, connection: 'close' } });
  return { cookie: r.headers.get('set-cookie')!.split(';')[0]!, origin: child!.url, connection: 'close' };
}

function finish(evidence: Record<string, unknown>) {
  const passed = checks.filter((c) => c.pass === true).length, failed = checks.filter((c) => c.pass === false), held = checks.filter((c) => c.pass === null);
  evidence.summary = { passed, failed: failed.map((c) => c.id), blocked: held.map((c) => c.id) };
  fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
  fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`\nproof:phone-drop: ${passed} passed, ${failed.length} failed, ${held.length} blocked. Evidence: ${path.relative(root, evidenceFile)}`);
  process.exitCode = failed.length ? 1 : held.length ? 2 : 0;
}

void Readable;
main().catch(async (e) => {
  console.error(e);
  checks.push({ id: 'crash', name: 'the proof ran to its end', pass: false, numbers: { error: String(e?.stack ?? e).slice(0, 2000) } });
  finish({ ranAt: new Date().toISOString(), checks, notes });
  await stopChild('SIGKILL').catch(() => null);
}).finally(async () => { await stopChild().catch(() => null); });
