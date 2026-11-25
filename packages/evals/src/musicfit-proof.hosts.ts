/**
 * pnpm proof:musicfit, part hosts (builder B): checks B3, B4, S5, S6, L1, L2, W1–W3, W5, W6, I3 of musicfit-proof.ts, over the real
 * server (startServer on 127.0.0.1) and SYNTHETIC fixtures made here: picture-only test videos made by FFmpeg (testsrc2, 320×180,
 * no sound, so an exported sound is the music alone); songs written by this file's own code as 48 kHz WAV (chords of sine tones
 * that change every bar at 120 BPM, a click on every beat), whose exact beats are attached as a typed fixture (method names the
 * proof; no tracker ran); library songs planted with a synthetic library record (CC-BY-4.0, CC-BY-NC-4.0) next to their bytes; the
 * built-in tracks are the product's own. No owner clip, no downloaded or copyrighted music.
 *
 * Each check returns true or a sentence. A sentence that begins with "BLOCKED" means it could not run here: the plan and apply routes
 * answer 501 until the lead flips MUSICFIT_SERVER_BUILT, builder A's makers (the exact synthesiser, the join search and splice,
 * add_fitted_music, mark_join_heard, sync_impact, planImpact) are not merged, or the web bundle is missing (`pnpm build`).
 * Anything else is a failure. Nobody here can listen: every check is a measurement of samples, frames or records.
 * Run alone: `tsx packages/evals/src/musicfit-proof.hosts.ts` (exit 0 all pass, 1 a failure, 2 only blocked ones besides passes);
 * the integration step imports MUSICFIT_PROOF_HOSTS into musicfit-proof.ts. Writes docs/evidence/musicfit-proof.hosts.json. At most
 * two exports (B3, S6); everything it writes goes under one temporary folder, removed by closeMusicfitProofHosts.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from '@pulseframe/time';
import {
  archiveLibraryPlan, canonical, collectCredits, findClip, flashGapFrames, MODIFIED_LINE, MUSIC_STYLES, MusicFitNotBuilt, planImpact,
  type LibraryRecord, type MediaClip, type MusicFitPlan, type ProjectDocument,
} from '@pulseframe/core';
import { startServer, type RunningServer } from '@pulseframe/server';
import { libraryExportWarnings } from '../../../apps/server/src/export.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = 21000 + Math.floor(Math.random() * 1000);
const R = { num: 30, den: 1 };
const SR = 48000;
const evidence: Record<string, unknown> = {};
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 });
const nf = (t: T.RationalTime, rate = R) => T.nearestFrameIndex(t, rate);
const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-12));
const WAIT_ROUTES = 'BLOCKED: the music-fit routes answer 501 musicfit_not_built (MUSICFIT_SERVER_BUILT is flipped by the lead at integration, after builder A merged)';
const WAIT_A = (what: string) => `BLOCKED: builder A's ${what} is not merged in this build`;

/** True once builder A's pure bodies answer instead of throwing MusicFitNotBuilt. */
function aBuilt(): boolean {
  try { planImpact({ sequences: {}, assets: {}, mainSequenceId: 's', settings: { frameRate: R } } as unknown as ProjectDocument, 'none', undefined, 'beat'); return true; } catch (e) { return !(e instanceof MusicFitNotBuilt); }
}

// ---------- fixtures written by the proof ----------
/** A 48 kHz stereo 16-bit WAV of `seconds`: a chord of three sine tones per bar (four bars cycle), a 10 ms click on every beat. */
function songWav(seconds: number, bpm: number, seed: number): Buffer {
  const n = Math.round(seconds * SR), spb = (SR * 60) / bpm, data = Buffer.alloc(n * 4);
  const roots = [220, 246.94, 196, 174.61].map((x) => x * (1 + seed * 0.01));
  for (let i = 0; i < n; i++) {
    const bar = Math.floor(i / (4 * spb)), r = roots[bar % 4]!, t = i / SR;
    let v = 0.12 * (Math.sin(2 * Math.PI * r * t) + Math.sin(2 * Math.PI * r * 1.25 * t) + Math.sin(2 * Math.PI * r * 1.5 * t));
    const inBeat = i % spb;
    if (inBeat < 0.01 * SR) v += 0.3 * Math.sin(2 * Math.PI * 1000 * t) * (1 - inBeat / (0.01 * SR));
    if (i > n - 0.05 * SR) v *= (n - i) / (0.05 * SR); // the last 50 ms fade to silence (the song's own end)
    const s = Math.max(-32767, Math.min(32767, Math.round(v * 32767)));
    data.writeInt16LE(s, i * 4); data.writeInt16LE(s, i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
/** Mono samples (left channel) of a 16-bit WAV, as numbers −1..1; finds the data chunk. */
function samplesOf(wav: Buffer): Float32Array {
  let o = 12;
  while (o < wav.length - 8 && wav.toString('ascii', o, o + 4) !== 'data') o += 8 + wav.readUInt32LE(o + 4);
  const size = wav.readUInt32LE(o + 4), ch = wav.readUInt16LE(22), start = o + 8;
  const out = new Float32Array(Math.floor(size / (2 * ch)));
  for (let i = 0; i < out.length; i++) out[i] = wav.readInt16LE(start + i * 2 * ch) / 32768;
  return out;
}
/** Samples at the end that are exactly 0 (digital silence). */
const trailingZeros = (x: Float32Array) => { let k = 0; for (let i = x.length - 1; i >= 0 && x[i] === 0; i--) k++; return k; };
const rms = (x: Float32Array, from: number, to: number) => { let s = 0; for (let i = Math.max(0, from); i < Math.min(x.length, to); i++) s += x[i]! * x[i]!; return Math.sqrt(s / Math.max(1, Math.min(x.length, to) - Math.max(0, from))); };
/** The last sample above −60 dBFS. */
const lastSound = (x: Float32Array) => { const lim = 10 ** (-60 / 20); for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i]!) > lim) return i; return -1; };

// ---------- the world ----------
type Who = Record<string, string>;
interface World { s: RunningServer; dir: string; web: boolean; owner: Who; agent: Who; agentToken: string; videos: string[]; songs: { song: string; nc: string; by: string } }
let worldP: Promise<World> | null = null;
const world = () => (worldP ??= makeWorld());
async function makeWorld(): Promise<World> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-musicfit-hosts-'));
  const fx = path.join(dir, 'fx');
  fs.mkdirSync(fx, { recursive: true });
  const videos = Array.from({ length: 8 }, (_, i) => {
    const out = path.join(fx, `v${i}.mp4`);
    ff(['-f', 'lavfi', '-i', `testsrc2=size=320x180:rate=30`, '-t', '24', '-vf', `hue=h=${i * 40}`, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', out]);
    return out;
  });
  const songs = { song: path.join(fx, 'song.wav'), nc: path.join(fx, 'song-nc.wav'), by: path.join(fx, 'song-by.wav') };
  fs.writeFileSync(songs.song, songWav(60, 120, 0));
  fs.writeFileSync(songs.by, songWav(60, 120, 1));
  fs.writeFileSync(songs.nc, songWav(60, 120, 2));
  const webDist = path.join(ROOT, 'apps/web/dist');
  const web = fs.existsSync(path.join(webDist, 'render.html'));
  const s = await startServer({ port: PORT, dataDir: path.join(dir, 'data'), ...(web ? { webDist } : {}), speechPython: null, voicePython: null, backupDir: null });
  const origin = s.url;
  const cookie = (await fetch(`${origin}/api/v1/session`, { headers: { origin, connection: 'close', 'x-pf-owner-key': s.auth.tokens.owner } })).headers.get('set-cookie')!.split(';')[0]!;
  return { s, dir, web, owner: { origin, cookie, connection: 'close' }, agent: { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' }, agentToken: s.auth.tokens.agent, videos, songs };
}
async function as(who: Who, method: string, p: string, body?: unknown): Promise<{ status: number; body: any; raw: Buffer }> {
  const w = await world();
  const r = await fetch(`${w.s.url}/api/v1${p}`, { method, headers: { ...who, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = Buffer.from(await r.arrayBuffer());
  return { status: r.status, body: (r.headers.get('content-type') ?? '').includes('json') ? JSON.parse(raw.toString('utf8')) : raw, raw };
}
const codeOf = (b: any) => b?.error?.code ?? b?.code;
async function must(who: Who, method: string, p: string, body?: unknown, want = [200, 201, 202]) {
  const r = await as(who, method, p, body);
  if (!want.includes(r.status)) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(r.body?.error ?? r.body).slice(0, 300)}`);
  return r.body;
}
const doc = async (pid: string): Promise<ProjectDocument> => (await world()).s.store.wholeProject(pid).doc;
const rev = async (pid: string) => (await world()).s.store.wholeProject(pid).revision;
const hashOf = async (pid: string) => canonical(await doc(pid));
const ownerTx = async (pid: string, ops: unknown[]) => (await must((await world()).owner, 'POST', `/projects/${pid}/transactions`, { ops })) as { revision: number; results: { output?: Record<string, any> }[] };
const newProject = async (name: string, rate = R) => (await must((await world()).owner, 'POST', '/projects', { name, width: 320, height: 180, frameRate: rate })).project.id as string;
async function upload(pid: string, file: string): Promise<string> {
  const w = await world();
  const r = await fetch(`${w.s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...w.owner, 'x-filename': encodeURIComponent(path.basename(file)) }, body: new Uint8Array(fs.readFileSync(file)) });
  const b = (await r.json()) as any;
  if (!b.assetId) throw new Error(`upload of ${file} failed: ${JSON.stringify(b).slice(0, 300)}`);
  return b.assetId as string;
}
/** The exact beats of a song written by songWav (120 BPM from 0, a bar every four), attached as a typed fixture. */
async function exactBeats(pid: string, assetId: string, seconds: number, bpm = 120) {
  const w = await world();
  const times = Array.from({ length: Math.floor((seconds * bpm) / 60) - 1 }, (_, k) => T.rt(60 * k, bpm));
  w.s.store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'attach_analysis', args: { assetId, kind: 'beats', method: 'musicfit proof fixture: the exact beats the proof wrote into its synthetic song (no tracker ran)', params: {}, createdAt: new Date().toISOString(), times, bpm, confidence: 1, downbeats: times.filter((_, k) => k % 4 === 0), meter: 4 } }] });
}
/** A library song: its bytes stored, its record planted with a synthetic ledger row (as the library importer would write it). */
async function librarySong(pid: string, file: string, licence: string, flags: LibraryRecord['flags'] = {}): Promise<{ assetId: string; record: LibraryRecord }> {
  const w = await world();
  const plain = await upload(pid, file);
  const a = (await doc(pid)).assets[plain]!;
  const record: LibraryRecord = { itemId: `mf-proof/${path.basename(file)}`, sourceId: 'mf-proof', kind: 'music', title: `Proof song ${licence}`, author: 'The musicfit proof (synthetic)', sourceSha256: a.contentHash.slice(7), ledger: { item: 'mf-proof' }, licence: { id: licence }, credit: { text: `"Proof song ${licence}" by the musicfit proof, ${licence}`, placement: 'description' }, flags };
  // the same bytes under a library record: a second record of the file (the plain upload is removed first, so the hash is free)
  w.s.store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'remove_asset', args: { assetId: plain } }] });
  const { id: _id, ...rest } = a;
  const { upload: _upload, ...prov } = rest.provenance; // a library file carries its ledger record instead of an upload record
  const r = w.s.store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: { ...rest, name: `${licence}.wav`, provenance: { ...prov, origin: 'upload', library: record } } } }] });
  const assetId = String(r.results[0]!.output!.assetId);
  await exactBeats(pid, assetId, 60);
  return { assetId, record };
}
async function videosIn(pid: string, n = 8): Promise<string[]> { const w = await world(); const out: string[] = []; for (const v of w.videos.slice(0, n)) out.push(await upload(pid, v)); return out; }
const plan = async (pid: string, body: Record<string, unknown>, who?: Who) => as(who ?? (await world()).owner, 'POST', `/projects/${pid}/music-fit/plan`, body);
const apply = async (pid: string, body: Record<string, unknown>, who?: Who) => as(who ?? (await world()).owner, 'POST', `/projects/${pid}/music-fit/apply`, { ...body, expectedRevision: await rev(pid) });
/** 501 from the plan route = not wired yet (BLOCKED); anything else is an answer to check. */
const routesBuilt = (r: { status: number; body: any }) => !(r.status === 501 && codeOf(r.body) === 'musicfit_not_built');
const clipsOf = (d: ProjectDocument) => Object.values(d.sequences).flatMap((q) => q.tracks.flatMap((t) => t.clips.map((c) => ({ c, t }))));
const pictureEnd = (d: ProjectDocument) => Math.max(...clipsOf(d).filter((x) => x.t.kind !== 'audio').map((x) => nf(T.add(x.c.start, x.c.duration))));
const blobOf = async (d: ProjectDocument, assetId: string) => fs.readFileSync((await world()).s.store.blobPath(d.assets[assetId]!.contentHash));
async function exportWav(pid: string, name: string): Promise<string> {
  const w = await world();
  const st = await must(w.owner, 'POST', `/projects/${pid}/exports`, { format: 'wav' });
  for (;;) {
    const j = await must(w.owner, 'GET', `/jobs/${st.jobId}`);
    if (j.status === 'succeeded') { const file = path.join(w.dir, name); fs.writeFileSync(file, (await as(w.owner, 'GET', `/jobs/${j.id}/output`)).raw); return file; }
    if (['failed', 'canceled'].includes(j.status)) throw new Error(`export ${j.status}: ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}
/** A built-in track placed from 0 through POST /music (the product's synthesiser). */
async function builtinOnTimeline(pid: string, styleId: string, fitSeconds: string) {
  const r = await must((await world()).owner, 'POST', `/projects/${pid}/music`, { styleId, fitSeconds, start: T.ZERO });
  return { assetId: r.assetId as string, clipId: r.clipId as string };
}
/** A family film of the proof's videos with `musicAssetId`, through the recipe route. */
async function film(pid: string, ids: string[], musicAssetId: string, targetSeconds = 30) {
  const r = await must((await world()).owner, 'POST', `/projects/${pid}/recipes/family-film/apply`, { params: { assetIds: ids, musicAssetId, targetSeconds, order: 'given', openingTitle: false } });
  return r as { runId: string; slots: { key: string; kind: string; clipId: string }[] };
}
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const fail = (what: string, detail?: unknown) => `${what}${detail === undefined ? '' : `: ${JSON.stringify(detail).slice(0, 400)}`}`;

// ---------- the checks ----------
const checks: Record<string, () => Promise<true | string>> = {
  /** B3: a free clip of built-in music fitted to a 9.5 s picture, exported as WAV: ends on the film's last frame, ≤ 1 sample longer, ≤ 150 ms trailing silence, RMS before the fade ≥ −45 dBFS. */
  B3: async () => {
    const w = await world();
    if (!w.web) return 'BLOCKED: the web bundle is missing (pnpm build); the export needs it';
    const pid = await newProject('mf B3');
    const [v] = await videosIn(pid, 1);
    await ownerTx(pid, [{ op: 'add_clip', args: { assetId: v, start: T.ZERO, duration: T.frameTime(285, R), withLinkedAudio: false } }]);
    const style = MUSIC_STYLES.find((s) => s.id === 'music.festive') ?? MUSIC_STYLES[0]!;
    const m = await builtinOnTimeline(pid, style.id, '12');
    const body = { target: { clipId: m.clipId }, music: { keep: true }, tailor: true };
    const p = await plan(pid, body);
    if (!routesBuilt(p)) return WAIT_ROUTES;
    if (p.status !== 200) return fail('plan', p.body);
    const a = await apply(pid, body);
    if (codeOf(a.body) === 'musicfit_not_built') return WAIT_A('exact synthesiser (endFrames)');
    if (a.status !== 200) return fail('apply', a.body);
    const d = await doc(pid);
    const c = findClip(d, m.clipId)!.clip as MediaClip;
    const fileFrames = Math.round(T.toSeconds(d.assets[c.assetId]!.duration) * SR), clipSamples = Math.round(T.toSeconds(c.duration) * SR);
    const file = samplesOf(await blobOf(d, c.assetId));
    const spb = (SR * 60) / style.bpm;
    const out = samplesOf(fs.readFileSync(await exportWav(pid, 'b3.wav')));
    const endSample = Math.round((pictureEnd(d) / 30) * SR);
    const row = { clipEnd: nf(T.add(c.start, c.duration)), filmEnd: pictureEnd(d), fileMinusClip: fileFrames - clipSamples, trailingSilenceMs: (trailingZeros(file) / SR) * 1000, rmsBeforeFadeDb: db(rms(file, file.length - 2 * spb - 0.1 * SR, file.length - 2 * spb)), exportLastSoundMs: ((endSample - lastSound(out)) / SR) * 1000, fadeOut: c.fadeOut ?? null };
    evidence.B3 = row;
    if (row.clipEnd !== row.filmEnd) return fail('the music clip does not end on the film\'s last frame', row);
    if (row.fileMinusClip < 0 || row.fileMinusClip > 1) return fail('the file is not within one sample of the clip', row);
    if (row.trailingSilenceMs > 150) return fail('more than 150 ms of digital silence at the end of the file', row);
    if (row.rmsBeforeFadeDb < -45) return fail('the 100 ms before the fade are below −45 dBFS', row);
    if (row.fadeOut !== null) return fail('an exact ending has a clip fade', row);
    return true;
  },
  /** B4: a template applied with builtinMusic.ending 'exact': no builtin_music_faded, no fade-out, the music clip ends on the last picture frame. */
  B4: async () => {
    const pid = await newProject('mf B4');
    const media = await videosIn(pid, 6);
    const r = await as((await world()).owner, 'POST', `/projects/${pid}/templates/tpl.home-video/apply`, { params: { media, builtinMusic: { styleId: 'music.festive', seed: 2, ending: 'exact' } } });
    if (codeOf(r.body) === 'musicfit_not_built') return WAIT_A('exact synthesiser (endFrames)');
    if (r.status !== 200) return fail('template apply', r.body);
    const d = await doc(pid);
    const run = d.recipeRuns[r.body.runId]!;
    const m = findClip(d, run.slots!.find((x) => x.kind === 'music')!.clipId)!.clip as MediaClip;
    const notices = (r.body.notices ?? []).map((x: { code: string }) => x.code);
    evidence.B4 = { notices, clipEnd: nf(T.add(m.start, m.duration)), pictureEnd: pictureEnd(d), fadeOut: m.fadeOut ?? null };
    if (notices.includes('builtin_music_faded')) return fail('the exact ending was faded', notices);
    if (m.fadeOut) return fail('the music clip has a fade-out');
    return nf(T.add(m.start, m.duration)) === pictureEnd(d) ? true : fail('the music clip does not end on the last picture frame', evidence.B4);
  },
  /** S5: an agent gets 403 human_approval_required on the heard route and has no tool; the owner's mark commits and changes the chip; one undo removes it. */
  S5: async () => {
    const w = await world();
    const s = await songFit('mf S5', w.songs.song);
    if (typeof s === 'string') return s;
    const agent = await as(w.agent, 'POST', `/projects/${s.pid}/assets/${s.madeAssetId}/music-join/heard`, { heard: true });
    if (agent.status !== 403 || codeOf(agent.body) !== 'human_approval_required') return fail('the agent was not refused', agent.body);
    const tools = await fetch(`${w.s.url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${w.agentToken}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
    const text = await tools.text();
    if (/heard/.test(text.replace(/"description":"[^"]*"/g, ''))) return fail('an MCP tool names the heard mark');
    const owner = await as(w.owner, 'POST', `/projects/${s.pid}/assets/${s.madeAssetId}/music-join/heard`, { heard: true });
    if (codeOf(owner.body) === 'musicfit_not_built') return WAIT_A('heard mark (mark_join_heard)');
    if (owner.status !== 200) return fail('the owner\'s mark', owner.body);
    if (!(await doc(s.pid)).assets[s.madeAssetId]!.provenance.fitted?.heard) return fail('the made file is not marked heard');
    await must(w.owner, 'POST', `/projects/${s.pid}/undo`, {});
    return (await doc(s.pid)).assets[s.madeAssetId]!.provenance.fitted?.heard ? fail('one undo did not remove the mark') : true;
  },
  /** S6: the remainder the plan states (early or cut, in seconds) equals the one measured in the exported sound (or the made file) within one frame. */
  S6: async () => {
    const w = await world();
    if (!w.web) return 'BLOCKED: the web bundle is missing (pnpm build); the export needs it';
    const s = await songFit('mf S6', w.songs.song);
    if (typeof s === 'string') return s;
    const d = await doc(s.pid);
    const c = findClip(d, s.clipId)!.clip as MediaClip;
    const frame = 1 / 30;
    let measured: number;
    if (s.plan.ending.kind === 'early') {
      const out = samplesOf(fs.readFileSync(await exportWav(s.pid, 's6.wav')));
      measured = (Math.round((pictureEnd(d) / 30) * SR) - lastSound(out)) / SR;
    } else measured = T.toSeconds(d.assets[c.assetId]!.duration) - T.toSeconds(c.duration);
    evidence.S6 = { ending: s.plan.ending, measured };
    return Math.abs(measured - s.plan.ending.seconds) <= frame ? true : fail('the stated remainder differs from the measured one by more than a frame', evidence.S6);
  },
  /** L1: a CC-BY-4.0 song: the made file carries the credit; the description has the credit verbatim and «(קוצר בעורך: הוסרו תיבות מהאמצע)» after it. */
  L1: async () => {
    const w = await world();
    const s = await songFit('mf L1', w.songs.by, 'CC-BY-4.0');
    if (typeof s === 'string') return s;
    const d = await doc(s.pid);
    const made = d.assets[s.madeAssetId]!;
    const text = collectCredits(d).descriptionText('he');
    evidence.L1 = { record: made.provenance.library?.licence, text };
    if (canonical(made.provenance.library) !== canonical(s.record)) return fail('the made file does not carry the source\'s library record', made.provenance.library);
    const at = text.indexOf(s.record.credit!.text);
    if (at < 0) return fail('the credit is not in the description verbatim', text);
    return text.indexOf(MODIFIED_LINE.he, at) > at ? true : fail('the shortened line does not follow the credit', text);
  },
  /** L2: a CC-BY-NC-4.0 song: the made file is non-commercial, the export warns, the shared archive omits its bytes. */
  L2: async () => {
    const w = await world();
    const s = await songFit('mf L2', w.songs.nc, 'CC-BY-NC-4.0', { nonCommercial: true, diskOnly: true });
    if (typeof s === 'string') return s;
    const d = await doc(s.pid);
    const made = d.assets[s.madeAssetId]!;
    const warn = libraryExportWarnings(d).map((x) => x.code);
    const plannedExport = await as(w.owner, 'POST', `/projects/${s.pid}/exports/plan`, { format: 'mp4' });
    const strip = archiveLibraryPlan(d);
    evidence.L2 = { flags: made.provenance.library?.flags, warn, exportPlan: plannedExport.status, strip: JSON.stringify(strip).slice(0, 300) };
    if (!made.provenance.library?.flags.nonCommercial) return fail('the made file is not non-commercial');
    if (!warn.includes('non_commercial_content') || !JSON.stringify(plannedExport.body).includes('non_commercial_content')) return fail('the export does not warn non-commercial', evidence.L2);
    return JSON.stringify(strip).includes(made.contentHash) ? true : fail('the shared archive keeps the made file\'s bytes', evidence.L2);
  },
  /** W1: a film moved from the fastest to the slowest built-in style: untouched cuts on the new grid, a hand-trimmed pick kept as it was, one undo restores the hash, the made track stays. */
  W1: async () => {
    const byBpm = [...MUSIC_STYLES].filter((s) => s.review !== 'rejected').sort((a, b) => b.bpm - a.bpm);
    const fast = byBpm[0]!, slow = byBpm[byBpm.length - 1]!;
    const pid = await newProject('mf W1');
    const ids = await videosIn(pid);
    const m = await builtinOnTimeline(pid, fast.id, '40');
    await ownerTx(pid, [{ op: 'delete_clip', args: { clipId: m.clipId } }]);
    const f = await film(pid, ids, m.assetId);
    const pick = f.slots.find((x) => x.kind === 'picture')!;
    const pc = findClip(await doc(pid), pick.clipId)!.clip;
    await ownerTx(pid, [{ op: 'trim_clip', args: { clipId: pick.clipId, edge: 'end', to: T.sub(T.add(pc.start, pc.duration), T.frameTime(3, R)) } }]);
    const trimmed = canonical(findClip(await doc(pid), pick.clipId)!.clip);
    const body = { target: { runId: f.runId }, music: { builtin: { styleId: slow.id, seed: 1 } }, tailor: true };
    const p = await plan(pid, body);
    if (!routesBuilt(p)) return WAIT_ROUTES;
    const beforeDoc = structuredClone(await doc(pid));
    const a = await apply(pid, body);
    if (codeOf(a.body) === 'musicfit_not_built') return WAIT_A('exact synthesiser (endFrames)');
    if (a.status !== 200) return fail('apply', a.body);
    const d = await doc(pid);
    if (canonical(findClip(d, pick.clipId)?.clip) !== trimmed) return fail('the pick trimmed by hand changed');
    // untouched cuts on bar or half-bar frames of the slow style's grid from the film start (two beats apart)
    const half = (60 * 2) / slow.bpm;
    const run = d.recipeRuns[f.runId]!;
    const made = run.createdIds.map((id) => findClip(d, id)).filter((x) => x && x.track.kind === 'video').map((x) => nf(x!.clip.start));
    const off = made.filter((fr) => { const k = Math.round(fr / 30 / half); return Math.abs(nf(T.fromSeconds((k * half).toFixed(6))) - fr) > 0; });
    evidence.W1 = { from: fast.id, to: slow.id, madeCuts: sorted(made), off };
    if (off.length) return fail('cuts the plan made are not on the new grid', evidence.W1);
    await must((await world()).owner, 'POST', `/projects/${pid}/undo`, {});
    const afterUndo = await doc(pid);
    if (!afterUndo.assets[a.body.madeAssetId]) return fail('the made track left the library on undo');
    // after one undo the document is the one before the fit plus the made file (commit 1 stays): compared without the made file and its analysis
    const strip = (x: ProjectDocument) => { const c = structuredClone(x); delete c.assets[a.body.madeAssetId]; delete c.analyses[a.body.madeAssetId]; return canonical(c); };
    return strip(afterUndo) === canonical(beforeDoc) ? true : fail('one undo did not restore the document');
  },
  /** W2: a film moved from the slowest to the fastest style, planned at 24, 30 and 60 fps: no cut the plan makes is closer than flashGapFrames to another. */
  W2: async () => {
    const byBpm = [...MUSIC_STYLES].filter((s) => s.review !== 'rejected').sort((a, b) => a.bpm - b.bpm);
    const rows: Record<string, unknown>[] = [];
    for (const rate of [{ num: 24, den: 1 }, R, { num: 60, den: 1 }]) {
      const pid = await newProject(`mf W2 ${rate.num}`, rate);
      const ids = await videosIn(pid);
      const m = await builtinOnTimeline(pid, byBpm[0]!.id, '40');
      await ownerTx(pid, [{ op: 'delete_clip', args: { clipId: m.clipId } }]);
      const f = await film(pid, ids, m.assetId);
      const p = await plan(pid, { target: { runId: f.runId }, music: { builtin: { styleId: byBpm[byBpm.length - 1]!.id, seed: 1 } }, tailor: true });
      if (!routesBuilt(p)) return WAIT_ROUTES;
      if (p.status === 409 && codeOf(p.body) === 'flash_gap') return fail('the planner itself made a cut too close (the film planner merges such slots)');
      if (p.status !== 200) return fail('plan', p.body);
      const fp = p.body as MusicFitPlan;
      rows.push({ rate: rate.num, gap: flashGapFrames(rate.num / rate.den), after: fp.recut?.after, thinned: fp.recut?.thinned, blocking: fp.blocking.map((b) => b.code) });
      if (fp.blocking.some((b) => b.code === 'flash_gap')) return fail('flash_gap blocks a plan of the film planner', rows);
      if (fp.recut?.after.minGapFrames !== null && fp.recut!.after.minGapFrames < flashGapFrames(rate.num / rate.den) && !fp.warnings.some((x) => x.code === 'kept_cuts_close')) return fail('two cuts closer than the gap without kept_cuts_close', rows);
    }
    evidence.W2 = rows;
    return true;
  },
  /** W3: a template with a slot edited by hand: the plan lists it under blocked with template_blocked (Hebrew), apply refuses, the document hash is unchanged. */
  W3: async () => {
    const w = await world();
    const pid = await newProject('mf W3');
    const media = await videosIn(pid, 6);
    const t = await must(w.owner, 'POST', `/projects/${pid}/templates/tpl.home-video/apply`, { params: { media, builtinMusic: { styleId: 'music.festive', seed: 1 } } });
    const d0 = await doc(pid);
    const slot = d0.recipeRuns[t.runId]!.slots!.find((x) => x.kind === 'picture')!;
    const c = findClip(d0, slot.clipId)!.clip;
    await ownerTx(pid, [{ op: 'trim_clip', args: { clipId: slot.clipId, edge: 'end', to: T.sub(T.add(c.start, c.duration), T.frameTime(2, R)) } }]);
    const body = { target: { runId: t.runId }, music: { builtin: { styleId: 'music.calm', seed: 1 } }, tailor: true };
    const p = await plan(pid, body);
    if (!routesBuilt(p)) return WAIT_ROUTES;
    if (p.status !== 200) return fail('plan', p.body);
    const fp = p.body as MusicFitPlan;
    if (!fp.blocking.some((b) => b.code === 'template_blocked' && /התבנית אינה יכולה לחול כך/.test(String(b.details.he))) || !fp.recut?.blocked.includes(slot.key)) return fail('the plan does not list the slot under blocked', fp.blocking);
    const before = await hashOf(pid);
    const a = await apply(pid, body);
    evidence.W3 = { status: a.status, code: codeOf(a.body) };
    if (a.status !== 409 || codeOf(a.body) !== 'template_blocked') return fail('apply was not refused template_blocked', a.body);
    return (await hashOf(pid)) === before ? true : fail('the document changed');
  },
  /** W5: a film whose music clip had a hand-set gain: the new music has that gain; the dropped volume keys are counted (music_keys_dropped). */
  W5: async () => {
    const pid = await newProject('mf W5');
    const ids = await videosIn(pid);
    const m = await builtinOnTimeline(pid, 'music.festive', '40');
    await ownerTx(pid, [{ op: 'delete_clip', args: { clipId: m.clipId } }]);
    const f = await film(pid, ids, m.assetId);
    const music = f.slots.find((x) => x.kind === 'music')!.clipId;
    await ownerTx(pid, [{ op: 'set_clip_gain', args: { clipId: music, gain: 0.5 } }, { op: 'set_volume_keyframe', args: { clipId: music, time: T.frameTime(30, R), value: 0.7 } }, { op: 'set_volume_keyframe', args: { clipId: music, time: T.frameTime(60, R), value: 0.9 } }]);
    const body = { target: { runId: f.runId }, music: { builtin: { styleId: 'music.calm', seed: 1 } }, tailor: true };
    const p = await plan(pid, body);
    if (!routesBuilt(p)) return WAIT_ROUTES;
    const dropped = (p.body as MusicFitPlan).warnings?.find((x) => x.code === 'music_keys_dropped');
    if (dropped?.details.count !== 2) return fail('the dropped keys are not counted', p.body?.warnings);
    const a = await apply(pid, body);
    if (codeOf(a.body) === 'musicfit_not_built') return WAIT_A('exact synthesiser (endFrames)');
    if (a.status !== 200) return fail('apply', a.body);
    const d = await doc(pid);
    const nm = findClip(d, d.recipeRuns[f.runId]!.slots!.find((x) => x.kind === 'music')!.clipId)!.clip as MediaClip;
    evidence.W5 = { gain: nm.gain, volume: nm.volume ?? null, dropped: dropped.details.count };
    return nm.gain === 0.5 && !nm.volume ? true : fail('the new music clip does not carry the gain alone', evidence.W5);
  },
  /** W6: after tailoring a film's music, «אורך אחר» reports music_short and the fit can be planned again. */
  W6: async () => {
    const w = await world();
    const pid = await newProject('mf W6');
    const ids = await videosIn(pid);
    const m = await builtinOnTimeline(pid, 'music.festive', '40');
    await ownerTx(pid, [{ op: 'delete_clip', args: { clipId: m.clipId } }]);
    const f = await film(pid, ids, m.assetId);
    const body = { target: { runId: f.runId }, music: { keep: true }, tailor: true };
    const p = await plan(pid, body);
    if (!routesBuilt(p)) return WAIT_ROUTES;
    const a = await apply(pid, body);
    if (codeOf(a.body) === 'musicfit_not_built') return WAIT_A('exact synthesiser (endFrames)');
    if (a.status !== 200) return fail('apply', a.body);
    const longer = await must(w.owner, 'POST', `/projects/${pid}/recipe-runs/${f.runId}/regenerate`, { params: { targetSeconds: 60 } });
    const codes = (longer.warnings ?? []).map((x: { code: string }) => x.code);
    const again = await plan(pid, body);
    evidence.W6 = { codes, again: again.status };
    return codes.includes('music_short') && again.status === 200 ? true : fail('«אורך אחר» does not report music_short, or the fit is not offered again', evidence.W6);
  },
  /** I3: after a swap the plan lists the marked clip with its new offset, and sync_impact puts it on a beat frame in one transaction. */
  I3: async () => {
    if (!aBuilt()) return WAIT_A('impact sync (planImpact, sync_impact)');
    const pid = await newProject('mf I3');
    const [v] = await videosIn(pid, 1);
    const t = await ownerTx(pid, [{ op: 'add_clip', args: { assetId: v, start: T.ZERO, duration: T.frameTime(300, R), withLinkedAudio: false } }]);
    const vid = String(t.results[0]!.output!.clipId);
    const m = await builtinOnTimeline(pid, 'music.festive', '12');
    await ownerTx(pid, [{ op: 'sync_impact', args: { clipId: vid, moment: T.frameTime(95, R), to: 'beat' } }]);
    const body = { target: { clipId: m.clipId }, music: { builtin: { styleId: 'music.calm', seed: 1 } }, tailor: true };
    const p = await plan(pid, body);
    if (!routesBuilt(p)) return WAIT_ROUTES;
    const listed = (p.body as MusicFitPlan).impacts?.find((x) => x.clipId === vid);
    if (!listed) return fail('the plan does not list the marked clip', p.body?.impacts);
    const a = await apply(pid, body);
    if (a.status !== 200) return fail('apply', a.body);
    const r = await as((await world()).owner, 'POST', `/projects/${pid}/transactions`, { ops: [{ op: 'sync_impact', args: { clipId: vid, to: 'beat' } }] });
    if (r.status !== 200 && codeOf(r.body) !== 'invalid_args') return fail('sync_impact after the swap', r.body);
    const after = planImpact(await doc(pid), vid, undefined, 'beat');
    evidence.I3 = { listed, after: 'refusal' in after ? after.refusal : after.offsetBefore };
    return 'refusal' in after && after.refusal === 'alreadyOnBeat' ? true : fail('the marked moment is not on a beat frame after «ליישר שוב»', evidence.I3);
  },
};

/** A free song clip under a 20 s picture, shortened by the music fit (tailor); BLOCKED until the routes and A's splice answer. */
async function songFit(name: string, file: string, licence?: string, flags: LibraryRecord['flags'] = {}): Promise<string | { pid: string; clipId: string; madeAssetId: string; plan: MusicFitPlan; record: LibraryRecord }> {
  const pid = await newProject(name);
  const [v] = await videosIn(pid, 1);
  let assetId: string, record = null as unknown as LibraryRecord;
  if (licence) ({ assetId, record } = await librarySong(pid, file, licence, flags));
  else { assetId = await upload(pid, file); await exactBeats(pid, assetId, 60); }
  const t = await ownerTx(pid, [{ op: 'add_clip', args: { assetId: v, start: T.ZERO, duration: T.frameTime(600, R), withLinkedAudio: false } }, { op: 'add_clip', args: { assetId, start: T.ZERO, duration: T.frameTime(600, R) } }]);
  const clipId = String(t.results[1]!.output!.clipId);
  const body = { target: { clipId }, music: { keep: true }, tailor: true };
  const p = await plan(pid, body);
  if (!routesBuilt(p)) return WAIT_ROUTES;
  if (p.status !== 200) return fail('plan', p.body);
  const a = await apply(pid, body);
  if (codeOf(a.body) === 'musicfit_not_built') return WAIT_A('join search and splice (SongFitter) or add_fitted_music');
  if (a.status !== 200 || !a.body.madeAssetId) return fail('apply', a.body);
  return { pid, clipId, madeAssetId: a.body.madeAssetId, plan: p.body as MusicFitPlan, record };
}

export const MUSICFIT_PROOF_HOSTS = { checks } as const;
/** Stop the server and remove everything this part wrote. */
export async function closeMusicfitProofHosts(): Promise<void> {
  if (!worldP) return;
  const w = await worldP.catch(() => null);
  worldP = null;
  if (!w) return;
  await w.s.close();
  fs.rmSync(w.dir, { recursive: true, force: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const started = Date.now();
  const out: Record<string, true | string> = {};
  try {
    for (const [k, fn] of Object.entries(checks)) {
      try { out[k] = await fn(); } catch (e) { out[k] = `error: ${(e as Error).message}`; }
      console.log(`${out[k] === true ? '  ok   ' : String(out[k]).startsWith('BLOCKED') ? ' block ' : ' FAIL  '} ${k}${out[k] === true ? '' : `  ${out[k]}`}`);
    }
  } finally { await closeMusicfitProofHosts(); }
  const failed = Object.values(out).filter((v) => v !== true && !String(v).startsWith('BLOCKED')).length;
  const blocked = Object.values(out).filter((v) => typeof v === 'string' && v.startsWith('BLOCKED')).length;
  fs.mkdirSync(path.join(ROOT, 'docs/evidence'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs/evidence/musicfit-proof.hosts.json'), JSON.stringify({ at: new Date().toISOString(), wallSeconds: (Date.now() - started) / 1000, results: out, evidence }, null, 2));
  process.exit(failed ? 1 : blocked ? 2 : 0);
}
