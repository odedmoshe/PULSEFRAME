/**
 * Keeps the Hebrew wording of the musicfit refusals (packages/i18n/src/musicFit.ts HE_MUSICFIT) in step with the fixed English of core
 * musicFitContract.ts MUSICFIT_REFUSALS and of the routes (apps/server/src/musicfit/routes.ts MUSICFIT_SERVER_REFUSALS): every sentence
 * is worded in Hebrew, says what to do next, and every pattern is used. Every refusal of the four operations is provoked for real
 * through its operation (builder A), in the order MUSICFIT_REFUSALS lists, and equals the table; notBuilt (the operations are built)
 * comes from the table and the stubs B still holds, and notFollowable is the planner's (B). Also: the strings exist in both languages
 * and never praise a join or an ending. Builder A owns this file after the pre-pass.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, FIT_GRID_METHOD, FIT_METHOD, MUSICFIT_COMPOSED_AGAIN, type Asset, type LibraryRecord, type ProjectDocument, MUSICFIT_FORBIDDEN_WORDS, MUSICFIT_FORBIDDEN_WORDS_HE, MUSICFIT_INTERNAL_OPS, MUSICFIT_OPS_BUILT, MUSICFIT_PUBLIC_OPS, MUSICFIT_REFUSALS, MUSICFIT_UNHEARD_LABEL, MusicFitNotBuilt, OpError, joinMeasuredSentence, type MusicFitRefusalKey } from '@pulseframe/core';
import { MUSICFIT_SERVER_REFUSALS } from '../../../apps/server/src/musicfit/routes.ts';
import { dictionaries, MUSICFIT_EN, MUSICFIT_HE, MUSICFIT_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

const caught = (fn: () => unknown): string => { try { fn(); } catch (e) { if (e instanceof OpError) return e.message; throw e; } throw new Error('not refused'); };

/** Every refusal of the four operations, provoked through applyTransaction on synthetic documents (no file is read). */
function provoked(): Partial<Record<MusicFitRefusalKey, string>> {
  let n = 0;
  const run = (doc: ProjectDocument, op: string, args: unknown) => caught(() => applyTransaction(doc, [{ op, args }], { idSeed: `mwp${n++}_`, actor: 'user:owner', allowInternal: true }));
  const hash = (k: number) => `sha256:${k.toString(16).padStart(64, '0')}`;
  const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
  const R = { num: 30, den: 1 };
  const sound = (id: string, k: number, over: Partial<Asset> = {}): Asset => ({ id, kind: 'audio', name: `${id}.wav`, contentHash: hash(k), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov, ...over });
  const beats = Array.from({ length: 100 }, (_, k) => T.rt(k, 2));
  const grid = { origin: { method: 'test', params: {}, createdAt: prov.importedAt, createdBy: 'test', edited: false }, bpm: 120, confidence: 0.9, beats, downbeats: beats.filter((_, k) => k % 4 === 0), meter: 4 };
  // a 10 s video showing 2 s … 6 s at 0, and 120 BPM music under it; a still and a 4 s video that has no room
  let doc = createProject({ id: 'prj_mwp', name: 'P', width: 640, height: 360 });
  doc.assets.ast_v = { id: 'ast_v', kind: 'video', name: 'v.mp4', contentHash: hash(1), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(10, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 300 }, provenance: prov };
  doc.assets.ast_p = { id: 'ast_p', kind: 'image', name: 'p.png', contentHash: hash(2), byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.rt(5, 1), image: { width: 64, height: 64 }, provenance: prov } as Asset;
  doc.assets.ast_m = sound('ast_m', 3);
  doc.analyses.ast_m = { assetId: 'ast_m', beats: grid };
  const placed = applyTransaction(doc, [
    { op: 'add_clip', args: { assetId: 'ast_v', start: T.ZERO, sourceIn: T.rt(2, 1), duration: T.rt(4, 1), withLinkedAudio: false } },
    { op: 'add_clip', args: { assetId: 'ast_p', start: T.rt(4, 1), duration: T.rt(2, 1), trackId: undefined } },
    { op: 'add_clip', args: { assetId: 'ast_v', start: T.rt(10, 1), duration: T.rt(10, 1), withLinkedAudio: false } },
    { op: 'add_clip', args: { assetId: 'ast_m', start: T.ZERO, withLinkedAudio: false } },
  ].map((o) => ({ op: o.op, args: Object.fromEntries(Object.entries(o.args).filter(([, x]) => x !== undefined)) })), { idSeed: 'mwp_base_', actor: 'test' });
  doc = placed.doc;
  const [v, p, whole] = placed.results.map((r) => r.output!.clipId as string);
  const noMusic = structuredClone(doc);
  for (const t of noMusic.sequences.seq_main!.tracks) if (t.kind === 'audio') t.muted = true;
  // a library song and a made file of it
  const record = (over: Partial<LibraryRecord> = {}): LibraryRecord => ({ itemId: 'src-a/song.wav', sourceId: 'src-a', kind: 'music', title: 'Song A', sourceSha256: 'a'.repeat(64), ledger: { item: 'src-a' }, licence: { id: 'CC-BY-4.0' }, credit: { text: '"Song A" by Someone, CC BY 4.0', placement: 'description' }, flags: {}, ...over });
  const fitted = { sourceAssetId: 'ast_s', method: FIT_METHOD, startAt: T.ZERO, removed: { from: T.rt(8, 1), to: T.rt(28, 1) }, crossfade: T.rt(40, 1000), joinAt: T.rt(8, 1), measured: { similarity: 0.9, levelStepDb: 0.4, phraseBars: 4 as const, tempoSpreadMs: 0, beatConfidence: 0.9 } };
  const made = (library: LibraryRecord | null, over: Record<string, unknown> = {}, fit: Record<string, unknown> = {}) => ({ kind: 'audio', name: 'short.wav', contentHash: hash(77), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(40, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { origin: 'derived', importedAt: prov.importedAt, importedBy: 'user:owner', ...(library ? { library } : {}), fitted: { ...fitted, ...fit } }, ...over });
  const fgrid = (b = beats.slice(0, 80)) => ({ method: FIT_GRID_METHOD, bpm: 120, meter: 4, confidence: 0.9, beats: b, downbeats: b.filter((_, k) => k % 4 === 0) });
  const song = (rec: LibraryRecord | null, over: Partial<Asset['provenance']> = {}) => {
    const d = createProject({ id: 'prj_mws', name: 'S' });
    d.assets.ast_s = sound('ast_s', 6, { provenance: { origin: 'upload', importedAt: prov.importedAt, importedBy: 'user:local', ...(rec ? { library: rec } : {}), ...over } as Asset['provenance'] });
    d.analyses.ast_s = { assetId: 'ast_s', beats: grid };
    return d;
  };
  const two = song(null);
  two.assets.ast_l1 = sound('ast_l1', 8, { provenance: { origin: 'upload', importedAt: prov.importedAt, importedBy: 'user:local', library: record() } });
  two.assets.ast_l2 = sound('ast_l2', 9, { provenance: { origin: 'upload', importedAt: prov.importedAt, importedBy: 'user:local', library: record({ itemId: 'src-a/b.wav' }) } });
  two.assets.ast_s = sound('ast_s', 6, { provenance: { origin: 'derived', importedAt: prov.importedAt, importedBy: 'test', derived: { jobId: 'j', capabilityId: 'c', capabilityVersion: '1', graphDigest: 'g', params: {}, sourceAssetIds: ['ast_l1', 'ast_l2'], outputName: 'o', outputRole: 'audio', encoding: 'pcm', provider: {} } } });
  const already = song(record());
  already.assets.ast_s!.provenance = { origin: 'derived', importedAt: prov.importedAt, importedBy: 'test', library: record(), fitted: { ...fitted, sourceAssetId: 'ast_x' } };
  const ok = song(record());
  return {
    impactNoMoment: run(doc, 'set_clip_impact', { clipId: p, moment: T.ZERO }),
    impactOutsideFile: run(doc, 'set_clip_impact', { clipId: v, moment: T.rt(10, 1) }),
    noImpact: run(doc, 'sync_impact', { clipId: v, to: 'beat' }),
    impactOutside: run(doc, 'sync_impact', { clipId: v, moment: T.rt(7, 1), to: 'beat' }),
    noMusic: run(noMusic, 'sync_impact', { clipId: v, moment: T.rt(31, 10), to: 'beat' }),
    noRoom: run(doc, 'sync_impact', { clipId: whole, moment: T.rt(1, 10), to: 'beat' }),
    alreadyOnBeat: run(doc, 'sync_impact', { clipId: v, moment: T.rt(3, 1), to: 'beat' }),
    fittedNotSound: run(ok, 'add_fitted_music', { asset: made(record(), { kind: 'video' }), grid: fgrid() }),
    fittedSourceMissing: run(ok, 'add_fitted_music', { asset: made(record(), {}, { sourceAssetId: 'ast_x' }), grid: fgrid() }),
    licenceNoDerivatives: run(song(record({ licence: { id: 'CC-BY-ND-4.0' } })), 'add_fitted_music', { asset: made(record({ licence: { id: 'CC-BY-ND-4.0' } })), grid: fgrid() }),
    licenceShareAlike: run(song(record({ licence: { id: 'CC-BY-SA-4.0' } })), 'add_fitted_music', { asset: made(record({ licence: { id: 'CC-BY-SA-4.0' } })), grid: fgrid() }),
    licenceUnknown: run(song(record({ licence: { id: 'custom:x' } })), 'add_fitted_music', { asset: made(record({ licence: { id: 'custom:x' } })), grid: fgrid() }),
    licenceManyOrigins: run(two, 'add_fitted_music', { asset: made(null), grid: fgrid() }),
    alreadyFitted: run(already, 'add_fitted_music', { asset: made(record()), grid: fgrid() }),
    fittedGrid: run(ok, 'add_fitted_music', { asset: made(record()), grid: fgrid([T.rt(1, 1), T.rt(1, 2)]) }),
    removalNotBars: run(ok, 'add_fitted_music', { asset: made(record(), {}, { removed: { from: T.rt(9, 1), to: T.rt(28, 1) }, joinAt: T.rt(9, 1) }), grid: fgrid() }),
    joinNotFitted: run(ok, 'mark_join_heard', { assetId: 'ast_s', heard: true, at: '2026-11-25T00:00:00Z' }),
  };
}

function opSentences(): Record<MusicFitRefusalKey, string[]> {
  const S = MUSICFIT_REFUSALS;
  const doc = createProject({ id: 'prj_mw', name: 'MW' });
  const opts = (n: number) => ({ idSeed: `mw${n}_`, actor: 'test', allowInternal: true });
  const notBuilt = MUSICFIT_OPS_BUILT
    ? [...MUSICFIT_PUBLIC_OPS, ...MUSICFIT_INTERNAL_OPS].map((op) => S.notBuilt.message(op))
    : [caught(() => applyTransaction(doc, [{ op: 'set_clip_impact', args: { clipId: 'clp_x', moment: null } }], opts(1))),
      caught(() => applyTransaction(doc, [{ op: 'sync_impact', args: { clipId: 'clp_x', to: 'beat' } }], opts(2))),
      caught(() => applyTransaction(doc, [{ op: 'mark_join_heard', args: { assetId: 'ast_x', heard: true, at: '2026-11-25T00:00:00Z' } }], opts(3)))];
  const real = MUSICFIT_OPS_BUILT ? provoked() : {};
  const or = (k: MusicFitRefusalKey, table: string[]) => (real[k] !== undefined ? [real[k]!] : table);
  const table = {
    notBuilt: [...notBuilt, new MusicFitNotBuilt('planMusicSwap').message],
    impactNoMoment: [S.impactNoMoment.message()], impactOutsideFile: [S.impactOutsideFile.message()], noImpact: [S.noImpact.message()],
    impactOutside: [S.impactOutside.message()], noMusic: [S.noMusic.message()], noRoom: [S.noRoom.message()], alreadyOnBeat: [S.alreadyOnBeat.message()],
    notFollowable: [S.notFollowable.message()], fittedNotSound: [S.fittedNotSound.message()], fittedSourceMissing: [S.fittedSourceMissing.message('ast_x')],
    licenceNoDerivatives: [S.licenceNoDerivatives.message('CC-BY-ND-4.0')], licenceShareAlike: [S.licenceShareAlike.message('CC-BY-SA-4.0')],
    licenceUnknown: [S.licenceUnknown.message('custom:x'), S.licenceUnknown.message('')], licenceManyOrigins: [S.licenceManyOrigins.message()], alreadyFitted: [S.alreadyFitted.message()],
    fittedGrid: [S.fittedGrid.message()], removalNotBars: [S.removalNotBars.message()], joinNotFitted: [S.joinNotFitted.message('ast_x')],
  };
  return Object.fromEntries(Object.entries(table).map(([k, v]) => [k, or(k as MusicFitRefusalKey, v)])) as Record<MusicFitRefusalKey, string[]>;
}
const serverSentences = (): string[] => Object.values(MUSICFIT_SERVER_REFUSALS).map((r) => (r.message as (s: string) => string)('12.5'));

describe('musicfit refusals in Hebrew', () => {
  const ops = opSentences();
  const all = [...Object.values(ops).flat(), ...serverSentences()];
  it('notBuilt is provoked for real until the bodies are built', () => {
    if (!MUSICFIT_OPS_BUILT) expect(ops.notBuilt.slice(0, 3)).toEqual(['set_clip_impact', 'sync_impact', 'mark_join_heard'].map((op) => MUSICFIT_REFUSALS.notBuilt.message(op)));
  });
  it('every sentence is worded, in Hebrew, with a next step, and no reason falls back to the generic words', () => {
    for (const en of all) {
      const he = translateRefusal('he', en);
      expect({ en, worded: !!he }).toEqual({ en, worded: true });
      expect({ en, hebrew: /[֐-׿]/.test(he!) }).toEqual({ en, hebrew: true });
      expect({ en, fallback: /לא עבר בדיקה/.test(he!) }).toEqual({ en, fallback: false });
      expect({ en, nextStep: /[.:;—]/.test(he!) }).toEqual({ en, nextStep: true });
    }
  });
  it('every pattern of the table is used by some sentence', () => {
    expect(MUSICFIT_REFUSAL_PATTERNS.filter((re) => !all.some((en) => re.test(en))).map(String)).toEqual([]);
  });
  it('A: each refusal of set_clip_impact, sync_impact, add_fitted_music and mark_join_heard is provoked for real through its operation and equals the table', () => {
    expect(MUSICFIT_OPS_BUILT).toBe(true);
    const S = MUSICFIT_REFUSALS, real = provoked();
    const expected: Record<string, string> = {
      impactNoMoment: S.impactNoMoment.message(), impactOutsideFile: S.impactOutsideFile.message(), noImpact: S.noImpact.message(), impactOutside: S.impactOutside.message(),
      noMusic: S.noMusic.message(), noRoom: S.noRoom.message(), alreadyOnBeat: S.alreadyOnBeat.message(), fittedNotSound: S.fittedNotSound.message(), fittedSourceMissing: S.fittedSourceMissing.message('ast_x'),
      licenceNoDerivatives: S.licenceNoDerivatives.message('CC-BY-ND-4.0'), licenceShareAlike: S.licenceShareAlike.message('CC-BY-SA-4.0'), licenceUnknown: S.licenceUnknown.message('custom:x'),
      licenceManyOrigins: S.licenceManyOrigins.message(), alreadyFitted: S.alreadyFitted.message(), fittedGrid: S.fittedGrid.message(), removalNotBars: S.removalNotBars.message(), joinNotFitted: S.joinNotFitted.message('ast_s'),
    };
    expect(real).toEqual(expected);
    // every key of the table but the planner's notFollowable and notBuilt is provoked through an operation
    expect(Object.keys(S).filter((k) => !(k in real)).sort()).toEqual(['notBuilt', 'notFollowable']);
  });
  it.todo('B: each server refusal (needs_bars, no_join, too_short, too_long, not_from_start, fit_stale, fit_unstable, flash_gap) is provoked for real through the plan or apply route');
});

describe('musicfit strings', () => {
  it('the shared strings exist in both languages, Hebrew in Hebrew', () => {
    for (const lang of ['he', 'en'] as const) {
      const d = dictionaries[lang] as Record<string, string>;
      const missing = [...[...MUSICFIT_PUBLIC_OPS, ...MUSICFIT_INTERNAL_OPS].map((op) => `op.${op}`), ...Object.keys(MUSICFIT_HE)].filter((k) => !d[k]);
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    }
    for (const [k, v] of Object.entries(MUSICFIT_HE)) expect({ k, hebrew: /[א-ת]/.test(v) }).toEqual({ k, hebrew: true });
  });
  it('nothing praises a join or an ending, and «מסונכרן» is never said', () => {
    const texts = [...Object.values(MUSICFIT_HE), ...Object.values(MUSICFIT_EN), ...Object.values(MUSICFIT_UNHEARD_LABEL), ...Object.values(MUSICFIT_COMPOSED_AGAIN),
      ...Object.values(joinMeasuredSentence({ similarity: 0.912, levelStepDb: -0.4, phraseBars: 4, tempoSpreadMs: 3, beatConfidence: 0.8 }))];
    for (const s of texts) { expect({ s, en: MUSICFIT_FORBIDDEN_WORDS.test(s) }).toEqual({ s, en: false }); expect({ s, he: MUSICFIT_FORBIDDEN_WORDS_HE.test(s) }).toEqual({ s, he: false }); }
    expect(MUSICFIT_HE['musicfit.unheard']).toBe(MUSICFIT_UNHEARD_LABEL.he);
    expect(MUSICFIT_EN['musicfit.unheard']).toBe(MUSICFIT_UNHEARD_LABEL.en);
    expect(MUSICFIT_HE['musicfit.composedAgain']).toBe(MUSICFIT_COMPOSED_AGAIN.he);
  });
  it('the measured sentence says "measured, not heard" with its numbers', () => {
    const s = joinMeasuredSentence({ similarity: 0.912, levelStepDb: -0.4, phraseBars: 4, tempoSpreadMs: 3, beatConfidence: null });
    expect(s.he).toBe('נמדד, לא נשמע: דמיון 0.912 בין התיבות שמשני צידי החיבור; הפרש עוצמה 0.4 dB; על גבול של 4 תיבות');
    expect(s.en).toMatch(/^Measured, not heard: similarity 0\.912/);
  });
});
