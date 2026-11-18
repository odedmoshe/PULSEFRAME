/**
 * `pnpm proof:shorts` — the end-to-end proof of shorts (ADR-0018, plan §6), CPU only, no model. Evidence:
 * docs/evidence/shorts-proof.json: every measured number with its budget and pass or fail. The lead runs it after merging and
 * `pnpm build`. Exit codes: 0 = every check passed; 1 = a check failed (its numbers are in the evidence, never relaxed);
 * 2 = blocked (a part is not built on this tree, or a check could not run: listed under `blocked` with its reason).
 *
 * Fixtures: packages/fixtures/src/shorts.ts generateShortsFixture (240 s, 1920×1080, 30 fps, four planted cuts, a white disc on
 * a known path, the frame-index barcode, voiced word bursts with a manual word-timed Hebrew transcript: Q a question at +6 dB,
 * R opens with «אז כמו שאמרתי», X holds the excluded word, P holds 0.8 s and 1.5 s pauses and two «אממ»; a 2 s noise burst
 * with no word), and the long-media recipe of packages/evals/src/long-media.ts (20 minutes, a hard cut every minute, a click
 * every 0.5 s) for S10. The truth is the fixture's own (truth.json); statement P is split at its 0.8 s pause by the statement
 * rule (STATEMENT_DEFAULTS.pauseSeconds 0.7), so the edges the truth allows are the planted statement edges plus those pauses.
 * - S1 candidates: Q in the top 3; X listed as excluded with its word and exact time; every edge T.eq a statement edge; R carries
 *   context_added or starts_with_reference; louder value 6.0 ± 0.5 dB; two runs give identical JSON; no "viral" wording; the
 *   method says heuristic; ranking with cached features ≤ 2 s.
 * - S2 no transcript: every edge within 0.15 s of a planted silence edge; no word reasons; every candidate has no_transcript.
 * - S3 making 3 shorts at 720×1280 in one step: one revision, 3 sequences, ops ≤ 2000; undo/redo give equal
 *   creativeProjection; a title added on a plan-made track then an out-of-order undo → 409 undo_conflict, document unchanged;
 *   bytes per short (budget 60 KB) and commit p95 (budget +15 ms) recorded. Then one tightened short, one that follows a
 *   motion track and one over a blurred backdrop, each its own step.
 * - S4 exact time (the tightened short): every kept word inside a piece; frame-aligned starts and durations; sequenceDuration =
 *   sum of pieces; no silence ≥ 0.5 s in its wav; RMS in the 50 ms after each first-word onset within 0.5 dB of the source;
 *   picture cuts ≥ 11 frames apart; fades exactly 1/100 s at removal joins only.
 * - S5 follow: |cx − W/2| ≤ 0.10·W in ≥ 95% of settled frames (from /frame?sequence=); no #000 in the 2-px edge columns; at
 *   every planted cut the new piece's first frame shows the new shot and the frame before it the old one.
 * - S6 backdrop: bands not background-coloured, Laplacian variance ≤ 10% of the foreground's; foreground band W·Hs/Ws ± 2 px;
 *   no 'upscaled' warning for the blurred copy.
 * - S7 export: ffprobe 720×1280, frames = frameCount(sequenceDuration), 30/1, AAC; burned vs caption-free differ ≥ 5 levels in
 *   the caption band and ≤ 1 above; first SRT cue = snapped first word; −14 ± 0.5 LUFS; 0 photosensitivity failures; a batch of
 *   2 items makes 2 jobs, a bad item none (404).
 * - S8 parity: /frame?sequence=, a png export and a browser export of the same frame (same renderer: mean |Δ| ≤ 1 level;
 *   browser encoder: SSIM ≥ 0.97, as browser-export-proof).
 * - S9 MCP: find → plan → make → contact sheet (sequenceId) → preflight → export; propose mode refused on make_shorts; a
 *   non-verbatim quote 422; render_frame reports 720×1280.
 * - S10 long media: time, real-time factor ≥ 20×, RSS growth ≤ 400 MB, hops = ceil(seconds·10) with no seam gap, commit p95.
 *
 *   pnpm build && pnpm proof:shorts
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import * as T from '@pulseframe/time';
import { creativeProjection, SHORTS_RANK_METHOD, type ProjectDocument } from '@pulseframe/core';
import { EXCLUDED_WORD, generateShortsFixture, SHORTS_FIXTURE, type ShortsFixtureTruth } from '@pulseframe/fixtures/shorts.ts';
import { startServer } from '@pulseframe/server';
import { readCachedFeatures } from '../../../apps/server/src/shortsFeatures.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/shorts-proof');
const evidenceFile = path.join(root, 'docs/evidence/shorts-proof.json');
const R = { num: 30, den: 1 };
const W = 720, H = 1280;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30, ...(input ? { input } : {}) });
const ffErr = (args: string[]) => { try { return execFileSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { maxBuffer: 1 << 28, stdio: ['ignore', 'ignore', 'pipe'] }).toString(); } catch (e: any) { return String(e.stderr ?? ''); } };
const probe = (file: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_packets', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }));
const r2 = (v: number) => Number(v.toFixed(2));
const sec = (t: T.RationalTime) => T.toSeconds(t);
const rat = (s: string): T.RationalTime => { const [v, d] = s.split('/'); return T.rt(v!, Number(d)); };
const pct = (v: number[], p: number) => { if (!v.length) return NaN; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!; };

// ---------- evidence ----------
interface Row { id: string; name: string; value: unknown; budget: string; pass: boolean }
const rows: Row[] = [];
const blocked: { id: string; reason: string }[] = [];
const measurements: Record<string, unknown> = {};
const check = (id: string, name: string, pass: boolean, value: unknown, budget: string) => { rows.push({ id, name, value, budget, pass }); console.log(`${pass ? '  ok  ' : ' FAIL '} ${id} ${name}  ${JSON.stringify(value)}  (budget ${budget})`); };
class Blocked extends Error {}
/** Run one section; a part this tree does not have (501 not_built) or a missing prerequisite blocks it, anything else fails it. */
async function section(id: string, fn: () => Promise<void>) {
  console.log(`\n# ${id}`);
  try { await fn(); } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof Blocked || /not_built|not built yet/.test(msg)) { blocked.push({ id, reason: msg.slice(0, 400) }); console.log(` BLOCKED ${id}: ${msg.slice(0, 300)}`); }
    else check(id, 'section ran to its end', false, msg.slice(0, 400), 'no error');
  }
}

// ---------- pictures ----------
interface Rgb { w: number; h: number; rgb: Buffer }
const decodePng = (png: Buffer): Rgb => ({ w: png.readUInt32BE(16), h: png.readUInt32BE(20), rgb: ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png) });
const frameOf = (file: string, n: number, w: number, h: number): Rgb => ({ w, h, rgb: ff(['-i', file, '-vf', `select=eq(n\\,${n})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']) });
const lum = (p: Rgb, x: number, y: number) => { const i = (y * p.w + x) * 3; return 0.299 * p.rgb[i]! + 0.587 * p.rgb[i + 1]! + 0.114 * p.rgb[i + 2]!; };
/** Variance of the 4-neighbour Laplacian of the luminance over rows [y0, y1). */
function lapVariance(p: Rgb, y0: number, y1: number): number {
  let s = 0, s2 = 0, n = 0;
  for (let y = Math.max(1, y0); y < Math.min(p.h - 1, y1); y++) for (let x = 1; x < p.w - 1; x++) { const v = 4 * lum(p, x, y) - lum(p, x - 1, y) - lum(p, x + 1, y) - lum(p, x, y - 1) - lum(p, x, y + 1); s += v; s2 += v * v; n++; }
  return n ? s2 / n - (s / n) ** 2 : 0;
}
const meanAbsDiff = (a: Rgb, b: Rgb, y0 = 0, y1 = a.h) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < a.w; x++) for (let c = 0; c < 3; c++) { const i = (y * a.w + x) * 3 + c; s += Math.abs(a.rgb[i]! - b.rgb[i]!); n++; } return n ? s / n : 0; };
const ssimOf = (a: string, b: string) => { const out = ffErr(['-i', a, '-i', b, '-lavfi', 'ssim', '-f', 'null', '-']); const m = /All:([\d.]+)/.exec(out); return m ? Number(m[1]) : 0; };

// ---------- sound ----------
const pcmOf = (file: string) => { const b = ff(['-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-']); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.length & ~3))); };
const rmsDb = (x: Float32Array, from: number, to: number) => { let s = 0, n = 0; for (let i = Math.max(0, from); i < Math.min(x.length, to); i++) { s += x[i]! * x[i]!; n++; } return n ? 10 * Math.log10(s / n + 1e-20) : -200; };
const lufs = (file: string) => { const m = /I:\s+(-?[\d.]+) LUFS/.exec(ffErr(['-i', file, '-map', '0:a:0', '-af', 'ebur128', '-f', 'null', '-']).split('Summary:').pop() ?? ''); return m ? Number(m[1]) : NaN; };
const silences = (file: string, db = -35, d = 0.5) => [...ffErr(['-i', file, '-map', '0:a:0', '-af', `silencedetect=noise=${db}dB:d=${d}`, '-f', 'null', '-']).matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Number(m[1]));

// ---------- the truth's edges ----------
/** Statement edges the truth allows: each planted statement's first/last word, split at its pauses of at least 0.7 s. */
function statementEdges(t: ShortsFixtureTruth): { starts: T.RationalTime[]; ends: T.RationalTime[] } {
  const starts: T.RationalTime[] = [], ends: T.RationalTime[] = [];
  for (const s of t.statements) {
    starts.push(rat(t.words[s.firstWord]!.start)); ends.push(rat(t.words[s.lastWord]!.end));
    for (let i = s.firstWord; i < s.lastWord; i++) if ((t.words[i + 1]!.startMs - t.words[i]!.endMs) / 1000 >= 0.7) { ends.push(rat(t.words[i]!.end)); starts.push(rat(t.words[i + 1]!.start)); }
  }
  return { starts, ends };
}
/** Silence edges of the planted sound: sounding stretches (words and the burst) joined over gaps under 0.5 s. */
function silenceEdges(t: ShortsFixtureTruth): number[] {
  const iv = [...t.words.map((w) => [w.startMs / 1000, w.endMs / 1000] as [number, number]), [Number(t.reaction.start.split('/')[0]) / 1000, Number(t.reaction.end.split('/')[0]) / 1000] as [number, number]].sort((a, b) => a[0] - b[0]);
  const blocks: [number, number][] = [];
  for (const [a, b] of iv) { const l = blocks.at(-1); if (l && a - l[1] < 0.5) l[1] = Math.max(l[1], b); else blocks.push([a, b]); }
  return blocks.flat();
}

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) throw new Blocked('web bundle missing: run `pnpm build` first');
  const tGen = Date.now();
  const truth = await generateShortsFixture({ out: path.join(art, 'shorts.mp4') });
  const fixtureFile = path.join(art, 'shorts.mp4');
  measurements.fixture = { seconds: truth.seconds, words: truth.words.length, statements: truth.statements.length, cuts: truth.cuts, generateSeconds: r2((Date.now() - tGen) / 1000) };
  const server = await startServer({ port: 8851, dataDir: path.join(art, 'data'), webDist: path.join(root, 'apps/web/dist') });
  const h = { authorization: `Bearer ${server.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown, token?: string) => {
    const r = await fetch(`${server.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const must = async (p: string, body?: unknown, want = [200]) => { const r = await call(p, body); if (!want.includes(r.status)) throw new Error(`${p} → ${r.status} ${JSON.stringify(r.body?.error ?? r.body).slice(0, 300)}`); return r.body; };
  const tx = (pid: string, ops: unknown[]) => must(`/projects/${pid}/transactions`, { ops });
  const doc = async (pid: string) => (await must(`/projects/${pid}`)).project as ProjectDocument;
  const waitJob = async (id: string, ms = 1_800_000) => { const t0 = Date.now(); for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; if (Date.now() - t0 > ms) throw new Error(`job ${id} did not finish`); await sleep(100); } };
  const upload = async (pid: string, file: string) => (await (await fetch(`${server.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any;
  const candidates = async (pid: string, body: Record<string, unknown>) => {
    const r = await call(`/projects/${pid}/shorts/candidates`, body);
    if (r.status === 202) { const j = await waitJob(r.body.jobId); if (j.status !== 'succeeded') throw new Error(`candidates job ${j.status}: ${JSON.stringify(j.error)}`); return { view: j.output.result, measuredByJob: true }; }
    if (r.status !== 200) throw new Error(`candidates → ${r.status} ${JSON.stringify(r.body?.error)}`);
    return { view: r.body, measuredByJob: false };
  };
  const make = async (pid: string, body: Record<string, unknown>) => {
    const r = await call(`/projects/${pid}/shorts`, body);
    if (r.status !== 200) throw new Error(`make shorts → ${r.status} ${r.body?.error?.code}: ${r.body?.error?.message}`);
    return r.body as { revision: number; sequenceIds: string[]; createdIds: string[] };
  };
  const still = async (pid: string, sequenceId: string, index: number) => { const r = await call(`/projects/${pid}/frame?index=${index}&sequence=${sequenceId}`); if (r.status !== 200) throw new Error(`frame ${index} → ${r.status}`); return { png: r.body as Buffer, rgb: decodePng(r.body as Buffer) }; };
  let exports = 0;
  const exportFile = async (pid: string, options: Record<string, unknown>, ext = 'mp4') => {
    const st = await call(`/projects/${pid}/exports`, options);
    if (st.status !== 202) throw new Error(`export refused ${st.status}: ${JSON.stringify(st.body?.error ?? st.body).slice(0, 300)}`);
    const job = await waitJob(st.body.jobId);
    if (job.status !== 'succeeded') throw new Error(`export failed: ${JSON.stringify(job.error)}`);
    const file = path.join(art, `export-${++exports}.${ext}`);
    fs.writeFileSync(file, (await call(`/jobs/${job.id}/output`)).body);
    return { file, job };
  };
  const mcp = async (name: string, args: Record<string, unknown>, token = server.auth.tokens.agent) => {
    const r = await fetch(`${server.url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }) });
    const text = await r.text();
    const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
    if (msg.error) throw new Error(`MCP ${name}: ${JSON.stringify(msg.error)}`);
    const first = msg.result.content?.[0];
    return { isError: msg.result.isError === true, body: first?.type === 'text' ? JSON.parse(first.text) : null, content: msg.result.content as any[] };
  };
  const seqClips = (d: ProjectDocument, sid: string, kind: string) => d.sequences[sid]!.tracks.filter((t) => t.kind === kind).flatMap((t) => t.clips) as any[];
  const commitP95 = async (pid: string, trackId: string, n = 30) => { const ms: number[] = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); await tx(pid, [{ op: 'update_track', args: { trackId, name: `V1 ${i}` } }]); ms.push(performance.now() - t0); } return r2(pct(ms, 95)); };
  let browser: Browser | null = null;

  try {
    // ---------- the talk: on the main edit, with its transcript and scene cuts ----------
    const pid = (await must('/projects', { name: 'shorts proof', width: 1920, height: 1080, frameRate: R })).project.id as string;
    const up = await upload(pid, fixtureFile);
    const assetId = up.assetId as string;
    const added = await tx(pid, [{ op: 'add_clip', args: { assetId, start: T.ZERO } }]);
    const mainTrack = added.results[0].output.trackId as string;
    await tx(pid, [{ op: 'set_transcript', args: { assetId, ...truth.transcript } }]);
    await must(`/projects/${pid}/assets/${assetId}/analyze`, { kind: 'scenes' });
    const stored = await doc(pid);
    const cutsFound = (stored.analyses[assetId]?.scenes?.cuts ?? []).map((c) => T.frameIndexAt(c, R));
    measurements.sceneCuts = { planted: truth.cuts, found: cutsFound };
    const mainBefore = JSON.stringify(stored.sequences[stored.mainSequenceId]);
    const p95Before = await commitP95(pid, mainTrack);
    const edges = statementEdges(truth);
    const word = (i: number) => truth.words[i]!;
    const tagged = (tag: 'Q' | 'R' | 'X' | 'P') => truth.statements.find((s) => s.tag === tag)!;
    const Q = tagged('Q'), Rs = tagged('R'), X = tagged('X'), P = tagged('P');
    const contains = (c: any, t: T.RationalTime) => T.lte(c.start, t) && T.lt(t, c.end);
    let picks: any[] = [];

    await section('S1', async () => {
      const first = await candidates(pid, { assetId, exclude: [EXCLUDED_WORD], count: 40 });
      measurements.s1MeasuredByJob = first.measuredByJob;
      const t0 = performance.now();
      const a = await must(`/projects/${pid}/shorts/candidates`, { assetId, exclude: [EXCLUDED_WORD], count: 40 });
      const rankMs = performance.now() - t0;
      const b = await must(`/projects/${pid}/shorts/candidates`, { assetId, exclude: [EXCLUDED_WORD], count: 40 });
      const cs: any[] = a.candidates;
      const qStart = rat(word(Q.firstWord).start);
      const qRank = cs.find((c) => contains(c, qStart))?.rank ?? null;
      check('S1', 'Q (the question, +6 dB) ranks in the top 3', qRank !== null && qRank <= 3, { rank: qRank, top3: cs.slice(0, 3).map((c) => ({ rank: c.rank, score: c.score, firstWords: c.firstWords })) }, 'rank ≤ 3');
      const xw = truth.words.slice(X.firstWord, X.lastWord + 1).find((w) => w.text === EXCLUDED_WORD)!;
      const ex = (a.excluded as any[]).find((e) => e.word === EXCLUDED_WORD);
      check('S1', 'X is listed as excluded with its word and exact time', !!ex && T.eq(ex.at, rat(xw.start)) && !cs.some((c) => contains(c, rat(xw.start))), { excluded: a.excluded, wordAt: xw.start }, 'listed, at T.eq the word start, in no candidate');
      const bad = cs.filter((c) => !edges.starts.some((e) => T.eq(e, c.start)) || !edges.ends.some((e) => T.eq(e, c.end)));
      check('S1', 'every candidate edge is T.eq a statement edge', cs.length > 0 && bad.length === 0, { candidates: cs.length, offEdge: bad.map((c) => [c.start, c.end]) }, '0 off-edge');
      const rStart = rat(word(Rs.firstWord).start);
      const small = (await must(`/projects/${pid}/shorts/candidates`, { assetId, minSeconds: 5, maxSeconds: 15, count: 40 })).candidates as any[];
      const rc = [...cs, ...small].find((c) => (T.eq(c.start, rStart) && c.warnings.includes('starts_with_reference')) || (T.lt(c.start, rStart) && sec(T.sub(rStart, c.start)) <= 8 && c.reasons.some((x: any) => x.code === 'context_added')));
      check('S1', 'R (opens with «אז כמו שאמרתי») carries context_added or starts_with_reference', !!rc, rc ? { start: rc.start, end: rc.end, reasons: rc.reasons.map((x: any) => x.code), warnings: rc.warnings } : null, 'one of the two');
      const qc = cs.find((c) => contains(c, qStart));
      const loud = qc?.reasons.find((x: any) => x.code === 'louder_than_usual')?.value ?? null;
      check('S1', 'louder_than_usual of the +6 dB statement', loud !== null && Math.abs(loud - 6) <= 0.5, { dB: loud }, '6.0 ± 0.5 dB');
      check('S1', 'two runs give identical JSON', JSON.stringify(a) === JSON.stringify(b), { bytes: JSON.stringify(a).length }, 'identical');
      const affirmative = (s: string) => s.replace(/\b(not a|never|no)\b[^;.,]*/gi, '');
      const text = JSON.stringify(a);
      check('S1', 'no viral wording; the method says heuristic', !/viral|virality|ויראל|retention/i.test(affirmative(text)) && /heuristic/.test(a.method) && a.method === SHORTS_RANK_METHOD, { method: a.method }, 'no match; "heuristic"');
      check('S1', 'ranking time with cached features', rankMs <= 2000, { ms: r2(rankMs) }, '≤ 2000 ms');
      // picks for the shorts: three non-overlapping candidates; one of them holds P (for the tightened short)
      const pStart = rat(word(P.firstWord).start);
      const withP = [...cs].filter((c) => contains(c, pStart)).sort((x, y) => x.rank - y.rank)[0];
      picks = [...(withP ? [withP] : []), ...cs.filter((c) => c !== withP)].slice(0, 6);
    });

    await section('S2', async () => {
      const pid2 = (await must('/projects', { name: 'no transcript', width: 1920, height: 1080, frameRate: R })).project.id as string;
      const up2 = await upload(pid2, fixtureFile);
      const { view } = await candidates(pid2, { assetId: up2.assetId, count: 40 });
      const planted = silenceEdges(truth);
      const off = (view.candidates as any[]).flatMap((c) => [sec(c.start), sec(c.end)]).map((e) => ({ e, d: Math.min(...planted.map((p) => Math.abs(p - e))) })).filter((x) => x.d > 0.15);
      check('S2', 'every edge within 0.15 s of a planted silence edge', view.candidates.length > 0 && off.length === 0, { candidates: view.candidates.length, off }, '≤ 0.15 s');
      const wordy = (view.candidates as any[]).filter((c) => c.reasons.some((x: any) => x.quote !== null || ['opens_with_question', 'hook_word', 'number_in_opening', 'speaks_to_viewer', 'fillers', 'topic_word', 'low_confidence_words', 'complete_statements', 'pace'].includes(x.code)));
      check('S2', 'no word reasons', wordy.length === 0, { withWordReasons: wordy.length }, '0');
      check('S2', 'every candidate has no_transcript', (view.candidates as any[]).every((c) => c.warnings.includes('no_transcript')), { candidates: view.candidates.length }, 'all');
    });

    const fmt = { width: W, height: H, fit: 'cover', profileId: null, safeArea: { top: 0.08, bottom: 0.15, left: 0.05, right: 0.05 } };
    const pickOf = (c: any) => ({ assetId, start: c.start, end: c.end, candidateId: c.id });
    const made: Record<string, string> = {};
    await section('S3', async () => {
      if (picks.length < 6) throw new Blocked(`S1 gave ${picks.length} candidates; 6 are needed for S3–S6`);
      const before = await doc(pid);
      const rev0 = (await must(`/projects/${pid}`)).revision as number;
      const bytes0 = JSON.stringify(before).length;
      const plan = await must(`/projects/${pid}/shorts/plan`, { picks: picks.slice(3, 6).map(pickOf), format: fmt, loudness: { target: -14, truePeak: -1 } });
      const r = await make(pid, { picks: picks.slice(3, 6).map(pickOf), format: fmt, loudness: { target: -14, truePeak: -1 }, expectedRevision: plan.revision });
      const after = await doc(pid);
      const rev1 = (await must(`/projects/${pid}`)).revision as number;
      check('S3', 'one revision and 3 sequences; operations', rev1 === rev0 + 1 && r.sequenceIds.length === 3 && plan.operations <= 2000, { revisions: rev1 - rev0, sequences: r.sequenceIds.length, operations: plan.operations }, '1 revision, 3 sequences, ≤ 2000 ops');
      [made.A1, made.A2, made.A3] = r.sequenceIds as [string, string, string];
      check('S3', 'the main edit is unchanged', JSON.stringify(after.sequences[after.mainSequenceId]) === mainBefore, null, 'identical');
      const cpBefore = creativeProjection(before), cpAfter = creativeProjection(after);
      await must(`/projects/${pid}/undo`, {});
      const undone = creativeProjection(await doc(pid));
      await must(`/projects/${pid}/redo`, {});
      const redone = creativeProjection(await doc(pid));
      check('S3', 'undo and redo give equal creativeProjection', undone === cpBefore && redone === cpAfter, { undoEqual: undone === cpBefore, redoEqual: redone === cpAfter }, 'equal');
      // a title on a plan-made track, then an out-of-order undo of the make step
      const d = await doc(pid);
      const textTrack = d.sequences[made.A1!]!.tracks.find((t) => t.kind === 'text')!;
      await tx(pid, [{ op: 'add_text', args: { sequenceId: made.A1, trackId: textTrack.id, text: 'כותרת', start: T.frameTime(60, R), duration: T.frameTime(30, R) } }]);
      const hist = (await must(`/projects/${pid}/history?since=0`)).events as any[];
      const makeTx = hist.filter((e) => e.ops.includes('apply_sequence_plan')).at(-1)!;
      const snap = JSON.stringify(await doc(pid));
      const ooo = await call(`/projects/${pid}/undo`, { transactionId: makeTx.transactionId });
      check('S3', 'an out-of-order undo after a title on a plan-made track is refused; document unchanged', ooo.status === 409 && ooo.body?.error?.code === 'undo_conflict' && JSON.stringify(await doc(pid)) === snap, { status: ooo.status, code: ooo.body?.error?.code }, '409 undo_conflict, unchanged');
      await must(`/projects/${pid}/undo`, {}); // the title
      const perShort = (JSON.stringify(after).length - bytes0) / 3;
      check('S3', 'document bytes per short', perShort <= 60_000, { bytes: Math.round(perShort) }, '≤ 60 KB');
      // the three single shorts of S4–S6
      const tight = await make(pid, { picks: [pickOf(picks[0])], format: { ...fmt, safeArea: null }, tighten: { pauses: true, minPauseSeconds: 0.7, fillers: true }, captions: null, loudness: null });
      made.tight = tight.sequenceIds[0]!;
      const c1 = picks[1];
      const f0 = T.frameIndexAt(c1.start, R), f1 = T.frameIndexAt(c1.end, R) + 1;
      const disc = (f: number) => ({ x: Math.round(((SHORTS_FIXTURE.width / 2 + 640 * Math.sin((2 * Math.PI * f) / 900)) / SHORTS_FIXTURE.width) * 10000), y: Math.round(((600 + 180 * Math.sin((2 * Math.PI * f) / 450)) / SHORTS_FIXTURE.height) * 10000) });
      const mt = (await tx(pid, [{ op: 'create_motion_track', args: { assetId, kind: 'point', frame: f0, ...disc(f0), name: 'disc (from the truth)' } }])).results[0].output.motionTrackId as string;
      const set = Array.from({ length: f1 - f0 }, (_, k) => ({ frame: f0 + k, ...disc(f0 + k) }));
      for (let k = 0; k < set.length; k += 500) await tx(pid, [{ op: 'edit_motion_track', args: { motionTrackId: mt, set: set.slice(k, k + 500) } }]);
      made.track = (await make(pid, { picks: [pickOf(c1)], format: { ...fmt, safeArea: null }, reframe: { source: 'track', motionTrackId: mt }, captions: null })).sequenceIds[0]!;
      made.backdrop = (await make(pid, { picks: [pickOf(picks[2])], format: { ...fmt, safeArea: null }, reframe: { source: 'backdrop' }, captions: null })).sequenceIds[0]!;
      const p95After = await commitP95(pid, mainTrack);
      measurements.commitP95 = { beforeMs: p95Before, afterMs: p95After, shorts: 6 };
      check('S3', 'commit p95 with six shorts in the project', p95After - p95Before <= 15, { beforeMs: p95Before, afterMs: p95After }, '≤ +15 ms');
    });

    await section('S4', async () => {
      if (!made.tight) throw new Blocked('S3 made no tightened short');
      const d = await doc(pid);
      const seq = d.sequences[made.tight]!;
      const origin = seq.origin as any;
      const pieces = seqClips(d, made.tight, 'video').sort((a, b) => T.cmp(a.start, b.start));
      const sounds = seqClips(d, made.tight, 'audio').sort((a, b) => T.cmp(a.start, b.start));
      const exS = origin.excerpt.start as T.RationalTime, exE = origin.excerpt.end as T.RationalTime;
      const fillerIdx = new Set(truth.fillers);
      const kept = truth.words.filter((w) => T.lte(exS, rat(w.start)) && T.lte(rat(w.end), exE) && !fillerIdx.has(w.index));
      const outside = kept.filter((w) => !pieces.some((p) => T.lte(p.sourceIn, rat(w.start)) && T.lte(rat(w.end), T.add(p.sourceIn, p.duration))));
      check('S4', 'every kept word lies inside a piece', kept.length > 0 && outside.length === 0, { words: kept.length, outside: outside.map((w) => w.text) }, '0 outside');
      const unaligned = [...pieces, ...sounds].filter((c) => !T.isFrameAligned(c.start, R) || !T.isFrameAligned(c.duration, R));
      check('S4', 'starts and durations are frame-aligned', unaligned.length === 0, { clips: pieces.length + sounds.length, unaligned: unaligned.length }, '0');
      const list = (await must(`/projects/${pid}/sequences`)).sequences as any[];
      const total = pieces.reduce((acc, p) => T.add(acc, p.duration), T.ZERO);
      const mine = list.find((s) => s.id === made.tight);
      check('S4', 'sequenceDuration equals the sum of the pieces', T.eq(mine.duration, total), { duration: mine.duration, sum: total, pieces: pieces.length }, 'T.eq');
      const wav = (await exportFile(pid, { format: 'wav', sequenceId: made.tight }, 'wav')).file;
      const quiet = silences(wav);
      check('S4', 'the tightened wav has no silence of 0.5 s or more', quiet.length === 0, { silenceStarts: quiet }, '0 at −35 dB / 0.5 s');
      const src = pcmOf(fixtureFile), out = pcmOf(wav);
      const diffs: number[] = [];
      for (const p of pieces) {
        const w = truth.words.find((x) => T.lte(p.sourceIn, rat(x.start)) && T.lt(rat(x.start), T.add(p.sourceIn, p.duration)) && !fillerIdx.has(x.index));
        if (!w) continue;
        const onsetSrc = Math.round(sec(rat(w.start)) * 48000), onsetOut = Math.round(sec(T.add(p.start, T.sub(rat(w.start), p.sourceIn))) * 48000);
        diffs.push(r2(rmsDb(out, onsetOut, onsetOut + 2400) - rmsDb(src, onsetSrc, onsetSrc + 2400)));
      }
      check('S4', 'RMS in the 50 ms after each first-word onset matches the source', diffs.length > 0 && diffs.every((x) => Math.abs(x) <= 0.5), { dB: diffs }, '|Δ| ≤ 0.5 dB');
      const cutFrames = pieces.slice(1).map((p) => T.frameIndexAt(p.start, R));
      const gaps = cutFrames.slice(1).map((c, i) => c - cutFrames[i]!);
      check('S4', 'picture cuts are at least 11 frames apart', gaps.every((g) => g >= 11), { cuts: cutFrames, minGap: gaps.length ? Math.min(...gaps) : null }, '≥ 11 frames');
      const fade = T.rt(1, 100);
      const fades = sounds.map((c, i) => {
        const prev = sounds[i - 1], next = sounds[i + 1];
        const joinIn = !!prev && !T.eq(T.add(prev.sourceIn, prev.duration), c.sourceIn), joinOut = !!next && !T.eq(T.add(c.sourceIn, c.duration), next.sourceIn);
        const okIn = joinIn ? !!c.fadeIn && T.eq(c.fadeIn, fade) : !c.fadeIn || T.isZero(c.fadeIn);
        const okOut = joinOut ? !!c.fadeOut && T.eq(c.fadeOut, fade) : !c.fadeOut || T.isZero(c.fadeOut);
        return { i, joinIn, joinOut, fadeIn: c.fadeIn ?? null, fadeOut: c.fadeOut ?? null, ok: okIn && okOut };
      });
      check('S4', 'fades are exactly 1/100 s, at removal joins only', fades.length > 0 && fades.every((x) => x.ok) && fades.some((x) => x.joinIn), { joins: fades.filter((x) => x.joinIn).length, wrong: fades.filter((x) => !x.ok) }, 'all exact; ≥ 1 join');
    });

    await section('S5', async () => {
      if (!made.track) throw new Blocked('S3 made no short that follows a track');
      const d = await doc(pid);
      const pieces = seqClips(d, made.track, 'video').sort((a, b) => T.cmp(a.start, b.start));
      const frames = T.frameCount((await must(`/projects/${pid}/sequences`)).sequences.find((s: any) => s.id === made.track).duration, R);
      const starts = pieces.map((p) => T.frameIndexAt(p.start, R));
      const settled = (k: number) => starts.every((s) => k < s || k >= s + 15);
      let ok = 0, n = 0, black = 0;
      const offsets: number[] = [];
      for (let i = 0; i < 60; i++) {
        const k = Math.min(frames - 1, Math.round((i * (frames - 1)) / 59));
        const { rgb } = await still(pid, made.track, k);
        let sx = 0, m = 0;
        for (let y = 230; y < rgb.h; y++) for (let x = 0; x < rgb.w; x++) { const o = (y * rgb.w + x) * 3; if (rgb.rgb[o]! > 235 && rgb.rgb[o + 1]! > 235 && rgb.rgb[o + 2]! > 235) { sx += x + 0.5; m++; } }
        for (let y = 230; y < rgb.h; y++) for (const x of [0, 1, rgb.w - 2, rgb.w - 1]) { const o = (y * rgb.w + x) * 3; if (rgb.rgb[o] === 0 && rgb.rgb[o + 1] === 0 && rgb.rgb[o + 2] === 0) black++; }
        if (!settled(k) || !m) continue;
        n++;
        const off = Math.abs(sx / m - W / 2);
        offsets.push(r2(off));
        if (off <= 0.1 * W) ok++;
      }
      check('S5', 'the disc stays near the centre in settled frames', n > 0 && ok / n >= 0.95, { settled: n, within: ok, maxOffsetPx: Math.max(...offsets) }, '≥ 95% within 0.10·W');
      check('S5', 'no #000 pixel in the 2-px edge columns', black === 0, { blackPixels: black }, '0');
      // at each planted cut inside the short: the first frame of the new piece shows the new shot, the frame before the old one
      const shotColour = (p: Rgb) => { const o = (300 * p.w + 4) * 3; return [p.rgb[o]!, p.rgb[o + 1]!, p.rgb[o + 2]!]; };
      const nearest = (c: number[]) => SHORTS_FIXTURE.shots.map((s, i) => ({ i, d: Math.abs(s[0] - c[0]!) + Math.abs(s[1] - c[1]!) + Math.abs(s[2] - c[2]!) })).sort((a, b) => a.d - b.d)[0]!.i;
      const atCuts: unknown[] = [];
      let cutOk = true;
      for (const p of pieces.slice(1)) {
        const srcFrame = T.frameIndexAt(p.sourceIn, R);
        const cut = truth.cuts.find((c) => c === srcFrame || c === srcFrame + 1 || c === srcFrame - 1);
        if (cut === undefined) continue;
        const k = T.frameIndexAt(p.start, R);
        const now = nearest(shotColour((await still(pid, made.track, k)).rgb)), before = nearest(shotColour((await still(pid, made.track, k - 1)).rgb));
        const want = (SHORTS_FIXTURE.cuts as readonly number[]).indexOf(cut) + 1;
        atCuts.push({ cut, frame: k, shotNow: now, shotBefore: before, want });
        if (now !== want || before !== want - 1) cutOk = false;
      }
      check('S5', 'at every planted cut the new piece starts on the new shot', cutOk, { cuts: atCuts }, 'new shot at the piece start, old shot before');
    });

    await section('S6', async () => {
      if (!made.backdrop) throw new Blocked('S3 made no backdrop short');
      const frames = T.frameCount((await must(`/projects/${pid}/sequences`)).sequences.find((s: any) => s.id === made.backdrop).duration, R);
      const { rgb } = await still(pid, made.backdrop, Math.floor(frames / 2));
      // the foreground's edges: rows where most columns step sharply in luminance
      const stepRows: number[] = [];
      for (let y = 1; y < rgb.h; y++) { let n = 0; for (let x = 0; x < rgb.w; x++) if (Math.abs(lum(rgb, x, y) - lum(rgb, x, y - 1)) > 6) n++; if (n > rgb.w / 2) stepRows.push(y); }
      const top = stepRows[0] ?? 0, bottom = stepRows.at(-1) ?? 0;
      const want = (W * SHORTS_FIXTURE.height) / SHORTS_FIXTURE.width;
      check('S6', 'the foreground band height', Math.abs(bottom - top - want) <= 2, { top, bottom, height: bottom - top, want }, `${want} ± 2 px`);
      const band = (y0: number, y1: number) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < rgb.w; x++) { s += lum(rgb, x, y); n++; } return n ? s / n : 0; };
      const above = band(0, Math.max(1, top - 4)), below = band(Math.min(rgb.h - 1, bottom + 4), rgb.h);
      check('S6', 'the bands above and below are not background-coloured', above > 10 && below > 10, { meanLumAbove: r2(above), meanLumBelow: r2(below) }, 'mean luminance > 10 (black is 0)');
      const vb = (lapVariance(rgb, 4, top - 4) + lapVariance(rgb, bottom + 4, rgb.h - 4)) / 2, vf = lapVariance(rgb, top + 4, bottom - 4);
      check('S6', 'the bands are blurred: Laplacian variance', vb <= 0.1 * vf, { bands: r2(vb), foreground: r2(vf), ratio: r2(vb / vf) }, '≤ 10% of the foreground');
      const pf = await must(`/projects/${pid}/preflight?sequence=${made.backdrop}`);
      const d = await doc(pid);
      const v1 = d.sequences[made.backdrop]!.tracks.filter((t) => t.kind === 'video')[0]!.clips.map((c) => c.id);
      const upscaled = (pf.issues as any[]).filter((x) => x.code === 'upscaled' && v1.includes(x.clipId));
      check('S6', "no 'upscaled' warning for the blurred copy", upscaled.length === 0, { upscaled: upscaled.length }, '0');
    });

    await section('S7', async () => {
      if (!made.A1 || !made.A2) throw new Blocked('S3 made no shorts with captions');
      const list = (await must(`/projects/${pid}/sequences`)).sequences as any[];
      const a1 = list.find((s) => s.id === made.A1);
      const burned = await exportFile(pid, { sequenceId: made.A1, captions: 'burned' });
      const pr = probe(burned.file);
      const vs = pr.streams.find((s: any) => s.codec_type === 'video'), as = pr.streams.find((s: any) => s.codec_type === 'audio');
      check('S7', 'ffprobe: 720×1280, frames, 30/1, AAC', vs.width === W && vs.height === H && Number(vs.nb_read_packets) === a1.frames && vs.r_frame_rate === '30/1' && as?.codec_name === 'aac', { size: `${vs.width}×${vs.height}`, frames: Number(vs.nb_read_packets), want: a1.frames, rate: vs.r_frame_rate, audio: as?.codec_name }, `720×1280, ${a1.frames} frames, 30/1, aac`);
      const clean = await exportFile(pid, { sequenceId: made.A1, captions: 'none' });
      const k = Math.min(a1.frames - 1, 15);
      const fa = frameOf(burned.file, k, W, H), fb = frameOf(clean.file, k, W, H);
      const rowDiff = Array.from({ length: H }, (_, y) => meanAbsDiff(fa, fb, y, y + 1));
      const capBand = Math.max(...rowDiff.slice(Math.round(H * 0.6))), aboveBand = Math.max(...rowDiff.slice(0, Math.round(H * 0.5)));
      check('S7', 'burned and caption-free exports differ in the caption band only', capBand >= 5 && aboveBand <= 1, { captionBand: r2(capBand), above: r2(aboveBand), frame: k }, '≥ 5 levels in the band, ≤ 1 above');
      const srt = (await call(`/projects/${pid}/captions?format=srt&sequence=${made.A1}`)).body.toString('utf8') as string;
      const firstCue = /(\d\d):(\d\d):(\d\d),(\d\d\d) -->/.exec(srt);
      const cueS = firstCue ? Number(firstCue[1]) * 3600 + Number(firstCue[2]) * 60 + Number(firstCue[3]) + Number(firstCue[4]) / 1000 : NaN;
      const d = await doc(pid);
      const firstPiece = seqClips(d, made.A1, 'video').sort((a, b) => T.cmp(a.start, b.start))[0];
      const fw = truth.words.find((w) => T.lte(firstPiece.sourceIn, rat(w.start)))!;
      const snapped = sec(T.snapToFrame(T.add(firstPiece.start, T.sub(rat(fw.start), firstPiece.sourceIn)), R));
      check('S7', 'the first SRT cue starts at the snapped time of the first word', Math.abs(cueS - snapped) <= 0.0005, { cue: cueS, snapped }, '± 0.5 ms (SRT has milliseconds)');
      const loud = lufs(burned.file);
      check('S7', 'loudness of the short', Math.abs(loud + 14) <= 0.5, { lufs: loud }, '−14 ± 0.5 LUFS');
      const ps = burned.job.output?.photosensitivity;
      check('S7', 'the photosensitivity report has 0 failures', !!ps && ps.verdict === 'pass' && ps.ranges.length === 0, { verdict: ps?.verdict ?? null, ranges: ps?.ranges?.length ?? null }, '0');
      const jobsBefore = (server.store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE type = 'export'").get() as { n: number }).n;
      const batch = await call(`/projects/${pid}/exports/batch`, { items: [{ sequenceId: made.A1 }, { sequenceId: made.A2 }], options: { format: 'png' } });
      const jobsMid = (server.store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE type = 'export'").get() as { n: number }).n;
      const badBatch = await call(`/projects/${pid}/exports/batch`, { items: [{ sequenceId: made.A1 }, { sequenceId: 'seq_none' }], options: { format: 'png' } });
      const jobsAfter = (server.store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE type = 'export'").get() as { n: number }).n;
      check('S7', 'a batch of 2 items makes 2 jobs; a bad item makes none (404)', batch.status === 202 && jobsMid - jobsBefore === 2 && badBatch.status === 404 && jobsAfter === jobsMid, { batch: batch.status, jobs: jobsMid - jobsBefore, bad: badBatch.status, jobsAfterBad: jobsAfter - jobsMid }, '202 + 2 jobs; 404 + 0 jobs');
    });

    await section('S8', async () => {
      if (!made.track) throw new Blocked('S3 made no short to compare');
      const k = 20;
      const a = await still(pid, made.track, k);
      fs.writeFileSync(path.join(art, 'parity-frame.png'), a.png);
      const png = await exportFile(pid, { format: 'png', frame: k, sequenceId: made.track }, 'png');
      const b = decodePng(fs.readFileSync(png.file));
      const dPng = meanAbsDiff(a.rgb, b);
      check('S8', '/frame?sequence= and a png export of the same frame', b.w === W && b.h === H && dPng <= 1, { meanAbsDiff: r2(dPng), size: `${b.w}×${b.h}` }, 'mean |Δ| ≤ 1 level');
      browser = await chromium.launch();
      const page = await (await browser.newContext()).newPage();
      await page.goto(`${server.url}/browser-export.html?key=${server.auth.tokens.owner}`);
      await page.evaluate(() => (window as any).__pfBrowserExport.ready);
      const r: any = await page.evaluate(([p, o]) => (window as any).__pfBrowserExport.tryRun(p, o), [pid, { sequenceId: made.track, range: { startFrame: k, endFrame: k + 1 }, quality: 'high', captions: 'burned' }] as const);
      if (!r.ok) throw new Error(`browser export failed: ${r.code} ${r.message}`);
      const file = path.join(art, `browser.${r.result.container}`);
      fs.writeFileSync(file, Buffer.from(r.result.base64, 'base64'));
      const bpng = path.join(art, 'parity-browser.png');
      ff(['-y', '-i', file, '-frames:v', '1', bpng]);
      const ssim = ssimOf(bpng, path.join(art, 'parity-frame.png'));
      check('S8', 'a browser export of the same frame', ssim >= 0.97, { ssim: r2(ssim * 1000) / 1000 }, 'SSIM ≥ 0.97 (two encoders)');
    });

    await section('S9', async () => {
      const found = await mcp('find_short_candidates', { projectId: pid, assetId, exclude: [EXCLUDED_WORD] });
      if (found.isError) throw new Error(`find_short_candidates: ${JSON.stringify(found.body)}`);
      const view = found.body.jobId ? (await waitJob(found.body.jobId)).output.result : found.body;
      const c = view.candidates[0];
      const body = { picks: [pickOf(c)], format: fmt };
      const plan = await mcp('plan_shorts', { projectId: pid, ...body });
      const made9 = await mcp('make_shorts', { projectId: pid, ...body, expectedRevision: plan.body?.revision });
      const sid = made9.body?.sequenceIds?.[0];
      const sheet = sid ? await mcp('render_contact_sheet', { projectId: pid, sequenceId: sid, frames: [0, 30, 60] }) : null;
      const pf = sid ? await mcp('preflight', { projectId: pid, sequenceId: sid }) : null;
      const ex = sid ? await mcp('export_project', { projectId: pid, sequenceId: sid, format: 'png', frame: 0 }) : null;
      const exJob = ex && !ex.isError ? await waitJob(ex.body.jobId) : null;
      const flow = { plan: !plan.isError, make: !made9.isError && !!sid, sheet: !!sheet && !sheet.isError && sheet.content.filter((x) => x.type === 'image').length === 3, preflight: !!pf && !pf.isError, export: exJob?.status === 'succeeded' };
      check('S9', 'find → plan → make → contact sheet (sequenceId) → preflight → export', Object.values(flow).every(Boolean), flow, 'every step succeeds');
      const proposer = await call('/grants', { name: 'proposer', mode: 'propose' }, server.auth.tokens.owner);
      if (proposer.status !== 201) throw new Error(`grant → ${proposer.status} ${JSON.stringify(proposer.body?.error)}`);
      const tokenP = proposer.body.token as string;
      const refused = await mcp('make_shorts', { projectId: pid, ...body }, tokenP);
      check('S9', 'propose mode is refused on make_shorts', refused.isError && JSON.stringify(refused.body).includes('insufficient_scope'), { error: refused.body?.error?.code ?? refused.body }, '403 insufficient_scope');
      const reworded = await mcp('make_shorts', { projectId: pid, picks: [{ ...pickOf(c), title: { text: 'מילים שלא נאמרו בכלל', origin: 'quote' } }], format: fmt });
      const restReworded = await call(`/projects/${pid}/shorts`, { picks: [{ ...pickOf(c), title: { text: 'מילים שלא נאמרו בכלל', origin: 'quote' } }], format: fmt });
      check('S9', 'a non-verbatim quote title is refused (MCP and REST)', reworded.isError && JSON.stringify(reworded.body).includes('not_verbatim') && restReworded.status === 422 && restReworded.body?.error?.code === 'not_verbatim', { mcp: reworded.body?.error ?? reworded.body, rest: restReworded.status }, '422 not_verbatim');
      const rf = sid ? await mcp('render_frame', { projectId: pid, sequenceId: sid, frameIndex: 0 }) : null;
      check('S9', 'render_frame reports 720×1280', !!rf && rf.body?.width === W && rf.body?.height === H, { width: rf?.body?.width, height: rf?.body?.height }, '720×1280');
    });

    await section('S10', async () => {
      const minutes = 20, D = String(minutes * 60);
      const file = path.join(art, 'long.mp4');
      ff(['-y', '-f', 'lavfi', '-t', D, '-i', 'testsrc2=s=640x360:r=30', '-f', 'lavfi', '-t', D, '-i', 'smptebars=s=640x360:r=30', '-f', 'lavfi', '-i', `aevalsrc=0.8*sin(2*PI*1000*t)*lt(mod(t\\,0.5)\\,0.02):s=48000:d=${D}`,
        '-filter_complex', "[0:v][1:v]overlay=enable='eq(mod(floor(t/60)\\,2)\\,1)',format=yuv420p,setsar=1[v]", '-map', '[v]', '-map', '2:a',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-g', '60', '-bf', '2', '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', file]);
      const lp = (await must('/projects', { name: 'long', width: 640, height: 360, frameRate: R })).project.id as string;
      const lu = await upload(lp, file);
      const added10 = await tx(lp, [{ op: 'add_clip', args: { assetId: lu.assetId, start: T.ZERO } }]);
      const seconds = sec(lu.asset.duration);
      const rss0 = process.memoryUsage().rss;
      let peak = rss0;
      const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 100);
      const t0 = Date.now();
      const r = await call(`/projects/${lp}/shorts/candidates`, { assetId: lu.assetId });
      const job = r.status === 202 ? await waitJob(r.body.jobId) : null;
      const wall = (Date.now() - t0) / 1000;
      clearInterval(timer);
      if (job && job.status !== 'succeeded') throw new Error(`long measurement ${job.status}: ${JSON.stringify(job.error)}`);
      const view = job ? job.output.result : r.body;
      const rtf = seconds / wall;
      measurements.long = { seconds, wallSeconds: r2(wall), realtimeFactor: r2(rtf), rssBaselineMB: Math.round(rss0 / 1e6), rssPeakMB: Math.round(peak / 1e6), cpus: os.cpus().length };
      check('S10', 'real-time factor of measuring 20 minutes', rtf >= 20, { seconds, wallSeconds: r2(wall), rtf: r2(rtf) }, '≥ 20×');
      check('S10', 'RSS growth while measuring', peak - rss0 <= 400e6, { baselineMB: Math.round(rss0 / 1e6), peakMB: Math.round(peak / 1e6), growthMB: Math.round((peak - rss0) / 1e6) }, '≤ 400 MB');
      const want = Math.ceil(seconds * 10 - 1e-9);
      check('S10', 'hops = ceil(seconds·10)', view.features?.hops === want, { hops: view.features?.hops, want }, String(want));
      const ld = await doc(lp);
      const f = readCachedFeatures(server.store, ld.assets[lu.assetId]!);
      // a click every 0.5 s: hop 5k holds a click, hop 5k+2 is silent, on both sides of the 1200 s window seam
      const seam: { h: number; db: number }[] = [];
      let seamOk = !!f;
      if (f) for (let hh = 11950; hh < Math.min(f.hops, 12050); hh++) {
        if (hh % 5 === 0 && f.rmsDb[hh]! < -40) seamOk = false;
        if (hh % 5 === 2 && f.rmsDb[hh]! > -50) seamOk = false;
        if (hh >= 11995 && hh < 12006) seam.push({ h: hh, db: r2(f.rmsDb[hh]!) });
      }
      check('S10', 'no missing or duplicated hop at the 1200 s seam', seamOk, { around: seam }, 'clicks every 5 hops on both sides');
      const p95 = await commitP95(lp, added10.results[0].output.trackId as string);
      measurements.longCommitP95Ms = p95;
      check('S10', 'commit p95 on the 20-minute project', p95 - p95Before <= 15, { ms: p95, baselineMs: p95Before }, '≤ +15 ms over the 4-minute project');
    });
  } finally {
    if (browser) await (browser as Browser).close();
    await server.close();
  }
}

main().then(
  () => {
    const failed = rows.filter((r) => !r.pass);
    const status = failed.length ? 'fail' : blocked.length ? 'blocked' : 'pass';
    const report = { proof: 'shorts', adr: 'ADR-0018', status, generatedAt: new Date().toISOString(), machine: { platform: process.platform, cpus: os.cpus().length, node: process.version },
      note: 'CPU only, no model; synthetic word bursts with a manual transcript; one run on one machine. The candidate score is a relative heuristic within one video.', checks: rows, blocked, measurements };
    fs.writeFileSync(evidenceFile, JSON.stringify(report, null, 2) + '\n');
    console.log(`\n${status.toUpperCase()}: ${rows.length - failed.length}/${rows.length} checks passed, ${blocked.length} section(s) blocked → ${path.relative(root, evidenceFile)}`);
    process.exit(failed.length ? 1 : blocked.length ? 2 : 0);
  },
  (e) => {
    const isBlocked = e instanceof Blocked;
    console.error(isBlocked ? `BLOCKED: ${e.message}` : e);
    if (isBlocked) fs.writeFileSync(evidenceFile, JSON.stringify({ proof: 'shorts', status: 'blocked', reason: e.message, checks: rows, blocked, measurements }, null, 2) + '\n');
    process.exit(isBlocked ? 2 : 1);
  },
);
