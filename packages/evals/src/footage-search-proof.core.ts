/**
 * pnpm proof:search, part core (builder A): checks S2, S3 (Node side), S9 (numbers), S17 and S18 of footage-search-proof.ts.
 *
 * SYNTHETIC ONLY: the document below is written here, in memory, with the proof's fixture names (colours.mp4, colours2.mp4,
 * VID_20241226_183000.mp4, talk.mp4 with a typed transcript holding «בנרות», a still beach.png), invented people «אלף» and "Gimel"
 * and an invented pearl «תוויתסוד». No media is read: the core checks are about the words, dates and numbers. The scan, the decoded
 * barcodes and the test-double embedder belong to the server part (B); the browser side of S3 to the UI part (C), which runs
 * window.__pfFootageSearch(footageProofDoc(), q) for each of FOOTAGE_BASELINE_QUERIES and compares with footageBaselineJson().
 * S9 here: the frames the labelled test double would score as blue in colours.mp4 (one sample per second, blue from 3 s to 6 s) are
 * merged by core mergePictureHits: the moment must be exactly [2 s, 6 s] at 30 fps and snapped outward at 30000/1001. The relevance
 * values are placeholders of the plumbing (labelled TEST-DOUBLE), never a measurement.
 * S18 is recorded, never gated: one sample on a shared machine.
 * Run alone: `tsx packages/evals/src/footage-search-proof.core.ts` (prints each check; exits 1 on a failure). Writes no file.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import * as T from '@pulseframe/time';
import {
  agentAnswerOf, createProject, FOOTAGE_EMBEDDERS, FOOTAGE_LIMITS, int8Dot, mergePictureHits, PICTURE_MIN_RELEVANCE, quantiseInt8, sampleFrameTargets, searchFootage, validateProject,
  type Asset, type Capture, type Moment, type ProjectDocument,
} from '@pulseframe/core';

export interface FootageProofPart { built: boolean; checks: Record<string, () => Promise<true | string>>; evidence: Record<string, unknown> }
const evidence: Record<string, unknown> = {};
const R30 = { num: 30, den: 1 };
const NTSC = { num: 30000, den: 1001 };
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'proof' };
const hashOf = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`;
const sec = (n: number, d = 1) => T.normalize(T.rt(n, d));
const fail = (what: string, got: unknown) => `${what}: ${JSON.stringify(got).slice(0, 600)}`;
const check = (run: () => true | string | Promise<true | string>) => async (): Promise<true | string> => {
  try { return await run(); } catch (e) { return `threw: ${String((e as Error)?.stack ?? e).slice(0, 600)}`; }
};
const cap = (at: string, extra: Partial<Capture> = {}): Capture => ({ at, utcOffsetMinutes: null, source: 'filename', ...extra });
const video = (id: string, name: string, frames: number, extra: Partial<Asset> = {}): Asset => ({
  id, kind: 'video', name, contentHash: hashOf(name), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(frames, R30),
  video: { width: 320, height: 180, frameRate: R30, codec: 'h264', rotation: 0, frameCount: frames }, provenance: prov, ...extra,
}) as Asset;

/** The synthetic document of the core checks and of the browser side of S3. A new object on each call. */
export function footageProofDoc(): ProjectDocument {
  const doc = createProject({ id: 'prj_footage_proof', name: 'חיפוש בצילומים' });
  const assets: Asset[] = [
    video('ast_colours', 'colours.mp4', 360),
    video('ast_colours2', 'colours2.mp4', 90),
    video('ast_hanukkah', 'VID_20241226_183000.mp4', 120, { capture: cap('2024-12-26T18:30:00', { circa: true }) }),
    video('ast_talk', 'talk.mp4', 300, { capture: cap('2025-03-14T10:00:00'), audio: { sampleRate: 48000, channels: 1, codec: 'aac' } }),
    { id: 'ast_beach', kind: 'image', name: 'beach.png', contentHash: hashOf('beach.png'), byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.rt(5, 1), image: { width: 64, height: 64, codec: 'png', hasAlpha: false }, provenance: prov, capture: cap('2023-08-01T10:00:00') } as Asset,
    video('ast_seder', 'ליל הסדר אצל סבתא.mp4', 150, { capture: cap('2025-04-12T20:30:00', { utcOffsetMinutes: 180 }) }),
  ];
  for (const a of assets) doc.assets[a.id] = a;
  const words: [string, number, number][][] = [[['תכבי', 1000, 400], ['את', 1400, 200], ['הנרות', 1600, 533]], [['שירי', 5000, 300], ['בנרות', 5300, 700], ['Gimel', 6000, 250]]];
  doc.transcripts.ast_talk = {
    assetId: 'ast_talk', language: 'he', origin: { kind: 'manual', provider: null, model: null, createdAt: prov.importedAt, createdBy: 'proof' },
    segments: words.map((ws, i) => ({
      id: `seg_${i}`, start: sec(ws[0]![1], 1000), duration: sec(ws[ws.length - 1]![1] + ws[ws.length - 1]![2] - ws[0]![1], 1000), text: ws.map((w) => w[0]).join(' '), original: null, speaker: null, timing: 'word',
      words: ws.map(([text, s, d], k) => ({ id: `w_${i}_${k}`, text, start: sec(s, 1000), duration: sec(d, 1000), confidence: null })),
    })),
  } as ProjectDocument['transcripts'][string];
  doc.events = { evt_sea: { id: 'evt_sea', name: 'טיול לים', afterSunset: null, assetIds: ['ast_beach'], origin: { method: 'manual', gapMinutes: null, createdBy: 'proof', edited: true } } };
  doc.people = { per_alef: { id: 'per_alef', name: 'אלף', birthDate: null }, per_gimel: { id: 'per_gimel', name: 'Gimel', birthDate: null } };
  doc.sourceRanges = {
    rng_secret: { id: 'rng_secret', assetId: 'ast_colours2', kind: 'pearl', span: { start: sec(1), end: sec(2) }, label: 'תוויתסוד', people: ['per_alef'], createdBy: 'user:owner' },
  };
  return doc;
}

/** The 40 baseline queries of S3: Hebrew with and without points, final letters, prefixes, dates, holidays, Latin, nothing found. */
export const FOOTAGE_BASELINE_QUERIES: readonly string[] = [
  'נרות', 'בנרות', 'הנרות', 'הַנֵּרוֹת', 'וּבַנֵּרוֹת', 'תכבי נרות', 'שירי', 'Gimel', 'gimel', 'GIMEL',
  'חנוכה', 'חנוכה 2024', 'בחנוכה', 'חֲנֻכָּה', 'Hanukkah', 'כסלו', 'תשפ״ה', 'ה׳תשפ"ה', 'דצמבר 2024', 'December',
  'פסח', 'ליל הסדר', 'ניסן', 'אדר', 'אדר ב׳', 'פורים', 'סבתא', 'אצל סבתא', 'colours', 'colours2',
  'VID', '20241226', 'beach', 'טיול', 'לים', 'טיול 2023', 'תוויתסוד', 'אלף', 'זזזקק', 'colours 2024',
];
/** The Node side of S3: the owner's exact section of each baseline query as JSON (what window.__pfFootageSearch returns). */
export function footageBaselineJson(doc: ProjectDocument = footageProofDoc()): string[] {
  return FOOTAGE_BASELINE_QUERIES.map((q) => JSON.stringify(searchFootage(doc, q, { reader: 'owner' })));
}
export const footageBaselineDigest = (json: readonly string[]) => createHash('sha256').update(json.join('\n')).digest('hex');

const S2 = check(() => {
  const doc = footageProofDoc();
  const issues = validateProject(doc);
  if (issues.length) return fail('the synthetic document is not valid', issues);
  const han = searchFootage(doc, 'חנוכה 2024', { reader: 'owner' });
  const wantHan: Moment[] = [{ assetId: 'ast_hanukkah', start: null, end: null, sources: ['date'] }];
  if (JSON.stringify(han) !== JSON.stringify(wantHan)) return fail('«חנוכה 2024» is not exactly VID_20241226_183000.mp4', han);
  const candles = searchFootage(doc, 'נרות', { reader: 'owner' });
  const phrase = candles.find((m) => m.snippet?.includes('בנרות'));
  if (!phrase || phrase.assetId !== 'ast_talk' || !T.eq(phrase.start!, sec(5300, 1000)) || !T.eq(phrase.end!, sec(6000, 1000))) return fail('«נרות» did not give the «בנרות» phrase with its word span [5.3 s, 6 s)', candles);
  // an agent hears the same words without the snippet, and agentAnswerOf keeps them as they are
  const ag = searchFootage(doc, 'נרות', { reader: 'agent' });
  if (JSON.stringify(agentAnswerOf({ exact: ag }).exact) !== JSON.stringify(ag) || ag.some((m) => 'snippet' in m)) return fail('the agent answer of «נרות» is not plain', ag);
  evidence.S2 = { hanukkah2024: han, candles: candles.map((m) => ({ assetId: m.assetId, start: m.start, end: m.end, sources: m.sources })) };
  return true;
});

const S3node = check(() => {
  const doc = footageProofDoc();
  const a = footageBaselineJson(doc);
  const b = footageBaselineJson(JSON.parse(JSON.stringify(doc)) as ProjectDocument);
  // the same document with its maps in reverse key order
  const rev = <V>(rec: Record<string, V>) => Object.fromEntries(Object.keys(rec).reverse().map((k) => [k, rec[k]!]));
  const c = footageBaselineJson({ ...doc, assets: rev(doc.assets), transcripts: rev(doc.transcripts), people: rev(doc.people!), sourceRanges: rev(doc.sourceRanges!) });
  if (a.length !== 40) return fail('baseline query count', a.length);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] || a[i] !== c[i]) return fail(`query ${i} differs after a JSON round trip or a key reorder`, [a[i], b[i], c[i]]);
  const found = a.filter((j) => j !== '[]').length;
  if (found < 30) return fail('fewer than 30 baseline queries find something (the baseline would prove little)', found);
  evidence.S3 = { side: 'node', queries: a.length, nonEmpty: found, sha256: footageBaselineDigest(a), note: 'the browser side (UI part) must give the same digest for footageProofDoc()' };
  return true;
});

const S9 = check(() => {
  const doc = footageProofDoc();
  // colours.mp4: red 0–3 s, blue 3–6 s, green 6–9 s, yellow 9–12 s; one sample per second; the TEST-DOUBLE scores blue samples high
  const frames = sampleFrameTargets(R30, 360);
  const hits = frames.map((f) => ({ assetId: 'ast_colours', frame: f, relevance: f >= 90 && f < 180 ? 0.9 - (f % 7) / 100 : PICTURE_MIN_RELEVANCE / 10 }));
  const at30 = mergePictureHits(doc, hits, R30, 30), atNtsc = mergePictureHits(doc, hits, NTSC, 30);
  const first = at30[0];
  if (at30.length !== 1 || !first || first.assetId !== 'ast_colours' || !T.eq(first.start!, sec(2)) || !T.eq(first.end!, sec(6))) return fail('«כחול» at 30 fps is not exactly [2 s, 6 s]', at30);
  const n = atNtsc[0]!;
  if (!T.eq(n.start!, T.frameTime(59, NTSC)) || !T.eq(n.end!, T.frameTime(180, NTSC))) return fail('at 30000/1001 the span is not snapped outward to frames 59–180', atNtsc);
  if (JSON.stringify(at30).includes('0.9') || 'relevance' in first) return fail('a relevance left in a moment', at30);
  evidence.S9 = { embedder: FOOTAGE_EMBEDDERS.testDouble, samples: frames.length, at30fps: at30, at2997: atNtsc, note: 'core numbers only; the scan and the test-double embedder are the server part' };
  return true;
});

const S17 = check(() => {
  const doc = footageProofDoc();
  for (const q of ['זזזקק', 'colours 2024', 'תוויתסוד zzz', '?!']) { const r = searchFootage(doc, q, { reader: 'owner' }); if (r.length) return fail(`«${q}» should find nothing`, r); }
  const below = sampleFrameTargets(R30, 360).map((f) => ({ assetId: 'ast_colours', frame: f, relevance: PICTURE_MIN_RELEVANCE * 0.999 }));
  const pic = mergePictureHits(doc, below, R30, 30);
  if (pic.length) return fail('frames below the relevance floor were shown', pic);
  evidence.S17 = { exact: [], picture: [], floor: PICTURE_MIN_RELEVANCE, wording: 'the answer shows «לא נמצא דבר» (UI part)' };
  return true;
});

const S18 = check(() => {
  const count = 200_000, dim = FOOTAGE_LIMITS.embedDim;
  const all = new Int8Array(count * dim);
  let x = 0x9e3779b9;
  for (let i = 0; i < all.length; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; all[i] = ((x >>> 0) % 255) - 127; }
  const qv = new Float32Array(dim);
  for (let i = 0; i < dim; i++) qv[i] = Math.sin(i + 1);
  const q = quantiseInt8(qv).q;
  const t0 = performance.now();
  const scores = new Int32Array(count);
  for (let i = 0; i < count; i++) scores[i] = int8Dot(q, all.subarray(i * dim, (i + 1) * dim));
  const t1 = performance.now();
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => scores[b]! - scores[a]! || a - b).slice(0, FOOTAGE_LIMITS.topFrames);
  const t2 = performance.now();
  evidence.S18 = { sample: 'one sample on a shared 4-CPU machine, not gated', vectors: count, dim, dotMs: +(t1 - t0).toFixed(1), top200Ms: +(t2 - t1).toFixed(1), best: scores[order[0]!] };
  return true;
});

export const FOOTAGE_PROOF_CORE: FootageProofPart = { built: true, checks: { S2, S3: S3node, S9, S17, S18 }, evidence };

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  let failed = 0;
  for (const [name, run] of Object.entries(FOOTAGE_PROOF_CORE.checks)) {
    const r = await run();
    if (r !== true) failed++;
    console.log(`${r === true ? '  ok  ' : ' FAIL '} ${name}${r === true ? '' : `  ${r}`}`);
  }
  console.log(JSON.stringify(evidence, null, 1));
  process.exit(failed ? 1 : 0);
}
