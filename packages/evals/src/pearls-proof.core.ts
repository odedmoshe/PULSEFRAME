/**
 * pnpm proof:pearls, part core (builder A): checks P1, P6, P8 (numbers), P14, P15 (Node side) and P16 of pearls-proof.ts.
 *
 * P1 and P14 run through the server's Store (commit, undo, replay: the path every edit takes). P6 and P8 use REAL synthetic media
 * made here by FFmpeg — barcode videos at 30 and 30000/1001 fps (packages/fixtures generateBarcodeFixture), a time-preserving copy
 * (the 30 fps file from 1 s on, re-encoded) and an untimed copy (the same file reversed) — never an owner clip. WHAT IS READ AS "THE
 * PICTURE" HERE: for every programme frame, the engine's evaluate() names the source frame the compositor draws (ADR-0005: preview,
 * still and export draw that one graph), and the barcode is read from the pixels of that frame decoded from the file by FFmpeg. The
 * expected frames of a range are those whose barcode b lies in [floor(s·fps), ceil(e·fps)) of the file the range was marked on (a
 * copy's barcodes are the original's numbers), computed here from the span with integers, never from rangeUsage. Reading the barcodes
 * off an EXPORTED file needs the web bundle and a browser; that variant belongs to the integration run (pearls-proof.ts), which can
 * pass `renderedBarcodes` to p6Compare with the barcodes it read from the export, frame by frame.
 * P15 here: the digest of rangeUsage + screenTime (core pearlsDigest) over 20 fuzzed documents, stable across a JSON round trip and a
 * second computation; the browser side (window.__pfPearlsHash, builder C) must return the same digest for pearlsDeterminismDocs().
 * P16 is recorded, not gated: one sample each.
 * Run alone: `tsx packages/evals/src/pearls-proof.core.ts` (prints each check; exits 1 on a failure). Writes temp files only under
 * the OS temp folder and removes them.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, creativeProjection, pearlsDigest, rangeUsage, screenTime, SOURCE_RANGE_SUMMARIES, validateProject,
  type Asset, type MediaClip, type OpCall, type ProjectDocument, type SourceRange,
} from '@pulseframe/core';
import { evaluate, frameKey, type FrameKeyContext } from '@pulseframe/engine';
import { generateBarcodeFixture, readBarcode } from '@pulseframe/fixtures';
import { ApiError, Store } from '../../../apps/server/src/store.ts';
import { createFuzz } from './ops-fuzz.gen.ts';

export interface PearlsProofPart { built: boolean; checks: Record<string, () => Promise<true | string>>; evidence: Record<string, unknown> }
const evidence: Record<string, unknown> = {};

const R = { num: 30, den: 1 };
const NTSC = { num: 30000, den: 1001 };
const f = (n: number) => T.frameTime(n, R);
const W = 320, H = 180;
const OWNER = 'user:owner';
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'proof' };
const hashOf = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`;
const fail = (what: string, got: unknown) => `${what}: ${JSON.stringify(got).slice(0, 500)}`;
const tmpDirs: string[] = [];
const tmp = (name: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `pf-pearls-${name}-`)); tmpDirs.push(d); return d; };
const check = (run: () => true | string | Promise<true | string>) => async (): Promise<true | string> => {
  try { return await run(); } catch (e) { return `threw: ${String((e as Error)?.stack ?? e).slice(0, 600)}`; } finally { for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); }
};
const videoFacts = (name: string, fps: T.Rate, frames: number, extra: Partial<Asset> = {}) => ({
  kind: 'video' as const, name, contentHash: hashOf(name), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(frames, fps),
  video: { width: W, height: H, frameRate: fps, codec: 'h264', rotation: 0, frameCount: frames }, provenance: prov, ...extra,
});
const derivedProv = (src: string, start?: T.RationalTime, capabilityId = 'local.video.trim') => ({
  origin: 'derived' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'proof',
  derived: { jobId: 'job_proof', capabilityId, capabilityVersion: '1', graphDigest: hashOf('g'), params: {}, sourceAssetIds: [src], outputName: 'video', outputRole: 'primary', encoding: 'display', provider: { id: 'ffmpeg' }, ...(start ? { sourceRangeStart: start } : {}) },
});

// ---------------------------------------------------------------- the store (P1, P14)
class Proj {
  s: Store; pid: string;
  constructor(from?: ProjectDocument) {
    this.s = new Store(tmp('store'));
    this.pid = from ? this.s.importProject(from).doc.id : this.s.createProject({ name: 'pearls-proof', width: W, height: H, frameRate: R }).doc.id;
  }
  commit(ops: OpCall[], actor = OWNER, internal = false) { return this.s.commit({ projectId: this.pid, actor: internal ? 'system' : actor, ops, ...(internal ? { allowInternal: true } : {}) }); }
  out(ops: OpCall[], key: string, internal = false) { return (this.commit(ops, OWNER, internal) as unknown as { results: { output?: Record<string, unknown> }[] }).results.map((r) => r.output?.[key] as string); }
  doc() { return this.s.getProject(this.pid).doc; }
  json() { return JSON.stringify(this.doc()); }
  undo(actor = OWNER) { return this.s.undo(this.pid, actor, 'undo'); }
  close() { this.s.close(); }
}

const P1 = check(() => {
  const p = new Proj();
  try {
    if (Object.hasOwn(p.doc(), 'sourceRanges') || p.json().includes('sourceRanges')) return 'a new project\'s JSON holds sourceRanges';
    const [vid] = p.out([{ op: 'import_asset', args: { asset: videoFacts('a30.mp4', R, 300) } }], 'assetId', true) as [string];
    p.commit([{ op: 'add_person', args: { name: 'אלף' } }]);
    const personId = Object.keys(p.doc().people!)[0]!;
    p.commit([{ op: 'add_clip', args: { assetId: vid, start: f(0), duration: f(120), withLinkedAudio: false } }]);
    const ctx = (d: ProjectDocument): FrameKeyContext => ({ digest: (t) => createHash('sha256').update(t).digest('hex'), output: { width: W, height: H }, gpu: null, assetHash: (id) => (Object.hasOwn(d.assets, id) ? d.assets[id]!.contentHash : null), fontHash: () => 'bundled', effectVersion: () => 1 } as FrameKeyContext);
    const keys = (d: ProjectDocument) => Array.from({ length: 10 }, (_, i) => frameKey(d, i * 12, ctx(d)));
    const before = p.doc(), beforeJson = p.json(), beforeKeys = keys(before);
    p.commit([{ op: 'add_source_range', args: { assetId: vid, start: f(30), end: f(75), label: 'סופגנייה של דינוזאורים' } }]);
    if (!p.doc().sourceRanges) return 'the pearl was not stored';
    p.undo();
    if (p.json() !== beforeJson) return 'add then undo does not give the stored JSON back';
    p.commit([{ op: 'add_source_range', args: { assetId: vid, start: f(30), end: f(75), label: 'סופגנייה' } }, { op: 'add_source_range', args: { assetId: vid, kind: 'presence', people: [personId] } }]);
    const afterKeys = keys(p.doc());
    if (JSON.stringify(afterKeys) !== JSON.stringify(beforeKeys)) return fail('frame keys changed with a pearl and a presence tag', { beforeKeys, afterKeys });
    // the op log replays to the stored document
    const replayed = p.s.replay(p.pid).doc;
    if (creativeProjection(replayed) !== creativeProjection(p.doc())) return 'the op log does not replay to the stored document';
    // a document imported with an empty map: stored without the key, add-then-undo gives it back
    const q = new Proj({ ...structuredClone(before), id: 'prj_pearls_imported', sourceRanges: {} } as ProjectDocument);
    try {
      const qJson = q.json();
      if (qJson.includes('sourceRanges')) return 'an imported empty sourceRanges map was stored';
      q.commit([{ op: 'add_source_range', args: { assetId: vid } }]);
      q.undo();
      if (q.json() !== qJson) return 'add then undo on the imported document does not give its JSON back';
    } finally { q.close(); }
    evidence.P1 = { frameKeysCompared: 10, replayed: true };
    return true;
  } finally { p.close(); }
});

const P14 = check(() => {
  const p = new Proj();
  try {
    const [vid, tone] = p.out([{ op: 'import_asset', args: { asset: videoFacts('a30.mp4', R, 300) } }, { op: 'import_asset', args: { asset: { kind: 'audio', name: 'tone.wav', contentHash: hashOf('tone'), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(10, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm' }, provenance: prov } } }], 'assetId', true) as [string, string];
    p.commit([{ op: 'add_person', args: { name: 'אלף' } }, { op: 'add_person', args: { name: 'Gimel' } }]);
    const [alef, gimel] = Object.values(p.doc().people!).sort((a, b) => (a.name === 'אלף' ? -1 : b.name === 'אלף' ? 1 : 0)).map((x) => x.id) as [string, string];
    p.commit([
      { op: 'add_source_range', args: { assetId: tone, start: T.rt(1, 1), end: T.rt(2, 1), label: 'צחוק', people: [alef] } },
      { op: 'add_source_range', args: { assetId: tone, kind: 'presence', people: [gimel] } },
      { op: 'add_source_range', args: { assetId: vid, start: f(30), end: f(75), people: [alef, gimel] } },
      { op: 'add_source_range', args: { assetId: vid, kind: 'presence', people: [alef] } },
    ]);
    const full = p.doc();
    // remove_asset takes the file's two ranges; undo returns them
    const ra = p.commit([{ op: 'remove_asset', args: { assetId: tone } }], 'agent:helper');
    const left = Object.values(p.doc().sourceRanges ?? {});
    if (left.length !== 2 || left.some((r) => r.assetId === tone)) return fail('remove_asset did not take exactly the file\'s ranges', left);
    if (ra.summary.includes('צחוק')) return 'the summary of remove_asset holds a label';
    p.undo('agent:helper');
    if (creativeProjection(p.doc()) !== creativeProjection(full)) return 'undo of remove_asset does not return the ranges';
    // the owner's remove_person drops the tags and says how many; undo returns them
    const rp = p.commit([{ op: 'remove_person', args: { personId: alef } }]);
    const want = `Removed "אלף" from the people of the project${SOURCE_RANGE_SUMMARIES.untagged(3)}`;
    if (rp.summary !== want) return fail('the summary of remove_person', { got: rp.summary, want });
    const after = p.doc();
    const tagged = Object.values(after.sourceRanges ?? {}).filter((r) => r.people?.includes(alef));
    if (tagged.length || Object.values(after.sourceRanges!).some((r) => r.kind === 'presence' && r.assetId === vid)) return 'remove_person left a tag, or a presence tag with nobody';
    if (validateProject(after).length) return fail('the document after remove_person is invalid', validateProject(after));
    p.undo();
    if (creativeProjection(p.doc()) !== creativeProjection(full)) return 'undo of remove_person does not return the tags';
    evidence.P14 = { removeAssetSummary: ra.summary, removePersonSummary: rp.summary, removeAssetSaysCount: /marked range/.test(ra.summary) };
    return true;
  } finally { p.close(); }
});

// ---------------------------------------------------------------- media (P6, P8)
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30 });
/** The barcode of every frame of a file, decoded by FFmpeg. */
function barcodes(file: string): number[] {
  const raw = ff(['-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const fb = W * H * 3;
  return Array.from({ length: raw.length / fb }, (_, i) => readBarcode(raw.subarray(i * fb, (i + 1) * fb), W, 3, { x: 0, y: 0, w: W, h: H }));
}
interface Media { a30: number[]; n2997: number[]; copy: number[]; reversed: number[] }
async function makeMedia(): Promise<Media> {
  const dir = tmp('media');
  const a30 = await generateBarcodeFixture({ out: path.join(dir, 'a30.mp4'), width: W, height: H, fps: R, frames: 300 });
  const n = await generateBarcodeFixture({ out: path.join(dir, 'n2997.mp4'), width: W, height: H, fps: NTSC, frames: 300 });
  // the time-preserving copy: the 30 fps file from 1 s on (its time zero is the original's 1 s), 200 frames
  ff(['-y', '-ss', '1', '-i', a30.file, '-frames:v', '200', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', path.join(dir, 'copy.mp4')]);
  // the untimed copy: the file reversed (no time mapping is recorded for it)
  ff(['-y', '-i', a30.file, '-vf', 'reverse', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', path.join(dir, 'reversed.mp4')]);
  return { a30: barcodes(a30.file), n2997: barcodes(n.file), copy: barcodes(path.join(dir, 'copy.mp4')), reversed: barcodes(path.join(dir, 'reversed.mp4')) };
}
/** floor and ceil of a rational time times a frame rate, with integers. */
const floorAt = (t: T.RationalTime, fps: T.Rate) => { const n = BigInt(t.value) * BigInt(fps.num), d = BigInt(t.timescale) * BigInt(fps.den); return Number(n / d - (n % d !== 0n && n < 0n ? 1n : 0n)); };
const ceilAt = (t: T.RationalTime, fps: T.Rate) => { const n = BigInt(t.value) * BigInt(fps.num), d = BigInt(t.timescale) * BigInt(fps.den); return Number(n / d + (n % d !== 0n && n > 0n ? 1n : 0n)); };

let ppSeq = 0;
/** The film of P6/P8, built through the operations: forward, reversed, 2×, ramped, a freeze, the 29.97 file, the copy and the untimed copy on V1. */
function buildFilm(media: Media) {
  const tx = (doc: ProjectDocument, ops: OpCall[], internal = false) => applyTransaction(doc, ops, { idSeed: `pp${ppSeq++}_`, actor: OWNER, allowInternal: internal });
  let r = tx(createProject({ id: 'prj_pearls_p6', name: 'P6', width: W, height: H, frameRate: R }), [
    { op: 'import_asset', args: { asset: videoFacts('a30.mp4', R, media.a30.length) } },
    { op: 'import_asset', args: { asset: videoFacts('n2997.mp4', NTSC, media.n2997.length) } },
  ], true);
  const [a30, n2997] = r.results.map((x) => x.output!.assetId as string) as [string, string];
  r = tx(r.doc, [
    { op: 'import_asset', args: { asset: videoFacts('copy.mp4', R, media.copy.length, { provenance: derivedProv(a30, T.rt(1, 1)) as Asset['provenance'] }) } },
    { op: 'import_asset', args: { asset: videoFacts('reversed.mp4', R, media.reversed.length, { provenance: derivedProv(a30, undefined, 'local.video.reverse') as Asset['provenance'] }) } },
  ], true);
  const [copy, reversed] = r.results.map((x) => x.output!.assetId as string) as [string, string];
  const fileOf: Record<string, number[]> = { [a30]: media.a30, [n2997]: media.n2997, [copy]: media.copy, [reversed]: media.reversed };
  let doc = r.doc;
  const place = (assetId: string, start: number, frames: number, sourceIn = f(0)) => {
    const v1 = doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!.id;
    const x = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(start), sourceIn, duration: f(frames), trackId: v1, withLinkedAudio: false } }]);
    doc = x.doc;
    return x.results[0]!.output!.clipId as string;
  };
  const fwd = place(a30, 0, 100);
  const rev = place(a30, 100, 100); doc = tx(doc, [{ op: 'set_clip_reverse', args: { clipId: rev, reverse: true } }]).doc;
  const fast = place(a30, 200, 120); doc = tx(doc, [{ op: 'set_clip_speed', args: { clipId: fast, speed: 2 } }]).doc;
  const ramp = place(a30, 400, 120); doc = tx(doc, [{ op: 'set_clip_speed_ramp', args: { clipId: ramp, from: 0.5, to: 2 } }]).doc;
  place(n2997, 600, 120);
  place(copy, 800, 120);
  place(reversed, 1000, 120);
  doc = tx(doc, [{ op: 'freeze_frame', args: { clipId: fwd, at: f(40), duration: f(10) } }]).doc;
  // the ranges, through the operation
  const ranges: Record<string, { assetId: string; start: T.RationalTime; end: T.RationalTime }> = {
    pearl: { assetId: a30, start: f(30), end: f(75) },
    word: { assetId: a30, start: T.rt(1037, 1000), end: T.rt(2519, 1000) },
    ntsc: { assetId: n2997, start: f(30), end: f(75) },
    onCopy: { assetId: copy, start: f(15), end: f(30) },
  };
  const ids: Record<string, string> = {};
  for (const [k, v] of Object.entries(ranges)) { const x = tx(doc, [{ op: 'add_source_range', args: v }]); doc = x.doc; ids[k] = x.results[0]!.output!.rangeId as string; }
  const issues = validateProject(doc);
  if (issues.length) throw new Error(`the P6 film is invalid: ${JSON.stringify(issues.slice(0, 3))}`);
  return { doc, ids, ranges, fileOf, assets: { a30, n2997, copy, reversed } };
}
/** What each programme frame shows on V1: the file and the barcode read from the decoded source frame the evaluator draws. */
export function shownBarcodes(doc: ProjectDocument, fileOf: Record<string, number[]>): ({ assetId: string; clipId: string; barcode: number } | null)[] {
  const seq = doc.sequences[doc.mainSequenceId]!;
  const end = Math.max(...seq.tracks.flatMap((t) => t.clips.map((c) => T.frameIndexAt(T.add(c.start, c.duration), R))));
  return Array.from({ length: end }, (_, i) => {
    const layer = evaluate(doc, f(i)).layers.find((l) => l.kind === 'video') as { assetId: string; clipId: string; sourceFrameIndex: number } | undefined;
    if (!layer) return null;
    const bc = fileOf[layer.assetId]?.[layer.sourceFrameIndex];
    if (bc === undefined) throw new Error(`frame ${i}: no decoded frame ${layer.sourceFrameIndex} of ${layer.assetId}`);
    return { assetId: layer.assetId, clipId: layer.clipId, barcode: bc };
  });
}
/**
 * P6's comparison: expected frames of each range from the barcodes shown (`renderedBarcodes` may come from an exported file), against
 * the frames rangeUsage reports on picture tracks. A copy's barcodes are the original's numbers; an untimed copy never counts.
 */
export function p6Compare(film: ReturnType<typeof buildFilm>, shown: ReturnType<typeof shownBarcodes>) {
  const u = rangeUsage(film.doc);
  const fpsOf = (assetId: string) => film.doc.assets[assetId]!.video!.frameRate;
  const rows: Record<string, { expected: number; reported: number; equal: boolean; sample: number[] }> = {};
  for (const [k, id] of Object.entries(film.ids)) {
    const r = film.ranges[k]!;
    // in barcode numbers of the file the barcodes come from: the original's for the original and the copy; the copy's range is the original's [1 s + s, 1 s + e)
    const onCopy = r.assetId === film.assets.copy;
    const base = onCopy ? film.assets.a30 : r.assetId;
    const shift = onCopy ? T.rt(1, 1) : T.ZERO;
    const lo = floorAt(T.add(r.start, shift), fpsOf(base)), hi = Math.max(lo + 1, ceilAt(T.add(r.end, shift), fpsOf(base)));
    const related = new Set(base === film.assets.a30 ? [film.assets.a30, film.assets.copy] : [base]);
    const expected = shown.flatMap((x, i) => (x && related.has(x.assetId) && x.barcode >= lo && x.barcode < hi ? [i] : []));
    const reported = u.ranges[id]!.uses.filter((x) => x.medium === 'picture').flatMap((x) => Array.from({ length: x.toFrame - x.fromFrame }, (_, j) => x.fromFrame + j)).sort((a, b) => a - b);
    rows[k] = { expected: expected.length, reported: reported.length, equal: JSON.stringify(expected) === JSON.stringify(reported), sample: expected.slice(0, 4) };
  }
  return { rows, untimed: u.ranges[film.ids.pearl!]!.untimedCopies };
}

let mediaCache: Media | null = null;
const P6 = check(async () => {
  const media = (mediaCache ??= await makeMedia());
  // the fixture's truth: decoded frame i of each file shows barcode i; the copy starts at the original's frame 30; the reversed copy ends at 0
  if (media.a30.some((b, i) => b !== i) || media.n2997.some((b, i) => b !== i)) return 'a barcode fixture does not read back as its frame numbers';
  if (media.copy[0] !== 30 || media.copy.some((b, i) => b !== 30 + i)) return fail('the time-preserving copy is not the original from 1 s on', media.copy.slice(0, 5));
  if (media.reversed[0] !== 299 || media.reversed[299] !== 0) return fail('the untimed copy is not reversed', [media.reversed[0], media.reversed[299]]);
  const film = buildFilm(media);
  const shown = shownBarcodes(film.doc, film.fileOf);
  const cmp = p6Compare(film, shown);
  evidence.P6 = { mode: 'evaluate() source frame, barcode read from the decoded file (no export)', programmeFrames: shown.length, ranges: cmp.rows };
  const bad = Object.entries(cmp.rows).filter(([, r]) => !r.equal || r.expected === 0);
  return bad.length ? fail('usage differs from the barcodes shown', bad) : true;
});
const P8 = check(async () => {
  const media = (mediaCache ??= await makeMedia());
  const film = buildFilm(media);
  const u = rangeUsage(film.doc).ranges[film.ids.pearl!]!;
  const copyClip = film.doc.sequences[film.doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.type === 'media' && c.assetId === film.assets.copy) as MediaClip;
  const onCopy = u.uses.filter((x) => x.clipId === copyClip.id);
  const start = T.frameIndexAt(copyClip.start, R);
  // the copy's frame j shows the original's barcode 30 + j: the pearl [30, 75) is the copy's frames 0..44
  const want = [{ fromFrame: start, toFrame: start + 45 }];
  const got = onCopy.map((x) => ({ fromFrame: x.fromFrame, toFrame: x.toFrame }));
  evidence.P8 = { onCopy: got, untimedCopies: u.untimedCopies, reversedCounted: u.uses.some((x) => film.doc.sequences[film.doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).some((c) => c.id === x.clipId && c.type === 'media' && c.assetId === film.assets.reversed)) };
  if (JSON.stringify(got) !== JSON.stringify(want)) return fail('the copy\'s use', { got, want });
  if (JSON.stringify(u.untimedCopies) !== JSON.stringify([film.assets.reversed])) return fail('the untimed copy is not named', u.untimedCopies);
  if (evidence.P8 && (evidence.P8 as { reversedCounted: boolean }).reversedCounted) return 'the untimed copy was counted';
  if (JSON.stringify(onCopy[0]!.source) !== JSON.stringify({ start: f(30), end: f(75) })) return fail('the copy\'s use in the original\'s time', onCopy[0]!.source);
  return true;
});

// ---------------------------------------------------------------- P15 (Node side), P16
/**
 * The 20 fuzzed documents of P15: random public operations and marked-range calls (Hebrew and Latin labels) on the fuzz library,
 * with the people «אלף», «בית», "Gimel" made by operations and "gimel" (the same name key as "Gimel", in another case) written in
 * directly so that the order of names that differ only in case is exercised (such a document is not one add_person would make).
 */
export function pearlsDeterminismDocs(count = 20): ProjectDocument[] {
  const docs: ProjectDocument[] = [];
  for (let seed = 1; seed <= count; seed++) {
    const fz = createFuzz(seed + 15_000);
    let k = 0;
    const ctx = (allowInternal = false) => ({ idSeed: `pd${seed}_${k++}_`, actor: OWNER, allowInternal });
    let doc = applyTransaction(createProject({ id: `prj_pd${seed}`, name: 'pd', width: W, height: H, frameRate: fz.rate }), fz.importOps, ctx(true)).doc;
    doc = applyTransaction(doc, [...fz.setup(doc), { op: 'add_person', args: { name: 'אלף' } }, { op: 'add_person', args: { name: 'בית' } }, { op: 'add_person', args: { name: 'Gimel' } }], ctx()).doc;
    for (let step = 0; step < 60; step++) {
      const call = step % 2 === 0 ? fz.genPearls(doc) : fz.genFocused(doc, ['add_clip', 'trim_clip', 'set_clip_speed', 'freeze_frame', 'set_clip_reverse']);
      try { doc = applyTransaction(doc, [call], ctx()).doc; } catch { /* a refusal changes nothing */ }
    }
    // "gimel" beside "Gimel", written in directly, with a whole-file tag on the first file
    doc = structuredClone(doc);
    doc.people!.per_gimel_lower = { id: 'per_gimel_lower', name: 'gimel', birthDate: null };
    const first = Object.keys(doc.assets).sort()[0]!;
    (doc.sourceRanges ??= {}).rng_gimel_lower = { id: 'rng_gimel_lower', assetId: first, kind: 'presence', span: null, label: '', people: ['per_gimel_lower'], createdBy: OWNER };
    docs.push(doc);
  }
  return docs;
}
const P15 = check(() => {
  const docs = pearlsDeterminismDocs();
  const d1 = pearlsDigest(docs);
  const d2 = pearlsDigest(JSON.parse(JSON.stringify(docs)) as ProjectDocument[]);
  const ranges = docs.reduce((n, d) => n + Object.keys(d.sourceRanges ?? {}).length, 0);
  evidence.P15 = { node: d1, documents: docs.length, ranges, browser: 'compared by the integration run (window.__pfPearlsHash over pearlsDeterminismDocs())' };
  if (ranges < 20) return fail('the fuzzed documents hold too few ranges', ranges);
  return d1 === d2 ? true : fail('the digest differs across a JSON round trip', { d1, d2 });
});
/** A synthetic big film: 700 picture clips over 50 files (probe facts only), 300 ranges, 12 people. */
export function bigFilm(): ProjectDocument {
  const doc = createProject({ id: 'prj_pearls_big', name: 'big', width: W, height: H, frameRate: R });
  for (let i = 0; i < 50; i++) doc.assets[`ast_b${i}`] = { id: `ast_b${i}`, ...videoFacts(`b${i}.mp4`, i % 3 === 0 ? NTSC : R, 600) } as Asset;
  doc.people = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`per_${i}`, { id: `per_${i}`, name: `person ${i}`, birthDate: null }]));
  const v = doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!;
  for (let i = 0; i < 700; i++) v.clips.push({ id: `clp_b${i}`, type: 'media', assetId: `ast_b${i % 50}`, start: f(i * 40), duration: f(40), sourceIn: f((i * 7) % 500), gain: 1, linkGroupId: null, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, ...(i % 5 === 0 ? { reverse: true } : {}) } as MediaClip);
  doc.sourceRanges = {};
  for (let i = 0; i < 300; i++) {
    const s = (i * 13) % 550;
    doc.sourceRanges[`rng_b${i}`] = { id: `rng_b${i}`, assetId: `ast_b${i % 50}`, kind: 'pearl', span: { start: f(s), end: f(s + 10 + (i % 40)) }, label: '', people: [`per_${i % 12}`], createdBy: 't' } as SourceRange;
  }
  return doc;
}
const P16 = check(() => {
  const doc = bigFilm();
  const t0 = performance.now();
  const u = rangeUsage(doc);
  const t1 = performance.now();
  const st = screenTime(doc);
  const t2 = performance.now();
  // commit time with 2000 ranges: a project imported with 1999, then the 2000th added through the Store
  const big = createProject({ id: 'prj_pearls_2000', name: 'p2000', width: W, height: H, frameRate: R });
  big.assets.ast_v = { id: 'ast_v', ...videoFacts('v.mp4', R, 9000) } as Asset;
  big.sourceRanges = {};
  for (let i = 0; i < 1999; i++) big.sourceRanges[`rng_k${i}`] = { id: `rng_k${i}`, assetId: 'ast_v', kind: 'pearl', span: { start: f(i * 4), end: f(i * 4 + 3) }, label: 'סופגנייה של דינוזאורים', createdBy: OWNER };
  const p = new Proj(big);
  try {
    const c0 = performance.now();
    p.commit([{ op: 'add_source_range', args: { assetId: 'ast_v', start: f(8990), end: f(8999) } }]);
    const c1 = performance.now();
    p.commit([{ op: 'add_marker', args: { time: f(10), label: 'x' } }]);
    const c2 = performance.now();
    let refused: string | null = null;
    try { p.commit([{ op: 'add_source_range', args: { assetId: 'ast_v' } }]); } catch (e) { refused = e instanceof ApiError ? e.code : String(e); }
    evidence.P16 = {
      sample: 'one sample each (shared machine)',
      usageMs700x300: +(t1 - t0).toFixed(1), screenTimeMs: +(t2 - t1).toFixed(1), uses: Object.values(u.ranges).reduce((n, r) => n + r.uses.length, 0), pictureFrames: st.pictureFrames,
      commitMsAdd2000th: +(c1 - c0).toFixed(1), commitMsOtherOpAt2000: +(c2 - c1).toFixed(1), the2001stRefused: refused,
      documentBytes: JSON.stringify(p.doc()).length,
    };
  } finally { p.close(); }
  return true;
});

export const PEARLS_PROOF_CORE: PearlsProofPart = { built: true, checks: { P1, P6, P8, P14, P15, P16 }, evidence };

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  let failed = 0;
  for (const [name, run] of Object.entries(PEARLS_PROOF_CORE.checks)) {
    const r = await run();
    if (r !== true) failed++;
    console.log(`${r === true ? '  ok  ' : ' FAIL '} ${name}${r === true ? '' : `  ${r}`}`);
  }
  console.log(JSON.stringify(evidence, null, 1));
  process.exit(failed ? 1 : 0);
}
