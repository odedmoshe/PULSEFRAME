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
  archiveLibraryPlan, canonical, collectCredits, findClip, flashGapFrames, MODIFIED_LINE, MUSIC_STYLES, MUSICFIT_FORBIDDEN_WORDS, MUSICFIT_FORBIDDEN_WORDS_HE, MUSICFIT_REFUSALS, MusicFitNotBuilt, planImpact,
  type LibraryRecord, type MediaClip, type MusicFitPlan, type ProjectDocument,
} from '@pulseframe/core';
import { startServer, type RunningServer } from '@pulseframe/server';
import { libraryExportWarnings } from '../../../apps/server/src/export.ts';
import { prepareMusicFit } from '../../../apps/server/src/musicfit/plan.ts';
import { abaSong, throughSong, type FixtureSong } from '../../../apps/server/src/musicfit/songs.testFixture.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
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
  const s = await startServer({ port: 0, dataDir: path.join(dir, 'data'), ...(web ? { webDist } : {}), speechPython: null, voicePython: null, backupDir: null });
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


// ---------- integration (wave 7 batch B): pixels, a local-tool copy and the plan route for the makers' partial checks ----------
/** A stereo 16-bit 48 kHz WAV of a fixture song with a centred 55 Hz tone: left = 0.6·song + centre, right = centre. */
function stereoWithCentre(song: FixtureSong, centreHz = 55): Buffer {
  const data = Buffer.alloc(song.frames * 4);
  for (let n = 0; n < song.frames; n++) {
    const c = 0.2 * Math.sin((2 * Math.PI * centreHz * n) / SR), x = song.pcm[2 * n]! / 32768;
    data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round((0.6 * x + c) * 32767))), n * 4);
    data.writeInt16LE(Math.round(c * 32767), n * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
/** A song written by songWav, made stereo the same way (a centred tone), for a local-tool copy. */
const stereoSongWav = (seconds: number, bpm: number): Buffer => {
  const mono = samplesOf(songWav(seconds, bpm, 0));
  const pcm = new Int16Array(2 * mono.length);
  for (let i = 0; i < mono.length; i++) { const v = Math.round(mono[i]! * 32767); pcm[2 * i] = v; pcm[2 * i + 1] = v; }
  return stereoWithCentre({ name: 'click', pcm, frames: mono.length, beats: [], downbeats: [], bpm, barFrames: 0, sections: [] });
};
/** The barcode clip: 10 s at 30 fps, 320×180, black with ONE white frame (source frame 97), and a 30 ms 1 kHz beep starting at that frame. */
let barcodeFile: string | null = null;
async function barcode(): Promise<string> {
  if (barcodeFile) return barcodeFile;
  const w = await world(), out = path.join(w.dir, 'fx', 'barcode.mp4');
  ff(['-f', 'lavfi', '-i', 'color=black:s=320x180:r=30:d=10', '-f', 'lavfi', '-i', `aevalsrc='if(between(t\\,97/30\\,97/30+0.03)\\,0.5*sin(2*PI*1000*t)\\,0)':s=48000:d=10`,
    '-vf', `drawbox=x=0:y=0:w=320:h=180:color=white:t=fill:enable='eq(n\\,97)'`, '-ac', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', '-g', '30', '-c:a', 'aac', '-b:a', '192k', '-shortest', out]);
  return (barcodeFile = out);
}
const WHITE = 200, DARK = 40;
/** Mean luma (0–255) of an RGB24 buffer. */
const meanOf = (rgb: Buffer) => { let s = 0; for (let i = 0; i < rgb.length; i += 3) s += 0.299 * rgb[i]! + 0.587 * rgb[i + 1]! + 0.114 * rgb[i + 2]!; return s / (rgb.length / 3); };
const ffIn = (args: string[], input: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { input, maxBuffer: 1 << 28 });
/** The server still of timeline frame `n` (GET …/frame, the same evaluate and compositor as the export), as mean luma. */
async function stillLumaOf(pid: string, n: number): Promise<number> {
  const r = await as((await world()).owner, 'GET', `/projects/${pid}/frame?index=${n}`);
  if (r.status !== 200) throw new Error(`frame ${n} → ${r.status} ${JSON.stringify(r.body?.error ?? '').slice(0, 200)}`);
  return meanOf(ffIn(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], r.raw));
}
/** Frames [a, b] of a still each: which are white, which dark (anything between is reported as neither). */
async function whiteFrames(pid: string, a: number, b: number): Promise<{ white: number[]; luma: Record<number, number> }> {
  const luma: Record<number, number> = {}, white: number[] = [];
  for (let n = a; n <= b; n++) { luma[n] = Math.round(await stillLumaOf(pid, n)); if (luma[n]! >= WHITE) white.push(n); else if (luma[n]! > DARK) white.push(-n); }
  return { white, luma };
}
async function exportMp4(pid: string, name: string): Promise<string> {
  const w = await world();
  const st = await must(w.owner, 'POST', `/projects/${pid}/exports`, { format: 'mp4-h264-aac' });
  for (;;) {
    const j = await must(w.owner, 'GET', `/jobs/${st.jobId}`);
    if (j.status === 'succeeded') { const file = path.join(w.dir, name); fs.writeFileSync(file, (await as(w.owner, 'GET', `/jobs/${j.id}/output`)).raw); return file; }
    if (['failed', 'canceled'].includes(j.status)) throw new Error(`export ${j.status}: ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}
const mp4FrameLuma = (file: string, n: number) => meanOf(ff(['-i', file, '-vf', `select=eq(n\\,${n})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']));
const mp4Sound = (file: string) => { const raw = ff(['-i', file, '-map', '0:a:0', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-']); return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)); };
/** The first sample louder than −12 dBFS (the beep is −6 dBFS; the music is muted for this export). */
const onset = (x: Float32Array) => { const lim = 10 ** (-12 / 20); for (let i = 0; i < x.length; i++) if (Math.abs(x[i]!) > lim) return i; return -1; };
/** A song uploaded with the exact beats it was written with (attached as a typed fixture). */
async function songIn(pid: string, name: string, bytes: Buffer, seconds: number, bpm: number): Promise<string> {
  const w = await world(), file = path.join(w.dir, 'fx', name);
  fs.writeFileSync(file, bytes);
  const id = await upload(pid, file);
  await exactBeats(pid, id, seconds, bpm);
  return id;
}
/** A time-preserving copy of the sound clip made by the product's local-tool job «הסרת שירה (קלאסי)» (ffmpeg only), given to the clip. */
async function jobCopy(pid: string, clipId: string): Promise<{ copyId: string; sourceRangeStart: T.RationalTime } | string> {
  const w = await world();
  const st = await as(w.owner, 'POST', `/projects/${pid}/capabilities/local.audio.vocals-classic/runs`, { params: {}, source: { clipId }, apply: 'replace-clip' });
  if (st.status !== 202) return `BLOCKED: the local-tool job local.audio.vocals-classic was not started here (${st.status} ${codeOf(st.body)}: ${String(st.body?.error?.message ?? '').slice(0, 200)})`;
  for (;;) {
    const j = await must(w.owner, 'GET', `/jobs/${st.body.jobId}`);
    if (j.status === 'succeeded') break;
    if (['failed', 'canceled'].includes(j.status)) return fail('the local-tool job failed', j.error ?? j.status);
    await new Promise((r) => setTimeout(r, 250));
  }
  const d = await doc(pid);
  const c = findClip(d, clipId)!.clip as MediaClip, a = d.assets[c.assetId]!;
  if (!a.provenance.derived?.sourceRangeStart) return fail('the clip does not show a derived copy with its offset after the job', a.provenance);
  return { copyId: a.id, sourceRangeStart: a.provenance.derived.sourceRangeStart };
}
const removalOf = (fp: MusicFitPlan) => (fp.make.kind === 'fitted' ? fp.make.candidates[fp.make.chosen]!.removal : null);

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
    // integration: a tool that marks a join heard would be named for it or take a `heard` argument; descriptions may say "not heard"
    // (the plan's own wording), so they are not searched (the earlier text match failed on escaped quotes inside descriptions)
    const listed = JSON.parse((tools.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text) as { result: { tools: { name: string; inputSchema?: { properties?: Record<string, unknown> } }[] } };
    const named = listed.result.tools.filter((t) => /heard/i.test(t.name) || Object.keys(t.inputSchema?.properties ?? {}).some((k) => /heard/i.test(k)) || t.name === 'mark_join_heard').map((t) => t.name);
    if (!listed.result.tools.length) return fail('tools/list returned no tools');
    if (named.length) return fail('an MCP tool names the heard mark', named);
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
    const plannedExport = await as(w.owner, 'POST', `/projects/${s.pid}/exports/plan`, { format: 'mp4-h264-aac' }); // integration: 'mp4' is not an export format (400)
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
    // a pick kept by hand stays where it is (decisions §3) and the plan counts it off the grid: the cut at ITS end is the kept pick's,
    // not one the plan chose. The kept pick must be listed in recut.offGrid; only the end frames of listed clips are set aside.
    const offGrid = (p.body as MusicFitPlan).recut?.offGrid ?? [];
    if (!offGrid.includes(pick.clipId)) return fail('the pick trimmed by hand is not counted off the grid', (p.body as MusicFitPlan).recut);
    const keptEnds = new Set(offGrid.map((id) => findClip(d, id)).filter((x) => !!x).map((x) => nf(T.add(x!.clip.start, x!.clip.duration))));
    const off = made.filter((fr) => !keptEnds.has(fr)).filter((fr) => { const k = Math.round(fr / 30 / half); return Math.abs(nf(T.fromSeconds((k * half).toFixed(6))) - fr) > 0; });
    evidence.W1 = { from: fast.id, to: slow.id, madeCuts: sorted(made), keptEnds: [...keptEnds], offGrid, off };
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
    // integration: music.calm (80 BPM) needs at least 10.5 s and the picture is 10 s (400 too_short); music.pop needs 6.6 s
    const body = { target: { clipId: m.clipId }, music: { builtin: { styleId: 'music.pop', seed: 1 } }, tailor: true };
    const p = await plan(pid, body);
    if (!routesBuilt(p)) return WAIT_ROUTES;
    if (p.status !== 200) return fail('plan', p.body);
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
  /** I1 (integration): the white frame read from the PIXELS of server stills and of an mp4 export; the beep measured in the exported sound; a reversed clip in stills. */
  I1: async () => {
    const w = await world();
    if (!w.web) return 'BLOCKED: the web bundle is missing (pnpm build); stills and the export need it';
    const pid = await newProject('mf I1');
    const bar = await upload(pid, await barcode());
    const song = await songIn(pid, 'click128.wav', songWav(30, 128, 0), 30, 128);
    const t = await ownerTx(pid, [{ op: 'add_clip', args: { assetId: bar, start: T.ZERO, sourceIn: T.rt(2, 1), duration: T.rt(4, 1) } }, { op: 'add_clip', args: { assetId: song, start: T.ZERO, duration: T.rt(4, 1) } }]);
    const vid = String(t.results[0]!.output!.clipId), music = String(t.results[1]!.output!.clipId);
    const before = await whiteFrames(pid, 35, 39);
    const c0 = findClip(await doc(pid), vid)!.clip as MediaClip;
    const r = await ownerTx(pid, [{ op: 'sync_impact', args: { clipId: vid, moment: T.frameTime(97, R), to: 'beat' } }]);
    const out = r.results[0]!.output as { used: T.RationalTime; offsetBefore: { frames: number }; targetFrame: number };
    const beatFrame = nf(out.used);
    const d1 = await doc(pid);
    const c1 = findClip(d1, vid)!.clip as MediaClip;
    const after = await whiteFrames(pid, beatFrame - 2, beatFrame + 2);
    // the export: the music muted (gain 0, nothing moves) so the exported sound is the clip's own beep
    await ownerTx(pid, [{ op: 'set_clip_gain', args: { clipId: music, gain: 0 } }]);
    const mp4 = await exportMp4(pid, 'i1.mp4');
    const exported = [beatFrame - 1, beatFrame, beatFrame + 1].map((n) => Math.round(mp4FrameLuma(mp4, n)));
    const beepAt = onset(mp4Sound(mp4)), beepMs = (beepAt / SR) * 1000, whiteMs = (beatFrame / 30) * 1000;
    fs.rmSync(mp4, { force: true });
    // a reversed clip, from the same start
    const pid2 = await newProject('mf I1 reversed');
    const bar2 = await upload(pid2, await barcode());
    const song2 = await songIn(pid2, 'click128b.wav', songWav(30, 128, 0), 30, 128);
    const t2 = await ownerTx(pid2, [{ op: 'add_clip', args: { assetId: bar2, start: T.ZERO, sourceIn: T.rt(2, 1), duration: T.rt(4, 1) } }, { op: 'add_clip', args: { assetId: song2, start: T.ZERO, duration: T.rt(4, 1) } }]);
    const v2 = String(t2.results[0]!.output!.clipId);
    await ownerTx(pid2, [{ op: 'set_clip_reverse', args: { clipId: v2, reverse: true } }]);
    const r2 = await ownerTx(pid2, [{ op: 'sync_impact', args: { clipId: v2, moment: T.frameTime(97, R), to: 'beat' } }]);
    const rb = nf((r2.results[0]!.output as { used: T.RationalTime }).used);
    const rev2 = await whiteFrames(pid2, rb - 1, rb + 1);
    const row = { whiteBefore: before.white, offsetBefore: out.offsetBefore.frames, beatFrame, whiteAfterInStills: after.white, stillLuma: after.luma, exportLuma: exported, beepOnsetMs: Math.round(beepMs * 100) / 100, whiteFrameMs: Math.round(whiteMs * 100) / 100, beepMinusWhiteMs: Math.round((beepMs - whiteMs) * 100) / 100, startSame: T.eq(c0.start, c1.start), lengthSame: T.eq(c0.duration, c1.duration), reversed: { beatFrame: rb, white: rev2.white, luma: rev2.luma } };
    evidence.I1 = row;
    if (before.white.length !== 1 || before.white[0] !== 37) return fail('before the sync the white frame is not alone on frame 37 in the stills', row);
    if (out.offsetBefore.frames !== 37 - beatFrame) return fail('offsetBefore is not the frames counted from the stills', row);
    if (after.white.length !== 1 || after.white[0] !== beatFrame) return fail('after the sync the white frame is not alone on the beat frame in the stills', row);
    if (!(exported[1]! >= WHITE && exported[0]! <= DARK && exported[2]! <= DARK)) return fail('in the export the white frame is not alone on the beat frame', row);
    if (!row.startSame || !row.lengthSame) return fail('the clip\'s start or length changed', row);
    if (beepAt < 0 || Math.abs(beepMs - whiteMs) > 5) return fail('the exported beep does not start within 5 ms of the white frame', row);
    if (rev2.white.length !== 1 || rev2.white[0] !== rb) return fail('a reversed clip: the white frame is not alone on the beat frame', row);
    return true;
  },
  /** I2 (integration): the music clip shows a copy made by the product's local-tool job; sync_impact measures through it (viaAssetId = the measured song) and the white frame lands on the beat frame in a still. */
  I2: async () => {
    const w = await world();
    if (!w.web) return 'BLOCKED: the web bundle is missing (pnpm build); stills need it';
    const pid = await newProject('mf I2');
    const bar = await upload(pid, await barcode());
    const song = await songIn(pid, 'click128s.wav', stereoSongWav(30, 128), 30, 128);
    const t = await ownerTx(pid, [{ op: 'add_clip', args: { assetId: bar, start: T.ZERO, sourceIn: T.rt(2, 1), duration: T.rt(4, 1) } }, { op: 'add_clip', args: { assetId: song, start: T.ZERO, sourceIn: T.rt(1, 1), duration: T.rt(6, 1) } }]);
    const vid = String(t.results[0]!.output!.clipId), music = String(t.results[1]!.output!.clipId);
    const copy = await jobCopy(pid, music);
    if (typeof copy === 'string') return copy;
    const r = await ownerTx(pid, [{ op: 'sync_impact', args: { clipId: vid, moment: T.frameTime(97, R), to: 'beat' } }]);
    const out = r.results[0]!.output as { used: T.RationalTime; viaAssetId: string };
    const beatFrame = nf(out.used);
    const after = await whiteFrames(pid, beatFrame - 1, beatFrame + 1);
    evidence.I2 = { copyId: copy.copyId, sourceRangeStart: T.toSeconds(copy.sourceRangeStart), viaAssetId: out.viaAssetId, song, beatFrame, white: after.white, luma: after.luma };
    if (out.viaAssetId !== song) return fail('viaAssetId does not name the measured song', evidence.I2);
    return after.white.length === 1 && after.white[0] === beatFrame ? true : fail('the white frame is not alone on the beat frame', evidence.I2);
  },
  /** S7 (integration): through a copy made by the product's local-tool job, the plan route chooses the same removal as on the song, with the copy's offset; apply makes the file from the copy. */
  S7: async () => {
    const pid = await newProject('mf S7');
    const [v] = await videosIn(pid, 1);
    const aba = abaSong();
    const song = await songIn(pid, 'aba-stereo.wav', stereoWithCentre(aba), aba.frames / SR, 120);
    const t = await ownerTx(pid, [{ op: 'add_clip', args: { assetId: v, start: T.ZERO, duration: T.frameTime(660, R), withLinkedAudio: false } }, { op: 'add_clip', args: { assetId: song, start: T.ZERO, sourceIn: T.rt(2, 1), duration: T.sub(T.rt(aba.frames, SR), T.rt(2, 1)) } }]);
    // the clip runs to the song's end: the local tool copies the clip's range only, and the search must see the same song after 2 s
    const music = String(t.results[1]!.output!.clipId);
    const body = { target: { clipId: music }, music: { keep: true }, tailor: true };
    const direct = await plan(pid, body);
    if (!routesBuilt(direct)) return WAIT_ROUTES;
    if (direct.status !== 200) return fail('plan on the song', direct.body);
    const copy = await jobCopy(pid, music);
    if (typeof copy === 'string') return copy;
    const via = await plan(pid, body);
    if (via.status !== 200) return fail('plan through the copy', via.body);
    const a = removalOf(direct.body as MusicFitPlan), b = removalOf(via.body as MusicFitPlan);
    const off = copy.sourceRangeStart;
    const same = !!a && !!b && T.eq(T.sub(a.from, off), b.from) && T.eq(T.sub(a.to, off), b.to);
    const applied = await apply(pid, body);
    const d = await doc(pid);
    const made = applied.body?.madeAssetId ? d.assets[applied.body.madeAssetId] : undefined;
    evidence.S7 = { offset: T.toSeconds(off), direct: a && [T.toSeconds(a.from), T.toSeconds(a.to)], viaCopy: b && [T.toSeconds(b.from), T.toSeconds(b.to)], similarity: [(direct.body as MusicFitPlan).make, (via.body as MusicFitPlan).make].map((m) => (m.kind === 'fitted' ? m.candidates[m.chosen]!.measured.similarity : null)), apply: applied.status, madeFrom: made?.provenance.fitted?.sourceAssetId ?? null, copyId: copy.copyId };
    if (!same) return fail('through the copy another removal was chosen', evidence.S7);
    if (applied.status !== 200 || made?.provenance.fitted?.sourceAssetId !== copy.copyId) return fail('apply through the copy', evidence.S7);
    return true;
  },
  /** S3 (integration): the plan route on a through-composed song warns join_weak, and no string of the plan (he or en) holds a praise word. */
  S3: async () => {
    const pid = await newProject('mf S3');
    const [v] = await videosIn(pid, 1);
    const th = throughSong();
    const song = await songIn(pid, 'through.wav', stereoWithCentre(th), th.frames / SR, 120);
    const t = await ownerTx(pid, [{ op: 'add_clip', args: { assetId: v, start: T.ZERO, duration: T.frameTime(720, R), withLinkedAudio: false } }, { op: 'add_clip', args: { assetId: song, start: T.ZERO, duration: T.rt(10, 1) } }]);
    const p = await plan(pid, { target: { clipId: String(t.results[1]!.output!.clipId) }, music: { keep: true }, tailor: true });
    if (!routesBuilt(p)) return WAIT_ROUTES;
    if (p.status !== 200) return fail('plan', p.body);
    const fp = p.body as MusicFitPlan, text = JSON.stringify(fp);
    const praise = [MUSICFIT_FORBIDDEN_WORDS.exec(text)?.[0], MUSICFIT_FORBIDDEN_WORDS_HE.exec(text)?.[0]].filter(Boolean);
    evidence.S3 = { warnings: fp.warnings.map((x) => x.code), similarity: fp.make.kind === 'fitted' ? fp.make.candidates[fp.make.chosen]!.measured.similarity : null, praise };
    if (!fp.warnings.some((x) => x.code === 'join_weak')) return fail('the plan does not warn join_weak', evidence.S3);
    return praise.length ? fail('a plan string holds a praise word', evidence.S3) : true;
  },
  /** L3 (integration): the plan and apply ROUTES refuse an already shortened file and a file made from two library files, with the reason and a next step, and nothing is made; a no-derivatives record cannot be stored in a project, so the route's own planner function is asked on a copy of the document. */
  L3: async () => {
    const w = await world();
    const s = await songFit('mf L3', w.songs.by, 'CC-BY-4.0');
    if (typeof s === 'string') return s;
    const music = s.clipId, before = await rev(s.pid), blobs = () => fs.readdirSync(path.join(w.dir, 'data', 'blobs'), { recursive: true }).length, b0 = blobs();
    // (a) the made file again: already shortened
    const again = await plan(s.pid, { target: { clipId: music }, music: { assetId: s.madeAssetId }, tailor: true });
    const againApply = await apply(s.pid, { target: { clipId: music }, music: { assetId: s.madeAssetId }, tailor: true });
    const madeByA = { revisions: (await rev(s.pid)) - before, blobs: blobs() - b0 };
    // (b) a file made from two library files: a derived record over two library songs, stored as a job result would be
    const second = await librarySong(s.pid, w.songs.nc, 'CC-BY-NC-4.0', { nonCommercial: true, diskOnly: true });
    const lib1 = Object.values((await doc(s.pid)).assets).find((a) => a.provenance.library && a.id !== second.assetId && !a.provenance.fitted)!;
    const { id: _i, ...rest } = (await doc(s.pid)).assets[lib1.id]!;
    const mixed = { ...rest, name: 'mix of two library songs.wav', contentHash: `sha256:${'7'.repeat(64)}`, provenance: { origin: 'derived' as const, importedAt: new Date().toISOString(), importedBy: 'proof', derived: { jobId: 'proof_mix', capabilityId: 'proof.mix', capabilityVersion: '1', graphDigest: `sha256:${'0'.repeat(64)}`, params: {}, sourceAssetIds: [lib1.id, second.assetId], outputName: 'mix', outputRole: 'audio', encoding: 'pcm_s16le', provider: { id: 'proof' } } } };
    const mixId = String(w.s.store.commit({ projectId: s.pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: mixed } }] }).results[0]!.output!.assetId);
    await exactBeats(s.pid, mixId, 60);
    const before2 = await rev(s.pid), b1 = blobs();
    const many = await plan(s.pid, { target: { clipId: music }, music: { assetId: mixId }, tailor: true });
    const manyApply = await apply(s.pid, { target: { clipId: music }, music: { assetId: mixId }, tailor: true });
    // (c) no-derivatives: the planner function the route calls, on a copy of the document (a project cannot hold that record)
    const nd = structuredClone(await doc(s.pid));
    (nd.assets[lib1.id]!.provenance.library as LibraryRecord).licence = { id: 'CC-BY-ND-4.0' };
    const ndr = await prepareMusicFit(w.s.store, s.pid, nd, await rev(s.pid), { target: { clipId: music }, music: { assetId: lib1.id }, tailor: true }).then(() => null, (e: { code?: string; message?: string; hint?: string }) => e);
    const row = {
      alreadyFitted: [again.status, codeOf(again.body), again.body?.error?.message, !!again.body?.error?.hint, againApply.status],
      manyOrigins: [many.status, codeOf(many.body), many.body?.error?.message, !!many.body?.error?.hint, manyApply.status],
      noDerivatives: ndr && [ndr.code, ndr.message, !!ndr.hint],
      madeByAlreadyFitted: madeByA, madeByManyOrigins: { revisions: (await rev(s.pid)) - before2, blobs: blobs() - b1 },
    };
    evidence.L3 = row;
    // an operation's refusal (OpError 'incompatible') answers 422 on every route (plan.ts asApiError, as Store.commit reports it)
    const refused = (r: { status: number; body: any }, key: 'alreadyFitted' | 'licenceManyOrigins') => r.status === 422 && codeOf(r.body) === 'incompatible' && r.body?.error?.message === (MUSICFIT_REFUSALS[key].message as () => string)() && !!r.body?.error?.hint;
    if (!refused(again, 'alreadyFitted') || againApply.status !== 422) return fail('an already shortened file was not refused by the routes', row);
    if (!refused(many, 'licenceManyOrigins') || manyApply.status !== 422) return fail('a file made from two library files was not refused by the routes', row);
    if (!ndr || ndr.message !== MUSICFIT_REFUSALS.licenceNoDerivatives.message('CC-BY-ND-4.0') || !ndr.hint) return fail('a no-derivatives record was not refused by the planner', row);
    if (madeByA.revisions || madeByA.blobs || (await rev(s.pid)) !== before2 || blobs() !== b1) return fail('a refusal made something', row);
    return true;
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

/**
 * Integration: host checks that measure what a makers check of the same id could not (its `missing` sentences). The proof entry
 * removes a makers sentence only when the host check of that id passes; `remaining` replaces it with what is still not measured.
 */
export const MUSICFIT_HOST_COVERS: Readonly<Record<string, { drop: string[]; remaining?: string[] }>> = {
  I1: { drop: ['pixels of a server still or an export', 'not measured in exported sound'] },
  I2: { drop: ['not one made by a local-tool job'] },
  S7: { drop: ['not made by a local-tool job'] },
  S3: { drop: ['the join_weak warning itself'], remaining: ['the strings of the editor\'s block, dialog and chip are checked for praise words by U1 (the UI part), not here'] },
  L3: { drop: ['the plan route\'s refusal'] },
};
export const MUSICFIT_PROOF_HOSTS = { checks, evidence } as const;
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
