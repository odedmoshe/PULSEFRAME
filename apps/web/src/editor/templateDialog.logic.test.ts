/**
 * What the template dialog and drawer decide (ADR-0016), without a browser: the media order, the text counters, the request
 * parameters, the plan view as rows, alternatives, shuffle and tempo, and the strings of both languages.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, TEMPLATE_GENRES, TEMPLATE_WARNING_CODES, type OpCall, type ProjectDocument, type TemplatePlanView, type TemplateSummary } from '@pulseframe/core';
import { beatState, buildParams, charCount, clock, counter, defaultMusic, filterByGenre, initialMedia, mergeAlternative, moveItem, musicAssets, nextTempo, pictureAssets, planRows, shuffleParams, syncMedia, toggleGenre, toggleItem } from './templateDialog.logic.ts';
import { TEMPLATE_STRINGS } from './templates.strings.ts';
import { ADJUST_STRINGS } from './adjust.strings.ts';
import { WELCOME_STRINGS } from './welcome.strings.ts';

const R = { num: 30, den: 1 };
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `tdl${n++}_`, actor: 'test', allowInternal });
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const hash = (c: string) => `sha256:${c.repeat(64)}`;
const video = (name: string, c: string) => ({ kind: 'video' as const, name, contentHash: hash(c), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(4, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 120 }, provenance });
const image = (name: string, c: string) => ({ kind: 'image' as const, name, contentHash: hash(c), byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance });
const song = (name: string, c: string) => ({ kind: 'audio' as const, name, contentHash: hash(c), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(30, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance });

function library() {
  const r = tx(createProject({ id: 'prj_tdl', name: 'T' }), [
    { op: 'import_asset', args: { asset: video('a.mp4', '1') } },
    { op: 'import_asset', args: { asset: image('b.png', '2') } },
    { op: 'import_asset', args: { asset: song('song.wav', '3') } },
    { op: 'import_asset', args: { asset: video('c.mp4', '4') } },
    { op: 'import_asset', args: { asset: song('other.wav', '5') } },
  ], true);
  const ids = r.results.map((x) => x.output!.assetId as string);
  return { doc: r.doc, a: ids[0]!, b: ids[1]!, song: ids[2]!, c: ids[3]!, other: ids[4]! };
}

describe('media order', () => {
  it('starts with the library\'s pictures and videos in library order, all included; sound files are not offered', () => {
    const { doc, a, b, c } = library();
    expect(pictureAssets(doc).map((x) => x.id)).toEqual([a, b, c]);
    expect(initialMedia(doc)).toEqual([{ assetId: a, included: true }, { assetId: b, included: true }, { assetId: c, included: true }]);
  });
  it('moves an item one place earlier or later, and not past either end', () => {
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
    const list = ['a', 'b'];
    moveItem(list, 0, 1);
    expect(list).toEqual(['a', 'b']); // never changes its input
  });
  it('a file imported while the dialog is open joins at the end, included; a removed file leaves; the order made by hand is kept', () => {
    const { doc, a, b, c } = library();
    const mine = toggleItem(moveItem(initialMedia(doc), 2, -1), a); // c before b, a left out
    expect(mine).toEqual([{ assetId: a, included: false }, { assetId: c, included: true }, { assetId: b, included: true }]);
    expect(syncMedia(mine, doc)).toBe(mine); // nothing changed: the same list
    const more = tx(doc, [{ op: 'import_asset', args: { asset: image('d.png', '6') } }], true);
    const d = more.results[0]!.output!.assetId as string;
    expect(syncMedia(mine, more.doc)).toEqual([...mine, { assetId: d, included: true }]);
    const fewer = tx(more.doc, [{ op: 'remove_asset', args: { assetId: c } }]).doc;
    expect(syncMedia(syncMedia(mine, more.doc), fewer).map((m) => m.assetId)).toEqual([a, b, d]);
  });
});

describe('music', () => {
  it('offers sound files only, shows whether the beat was measured, and starts with a measured one', () => {
    let { doc, song: s1, other } = library();
    expect(musicAssets(doc).map((x) => x.id)).toEqual([s1, other]);
    expect(beatState(doc, other)).toEqual({ measured: false, count: 0, bpm: null });
    expect(defaultMusic(doc, 'beats')).toBe(s1); // none measured: the first
    expect(defaultMusic(doc, 'none')).toBe('');
    doc = tx(doc, [{ op: 'attach_analysis', args: { assetId: other, kind: 'beats', method: 'test', params: {}, createdAt: '2026-11-17T00:00:00Z', times: [T.rt(0, 1), T.rt(1, 2), T.rt(1, 1)], bpm: 120 } }], true).doc;
    expect(beatState(doc, other)).toEqual({ measured: true, count: 3, bpm: 120 });
    expect(defaultMusic(doc, 'optional')).toBe(other);
  });
});

describe('text counters (maxChars)', () => {
  it('count code points, say what is left and when the text is over the template\'s room', () => {
    expect(counter('', 20)).toEqual({ used: 0, max: 20, left: 20, over: false });
    expect(counter('יום הולדת', 9)).toEqual({ used: 9, max: 9, left: 0, over: false });
    expect(counter('יום הולדת!', 9)).toEqual({ used: 10, max: 9, left: 0, over: true });
    expect(charCount('😀ab')).toBe(3); // an emoji is one, not two UTF-16 units
  });
});

describe('request parameters', () => {
  it('send the included media in order, the music or null, the typed texts only, the motion choice and the language', () => {
    const { doc, a, b, c, song: s1 } = library();
    const media = toggleItem(moveItem(initialMedia(doc), 2, -1), b);
    expect(buildParams({ media, music: s1, texts: { title: 'שנה טובה', sub: '   ', end: '' }, motionNone: false, lang: 'he' })).toEqual({ media: [a, c], musicAssetId: s1, texts: { title: 'שנה טובה' }, lang: 'he', motion: 'full' });
    expect(buildParams({ media, music: '', texts: {}, motionNone: true, lang: 'en' })).toMatchObject({ musicAssetId: null, motion: 'none', lang: 'en' });
  });
  it('an alternative\'s parameters replace the current ones; texts are merged, never dropped; the inputs are not changed', () => {
    const base = { media: ['x'], musicAssetId: null, texts: { title: 'A' }, lang: 'he' as const, motion: 'full' as const };
    const merged = mergeAlternative(base, { params: { tempo: 'half', seed: 4, texts: { sub: 'B' } } });
    expect(merged).toEqual({ media: ['x'], musicAssetId: null, texts: { title: 'A', sub: 'B' }, lang: 'he', motion: 'full', tempo: 'half', seed: 4 });
    expect(base.texts).toEqual({ title: 'A' });
    expect(mergeAlternative(base, { params: { order: 'shuffle' } })).toEqual({ ...base, order: 'shuffle' });
    // through buildParams: the chosen alternative goes over the dialog's choices
    const { doc } = library();
    expect(buildParams({ media: initialMedia(doc), music: '', texts: {}, motionNone: false, lang: 'he', extra: { tempo: 'double', motion: 'none' } })).toMatchObject({ tempo: 'double', motion: 'none' });
  });
});

describe('plan view → rows', () => {
  const view: TemplatePlanView = {
    revision: 7, templateId: 'tpl.travel-montage', version: 1, params: { media: [], musicAssetId: null, texts: {}, lang: 'he', order: 'sequence', seed: 1, tempo: 'normal', motion: 'full' },
    steps: ['Place 6 pictures on the beat', 'Add the title'], basis: ['120 BPM from the measured beat'],
    warnings: [{ code: 'media_reused', message: 'a.mp4 is used twice', details: {} }], blocking: [],
    alternatives: [{ label: 'Half tempo', params: { tempo: 'half' } }, { label: 'Shuffled', params: { order: 'shuffle', seed: 2 } }],
    operations: 23, predicted: { startFrame: 30, endFrame: 495, boundaries: [30, 90], gapFrames: 11, slots: [{ key: 's1', startFrame: 30, frames: 60, assetId: 'a', sourceInFrame: 0, cropShare: 0 }, { key: 's2', startFrame: 90, frames: 405, assetId: 'b', sourceInFrame: null, cropShare: 0.2 }] },
    method: 'rule-based template; no model', note: '',
  };
  it('summarise operations, length and slots; list steps, basis, warnings and alternatives; can apply with nothing blocking', () => {
    const rows = planRows(view, R);
    expect(rows.summary).toEqual({ operations: 23, seconds: 15.5, clock: '0:15.5', slots: 2 });
    expect(rows.steps).toEqual(view.steps);
    expect(rows.basis).toEqual(view.basis);
    expect(rows.warnings).toEqual([{ code: 'media_reused', message: 'a.mp4 is used twice' }]);
    expect(rows.alternatives).toEqual([{ index: 0, label: 'Half tempo', params: { tempo: 'half' } }, { index: 1, label: 'Shuffled', params: { order: 'shuffle', seed: 2 } }]);
    expect(rows.canApply).toBe(true);
  });
  it('a blocking item stops "Use"', () => {
    const rows = planRows({ ...view, blocking: [{ code: 'slot_too_short', message: 'slot s2 needs 405 frames, the video has 120', details: { slot: 's2', haveFrames: 120, needFrames: 405 } }] }, R);
    expect(rows.blocking).toEqual([{ code: 'slot_too_short', message: 'slot s2 needs 405 frames, the video has 120' }]);
    expect(rows.canApply).toBe(false);
  });
  it('lengths read as m:ss', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(9)).toBe('0:09');
    expect(clock(75)).toBe('1:15');
    expect(planRows({ ...view, predicted: { ...view.predicted, startFrame: 0, endFrame: 900 } }, { num: 30000, den: 1001 }).summary.clock).toBe('0:30');
  });
});

describe('after apply: shuffle and another tempo', () => {
  it('shuffle asks for the next seed in shuffled order, and only that', () => {
    expect(shuffleParams({ seed: 1, order: 'sequence', tempo: 'half' })).toEqual({ seed: 2, order: 'shuffle' });
    expect(shuffleParams({})).toEqual({ seed: 2, order: 'shuffle' });
  });
  it('another tempo takes the first alternative with another tempo, else the next of normal → double → half', () => {
    const alts = [{ params: { order: 'shuffle' as const } }, { params: { tempo: 'half' as const } }];
    expect(nextTempo({ tempo: 'normal' }, alts)).toEqual({ tempo: 'half' });
    expect(nextTempo({ tempo: 'half' }, alts)).toEqual({ tempo: 'normal' });
    expect(nextTempo({}, [])).toEqual({ tempo: 'double' });
    expect(nextTempo({ tempo: 'double' }, [])).toEqual({ tempo: 'half' });
    expect(nextTempo({ tempo: 'half' }, [])).toEqual({ tempo: 'normal' });
  });
});

describe('the drawer', () => {
  const card = (id: string, genre: TemplateSummary['genre']) => ({ id, genre }) as TemplateSummary;
  it('genre chips are toggles; no chip shows every card', () => {
    const list = [card('tpl.a', 'montage'), card('tpl.b', 'celebration'), card('tpl.c', 'montage')];
    expect(filterByGenre(list, []).map((x) => x.id)).toEqual(['tpl.a', 'tpl.b', 'tpl.c']);
    expect(filterByGenre(list, ['montage']).map((x) => x.id)).toEqual(['tpl.a', 'tpl.c']);
    let g = toggleGenre([], 'celebration');
    expect(g).toEqual(['celebration']);
    g = toggleGenre(g, 'montage');
    expect(filterByGenre(list, g).map((x) => x.id)).toEqual(['tpl.a', 'tpl.b', 'tpl.c']);
    expect(toggleGenre(g, 'celebration')).toEqual(['montage']);
  });
});

describe('strings', () => {
  const keysOf = (o: object) => Object.keys(o).sort();
  it('Hebrew and English cover the same keys; every genre and warning code is named in both', () => {
    expect(keysOf(TEMPLATE_STRINGS.en)).toEqual(keysOf(TEMPLATE_STRINGS.he));
    expect(keysOf(ADJUST_STRINGS.en)).toEqual(keysOf(ADJUST_STRINGS.he));
    expect(keysOf(WELCOME_STRINGS.en)).toEqual(keysOf(WELCOME_STRINGS.he));
    for (const lang of ['he', 'en'] as const) {
      for (const g of TEMPLATE_GENRES) expect(TEMPLATE_STRINGS[lang].genre[g], `${lang} genre ${g}`).toBeTruthy();
      for (const c of TEMPLATE_WARNING_CODES) expect(TEMPLATE_STRINGS[lang].warning[c], `${lang} warning ${c}`).toBeTruthy();
    }
    expect(ADJUST_STRINGS.he.coverEdit).toBe('כסה את כל העריכה');
    expect(ADJUST_STRINGS.he.replaceMedia).toBe('החלפת מדיה…');
    expect([ADJUST_STRINGS.he.applyTo, ADJUST_STRINGS.he.applyToClip, ADJUST_STRINGS.he.applyToEdit]).toEqual(['החל על', 'קליפ זה', 'כל העריכה']);
    expect([TEMPLATE_STRINGS.he.measure, TEMPLATE_STRINGS.he.use, TEMPLATE_STRINGS.he.shuffle, TEMPLATE_STRINGS.he.otherTempo, WELCOME_STRINGS.he.s4]).toEqual(['מדוד קצב (ללא בינה מלאכותית)', 'השתמש', 'ערבב', 'קצב אחר', 'התחל מתבנית']);
  });
});
