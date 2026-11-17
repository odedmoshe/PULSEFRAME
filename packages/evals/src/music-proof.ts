/**
 * `pnpm proof:music` — built-in music (ADR-0022) through the real server, on a CPU. Evidence: docs/evidence/music-proof.json;
 * a 16-bar render of every style is written to .artifacts/music-audition/ for the owner to listen to.
 *
 * Written against the planned routes (plan §7, wired by the lead): GET /api/v1/music, GET /api/v1/music/:styleId/audio?bars&seed,
 * POST /api/v1/projects/:id/music; and against the signatures of apps/server/src/music.ts and music/render.ts. Every check
 * below can fail for the defect it names (the verifier's corrections win over the plan):
 * - P6 template with built-in music: in the document the music clip starts at the template start and ends no later than the
 *   last picture and at most one frame before it; when the plan did not fade it (no builtin_music_faded notice) the clip has
 *   no fade-out; a WAV export (not AAC) of a project holding only that template with every other sound track muted,
 *   cross-correlated with renderMusic(style, N, seed): best lag = clip start in samples ± 1, normalised peak >= 0.99; the last
 *   10 ms of the export below −60 dBFS; CONTROL: the same check with the music clip moved one frame later must FAIL (the lag
 *   moves by one frame of samples); the track's beat analysis says "known by construction".
 * - P7 POST /music: size 44 + 16·N·samplesPerBeat; asset duration exact; the second identical request is deduplicated (same
 *   asset, nothing committed); analysing the beats of the built-in asset is refused (409 known_by_construction) and leaves beats
 *   and sections unchanged; ONE undo removes asset, analysis and clip (the document equals the one before).
 * - P8 ebur128 of each style at 16 bars (from the preview route, the bytes the owner will hear), with peak, RMS and render
 *   speed: reported against −16 ± 2 LUFS, not gated.
 * - P9 detectBeatsOfFile on each audition file directly (nothing committed): F1 against the exact grid, recorded and labelled
 *   'synthesised music with exact ground truth; not recordings'. Not gated: these are the tracker's numbers, not the music's.
 * - every style still carries review 'unheard', and GET /music says so.
 *   pnpm build && pnpm proof:music
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { MUSIC_METHOD, MUSIC_STYLES, MUSIC_UNHEARD_LABEL, musicLayout } from '@pulseframe/core';
import { startServer } from '@pulseframe/server';
import { renderMusic } from '../../../apps/server/src/music/render.ts';
import { detectBeatsOfFile } from '../../../apps/server/src/analysis.ts';
import { alignment, control } from './music-proof-lag.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/music-proof');
const audition = path.join(root, '.artifacts/music-audition');
const evidence = path.join(root, 'docs/evidence/music-proof.json');
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R = { num: 30, den: 1 };
const SR = 48000;
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 30 });
const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-12));
/** Mono float samples of any audio file at 48 kHz (through ffmpeg: the proof reads, it does not make). */
const monoOf = (file: string) => { const b = ff(['-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-']); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
let tmpN = 0;
const monoOfWav = (wav: Buffer) => { const f = path.join(art, `tmp_${tmpN++}.wav`); fs.writeFileSync(f, wav); try { return monoOf(f); } finally { fs.rmSync(f, { force: true }); } };
/** Integrated loudness by ffmpeg's ebur128 (its summary is on stderr). */
const lufs = (file: string): number | null => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const all = [...String(r.stderr ?? '').matchAll(/I:\s+(-?[\d.]+) LUFS/g)];
  return all.length ? Number(all[all.length - 1]![1]) : null;
};
/** F1 of detected beats against the exact ones, a hit within ±70 ms (each exact beat used once). */
function f1(detected: number[], exact: number[], tol = 0.07): { f1: number; precision: number; recall: number } {
  const used = new Set<number>();
  let hits = 0;
  for (const d of detected) { const k = exact.findIndex((e, i) => !used.has(i) && Math.abs(e - d) <= tol); if (k >= 0) { used.add(k); hits++; } }
  const precision = detected.length ? hits / detected.length : 0, recall = exact.length ? hits / exact.length : 0;
  return { f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0, precision, recall };
}

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  fs.mkdirSync(audition, { recursive: true });
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) throw new Error('web bundle missing: run `pnpm build` first');
  const styleRows: Record<string, Record<string, unknown>> = {};

  check('every style still carries review \'unheard\' (the owner has not listened)', MUSIC_STYLES.every((s) => s.review === 'unheard'), MUSIC_STYLES.map((s) => [s.id, s.review]));

  const s = await startServer({ port: 8883, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const txs = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const upload = async (pid: string, file: string) => { const r = await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) }); const b = (await r.json()) as any; if (!b.assetId) throw new Error(`upload failed: ${JSON.stringify(b).slice(0, 300)}`); return b.assetId as string; };
  const doc = async (pid: string) => (await call(`/projects/${pid}`)).body.project as any;
  const waitJob = async (id: string) => { for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(200); } };
  const newProject = async (name: string) => (await call('/projects', { name, width: 540, height: 960, frameRate: R })).body.id as string;
  const clipsOf = (d: any) => Object.values(d.sequences ?? {}).flatMap((q: any) => q.tracks.flatMap((t: any) => t.clips.map((c: any) => ({ ...c, trackId: t.id, trackKind: t.kind }))));
  const exportWav = async (pid: string, name: string) => {
    const j = await waitJob((await call(`/projects/${pid}/exports`, { format: 'wav' })).body.jobId);
    if (j.status !== 'succeeded') throw new Error(`wav export ${j.status}: ${JSON.stringify(j).slice(0, 300)}`);
    const file = path.join(art, name);
    fs.writeFileSync(file, (await call(`/jobs/${j.id}/output`)).body);
    return file;
  };

  try {
    // ------------------------------------------------------------ the catalogue
    const list = await call('/music');
    const styles: any[] = list.body?.styles ?? list.body?.items ?? list.body ?? [];
    check('GET /music lists the six styles, each labelled unheard', list.status === 200 && Array.isArray(styles) && styles.length === 6 && styles.every((x) => x.review === 'unheard' && x.label?.he === MUSIC_UNHEARD_LABEL.he), { status: list.status, count: Array.isArray(styles) ? styles.length : null });

    // ------------------------------------------------------------ P6: a template with built-in music, exported as WAV
    const stills = ['testsrc2', 'smptebars', 'rgbtestsrc', 'mandelbrot'].map((src, i) => { const f = path.join(art, `still_${i}.png`); ff(['-f', 'lavfi', '-i', `${src}=s=540x960`, '-frames:v', '1', f]); return f; });
    const p6 = await newProject('music-p6');
    const media: string[] = [];
    for (const f of stills) media.push(await upload(p6, f));
    const params = { media, builtinMusic: { styleId: 'music.festive', seed: 3 }, musicAssetId: null };
    const plan = await call(`/projects/${p6}/templates/tpl.photo-dump/plan`, { params });
    check('P6 the plan asks for built-in music and has nothing blocking', plan.status === 200 && !(plan.body.blocking ?? []).length, { status: plan.status, notices: plan.body.notices });
    const faded = (plan.body.notices ?? []).some((n: any) => (n.code ?? n) === 'builtin_music_faded');
    const applied = await call(`/projects/${p6}/templates/tpl.photo-dump/apply`, { params });
    check('P6 apply succeeds', applied.status === 200, { status: applied.status, body: applied.status === 200 ? undefined : applied.body });
    const d6 = await doc(p6);
    const music = Object.values(d6.assets).find((a: any) => a.provenance?.procedural?.id === 'music.festive') as any;
    const mclip = clipsOf(d6).find((c: any) => c.assetId === music?.id) as any;
    const pictures = clipsOf(d6).filter((c: any) => c.trackKind === 'video');
    const lastPicEnd = pictures.reduce((m: T.RationalTime, c: any) => T.max(m, T.add(c.start, c.duration)), T.ZERO);
    const mEnd = mclip ? T.add(mclip.start, mclip.duration) : T.ZERO;
    const oneFrame = T.frameTime(1, R);
    check('P6 the music clip starts at the template start and ends no later than the last picture, at most one frame before it', !!mclip && T.isZero(mclip.start) && T.lte(mEnd, lastPicEnd) && T.lte(T.sub(lastPicEnd, oneFrame), mEnd), { start: mclip?.start, end: mEnd, lastPicture: lastPicEnd });
    check('P6 when the plan did not fade the track, the clip has no fade-out (no fit_music: the composed ending is kept)', faded || !mclip?.fadeOut || T.isZero(mclip.fadeOut), { faded, fadeOut: mclip?.fadeOut });
    const beats6 = d6.analyses?.[music?.id]?.beats;
    check('P6 the track\'s beats are known by construction (not measured)', beats6?.origin?.method === MUSIC_METHOD && beats6?.confidence === null && (beats6?.sections ?? []).length > 0, { method: beats6?.origin?.method });
    // every other sound track muted, so the export holds the music alone
    const others = Object.values(d6.sequences).flatMap((q: any) => q.tracks).filter((t: any) => t.kind === 'audio' && t.id !== mclip?.trackId);
    if (others.length) await txs(p6, others.map((t: any) => ({ op: 'update_track', args: { trackId: t.id, muted: true } })));
    const params6 = music.provenance.procedural.params as { bars: number; seed: number };
    const ref = monoOfWav((await renderMusic('music.festive', params6.bars, params6.seed)).wav);
    const wav6 = await exportWav(p6, 'p6.wav');
    const x6 = monoOf(wav6);
    const startSamples = T.sampleIndexAt(mclip.start, SR);
    const corr = alignment(x6, ref, startSamples, 10 * SR);
    check('P6 the exported sound is the synthesised track at the clip\'s start: best lag = start ±1 sample, normalised peak >= 0.99', corr.ok, corr);
    let tail = 0;
    for (let i = Math.max(0, x6.length - 480); i < x6.length; i++) tail = Math.max(tail, Math.abs(x6[i]!));
    check('P6 the last 10 ms of the export are below −60 dBFS', db(tail) < -60, { dbfs: Number(db(tail).toFixed(1)) });
    // control: one frame later must fail the same check
    await txs(p6, [{ op: 'move_clip', args: { clipId: mclip.id, start: oneFrame } }]);
    const xc = monoOf(await exportWav(p6, 'p6-control.wav'));
    const corrC = control(xc, ref, startSamples, T.sampleIndexAt(oneFrame, SR), 10 * SR);
    check('P6 CONTROL: with the clip one frame late the alignment check fails, and the best lag moved by one frame', corrC.ok, corrC);

    // ------------------------------------------------------------ P7: POST /music
    const p7 = await newProject('music-p7');
    const before7 = await doc(p7);
    const L7 = musicLayout('music.pop', 8);
    const add1 = await call(`/projects/${p7}/music`, { styleId: 'music.pop', bars: 8, seed: 5, start: T.ZERO });
    check('P7 POST /music adds the track and one clip (201)', add1.status === 201 && !!add1.body.assetId && !!add1.body.clipId, { status: add1.status, body: add1.status === 201 ? undefined : add1.body });
    const d7 = await doc(p7);
    const a7 = d7.assets[add1.body.assetId];
    const content = await call(`/projects/${p7}/assets/${add1.body.assetId}/content`);
    check('P7 the file is 44 + 16·N·samplesPerBeat bytes and its duration is exact', a7?.byteSize === 44 + 16 * 8 * L7.samplesPerBeat && Buffer.isBuffer(content.body) && content.body.length === a7.byteSize && T.eq(a7.duration, L7.duration), { byteSize: a7?.byteSize, expected: 44 + 16 * 8 * L7.samplesPerBeat });
    const add2 = await call(`/projects/${p7}/music`, { styleId: 'music.pop', bars: 8, seed: 5 });
    check('P7 the second identical request is deduplicated: the same asset, nothing committed', add2.status === 201 && add2.body.assetId === add1.body.assetId && add2.body.revision === add1.body.revision, { first: add1.body.revision, second: add2.body.revision });
    const analyse = await call(`/projects/${p7}/assets/${add1.body.assetId}/analyze`, { kind: 'beats' });
    const d7b = await doc(p7);
    check('P7 measuring the built-in track\'s beats is refused (409 known_by_construction) and beats and sections stay', analyse.status === 409 && analyse.body.error?.code === 'known_by_construction' && JSON.stringify(d7b.analyses[add1.body.assetId]) === JSON.stringify(d7.analyses[add1.body.assetId]), { status: analyse.status });
    const undo = await call(`/projects/${p7}/undo`, {});
    const after7 = await doc(p7);
    check('P7 one undo removes asset, analysis and clip: the document is the one before', undo.status === 200 && JSON.stringify(after7) === JSON.stringify(before7), { status: undo.status });

    // ------------------------------------------------------------ P8 and P9: every style at 16 bars
    for (const st of MUSIC_STYLES) {
      const L = musicLayout(st.id, 16);
      const r = await call(`/music/${st.id}/audio?bars=16&seed=1`);
      const file = path.join(audition, `${st.id.slice('music.'.length)}-16bars-seed1.wav`);
      if (r.status === 200 && Buffer.isBuffer(r.body)) fs.writeFileSync(file, r.body);
      const t0 = performance.now();
      const local = await renderMusic(st.id, 16, 1);
      const ms = performance.now() - t0;
      const same = r.status === 200 && Buffer.isBuffer(r.body) && r.body.equals(local.wav);
      check(`P8 ${st.id}: the preview route plays exactly the bytes the synthesiser makes (16 bars, ${(T.toSeconds(L.duration)).toFixed(2)} s)`, same, { status: r.status });
      const loud = same ? lufs(file) : null;
      const beats = same ? await detectBeatsOfFile(file) : null;
      const exact = L.beats.map((b) => T.toSeconds(b));
      const score = beats ? f1(beats.beats, exact) : null;
      styleRows[st.id] = {
        review: st.review, bpm: st.bpm, bars: 16, seconds: Number(T.toSeconds(L.duration).toFixed(4)), bytes: local.wav.length,
        peakDbfs: Number(db(local.peak).toFixed(2)), rmsDbfs: Number(db(local.rms).toFixed(2)), clampedSamples: local.clamped, lufs: loud,
        lufsTarget: '-16 ± 2 (reported, not gated)', lufsInTarget: loud === null ? null : Math.abs(loud + 16) <= 2,
        renderMs: Math.round(ms), realTimeFactor: Number((T.toSeconds(L.duration) * 1000 / ms).toFixed(1)),
        tracker: score ? { label: 'synthesised music with exact ground truth; not recordings', toleranceSeconds: 0.07, detectedBpm: beats!.bpm, ...Object.fromEntries(Object.entries(score).map(([k, v]) => [k, Number(v.toFixed(3))])) } : null,
        audition: path.relative(root, file),
      };
      console.log(`       ${st.id}: ${JSON.stringify(styleRows[st.id])}`);
    }
    // the speed figure on about 128 s (the unit test only gates 5× real time)
    for (const [id, bars] of [['music.cinematic', 38], ['music.pop', 68]] as const) {
      const t0 = performance.now();
      const r = await renderMusic(id, bars, 1);
      const ms = performance.now() - t0;
      const secs = r.layout.totalFrames / SR;
      styleRows[id]!.long = { seconds: Number(secs.toFixed(2)), renderMs: Math.round(ms), realTimeFactor: Number((secs * 1000 / ms).toFixed(1)) };
      check(`speed ${id}: ${secs.toFixed(1)} s rendered in ${(ms / 1000).toFixed(2)} s (plan: under 6 s)`, ms < 6000, styleRows[id]!.long);
    }
  } finally {
    await s.close?.();
  }

  const ok = checks.every((c) => c.ok);
  fs.mkdirSync(path.dirname(evidence), { recursive: true });
  fs.writeFileSync(evidence, JSON.stringify({
    proof: 'proof:music (ADR-0022)', when: new Date().toISOString(), node: process.version, platform: `${os.platform()} ${os.arch()}`, cpus: os.cpus().length, ok,
    note: 'Nobody has listened: every style is review \'unheard\'. LUFS and the tracker\'s F1 are recorded, not gated; the tracker numbers are on synthesised music with exact ground truth, not recordings.',
    checks, styles: styleRows,
  }, null, 1) + '\n');
  console.log(`\nproof:music ${ok ? 'passed' : 'FAILED'}: ${checks.filter((c) => c.ok).length}/${checks.length} checks; evidence ${path.relative(root, evidence)}; audition files in ${path.relative(root, audition)}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
