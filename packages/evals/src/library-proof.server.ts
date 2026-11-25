/**
 * pnpm proof:library, part server (worker A): checks 1–11, 16, 18 of library-proof.ts, over the real server (startServer on
 * 127.0.0.1) and the SYNTHETIC LIBRARY of library-fixtures.ts, against core's own licence table. No stand-in is used: what cannot
 * run here shows as BLOCKED (its own words name what is missing), never as a pass.
 *
 * Each check returns true, or a sentence. A sentence that begins with "BLOCKED" means the check could not run here (no librsvg,
 * no built web app for stills, or a piece another worker or the lead has not landed yet); anything else is a failure.
 * Run alone: `tsx packages/evals/src/library-proof.server.ts` (exit 0 all pass, 1 a failure, 2 only blocked ones besides passes).
 * Writes docs/evidence/library-proof.server.json.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTransaction, LIBRARY_OPS_BUILT, LIBRARY_REFUSALS, OpError, type Asset } from '@pulseframe/core';
import { LIBRARY_HE } from '../../i18n/src/library.ts';
import { startServer, type RunningServer } from '@pulseframe/server';
import { canRasteriseSvg } from '../../../apps/server/src/elements.ts';
import { closeLibraryService } from '../../../apps/server/src/library/index.ts';
import * as raster from '../../../apps/server/src/library/raster.ts';
import { DATA_CSP } from '../../../apps/server/src/http.ts';
import { FIX_COUNTS, FIX_KEYS, FIX_SVG_COUNTS, makeLibraryFixture, type LibraryFixture } from './library-fixtures.ts';
import type { LibraryProofPart } from './library-proof.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = 18000 + Math.floor(Math.random() * 1000);
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const evidence: Record<string, unknown> = {};

// ---------- no outbound connection: a counter of non-loopback connects, and proxies pointed at a refusing local port ----------
const outbound: string[] = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  const o = args[0] as { host?: string; path?: string } | number | string;
  const host = typeof o === 'object' && o ? o.host ?? (o.path ? 'local-socket' : 'localhost') : typeof args[1] === 'string' ? args[1] : 'localhost';
  if (!/^(127\.|::1$|localhost$|local-socket$|\[::1\]$)/.test(String(host))) outbound.push(String(host));
  return (realConnect as (...a: unknown[]) => net.Socket).apply(this, args);
} as typeof net.Socket.prototype.connect;
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) process.env[k] = 'http://127.0.0.1:9';
delete process.env.PF_LIBRARY_DIR;

interface World {
  s: RunningServer; fx: LibraryFixture; base: string; dataDir: string; pid: string; rasteriser: boolean;
  owner: Record<string, string>; agent: Record<string, string>; observer: Record<string, string>; proposer: Record<string, string>;
  types: { url: string; type: string; csp: string | null }[];
}
let worldP: Promise<World> | null = null;
const world = () => (worldP ??= makeWorld());

async function boot(dataDir: string) {
  return startServer({ port: PORT, dataDir, libraryDir: null, speechPython: null, voicePython: null, backupDir: null });
}
async function makeWorld(): Promise<World> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-library-proof-'));
  const fx = await makeLibraryFixture(path.join(base, 'fixture'));
  const dataDir = path.join(base, 'data');
  const s = await boot(dataDir);
  const w = { s, fx, base, dataDir, pid: '', rasteriser: await canRasteriseSvg(), types: [] } as unknown as World;
  heads(w);
  const p = await call(w, w.owner, 'POST', '/projects', { name: 'library proof', width: 640, height: 360, frameRate: { num: 30, den: 1 } });
  w.pid = p.body.project.id;
  return w;
}
function heads(w: World) {
  const ownerCookie = w.s.auth.issueSession(new Request(`${w.s.url}/api/v1/session`, { headers: { origin: w.s.url, 'x-pf-owner-key': w.s.auth.tokens.owner } })).split(';')[0]!;
  w.owner = { cookie: ownerCookie, origin: w.s.url };
  w.agent = { authorization: `Bearer ${w.s.auth.tokens.agent}` };
  w.observer = { authorization: `Bearer ${w.s.auth.tokens.observer}` };
  w.proposer = { authorization: `Bearer ${w.s.governance.createGrant({ name: 'proposer', mode: 'propose' }, { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] }).token}` };
}
async function call(w: World, who: Record<string, string>, method: string, p: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; body: any; bytes: Buffer; headers: Headers }> {
  const isBytes = body instanceof Uint8Array;
  const r = await fetch(`${w.s.url}/api/v1${p}`, { method, headers: { ...who, connection: 'close', ...(body !== undefined && !isBytes ? { 'content-type': 'application/json' } : {}), ...extra }, ...(body !== undefined ? { body: isBytes ? (body as BodyInit) : JSON.stringify(body) } : {}) });
  const bytes = Buffer.from(await r.arrayBuffer());
  const type = r.headers.get('content-type') ?? '';
  if (p.includes('/library')) w.types.push({ url: p, type, csp: r.headers.get('content-security-policy') });
  let parsed: unknown = null;
  if (type.includes('json')) { try { parsed = JSON.parse(bytes.toString('utf8')); } catch { parsed = null; } }
  return { status: r.status, body: parsed, bytes, headers: r.headers };
}
const item = (key: string, tail = '') => `/library/items/${encodeURIComponent(key)}${tail}`;
const keysOf = async (w: World, q: string) => ((await call(w, w.observer, 'GET', `/library/items?${q}`)).body?.rows ?? []).map((r: { key: string }) => r.key);
async function untilReady(w: World): Promise<any> {
  for (let i = 0; i < 2400; i++) { const st = (await call(w, w.owner, 'GET', '/library/status')).body; if (st.state !== 'indexing') return st; await sleep(50); }
  throw new Error('the index did not finish');
}
const expectedCounts = (rasteriser: boolean) => Object.fromEntries(Object.entries(FIX_COUNTS).map(([k, n]) => [k, n - (rasteriser ? 0 : (FIX_SVG_COUNTS as Record<string, number>)[k] ?? 0)]).filter(([, n]) => (n as number) > 0));
const counts = (w: World) => ({
  blobs: (w.s.store.db.prepare('SELECT count(*) AS n FROM blobs').get() as { n: number }).n,
  jobs: (w.s.store.db.prepare('SELECT count(*) AS n FROM jobs').get() as { n: number }).n,
  assets: Object.keys(w.s.store.getProject(w.pid).doc.assets).length,
});
const sorted = (v: unknown): unknown => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])])) : Array.isArray(v) ? v.map(sorted) : v);
const same = (a: unknown, b: unknown) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const fail = (what: string, data?: unknown) => `${what}${data === undefined ? '' : `: ${JSON.stringify(data).slice(0, 600)}`}`;
const use = (w: World, who: Record<string, string>, key: string, extra: Record<string, unknown> = {}) => call(w, who, 'POST', `/projects/${w.pid}/library/use`, { key, ...extra });
const notBuiltYet = (r: { status: number; body: any }) => r.status === 501 && r.body?.error?.code === 'library_not_built';
/** RGBA of a pixel of a PNG (ffmpeg decodes it), with its size. */
function pixel(png: Buffer, fx = 0.5, fy = 0.5): { w: number; h: number; rgba: number[] } {
  const f = path.join(os.tmpdir(), `pf-libproof-${Math.random().toString(36).slice(2)}.png`);
  fs.writeFileSync(f, png);
  try {
    const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f]).toString().trim().split(',').map(Number) as [number, number];
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 });
    const o = (Math.floor(h * fy) * w + Math.floor(w * fx)) * 4;
    return { w, h, rgba: [raw[o]!, raw[o + 1]!, raw[o + 2]!, raw[o + 3]!] };
  } finally { fs.rmSync(f, { force: true }); }
}
/** Seconds of the first sample above a tenth of full scale in a 16-bit PCM WAV. */
function onsetSeconds(wav: Buffer): number | null {
  let o = 12, rate = 0, channels = 0, bits = 0;
  while (o + 8 <= wav.length) {
    const id = wav.toString('latin1', o, o + 4), len = wav.readUInt32LE(o + 4);
    if (id === 'fmt ') { channels = wav.readUInt16LE(o + 10); rate = wav.readUInt32LE(o + 12); bits = wav.readUInt16LE(o + 22); }
    if (id === 'data') {
      if (bits !== 16 || !rate) return null;
      const n = Math.min(len, wav.length - o - 8) / 2;
      for (let i = 0; i < n; i++) if (Math.abs(wav.readInt16LE(o + 8 + i * 2)) > 3276) return Math.floor(i / channels) / rate;
      return null;
    }
    o += 8 + len + (len % 2);
  }
  return null;
}

const checks: LibraryProofPart['checks'] = {
  1: async () => {
    const w = await world();
    const st = (await call(w, w.observer, 'GET', '/library/status')).body;
    if (st?.state !== 'not_configured') return fail('status without a root is not not_configured', st);
    const items = await call(w, w.observer, 'GET', '/library/items?q=x');
    const u = await use(w, w.owner, FIX_KEYS.track120);
    if (items.status !== 409 || items.body?.error?.code !== 'library_not_configured') return fail('items without a root', items.body);
    if (u.status !== 409 || u.body?.error?.code !== 'library_not_configured') return fail('use without a root', u.body);
    if (outbound.length) return fail('non-loopback connections', outbound);
    evidence[1] = { state: st.state, items: items.status, use: u.status, outbound: outbound.length, ui: 'the tabs\' «הספרייה לא מוגדרת» is part ui (check 17)' };
    return true;
  },
  2: async () => {
    const w = await world();
    const agentPut = await call(w, w.agent, 'PUT', '/library/root', { root: w.fx.root });
    if (agentPut.status !== 403 || agentPut.body?.error?.code !== 'owner_required') return fail('agent PUT root', agentPut.body);
    const inData = path.join(w.dataDir, 'lib-inside');
    fs.mkdirSync(path.join(inData, '_manifests'), { recursive: true });
    fs.writeFileSync(path.join(inData, '_manifests', 'ledger.json'), '{"ledgerVersion":1,"entries":[]}');
    for (const [root, reason] of [[inData, 'it lies inside the data directory'], [path.join(w.base, 'missing'), 'it does not exist']] as const) {
      const r = await call(w, w.owner, 'PUT', '/library/root', { root });
      if (r.status !== 400 || r.body?.error?.details?.reason !== reason) return fail(`root ${reason}`, r.body);
    }
    const put = await call(w, w.owner, 'PUT', '/library/root', { root: w.fx.root });
    if (put.status !== 200) return fail('owner PUT root', put.body);
    const st = await untilReady(w);
    if (st.state !== 'ready' || !same(st.counts, expectedCounts(w.rasteriser))) return fail('ready with the fixture\'s counts', { got: st.counts, want: expectedCounts(w.rasteriser) });
    const q = 'q=tone&limit=200';
    const before = await keysOf(w, q);
    if (before.length < 3) return fail('baseline query', before);
    const states: Record<string, string> = {};
    const step = async (name: string, change: () => void, undo: () => void, want: string) => {
      change();
      try {
        const s2 = (await call(w, w.owner, 'GET', '/library/status')).body;
        states[name] = s2.state;
        if (s2.state !== want) return fail(`${name} state`, s2);
        const k = await keysOf(w, q);
        if (!same(k, before)) return fail(`${name}: the previous index did not answer the same keys`, k);
        return null;
      } finally { undo(); }
    };
    const r1 = await step('missing folder', () => fs.renameSync(w.fx.root, `${w.fx.root}.away`), () => fs.renameSync(`${w.fx.root}.away`, w.fx.root), 'root_missing');
    if (r1) return r1;
    const r2 = await step('missing ledger', () => fs.renameSync(w.fx.ledgerFile, `${w.fx.ledgerFile}.away`), () => fs.renameSync(`${w.fx.ledgerFile}.away`, w.fx.ledgerFile), 'ledger_missing');
    if (r2) return r2;
    const r3 = await step('ledgerVersion 2', () => w.fx.ledgerV2(), () => w.fx.restoreLedger(), 'ledger_invalid');
    if (r3) return r3;
    if ((await call(w, w.owner, 'GET', '/library/status')).body.state !== 'ready') return fail('ready again');
    evidence[2] = { counts: st.counts, notListed: st.notListed, unusable: st.unusable, states };
    return true;
  },
  3: async () => {
    const w = await world();
    const firsts: Record<string, string> = {};
    for (const q of ['חנוכיה', 'החנוכיה', 'חֲנֻכִּיָּה', 'menorah']) firsts[q] = (await keysOf(w, `q=${encodeURIComponent(q)}`))[0];
    if (!Object.values(firsts).every((k) => k === FIX_KEYS.menorah)) return fail('first keys differ', firsts);
    const bpm = await keysOf(w, 'bpmMin=100&bpmMax=130');
    if (!same(bpm, [FIX_KEYS.track120])) return fail('bpm 100–130', bpm);
    const all = (await call(w, w.observer, 'GET', '/library/items?limit=200')).body.rows as any[];
    const ccby = all.filter((r) => r.licenceId.startsWith('CC-BY'));
    const none = (await call(w, w.observer, 'GET', '/library/items?credit=none&limit=200')).body.rows as any[];
    if (!ccby.length || none.some((r) => r.licenceId.startsWith('CC-BY') || r.duties.credit)) return fail('credit=none shows a CC BY row', none.map((r) => r.key));
    const a = await keysOf(w, 'q=tone&limit=200'), b = await keysOf(w, 'q=tone&limit=200');
    if (!same(a, b)) return fail('the same query twice', [a, b]);
    evidence[3] = { firsts, bpm, ccbyRows: ccby.length, creditNoneRows: none.length };
    return true;
  },
  4: async () => {
    const w = await world();
    const file = fs.readFileSync(path.join(w.fx.root, 'sounds', 'fx-cc0', 'tone-a.wav'));
    const r = await call(w, w.observer, 'GET', item(FIX_KEYS.toneA, '/audio'), undefined, { range: 'bytes=100-199' });
    if (r.status !== 206 || !r.bytes.equals(file.subarray(100, 200))) return fail('range 100-199', { status: r.status, len: r.bytes.length });
    const m4a = await call(w, w.observer, 'GET', item(FIX_KEYS.m4a, '/audio'));
    const pic = await call(w, w.observer, 'GET', item(FIX_KEYS.pattern, '/audio'));
    if (m4a.status !== 415 || pic.status !== 415) return fail('415', [m4a.status, pic.status]);
    evidence[4] = { range: r.headers.get('content-range'), m4a: m4a.body?.error?.code, picture: pic.body?.error?.code };
    return true;
  },
  5: async () => {
    const w = await world();
    const start = { value: '30', timescale: 30 };
    const r = await use(w, w.owner, FIX_KEYS.track120, { start });
    if (notBuiltYet(r)) return 'BLOCKED (part duties: use_library_item is not built in this build; 501 library_not_built, nothing stored)';
    if (r.status !== 201) return fail('use', r.body);
    const doc = w.s.store.getProject(w.pid).doc;
    const a = doc.assets[r.body.assetId] as Asset;
    const ledger = JSON.parse(fs.readFileSync(w.fx.ledgerFile, 'utf8')).entries.findLast((e: any) => e.item === 'fx-incompetech/tone-120');
    const row = (await call(w, w.observer, 'GET', item(FIX_KEYS.track120))).body;
    const rec = a.provenance.library!;
    if (a.contentHash !== `sha256:${ledger.sha256}`) return fail('contentHash', [a.contentHash, ledger.sha256]);
    const want = { itemId: row.key, sourceId: row.sourceId, kind: row.kind, title: row.title, licenceId: row.licenceId, credit: row.credit };
    const got = { itemId: rec.itemId, sourceId: rec.sourceId, kind: rec.kind, title: rec.title, licenceId: rec.licence.id, credit: rec.credit };
    if (!same(got, want) || a.provenance.upload) return fail('record', { got, want });
    const clip = Object.values(doc.sequences).flatMap((s: any) => s.tracks.flatMap((t: any) => t.clips)).find((c: any) => c.assetId === a.id) as any;
    if (!clip || clip.start.value !== '30' || clip.start.timescale !== 30) return fail('clip at the asked frame', clip?.start);
    // the exported WAV
    const ex = await call(w, w.owner, 'POST', `/projects/${w.pid}/exports`, { format: 'wav' });
    if (ex.status !== 202) return fail('export', ex.body);
    let job: any;
    for (let i = 0; i < 1200; i++) { job = (await call(w, w.owner, 'GET', `/jobs/${ex.body.jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(job.status)) break; await sleep(100); }
    if (job.status !== 'succeeded') return fail('export job', job.error);
    const wav = (await call(w, w.owner, 'GET', `/jobs/${job.id}/output`)).bytes;
    const onset = onsetSeconds(wav);
    if (onset === null || Math.abs(onset - 1) > 1 / 30) return fail('onset not within one frame of 1 s', onset);
    const undo = await call(w, w.owner, 'POST', `/projects/${w.pid}/undo`, {});
    const after = w.s.store.getProject(w.pid).doc;
    const still = Object.values(after.sequences).flatMap((s: any) => s.tracks.flatMap((t: any) => t.clips)).some((c: any) => c.assetId === a.id);
    if (undo.status !== 200 || still || !after.assets[a.id]) return fail('undo removes the clip and keeps the file', { undo: undo.status, still });
    evidence[5] = { contentHash: a.contentHash, record: got, clipStart: clip.start, onsetSeconds: onset };
    return true;
  },
  6: async () => {
    const w = await world();
    const flac = fs.readFileSync(path.join(w.fx.root, 'music', 'musopen', 'flac', 'Aria.flac'));
    const up = await call(w, w.owner, 'POST', `/projects/${w.pid}/assets`, new Uint8Array(flac), { 'x-filename': 'Aria.flac', 'content-type': 'application/octet-stream' });
    if (up.status !== 201) return fail('hand upload', up.body);
    const n = counts(w).assets;
    const r = await use(w, w.owner, FIX_KEYS.flac);
    if (notBuiltYet(r)) return 'BLOCKED (part duties: use_library_item is not built in this build)';
    if (r.status !== 201 || r.body.recordAttached !== true || counts(w).assets !== n || r.body.assetId !== up.body.assetId) return fail('record attached to the hand upload', { status: r.status, body: r.body, assets: [n, counts(w).assets] });
    evidence[6] = { assets: n, recordAttached: true, deduplicated: r.body.deduplicated };
    return true;
  },
  7: async () => {
    const w = await world();
    const before = counts(w);
    const opened: string[] = [];
    const realOpen = fs.promises.open, realOpenSync = fs.openSync;
    fs.promises.open = (async (...a: Parameters<typeof realOpen>) => { opened.push(String(a[0])); return realOpen(...a); }) as typeof realOpen;
    fs.openSync = ((...a: Parameters<typeof realOpenSync>) => { opened.push(String(a[0])); return realOpenSync(...a); }) as typeof realOpenSync;
    const got: Record<string, string> = {};
    try {
      got.tampered = (await use(w, w.owner, FIX_KEYS.tampered)).body?.error?.code;
      w.fx.touchTreeFile();
      got.touched = (await use(w, w.owner, 'fx-cc0-sounds/pack/tone-b.wav')).body?.error?.code;
      got.link = (await use(w, w.owner, FIX_KEYS.linked)).body?.error?.code;
      w.fx.handLedger();
      await call(w, w.owner, 'POST', '/library/reindex');
      await untilReady(w);
      got.dotdot = (await use(w, w.owner, FIX_KEYS.dotdot)).body?.error?.code;
    } finally {
      fs.promises.open = realOpen; fs.openSync = realOpenSync;
      w.fx.restoreLedger();
      await call(w, w.owner, 'POST', '/library/reindex');
      await untilReady(w);
    }
    const want = { tampered: 'library_hash_mismatch', touched: 'library_changed_since_index', link: 'library_path_escape', dotdot: 'library_path_escape' };
    if (!same(got, want)) return fail('refusals', got);
    const after = counts(w);
    if (!same(after, before)) return fail('something was stored', { before, after });
    const secret = opened.filter((f) => f.includes('secret'));
    if (secret.length) return fail('the outside file was opened', secret);
    if (!opened.length) return fail('the open spy saw nothing (it would prove nothing)');
    evidence[7] = { refusals: got, counts: after, opensSeen: opened.length, outsideOpens: 0 };
    return true;
  },
  8: async () => {
    const w = await world();
    const icons = (await call(w, w.observer, 'GET', '/library/items?kind=icon&limit=200')).body.rows as any[];
    if (!w.rasteriser) return 'BLOCKED (no SVG rasteriser on this machine: icon rows are not offered)';
    const mit = icons.filter((r) => r.key.includes('/fxmit.json#'));
    if (mit.length !== 3 || mit.some((r) => r.duties.nonCommercial !== false || r.duties.shareable !== false)) return fail('MIT icon rows', mit.map((r) => [r.key, r.duties]));
    const banned = icons.filter((r) => /\/(fxnc|fxgpl|ri)\.json#/.test(r.key));
    if (banned.length) return fail('NC, GPL or ri rows listed', banned.map((r) => r.key));
    const personal = (await call(w, w.observer, 'GET', item(FIX_KEYS.personal))).body;
    if (personal.duties?.nonCommercial !== true || LIBRARY_HE['library.badge.nonCommercial'] !== 'לשימוש לא מסחרי בלבד') return fail('personalOnly row', personal);
    const track = (await call(w, w.observer, 'GET', item(FIX_KEYS.track120))).body;
    if (!track.credit?.text?.startsWith('Tone Track ')) return fail('incompetech credit', track.credit);
    evidence[8] = { mitRows: mit.length, bannedRows: 0, personal: personal.duties, incompetechCredit: track.credit.text.split('\n')[0] };
    return true;
  },
  9: async () => {
    const w = await world();
    const reasons: Record<string, unknown> = {};
    for (const [k, why] of [[FIX_KEYS.nd, 'licence_no_derivatives'], [FIX_KEYS.unknownCustom, 'licence_unknown'], [FIX_KEYS.animated, 'animated']] as const) {
      const row = (await call(w, w.observer, 'GET', item(k))).body;
      const u = await use(w, w.owner, k);
      reasons[k] = [row.unusable, u.status, u.body?.error?.details?.reason];
      if (row.unusable !== why || u.status !== 409 || u.body?.error?.code !== 'library_item_unusable' || u.body?.error?.details?.reason !== why) return fail(`${k}`, reasons[k]);
    }
    // a hand-built use_library_item with a no-derivatives record is refused by core itself
    const doc = w.s.store.getProject(w.pid).doc;
    const asset = { kind: 'audio', name: 'nd.wav', contentHash: `sha256:${sha('nd')}`, byteSize: 2, container: 'wav', mimeType: 'audio/wav', duration: { value: '1', timescale: 1 }, audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' },
      provenance: { origin: 'upload', importedAt: new Date().toISOString(), importedBy: 'user:local', library: { itemId: FIX_KEYS.nd, sourceId: 'fx-nd', kind: 'sound', title: 'nd', sourceSha256: sha('nd'), ledger: { item: 'fx-nd/nd' }, licence: { id: 'CC-BY-ND-4.0' }, credit: { text: 'x', placement: 'description' }, flags: {} } } };
    let core: unknown = 'not refused';
    try { applyTransaction(doc, [{ op: 'use_library_item', args: { asset } }], { idSeed: 'proof', actor: 'user:local', allowInternal: true }); } catch (e) { core = e instanceof OpError ? { code: e.code, message: e.message } : String(e); }
    if (!LIBRARY_OPS_BUILT) return `BLOCKED (part duties: use_library_item is not built; the three rows were listed with their reasons and refused 409: ${JSON.stringify(reasons).slice(0, 300)})`;
    if (!same(core, { code: 'incompatible', message: LIBRARY_REFUSALS.licenceNoDerivatives.message() })) return fail('core did not refuse the ND record', core);
    evidence[9] = { reasons, core };
    return true;
  },
  10: async () => {
    const w = await world();
    const blocked: string[] = [];
    // Fluent 3D PNG: no rasteriser involved
    const r = await use(w, w.owner, FIX_KEYS.menorah, { start: { value: '0', timescale: 30 } });
    if (notBuiltYet(r)) blocked.push('use_library_item is not built (part duties)');
    else {
      if (r.status !== 201) return fail('sticker use', r.body);
      const a = w.s.store.getProject(w.pid).doc.assets[r.body.assetId] as Asset;
      if (!a.image?.hasAlpha || a.image.width !== 256 || a.image.height !== 256) return fail('sticker asset', a.image);
      evidence['10.sticker'] = a.image;
      if (!fs.existsSync(path.join(ROOT, 'apps', 'web', 'dist', 'render.html'))) blocked.push('the still needs the built web app (pnpm build)');
      else {
        const still = await call(w, w.owner, 'GET', `/projects/${w.pid}/frame?index=0`);
        const px = pixel(still.bytes);
        evidence['10.still'] = px;
        if (still.status !== 200 || px.rgba[0]! < 200 || px.rgba[1]! < 120) return fail('the still shows no ink in the clip box', px);
      }
    }
    // a red icon, rasterised
    if (!w.rasteriser) blocked.push('no librsvg: the red icon was not drawn');
    else {
      const ic = await use(w, w.owner, FIX_KEYS.iconCircle, { color: '#ff0000', longSide: 256 });
      if (notBuiltYet(ic)) blocked.push('use_library_item is not built (part duties) for the icon');
      else {
        if (ic.status !== 201) return fail('icon use', ic.body);
        const a = w.s.store.getProject(w.pid).doc.assets[ic.body.assetId] as Asset;
        const png = fs.readFileSync(w.s.store.blobPath(a.contentHash));
        const px = pixel(png);
        evidence['10.icon'] = { ...px, raster: a.provenance.library?.raster };
        if (px.rgba[0]! < 200 || px.w !== 256) return fail('red icon centre', px);
      }
    }
    // the unsafe SVG: refused before ffmpeg
    const runs = raster.libraryRasterRuns;
    const u = await use(w, w.owner, FIX_KEYS.unsafe);
    if (u.status !== 422 || u.body?.error?.code !== 'svg_unsafe' || raster.libraryRasterRuns !== runs) return fail('unsafe SVG', { status: u.status, body: u.body, runs: [runs, raster.libraryRasterRuns] });
    evidence['10.unsafe'] = { status: 422, why: u.body.error.message, rasterRuns: 'unchanged' };
    return blocked.length ? `BLOCKED (${blocked.join('; ')}); the unsafe SVG was refused 422 before ffmpeg` : true;
  },
  11: async () => {
    const w = await world();
    for (const key of [FIX_KEYS.pattern, FIX_KEYS.menorah, ...(w.rasteriser ? [FIX_KEYS.heart, FIX_KEYS.iconCircle] : [])]) {
      const t = await call(w, w.observer, 'GET', item(key, '/thumb?size=256'));
      if (t.status !== 200 || t.headers.get('content-type') !== 'image/png' || t.headers.get('content-security-policy') !== DATA_CSP || t.bytes.readUInt32BE(0) !== 0x89504e47) return fail(`thumb ${key}`, { status: t.status, type: t.headers.get('content-type'), csp: t.headers.get('content-security-policy') });
    }
    const svg = w.types.filter((x) => /svg/i.test(x.type));
    if (svg.length) return fail('a library answer was SVG', svg);
    const noCsp = w.types.filter((x) => x.csp !== DATA_CSP);
    if (noCsp.length) return fail('a library answer without DATA_CSP', noCsp.slice(0, 3));
    evidence[11] = { libraryAnswers: w.types.length, svgAnswers: 0 };
    return true;
  },
  16: async () => {
    let w = await world();
    const parts: string[] = [];
    // MCP use_library_item: propose mode is refused (REST is: 403 insufficient_scope)
    const rest = await use(w, w.proposer, FIX_KEYS.track120);
    if (rest.status !== 403) return fail('REST use in propose mode', rest.body);
    const mcp = async (who: Record<string, string>, name: string, args: Record<string, unknown>) => {
      const r = await fetch(`${w.s.url}/mcp`, { method: 'POST', headers: { ...who, 'content-type': 'application/json', accept: 'application/json, text/event-stream', connection: 'close' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
      const text = await r.text();
      const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
      return { isError: !!msg.result?.isError, text: String(msg.result?.content?.[0]?.text ?? '') };
    };
    const m = await mcp(w.proposer, 'use_library_item', { projectId: w.pid, key: FIX_KEYS.track120 });
    if (m.text.includes('library_not_built')) parts.push('MCP use_library_item still answers library_not_built: mcp.ts needs the one-line delegation to library/routes.ts useLibraryItemFor (lead)');
    else if (!m.isError || !m.text.includes('insufficient_scope')) return fail('MCP use in propose mode', m);
    // MCP use_library_item answers as REST does (an edit-mode agent): needs the lead's one-line delegation in mcp.ts
    const ma = await mcp(w.agent, 'use_library_item', { projectId: w.pid, key: FIX_KEYS.nd });
    if (ma.text.includes('library_not_built')) parts.push('MCP use_library_item (edit mode) answers library_not_built: mcp.ts needs the one-line delegation to library/routes.ts useLibraryItemFor (lead)');
    else if (!ma.text.includes('library_item_unusable')) return fail('MCP use of an unusable row did not answer as REST', ma);
    const g = await mcp(w.agent, 'get_credits', { projectId: w.pid });
    if (g.text.includes('library_not_built')) parts.push('get_credits is not built (part duties)');
    else {
      const restCredits = await call(w, w.agent, 'GET', `/projects/${w.pid}/credits`);
      if (!same(JSON.parse(g.text), restCredits.body)) return fail('get_credits differs from REST', [g.text.slice(0, 200), restCredits.body]);
    }
    // cancel keeps the previous counts
    const prev = (await call(w, w.owner, 'GET', '/library/status')).body.counts;
    w.fx.handLedger();
    try {
      await call(w, w.owner, 'POST', '/library/reindex');
      const d = (await call(w, w.owner, 'DELETE', '/library/reindex')).body;
      if (!same(d.counts, prev)) return fail('cancel did not keep the previous counts', [d.counts, prev]);
      // a restart in the middle of a build: the server stops (its library service with it, as the process would), starts again
      await call(w, w.owner, 'POST', '/library/reindex');
      await w.s.close();
      closeLibraryService(w.dataDir);
      w.s = await boot(w.dataDir);
      heads(w);
      const st = await untilReady(w);
      const want = { ...expectedCounts(w.rasteriser) } as Record<string, number>;
      want.music = (want.music ?? 0) + 1; // the hand-edited copy adds one listed row (the `..` one)
      if (st.state !== 'ready' || !same(st.counts, want)) return fail('after the restart', { got: st.counts, want });
      evidence[16] = { cancelKept: prev, afterRestart: st.counts };
    } finally {
      w.fx.restoreLedger();
      await call(w, w.owner, 'POST', '/library/reindex');
      await untilReady(w);
      w = await world();
    }
    if (outbound.length) return fail('non-loopback connections during the proof', outbound);
    return parts.length ? `BLOCKED (${parts.join('; ')}); cancel and restart passed` : true;
  },
  18: async () => {
    const w = await world();
    // a generated library of 600,000 icon rows (one Iconify-shaped package, 60 sets of 10,000), indexed by a second server
    const genRoot = path.join(w.base, 'generated-600k');
    const pkg = path.join(genRoot, 'visual', 'icons', 'gen');
    fs.mkdirSync(path.join(pkg, 'json'), { recursive: true });
    const collections: Record<string, unknown> = {};
    for (let s = 0; s < 60; s++) {
      const prefix = `gen${s}`;
      collections[prefix] = { name: `Generated ${s}`, author: { name: 'generator' }, license: { title: 'MIT', spdx: 'MIT', url: 'https://example.invalid' } };
      const icons: Record<string, { body: string }> = {};
      for (let i = 0; i < 10_000; i++) icons[`icon-${s}-${i}`] = { body: `<rect width="${(i % 20) + 1}" height="4"/>` };
      fs.writeFileSync(path.join(pkg, 'json', `${prefix}.json`), JSON.stringify({ prefix, width: 24, height: 24, icons }));
    }
    fs.writeFileSync(path.join(pkg, 'collections.json'), JSON.stringify(collections));
    fs.mkdirSync(path.join(genRoot, '_manifests'), { recursive: true });
    fs.writeFileSync(path.join(genRoot, '_manifests', 'ledger.json'), JSON.stringify({ ledgerVersion: 1, licenceTexts: [], entries: [{ item: 'gen/package', source: 'iconify-json', sourceTitle: 'GENERATED', manifest: 'gen', manifestSha256: '0'.repeat(64), kind: 'npm', identity: 'gen', url: 'gen', path: 'visual/icons/gen', bytes: 1, pinned: true, licence: { custom: 'Mixed', url: 'x', readOn: '2026-11-25', quote: 'x' }, credit: null, flags: { diskOnly: true }, time: new Date().toISOString() }] }));
    const genData = path.join(w.base, 'gen-data');
    const { LibraryService } = await import('../../../apps/server/src/library/index.ts');
    const { loadConfig } = await import('../../../apps/server/src/config.ts');
    fs.mkdirSync(genData);
    const t0 = Date.now();
    const svc = new LibraryService({ ...loadConfig({}), dataDir: genData, libraryDir: genRoot });
    await svc.idle();
    const indexMs = Date.now() - t0;
    const st = await svc.status(true);
    const q0 = Date.now();
    const page = await svc.search({ q: 'icon 59', limit: 50 });
    const queryMs = Date.now() - q0;
    const q1 = Date.now();
    await svc.search({ q: 'ic', limit: 50 });
    const prefixMs = Date.now() - q1;
    svc.close();
    fs.rmSync(genRoot, { recursive: true, force: true });
    evidence[18] = { rows: st.counts.icon ?? 0, problems: st.problems.slice(0, 3), indexMs, queryMs, prefixQueryMs: prefixMs, firstPage: page.rows.length, note: 'one sample, recorded, not gated' };
    if (!st.counts.icon) return `BLOCKED (nothing was listed: ${JSON.stringify(st.problems.slice(0, 2))})`;
    console.log(`  18 recorded: ${st.counts.icon} rows indexed in ${indexMs} ms; query ${queryMs} ms, two-letter prefix ${prefixMs} ms (one sample, not gated)`);
    return true;
  },
};

export const LIBRARY_PROOF_SERVER: LibraryProofPart = { built: true, checks };

/** Stops the server and removes the temp folders (the runner may call it; the stand-alone run does). */
export async function closeLibraryProofServer(): Promise<void> {
  if (!worldP) return;
  const w = await worldP;
  await w.s.close();
  closeLibraryService(w.dataDir);
  fs.rmSync(w.base, { recursive: true, force: true });
  try {
    fs.mkdirSync(path.join(ROOT, 'docs', 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'docs', 'evidence', 'library-proof.server.json'), JSON.stringify({ when: new Date().toISOString(), rasteriser: w.rasteriser, evidence }, null, 1) + '\n');
  } catch { /* evidence is best effort */ }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let failed = 0, blocked = 0;
  try {
    for (const [n, check] of Object.entries(checks)) {
      let r: true | string;
      try { r = await check(); } catch (e) { r = `threw: ${(e as Error).stack?.slice(0, 600) ?? e}`; }
      const b = r !== true && r.startsWith('BLOCKED');
      console.log(`${r === true ? 'PASS' : b ? 'BLOCKED' : 'FAIL'} ${n} (server)${r === true ? '' : `: ${r}`}`);
      if (r !== true) { if (b) blocked++; else failed++; }
    }
  } finally {
    await closeLibraryProofServer();
  }
  process.exit(failed ? 1 : blocked ? 2 : 0);
}
