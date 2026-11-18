/**
 * `pnpm proof:family-film` — the end-to-end proof of the family film maker and measured moments (ADR-0026; the plan's section 10
 * with the verifier's corrected checks, which win), on a CPU, with no model. Evidence: docs/evidence/family-film-proof.json
 * (every measurement, and for each check: passed, failed with its numbers, or 'not run' with the reason).
 * Exit codes: 0 = every check passed; 1 = a check failed (its numbers are in the evidence, never relaxed); 2 = blocked (the web
 * bundle is missing, or a section could not run: listed under `blocked` with its reason).
 *
 * Fixtures (packages/fixtures/src/film.ts): 640x360 30 fps clips of 12-16 s with a CHROMA-ONLY barcode (clip << 12 | frame, read
 * on the blue channel), each with one 6 s truth window (a disc over a static noise texture plus 1 kHz bursts over -40 dBFS
 * noise); a whip-pan decoy at 1219 permille/s, a dark stretch, a clip without sound, a static silent clip, a clip active for 85 %
 * of its length, a clip whose picture starts 15 frames late, one still, container capture times out of name order; a 120 BPM
 * accented loop with no 1 kHz energy. Every expected number below is typed here from the fixture's own formulas
 * (FILM_FIXTURE / truth.json), never computed by the code under test.
 * Checks (each can fail for the reason it names; where a check could hold by construction it has a control that must fail):
 * - F1  each top candidate's peak inside its truth window; the clean stretch covers the window minus 0.4 s at each end;
 * - F2  the decoy and the dark stretch are in no candidate and their samples are gated in the data file;
 * - F3  the job's samples are exactly frames k*S: an independent ffmpeg read of the same frames gives the job's grey digest and
 *       barcodes k*S, on the proxy and on the original, also on the clip whose picture starts late;
 * - F4  cancel mid-run: canceled, revision unchanged; a restart completes with ONE revision;
 * - F5  a second run (records undone, data files kept) decodes nothing and attaches the same records; a forced re-measure gives
 *       the same data digests;
 * - F6  each moments record within MOMENTS_RECORD_BUDGET_BYTES (1100), the run record within 16 000 bytes, at most 3 reasons a
 *       pick; median commit latency before and after measuring, reported;
 * - F7  capture order (control: the 'given' order differs); a reason on every pick, said in Hebrew in the dialog's own words with
 *       none of the forbidden words; the static clip says default middle; the 85 %-active clip says active throughout; faces are
 *       not used and the plan says so;
 * - F8  apply is one revision and one history transaction;
 * - F9  every exported frame's barcode equals the plan's prediction; each measured slot contains its peak, lies in the clean
 *       stretch and overlaps the truth window by at least 90 % of the slot;
 * - F10 every picture cut is the nearest frame of a bar start or half-bar of the placed music; followedBeats agrees within 1e-6 s;
 *       consecutive cuts are never closer than the flash gap (11 frames at 30 fps; control: the alternation project's are);
 * - F11 the opening title is a live {hebrewDate} field and its still equals the still of «כ״ו בכסלו תשפ״ז» typed by hand
 *       (control: «כ״ה בכסלו תשפ״ז» typed by hand differs);
 * - F12 one undo restores the document byte for byte (sha256); redo restores the film byte for byte;
 * - F13 move one clip and trim another, set a gain by hand on the own-sound track, regenerate at another length: both clips
 *       byte-identical and present; no asset twice; no slot key twice; every frame of [first slot start, last slot end) has a
 *       picture; off-grid cuts only next to kept clips; the kept clip beyond the shorter target stays; the hand gain survives
 *       on the same track, which holds the new clips' sound, and no audio track is added;
 * - F14 the exported film's photosensitivity verdict is pass; control: the same analyser fails a hand-built black/white
 *       alternation every 3 frames;
 * - F15 with music the 1 kHz band = source -12.0 +- 0.5 dB; without music = source +- 0.5 dB; mute without music = silence;
 * - F15b 'lead': the music band over a sounding clip = music alone -9 +- 0.5 dB; the level over a still is reported;
 * - F16 an edit-mode agent plans, applies and regenerates over MCP; a propose-mode agent gets 403; an agent without the people
 *       scope is refused an {age:…} title at plan, apply and regenerate (REST and MCP), its plan of a {name:…} title holds no
 *       birth date, and its still of the owner's film title draws no age (equals «נועה ()» typed; control: the owner's differs);
 * - F17 the still (/frame) equals the png export of the same frame at three frames (mean |Δ| <= 1 level) and the mp4 export's
 *       frame within 3 levels;
 * - F18 the dialog driven by keyboard only (palette → three steps → apply) makes the film; two screenshots (1440x900, x2, he,
 *       dark) of the plan with its reasons and of the timeline after apply. The accessibility audit is `pnpm audit:a11y`;
 * - F19 after a reload, «אורך אחר» in the film bar (from the document's run) regenerates the film.
 * Recorded, not asserted: measurement speed (x real time) on the fixtures. Real footage stays "unverified" until the owner
 * watches a film made from their own clips.
 *
 *   pnpm build && pnpm proof:family-film
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { FAMILY_FILM_FACES_NOTE, FILM_FORBIDDEN_WORDS, FILM_FORBIDDEN_WORDS_HE, flashGapFrames, followedBeats, MOMENTS_METHOD_LONG, type ProjectDocument } from '@pulseframe/core';
import { FILM_FIXTURE, filmBarcodeValue, generateFilmFixtures, readFilmBarcode, type FilmFixtureTruth } from '@pulseframe/fixtures/film.ts';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/family-film-proof');
const shots = path.join(root, '.artifacts/shots');
const evidenceFile = path.join(root, 'docs/evidence/family-film-proof.json');
const PORT = 8871;
const W = 640, H = 360, FPS = 30;
const R = { num: 30, den: 1 };
/** Typed from the fixture, on Israel's wall clock (UTC + 2 h): b 10:00, d 10:04, a 10:09, f 10:13, c 10:20, the still 10:23, e 10:26. */
const CAPTURE_ORDER = ['film-b.mp4', 'film-d.mp4', 'film-a.mp4', 'film-f.mp4', 'film-c.mp4', 'IMG_20261206_102300.png', 'film-e.mp4'];
/** 6 December 2026 (the fixture's day, mid-morning in Israel) is 26 Kislev 5787; the day before is 25 Kislev. */
const HEBREW_DAY = 'כ״ו בכסלו תשפ״ז', HEBREW_DAY_BEFORE = 'כ״ה בכסלו תשפ״ז';
/** At 30 fps no two cuts may be closer than 11 frames (three flashes a second at most). */
const FLASH_GAP = 11;
/** One sample every 6 frames at 30 fps (about 5 a second); the grey picture is 320x180 for a 640x360 file. */
const STEP = 6, GREY_W = 320, GREY_H = 180;
const NOA = 'נועה', NOA_BIRTH = '2023-06-01';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 2 ** 31, ...(input ? { input } : {}) });
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const r2 = (v: number) => Number(v.toFixed(2));
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : NaN; };
const sec = (t: T.RationalTime) => T.toSeconds(t);
const frameOfTime = (t: T.RationalTime) => Math.round(sec(t) * FPS);

// ---------- evidence ----------
interface Row { id: string; name: string; value: unknown; budget: string; pass: boolean }
const rows: Row[] = [];
const blocked: { id: string; reason: string }[] = [];
const measurements: Record<string, unknown> = {};
const check = (id: string, name: string, pass: boolean, value: unknown, budget: string) => { rows.push({ id, name, value, budget, pass }); console.log(`${pass ? '  ok  ' : ' FAIL '} ${id} ${name}  ${JSON.stringify(value).slice(0, 600)}  (budget ${budget})`); };
class Blocked extends Error {}
async function section(id: string, fn: () => Promise<void>) {
  console.log(`\n# ${id}`);
  try { await fn(); } catch (e) {
    const msg = e instanceof Error ? `${e.message}${e.stack ? `\n${e.stack.split('\n').slice(1, 4).join('\n')}` : ''}` : String(e);
    if (e instanceof Blocked) { blocked.push({ id, reason: msg.slice(0, 400) }); console.log(` BLOCKED ${id}: ${msg.slice(0, 300)}`); }
    else check(id, 'section ran to its end', false, msg.slice(0, 600), 'no error');
  }
}

// ---------- pictures and sound ----------
interface Rgb { w: number; h: number; rgb: Buffer }
const decodePng = (png: Buffer): Rgb => ({ w: png.readUInt32BE(16), h: png.readUInt32BE(20), rgb: ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png) });
const videoFrame = (file: string, n: number): Rgb => ({ w: W, h: H, rgb: ff(['-i', file, '-vf', `select=eq(n\\,${n})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']) });
const meanAbsDiff = (a: Rgb, b: Rgb) => { if (a.rgb.length !== b.rgb.length) return Infinity; let s = 0; for (let i = 0; i < a.rgb.length; i++) s += Math.abs(a.rgb[i]! - b.rgb[i]!); return s / a.rgb.length; };
/** The barcode of every frame of a video (only the top strip is decoded: rows 0..59 of a 640x360 picture). */
function barcodes(file: string, filter = ''): number[] {
  const raw = ff(['-i', file, '-map', '0:v:0', '-vf', `${filter}crop=${W}:60:0:0`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const per = W * 60 * 3, out: number[] = [];
  for (let o = 0; o + per <= raw.length; o += per) out.push(readFilmBarcode(raw.subarray(o, o + per), W, 3, { x: 0, y: 0, w: W, h: H }));
  return out;
}
/** Mono float samples at 48 kHz of a file's first sound stream, through an optional ffmpeg filter. */
const pcm = (file: string, af?: string) => { const b = ff(['-i', file, '-map', '0:a:0', ...(af ? ['-af', af] : []), '-ac', '1', '-ar', '48000', '-f', 'f32le', '-']); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.length & ~3))); };
const rmsDb = (x: Float32Array, fromS: number, toS: number) => { let s = 0, n = 0; for (let i = Math.max(0, Math.round(fromS * 48000)); i < Math.min(x.length, Math.round(toS * 48000)); i++) { s += x[i]! * x[i]!; n++; } return n ? 10 * Math.log10(s / n + 1e-20) : -200; };
const BAND_1K = 'bandpass=f=1000:width_type=h:w=200';
const BAND_MUSIC = 'lowpass=f=400,lowpass=f=400';

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) throw new Blocked('web bundle missing: run `pnpm build` first');
  const fx = path.join(art, 'fixtures');
  const tGen = Date.now();
  const truth: FilmFixtureTruth = await generateFilmFixtures({ outDir: fx });
  measurements.fixtures = { clips: truth.clips.map((c) => ({ name: c.name, frames: c.frames, truth: c.truth, offset: c.startOffsetFrames })), generateSeconds: r2((Date.now() - tGen) / 1000) };
  const clipOf = (name: string) => truth.clips.find((c) => c.name === name)!;

  const s = await startServer({ port: PORT, dataDir: path.join(art, 'data'), webDist: path.join(root, 'apps/web/dist'), homeZone: 'Asia/Jerusalem' });
  const origin = s.url;
  const ownerCookie = (await fetch(`${origin}/api/v1/session`, { headers: { origin, connection: 'close', 'x-pf-owner-key': s.auth.tokens.owner } })).headers.get('set-cookie')!.split(';')[0]!;
  type Who = Record<string, string>;
  const AGENT: Who = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const OWNER: Who = { origin, cookie: ownerCookie, connection: 'close' };
  const as = async (who: Who, p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...who, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const call = (p: string, body?: unknown) => as(AGENT, p, body);
  const must = async (p: string, body?: unknown, want = [200], who = AGENT) => { const r = await as(who, p, body); if (!want.includes(r.status)) throw new Error(`${p} → ${r.status} ${JSON.stringify(r.body?.error ?? r.body).slice(0, 400)}`); return r.body; };
  const tx = (pid: string, ops: unknown[], who = AGENT) => must(`/projects/${pid}/transactions`, { ops }, [200], who) as Promise<{ revision: number; transactionId?: string; results: { output?: Record<string, any> }[] }>;
  const getDoc = async (pid: string, who = AGENT) => (await must(`/projects/${pid}`, undefined, [200], who)).project as ProjectDocument;
  const revision = async (pid: string) => (await must(`/projects/${pid}`)).revision as number;
  const waitJob = async (id: string, ms = 900_000) => { const t0 = Date.now(); for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled', 'refused'].includes(j.status)) return j; if (Date.now() - t0 > ms) throw new Error(`job ${id} did not finish`); await sleep(100); } };
  const newProject = async (name: string) => (await must('/projects', { name, width: W, height: H, frameRate: R }, [200, 201])).project.id as string;
  const upload = async (pid: string, file: string) => {
    const r = await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...AGENT, 'x-filename': encodeURIComponent(path.basename(file)) }, body: new Uint8Array(fs.readFileSync(file)) });
    const b = (await r.json()) as any;
    if (!b.assetId) throw new Error(`upload of ${file} failed: ${JSON.stringify(b).slice(0, 300)}`);
    return b.assetId as string;
  };
  const still = async (pid: string, n: number, who = AGENT) => { const r = await as(who, `/projects/${pid}/frame?index=${n}`); if (r.status !== 200) throw new Error(`frame ${n} → ${r.status} ${JSON.stringify(r.body?.error ?? '').slice(0, 300)}`); return r.body as Buffer; };
  let exportsN = 0;
  const exportFile = async (pid: string, options: Record<string, unknown>, ext = 'mp4') => {
    const st = await call(`/projects/${pid}/exports`, options);
    if (st.status !== 202) throw new Error(`export refused ${st.status}: ${JSON.stringify(st.body?.error ?? st.body).slice(0, 300)}`);
    const job = await waitJob(st.body.jobId);
    if (job.status !== 'succeeded') throw new Error(`export failed: ${JSON.stringify(job.error)}`);
    const file = path.join(art, `export-${++exportsN}.${ext}`);
    fs.writeFileSync(file, (await call(`/jobs/${job.id}/output`)).body);
    return { file, job };
  };
  const mcp = async (name: string, args: Record<string, unknown>, token = s.auth.tokens.agent) => {
    const r = await fetch(`${s.url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }) });
    const text = await r.text();
    const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
    if (msg.error) throw new Error(`MCP ${name}: ${JSON.stringify(msg.error)}`);
    const first = msg.result.content?.[0];
    let body: any = null;
    try { body = first?.type === 'text' ? JSON.parse(first.text) : null; } catch { body = first?.text ?? null; }
    return { isError: msg.result.isError === true, body };
  };
  const grant = async (name: string, mode: string) => { const r = await as(OWNER, '/grants', { name, mode }); if (r.status !== 201) throw new Error(`grant ${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); return r.body.token as string; };
  const measure = async (pid: string, assetIds: string[], overwrite = false) => {
    const r = await call(`/projects/${pid}/moments`, { assetIds, ...(overwrite ? { overwrite: true } : {}) });
    if (r.status === 200) return { cached: true, job: null as any };
    if (r.status !== 202) throw new Error(`moments → ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    return { cached: false, job: await waitJob(r.body.jobId) };
  };
  /**
   * The fixture's day (6 December 2026) is after this machine's clock, and the life line rightly refuses a capture date ahead of
   * the import time, so the files' own dates are not read on upload (recorded as capturesReadOnUpload). The same instants, typed
   * from the fixture (UTC + 2 h in Israel in December; the still's wall clock is approximate, from its name), are entered with the
   * public op set_asset_capture, one transaction.
   */
  const setCaptures = async (p: string, byName: Record<string, string>) => {
    const wall = (utc: string) => { const d = new Date(Date.parse(utc) + 120 * 60_000); return d.toISOString().slice(0, 19); };
    await tx(p, [...truth.clips.map((c) => ({ op: 'set_asset_capture', args: { assetId: byName[c.name]!, capture: { at: wall(c.capture), utcOffsetMinutes: 120 } } })),
      { op: 'set_asset_capture', args: { assetId: byName[truth.still.name]!, capture: { at: truth.still.capture, utcOffsetMinutes: null, circa: true } } }]);
  };
  const beats = async (pid: string, assetId: string) => must(`/projects/${pid}/assets/${assetId}/analyze`, { kind: 'beats' });
  const commitMedian = async (pid: string, n = 15) => { const d = await getDoc(pid); const trackId = Object.values(d.sequences)[0]!.tracks[0]!.id; const ms: number[] = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); await tx(pid, [{ op: 'update_track', args: { trackId, name: `V1 ${i}` } }]); ms.push(performance.now() - t0); } return r2(median(ms)); };

  // ---------- the document's film: tracks and clips by role ----------
  const tracksOf = (d: ProjectDocument) => Object.values(d.sequences).flatMap((q) => q.tracks);
  const clipById = (d: ProjectDocument, id: string) => { for (const t of tracksOf(d)) { const c = t.clips.find((x) => x.id === id); if (c) return { clip: c as any, track: t }; } return null; };
  const filmOf = (d: ProjectDocument, runId: string) => {
    const run = d.recipeRuns[runId]! as any;
    const slots = (run.slots ?? []) as { key: string; kind: string; clipId: string }[];
    const pictures = slots.filter((x) => x.kind === 'picture').map((x) => ({ slot: x, ...clipById(d, x.clipId)! })).filter((x) => x.clip).sort((a, b) => T.cmp(a.clip.start, b.clip.start));
    const music = slots.filter((x) => x.kind === 'music').map((x) => clipById(d, x.clipId)).find(Boolean) ?? null;
    const title = slots.filter((x) => x.kind === 'text').map((x) => ({ slot: x, ...clipById(d, x.clipId)! })).filter((x) => x.clip).sort((a, b) => T.cmp(a.clip.start, b.clip.start));
    const groups = new Set(pictures.map((p) => p.clip.linkGroupId).filter(Boolean));
    const ownTrack = tracksOf(d).find((t) => t.kind === 'audio' && t.clips.some((c: any) => c.linkGroupId && groups.has(c.linkGroupId))) ?? null;
    return { run, slots, pictures, music, titles: title, ownTrack };
  };
  const span = (c: any) => [frameOfTime(c.start), frameOfTime(T.add(c.start, c.duration))] as [number, number];

  // ---------- the main project: upload, beats ----------
  const pid = await newProject('family film');
  const files = [...truth.clips.map((c) => c.name), truth.still.name];
  const ids: Record<string, string> = {};
  for (const f of files) ids[f] = await upload(pid, path.join(fx, f));
  const musicId = await upload(pid, path.join(fx, truth.music!.name));
  measurements.capturesReadOnUpload = Object.fromEntries(files.map((f) => [f, null as unknown]));
  { const d = await getDoc(pid); for (const f of files) (measurements.capturesReadOnUpload as Record<string, unknown>)[f] = (d.assets[ids[f]!] as any).capture ?? null; }
  await setCaptures(pid, ids);
  const nameOfAsset = (assetId: string) => Object.keys(ids).find((k) => ids[k] === assetId) ?? assetId;
  const videoIds = truth.clips.map((c) => ids[c.name]!);
  await beats(pid, musicId);
  const docAfterUpload = await getDoc(pid);
  measurements.captures = Object.fromEntries(files.map((f) => [f, (docAfterUpload.assets[ids[f]!] as any).capture ?? null]));
  measurements.beats = (() => { const b = (docAfterUpload.analyses as any)?.[musicId]?.beats; return b ? { bpm: b.bpm, meter: b.meter ?? null, beats: b.beats.length, firstBeats: b.beats.slice(0, 5).map((x: T.RationalTime) => r2(sec(x) * 1000) / 1000), downbeats: b.downbeats?.length ?? 0 } : null; })();

  // ================================================================ measurement: F4, F5, F1, F2, F3, F6
  let dataOf: Record<string, any> = {};
  await section('M measurement', async () => {
    const latencyBefore = await commitMedian(pid);
    // F4: cancel mid-run, then a restart completes with one revision
    const rev0 = await revision(pid);
    const st = await call(`/projects/${pid}/moments`, { assetIds: videoIds });
    if (st.status !== 202) throw new Error(`moments → ${st.status} ${JSON.stringify(st.body).slice(0, 300)}`);
    let seen = '';
    for (let i = 0; i < 2000; i++) { const j = (await call(`/jobs/${st.body.jobId}`)).body; seen = j.status; if (j.status === 'running' || ['succeeded', 'failed', 'canceled'].includes(j.status)) break; await sleep(10); }
    const cancel = await call(`/jobs/${st.body.jobId}/cancel`, {});
    const canceled = await waitJob(st.body.jobId);
    const rev1 = await revision(pid);
    check('F4', 'cancel mid-run ends canceled and changes nothing', seen === 'running' && canceled.status === 'canceled' && rev1 === rev0, { statusWhenCanceled: seen, cancel: cancel.status, final: canceled.status, revisionBefore: rev0, revisionAfter: rev1 }, 'canceled while running; revision unchanged');
    const t0 = performance.now();
    const run1 = await measure(pid, videoIds);
    const wall = (performance.now() - t0) / 1000;
    const rev2 = await revision(pid);
    check('F4', 'a restart completes and attaches with ONE revision', run1.job?.status === 'succeeded' && run1.job.output?.attached === 6 && rev2 === rev1 + 1, { status: run1.job?.status, output: run1.job?.output, revisionBefore: rev1, revisionAfter: rev2 }, 'succeeded, 6 attached, +1 revision');
    const mediaSeconds = truth.clips.reduce((a, c) => a + c.frames / FPS, 0);
    measurements.measureSpeed = { wallSeconds: r2(wall), mediaSeconds: r2(mediaSeconds), timesRealTime: r2(mediaSeconds / wall), output: run1.job?.output };
    const doc1 = await getDoc(pid);
    const records = Object.fromEntries(videoIds.map((id) => [id, (doc1.analyses as any)?.[id]?.moments ?? null]));
    const fetchData = async () => Object.fromEntries(await Promise.all(videoIds.map(async (id) => { const r = await call(`/projects/${pid}/assets/${id}/derivatives/moments`); return [id, r.status === 200 ? r.body : null] as const; })));
    dataOf = await fetchData();
    const digestOf = (d: Record<string, any>) => Object.fromEntries(Object.entries(d).map(([k, v]) => [nameOfAsset(k), v ? sha(JSON.stringify(v)) : null]));
    const digests1 = digestOf(dataOf);

    // F5: undo the attach (the records leave the document, the data files stay): a second run decodes nothing and attaches the same records
    const undo = await call(`/projects/${pid}/undo`, {});
    const gone = await getDoc(pid);
    const recordsGone = videoIds.every((id) => !(gone.analyses as any)?.[id]?.moments);
    const run2 = await measure(pid, videoIds);
    const doc2 = await getDoc(pid);
    // the measured content of a record: everything but the time it was attached (origin.createdAt)
    const content = (r: any) => { if (!r) return null; const c = structuredClone(r); if (c.origin) delete c.origin.createdAt; return JSON.stringify(c); };
    const differing = videoIds.flatMap((id) => { const a = (doc2.analyses as any)?.[id]?.moments, b = records[id]; return a && b ? Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])) : ['missing']; });
    const same = videoIds.every((id) => content((doc2.analyses as any)?.[id]?.moments) === content(records[id]));
    measurements.reattachedKeysDiffering = [...new Set(differing)];
    check('F5', 'a second run after the records were undone decodes nothing and attaches the same records', undo.status === 200 && recordsGone && run2.job?.status === 'succeeded' && run2.job.output?.measured === 0 && run2.job.output?.cached === 6 && same, { undo: undo.status, recordsGone, output: run2.job?.output, sameRecords: same, keysDiffering: [...new Set(differing)] }, 'measured 0, cached 6, equal records (but the attach time)');
    const run3 = await measure(pid, videoIds, true);
    const digests3 = digestOf(await fetchData());
    check('F5', 'a forced re-measure (overwrite) decodes again and gives the same data digests', run3.job?.status === 'succeeded' && run3.job.output?.measured === 6 && JSON.stringify(digests3) === JSON.stringify(digests1), { output: run3.job?.output, digests: digests3, firstDigests: digests1 }, 'measured 6, equal digests');
    const doc3 = await getDoc(pid);

    // F1: the top candidate of each clip with a truth window
    const f1: Record<string, unknown> = {};
    let f1ok = true;
    for (const c of truth.clips.filter((x) => x.truth)) {
      const rec = (doc3.analyses as any)[ids[c.name]!].moments;
      const w = rec?.windows?.[0];
      const lead = 12; // 0.4 s
      const ok = !!w && w.peakFrame >= c.truth!.fromFrame && w.peakFrame < c.truth!.toFrame && w.fromFrame <= c.truth!.fromFrame + lead && w.toFrame >= c.truth!.toFrame - lead;
      f1[c.name] = { truth: c.truth, top: w ? { peak: w.peakFrame, from: w.fromFrame, to: w.toFrame, basis: w.basis } : null, windows: rec?.windows?.length ?? 0, ok };
      f1ok &&= ok;
    }
    check('F1', 'each top candidate\'s peak lies in its truth window and its clean stretch covers the window minus 0.4 s at each end', f1ok, f1, 'all four clips with a truth window');

    // F2: the decoy and the dark stretch are in no candidate, and their samples are gated
    const gatedIn = (name: string, r: { fromFrame: number; toFrame: number }) => {
      const data = dataOf[ids[name]!];
      const ks: number[] = [];
      for (let k = 0; k * STEP < clipOf(name).frames; k++) if (k * STEP >= r.fromFrame + STEP && k * STEP < r.toFrame) ks.push(k);
      return { samples: ks.length, gated: ks.filter((k) => data?.picture?.gated?.[k] === 1).length };
    };
    const overlaps = (name: string, r: { fromFrame: number; toFrame: number }) => ((doc3.analyses as any)[ids[name]!].moments?.windows ?? []).filter((w: any) => w.fromFrame < r.toFrame && w.toFrame > r.fromFrame).length;
    const decoy = clipOf('film-b.mp4').decoy!, dark = clipOf('film-c.mp4').dark!;
    const gd = gatedIn('film-b.mp4', decoy), gk = gatedIn('film-c.mp4', dark);
    check('F2', 'the whip-pan decoy and the dark stretch are in no candidate and every sample inside them is gated', overlaps('film-b.mp4', decoy) === 0 && overlaps('film-c.mp4', dark) === 0 && gd.samples > 0 && gd.gated === gd.samples && gk.samples > 0 && gk.gated === gk.samples, { decoy: { overlapping: overlaps('film-b.mp4', decoy), ...gd }, dark: { overlapping: overlaps('film-c.mp4', dark), ...gk } }, '0 overlapping windows; all samples gated');

    // F3: the job's samples are frames k*S — reproduced with our own ffmpeg read of the file the job read
    const f3: Record<string, unknown> = {};
    let f3ok = true;
    for (const c of truth.clips) {
      const id = ids[c.name]!, data = dataOf[id];
      const src = data?.picture?.source as 'proxy' | 'original' | undefined;
      const original = path.join(fx, c.name);
      let file = original;
      if (src === 'proxy') { const r = await call(`/projects/${pid}/assets/${id}/derivatives/proxy`); file = path.join(art, `proxy-${c.name}`); fs.writeFileSync(file, r.body as Buffer); }
      const select = `select='not(mod(n\\,${STEP}))',`;
      const grey = ff(['-i', file, '-map', '0:v:0', '-an', '-vf', `select='not(mod(n\\,${STEP}))',scale=${GREY_W}:${GREY_H}:flags=area,format=gray`, '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1']);
      const expectedSamples = Math.ceil(c.frames / STEP);
      const codesRead = barcodes(file, select), codesOriginal = barcodes(original, select);
      const want = Array.from({ length: expectedSamples }, (_, k) => filmBarcodeValue(c.clip, k * STEP));
      const ok = data?.picture?.digest === sha(grey) && data.picture.count === expectedSamples && JSON.stringify(codesRead) === JSON.stringify(want) && JSON.stringify(codesOriginal) === JSON.stringify(want);
      f3[c.name] = { source: src ?? null, samples: data?.picture?.count ?? null, expected: expectedSamples, digestEqual: data?.picture?.digest === sha(grey), barcodesOnRead: JSON.stringify(codesRead) === JSON.stringify(want), barcodesOnOriginal: JSON.stringify(codesOriginal) === JSON.stringify(want), startOffsetFrames: c.startOffsetFrames };
      f3ok &&= ok;
    }
    check('F3', 'the job read exactly frames k*S: our own read of the same file gives its grey digest and the barcodes k*S, on the file it read and on the original (film-a starts 15 frames late)', f3ok, f3, 'every clip');

    // F6: sizes and commit latency
    const sizes = Object.fromEntries(videoIds.map((id) => [nameOfAsset(id), Buffer.byteLength(JSON.stringify((doc3.analyses as any)[id]?.moments ?? null))]));
    check('F6', 'each moments record in the document is within 1100 bytes', Object.values(sizes).every((b) => b > 4 && b <= 1100), sizes, '≤ 1100 bytes each');
    measurements.commitLatencyMs = { before: latencyBefore, afterMeasuring: await commitMedian(pid) };
  });

  // ================================================================ the film: plan, apply, F7 F8 F12 F10 F9 F11 F14 F17
  const params = { assetIds: files.map((f) => ids[f]!), musicAssetId: musicId, targetSeconds: 60 as const, order: 'capture' as const, ownSound: 'under' as const };
  let runId = '';
  let filmExport = '';
  await section('P plan and apply', async () => {
    const plan = await must(`/projects/${pid}/recipes/family-film/plan`, { params });
    measurements.plan = { picks: plan.picks.map((p: any) => ({ asset: nameOfAsset(p.assetId), kind: p.kind, startFrame: p.startFrame, frames: p.frames, sourceInFrame: p.sourceInFrame, span: p.span, reasons: p.reasons.map((r: any) => r.code) })), excluded: plan.excluded, warnings: plan.warnings.map((w: any) => w.code), basis: plan.basis, predicted: plan.predicted, needsMeasurement: plan.needsMeasurement };
    // F7: capture order, with a control that the 'given' order differs
    // a second moment of the same file sits next to its first one: the order of files is the order of their first picks
    const dedupe = (names: string[]) => names.filter((n, i) => names.indexOf(n) === i);
    const order = dedupe(plan.picks.map((p: any) => nameOfAsset(p.assetId)));
    const expected = CAPTURE_ORDER.filter((n) => order.includes(n));
    const given = await must(`/projects/${pid}/recipes/family-film/plan`, { params: { ...params, order: 'given', assetIds: [...files].sort().map((f) => ids[f]!) } });
    const givenOrder = dedupe(given.picks.map((p: any) => nameOfAsset(p.assetId)));
    check('F7', 'the picks are in capture order (typed from the fixture); control: the same files in the given (name) order are not', JSON.stringify(order) === JSON.stringify(expected) && order.length >= 5 && JSON.stringify(givenOrder) !== JSON.stringify(CAPTURE_ORDER.filter((n) => givenOrder.includes(n))), { order, expected, givenOrder }, 'capture order; the control differs');
    const codes = (n: string) => (plan.picks.find((p: any) => nameOfAsset(p.assetId) === n)?.reasons ?? []).map((r: any) => r.code);
    const forbidden = JSON.stringify([plan.steps, plan.basis, plan.picks.map((p: any) => p.reasons)]);
    check('F7', 'a reason on every pick (at most 3); the static clip says default middle; the 85 %-active clip says active throughout', plan.picks.length > 0 && plan.picks.every((p: any) => p.reasons.length >= 1 && p.reasons.length <= 3) && codes('film-e.mp4').includes('default_middle') && codes('film-f.mp4').includes('active_throughout'), { static: codes('film-e.mp4'), active: codes('film-f.mp4'), counts: plan.picks.map((p: any) => p.reasons.length) }, 'every pick 1..3 reasons; codes as named');
    check('F7', 'faces are not used, and the plan says so; nothing in it uses the forbidden words', plan.basis.includes(FAMILY_FILM_FACES_NOTE) && /faces are not used/.test(MOMENTS_METHOD_LONG) && !FILM_FORBIDDEN_WORDS.test(forbidden) && !FILM_FORBIDDEN_WORDS_HE.test(forbidden) && !/face/i.test(JSON.stringify(plan.picks)), { basisSaysFaces: plan.basis.includes(FAMILY_FILM_FACES_NOTE), methodSaysFaces: /faces are not used/.test(MOMENTS_METHOD_LONG) }, 'said in basis and method');
    // F8: apply is one revision and one transaction
    const before = await getDoc(pid);
    const rev0 = await revision(pid);
    const hist0 = (await must(`/projects/${pid}/history?since=0`)).events.length as number;
    const applied = await must(`/projects/${pid}/recipes/family-film/apply`, { params, expectedRevision: plan.revision });
    runId = applied.runId;
    const rev1 = await revision(pid);
    const hist1 = (await must(`/projects/${pid}/history?since=0`)).events.length as number;
    check('F8', 'apply is one revision and one history transaction', applied.revision === rev0 + 1 && rev1 === rev0 + 1 && hist1 === hist0 + 1 && !!runId, { revisionBefore: rev0, revisionAfter: rev1, historyBefore: hist0, historyAfter: hist1 }, '+1 revision, +1 transaction');
    const film = await getDoc(pid);
    const fm = filmOf(film, runId);
    check('F6', 'the run record is within 16 000 bytes', Buffer.byteLength(JSON.stringify(fm.run)) <= 16_000, { bytes: Buffer.byteLength(JSON.stringify(fm.run)) }, '≤ 16 000 bytes');
    // F12: one undo restores the document byte for byte; redo restores the film byte for byte
    const u = await call(`/projects/${pid}/undo`, {});
    const undone = await getDoc(pid);
    const rd = await call(`/projects/${pid}/redo`, {});
    const redone = await getDoc(pid);
    check('F12', 'one undo restores the document byte for byte; redo restores the film byte for byte', u.status === 200 && rd.status === 200 && sha(JSON.stringify(undone)) === sha(JSON.stringify(before)) && sha(JSON.stringify(redone)) === sha(JSON.stringify(film)), { undo: u.status, redo: rd.status, undoneEqualsBefore: sha(JSON.stringify(undone)) === sha(JSON.stringify(before)), redoneEqualsFilm: sha(JSON.stringify(redone)) === sha(JSON.stringify(film)) }, 'sha256 equal');

    // F10: every picture cut on a bar start or half-bar of the placed music; followedBeats agrees; flash gap
    const b = (film.analyses as any)[musicId].beats;
    const beatsS: number[] = b.beats.map((x: T.RationalTime) => sec(x));
    const meter: number = b.meter ?? 4;
    const down = new Set<number>((b.downbeats ?? []).map((x: T.RationalTime) => beatsS.findIndex((y) => Math.abs(y - sec(x)) < 1e-9)));
    const half = new Set<number>([...down].map((i) => i + meter / 2));
    const m = fm.music!.clip;
    const mapped = (i: number) => sec(m.start) + beatsS[i]! - sec(m.sourceIn);
    const cuts = fm.pictures.slice(1).map((p) => frameOfTime(p.clip.start));
    const fb = followedBeats(film, 0, sec(T.add(m.start, m.duration)));
    const cutRows = cuts.map((cf) => {
      const i = beatsS.findIndex((_, k) => (down.has(k) || (meter % 2 === 0 && half.has(k))) && Math.round(mapped(k) * FPS) === cf);
      const followed = i >= 0 && fb.some((x) => Math.abs(x.t - mapped(i)) <= 1e-6);
      return { frame: cf, beat: i, kind: i < 0 ? null : down.has(i) ? 'bar' : 'half-bar', followed };
    });
    const allFrames = [frameOfTime(fm.pictures[0]!.clip.start), ...cuts, span(fm.pictures.at(-1)!.clip)[1]];
    const gaps = allFrames.slice(1).map((x, i) => x - allFrames[i]!);
    check('F10', 'every picture cut is the nearest frame of a bar start or half-bar of the placed music, and followedBeats agrees within 1e-6 s', cutRows.length > 0 && cutRows.every((r) => r.beat >= 0 && r.followed), { cuts: cutRows, bars: cutRows.filter((r) => r.kind === 'bar').length, halfBars: cutRows.filter((r) => r.kind === 'half-bar').length }, 'every cut');
    measurements.cutKinds = { note: 'at 120 BPM in 4/4 the fixture gives spans of whole bars or half-bars; counted above', bars: cutRows.filter((r) => r.kind === 'bar').length, halfBars: cutRows.filter((r) => r.kind === 'half-bar').length };
    check('F10', `no two consecutive cuts closer than the flash gap (${FLASH_GAP} frames at 30 fps)`, gaps.every((g) => g >= FLASH_GAP) && flashGapFrames(FPS) === FLASH_GAP, { smallestGap: Math.min(...gaps), coreFlashGap: flashGapFrames(FPS) }, `≥ ${FLASH_GAP} frames`);

    // F9: the export's barcodes equal the plan's prediction; each measured slot's range
    const ex = await exportFile(pid, {});
    filmExport = ex.file;
    const codes9 = barcodes(ex.file);
    let framesChecked = 0;
    const wrong: unknown[] = [];
    for (const p of applied.picks as any[]) {
      if (p.kind === 'still' || p.sourceInFrame === null) continue;
      const c = clipOf(nameOfAsset(p.assetId));
      for (let f = p.startFrame; f < p.startFrame + p.frames; f++) {
        framesChecked++;
        const want = filmBarcodeValue(c.clip, p.sourceInFrame + (f - p.startFrame));
        if (codes9[f] !== want && wrong.length < 12) wrong.push({ frame: f, asset: c.name, want, got: codes9[f] });
      }
    }
    check('F9', 'every exported frame of a video pick shows the source frame the plan predicts (barcode)', framesChecked > 0 && wrong.length === 0, { framesChecked, wrong, exportFrames: codes9.length }, 'all equal');
    const doc9 = await getDoc(pid);
    const slotRows = (applied.picks as any[]).filter((p) => p.kind === 'measured').map((p) => {
      const c = clipOf(nameOfAsset(p.assetId));
      const w = (doc9.analyses as any)[p.assetId].moments.windows[p.windowIndex ?? 0];
      const a = p.sourceInFrame, z = p.sourceInFrame + p.sourceFrames;
      const overlap = c.truth ? Math.max(0, Math.min(z, c.truth.toFrame) - Math.max(a, c.truth.fromFrame)) : 0;
      return { asset: c.name, range: [a, z], peak: w.peakFrame, stretch: [w.fromFrame, w.toFrame], truth: c.truth, ok: !!c.truth && a <= w.peakFrame && w.peakFrame < z && a >= w.fromFrame && z <= w.toFrame && overlap >= 0.9 * (z - a) };
    });
    check('F9', 'each measured slot contains its peak, lies in its clean stretch and overlaps the truth window by at least 90 % of the slot', slotRows.length >= 3 && slotRows.every((r) => r.ok), slotRows, 'every measured slot');

    // F14: the exported film passes the photosensitivity check
    const ps = ex.job.output?.photosensitivity;
    check('F14', 'the exported film\'s photosensitivity verdict is pass', ps?.verdict === 'pass', { verdict: ps?.verdict ?? null, ranges: ps?.ranges?.length ?? null }, 'pass');

    // F11: the opening title is a live {hebrewDate} field and draws the Hebrew date typed here
    const title = fm.titles[0]?.clip;
    const tf = title ? frameOfTime(title.start) + 15 : 15;
    const live = await still(pid, tf);
    const typed = async (text: string) => { await tx(pid, [{ op: 'update_text', args: { clipId: title.id, text } }, { op: 'set_text_fields', args: { clipId: title.id, enabled: false } }]); const x = await still(pid, tf); await call(`/projects/${pid}/undo`, {}); return x; };
    const typedDay = title ? await typed(HEBREW_DAY) : Buffer.alloc(0), typedBefore = title ? await typed(HEBREW_DAY_BEFORE) : Buffer.alloc(0);
    const backLive = await still(pid, tf);
    check('F11', `the opening title is a live {hebrewDate} field whose still equals «${HEBREW_DAY}» typed by hand; control: «${HEBREW_DAY_BEFORE}» typed differs`, !!title && title.fields === true && /\{hebrewDate/.test(title.text) && sha(live) === sha(typedDay) && sha(live) !== sha(typedBefore) && sha(backLive) === sha(live), { text: title?.text ?? null, fields: title?.fields ?? null, frame: tf, equalsTyped: sha(live) === sha(typedDay), controlDiffers: sha(live) !== sha(typedBefore), restored: sha(backLive) === sha(live) }, 'equal; control differs');
    fs.writeFileSync(path.join(art, 'title-live.png'), live);

    // F17: the still equals the export frame (png exactly; mp4 within the codec's error)
    const last = fm.titles.at(-1)?.clip;
    const frames = [tf, Math.round((span(fm.pictures[2]!.clip)[0] + span(fm.pictures[2]!.clip)[1]) / 2), last ? frameOfTime(last.start) + 20 : allFrames.at(-1)! - 10];
    const f17: unknown[] = [];
    let f17ok = true;
    for (const k of frames) {
      const a = decodePng(await still(pid, k));
      const png = decodePng(fs.readFileSync((await exportFile(pid, { format: 'png', frame: k }, 'png')).file));
      const mp4 = videoFrame(ex.file, k);
      const dPng = meanAbsDiff(a, png), dMp4 = meanAbsDiff(a, mp4);
      f17.push({ frame: k, png: r2(dPng), mp4: r2(dMp4) });
      f17ok &&= a.w === W && png.w === W && dPng <= 1 && dMp4 <= 3;
    }
    check('F17', 'the still (/frame) equals the png export of the same frame and the mp4 export\'s frame, at three frames', f17ok, f17, 'png mean |Δ| ≤ 1, mp4 ≤ 3 levels');
  });

  // ================================================================ F14 control and the flash-gap control
  await section('F14 control', async () => {
    const cp = await newProject('flash control');
    const black = path.join(art, 'black.png'), white = path.join(art, 'white.png');
    ff(['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}`, '-frames:v', '1', black]);
    ff(['-f', 'lavfi', '-i', `color=c=white:s=${W}x${H}`, '-frames:v', '1', white]);
    const [bk, wh] = [await upload(cp, black), await upload(cp, white)];
    await tx(cp, Array.from({ length: 20 }, (_, i) => ({ op: 'add_clip', args: { assetId: i % 2 ? wh : bk, start: T.frameTime(i * 3, R), duration: T.frameTime(3, R) } })));
    const ex = await exportFile(cp, {});
    const ps = ex.job.output?.photosensitivity;
    const d = await getDoc(cp);
    const starts = tracksOf(d).flatMap((t) => t.clips).map((c: any) => frameOfTime(c.start)).sort((a, b) => a - b);
    const gaps = starts.slice(1).map((x, i) => x - starts[i]!);
    check('F14', 'control: the same analyser fails a black/white alternation every 3 frames, and the cut-gap measure sees gaps under the flash gap there', !!ps && ps.verdict !== 'pass' && Math.min(...gaps) < FLASH_GAP, { verdict: ps?.verdict ?? null, ranges: ps?.ranges?.length ?? null, smallestGap: Math.min(...gaps) }, 'not pass; gap < 11');
  });

  // ================================================================ F13: regeneration keeps hand edits and a hand-set gain
  await section('F13 regeneration', async () => {
    if (!runId) throw new Blocked('no film was applied (section P)');
    const d0 = await getDoc(pid);
    const fm = filmOf(d0, runId);
    const own = fm.ownTrack!;
    const audioTracks0 = tracksOf(d0).filter((t) => t.kind === 'audio').length;
    const q = T.frameTime(15, R);
    const b0 = (d0.analyses as any)[musicId].beats;
    const beatsS: number[] = b0.beats.map((x: T.RationalTime) => sec(x));
    /** One regeneration at 30 s after `edits` (the clips they touch are kept), measured. */
    const regenerate = async (label: string, kept: string[]) => {
      const d1 = await getDoc(pid);
      const keptJson = Object.fromEntries(kept.map((id) => [id, JSON.stringify(clipById(d1, id)!.clip)]));
      const keptAssets = new Set(kept.map((id) => clipById(d1, id)!.clip.assetId));
      const r = await must(`/projects/${pid}/recipe-runs/${runId}/regenerate`, { params: { targetSeconds: 30 } });
      const d2 = await getDoc(pid);
      const fm2 = filmOf(d2, runId);
      const keptOk = kept.every((id) => clipById(d2, id) && JSON.stringify(clipById(d2, id)!.clip) === keptJson[id]);
      // a kept clip's file is never picked again (a second moment of a file the planner picks itself is allowed: its own key)
      const newPicks = fm2.pictures.filter((p) => !kept.includes(p.clip.id));
      const repicked = newPicks.filter((p) => keptAssets.has(p.clip.assetId)).map((p) => nameOfAsset(p.clip.assetId));
      const windowsTwice = newPicks.map((p) => `${p.clip.assetId}@${frameOfTime(p.clip.sourceIn)}`).filter((x, i, a) => a.indexOf(x) !== i);
      const keys = fm2.slots.map((x) => x.key);
      // the frames of [first slot start, last slot end) without a picture on any video track
      const pics = tracksOf(d2).filter((t) => t.kind === 'video').flatMap((t) => t.clips).map(span);
      const [from, to] = [span(fm2.pictures[0]!.clip)[0], Math.max(...fm2.pictures.map((p) => span(p.clip)[1]))];
      let holes = 0; const firstHoles: number[] = [];
      for (let f = from; f < to; f++) if (!pics.some(([a, b]) => a <= f && f < b)) { holes++; if (firstHoles.length < 10) firstHoles.push(f); }
      const m = fm2.music!.clip;
      const grid = new Set(beatsS.map((x) => Math.round((sec(m.start) + x - sec(m.sourceIn)) * FPS)));
      const keptFrames = new Set(kept.flatMap((id) => span(clipById(d2, id)!.clip)));
      const offGrid = fm2.pictures.slice(1).map((p) => span(p.clip)[0]).filter((f) => !grid.has(f));
      const missing = (r.warnings as any[]).find((w) => w.code === 'pictures_missing');
      const row = { label, layout: fm2.pictures.map((p) => ({ asset: nameOfAsset(p.clip.assetId), span: span(p.clip), kept: kept.includes(p.clip.id) })), warnings: (r.warnings as any[]).map((w) => w.code), protected: r.protected, replaced: r.replaced };
      (measurements.regenerations ??= [] as unknown[]) && (measurements.regenerations as unknown[]).push(row);
      return { r, d2, fm2, keptOk, repicked, windowsTwice, keys, holes, firstHoles, from, to, offGrid, keptFrames, missing };
    };

    // R1: hand edits that leave no hole of their own: the second clip's end trimmed by 15 frames, the third moved 15 frames
    // earlier into that room, a gain set by hand on the film's own-sound track; then another length (30 s)
    const second = fm.pictures[1]!, third = fm.pictures[2]!, lastPic = fm.pictures.at(-1)!;
    const edits0 = await revision(pid);
    await tx(pid, [{ op: 'trim_clip', args: { clipId: second.clip.id, edge: 'end', to: T.sub(T.add(second.clip.start, second.clip.duration), q) } }]);
    await tx(pid, [{ op: 'move_clip', args: { clipId: third.clip.id, start: T.sub(third.clip.start, q) } }]);
    await tx(pid, [{ op: 'set_track_audio', args: { trackId: own.id, gain: 0.6 } }]);
    const a = await regenerate('R1 trim + move + hand gain', [second.clip.id, third.clip.id]);
    check('F13', 'R1: the moved clip and the trimmed clip are byte-identical and present after regenerating at 30 s', a.keptOk, { protected: a.r.protected, replaced: a.r.replaced }, 'both equal');
    check('F13', 'R1: no kept clip\'s file picked again, no moment twice, no slot key twice, no frame without a picture in [first slot start, last slot end)', a.repicked.length === 0 && a.windowsTwice.length === 0 && new Set(a.keys).size === a.keys.length && a.holes === 0, { repicked: a.repicked, windowsTwice: a.windowsTwice, keys: a.keys.length, distinctKeys: new Set(a.keys).size, holes: a.holes, firstHoles: a.firstHoles, range: [a.from, a.to] }, 'none');
    check('F13', 'R1: off-grid cuts only next to kept clips', a.offGrid.every((f) => a.keptFrames.has(f)), { offGrid: a.offGrid, keptEdges: [...a.keptFrames] }, 'off-grid ⊆ kept edges');
    const own2 = tracksOf(a.d2).find((t) => t.id === own.id) as any;
    const groups = new Set(a.fm2.pictures.filter((p) => ![second.clip.id, third.clip.id].includes(p.clip.id)).map((p) => p.clip.linkGroupId).filter(Boolean));
    const newSoundOnOwn = own2?.clips.filter((c: any) => c.linkGroupId && groups.has(c.linkGroupId)).length ?? 0;
    check('F13', 'R1: the gain set by hand survives on the same own-sound track, which holds the new clips\' sound; no audio track is added', own2?.audio?.gain === 0.6 && newSoundOnOwn > 0 && tracksOf(a.d2).filter((t) => t.kind === 'audio').length === audioTracks0, { gain: own2?.audio?.gain ?? null, newSoundClipsOnTrack: newSoundOnOwn, audioTracksBefore: audioTracks0, audioTracksAfter: tracksOf(a.d2).filter((t) => t.kind === 'audio').length }, 'gain 0.6; new sound on it; same count');
    // back to the 60 s film: undo the regeneration and the three hand edits (four steps)
    for (let i = 0; i < 4; i++) await call(`/projects/${pid}/undo`, {});
    const back = await getDoc(pid);
    check('F13', 'undoing the regeneration and the hand edits gives back the film byte for byte', sha(JSON.stringify(back)) === sha(JSON.stringify(d0)) && (await revision(pid)) > edits0, { equal: sha(JSON.stringify(back)) === sha(JSON.stringify(d0)) }, 'sha256 equal');

    // R2: the last clip's start trimmed by 15 frames: it still ends after the shorter 30 s target, so the film runs up to it
    await tx(pid, [{ op: 'trim_clip', args: { clipId: lastPic.clip.id, edge: 'start', to: T.add(lastPic.clip.start, q) } }]);
    const lastEndS = sec(T.add(lastPic.clip.start, lastPic.clip.duration));
    const b = await regenerate('R2 the last clip trimmed', [lastPic.clip.id]);
    check('F13', 'R2: the kept clip that runs past the shorter target stays, the film runs up to it with no frame without a picture, and the plan says it is longer', b.keptOk && lastEndS > 30 && b.to >= Math.round(lastEndS * FPS) && b.holes === 0 && b.repicked.length === 0 && (b.r.warnings as any[]).some((w) => w.code === 'longer_than_target'), { keptClipEndsAt: r2(lastEndS), filmPicturesEndAt: r2(b.to / FPS), holes: b.holes, repicked: b.repicked, warnings: (b.r.warnings as any[]).map((w) => w.code) }, 'kept, covered, longer_than_target');
    for (let i = 0; i < 2; i++) await call(`/projects/${pid}/undo`, {});

    // R3: the last clip moved 3 s later (a hole the person made) — more room than the clips left can fill: the plan must say how
    // long the film shows no picture (pictures_missing), never leave a silent black stretch
    await tx(pid, [{ op: 'move_clip', args: { clipId: lastPic.clip.id, start: T.add(lastPic.clip.start, T.frameTime(90, R)) } }]);
    const c = await regenerate('R3 the last clip moved 3 s later', [lastPic.clip.id]);
    check('F13', 'R3: when the clips left cannot fill the room up to a kept clip, the plan warns pictures_missing with exactly the frames that show no picture', c.holes > 0 && c.missing?.details?.gapFrames === c.holes, { holes: c.holes, firstHoles: c.firstHoles, warned: c.missing?.details ?? null }, 'a gap exists here; warned frames = measured frames');
    for (let i = 0; i < 2; i++) await call(`/projects/${pid}/undo`, {});
    measurements.f13Note = 'R3 is the only case with not enough material; it records how the planner answers (a warned gap). R1 and R2 have material to spare and must show a picture on every frame.';
  });

  // ================================================================ F15, F15b: the mix
  await section('F15 mix', async () => {
    const mp = await newProject('film mix');
    const mids: Record<string, string> = {};
    for (const f of files) mids[f] = await upload(mp, path.join(fx, f));
    await setCaptures(mp, mids);
    const mm = await upload(mp, path.join(fx, truth.music!.name));
    await beats(mp, mm);
    await measure(mp, truth.clips.map((c) => mids[c.name]!));
    const mparams = { ...params, assetIds: files.map((f) => mids[f]!), musicAssetId: mm };
    const name = (assetId: string) => Object.keys(mids).find((k) => mids[k] === assetId)!;
    const a = await must(`/projects/${mp}/recipes/family-film/apply`, { params: mparams });
    const run = a.runId as string;
    const wav = async () => { const d = await getDoc(mp); return { file: (await exportFile(mp, { format: 'wav' }, 'wav')).file, picks: (d.recipeRuns[run] as any).slots.length, doc: d }; };
    const sourceBand = Object.fromEntries(truth.clips.filter((c) => c.sound).map((c) => [c.name, pcm(path.join(fx, c.name), BAND_1K)]));
    /** Per sounding measured pick: export band level minus source band level over the same picture, 0.15 s in from each end. */
    const bandDiffs = (file: string, picks: any[]) => {
      const out = pcm(file, BAND_1K);
      return picks.filter((p) => p.kind === 'measured' && clipOf(name(p.assetId)).sound).map((p) => {
        const c = clipOf(name(p.assetId));
        const t0 = p.startFrame / FPS + 0.15, t1 = (p.startFrame + p.frames) / FPS - 0.15;
        const s0 = (p.sourceInFrame + c.startOffsetFrames) / FPS + 0.15;
        return { asset: c.name, exportDb: r2(rmsDb(out, t0, t1)), sourceDb: r2(rmsDb(sourceBand[c.name]!, s0, s0 + (t1 - t0))), diff: r2(rmsDb(out, t0, t1) - rmsDb(sourceBand[c.name]!, s0, s0 + (t1 - t0))) };
      });
    };
    const under = await wav();
    const d1 = bandDiffs(under.file, a.picks);
    check('F15', 'with music, the clips\' own sound in the 1 kHz band is the source -12.0 ± 0.5 dB', d1.length >= 2 && d1.every((x) => Math.abs(x.diff + 12) <= 0.5), d1, '-12.0 ± 0.5 dB');
    const lead = await must(`/projects/${mp}/recipe-runs/${run}/regenerate`, { params: { ownSound: 'lead' } });
    const leadWav = await wav();
    const muteM = await must(`/projects/${mp}/recipe-runs/${run}/regenerate`, { params: { ownSound: 'mute' } });
    const muteWav = await wav();
    const sameLayout = JSON.stringify(lead.picks.map((p: any) => [p.assetId, p.startFrame, p.frames])) === JSON.stringify(muteM.picks.map((p: any) => [p.assetId, p.startFrame, p.frames]));
    const lm = pcm(leadWav.file, BAND_MUSIC), mm2 = pcm(muteWav.file, BAND_MUSIC);
    const sounding = (lead.picks as any[]).filter((p) => p.ownSound && clipOf(name(p.assetId))?.sound);
    const ducks = sounding.map((p) => { const q = p.frames / FPS / 4; const t0 = p.startFrame / FPS + q, t1 = (p.startFrame + p.frames) / FPS - q; return { asset: name(p.assetId), diff: r2(rmsDb(lm, t0, t1) - rmsDb(mm2, t0, t1)) }; });
    const stillPick = (lead.picks as any[]).find((p) => p.kind === 'still');
    const overStill = stillPick ? r2(rmsDb(lm, stillPick.startFrame / FPS + 0.2, (stillPick.startFrame + stillPick.frames) / FPS - 0.2) - rmsDb(mm2, stillPick.startFrame / FPS + 0.2, (stillPick.startFrame + stillPick.frames) / FPS - 0.2)) : null;
    check('F15b', '\'lead\': the music band over a sounding clip is the music alone -9 ± 0.5 dB', sameLayout && ducks.length >= 2 && ducks.every((x) => Math.abs(x.diff + 9) <= 0.5), { sameLayout, ducks, overStillDb: overStill, warnings: lead.warnings.map((w: any) => w.code) }, '-9 ± 0.5 dB');
    measurements.leadOverStillDb = overStill;
    const plain = await must(`/projects/${mp}/recipe-runs/${run}/regenerate`, { params: { ownSound: 'under', musicAssetId: null } });
    const plainWav = await wav();
    const d3 = bandDiffs(plainWav.file, plain.picks);
    check('F15', 'without music, the clips\' own sound is at the source level ± 0.5 dB', d3.length >= 2 && d3.every((x) => Math.abs(x.diff) <= 0.5), d3, '0 ± 0.5 dB');
    await must(`/projects/${mp}/recipe-runs/${run}/regenerate`, { params: { ownSound: 'mute', musicAssetId: null } });
    const silent = await wav();
    const all = pcm(silent.file);
    const lvl = rmsDb(all, 0, all.length / 48000);
    check('F15', 'mute without music is silence', lvl < -80, { rmsDbfs: r2(lvl) }, '< -80 dBFS');
  });

  // ================================================================ F16: agents (MCP, propose mode, the people scope)
  await section('F16 agents', async () => {
    const ap = await newProject('film agents');
    const aids: string[] = [];
    for (const f of files) aids.push(await upload(ap, path.join(fx, f)));
    await setCaptures(ap, Object.fromEntries(files.map((f, i) => [f, aids[i]!])));
    await measure(ap, aids.slice(0, 6));
    const plan = await mcp('plan_recipe', { projectId: ap, recipeId: 'family-film', params: { assetIds: aids, targetSeconds: 30 } });
    const apply = await mcp('apply_recipe', { projectId: ap, recipeId: 'family-film', params: { assetIds: aids, targetSeconds: 30 } });
    const rid = apply.body?.runId;
    const regen = rid ? await mcp('regenerate_recipe', { projectId: ap, runId: rid, params: { targetSeconds: 60 } }) : null;
    const propose = await grant('film-propose', 'propose');
    const pRest = await as({ authorization: `Bearer ${propose}`, connection: 'close' }, `/projects/${ap}/recipes/family-film/apply`, { params: { assetIds: aids } });
    const pMcp = await mcp('apply_recipe', { projectId: ap, recipeId: 'family-film', params: { assetIds: aids } }, propose);
    check('F16', 'an edit-mode agent plans, applies and regenerates over MCP; a propose-mode agent gets 403', !plan.isError && !apply.isError && !!rid && !!regen && !regen.isError && pRest.status === 403 && pMcp.isError, { plan: !plan.isError, apply: !apply.isError, regenerate: regen ? !regen.isError : null, proposeRest: [pRest.status, pRest.body?.error?.code], proposeMcp: pMcp.isError }, 'all succeed; propose 403');

    // the people scope: the owner enters a child with a birth date; the agent token reads names only
    const born = await tx(ap, [{ op: 'add_person', args: { name: NOA, birthDate: NOA_BIRTH, form: 'f' } }], OWNER);
    const noa = born.results[0]!.output!.personId as string;
    const ageText = `{name:${noa}} ({age:${noa}})`;
    const base = { assetIds: aids, targetSeconds: 30 as const };
    const planAge = await call(`/projects/${ap}/recipes/family-film/plan`, { params: { ...base, openingText: ageText } });
    const applyAge = await call(`/projects/${ap}/recipes/family-film/apply`, { params: { ...base, openingText: ageText } });
    const mcpAge = await mcp('plan_recipe', { projectId: ap, recipeId: 'family-film', params: { ...base, openingText: ageText } });
    const regenAge = rid ? await call(`/projects/${ap}/recipe-runs/${rid}/regenerate`, { params: { openingText: ageText } }) : null;
    // the owner makes a film whose title shows her age; the agent may not regenerate it
    const ownerFilm = await as(OWNER, `/projects/${ap}/recipes/family-film/apply`, { params: { ...base, openingText: ageText } });
    const ownerRun = ownerFilm.body?.runId as string | undefined;
    const regenOwners = ownerRun ? await call(`/projects/${ap}/recipe-runs/${ownerRun}/regenerate`, { params: {} }) : null;
    const mcpRegen = ownerRun ? await mcp('regenerate_recipe', { projectId: ap, runId: ownerRun, params: {} }) : null;
    const refusedAll = [planAge, applyAge, regenAge, regenOwners].every((r) => r?.status === 403 && r.body?.error?.code === 'people_scope_required') && mcpAge.isError && JSON.stringify(mcpAge.body).includes('people_scope_required') && !!mcpRegen?.isError && JSON.stringify(mcpRegen.body).includes('people_scope_required');
    check('F16', 'an agent without the people scope is refused an {age:…} title at plan, apply and regenerate (REST and MCP), also regenerating the owner\'s film', refusedAll && ownerFilm.status === 200, { plan: [planAge.status, planAge.body?.error?.code], apply: [applyAge.status, applyAge.body?.error?.code], regenerate: [regenAge?.status, regenAge?.body?.error?.code], regenerateOwners: [regenOwners?.status, regenOwners?.body?.error?.code], mcpPlan: mcpAge.isError, mcpRegenerate: mcpRegen?.isError ?? null, ownerApply: ownerFilm.status }, '403 people_scope_required everywhere; the owner may');
    const named = await call(`/projects/${ap}/recipes/family-film/plan`, { params: { ...base, openingText: `{name:${noa}}` } });
    const planText = JSON.stringify(named.body);
    const leaks = [NOA_BIRTH, '1.6.2023', '01.06.2023', '2023-06'].filter((n) => planText.includes(n));
    check('F16', 'the agent\'s plan of a {name:…} title holds no birth date', named.status === 200 && leaks.length === 0, { status: named.status, leaks }, 'none');
    // the rendered title: the agent's still draws no age (equals «נועה ()» typed by hand); the owner's draws one (control)
    const od = await getDoc(ap, OWNER);
    const title = ownerRun ? filmOf(od, ownerRun).titles[0]?.clip : null;
    const tf = title ? frameOfTime(title.start) + 15 : 15;
    const agentStill = await as(AGENT, `/projects/${ap}/frame?index=${tf}`);
    const ownerStill = await still(ap, tf, OWNER);
    let typedStill: Buffer | null = null;
    if (title) {
      await tx(ap, [{ op: 'update_text', args: { clipId: title.id, text: `${NOA} ()` } }, { op: 'set_text_fields', args: { clipId: title.id, enabled: false } }], OWNER);
      typedStill = await still(ap, tf, OWNER);
      await as(OWNER, `/projects/${ap}/undo`, {});
    }
    const agentDrawsNoAge = agentStill.status === 200 ? !!typedStill && sha(agentStill.body) === sha(typedStill) : agentStill.status === 403;
    check('F16', 'the agent\'s still of the owner\'s film title draws no age (equals «נועה ()» typed); control: the owner\'s still differs', !!title && title.fields === true && agentDrawsNoAge && !!typedStill && sha(ownerStill) !== sha(typedStill), { agentStatus: agentStill.status, agentEqualsTyped: agentStill.status === 200 && !!typedStill ? sha(agentStill.body) === sha(typedStill) : null, ownerDiffers: !!typedStill && sha(ownerStill) !== sha(typedStill) }, 'no age for the agent; age for the owner');
  });

  // ================================================================ F18, F19: the dialog by keyboard, the bar after a reload, screenshots
  await section('F18 dialog', async () => {
    const up = await newProject('film ui');
    const uids: Record<string, string> = {};
    for (const f of files) uids[f] = await upload(up, path.join(fx, f));
    await setCaptures(up, uids);
    const um = await upload(up, path.join(fx, truth.music!.name));
    await beats(up, um);
    const browser = await chromium.launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce', colorScheme: 'dark', locale: 'he-IL' });
      await ctx.addInitScript(() => { try { localStorage.setItem('pf.lang', 'he'); localStorage.setItem('pf.theme', 'dark'); } catch { /* storage unavailable */ } });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${s.ownerUrl}&project=${up}`);
      await page.locator('[data-testid=preview]').waitFor({ timeout: 60_000 });
      await page.waitForFunction(() => document.documentElement.lang === 'he', undefined, { timeout: 20_000 });
      const focused = (p: Page) => p.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.testid ?? (document.activeElement as HTMLElement | null)?.tagName ?? '');
      /** Tab (only the keyboard) until the element with this test id has focus, then press `key`. */
      const tabTo = async (testid: string, key = 'Enter', max = 200, step = 'Tab') => {
        for (let i = 0; i <= max; i++) { if (await page.evaluate((t) => !!(document.activeElement as HTMLElement | null)?.closest?.(`[data-testid="${t}"]`), testid)) { if (key) await page.keyboard.press(key); return true; } if (i < max) await page.keyboard.press(step); }
        throw new Error(`keyboard: ${testid} never got focus (last focus ${await focused(page)})`);
      };
      await page.keyboard.press('Control+KeyK');
      await page.locator('[data-testid=palette-input]').waitFor();
      await page.keyboard.type('סרט משפחתי');
      await page.keyboard.press('Enter');
      await page.locator('[data-testid=film-dialog]').waitFor({ timeout: 10_000 });
      await tabTo('film-next');
      await page.locator('[data-testid=film-step-length]').waitFor();
      // music: Tab to the music radios (the checked «בלי מוזיקה»), ArrowDown chooses the measured song
      await tabTo('film-music-none', '');
      await page.keyboard.press('ArrowDown');
      const musicChosen = await page.evaluate(() => (document.querySelector('[data-testid=film-music] input[type=radio]') as HTMLInputElement | null)?.checked ?? false);
      await tabTo('film-next');
      await page.locator('[data-testid=film-step-plan]').waitFor();
      await page.locator('[data-testid=film-plan-row]').first().waitFor({ timeout: 300_000 });
      const reasons = await page.locator('[data-testid=film-reason]').allTextContents();
      const rowsN = await page.locator('[data-testid=film-plan-row]').count();
      await page.locator('[data-testid=film-plan-row]').first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(shots, 'family-film-dialog-plan.png') });
      const heb = /[֐-׿]/;
      check('F7', 'every plan row of the dialog shows its reason in Hebrew, with none of the forbidden words', rowsN > 0 && reasons.length === rowsN && reasons.every((r) => r.trim().length > 2 && heb.test(r) && !FILM_FORBIDDEN_WORDS.test(r) && !FILM_FORBIDDEN_WORDS_HE.test(r)), { rows: rowsN, reasons }, 'every row');
      const rev0 = await revision(up);
      await tabTo('film-apply', 'Enter', 200, 'Shift+Tab'); // the footer's last button: backwards through the focus trap
      await page.locator('[data-testid=film-dialog]').waitFor({ state: 'detached', timeout: 120_000 });
      await page.locator('[data-testid=film-bar]').waitFor({ timeout: 30_000 });
      const rev1 = await revision(up);
      const d = await getDoc(up);
      const runs = Object.values(d.recipeRuns).filter((r: any) => r.recipeId === 'template:tpl.family-film');
      check('F18', 'the dialog driven by the keyboard alone (palette, three steps, apply) makes the film as one revision', musicChosen && rev1 === rev0 + 1 && runs.length === 1 && errors.length === 0, { musicChosen, revisionBefore: rev0, revisionAfter: rev1, runs: runs.length, pageErrors: errors.slice(0, 3) }, 'one film, +1 revision, no page error');
      await page.keyboard.press('Home').catch(() => {});
      await sleep(800);
      await page.screenshot({ path: path.join(shots, 'family-film-timeline-after-apply.png') });
      // F19: after a reload the bar comes from the document's run; «אורך אחר» → 30 s regenerates it
      await page.reload();
      await page.locator('[data-testid=film-bar]').waitFor({ timeout: 60_000 });
      const rev2 = await revision(up);
      await page.locator('[data-testid=film-bar-length]').focus();
      await page.keyboard.press('Enter');
      const item = page.locator('[role=menuitem]').filter({ hasText: '30' }).first();
      await item.waitFor({ timeout: 10_000 });
      await item.focus();
      await page.keyboard.press('Enter');
      const t0 = Date.now();
      while ((await revision(up)) === rev2 && Date.now() - t0 < 120_000) await sleep(200);
      const rev3 = await revision(up);
      const d3 = await getDoc(up);
      const run = Object.values(d3.recipeRuns).find((r: any) => r.recipeId === 'template:tpl.family-film') as any;
      check('F19', 'after a reload, «אורך אחר» → 30 in the film bar regenerates the film from the document\'s run', rev3 === rev2 + 1 && run?.params?.targetSeconds === 30, { revisionBefore: rev2, revisionAfter: rev3, targetSeconds: run?.params?.targetSeconds ?? null }, '+1 revision, target 30');
    } finally { await browser.close(); }
  });

  await s.close();
  return { s };
}

main().then(() => {
  const failed = rows.filter((r) => !r.pass);
  const status = failed.length ? 'failed' : blocked.length ? 'blocked' : 'passed';
  const report = { proof: 'family-film', status, at: new Date().toISOString(), summary: `${rows.length - failed.length}/${rows.length} checks passed, ${blocked.length} section(s) blocked`, checks: rows, blocked, measurements, notes: ['Thresholds of the moments job are tuned on synthetic fixtures only; real footage is unverified until the owner watches a film made from their own clips.', 'F18 covers the keyboard path; the accessibility findings are pnpm audit:a11y (it holds the film dialog, the film bar, the shorts panel and the sequence switcher).'] };
  fs.writeFileSync(evidenceFile, JSON.stringify(report, null, 2) + '\n');
  console.log(`\n${status.toUpperCase()}: ${report.summary} → ${path.relative(root, evidenceFile)}`);
  process.exit(failed.length ? 1 : blocked.length ? 2 : 0);
}, (e) => {
  const isBlocked = e instanceof Blocked;
  console.error(isBlocked ? `BLOCKED: ${e.message}` : e);
  fs.writeFileSync(evidenceFile, JSON.stringify({ proof: 'family-film', status: isBlocked ? 'blocked' : 'failed', reason: String(e?.message ?? e), checks: rows, blocked, measurements }, null, 2) + '\n');
  process.exit(isBlocked ? 2 : 1);
});
