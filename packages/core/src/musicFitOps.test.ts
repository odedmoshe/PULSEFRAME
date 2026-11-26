/**
 * The four musicfit operations and their exact helpers (wave 7; builder A): set_clip_impact, sync_impact (through timelineOfSource,
 * reversed clips, nearest-frame beats, residual at most half a frame, linked sound, exact undo, every refusal), add_fitted_music
 * (licence again, the copied record, the grid, the removal, dedup, placing) and mark_join_heard; musicAt (muted tracks, lineage),
 * cutStats, fittedGrid and orderCandidates.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, cutStats, diffEntities, FIT_GRID_METHOD, FIT_METHOD, fittedGrid, MUSICFIT_REFUSALS, musicAt, OpError, orderCandidates, planImpact, validateProject,
  type Asset, type JoinCandidate, type LibraryRecord, type MediaClip, type ProjectDocument, type SyncImpactOutput,
} from './index.ts';

const R = { num: 30, den: 1 };
const hash = (n: number) => `sha256:${n.toString(16).padStart(64, '0')}`;
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const video = (id: string, n: number, seconds = 10): Asset => ({ id, kind: 'video', name: `${id}.mp4`, contentHash: hash(n), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(seconds, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: seconds * 30 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov });
const sound = (id: string, n: number, over: Partial<Asset> = {}): Asset => ({ id, kind: 'audio', name: `${id}.wav`, contentHash: hash(n), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov, ...over });
const still = (id: string, n: number): Asset => ({ id, kind: 'image', name: `${id}.png`, contentHash: hash(n), byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.rt(5, 1), image: { width: 64, height: 64 }, provenance: prov } as Asset);
let seed = 0;
const tx = (doc: ProjectDocument, ops: { op: string; args: unknown }[]) => applyTransaction(doc, ops, { idSeed: `mfo${seed++}_`, actor: 'user:owner', allowInternal: true });
const clipsOf = (doc: ProjectDocument) => Object.values(doc.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).filter((c): c is MediaClip => c.type === 'media');
const clip = (doc: ProjectDocument, id: string) => clipsOf(doc).find((c) => c.id === id)!;
const refusalOf = (fn: () => unknown): { code: string; message: string } => { try { fn(); } catch (e) { if (e instanceof OpError) return { code: e.code, message: e.message }; throw e; } throw new Error('not refused'); };
/** A steady grid: beats every `period` seconds from `first`, bar starts every fourth. */
function grid(period: T.RationalTime, count: number, first: T.RationalTime = T.ZERO) {
  const beats = Array.from({ length: count }, (_, k) => T.normalize(T.add(first, { value: (BigInt(period.value) * BigInt(k)).toString(), timescale: period.timescale })));
  return { origin: { method: 'test grid', params: {}, createdAt: prov.importedAt, createdBy: 'test', edited: false }, bpm: 60 / T.toSeconds(period), confidence: 0.9, beats, downbeats: beats.filter((_, k) => k % 4 === 0), meter: 4 };
}
/**
 * Video ast_v (10 s, with sound) at 0, showing source 2 s … 6 s, its sound linked; music ast_m (60 s, 120 BPM: beats every 0.5 s) on
 * its own sound track from 0. 30 fps.
 */
function base(opts: { musicPeriod?: T.RationalTime; linked?: boolean } = {}) {
  let doc = createProject({ id: 'prj_imp', name: 'I', width: 640, height: 360 });
  doc.assets.ast_v = video('ast_v', 1);
  doc.assets.ast_m = sound('ast_m', 2);
  doc.analyses.ast_m = { assetId: 'ast_m', beats: grid(opts.musicPeriod ?? T.rt(1, 2), 100) };
  const r = tx(doc, [
    { op: 'add_clip', args: { assetId: 'ast_v', start: T.ZERO, sourceIn: T.rt(2, 1), duration: T.rt(4, 1), withLinkedAudio: opts.linked ?? true } },
    { op: 'add_clip', args: { assetId: 'ast_m', start: T.ZERO, withLinkedAudio: false } },
  ]);
  doc = r.doc;
  const v = r.results[0]!.output!.clipId as string, m = r.results[1]!.output!.clipId as string;
  return { doc, v, m };
}
const frameOf = (doc: ProjectDocument, c: MediaClip, s: T.RationalTime) => {
  // independent of impact.ts: forward = floor((start + (s − sourceIn)) · fps); reversed = ceil(...) − 1 of start + (sourceEnd − s)
  const end = T.add(c.sourceIn, c.duration);
  const t = c.reverse ? T.add(c.start, T.sub(end, s)) : T.add(c.start, T.sub(s, c.sourceIn));
  const x = T.toSeconds(t) * 30;
  return c.reverse ? Math.ceil(x - 1e-9) - 1 : Math.floor(x + 1e-9);
};

describe('set_clip_impact', () => {
  it('marks and clears a moment of the file; refuses a still, a freeze frame, a title and a moment outside the file, in table order', () => {
    const { doc, v } = base();
    const marked = tx(doc, [{ op: 'set_clip_impact', args: { clipId: v, moment: T.rt(31, 10) } }]).doc;
    expect(clip(marked, v).impact).toEqual(T.rt(31, 10));
    expect(validateProject(marked).filter((i) => i.code === 'clip_impact')).toEqual([]);
    expect(clip(tx(marked, [{ op: 'set_clip_impact', args: { clipId: v, moment: null } }]).doc, v).impact).toBeUndefined();
    // a moment outside what the clip shows is still a moment of the file
    expect(clip(tx(doc, [{ op: 'set_clip_impact', args: { clipId: v, moment: T.rt(9, 1) } }]).doc, v).impact).toEqual(T.rt(9, 1));
    expect(refusalOf(() => tx(doc, [{ op: 'set_clip_impact', args: { clipId: v, moment: T.rt(10, 1) } }])).message).toBe(MUSICFIT_REFUSALS.impactOutsideFile.message());
    expect(refusalOf(() => tx(doc, [{ op: 'set_clip_impact', args: { clipId: v, moment: T.rt(-1, 30) } }])).code).toBe('out_of_bounds');
    const s = structuredClone(doc); s.assets.ast_p = still('ast_p', 3);
    const withStill = tx(s, [{ op: 'add_clip', args: { assetId: 'ast_p', start: T.rt(10, 1), duration: T.rt(2, 1) } }]);
    const p = withStill.results[0]!.output!.clipId as string;
    expect(refusalOf(() => tx(withStill.doc, [{ op: 'set_clip_impact', args: { clipId: p, moment: T.ZERO } }])).message).toBe(MUSICFIT_REFUSALS.impactNoMoment.message());
    const frozen = structuredClone(doc); clip(frozen, v).freeze = true;
    expect(refusalOf(() => tx(frozen, [{ op: 'set_clip_impact', args: { clipId: v, moment: T.rt(3, 1) } }])).message).toBe(MUSICFIT_REFUSALS.impactNoMoment.message());
    const titled = tx(doc, [{ op: 'add_text', args: { text: 'כותרת', start: T.rt(10, 1), duration: T.rt(1, 1) } }]);
    const title = titled.results[0]!.output!.clipId as string;
    expect(refusalOf(() => tx(titled.doc, [{ op: 'set_clip_impact', args: { clipId: title, moment: T.ZERO } }])).message).toBe(MUSICFIT_REFUSALS.impactNoMoment.message());
    expect(refusalOf(() => tx(doc, [{ op: 'set_clip_impact', args: { clipId: 'clp_none', moment: null } }])).code).toBe('not_found');
  });
});

describe('sync_impact', () => {
  it('brings the moment to the nearest beat frame: the clip keeps its place and length, linked sound slips alike, offset and residual reported, undo exact', () => {
    const { doc, v, m } = base();
    const before = clip(doc, v);
    // moment 3.1 s of the file → timeline 1.1 s → frame 33; beats at 1.0 s (frame 30) and 1.5 s (frame 45): nearest is frame 30
    const r = tx(doc, [{ op: 'sync_impact', args: { clipId: v, moment: T.rt(31, 10), to: 'beat' } }]);
    const out = r.results[0]!.output as unknown as SyncImpactOutput;
    const after = clip(r.doc, v);
    expect([after.start, after.duration]).toEqual([before.start, before.duration]);
    expect(after.impact).toEqual(T.rt(31, 10));
    expect(T.eq(after.sourceIn, T.add(before.sourceIn, T.rt(1, 10)))).toBe(true);
    expect(frameOf(r.doc, after, T.rt(31, 10))).toBe(30);
    expect(out.offsetBefore).toEqual({ frames: 3, ms: 100 });
    expect(out.residualMs).toBe(0);
    expect([out.musicClipId, out.viaAssetId]).toEqual([m, 'ast_m']);
    expect(T.eq(out.by, T.frameTime(3, R))).toBe(true);
    const sound = clipsOf(r.doc).find((c) => c.id !== v && c.linkGroupId && c.linkGroupId === after.linkGroupId)!;
    expect(T.eq(sound.sourceIn, after.sourceIn)).toBe(true);
    expect(validateProject(r.doc)).toEqual([]);
    const changes = diffEntities(doc, r.doc);
    const back = tx(r.doc, [{ op: 'restore_entities', args: { targets: changes.map((c) => ({ id: c.id, state: c.before })) } }]).doc;
    expect(diffEntities(doc, back)).toEqual([]);
  });
  it('bar starts, earlier and later picks, and a tie that goes to the earlier frame', () => {
    const { doc, v } = base();
    const marked = tx(doc, [{ op: 'set_clip_impact', args: { clipId: v, moment: T.rt(31, 10) } }]).doc;
    const bar = planImpact(marked, v, undefined, 'bar');
    expect('refusal' in bar ? bar : bar.targetFrame).toBe(60); // bar starts every 2 s: 0 and 2 s (frame 60) inside the clip; 33 is nearer 60 than 0
    const later = planImpact(marked, v, undefined, 'beat', 'later');
    expect('refusal' in later ? later : later.targetFrame).toBe(45);
    const earlier = planImpact(marked, v, undefined, 'beat', 'earlier');
    expect('refusal' in earlier ? earlier : earlier.targetFrame).toBe(30);
    // frame 37 or 38 is 7 or 8 from 30 and 45: at 37.5 (between) the moment's frame is 37 → 30 (7 < 8); a moment on frame 38 → 45
    const tie = planImpact(doc, v, T.add(T.rt(2, 1), T.frameTime(37, R)), 'beat');
    expect('refusal' in tie ? tie : tie.targetFrame).toBe(30);
  });
  it('a reversed clip: by has the other sign and the moment lands on the beat frame', () => {
    const { doc, v } = base({ linked: false });
    const rev = tx(doc, [{ op: 'set_clip_reverse', args: { clipId: v, reverse: true } }]).doc;
    // reversed, source 3.1 s is shown at timeline (6 − 3.1) = 2.9 s → frame 86 (interval (2.866…, 2.9]); nearest beat 3.0 s → frame 90
    const plan = planImpact(rev, v, T.rt(31, 10), 'beat');
    if ('refusal' in plan) throw new Error(plan.refusal);
    expect([plan.momentFrame, plan.targetFrame]).toEqual([86, 90]);
    expect(T.eq(plan.by, T.frameTime(4, R))).toBe(true);
    const r = tx(rev, [{ op: 'sync_impact', args: { clipId: v, moment: T.rt(31, 10), to: 'beat' } }]);
    expect(frameOf(r.doc, clip(r.doc, v), T.rt(31, 10))).toBe(90);
  });
  it('a beat between frames goes to its nearest frame and the residual is signed, at most half a frame (128 BPM)', () => {
    const { doc, v } = base({ musicPeriod: T.rt(15, 32) }); // 128 BPM: 0.46875 s
    for (const s of [T.rt(31, 10), T.rt(37, 10), T.rt(5, 1)]) {
      const plan = planImpact(doc, v, s, 'beat');
      if ('refusal' in plan) { expect(plan.refusal).toBe('alreadyOnBeat'); continue; }
      expect(Math.abs(plan.residualMs)).toBeLessThanOrEqual(1000 / 60 + 1e-9);
      expect(plan.targetFrame).toBe(Math.round(T.toSeconds(plan.used) * 30));
      const r = tx(doc, [{ op: 'sync_impact', args: { clipId: v, moment: s, to: 'beat' } }]);
      expect(frameOf(r.doc, clip(r.doc, v), s)).toBe(plan.targetFrame);
    }
  });
  it('refuses in table order: noImpact, impactOutsideFile, impactOutside, noMusic (also under a muted track), noRoom with both limits, alreadyOnBeat; slip_clip\'s own refusals stay', () => {
    const { doc, v, m } = base();
    const msg = (args: Record<string, unknown>, d = doc) => refusalOf(() => tx(d, [{ op: 'sync_impact', args: { clipId: v, to: 'beat', ...args } }])).message;
    expect(msg({})).toBe(MUSICFIT_REFUSALS.noImpact.message());
    expect(msg({ moment: T.rt(11, 1) })).toBe(MUSICFIT_REFUSALS.impactOutsideFile.message());
    expect(msg({ moment: T.rt(7, 1) })).toBe(MUSICFIT_REFUSALS.impactOutside.message());
    const muted = structuredClone(doc);
    const musicTrack = muted.sequences.seq_main!.tracks.find((t) => t.clips.some((c) => c.id === m))!;
    musicTrack.muted = true;
    expect(msg({ moment: T.rt(31, 10) }, muted)).toBe(MUSICFIT_REFUSALS.noMusic.message());
    expect(musicAt(muted, T.rt(1, 1))).toBeNull();
    expect(msg({ moment: T.rt(3, 1) })).toBe(MUSICFIT_REFUSALS.alreadyOnBeat.message()); // 3 s → timeline 1 s = frame 30 = a beat
    // no room: the clip shows its file from 0, the moment at 0.1 s needs later source (the beat at 0 s is frame 0, the moment frame 3)
    const tight = tx(createProject({ id: 'prj_t', name: 'T', width: 640, height: 360 }), []).doc;
    tight.assets.ast_v = video('ast_v', 1, 4); tight.assets.ast_m = sound('ast_m', 2); tight.analyses.ast_m = { assetId: 'ast_m', beats: grid(T.rt(1, 2), 100) };
    const t2 = tx(tight, [{ op: 'add_clip', args: { assetId: 'ast_v', start: T.ZERO, withLinkedAudio: false } }, { op: 'add_clip', args: { assetId: 'ast_m', start: T.ZERO, withLinkedAudio: false } }]);
    const tv = t2.results[0]!.output!.clipId as string;
    let err: OpError | null = null;
    try { tx(t2.doc, [{ op: 'sync_impact', args: { clipId: tv, moment: T.rt(1, 10), to: 'beat' } }]); } catch (e) { err = e as OpError; }
    expect(err?.message).toBe(MUSICFIT_REFUSALS.noRoom.message());
    expect(err?.details).toMatchObject({ maxEarlier: T.ZERO, maxLater: T.ZERO });
    // the music clip itself, slipped to its own beats, is never the music: no other music → noMusic
    expect(refusalOf(() => tx(doc, [{ op: 'sync_impact', args: { clipId: m, moment: T.rt(1, 10), to: 'beat' } }])).message).toBe(MUSICFIT_REFUSALS.noMusic.message());
  });
});

describe('musicAt', () => {
  it('reads beats through a time-preserving copy (viaAssetId names the measured source) and places only the beats the clip shows', () => {
    const doc = createProject({ id: 'prj_ma', name: 'M', width: 640, height: 360 });
    doc.assets.ast_m = sound('ast_m', 2);
    doc.analyses.ast_m = { assetId: 'ast_m', beats: grid(T.rt(1, 2), 100) };
    doc.assets.ast_c = sound('ast_c', 3, { duration: T.rt(20, 1), provenance: { origin: 'derived', importedAt: prov.importedAt, importedBy: 'test', derived: { jobId: 'j', capabilityId: 'c', capabilityVersion: '1', graphDigest: 'g', params: {}, sourceAssetIds: ['ast_m'], outputName: 'o', outputRole: 'audio', encoding: 'pcm', provider: {}, sourceRangeStart: T.rt(1, 4) } } });
    const r = tx(doc, [{ op: 'add_clip', args: { assetId: 'ast_c', start: T.rt(2, 1), sourceIn: T.rt(1, 1), duration: T.rt(2, 1), withLinkedAudio: false } }]);
    const u = musicAt(r.doc, T.rt(3, 1))!;
    expect(u.viaAssetId).toBe('ast_m');
    // the copy's own clock: source beats k/2 − 1/4; shown [1, 3) → 1.25, 1.75, 2.25, 2.75 → timeline + 1
    expect(u.beats.map((b) => T.toSeconds(b))).toEqual([2.25, 2.75, 3.25, 3.75]);
    expect(u.bars.map((b) => T.toSeconds(b))).toEqual([2.75]); // source bar starts 0, 2, 4 s → copy 1.75 s → timeline 2.75 s
    expect(musicAt(r.doc, T.rt(5, 1))).toBeNull();
    expect(musicAt(r.doc, T.rt(1, 1))).toBeNull();
  });
});

describe('cutStats', () => {
  it('counts distinct cuts, the shortest gap and the most in one second', () => {
    expect(cutStats([], 30)).toEqual({ cuts: 0, minGapFrames: null, maxInOneSecond: 0 });
    expect(cutStats([0, 90, 30, 30, 45, 52], 30)).toEqual({ cuts: 5, minGapFrames: 7, maxInOneSecond: 3 });
  });
});

describe('fittedGrid and orderCandidates (decisions §2.11)', () => {
  const src = { beats: Array.from({ length: 40 }, (_, k) => T.rt(k, 2)), downbeats: Array.from({ length: 10 }, (_, k) => T.rt(2 * k, 1)), duration: T.rt(21, 1) };
  it('beats before the removal shift by startAt, after it by startAt + (to − from), inside it are gone; outside the usable end dropped', () => {
    const g = fittedGrid(src, T.rt(2, 1), { from: T.rt(6, 1), to: T.rt(10, 1) }, T.rt(18, 1))!;
    expect(g.joinAt).toEqual(T.rt(4, 1));
    expect(T.eq(g.duration, T.rt(12, 1))).toBe(true);
    expect(g.downbeats.map((t) => T.toSeconds(t))).toEqual([0, 2, 4, 6, 8, 10]);
    expect(g.beats.length).toBe(8 + 16);
    expect(g.beats.every((b, i) => i === 0 || T.lt(g.beats[i - 1]!, b))).toBe(true);
  });
  it('null for a removal that does not fit and for a source that is not ascending', () => {
    expect(fittedGrid(src, T.rt(8, 1), { from: T.rt(6, 1), to: T.rt(10, 1) }, T.rt(18, 1))).toBeNull();
    expect(fittedGrid(src, T.ZERO, { from: T.rt(6, 1), to: T.rt(6, 1) }, T.rt(18, 1))).toBeNull();
    expect(fittedGrid({ ...src, beats: [T.rt(1, 1), T.rt(1, 2)] }, T.ZERO, { from: T.rt(6, 1), to: T.rt(10, 1) }, T.rt(18, 1))).toBeNull();
  });
  it('orders by cost (to 1e-6), then phrase, then distance from the wanted length, then the earlier from; at most three', () => {
    const c = (from: number, cost: number, phraseBars: 1 | 2 | 4, madeSeconds: number): JoinCandidate & { cost: number } => ({ removal: { from: T.rt(from, 1), to: T.rt(from + 8, 1) }, madeSeconds, offBySeconds: madeSeconds - 30, measured: { similarity: 1 - cost, levelStepDb: 0, phraseBars, tempoSpreadMs: 1, beatConfidence: null }, cost });
    const out = orderCandidates([c(40, 0.2, 4, 30), c(8, 0.1000004, 1, 30), c(16, 0.1000001, 2, 31), c(24, 0.1, 2, 29.5), c(32, 0.1, 2, 29.5)], 30);
    expect(out.map((x) => T.toSeconds(x.removal.from))).toEqual([24, 32, 16]);
    expect(out.every((x) => !('cost' in x))).toBe(true);
  });
});

describe('add_fitted_music and mark_join_heard', () => {
  const record = (over: Partial<LibraryRecord> = {}): LibraryRecord => ({ itemId: 'src-a/song.wav', sourceId: 'src-a', kind: 'music', title: 'Song A', sourceSha256: 'a'.repeat(64), ledger: { item: 'src-a' }, licence: { id: 'CC-BY-4.0' }, credit: { text: '"Song A" by Someone, CC BY 4.0', placement: 'description' }, flags: {}, ...over });
  function lib(rec: LibraryRecord | null) {
    const doc = createProject({ id: 'prj_fm', name: 'F', width: 640, height: 360 });
    doc.assets.ast_s = sound('ast_s', 6, rec ? { provenance: { origin: 'upload', importedAt: prov.importedAt, importedBy: 'user:local', library: rec } } : {});
    doc.analyses.ast_s = { assetId: 'ast_s', beats: grid(T.rt(1, 2), 100) };
    return doc;
  }
  const made = (over: Record<string, unknown> = {}, library: LibraryRecord | null = record()) => ({
    kind: 'audio', name: 'Song A (shortened).wav', contentHash: hash(77), byteSize: 1000, container: 'wav', mimeType: 'audio/wav', duration: T.rt(40, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' },
    provenance: { origin: 'derived', importedAt: prov.importedAt, importedBy: 'user:owner', ...(library ? { library } : {}), fitted: { sourceAssetId: 'ast_s', method: FIT_METHOD, startAt: T.ZERO, removed: { from: T.rt(8, 1), to: T.rt(28, 1) }, crossfade: T.rt(40, 1000), joinAt: T.rt(8, 1), measured: { similarity: 0.9, levelStepDb: 0.4, phraseBars: 4, tempoSpreadMs: 0, beatConfidence: 0.9 } } },
    ...over,
  });
  const g = (beats = Array.from({ length: 80 }, (_, k) => T.rt(k, 2))) => ({ method: FIT_GRID_METHOD, bpm: 120, meter: 4, confidence: 0.9, beats, downbeats: beats.filter((_, k) => k % 4 === 0) });
  it('adds the made file with the source\'s record and its derived grid, places it, deduplicates by content', () => {
    const doc = lib(record());
    const r = tx(doc, [{ op: 'add_fitted_music', args: { asset: made(), grid: g(), place: { start: T.ZERO } } }]);
    const out = r.results[0]!.output as { assetId: string; deduplicated: boolean; analysisAttached: boolean; clipId: string };
    expect(out).toMatchObject({ deduplicated: false, analysisAttached: true });
    expect(r.doc.assets[out.assetId]!.provenance.library).toEqual(record());
    expect(r.doc.analyses[out.assetId]!.beats).toMatchObject({ origin: { method: FIT_GRID_METHOD, edited: false, createdBy: 'user:owner' }, bpm: 120, meter: 4 });
    expect(clip(r.doc, out.clipId).assetId).toBe(out.assetId);
    expect(validateProject(r.doc)).toEqual([]);
    const again = tx(r.doc, [{ op: 'add_fitted_music', args: { asset: made(), grid: g() } }]);
    expect(again.results[0]!.output).toMatchObject({ assetId: out.assetId, deduplicated: true, analysisAttached: false });
    const own = tx(lib(null), [{ op: 'add_fitted_music', args: { asset: made({}, null), grid: g() } }]);
    expect(own.doc.assets[(own.results[0]!.output as { assetId: string }).assetId]!.provenance.library).toBeUndefined();
  });
  it('refuses in table order: fittedNotSound, fittedSourceMissing, the licence (again, fail-closed), a record that is not the source\'s, fittedGrid, removalNotBars', () => {
    const doc = lib(record());
    const msg = (asset: unknown, grid: unknown = g(), d = doc) => refusalOf(() => tx(d, [{ op: 'add_fitted_music', args: { asset, grid } }])).message;
    expect(msg(made({ kind: 'video' }))).toBe(MUSICFIT_REFUSALS.fittedNotSound.message());
    const noFit = made(); delete (noFit.provenance as Record<string, unknown>).fitted;
    expect(msg(noFit)).toBe(MUSICFIT_REFUSALS.fittedNotSound.message());
    const missing = made(); (missing.provenance as { fitted: { sourceAssetId: string } }).fitted.sourceAssetId = 'ast_gone';
    expect(msg(missing)).toBe(MUSICFIT_REFUSALS.fittedSourceMissing.message('ast_gone'));
    const nd = lib(record({ licence: { id: 'CC-BY-ND-4.0' } }));
    expect(msg(made({}, record({ licence: { id: 'CC-BY-ND-4.0' } })), g(), nd)).toBe(MUSICFIT_REFUSALS.licenceNoDerivatives.message('CC-BY-ND-4.0'));
    expect(msg(made({}, record({ licence: { id: 'CC-BY-SA-4.0' } })), g(), lib(record({ licence: { id: 'CC-BY-SA-4.0' } })))).toBe(MUSICFIT_REFUSALS.licenceShareAlike.message('CC-BY-SA-4.0'));
    expect(msg(made({}, null))).toBe(MUSICFIT_REFUSALS.licenceUnknown.message('CC-BY-4.0'));
    expect(msg(made({}, record({ title: 'Other' })))).toBe(MUSICFIT_REFUSALS.licenceUnknown.message('CC-BY-4.0'));
    expect(msg(made(), g([T.rt(1, 1), T.rt(1, 2)]))).toBe(MUSICFIT_REFUSALS.fittedGrid.message());
    expect(msg(made(), g([T.rt(0, 1), T.rt(40, 1)]))).toBe(MUSICFIT_REFUSALS.fittedGrid.message());
    const offBar = made(); (offBar.provenance as { fitted: { removed: unknown; joinAt: unknown } }).fitted.removed = { from: T.rt(9, 1), to: T.rt(28, 1) };
    (offBar.provenance as { fitted: { joinAt: unknown } }).fitted.joinAt = T.rt(9, 1);
    expect(msg(offBar)).toBe(MUSICFIT_REFUSALS.removalNotBars.message());
    const noBeats = structuredClone(doc); delete noBeats.analyses.ast_s;
    expect(msg(made(), g(), noBeats)).toBe(MUSICFIT_REFUSALS.removalNotBars.message());
  });
  it('never writes over a grid corrected by hand', () => {
    const doc = lib(record());
    const r = tx(doc, [{ op: 'add_fitted_music', args: { asset: made(), grid: g() } }]);
    const id = (r.results[0]!.output as { assetId: string }).assetId;
    const edited = structuredClone(r.doc); edited.analyses[id]!.beats!.origin.edited = true; edited.analyses[id]!.beats!.beats = [T.ZERO, T.rt(1, 1)]; edited.analyses[id]!.beats!.downbeats = [T.ZERO];
    const again = tx(edited, [{ op: 'add_fitted_music', args: { asset: made(), grid: g() } }]);
    expect(again.doc.analyses[id]!.beats!.beats).toEqual([T.ZERO, T.rt(1, 1)]);
  });
  it('mark_join_heard sets {by: the actor, at} and clears it; a file that is not shortened is refused', () => {
    const doc = lib(record());
    const r = tx(doc, [{ op: 'add_fitted_music', args: { asset: made(), grid: g() } }]);
    const id = (r.results[0]!.output as { assetId: string }).assetId;
    const heard = tx(r.doc, [{ op: 'mark_join_heard', args: { assetId: id, heard: true, at: '2026-11-25T10:00:00Z' } }]).doc;
    expect(heard.assets[id]!.provenance.fitted!.heard).toEqual({ by: 'user:owner', at: '2026-11-25T10:00:00Z' });
    expect(validateProject(heard)).toEqual([]);
    expect(tx(heard, [{ op: 'mark_join_heard', args: { assetId: id, heard: false, at: 'x' } }]).doc.assets[id]!.provenance.fitted!.heard).toBeUndefined();
    expect(refusalOf(() => tx(doc, [{ op: 'mark_join_heard', args: { assetId: 'ast_s', heard: true, at: 'x' } }])).message).toBe(MUSICFIT_REFUSALS.joinNotFitted.message('ast_s'));
    expect(refusalOf(() => tx(doc, [{ op: 'mark_join_heard', args: { assetId: 'ast_none', heard: true, at: 'x' } }])).message).toBe(MUSICFIT_REFUSALS.joinNotFitted.message('ast_none'));
  });
});
