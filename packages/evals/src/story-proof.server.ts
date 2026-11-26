/**
 * proof:story — the server part (W2): S1–S20 of story-proof.ts (S10 and the two-level S9 are gone with cut 4; S18 is W1's property
 * test; S11's editor half is W3's, in story-proof.ui.ts). One server for every check, started in-process on its own port with the
 * phone door admitted on 127.0.0.1 (as proof:phone-drop's launcher does; no environment variable can set that), in
 * .artifacts/story-proof (deleted when the process exits).
 *
 * Fixtures are synthetic only: the sound files of story-fixtures.ts (tones in bursts over seeded noise, made by ffmpeg here), and
 * pictures made by ffmpeg here: seven solid-colour stills and two solid-colour videos (3 s and 0.2 s), each picture told apart by
 * the mean colour of a corner block of a rendered or exported frame (nearest colour of the palette below; a picture's identity is
 * all a cut check needs), and a 3 kHz tone (and a 2 kHz one) as music. Never a real voice or family media.
 * Every expected number is typed from the fixture's design (story-fixtures.ts NARRATION_BURSTS, NARRATION_RANGES) or computed here
 * independently (a tap's frame = round(ms · num / (1000 · den)) in integers), never read back from the code under test.
 * A check returns true or the sentence that says why it failed; "BLOCKED: …" when it could not run here (it proves nothing).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { flashGapFrames, STORY_RUN_RECIPE_ID, type ProjectDocument } from '@pulseframe/core';
import { startServer, type RunningServer } from '@pulseframe/server';
import { makeStoryFixtures, NARRATION_BURSTS, NARRATION_RANGES, NARRATION_SECONDS, type StoryFixtureName } from './story-fixtures.ts';
import type { StoryProofPart } from './story-proof.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/story-proof');
/** The phone door's port, read from the code the door issues (it binds a free port while a code is live: dropPort 0). */
let doorPort = 0;
const DOOR = '127.0.0.1';
const W = 640, H = 360;
const R30 = { num: 30, den: 1 }, R25 = { num: 25, den: 1 }, R2997 = { num: 30000, den: 1001 };
/** The pictures: solid colours, far apart in RGB. */
const PALETTE: Record<string, [number, number, number]> = {
  's0.png': [220, 30, 30], 's1.png': [30, 200, 30], 's2.png': [30, 30, 220], 's3.png': [230, 230, 30], 's4.png': [220, 30, 220], 's5.png': [30, 220, 220], 's6.png': [250, 250, 250],
  'v3.mp4': [240, 140, 20], 'vshort.mp4': [120, 120, 120],
};
const hex = (c: readonly number[]) => `0x${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 2 ** 30, ...(input ? { input } : {}) });
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const j = (v: unknown) => JSON.stringify(v).slice(0, 700);
/** A tap's project frame, computed here: round(ms · num / (1000 · den)), exact integers (no tap of this proof lies on a half frame). */
const frameOfMs = (ms: number, r: { num: number; den: number }) => { const n = ms * r.num, d = 1000 * r.den; return Math.floor((2 * n + d) / (2 * d)); };
/** The project frame a rational start sits on, or null when it is not on a frame. */
const frameOfTime = (t: T.RationalTime, r: { num: number; den: number }): number | null => {
  const num = BigInt(t.value) * BigInt(r.num), den = BigInt(t.timescale) * BigInt(r.den);
  return num % den === 0n ? Number(num / den) : null;
};
/** Mono float samples at 48 kHz of a file's first sound stream, through an optional ffmpeg filter. */
const pcm = (file: string, af?: string) => { const b = ff(['-i', file, '-map', '0:a:0', ...(af ? ['-af', af] : []), '-ac', '1', '-ar', '48000', '-f', 'f32le', '-']); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.length & ~3))); };
const rmsDb = (x: Float32Array, fromS: number, toS: number) => { let s = 0, n = 0; for (let i = Math.max(0, Math.round(fromS * 48000)); i < Math.min(x.length, Math.round(toS * 48000)); i++) { s += x[i]! * x[i]!; n++; } return n ? 10 * Math.log10(s / n + 1e-20) : -200; };
const BAND_3K = 'bandpass=f=3000:width_type=h:w=300,bandpass=f=3000:width_type=h:w=300';
/** The picture a frame shows: the palette colour nearest to the mean of a 40×40 block at (20, 20) (clear of a centred title). */
function pictureOf(rgb: Buffer, w: number): { name: string; rgb: number[]; distance: number } {
  const sum = [0, 0, 0];
  for (let y = 20; y < 60; y++) for (let x = 20; x < 60; x++) for (let c = 0; c < 3; c++) sum[c]! += rgb[(y * w + x) * 3 + c]!;
  const mean = sum.map((v) => Math.round(v / 1600));
  let best = '', d = Infinity;
  for (const [name, col] of Object.entries(PALETTE)) { const e = Math.hypot(col[0] - mean[0]!, col[1] - mean[1]!, col[2] - mean[2]!); if (e < d) { d = e; best = name; } }
  return { name: best, rgb: mean, distance: Math.round(d) };
}
const pngRgb = (png: Buffer) => ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png);
const videoFrames = (file: string, frames: number[]) => { const sel = frames.map((n) => `eq(n\\,${n})`).join('+'); const raw = ff(['-i', file, '-vf', `select='${sel}'`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']); const per = W * H * 3; return frames.map((_, i) => raw.subarray(i * per, (i + 1) * per)); };

// ---------------------------------------------------------------------------------------------------------------------------
// One server and the fixtures, made once for every check
// ---------------------------------------------------------------------------------------------------------------------------
type Res = { status: number; body: any };
interface Env {
  s: RunningServer; fx: Record<StoryFixtureName, string>; pics: Record<string, string>; music: string; music2: string; rendered: boolean;
  call(p: string, body?: unknown, token?: string | null, method?: string): Promise<Res>;
  owner(p: string, body?: unknown): Promise<Res>;
  grant(mode: string, extra?: Record<string, unknown>): Promise<string>;
}
let envPromise: Promise<Env> | null = null;
let server: RunningServer | null = null;
process.once('exit', () => { try { fs.rmSync(art, { recursive: true, force: true }); } catch { /* best effort */ } });
const env = () => (envPromise ??= makeEnv());
async function makeEnv(): Promise<Env> {
  fs.rmSync(art, { recursive: true, force: true });
  const fxDir = path.join(art, 'fixtures');
  const fx = makeStoryFixtures(fxDir);
  const pics: Record<string, string> = {};
  for (const [name, col] of Object.entries(PALETTE)) {
    const out = path.join(fxDir, name);
    if (name.endsWith('.png')) ff(['-y', '-f', 'lavfi', '-i', `color=c=${hex(col)}:s=${W}x${H}`, '-frames:v', '1', out]);
    else ff(['-y', '-f', 'lavfi', '-i', `color=c=${hex(col)}:s=${W}x${H}:r=30:d=${name === 'v3.mp4' ? 3 : 0.2}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out]);
    pics[name] = out;
  }
  const music = path.join(fxDir, 'music-3k.wav'), music2 = path.join(fxDir, 'music-2k.wav');
  ff(['-y', '-f', 'lavfi', '-i', 'sine=f=3000:d=30:sample_rate=48000', '-ac', '1', '-c:a', 'pcm_s16le', music]);
  ff(['-y', '-f', 'lavfi', '-i', 'sine=f=2000:d=30:sample_rate=48000', '-ac', '1', '-c:a', 'pcm_s16le', music2]);
  const webDist = path.join(root, 'apps/web/dist');
  const s = await startServer({ port: 0, dataDir: path.join(art, 'data'), webDist, homeZone: 'Asia/Jerusalem', dropPort: 0, dropAdmitAddresses: [DOOR] });
  server = s;
  process.once('beforeExit', () => { void s.close(); });
  const ownerCookie = (await fetch(`${s.url}/api/v1/session`, { headers: { origin: s.url, connection: 'close', 'x-pf-owner-key': s.auth.tokens.owner } })).headers.get('set-cookie')!.split(';')[0]!;
  const request = async (p: string, headers: Record<string, string>, body?: unknown, method?: string): Promise<Res> => {
    const r = await fetch(`${s.url}${p.startsWith('/mcp') ? '' : '/api/v1'}${p}`, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { connection: 'close', ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  const call: Env['call'] = (p, body, token = s.auth.tokens.agent, method) => request(p, token ? { authorization: `Bearer ${token}` } : {}, body, method);
  const owner: Env['owner'] = (p, body) => request(p, { origin: s.url, cookie: ownerCookie }, body);
  const grant: Env['grant'] = async (mode, extra = {}) => { const r = await owner('/grants', { name: `story-${mode}-${Math.random().toString(36).slice(2, 8)}`, mode, ...extra }); if (r.status !== 201) throw new Error(`grant: ${r.status} ${j(r.body)}`); return r.body.token as string; };
  return { s, fx, pics, music, music2, rendered: fs.existsSync(path.join(webDist, 'render.html')), call, owner, grant };
}

// ---------- helpers on the server ----------
const must = async (e: Env, p: string, body?: unknown, want = [200, 201], token?: string | null): Promise<any> => { const r = await e.call(p, body, token); if (!want.includes(r.status)) throw new Fail(`${p} → ${r.status} ${j(r.body?.error ?? r.body)}`, r); return r.body; };
class Fail extends Error { constructor(m: string, public res?: Res) { super(m); } }
const getDoc = async (e: Env, pid: string): Promise<ProjectDocument> => (await must(e, `/projects/${pid}`)).project;
const docHash = async (e: Env, pid: string) => sha(JSON.stringify(await getDoc(e, pid)));
const revision = async (e: Env, pid: string): Promise<number> => (await must(e, `/projects/${pid}`)).revision;
const tx = (e: Env, pid: string, ops: unknown[]) => must(e, `/projects/${pid}/transactions`, { ops });
async function upload(e: Env, pid: string, file: string): Promise<string> {
  const r = await fetch(`${e.s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { authorization: `Bearer ${e.s.auth.tokens.agent}`, connection: 'close', 'x-filename': encodeURIComponent(path.basename(file)) }, body: new Uint8Array(fs.readFileSync(file)) });
  const b = (await r.json()) as any;
  if (!b.assetId) throw new Error(`upload of ${path.basename(file)}: ${r.status} ${j(b)}`);
  return b.assetId as string;
}
/** Waits until the asset's waveform row is ready (the import queues it), so a check measures, not the 5 s wait. */
async function waveformReady(e: Env, pid: string, assetId: string, ms = 120_000) {
  const t0 = Date.now();
  for (;;) {
    const r = await must(e, `/projects/${pid}/assets/${assetId}/derivatives`);
    const w = r.derivatives.find((d: any) => d.kind === 'waveform');
    if (w?.status === 'ready') return;
    if (w?.status === 'failed' || w?.status === 'not-applicable') throw new Error(`waveform ${w.status}: ${w.error ?? ''}`);
    if (Date.now() - t0 > ms) throw new Error('waveform not ready in time');
    await sleep(100);
  }
}
const waitJob = async (e: Env, id: string, ms = 900_000) => { const t0 = Date.now(); for (;;) { const job = (await e.call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled', 'refused'].includes(job.status)) return job; if (Date.now() - t0 > ms) throw new Error(`job ${id} did not finish`); await sleep(150); } };
let exportsN = 0;
async function exportFile(e: Env, pid: string, options: Record<string, unknown>, ext: string): Promise<string> {
  const st = await e.call(`/projects/${pid}/exports`, options);
  if (st.status !== 202) throw new Error(`export refused ${st.status}: ${j(st.body?.error ?? st.body)}`);
  const job = await waitJob(e, st.body.jobId);
  if (job.status !== 'succeeded') throw new Error(`export ${job.status}: ${j(job.error)}`);
  const file = path.join(art, `export-${++exportsN}.${ext}`);
  fs.writeFileSync(file, (await e.call(`/jobs/${job.id}/output`)).body as Buffer);
  return file;
}
async function stillOf(e: Env, pid: string, n: number) { const r = await e.call(`/projects/${pid}/frame?index=${n}`); if (r.status !== 200) throw new Error(`frame ${n} → ${r.status} ${j(r.body?.error ?? '')}`); return pictureOf(pngRgb(r.body as Buffer), W); }

interface Story { pid: string; narration: string; ids: Record<string, string>; nameOf: (assetId: string) => string; rate: { num: number; den: number } }
/** A new project with the narration (waveform ready) and the named pictures uploaded in this order. */
async function storyProject(e: Env, name: string, opts: { rate?: { num: number; den: number }; narration?: StoryFixtureName; pictures?: string[]; extra?: string[] } = {}): Promise<Story> {
  const rate = opts.rate ?? R30;
  const pid = (await must(e, '/projects', { name, width: W, height: H, frameRate: rate })).project.id as string;
  const narration = await upload(e, pid, e.fx[opts.narration ?? 'narration.wav']);
  const ids: Record<string, string> = {};
  for (const p of [...(opts.pictures ?? []), ...(opts.extra ?? [])]) ids[p] = p.startsWith('music') ? await upload(e, pid, p === 'music-2k.wav' ? e.music2 : e.music) : await upload(e, pid, e.pics[p]!);
  await waveformReady(e, pid, narration);
  return { pid, narration, ids, rate, nameOf: (a) => Object.keys(ids).find((k) => ids[k] === a) ?? (a === narration ? 'narration' : a) };
}
const plan = (e: Env, st: Story, params: Record<string, unknown>, token?: string | null) => e.call(`/projects/${st.pid}/recipes/story/plan`, { params: { narrationAssetId: st.narration, ...params } }, token);
const apply = (e: Env, st: Story, params: Record<string, unknown>, token?: string | null) => e.call(`/projects/${st.pid}/recipes/story/apply`, { params: { narrationAssetId: st.narration, ...params } }, token);
const needOk = (r: Res, what: string) => { if (r.status !== 200) throw new Fail(`${what} → ${r.status} ${j(r.body?.error ?? r.body)}`, r); return r.body; };

type Placed = { slot: { key: string; kind: string; clipId: string }; clip: any; track: any; name: string; startFrame: number | null; endFrame: number | null };
/** The story's clips by role from the document's run, sorted by start. */
interface StoryClips { run: any; pictures: Placed[]; narration: Placed | null; music: Placed | null; find: (id: string) => { clip: any; track: any } | null }
function storyOf(d: ProjectDocument, runId: string, st: Story): StoryClips {
  const run = d.recipeRuns[runId] as any;
  const tracks = Object.values(d.sequences).flatMap((q) => q.tracks);
  const find = (id: string) => { for (const t of tracks) { const c = t.clips.find((x: any) => x.id === id); if (c) return { clip: c as any, track: t }; } return null; };
  const placed: Placed[] = (run?.slots ?? []).flatMap((slot: any): Placed[] => { const f = find(slot.clipId); return f ? [{ slot, ...f, name: f.clip.type === 'media' ? st.nameOf(f.clip.assetId) : slot.kind, startFrame: frameOfTime(f.clip.start, st.rate), endFrame: frameOfTime(T.add(f.clip.start, f.clip.duration), st.rate) }] : []; });
  const pictures = placed.filter((p: Placed) => p.slot.kind === 'picture').sort((a: Placed, b: Placed) => T.cmp(a.clip.start, b.clip.start));
  const narration = placed.find((p: Placed) => p.slot.kind === 'sound' && p.clip.type === 'media' && p.clip.assetId === st.narration) ?? null;
  const music = placed.find((p: Placed) => p.slot.kind === 'music') ?? null;
  return { run, pictures, narration, music, find };
}
/** Runs a check; a refusal because a core part is not built yet is said as such (it waits for W1), never as a pass. */
async function guarded(fn: (e: Env) => Promise<true | string>): Promise<true | string> {
  let e: Env;
  try { e = await env(); } catch (x) { return `BLOCKED: the proof's server or fixtures could not be made here: ${(x as Error).message}`; }
  try { return await fn(e); } catch (x) {
    const res = x instanceof Fail ? x.res : undefined;
    if (res?.body?.error?.code === 'story_not_built') return `waits for W1 (story_not_built: ${j(res.body.error.details ?? {})}): ${(x as Error).message}`;
    return `error: ${(x as Error).message}`;
  }
}
const fails = (list: (string | false | null | undefined)[]): true | string => { const f = list.filter((x): x is string => typeof x === 'string'); return f.length ? f.join('; ') : true; };
const secs = (samples: number) => samples / 48000;

// ---------------------------------------------------------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------------------------------------------------------
/** S1/S1b: the four measured ranges against the fixture's bursts. */
async function rangesCheck(e: Env, fixture: StoryFixtureName): Promise<true | string> {
  const st = await storyProject(e, `S1 ${fixture}`, { narration: fixture, pictures: ['s0.png'] });
  const v = needOk(await plan(e, st, { assetIds: [st.ids['s0.png']] }), 'plan');
  const voice = v.context?.voice;
  if (v.context?.voiceState !== 'measured' || !voice) return `voiceState ${v.context?.voiceState}, voice ${j(voice)}`;
  const ranges = (voice.ranges as { start: number; end: number }[]).map((r) => [secs(r.start), secs(r.end)] as const);
  const out: (string | null)[] = [];
  if (voice.flat) out.push('measured flat');
  if (ranges.length !== NARRATION_RANGES.length) out.push(`${ranges.length} ranges, want ${NARRATION_RANGES.length}: ${j(ranges)}`);
  NARRATION_RANGES.forEach(([a, b], i) => {
    const r = ranges[i];
    if (!r) return;
    const lead = a - r[0], tail = r[1] - b;
    if (lead < 0 || lead > 0.090) out.push(`range ${i} starts ${(lead * 1000).toFixed(1)} ms before its burst (want 0–90)`);
    if (tail < 0 || tail > 0.150) out.push(`range ${i} ends ${(tail * 1000).toFixed(1)} ms after its burst (want 0–150)`);
  });
  for (const [x, y] of ranges) for (const edge of [x, y]) for (const [a, b] of NARRATION_BURSTS) if (edge > a && edge < b) out.push(`edge ${edge.toFixed(3)} s inside the burst ${a}–${b}`);
  const fourth = ranges[3];
  if (!fourth || !(fourth[0] <= 18.0 && fourth[1] >= 18.3)) out.push(`the 0.3 s pause (18.0–18.3) is not inside the fourth range ${j(fourth)}`);
  return fails(out);
}

export const STORY_PROOF_SERVER: StoryProofPart = {
  built: true,
  checks: {
    S1: () => guarded((e) => rangesCheck(e, 'narration.wav')),
    S1b: () => guarded((e) => rangesCheck(e, 'gated.wav')),

    S2: () => guarded(async (e) => {
      const pics = ['s0.png', 's1.png', 's2.png', 's3.png'];
      const st = await storyProject(e, 'S2 flat', { narration: 'flat.wav', pictures: pics });
      const v = needOk(await plan(e, st, { assetIds: pics.map((p) => st.ids[p]) }), 'plan');
      const w = (v.warnings as any[]).find((x) => x.code === 'voice_flat');
      const levels = w ? Object.values(w.details ?? {}).filter((x) => typeof x === 'number') : [];
      const hows = (v.picks as any[]).filter((p) => p.how !== 'first').map((p) => p.how);
      return fails([
        v.context?.voice?.flat !== true && `not flat: ${j(v.context?.voice)}`,
        (v.context?.voice?.ranges?.length ?? -1) !== 0 && `ranges ${j(v.context?.voice?.ranges)}`,
        !w && `no voice_flat warning: ${j(v.warnings)}`,
        w && levels.length < 2 && `voice_flat does not give both levels: ${j(w)}`,
        (hows.length !== pics.length - 1 || hows.some((h) => h !== 'even')) && `automatic cuts not all even: ${j(hows)}`,
      ]);
    }),

    S2b: () => guarded(async (e) => {
      // a sound file whose waveform is held back: its row stays 'running' (written into the server's own database, as a long
      // queue would leave it), so the plan must stop waiting after STORY.waitWaveformMs and answer voice_pending
      const pid = (await must(e, '/projects', { name: 'S2b pending', width: W, height: H, frameRate: R30 })).project.id as string;
      const hash = `sha256:${sha('story-proof held waveform')}`;
      const r0 = e.s.store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: { kind: 'audio', name: 'held.wav', contentHash: hash, byteSize: 1000, container: 'wav', mimeType: 'audio/wav', duration: T.rt(24, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: { origin: 'fixture', importedAt: '2026-11-25T00:00:00.000Z', importedBy: 'story-proof' } } } }] });
      const narration = r0.results[0]!.output!.assetId as string;
      e.s.store.db.prepare("INSERT OR REPLACE INTO derivatives (asset_hash, kind, status, updated_at) VALUES (?, 'waveform', 'running', ?)").run(hash, new Date().toISOString());
      const still = await upload(e, pid, e.pics['s0.png']!);
      const t0 = Date.now();
      const r = await e.call(`/projects/${pid}/recipes/story/plan`, { params: { narrationAssetId: narration, assetIds: [still] } });
      const took = Date.now() - t0;
      const v = needOk(r, 'plan');
      return fails([
        took > 6000 && `answered after ${took} ms (want within 6 s)`,
        v.context?.voiceState !== 'pending' && `voiceState ${v.context?.voiceState}`,
        !(v.warnings as any[]).some((w) => w.code === 'voice_pending') && `no voice_pending warning: ${j(v.warnings)}`,
      ]);
    }),

    S3: () => guarded(async (e) => {
      const taps = [2000, 4110, 7777, 12345, 19001];
      const pics = ['s0.png', 's1.png', 's2.png', 's3.png', 's4.png', 's5.png'];
      const out: (string | false)[] = [];
      for (const [label, rate] of [['25', R25], ['29.97', R2997], ['30', R30]] as const) {
        const st = await storyProject(e, `S3 ${label} fps`, { rate, pictures: pics });
        const a = needOk(await apply(e, st, { assetIds: pics.map((p) => st.ids[p]), cutsMs: taps, openingTitle: false }), `apply at ${label}`);
        const story = storyOf(await getDoc(e, st.pid), a.runId, st);
        const end = frameOfMs(NARRATION_SECONDS * 1000, rate);
        const starts = story.pictures.map((p) => p.startFrame), want = [0, ...taps.map((t) => frameOfMs(t, rate))];
        if (JSON.stringify(story.pictures.map((p) => p.name)) !== JSON.stringify(pics)) out.push(`${label}: pictures out of order ${j(story.pictures.map((p) => p.name))}`);
        if (JSON.stringify(starts) !== JSON.stringify(want)) out.push(`${label}: starts ${j(starts)}, want ${j(want)}`);
        if (story.narration?.startFrame !== 0) out.push(`${label}: the narration starts at ${story.narration?.startFrame}`);
        if (story.pictures.at(-1)?.endFrame !== end) out.push(`${label}: the last picture ends at ${story.pictures.at(-1)?.endFrame}, the narration at ${end}`);
        const sum = story.pictures.reduce((acc, p) => T.add(acc, p.clip.duration), T.ZERO);
        if (frameOfTime(sum, rate) !== end) out.push(`${label}: the lengths add up to ${T.toSeconds(sum)} s, not ${end} frames`);
        story.pictures.slice(1).forEach((p, i) => { if (!T.eq(p.clip.start, T.add(story.pictures[i]!.clip.start, story.pictures[i]!.clip.duration))) out.push(`${label}: a gap or overlap before picture ${i + 1}`); });
      }
      return fails(out);
    }),

    S4: () => guarded(async (e) => {
      const pics = ['s0.png', 's1.png', 's2.png'];
      const st = await storyProject(e, 'S4 undo', { pictures: pics });
      const before = await docHash(e, st.pid), rev = await revision(e, st.pid);
      const a = needOk(await apply(e, st, { assetIds: pics.map((p) => st.ids[p]), cutsMs: [6000, 15000] }), 'apply');
      const applied = await docHash(e, st.pid), rev1 = await revision(e, st.pid);
      const u = await e.call(`/projects/${st.pid}/undo`, {});
      const undone = await docHash(e, st.pid);
      const d = await getDoc(e, st.pid);
      const rd = await e.call(`/projects/${st.pid}/redo`, {});
      const redone = await docHash(e, st.pid);
      return fails([
        (rev1 !== rev + 1 || a.revision !== rev1) && `revision ${rev} → ${rev1} (answer ${a.revision})`,
        u.status !== 200 && `undo → ${u.status}`, undone !== before && 'one undo does not return the exact document',
        !Object.hasOwn(d.assets, st.narration) && 'the recording left the library on undo',
        rd.status !== 200 && `redo → ${rd.status}`, redone !== applied && 'redo does not return the applied document',
      ]);
    }),

    S5: () => guarded(async (e) => {
      const pics = ['s0.png', 's1.png', 's2.png', 's3.png', 's4.png', 's5.png'];
      const st = await storyProject(e, 'S5 no taps', { pictures: pics });
      const v = needOk(await plan(e, st, { assetIds: pics.map((p) => st.ids[p]) }), 'plan');
      const cuts = (v.picks as any[]).filter((p) => p.how !== 'first').map((p) => ({ ms: p.cutMs as number, how: p.how as string }));
      // typed from the fixture: even boundaries of 24 s in six parts are 4, 8, 12, 16, 20 s; reach = min(4 s / 3, 1.5 s); the onsets
      // are the range starts 0.5, 4.5, 8.2, 15.0 s (a pause cut lies on an onset: up to 90 ms before its burst)
      const want = [{ t: 4.5, how: 'pause' }, { t: 8.2, how: 'pause' }, { t: 12, how: 'even' }, { t: 15.0, how: 'pause' }, { t: 20, how: 'even' }];
      const out = want.map((w, i) => {
        const c = cuts[i];
        const tol = w.how === 'pause' ? [-90, 1] : [-34, 34];
        return !c || c.how !== w.how || c.ms - w.t * 1000 < tol[0]! || c.ms - w.t * 1000 > tol[1]! ? `cut ${i + 1}: ${j(c)}, want ${w.how} near ${w.t} s` : null;
      });
      return fails([cuts.length !== 5 && `${cuts.length} cuts: ${j(cuts)}`, ...out]);
    }),

    S6: () => guarded(async (e) => {
      const gap = flashGapFrames(30);
      const four = ['s0.png', 's1.png', 's2.png', 's3.png'];
      const st = await storyProject(e, 'S6 held', { pictures: four });
      // 2100 is 3 frames after 2000 (closer than the gap); 30000 is after the 24 s narration
      const a = needOk(await plan(e, st, { assetIds: four.map((p) => st.ids[p]), cutsMs: [2000, 2100, 9000, 30000] }), 'plan A');
      const chipA = Object.fromEntries((a.chips as any[]).map((c) => [c.cutMs, c]));
      // two pictures, three taps: the taps beyond the last picture have no picture left
      const b = needOk(await plan(e, st, { assetIds: [st.ids['s0.png'], st.ids['s1.png']], cutsMs: [3000, 9000, 15000] }), 'plan B');
      const chipB = Object.fromEntries((b.chips as any[]).map((c) => [c.cutMs, c]));
      const closer = (cuts: number[]) => cuts.some((c, i) => i > 0 && c - cuts[i - 1]! < gap) || (cuts[0] !== undefined && cuts[0] < gap);
      return fails([
        chipA[2000]?.state !== 'kept' && `2000: ${j(chipA[2000])}`,
        (chipA[2100]?.state !== 'held' || chipA[2100]?.reason !== 'too_close') && `2100: ${j(chipA[2100])}`,
        chipA[9000]?.state !== 'kept' && `9000: ${j(chipA[9000])}`,
        (chipA[30000]?.state !== 'held' || chipA[30000]?.reason !== 'outside_narration') && `30000: ${j(chipA[30000])}`,
        chipB[3000]?.state !== 'kept' && `B 3000: ${j(chipB[3000])}`,
        [9000, 15000].some((t) => chipB[t]?.reason !== 'no_picture_left') && `B: ${j(b.chips)}`,
        closer(a.predicted.cuts) && `plan A has cuts closer than ${gap} frames: ${j(a.predicted.cuts)}`,
        closer(b.predicted.cuts) && `plan B has cuts closer than ${gap} frames: ${j(b.predicted.cuts)}`,
      ]);
    }),

    S7: () => guarded(async (e) => {
      const pics = ['s0.png', 'v3.mp4', 's1.png'];
      const st = await storyProject(e, 'S7 short video', { pictures: [...pics, 'vshort.mp4'] });
      const a = needOk(await apply(e, st, { assetIds: [...pics, 'vshort.mp4'].map((p) => st.ids[p]), cutsMs: [3000, 9000], openingTitle: false }), 'apply');
      const story = storyOf(await getDoc(e, st.pid), a.runId, st);
      const v3 = story.pictures.find((p) => p.name === 'v3.mp4'), next = story.pictures.find((p) => p.name === 's1.png');
      const note = (a.warnings as any[]).find((w) => w.code === 'clip_ended_early');
      const excluded = (a.excluded as any[]).find((x) => x.assetId === st.ids['vshort.mp4']);
      const out: (string | false)[] = [
        (!v3 || v3.startFrame !== 90 || v3.endFrame !== 180) && `the 3 s video lies at ${v3?.startFrame}–${v3?.endFrame} (want 90–180: whole, from the 3 s tap)`,
        (!next || next.startFrame !== v3?.endFrame) && `the next picture starts at ${next?.startFrame}, the video ends at ${v3?.endFrame}`,
        (!note || !/\b3(\.0)?\b/.test(`${note.message} ${j(note.details)}`)) && `no clip_ended_early note with the seconds: ${j(note)}`,
        excluded?.code !== 'too_short' && `the 0.2 s video is not left out too_short: ${j(a.excluded)}`,
      ];
      if (!e.rendered) return fails([...out, 'BLOCKED (rendered frames): the web bundle is missing; run pnpm build']);
      if (v3?.endFrame != null) {
        const got = [];
        for (const n of [v3.endFrame - 1, v3.endFrame, v3.endFrame + 1]) got.push((await stillOf(e, st.pid, n)).name);
        if (JSON.stringify(got) !== JSON.stringify(['v3.mp4', 's1.png', 's1.png'])) out.push(`rendered frames across the cut show ${j(got)}`);
      }
      return fails(out);
    }),

    S8: () => guarded(async (e) => {
      if (!e.rendered) return 'BLOCKED: the web bundle is missing (the export renders through it); run pnpm build';
      const pics = ['s0.png', 's1.png', 's2.png', 's3.png'];
      const st = await storyProject(e, 'S8 export', { pictures: pics });
      const a = needOk(await apply(e, st, { assetIds: pics.map((p) => st.ids[p]), cutsMs: [4500, 8200, 15000], openingTitle: false }), 'apply');
      const story = storyOf(await getDoc(e, st.pid), a.runId, st);
      const file = await exportFile(e, st.pid, {}, 'mp4');
      const x = pcm(file);
      let first = 0; while (first < x.length && Math.abs(x[first]!) < 0.05) first++;
      const planned = (story.narration?.startFrame ?? 0) / 30 + NARRATION_BURSTS[0]![0];
      const errMs = (first / 48000 - planned) * 1000;
      const cuts = story.pictures.slice(1).map((p) => p.startFrame!);
      const frames = videoFrames(file, cuts.flatMap((c) => [c - 1, c]));
      const seen = cuts.map((c, i) => ({ cut: c, before: pictureOf(frames[2 * i]!, W).name, after: pictureOf(frames[2 * i + 1]!, W).name, want: [story.pictures[i]!.name, story.pictures[i + 1]!.name] }));
      return fails([
        Math.abs(errMs) > 2 && `the first burst starts ${errMs.toFixed(2)} ms from its planned time`,
        ...seen.map((s) => (s.before !== s.want[0] || s.after !== s.want[1]) && `cut at ${s.cut}: frames show ${s.before} → ${s.after}, want ${s.want.join(' → ')}`),
      ]);
    }),

    // S9 and S13 share one project: the ducked mix, the same mix with ducking off, and the mix after set_transcript
    S9: () => guarded(async (e) => (await duckChecks(e)).s9),
    S13: () => guarded(async (e) => (await duckChecks(e)).s13),

    S11: () => guarded(async (e) => {
      const pics = ['s0.png', 's1.png', 's2.png', 's3.png', 's4.png', 's5.png'];
      const st = await storyProject(e, 'S11 hand edits', { pictures: pics, extra: ['s6.png', 'music-3k.wav', 'music-2k.wav'] });
      const t = await e.grant('edit');
      const a = needOk(await apply(e, st, { assetIds: pics.map((p) => st.ids[p]), cutsMs: [3000, 6000, 9000, 12000, 16000], musicAssetId: st.ids['music-3k.wav'], openingTitle: false }, t), 'apply');
      const d0 = await getDoc(e, st.pid);
      const s0 = storyOf(d0, a.runId, st);
      const byName = (n: string) => s0.pictures.find((p) => p.name === n)!;
      const [p2, p3, p4] = [byName('s1.png'), byName('s2.png'), byName('s3.png')];
      // trim 3 (its start one second later), replace 4 with another still, Delete 2 with ripple (the later pictures close the gap)
      await must(e, `/projects/${st.pid}/transactions`, { ops: [{ op: 'trim_clip', args: { clipId: p3.clip.id, edge: 'start', to: T.add(p3.clip.start, T.rt(1, 1)) } }] }, [200], t);
      await must(e, `/projects/${st.pid}/transactions`, { ops: [{ op: 'replace_clip_media', args: { clipId: p4.clip.id, assetId: st.ids['s6.png'] } }] }, [200], t);
      await must(e, `/projects/${st.pid}/transactions`, { ops: [{ op: 'ripple_delete_clips', args: { clipIds: [p2.clip.id] } }] }, [200], t);
      const d1 = await getDoc(e, st.pid);
      const s1 = storyOf(d1, a.runId, st);
      const kept3 = JSON.stringify(s1.find(p3.clip.id)!.clip), kept4 = JSON.stringify(s1.find(p4.clip.id)!.clip);
      const r = needOk(await e.call(`/projects/${st.pid}/recipe-runs/${a.runId}/regenerate`, { params: { musicAssetId: st.ids['music-2k.wav'] } }, t), 'regenerate');
      const d2 = await getDoc(e, st.pid);
      const s2 = storyOf(d2, a.runId, st);
      const picked = new Map<string, number | null>((s2.run.params.picked as any[]).concat(s2.run.params.removedPicks ?? []).map((p) => [p.assetId, p.cutMs]));
      const cutFrame = (assetId: string) => { const ms = picked.get(assetId); return ms == null ? null : frameOfMs(ms, R30) + (s2.narration?.startFrame ?? 0); };
      const keptEnds = new Set(s2.pictures.filter((p) => p.clip.id === p3.clip.id || p.clip.id === p4.clip.id).map((p) => p.endFrame));
      const later = s2.pictures.filter((p) => p.name === 's4.png' || p.name === 's5.png');
      const notBack = later.filter((p) => p.startFrame !== cutFrame(p.clip.assetId) && !keptEnds.has(p.startFrame));
      const end = (s2.narration?.startFrame ?? 0) + 720;
      const holes = (s: StoryClips, from: number) => { const iv = s.pictures.map((p) => [p.startFrame!, p.endFrame!] as const).sort((x, y) => x[0] - y[0]); let reach = from; const h: number[] = []; for (const [x, y] of iv) { if (x > reach) h.push(reach); reach = Math.max(reach, y); } if (reach < end) h.push(reach); return h; };
      const firstCut = cutFrame(st.ids['s1.png']!) ?? 90;
      // restoreRemoved: picture 2 comes back at its recorded cut
      const r2 = needOk(await e.call(`/projects/${st.pid}/recipe-runs/${a.runId}/regenerate`, { params: {}, restoreRemoved: true }, t), 'regenerate restoreRemoved');
      const s3 = storyOf(await getDoc(e, st.pid), a.runId, st);
      const back2 = s3.pictures.find((p) => p.name === 's1.png');
      return fails([
        JSON.stringify(s2.find(p3.clip.id)?.clip) !== kept3 && 'picture 3 (trimmed) is not byte-equal after the rebuild',
        JSON.stringify(s2.find(p4.clip.id)?.clip) !== kept4 && 'picture 4 (replaced) is not byte-equal after the rebuild',
        s2.pictures.some((p) => p.name === 's1.png') && 'picture 2 (deleted) was made again',
        !(r.removed as string[]).includes(p2.slot.key) && `picture 2 is not left out by name: removed ${j(r.removed)}`,
        !(r.warnings as any[]).some((w) => w.code === 'moved_back') && `no moved_back warning: ${j((r.warnings as any[]).map((w) => w.code))}`,
        notBack.length > 0 && `later pictures not on their recorded cuts: ${j(notBack.map((p) => ({ name: p.name, start: p.startFrame, cut: cutFrame(p.clip.assetId) })))}`,
        holes(s2, firstCut).length > 0 && `frames without a picture after the rebuild at ${j(holes(s2, firstCut))}`,
        s2.music?.clip.assetId !== st.ids['music-2k.wav'] && 'the other music is not placed',
        (!back2 || back2.startFrame !== cutFrame(st.ids['s1.png']!)) && `restoreRemoved: picture 2 at ${back2?.startFrame}, its cut ${cutFrame(st.ids['s1.png']!)} (answer ${r2.revision})`,
        // integration: a second rebuild still knows the replaced clip holds picture 4's pick (its old file is not placed again)
        [s2, s3].some((x) => x.pictures.some((p) => p.name === 's3.png')) && 'the file replaced by hand (s3.png) was placed again by a rebuild',
      ]);
    }),

    S12: () => guarded(async (e) => {
      const pics = ['s0.png', 's1.png', 's2.png', 's3.png'];
      const st = await storyProject(e, 'S12 narration moved', { pictures: pics });
      const t = await e.grant('edit');
      const a = needOk(await apply(e, st, { assetIds: pics.map((p) => st.ids[p]), cutsMs: [4500, 8200, 15000], openingTitle: false }, t), 'apply');
      const s0 = storyOf(await getDoc(e, st.pid), a.runId, st);
      const n = s0.narration!.clip;
      const regen = () => e.call(`/projects/${st.pid}/recipe-runs/${a.runId}/regenerate`, { params: {} }, t);
      const undo = () => e.call(`/projects/${st.pid}/undo`, {}, t);
      // dragged 2 s later, rebuilt: every cut exactly 2 s later
      await must(e, `/projects/${st.pid}/transactions`, { ops: [{ op: 'move_clip', args: { clipId: n.id, start: T.add(n.start, T.rt(2, 1)) } }] }, [200], t);
      const moved = needOk(await regen(), 'rebuild after the drag');
      const s1 = storyOf(await getDoc(e, st.pid), a.runId, st);
      const shift = s1.pictures.map((p, i) => (p.startFrame ?? NaN) - (s0.pictures[i]?.startFrame ?? NaN));
      await undo(); await undo();
      // reversed → kept_narration_not_followable; deleted → narration_removed; nothing changes
      await must(e, `/projects/${st.pid}/transactions`, { ops: [{ op: 'set_clip_reverse', args: { clipId: n.id, reverse: true } }] }, [200], t);
      const h1 = await docHash(e, st.pid);
      const rev = await regen();
      const h1b = await docHash(e, st.pid);
      await undo();
      await must(e, `/projects/${st.pid}/transactions`, { ops: [{ op: 'delete_clip', args: { clipId: n.id } }] }, [200], t);
      const h2 = await docHash(e, st.pid);
      const del = await regen();
      const h2b = await docHash(e, st.pid);
      const codeOf = (r: Res) => r.body?.error?.details?.blocking?.[0]?.code;
      return fails([
        (shift.length !== pics.length || shift.some((x) => x !== 60)) && `cuts moved by ${j(shift)} frames (want 60 each); answer ${j(moved.warnings?.map((w: any) => w.code))}`,
        (rev.status !== 409 || rev.body?.error?.code !== 'story_blocked' || codeOf(rev) !== 'kept_narration_not_followable') && `reversed → ${rev.status} ${j(rev.body?.error)}`,
        h1 !== h1b && 'the refused rebuild (reversed) changed the project',
        (del.status !== 409 || del.body?.error?.code !== 'story_blocked' || codeOf(del) !== 'narration_removed') && `deleted → ${del.status} ${j(del.body?.error)}`,
        h2 !== h2b && 'the refused rebuild (deleted) changed the project',
      ]);
    }),

    S14: () => guarded(async (e) => {
      const pics = ['s0.png', 's1.png'];
      const st = await storyProject(e, 'S14 access', { pictures: pics });
      const params = { assetIds: pics.map((p) => st.ids[p]), cutsMs: [9000] };
      const before = await docHash(e, st.pid);
      const observe = await plan(e, st, params, await e.grant('observe'));
      const propose = await apply(e, st, params, await e.grant('propose'));
      const d = await getDoc(e, st.pid);
      const trackId = Object.values(d.sequences)[0]!.tracks[0]!.id;
      const limited = await apply(e, st, params, await e.grant('edit', { trackIds: [trackId] }));
      const ages = await apply(e, st, { ...params, openingText: 'גיל {age:p1}' }, e.s.auth.tokens.agent);
      const none = await apply(e, st, params, null);
      const after = await docHash(e, st.pid);
      return fails([
        observe.status !== 200 && `observe plan → ${observe.status} ${j(observe.body?.error)}`,
        (propose.status !== 403 || propose.body?.error?.code !== 'insufficient_scope') && `propose → ${propose.status} ${j(propose.body?.error)}`,
        (limited.status !== 403 || limited.body?.error?.code !== 'out_of_scope') && `track-limited → ${limited.status} ${j(limited.body?.error)}`,
        (ages.status !== 403 || ages.body?.error?.code !== 'people_scope_required') && `{age:…} without the people scope → ${ages.status} ${j(ages.body?.error)}`,
        none.status !== 401 && `no credential → ${none.status}`,
        before !== after && 'a refused apply changed the project',
      ]);
    }),

    S15: () => guarded(async (e) => {
      const pics = ['s0.png', 's1.png', 's2.png'];
      const st = await storyProject(e, 'S15 MCP', { pictures: pics });
      const params = { narrationAssetId: st.narration, assetIds: pics.map((p) => st.ids[p]), cutsMs: [5000, 12000] };
      const viaRest = needOk(await apply(e, st, params), 'REST apply');
      const recRest = (await getDoc(e, st.pid)).recipeRuns[viaRest.runId] as any;
      await must(e, `/projects/${st.pid}/undo`, {});
      const mcp = async (name: string, args: Record<string, unknown>) => {
        const r = await fetch(`${e.s.url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${e.s.auth.tokens.agent}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', connection: 'close' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }) });
        const text = await r.text();
        const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
        if (msg.error) throw new Error(`MCP ${name}: ${j(msg.error)}`);
        return { isError: msg.result.isError === true, body: JSON.parse(msg.result.content[0].text) };
      };
      const p = await mcp('plan_recipe', { projectId: st.pid, recipeId: 'story', params });
      const m = await mcp('apply_recipe', { projectId: st.pid, recipeId: 'story', params });
      if (p.isError || m.isError) return `MCP refused: ${j(p.isError ? p.body : m.body)}`;
      const recMcp = (await getDoc(e, st.pid)).recipeRuns[m.body.runId] as any;
      const shape = (rec: any) => ({ recipeId: rec?.recipeId, params: rec?.params, steps: rec?.steps, slots: (rec?.slots ?? []).map((s: any) => [s.key, s.kind]) });
      return fails([
        recRest?.recipeId !== STORY_RUN_RECIPE_ID && `REST run recipeId ${recRest?.recipeId}`,
        JSON.stringify(shape(recMcp)) !== JSON.stringify(shape(recRest)) && `MCP run ${j(shape(recMcp))} differs from REST ${j(shape(recRest))}`,
        JSON.stringify(p.body.context) !== JSON.stringify((await plan(e, st, params)).body.context) && 'the MCP plan\'s context differs from the REST plan\'s',
      ]);
    }),

    S16: () => guarded(async (e) => {
      const pid = (await must(e, '/projects', { name: 'S16 phone', width: W, height: H, frameRate: R30 })).project.id as string;
      const still = await upload(e, pid, e.pics['s0.png']!);
      const code = await e.owner(`/projects/${pid}/drop`, { address: DOOR });
      if (code.status !== 201) return `BLOCKED: the phone door could not open here: ${code.status} ${j(code.body)}`;
      doorPort = Number(code.body.drop.port);
      const token = String(code.body.drop.url).slice(String(code.body.drop.url).indexOf('#') + 1);
      const hello = await door('POST', '/hello', { 'content-type': 'application/json' }, Buffer.from(JSON.stringify({ token })));
      const session = hello.json?.session;
      if (!session) return `hello → ${hello.status} ${j(hello.json)}`;
      const up = await door('POST', '/upload', { authorization: `Bearer ${session}`, 'x-filename': encodeURIComponent('narration.m4a') }, fs.readFileSync(e.fx['narration.m4a']));
      await door('POST', '/bye', { authorization: `Bearer ${session}` }, Buffer.alloc(0));
      if (up.status !== 201) return `upload → ${up.status} ${j(up.json)}`;
      let asset: any = null;
      for (let i = 0; i < 1200 && !asset; i++) { const d = await getDoc(e, pid); asset = Object.values(d.assets).find((x: any) => x.name === 'narration.m4a') ?? null; if (!asset) await sleep(100); }
      if (!asset) return 'the phone\'s file did not reach the library';
      await waveformReady(e, pid, asset.id);
      const a = await e.call(`/projects/${pid}/recipes/story/apply`, { params: { narrationAssetId: asset.id, assetIds: [still] } });
      return fails([
        asset.kind !== 'audio' && `the phone's file is a ${asset.kind}`,
        asset.provenance?.upload?.via !== 'phone' && `provenance ${j(asset.provenance?.upload)}`,
        a.status !== 200 && `a story on it → ${a.status} ${j(a.body?.error)}`,
      ]);
    }),

    S19: () => guarded(async (e) => {
      const pics = ['s0.png', 's1.png', 's2.png'];
      const st = await storyProject(e, 'S19 retap', { pictures: pics });
      const a = needOk(await apply(e, st, { assetIds: pics.map((p) => st.ids[p]), cutsMs: [5000, 12000] }), 'apply');
      const before = await docHash(e, st.pid);
      const r = await e.call(`/projects/${st.pid}/recipe-runs/${a.runId}/regenerate`, { params: { cutsMs: [5000, 13000] } });
      const after = await docHash(e, st.pid);
      return fails([
        (r.status !== 409 || r.body?.error?.code !== 'story_retap_not_built') && `→ ${r.status} ${j(r.body?.error)}`,
        before !== after && 'the hash changed',
      ]);
    }),

    S20: () => guarded(async (e) => {
      const pics = ['s0.png', 's1.png', 's2.png'];
      const st = await storyProject(e, 'S20 stale', { pictures: pics });
      const film = await e.call(`/projects/${st.pid}/recipes/family-film/apply`, { params: { assetIds: pics.map((p) => st.ids[p]) } });
      if (film.status !== 200) return `family film apply → ${film.status} ${j(film.body?.error)}`;
      const story = needOk(await apply(e, st, { assetIds: pics.map((p) => st.ids[p]), cutsMs: [5000, 12000], at: (await nextFree(e, st.pid)) }), 'story apply');
      const out: (string | false)[] = [];
      for (const [what, runId, params] of [['film', film.body.runId, {}], ['story', story.runId, { ownSound: 'mute' }]] as const) {
        const now = await revision(e, st.pid), h = await docHash(e, st.pid);
        const r = await e.call(`/projects/${st.pid}/recipe-runs/${runId}/regenerate`, { params, expectedRevision: now - 1 });
        if (r.status !== 409) out.push(`${what}: stale expectedRevision → ${r.status} ${j(r.body?.error)}`);
        if ((await docHash(e, st.pid)) !== h) out.push(`${what}: the refused regeneration changed the project`);
      }
      return fails(out);
    }),
  },
};

/** The end of the last clip on the main sequence's video tracks, as a frame-aligned rational (a second story is placed after the film). */
async function nextFree(e: Env, pid: string): Promise<T.RationalTime> {
  const d = await getDoc(e, pid);
  let end = T.ZERO;
  for (const t of Object.values(d.sequences).flatMap((q) => q.tracks)) for (const c of t.clips as any[]) { const x = T.add(c.start, c.duration); if (T.cmp(x, end) > 0) end = x; }
  return T.frameTime(T.nearestFrameIndex(end, R30) + 30, R30);
}

let duck: Promise<{ s9: true | string; s13: true | string }> | null = null;
function duckChecks(e: Env) {
  return (duck ??= (async () => {
    const pics = ['s0.png', 's1.png'];
    const st = await storyProject(e, 'S9 S13 music', { pictures: pics, extra: ['music-3k.wav'] });
    const t = await e.grant('edit');
    const a = await apply(e, st, { assetIds: pics.map((p) => st.ids[p]), cutsMs: [9000], musicAssetId: st.ids['music-3k.wav'], openingTitle: false }, t);
    if (a.status !== 200) { const why = a.body?.error?.code === 'story_not_built' ? `waits for W1 (story_not_built)` : `apply → ${a.status} ${j(a.body?.error)}`; return { s9: why, s13: why }; }
    const story = storyOf(await getDoc(e, st.pid), a.body.runId, st);
    const musicTrack = story.music?.track, voiceTrack = story.narration?.track;
    if (!musicTrack || !voiceTrack) return { s9: `no music or voice track: ${j({ music: !!musicTrack, voice: !!voiceTrack })}`, s13: 'no music or voice track' };
    const off = story.narration!.startFrame! / 30;
    const level = async () => { const f = await exportFile(e, st.pid, { format: 'wav' }, 'wav'); return pcm(f, BAND_3K); };
    const ducked = await level();
    await must(e, `/projects/${st.pid}/transactions`, { ops: [{ op: 'set_ducking', args: { trackId: musicTrack.id, sourceTrackIds: null } }] }, [200], t);
    const plain = await level();
    await must(e, `/projects/${st.pid}/undo`, {}, [200], t);
    // the typed phrases are the bursts: with a transcript the duck follows them (the 2.0 s pause 13.0–15.0 is no longer ducked)
    const segments = NARRATION_BURSTS.map(([x, y], i) => ({ start: T.fromSeconds(String(x)), duration: T.fromSeconds(String(Math.round((y - x) * 1000) / 1000)), text: `phrase ${i + 1}` }));
    await must(e, `/projects/${st.pid}/transactions`, { ops: [{ op: 'set_transcript', args: { assetId: st.narration, language: 'he', origin: 'manual', segments } }] }, [200], t);
    const typed = await level();
    const burst = [off + 9.5, off + 12.5] as const, pause = [off + 13.9, off + 14.6] as const;
    const drop = (x: Float32Array, w: readonly [number, number]) => rmsDb(plain, w[0], w[1]) - rmsDb(x, w[0], w[1]);
    const s9b = drop(ducked, burst), s9p = drop(ducked, pause), s13b = drop(typed, burst), s13p = drop(typed, pause);
    const r = (v: number) => Number(v.toFixed(2));
    return {
      s9: fails([Math.abs(s9b - 12) > 1 && `inside a burst the music is ${r(s9b)} dB below the mix with ducking off (want 12 ± 1)`, Math.abs(s9p - 12) > 1 && `in the 2.0 s pause ${r(s9p)} dB below (want 12 ± 1: low for the whole narration)`]),
      s13: fails([Math.abs(s13b - 12) > 1 && `with a transcript, inside a phrase ${r(s13b)} dB below (want 12 ± 1)`, Math.abs(s13p) > 1 && `with a transcript, in the pause between phrases ${r(s13p)} dB below (want 0 ± 1: the duck follows the phrases)`]),
    };
  })().catch((x) => { const why = `error: ${(x as Error).message}`; return { s9: why, s13: why }; }));
}

/** One request to the phone door (127.0.0.1, its own port; Host exactly address:port). */
function door(method: string, p: string, headers: Record<string, string>, body: Buffer): Promise<{ status: number; json: any }> {
  return new Promise((resolve) => {
    const req = http.request({ host: DOOR, port: doorPort, method, path: p, agent: false, headers: { host: `${DOOR}:${doorPort}`, connection: 'close', 'content-length': String(body.length), ...headers } }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => { let json: any = null; try { json = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { /* empty */ } resolve({ status: res.statusCode ?? 0, json }); });
    });
    req.on('error', (x) => resolve({ status: 0, json: { error: String(x) } }));
    req.end(body);
  });
}
/** Stops the proof's server (the entry exits the process; a runner that does not can call this). */
export async function stopStoryProofServer() { if (server) { const s = server; server = null; await s.close(); } }
