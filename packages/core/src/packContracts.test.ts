/**
 * The contracts of the content packs and built-in music that the lead pre-pass owns (ADR-0022): the internal operation
 * add_builtin_music and attachKnownGrid (refusals, exact undo, hand-corrected data kept), edit_analysis keeping sections,
 * add_text making a finished title in ONE operation, apply_template attaching a carried grid, and the planner's built-in
 * music (made to measure, never past the pictures), pack fields and the element guard. No test here pins a placeholder: the
 * pack data, the synthesiser and the music layout's own tests are the workers'.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, captureOf, createProject, creativeProjection, diffEntities, findClip, knownGridOf, MUSIC_GENERATOR, MUSIC_METHOD, musicLayout, musicProvenanceParams, OpError, PACK_REFUSALS,
  restoreEntities, validateProject, type Asset, type KnownGrid, type OpCall, type ProjectDocument, type TemplateDef, type TemplatePlan,
} from './index.ts';
import { BUILTIN_MUSIC_ASSET_KEY, planTemplate } from './templatePlan.ts';
import { TemplateError } from './templateContract.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `pc${n++}_`, actor: 'test', allowInternal: true });
const refusal = (fn: () => unknown): OpError => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };
const planRefusal = (fn: () => unknown): TemplateError => { try { fn(); } catch (e) { if (e instanceof TemplateError) return e; throw e; } throw new Error('not refused'); };
const hash = (k: number) => `sha256:${k.toString(16).padStart(64, '0')}`;
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00.000Z', importedBy: 'test' };

/** A built-in music asset record as makeMusic stores it (no file: core never reads one). */
function musicAsset(styleId: string, bars: number, seed = 1, k = 1): { asset: Omit<Asset, 'id'>; grid: KnownGrid } {
  const layout = musicLayout(styleId, bars);
  return {
    asset: {
      kind: 'audio', name: `${styleId}.wav`, contentHash: hash(500_000 + k), byteSize: 44 + 4 * layout.totalFrames, container: 'wav', mimeType: 'audio/wav', duration: layout.duration,
      audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' },
      provenance: { origin: 'generated', importedAt: '2026-11-17T00:00:00.000Z', importedBy: 'test', procedural: { id: styleId, version: 1, generator: MUSIC_GENERATOR, params: musicProvenanceParams(layout, seed) } },
    },
    grid: knownGridOf(layout, seed, '2026-11-17T00:00:00.000Z'),
  };
}
const base = () => createProject({ id: 'prj_pc', name: 'PC', width: 540, height: 960, frameRate: R });
/** Apply, then undo by restoring the entities the transaction changed: the creative projection is the one before. */
function undoes(doc: ProjectDocument, ops: OpCall[]) {
  const r = tx(doc, ops);
  expect(validateProject(r.doc)).toEqual([]);
  const back = structuredClone(r.doc);
  restoreEntities(back, diffEntities(doc, r.doc).map((c) => ({ id: c.id, state: c.before })));
  expect(creativeProjection(back)).toBe(creativeProjection(doc));
  return r;
}

describe('add_builtin_music (internal): one step adds the track, its known grid and optionally a clip', () => {
  it('imports, attaches the grid with method and sections (confidence null), places through add_clip, and undoes exactly', () => {
    const { asset, grid } = musicAsset('music.festive', 16, 7);
    const r = undoes(base(), [{ op: 'add_builtin_music', args: { asset, grid, place: { start: f(30) } } }]);
    const out = r.results[0]!.output as { assetId: string; deduplicated: boolean; analysisAttached: boolean; clipId: string; trackId: string };
    expect(out).toMatchObject({ deduplicated: false, analysisAttached: true });
    const beats = r.doc.analyses[out.assetId]!.beats!;
    expect(beats.origin).toMatchObject({ method: MUSIC_METHOD, edited: false, createdBy: 'test' });
    expect(beats.confidence).toBeNull();
    expect(beats.beats).toHaveLength(64);
    expect(beats.downbeats).toHaveLength(16);
    expect(beats.sections!.map((s) => [s.kind, s.level])).toEqual([['intro', 0], ['build', 1], ['peak', 3], ['ending', 3]]);
    const placed = findClip(r.doc, out.clipId)!;
    expect(placed.track.id).toBe(out.trackId);
    expect(placed.clip.type === 'media' && T.eq(placed.clip.start, f(30))).toBe(true);
    expect(r.results[0]!.affectedIds).toEqual(expect.arrayContaining([out.assetId, `analysis:${out.assetId}`, out.clipId]));
  });
  it('the same track again is deduplicated and the same grid is not written again', () => {
    const { asset, grid } = musicAsset('music.calm', 8);
    const a = tx(base(), [{ op: 'add_builtin_music', args: { asset, grid } }]);
    const b = tx(a.doc, [{ op: 'add_builtin_music', args: { asset, grid } }]);
    expect(b.results[0]!.output).toMatchObject({ deduplicated: true, analysisAttached: false });
    expect(b.results[0]!.affectedIds).toEqual([]);
  });
  it('a beat analysis a person corrected by hand is kept as it is', () => {
    const { asset, grid } = musicAsset('music.pop', 4);
    const a = tx(base(), [{ op: 'add_builtin_music', args: { asset, grid } }]);
    const id = a.results[0]!.output!.assetId as string;
    const edited = tx(a.doc, [{ op: 'edit_analysis', args: { assetId: id, kind: 'beats', remove: [grid.beats[1]!] } }]);
    expect(edited.doc.analyses[id]!.beats!.origin.edited).toBe(true);
    // edit_analysis carries the sections through unchanged
    expect(edited.doc.analyses[id]!.beats!.sections).toEqual(a.doc.analyses[id]!.beats!.sections);
    const again = tx(edited.doc, [{ op: 'add_builtin_music', args: { asset, grid } }]);
    expect(again.results[0]!.output).toMatchObject({ deduplicated: true, analysisAttached: false });
    expect(again.doc.analyses[id]).toEqual(edited.doc.analyses[id]);
  });
  it('refuses what is not built-in music and a grid that is out of order or outside the track, each with its fixed sentence', () => {
    const { asset, grid } = musicAsset('music.lofi', 4);
    const add = (a: unknown, g: unknown = grid) => () => tx(base(), [{ op: 'add_builtin_music', args: { asset: a, grid: g } }]);
    const notMusic = refusal(add({ ...asset, provenance: { ...asset.provenance, procedural: { id: 'sfx.pop', version: 1, generator: 'x' } } }));
    expect([notMusic.code, notMusic.message, notMusic.hint]).toEqual(['invalid_args', PACK_REFUSALS.notBuiltinMusic.message(), PACK_REFUSALS.notBuiltinMusic.hint]);
    expect(refusal(add({ ...asset, video: { width: 2, height: 2, frameRate: R, codec: 'h264', rotation: 0, frameCount: null } })).message).toBe(PACK_REFUSALS.notBuiltinMusic.message());
    const swapped = [grid.beats[1]!, grid.beats[0]!, ...grid.beats.slice(2)];
    expect(refusal(add(asset, { ...grid, beats: swapped })).message).toBe(PACK_REFUSALS.gridBeatsOrder.message());
    expect(refusal(add(asset, { ...grid, downbeats: [T.rt(1, 7)] })).message).toBe(PACK_REFUSALS.gridBarNotBeat.message());
    expect(refusal(add(asset, { ...grid, beats: [...grid.beats, asset.duration] })).message).toBe(PACK_REFUSALS.gridOutsideFile.message());
    expect(refusal(add(asset, { ...grid, sections: [{ start: T.rt(1, 1), kind: 'intro', level: 0 }] })).message).toBe(PACK_REFUSALS.gridSections.message());
    expect(refusal(add(asset, { ...grid, sections: [grid.sections[0]!, grid.sections[0]!] })).message).toBe(PACK_REFUSALS.gridSections.message());
    // a grid whose method is not the recipe's is not a known grid
    expect(refusal(add(asset, { ...grid, method: 'measured' })).code).toBe('invalid_args');
  });
  it('a placement that add_clip refuses refuses the whole step: nothing is added', () => {
    const { asset, grid } = musicAsset('music.birthday', 4);
    const e = refusal(() => tx(base(), [{ op: 'add_builtin_music', args: { asset, grid, place: { start: T.rt(1, 1000) } } }]));
    expect(e.code).toBe('invalid_args');
  });
  it('validateProject refuses sections that do not start at 0 or are not ascending', () => {
    const { asset, grid } = musicAsset('music.festive', 8);
    const r = tx(base(), [{ op: 'add_builtin_music', args: { asset, grid } }]);
    const id = r.results[0]!.output!.assetId as string;
    const bad = structuredClone(r.doc);
    bad.analyses[id]!.beats!.sections = [{ start: T.rt(1, 2), kind: 'intro', level: 0 }];
    expect(validateProject(bad).map((i) => i.code)).toContain('analysis_sections');
  });
});

describe('add_text: a finished title in ONE operation (presetId, animation, fields)', () => {
  it('equals add_text + apply_text_preset + update_text style + set_text_animation + set_text_fields', () => {
    const doc = base();
    const animation = { by: 'letter' as const, in: 'rise' as const, out: 'fade' as const, loop: null, inFrames: 12, outFrames: 9 };
    const one = tx(doc, [{ op: 'add_text', args: { text: 'נר {hebrewDate}', start: f(0), duration: f(60), style: { sizeFrac: 0.09 }, presetId: 'neon-tube-pink', animation, fields: true } }]);
    const id1 = one.results[0]!.output!.clipId as string;
    const four = tx(doc, [{ op: 'add_text', args: { text: 'נר {hebrewDate}', start: f(0), duration: f(60) } }]);
    const id2 = four.results[0]!.output!.clipId as string;
    const chain = tx(four.doc, [
      { op: 'apply_text_preset', args: { clipId: id2, presetId: 'neon-tube-pink' } },
      { op: 'update_text', args: { clipId: id2, style: { sizeFrac: 0.09 } } },
      { op: 'set_text_animation', args: { clipId: id2, animation } },
      { op: 'set_text_fields', args: { clipId: id2, enabled: true } },
    ]);
    const strip = (c: unknown) => JSON.parse(JSON.stringify(c, (k, v) => (k === 'id' ? undefined : v)));
    expect(strip(findClip(one.doc, id1)!.clip)).toEqual(strip(findClip(chain.doc, id2)!.clip));
    expect(one.results[0]!.affectedIds).toEqual([id1]);
  });
  it('an unknown preset or a text that is not fields refuses the whole add: nothing is added', () => {
    expect(refusal(() => tx(base(), [{ op: 'add_text', args: { text: 'x', start: f(0), duration: f(30), presetId: 'no-such-style' } }])).code).toBe('not_found');
    expect(refusal(() => tx(base(), [{ op: 'add_text', args: { text: '{weather}', start: f(0), duration: f(30), fields: true } }])).code).toBe('invalid_args');
  });
  it('without the new arguments it is exactly what it was (old logs replay unchanged)', () => {
    const r = tx(base(), [{ op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(30) } }]);
    const c = findClip(r.doc, r.results[0]!.output!.clipId as string)!.clip;
    expect(c.type === 'text' && c.effects === undefined && c.fields === undefined && c.animation === undefined).toBe(true);
  });
});

// ---------- the planner ----------
const words = (en: string) => ({ he: `${en} (עברית)`, en });
type Slot = TemplateDef['slots'][number];
const slot = (i: number, span: Slot['span']): Slot => ({ key: `s${i}`, role: words(`Slot ${i}`), accept: 'any', span });
const TPL = (over: Partial<TemplateDef> = {}): TemplateDef => ({
  id: 'tpl.packtest', version: 1, name: words('Pack test'), hint: words('A template for this test'), genre: 'celebration', designedFor: 'tall', tempo: { fallbackBpm: 125 },
  music: { need: 'optional', startAt: 'zero' }, slots: [1, 2, 3, 4].map((i) => slot(i, { bars: 1 })), slotUse: { mode: 'all', min: 1 }, texts: [], elements: [], sfx: [], adjust: [], ...over,
});
function project(rate = R, capture = false): ProjectDocument {
  const doc = createProject({ id: 'prj_pt', name: 'pt', width: 540, height: 960, frameRate: rate });
  for (const [i, id] of ['vid_a', 'vid_b', 'vid_c', 'vid_d'].entries()) doc.assets[id] = {
    id, kind: 'video', name: `${id}.mp4`, contentHash: hash(100 + i), byteSize: 1000, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(120, 1),
    video: { width: 540, height: 960, frameRate: rate, codec: 'h264', rotation: 0, frameCount: null }, provenance: prov,
    ...(capture ? { capture: { at: '2026-12-04T18:00:00', utcOffsetMinutes: 120, source: 'container' as const } } : {}),
  };
  return doc;
}
const MEDIA = ['vid_a', 'vid_b', 'vid_c', 'vid_d'];
const musicStep = (plan: TemplatePlan) => plan.ops.find((o) => o.bind === 'music');
const argsOf = (step: { args: unknown } | undefined) => step!.args as Record<string, unknown>;
const frames = (t: unknown, rate = R) => T.frameIndexAt(t as T.RationalTime, rate);
/** The procedural assets a server would make for a plan (fixed records, no files); music arrives with its known grid. */
const madeAssets = (plan: TemplatePlan) => plan.assetsNeeded.map((x, i) => (x.kind === 'music'
  ? { key: x.key, ...(({ asset, grid }) => ({ asset, analysis: grid }))(musicAsset(x.id, x.bars, x.seed, 50 + i)) }
  : { key: x.key, asset: { kind: 'image' as const, name: `${x.id}.png`, contentHash: hash(800_000 + i), byteSize: 10, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 64, height: 64, codec: 'png', hasAlpha: true }, provenance: { ...prov, origin: 'generated' as const } } }));
const apply = (doc: ProjectDocument, plan: TemplatePlan) => undoes(doc, [{ op: 'apply_template', args: { templateId: plan.templateId, templateVersion: plan.version, params: plan.params, steps: plan.steps, assets: madeAssets(plan), ops: plan.ops, slots: plan.slots } }]);

describe('planner: built-in music made to measure (ADR-0022, plan §4.7 with the verifier\'s corrections)', () => {
  it('cuts on exactly the steady grid of the style\'s tempo, and slots that end on a bar line get a track that ends with them: no fade', () => {
    for (const rate of [{ num: 24, den: 1 }, { num: 25, den: 1 }, { num: 30, den: 1 }, { num: 30000, den: 1001 }]) {
      const doc = project(rate);
      const plain = planTemplate(doc, TPL(), { media: MEDIA });
      const made = planTemplate(doc, TPL(), { media: MEDIA, builtinMusic: { styleId: 'music.festive', seed: 2 } });
      expect(made.predicted.boundaries).toEqual(plain.predicted.boundaries); // fallbackBpm 125 = music.festive's tempo
      expect(made.assetsNeeded).toContainEqual({ key: BUILTIN_MUSIC_ASSET_KEY, kind: 'music', id: 'music.festive', bars: 4, seed: 2 });
      const step = musicStep(made)!;
      expect(step.op).toBe('add_clip');
      const pictures = made.predicted.endFrame - made.predicted.startFrame;
      const clip = frames(argsOf(step).duration, rate);
      expect(clip).toBeLessThanOrEqual(pictures);
      expect(clip).toBeGreaterThanOrEqual(pictures - 1);
      expect(made.ops.some((o) => o.op === 'fit_music' || o.op === 'set_clip_fades')).toBe(false);
      expect(made.notices).toEqual([]);
      const r = apply(doc, made);
      const assetId = Object.values(r.doc.assets).find((a) => a.provenance.procedural?.id === 'music.festive')!.id;
      expect(r.doc.analyses[assetId]!.beats!.origin.method).toBe(MUSIC_METHOD);
    }
  });
  it('counts bars from the EXACT end of the last slot, not its frame: 16 bars at 125 BPM stay 16 at 30 fps (921.6 frames)', () => {
    const plan = planTemplate(project(), TPL({ slots: [slot(1, { bars: 8 }), slot(2, { bars: 8 })] }), { media: MEDIA, builtinMusic: { styleId: 'music.festive', seed: 1 } });
    expect(plan.assetsNeeded.find((x) => x.kind === 'music')).toMatchObject({ bars: 16 });
  });
  it('a track longer than the pictures (the style\'s shortest track) is cut at the last picture and faded: never past it, never fit_music', () => {
    const doc = project();
    const plan = planTemplate(doc, TPL({ slots: [slot(1, { beats: 2 }), slot(2, { beats: 2 })] }), { media: MEDIA, builtinMusic: { styleId: 'music.festive', seed: 1 } });
    expect(plan.assetsNeeded.find((x) => x.kind === 'music')).toMatchObject({ bars: 4 });
    const pictures = plan.predicted.endFrame - plan.predicted.startFrame;
    expect(frames(argsOf(musicStep(plan)).duration)).toBe(pictures);
    const fade = plan.ops.find((o) => o.op === 'set_clip_fades')!;
    expect(frames(argsOf(fade).fadeOut)).toBe(Math.min(30, Math.floor(pictures / 2)));
    expect(plan.ops.some((o) => o.op === 'fit_music')).toBe(false);
    expect(plan.notices.map((x) => x.code)).toEqual(['builtin_music_faded']);
    apply(doc, plan);
  });
  it('satisfies a template that cuts on beats; a template without music makes none and says so', () => {
    const beats = planTemplate(project(), TPL({ music: { need: 'beats', startAt: 'first-downbeat' } }), { media: MEDIA, builtinMusic: { styleId: 'music.pop', seed: 1 } });
    expect(beats.assetsNeeded.some((x) => x.kind === 'music')).toBe(true);
    const none = planTemplate(project(), TPL({ music: { need: 'none', startAt: 'zero' } }), { media: MEDIA, builtinMusic: { styleId: 'music.pop', seed: 1 } });
    expect(none.assetsNeeded.some((x) => x.kind === 'music')).toBe(false);
    expect(none.basis.join('\n')).toContain('no built-in music was made');
  });
  it('refuses both sources at once, an unknown style, and a track over 300 s (naming the length)', () => {
    const doc = project();
    expect(planRefusal(() => planTemplate(doc, TPL(), { media: MEDIA, musicAssetId: 'vid_a', builtinMusic: { styleId: 'music.pop' } })).message).toBe('choose a music file or built-in music, not both');
    const unknown = planRefusal(() => planTemplate(doc, TPL(), { media: MEDIA, builtinMusic: { styleId: 'music.nope' } }));
    expect([unknown.code, unknown.message]).toEqual(['invalid_args', 'there is no built-in music style "music.nope"']);
    const long = TPL({ slots: Array.from({ length: 10 }, (_, i) => slot(i + 1, { bars: 16 })) });
    expect(planRefusal(() => planTemplate(doc, long, { media: MEDIA, builtinMusic: { styleId: 'music.cinematic' } })).message).toMatch(/^built-in music for this template would be 534 s long \(160 bars\); a built-in track is at most 300 s$/);
  });
  it('a plan without builtinMusic keeps its parameters exactly as before (no new keys)', () => {
    const plan = planTemplate(project(), TPL(), { media: MEDIA });
    expect(Object.keys(plan.params)).not.toContain('builtinMusic');
    expect(Object.keys(plan.params)).not.toContain('fields');
  });
});

describe('planner: pack fields in a template\'s own titles', () => {
  const text = (key: string, def: { he: string; en: string }, fallback?: { he: string; en: string }, extra: Partial<TemplateDef['texts'][number]> = {}): TemplateDef['texts'][number] =>
    ({ key, role: words('Title'), default: def, ...(fallback ? { fallback } : {}), maxChars: 60, presetId: 'clean-white', at: { slot: 's1' }, place: { x: 0, y: 0 }, ...extra });
  const titles = (plan: TemplatePlan) => plan.ops.filter((o) => o.op === 'add_text').map((o) => argsOf(o).text);
  it('writes the given words in; without a value the fallback words are used and a notice says so', () => {
    const def = TPL({ texts: [text('t', { he: 'חנוכה שמח, {name}!', en: 'Happy Hanukkah, {name}!' }, { he: 'חנוכה שמח!', en: 'Happy Hanukkah!' })] });
    expect(titles(planTemplate(project(), def, { media: MEDIA, fields: { name: 'נועה' } }))).toEqual(['חנוכה שמח, נועה!']);
    const missing = planTemplate(project(), def, { media: MEDIA });
    expect(titles(missing)).toEqual(['חנוכה שמח!']);
    expect(missing.notices).toEqual([expect.objectContaining({ code: 'field_missing', details: { key: 't', fields: ['name'] } })]);
    // words the caller typed are literal: nothing in them is read as a field
    expect(titles(planTemplate(project(), def, { media: MEDIA, texts: { t: 'שלום {name}' } }))).toEqual(['שלום {name}']);
  });
  it('{night} is worked out from the date: 4 December 2026 at the candle lighting is the first candle', () => {
    const def = TPL({ texts: [text('t', { he: 'נר {night} של חנוכה', en: 'Hanukkah candle {night}' }, { he: 'חנוכה', en: 'Hanukkah' })] });
    expect(titles(planTemplate(project(), def, { media: MEDIA, fields: { date: '2026-12-04' } }))).toEqual(['נר 1 של חנוכה']);
    expect(titles(planTemplate(project(), def, { media: MEDIA, fields: { date: '2026-12-04', atLighting: false } }))).toEqual(['חנוכה']); // its daytime is not Hanukkah yet
    expect(titles(planTemplate(project(), def, { media: MEDIA, fields: { night: '5', date: '2026-12-04' } }))).toEqual(['נר 5 של חנוכה']);
  });
  it('the per-slot counter {n} stays the planner\'s own and is written after the fields', () => {
    const def = TPL({ texts: [text('t', { he: '{name} {n}', en: '{name} {n}' }, { he: 'מספר {n}', en: 'Number {n}' }, { perSlot: 'count-up' })] });
    expect(titles(planTemplate(project(), def, { media: MEDIA, fields: { name: 'דן' } }))).toEqual(['דן 1', 'דן 2', 'דן 3', 'דן 4']);
    expect(titles(planTemplate(project(), def, { media: MEDIA }))).toEqual(['מספר 1', 'מספר 2', 'מספר 3', 'מספר 4']);
  });
  it('a live field stays live over dated pictures (the title is made with fields on) and falls back over undated ones', () => {
    const def = TPL({ texts: [text('t', { he: '{hebrewDate}', en: '{hebrewDate}' }, { he: 'חג שמח', en: 'Happy holiday' })] });
    const dated = project(R, true);
    expect(captureOf(dated, 'vid_a')).not.toBeNull();
    const live = planTemplate(dated, def, { media: MEDIA });
    expect(titles(live)).toEqual(['{hebrewDate}']);
    expect(live.ops.some((o) => o.op === 'set_text_fields')).toBe(true);
    apply(dated, live);
    const plain = planTemplate(project(), def, { media: MEDIA });
    expect(titles(plain)).toEqual(['חג שמח']);
    expect(plain.notices.map((x) => x.code)).toEqual(['field_no_date']);
  });
  it('a template whose title holds a field and no fallback words is refused as a broken template', () => {
    const def = TPL({ texts: [text('t', { he: 'שלום {name}', en: 'Hello {name}' })] });
    expect(planRefusal(() => planTemplate(project(), def, { media: MEDIA })).code).toBe('invalid_args');
  });
});

describe('planner: two element copies on one track range are never both placed', () => {
  it('fewer media than slots moves elements of unused slots onto the last used one: the earlier is left out, apply succeeds', () => {
    const el = (i: number): TemplateDef['elements'][number] => ({ key: `e${i}`, elementId: 'element.symbol.location-pin', at: { slot: `s${i}` }, place: { x: 0, y: 0 } });
    const def = TPL({ slotUse: { mode: 'media', min: 1 }, elements: [el(1), el(2), el(3), el(4)] });
    const doc = project();
    const plan = planTemplate(doc, def, { media: ['vid_a'] });
    expect(plan.notices.map((x) => x.code)).toEqual(['element_dropped']);
    expect(plan.notices[0]!.details).toEqual({ keys: ['e1', 'e2', 'e3'] });
    expect(plan.ops.filter((o) => o.op === 'add_clip' && o.bind?.startsWith('e')).map((o) => o.bind)).toEqual(['e4']);
    apply(doc, plan);
  });
});
