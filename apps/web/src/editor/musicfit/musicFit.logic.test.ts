/**
 * Logic of the musicfit surfaces (wave 7, builder C) against small local fixtures of the contract's shapes: no server, no browser.
 * Expected numbers are typed by hand from the fixture (a 30 fps project; music with a beat every 0.5 s; a video clip showing source
 * 2 s … 6 s from the timeline start).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, MUSICFIT_FORBIDDEN_WORDS, MUSICFIT_FORBIDDEN_WORDS_HE, type Asset, type MediaClip, type MusicFitPlan, type ProjectDocument } from '@pulseframe/core';
import { dictionaries } from '@pulseframe/i18n';
import { ApiFailure } from '../../api.ts';
import { EXTRA, musicFitT } from './musicFit.strings.ts';
import { afterSyncText, chipFor, endingText, fitFailure, impactView, isFittableMusicClip, joinState, makeText, momentAtPlayhead, nextRemoval, noteText, realignOps, refusalLine, swapRequest, swapRows, whatChanges, fitRequest } from './musicFit.logic.ts';
import { tickPositions } from './ImpactTick.tsx';
import { MUSICFIT_COMMANDS } from './musicFit.commands.ts';

const R = { num: 30, den: 1 };
const hash = (n: number) => `sha256:${n.toString(16).padStart(64, '0')}`;
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const video = (id: string, n: number): Asset => ({ id, kind: 'video', name: `${id}.mp4`, contentHash: hash(n), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(10, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 300 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov });
const sound = (id: string, n: number, over: Partial<Asset> = {}): Asset => ({ id, kind: 'audio', name: `${id}.wav`, contentHash: hash(n), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov, ...over });
let seed = 0;
const tx = (doc: ProjectDocument, ops: { op: string; args: unknown }[]) => applyTransaction(doc, ops, { idSeed: `mfc${seed++}_`, actor: 'user:owner', allowInternal: true });
function grid(count: number) {
  const beats = Array.from({ length: count }, (_, k) => T.rt(k, 2));
  return { origin: { method: 'test grid', params: {}, createdAt: prov.importedAt, createdBy: 'test', edited: false }, bpm: 120, confidence: 0.9, beats, downbeats: beats.filter((_, k) => k % 4 === 0), meter: 4 };
}
function base() {
  let doc = createProject({ id: 'prj_mfc', name: 'C', width: 640, height: 360 });
  doc.assets.ast_v = video('ast_v', 1);
  doc.assets.ast_m = sound('ast_m', 2);
  doc.analyses.ast_m = { assetId: 'ast_m', beats: grid(100) };
  const r = tx(doc, [
    { op: 'add_clip', args: { assetId: 'ast_v', start: T.ZERO, sourceIn: T.rt(2, 1), duration: T.rt(4, 1), withLinkedAudio: false } },
    { op: 'add_clip', args: { assetId: 'ast_m', start: T.ZERO, withLinkedAudio: false } },
  ]);
  return { doc: r.doc, v: r.results[0]!.output!.clipId as string, m: r.results[1]!.output!.clipId as string };
}
const clipOf = (doc: ProjectDocument, id: string) => Object.values(doc.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).find((c) => c.id === id) as MediaClip;
const he = musicFitT('he'), en = musicFitT('en');

describe('impact read-out (core planImpact, the same function the operation uses)', () => {
  it('says the offset before the move in frames and which side, from the fixture', () => {
    const { doc, v } = base();
    const marked = tx(doc, [{ op: 'set_clip_impact', args: { clipId: v, moment: T.rt(31, 10) } }]).doc;
    const view = impactView(marked, clipOf(marked, v), 'en', en);
    // source 3.1 s shows at timeline 1.1 s = frame 33; the nearest beat is 1.0 s = frame 30: three frames after it
    expect(view).toMatchObject({ kind: 'marked', onBeat: false, plan: { frames: 3, ms: 100, targetFrame: 30 } });
    expect((view as { line: string }).line).toBe('The moment is 3 frames after the beat');
    expect((impactView(marked, clipOf(marked, v), 'he', he) as { line: string }).line).toBe('הרגע 3 פריימים אחרי הפעימה');
  });
  it('unmarked, on the beat, and a clip that cannot hold a moment', () => {
    const { doc, v, m } = base();
    expect(impactView(doc, clipOf(doc, v), 'en', en).kind).toBe('unmarked');
    const on = tx(doc, [{ op: 'set_clip_impact', args: { clipId: v, moment: T.rt(3, 1) } }]).doc; // timeline 1.0 s: frame 30, a beat
    expect(impactView(on, clipOf(on, v), 'en', en)).toMatchObject({ kind: 'marked', onBeat: true, line: 'The moment is on the beat\'s frame' });
    void m;
    const s = structuredClone(doc); s.assets.ast_p = { ...video('ast_p', 9), kind: 'image', container: 'png', mimeType: 'image/png', image: { width: 8, height: 8 } } as unknown as Asset;
    const r = tx(s, [{ op: 'add_clip', args: { assetId: 'ast_p', start: T.rt(10, 1), duration: T.rt(2, 1) } }]);
    expect(impactView(r.doc, clipOf(r.doc, r.results[0]!.output!.clipId as string), 'en', en).kind).toBe('cannot');
  });
  it('a refusal is said in words with its next step, in both languages', () => {
    expect(refusalLine('he', 'noMusic')).toBe('אין מתחת לרגע הזה מוזיקה עם פעימות מדודות. הוסיפו מוזיקה או מדדו את הפעימות שלה');
    expect(refusalLine('en', 'noRoom')).toBe('the file has no material to bring the moment to that beat. Try the earlier or the later beat (pick).');
    expect(refusalLine('he', 'licenceNoDerivatives', { licenceId: 'CC-BY-ND-4.0' })).toContain('בחרו מוזיקה אחרת');
  });
  it('the sentence after a move states the offset before and the residual after', () => {
    expect(afterSyncText(en, { offsetBefore: { frames: -2, ms: -66.7 }, residualMs: 0.4 })).toBe('Before: The moment is 2 frames before the beat. After: Now on the beat\'s frame; residual 0.4 ms by calculation');
  });
  it('the playhead gives the source time of the file inside the clip only', () => {
    const { doc, v } = base();
    expect(momentAtPlayhead(doc, v, T.rt(1, 1))).toEqual(T.rt(3, 1));
    expect(momentAtPlayhead(doc, v, T.rt(4, 1))).toBeNull(); // the clip ends at 4 s
  });
  it('realign: one sync per marked clip that is off its beat, none for one that is on it', () => {
    const { doc, v } = base();
    const off = tx(doc, [{ op: 'set_clip_impact', args: { clipId: v, moment: T.rt(31, 10) } }]).doc;
    expect(realignOps(off, [v, 'nope'])).toEqual([{ op: 'sync_impact', args: { clipId: v, to: 'beat' } }]);
    const on = tx(doc, [{ op: 'set_clip_impact', args: { clipId: v, moment: T.rt(3, 1) } }]).doc;
    expect(realignOps(on, [v])).toEqual([]);
    expect(realignOps(doc, [v])).toEqual([]);
  });
  it('ticks: the marked moment and the join of a shortened song lie at their exact seconds from the clip start', () => {
    const { doc, v, m } = base();
    const marked = tx(doc, [{ op: 'set_clip_impact', args: { clipId: v, moment: T.rt(31, 10) } }]).doc;
    expect(tickPositions(marked, clipOf(marked, v))).toEqual([{ kind: 'impact', seconds: 1.1 }]);
    expect(tickPositions(doc, clipOf(doc, v))).toEqual([]);
    const f = structuredClone(doc);
    f.assets.ast_m!.provenance = { ...prov, origin: 'derived', fitted: { sourceAssetId: 'ast_x', method: 'm', startAt: T.ZERO, removed: { from: T.rt(8, 1), to: T.rt(16, 1) }, crossfade: T.rt(40, 1000), joinAt: T.rt(8, 1), measured: { similarity: 0.9, levelStepDb: 0.5, phraseBars: 4, tempoSpreadMs: 2, beatConfidence: 0.8 } } } as Asset['provenance'];
    expect(tickPositions(f, clipOf(f, m))).toEqual([{ kind: 'join', seconds: 8 }]);
    expect(tickPositions(f, { ...clipOf(f, m), sourceIn: T.rt(9, 1) } as MediaClip)).toEqual([]); // the clip no longer shows the join
  });
});

describe('the unheard labels and the owner-only mark', () => {
  const fitted = (heard?: { by: string; at: string }) => ({ provenance: { ...prov, origin: 'derived', fitted: { sourceAssetId: 'a', method: 'm', startAt: T.ZERO, removed: { from: T.rt(8, 1), to: T.rt(16, 1) }, crossfade: T.rt(1, 25), joinAt: T.rt(8, 1), measured: { similarity: 0.5, levelStepDb: 1, phraseBars: 2, tempoSpreadMs: 1, beatConfidence: null }, ...(heard ? { heard } : {}) } } }) as Pick<Asset, 'provenance'>;
  it('a shortened song is «עוד לא הושמע» until marked; built-in music keeps its own label; a plain file has none', () => {
    expect(chipFor('he', he, fitted())).toMatchObject({ kind: 'unheard-join', text: 'חיבור אוטומטי — עוד לא הושמע' });
    expect(chipFor('en', en, fitted())!.text).toBe('Automatic join — not heard yet');
    expect(chipFor('he', he, fitted({ by: 'user:owner', at: '2026-11-25' }))).toMatchObject({ kind: 'heard-join', text: 'החיבור נשמע (2026-11-25)' });
    const builtin = { provenance: { ...prov, origin: 'generated', procedural: { id: 'music.calm', version: 1, generator: 'g', params: {} } } } as unknown as Pick<Asset, 'provenance'>;
    expect(chipFor('he', he, builtin)).toMatchObject({ kind: 'unheard-builtin', text: 'מוזיקה מובנית — עוד לא הושמעה לאף אחד' });
    expect(chipFor('he', he, { provenance: prov } as Pick<Asset, 'provenance'>)).toBeNull();
    expect(joinState(fitted())).toMatchObject({ heard: false, joinSeconds: 8, sourceAssetId: 'a' });
  });
  it('the server refusal for a credential that is not the owner is shown in words (Hebrew and English)', () => {
    const e = new ApiFailure(403, 'human_approval_required', 'only the project owner can mark a join as heard, from their own session');
    expect(fitFailure('he', e)).toEqual({ kind: 'refused', code: 'human_approval_required', text: 'רק בעל הפרויקט יכול לסמן שהחיבור נשמע, מהחלון שלו. השמיעו את החיבור בעורך וסמנו' });
    expect(fitFailure('en', e).text).toBe('only the project owner can mark a join as heard, from their own session');
  });
});

describe('failures and plans in words', () => {
  it('501 musicfit_not_built is its own honest state; a licence refusal keeps its reason and next step', () => {
    expect(fitFailure('he', new ApiFailure(501, 'musicfit_not_built', 'music that fits the film is not built in this build yet')).kind).toBe('not-built');
    const lic = fitFailure('he', new ApiFailure(409, 'incompatible', 'the licence of this music (CC-BY-ND-4.0) forbids changing it, so it cannot be shortened', undefined, 'Choose other music.'));
    expect(lic).toMatchObject({ kind: 'refused' });
    expect(lic.text).toContain('CC-BY-ND-4.0');
    expect(lic.text).toContain('בחרו מוזיקה אחרת');
    expect(fitFailure('en', new ApiFailure(409, 'incompatible', 'x', undefined, 'Choose other music.')).text).toBe('x. Choose other music.');
  });
  const plan = (over: Partial<MusicFitPlan> = {}): MusicFitPlan => ({
    revision: 4, target: { kind: 'clip', clipId: 'c', runId: null }, make: { kind: 'none' }, wantedSeconds: 30, ending: { kind: 'exact', seconds: 2.4 }, recut: null, impacts: [], warnings: [], blocking: [], basis: [], ...over,
  });
  it('ending and make sentences', () => {
    expect(endingText(he, plan())).toBe('המוזיקה מסתיימת עם הסרט; האקורד האחרון מתחיל 2.4 שניות לפני הסוף');
    expect(endingText(en, plan({ ending: { kind: 'cut', seconds: 1.234 } }))).toBe('The ending is cut by 1.23 s and faded');
    expect(endingText(en, plan({ ending: { kind: 'early', seconds: 3 } }))).toBe('Ends 3 s before the end, with its own ending');
    expect(makeText(en, plan({ make: { kind: 'builtin', styleId: 'music.calm', seed: 1, bars: 5, endFrames: 100 } }))).toBe('Built-in music of exactly the film\'s length will be made (30 s)');
    expect(makeText(en, plan())).toBe('No new file; the file already there is used as it is');
  });
  const cand = (n: number) => ({ removal: { from: T.rt(n, 1), to: T.rt(n + 8, 1) }, madeSeconds: 29.9, offBySeconds: -0.1, measured: { similarity: 0.4, levelStepDb: 1, phraseBars: 4 as const, tempoSpreadMs: 3, beatConfidence: 0.7 } });
  it('«חיבור אחר» walks the candidates and wraps; one candidate offers none', () => {
    const two = plan({ make: { kind: 'fitted', sourceAssetId: 'a', candidates: [cand(8), cand(16)], chosen: 0 } });
    expect(nextRemoval(two)).toEqual(cand(16).removal);
    expect(nextRemoval(plan({ make: { kind: 'fitted', sourceAssetId: 'a', candidates: [cand(8), cand(16)], chosen: 1 } }))).toEqual(cand(8).removal);
    expect(nextRemoval(plan({ make: { kind: 'fitted', sourceAssetId: 'a', candidates: [cand(8)], chosen: 0 } }))).toBeNull();
    expect(nextRemoval(plan())).toBeNull();
  });
  it('a weak join is said plainly, in both languages, with the number and the next step; no praise', () => {
    const n = { code: 'join_weak' as const, message: 'server english', details: { similarity: 0.412 } };
    expect(noteText('he', he, n)).toContain('החיבור חלש');
    expect(noteText('he', he, n)).toContain('0.412');
    expect(noteText('en', en, n)).toContain('The join is weak');
    expect(noteText('en', en, n)).toContain('Nobody has heard it');
  });
  it('a note uses the server\'s Hebrew when it sent one, its own sentence by code otherwise, and the server text for an unknown code', () => {
    expect(noteText('he', he, { code: 'composed_again', message: 'm', details: { he: 'עברית מהשרת' } })).toBe('עברית מהשרת');
    expect(noteText('he', he, { code: 'music_keys_dropped', message: 'm', details: { count: 2 } })).toBe('2 נקודות עוצמה של קליפ המוזיקה לא יחולו על המוזיקה החדשה');
    expect(noteText('en', en, { code: 'weird' as never, message: 'keep me', details: {} })).toBe('keep me');
  });
  it('the "what changes" table lists exactly what the plan says, and says nothing changes when it says nothing', () => {
    expect(whatChanges(en, plan()).map((r) => r.key)).toEqual(['nothing']);
    const rows = whatChanges(he, plan({
      recut: { before: { cuts: 12, minGapFrames: 20, maxInOneSecond: 2 }, after: { cuts: 14, minGapFrames: 11, maxInOneSecond: 3 }, thinned: 2, kept: ['a'], movedBack: ['b', 'c'], offGrid: [], blocked: ['קטע 3'] },
      impacts: [{ clipId: 'x', framesFromBeatBefore: 0, framesFromBeatAfter: 3 }, { clipId: 'y', framesFromBeatBefore: 0, framesFromBeatAfter: 0 }],
      warnings: [{ code: 'music_keys_dropped', message: '', details: { count: 4 } }],
    }));
    expect(rows.map((r) => r.key)).toEqual(['cuts', 'gap', 'thinned', 'kept', 'moved', 'blocked', 'off', 'keys']);
    expect(rows[0]!.text).toBe('חיתוכים: 12 ← 14');
    expect(rows.find((r) => r.key === 'blocked')!.text).toBe('קטעים שנערכו ביד ולא ניתן לחתוך מחדש: קטע 3');
    expect(rows.find((r) => r.key === 'off')!.text).toBe('רגעים מסומנים שיזוזו מהפעימה: 1');
    expect(rows.find((r) => r.key === 'keys')!.text).toBe('נקודות עוצמה שיימחקו: 4');
  });
});

describe('requests and the swap list', () => {
  it('a clip plan names the clip and keeps the music; a film or template names the run and sends recut', () => {
    expect(fitRequest('c1', true)).toEqual({ target: { clipId: 'c1' }, music: { keep: true }, tailor: true });
    const r = { removal: { from: T.rt(8, 1), to: T.rt(16, 1) } }.removal;
    expect(fitRequest('c1', false, r).removal).toEqual(r);
    expect(swapRequest({ kind: 'film', runId: 'run1' }, { builtin: { styleId: 'music.calm' } }, true, false)).toEqual({ target: { runId: 'run1' }, music: { builtin: { styleId: 'music.calm' } }, tailor: true, recut: false });
    expect(swapRequest({ kind: 'clip', clipId: 'c' }, { assetId: 'a' }, false, true)).toEqual({ target: { clipId: 'c' }, music: { assetId: 'a' }, tailor: false });
  });
  it('the list holds the six built-in styles and only the project\'s sound files with measured beats, never the one already playing', () => {
    const { doc } = base();
    doc.assets.ast_n = sound('ast_n', 7); // no beats
    doc.assets.ast_o = sound('ast_o', 8); doc.analyses.ast_o = { assetId: 'ast_o', beats: grid(20) };
    const rows = swapRows(doc, 'en', en, 'ast_m');
    expect(rows.filter((r) => r.kind === 'builtin')).toHaveLength(6);
    expect(rows.filter((r) => r.kind === 'song').map((r) => r.assetId)).toEqual(['ast_o']);
    expect(swapRows(doc, 'en', en).filter((r) => r.kind === 'song').map((r) => r.assetId).sort()).toEqual(['ast_m', 'ast_o']);
  });
  it('the block is for sound files only, not narration', () => {
    const { doc, m, v } = base();
    expect(isFittableMusicClip(doc, clipOf(doc, m))).toBe(true);
    expect(isFittableMusicClip(doc, clipOf(doc, v))).toBe(false);
    const n = structuredClone(doc); n.assets.ast_m!.provenance = { ...prov, voice: { text: 'x', engine: 'e', model: 'm', voice: 'built-in' } } as unknown as Asset['provenance'];
    expect(isFittableMusicClip(n, clipOf(n, m))).toBe(false);
  });
});

describe('wording and commands', () => {
  it('no string of the surfaces praises an ending or a join, and «מסונכרן» is never used; both languages have the same keys', () => {
    const he_ = Object.entries(EXTRA.he), en_ = Object.entries(EXTRA.en);
    expect(he_.map(([k]) => k)).toEqual(en_.map(([k]) => k));
    for (const [k, v] of en_) expect(MUSICFIT_FORBIDDEN_WORDS.test(v), `en ${k}`).toBe(false);
    for (const [k, v] of he_) expect(MUSICFIT_FORBIDDEN_WORDS_HE.test(v) || /חלק|מושלם|מסונכרן/.test(v), `he ${k}`).toBe(false);
    for (const lang of ['he', 'en'] as const) for (const [k, v] of Object.entries(dictionaries[lang])) if (k.startsWith('musicfit.')) expect(MUSICFIT_FORBIDDEN_WORDS.test(v) || MUSICFIT_FORBIDDEN_WORDS_HE.test(v), `${lang} ${k}`).toBe(false);
  });
  it('B and Alt+B are the two sync commands; marking has no default key; the keys do not collide with another command', async () => {
    const byId = Object.fromEntries(MUSICFIT_COMMANDS.map((c) => [c.id, c]));
    expect(byId['clip.impactToBeat']!.keys).toEqual(['KeyB']);
    expect(byId['clip.impactToBar']!.keys).toEqual(['Alt+KeyB']);
    expect(byId['clip.markImpact']!.keys).toEqual([]);
    const { COMMANDS } = await import('../commands.ts');
    for (const chord of ['KeyB', 'Alt+KeyB']) expect(COMMANDS.filter((c) => c.keys.includes(chord)).map((c) => c.id)).toHaveLength(1);
  });
});
