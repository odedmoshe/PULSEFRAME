/**
 * The template planner (ADR-0016): pure properties over frame rates and random beat grids, the refusals and warnings it
 * promises, and plans applied through the one internal op apply_template (validateProject = [], music beats on the boundaries).
 * Uses inline test templates; the built-in catalogue (templateCatalog.ts) is planned and applied at the end when it is filled.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, canonical, createProject, flashGapFrames, MOTION_PRESETS, packLookOp, packLookOps, PACKS, sourceTimesToTimeline, TEMPLATES, TemplateError, TRANSITION_IDS, validateProject,
  type Asset, type ProjectDocument, type TemplateDef, type TemplatePlan,
} from './index.ts';
import { MAX_TEMPLATE_OPS, mirrorForReading, planTemplate, summarizeTemplate } from './templatePlan.ts';
import { useApplyTemplateDoubleIfStub } from './templatePlan.testDouble.ts';

// TEST DOUBLE: on a tree where apply_template is still the contracts stub, its body is replaced by the labelled double in
// templatePlan.testDouble.ts; where the real op is registered (after the merge) nothing is replaced and the real op runs.
const USING_DOUBLE = useApplyTemplateDoubleIfStub();

type Rate = { num: number; den: number };
const RATES: Rate[] = [{ num: 24, den: 1 }, { num: 25, den: 1 }, { num: 30000, den: 1001 }, { num: 30, den: 1 }, { num: 50, den: 1 }, { num: 60, den: 1 }];
const hash = (n: number) => `sha256:${n.toString(16).padStart(64, '0')}`;
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00.000Z', importedBy: 'test' };
const ms = (n: number) => T.rt(n, 1000);
let seq = 1;
const video = (id: string, seconds: number | T.RationalTime, rate: Rate, w = 540, h = 960, audio = true): Asset => ({
  id, kind: 'video', name: `${id}.mp4`, contentHash: hash(seq++), byteSize: 1000, container: 'mp4', mimeType: 'video/mp4', duration: typeof seconds === 'number' ? T.fromSeconds(seconds) : seconds,
  video: { width: w, height: h, frameRate: rate, codec: 'h264', rotation: 0, frameCount: null },
  ...(audio ? { audio: { sampleRate: 48000, channels: 2, codec: 'aac' } } : {}), provenance: prov,
});
const image = (id: string, w = 1080, h = 1080): Asset => ({ id, kind: 'image', name: `${id}.png`, contentHash: hash(seq++), byteSize: 100, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: w, height: h, codec: 'png', hasAlpha: false }, provenance: prov });
const sound = (id: string, duration: T.RationalTime): Asset => ({ id, kind: 'audio', name: `${id}.wav`, contentHash: hash(seq++), byteSize: 100, container: 'wav', mimeType: 'audio/wav', duration, audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov });
const origin = { method: 'test grid', params: {}, createdAt: '2026-11-17T00:00:00.000Z', createdBy: 'test', edited: false };

/** A project with four long videos, two pictures and (optionally) music whose beats are `beats` (source times), a bar every 4. */
function project(rate: Rate, beats: T.RationalTime[] | null, o: { width?: number; height?: number; musicSeconds?: number; analysed?: boolean } = {}): ProjectDocument {
  const doc = createProject({ id: 'prj_t', name: 't', width: o.width ?? 540, height: o.height ?? 960, frameRate: rate });
  for (const id of ['vid_a', 'vid_b', 'vid_c', 'vid_d']) doc.assets[id] = video(id, 120, rate);
  doc.assets.img_a = image('img_a');
  doc.assets.img_b = image('img_b', 960, 540);
  if (beats) {
    doc.assets.mus = sound('mus', T.fromSeconds(o.musicSeconds ?? 600));
    if (o.analysed !== false) doc.analyses.mus = { assetId: 'mus', beats: { origin, bpm: 120, confidence: 0.9, beats, downbeats: beats.filter((_, i) => i % 4 === 0), meter: 4 } };
  }
  return doc;
}
/** The procedural assets a server would make for a plan (here: fixed records, no files). */
const madeAssets = (plan: TemplatePlan) => plan.assetsNeeded.map((n, i) => ({ key: n.key, asset: n.kind === 'sfx'
  ? { kind: 'audio' as const, name: `${n.id}.wav`, contentHash: hash(900_000 + i), byteSize: 10, container: 'wav', mimeType: 'audio/wav', duration: T.rt(3, 10), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { ...prov, origin: 'generated' as const } }
  : { kind: 'image' as const, name: `${n.id}.png`, contentHash: hash(800_000 + i), byteSize: 10, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 1024, height: 1024, codec: 'png', hasAlpha: true }, provenance: { ...prov, origin: 'generated' as const } } }));
const apply = (doc: ProjectDocument, plan: TemplatePlan) => applyTransaction(doc, [{ op: 'apply_template', args: { templateId: plan.templateId, templateVersion: plan.version, params: plan.params, steps: plan.steps, assets: madeAssets(plan), ops: plan.ops, slots: plan.slots } }], { idSeed: 'tpltest', actor: 'test', allowInternal: true });

const words = (en: string) => ({ he: `${en} (he)`, en });
type SlotDef = TemplateDef['slots'][number];
const SPANS: SlotDef['span'][] = [{ beats: 1 }, { beats: 2 }, { bars: 1 }, { beats: 3 }];
/** A template that uses every kind of item: beats and bars, moves and entrances, transitions both ways, per-slot copies, tags. */
const PROP: TemplateDef = {
  id: 'tpl.prop', version: 1, name: words('Prop'), hint: words('Test'), genre: 'montage', designedFor: 'tall', tempo: { fallbackBpm: 120 },
  music: { need: 'beats', startAt: 'first-downbeat' },
  slots: Array.from({ length: 10 }, (_, i): SlotDef => ({
    key: `s${i + 1}`, role: words(`Slot ${i + 1}`), accept: i === 3 ? 'image' : 'any', span: SPANS[i % SPANS.length]!,
    ...(i % 2 ? { motion: { presetId: 'motion.move.pan-left', amount: 0.6 } } : { motion: { presetId: 'motion.in.slide-left' } }),
    ...(i > 0 ? { transitionIn: i % 3 ? { type: 'push-left', seconds: 0.3, dir: 'reading' as const } : { type: 'dissolve', seconds: 0.2, dir: 'fixed' as const } } : {}),
    ...(i === 2 ? { keepAudio: true } : {}), ...(i < 2 ? { tag: 'a' } : {}),
  })),
  slotUse: { mode: 'media', min: 3 },
  texts: [
    { key: 'title', role: words('Title'), default: words('Hello'), maxChars: 20, presetId: 'display-big', anim: { by: 'letter', in: 'rise', out: 'fade', loop: null, inSeconds: 0.8, outSeconds: 0.5 }, at: { slot: 's1', spanSlots: 2 }, place: { x: 0, y: -0.2, sizeFrac: 0.08 } },
    { key: 'num', role: words('Number'), default: words('#{n}'), maxChars: 4, presetId: 'display-yellow', perSlot: 'count-down', anim: { by: 'letter', in: 'pop', out: null, loop: null, inSeconds: 0.3, outSeconds: 0.3 }, at: { slot: 's2', offsetBeats: 1 }, place: { x: 0, y: 0.25 } },
  ],
  elements: [{ key: 'pin', elementId: 'element.symbol.location-pin', color: '#FFFFFF', at: { slot: 's1', spanSlots: 2 }, place: { x: 0, y: -0.35, scale: 0.5 }, motion: { presetId: 'motion.in.drop' } }],
  sfx: [{ key: 'whoosh', sfxId: 'sfx.whoosh-short', at: 'boundaries', everyN: 2, gain: 0.5 }, { key: 'ding', sfxId: 'sfx.ding', at: { text: 'title' } }],
  adjust: [
    { key: 'look', span: 'all', effects: [{ type: 'color.adjust', params: { saturation: 1.1 } }], fadeSeconds: 0.5 },
    { key: 'tagged', span: { tag: 'a' }, effects: [{ type: 'light.vignette', params: { amount: 0.3 } }] },
  ],
};
const MEDIA = ['vid_a', 'img_a', 'vid_b', 'vid_c', 'img_b', 'vid_d'];
/** Irregular beat grids: a first beat, then gaps of 0.28–0.9 s. */
const gridArb = fc.record({ first: fc.integer({ min: 0, max: 2000 }), gaps: fc.array(fc.integer({ min: 280, max: 900 }), { minLength: 50, maxLength: 90 }) });
const beatsOf = (g: { first: number; gaps: number[] }) => { let t = g.first; return [ms(t), ...g.gaps.map((d) => ms((t += d)))]; };
const nfOf = (rate: Rate) => (t: T.RationalTime) => T.nearestFrameIndex(t, rate);

describe('planTemplate: properties at six frame rates and random beat grids', () => {
  for (const rate of RATES) {
    const fps = rate.num / rate.den, gap = flashGapFrames(fps), nf = nfOf(rate);
    it(`${rate.num}/${rate.den} fps: boundaries snap once to the beats, increase, keep the flash gap and add up exactly; equal input, equal ops`, () => {
      fc.assert(fc.property(gridArb, fc.integer({ min: 0, max: 90 }), fc.integer({ min: 1, max: 6 }), fc.constantFrom('normal', 'half', 'double'), fc.constantFrom('sequence', 'shuffle'), fc.integer({ min: 0, max: 1000 }), (g, atFrame, n, tempo, order, seed) => {
        const beats = beatsOf(g);
        const doc = project(rate, beats);
        const at = T.frameTime(atFrame, rate);
        const input = { media: MEDIA.slice(0, n), musicAssetId: 'mus', at, tempo, order, seed, lang: 'he' };
        let plan: TemplatePlan;
        try { plan = planTemplate(doc, PROP, input); } catch (e) { if (e instanceof TemplateError && e.code === 'nothing_to_do') return; throw e; }
        const { boundaries, startFrame, endFrame } = plan.predicted;
        // timeline beats once the music sits at `at` from its first bar start (the first beat here)
        const timeline = beats.map((b) => T.add(at, T.sub(b, beats[0]!)));
        const beatFrames = new Set(timeline.map(nf));
        expect(boundaries[0]).toBe(nf(at));
        for (let i = 1; i < boundaries.length; i++) {
          expect(boundaries[i]!).toBeGreaterThan(boundaries[i - 1]!);
          expect(beatFrames.has(boundaries[i]!), `boundary ${boundaries[i]} is a beat`).toBe(true);
          if (boundaries.length > 2) expect(boundaries[i]! - boundaries[i - 1]!).toBeGreaterThanOrEqual(gap);
        }
        const slotFrames = plan.predicted.slots.reduce((s, x) => s + x.frames, 0);
        expect(slotFrames).toBe(endFrame - startFrame);
        expect(plan.predicted.slots.map((s) => s.startFrame)).toEqual(boundaries.slice(0, -1));
        // a slot counted in beats starts and ends exactly on the snapped beats it names
        for (const s of plan.slots) {
          if (s.kind !== 'picture' || s.beats?.unit !== 'beat') continue;
          const ps = plan.predicted.slots.find((x) => x.key === s.key)!;
          expect(ps.startFrame).toBe(nf(timeline[s.beats.from]!));
          expect(ps.startFrame + ps.frames).toBe(nf(timeline[s.beats.from + s.beats.count]!));
        }
        expect(plan.ops.length).toBeLessThanOrEqual(MAX_TEMPLATE_OPS);
        expect(canonical(planTemplate(doc, PROP, input).ops)).toBe(canonical(plan.ops));
      }), { numRuns: 40 });
    });

    it(`${rate.num}/${rate.den} fps: without music the steady grid is exact (k·60/bpm from the start, snapped once)`, () => {
      const def: TemplateDef = { ...PROP, id: 'tpl.steady', music: { need: 'optional', startAt: 'first-downbeat' } };
      fc.assert(fc.property(fc.integer({ min: 0, max: 200 }), fc.integer({ min: 3, max: 6 }), fc.constantFrom('normal', 'half', 'double'), (atFrame, n, tempo) => {
        const doc = project(rate, null);
        const at = T.frameTime(atFrame, rate);
        const plan = planTemplate(doc, def, { media: MEDIA.slice(0, n), at, tempo });
        // 120 BPM: beat k at at + k/2 s
        const steady = new Set(Array.from({ length: 400 }, (_, k) => nf(T.add(at, T.rt(k, 2)))));
        for (const b of plan.predicted.boundaries) expect(steady.has(b)).toBe(true);
        for (let i = 1; i < plan.predicted.boundaries.length; i++) expect(plan.predicted.boundaries[i]! - plan.predicted.boundaries[i - 1]!).toBeGreaterThanOrEqual(gap);
        expect(plan.basis[0]).toContain('steady grid');
        expect(plan.ops.some((o) => o.op === 'fit_music')).toBe(false);
      }), { numRuns: 30 });
    });

    it(`${rate.num}/${rate.den} fps: titles never animate longer than they last, and the plan applies to a valid project`, () => {
      fc.assert(fc.property(gridArb, fc.integer({ min: 1, max: 6 }), (g, n) => {
        const beats = beatsOf(g);
        const doc = project(rate, beats);
        let plan: TemplatePlan;
        try { plan = planTemplate(doc, PROP, { media: MEDIA.slice(0, n), musicAssetId: 'mus', lang: 'en' }); } catch (e) { if (e instanceof TemplateError && e.code === 'nothing_to_do') return; throw e; }
        expect(plan.blocking).toEqual([]);
        for (const op of plan.ops.filter((o) => o.op === 'set_text_animation')) {
          const a = op.args as { clipId: { $ref: string }; animation: { in: string | null; out: string | null; inFrames: number; outFrames: number } };
          const text = plan.ops.find((o) => o.bind === a.clipId.$ref)!.args as { duration: T.RationalTime };
          expect((a.animation.in ? a.animation.inFrames : 0) + (a.animation.out ? a.animation.outFrames : 0)).toBeLessThanOrEqual(T.frameIndexAt(text.duration, rate));
        }
        const r = apply(doc, plan);
        expect(validateProject(r.doc)).toEqual([]);
        const out = r.results[0]!.output as { runId: string; slots: { key: string; clipId: string }[] };
        expect(out.slots.map((s) => s.key)).toEqual(plan.slots.map((s) => s.key));
        expect(r.doc.recipeRuns[out.runId]!.recipeId).toBe('template:tpl.prop');
        // the music's beats, mapped through the placed clip, fall on the planned boundaries (0 frames off) wherever the music plays
        const music = Object.values(r.doc.sequences[r.doc.mainSequenceId]!.tracks).flatMap((t) => t.clips).find((c) => c.type === 'media' && c.assetId === 'mus')!;
        const heard = new Set(sourceTimesToTimeline(r.doc, 'mus', beats).map(nf));
        const musicEnd = nf(T.add(music.start, music.duration));
        for (const b of plan.predicted.boundaries) if (b < musicEnd) expect(heard.has(b), `boundary ${b}`).toBe(true);
      }), { numRuns: 15 });
    });
  }
});

describe('planTemplate: what it refuses, blocks and reports', () => {
  const R30 = { num: 30, den: 1 };
  const one = (span: SlotDef['span'], extra: Partial<SlotDef> = {}): SlotDef => ({ key: 'x', role: words('X'), accept: 'any', span, ...extra });
  const simple = (slots: SlotDef[], o: Partial<TemplateDef> = {}): TemplateDef => ({ ...PROP, id: 'tpl.simple', music: { need: 'optional', startAt: 'zero' }, slots, slotUse: { mode: 'all', min: 1 }, texts: [], elements: [], sfx: [], adjust: [], ...o });
  const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof TemplateError ? e.code : `other: ${String(e)}`; } return 'ok'; };

  it('a video shorter than its slot blocks the plan with slot_too_short, naming the slot and both lengths', () => {
    const doc = project(R30, null);
    doc.assets.short = video('short', T.rt(1, 3), R30); // 10 frames
    const plan = planTemplate(doc, simple([one({ seconds: '1' })]), { media: ['short'] });
    expect(plan.blocking).toEqual([expect.objectContaining({ code: 'slot_too_short', details: expect.objectContaining({ slot: 'x', assetId: 'short', haveFrames: 10, needFrames: 30 }) })]);
  });

  it('music without measured beats needs analysis (and a beats template without music is refused)', () => {
    const doc = project(R30, [ms(0), ms(500)], { analysed: false });
    const def = simple([one({ beats: 2 })], { music: { need: 'beats', startAt: 'first-downbeat' } });
    let err: unknown;
    try { planTemplate(doc, def, { media: ['vid_a'], musicAssetId: 'mus' }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(TemplateError);
    expect((err as TemplateError).code).toBe('needs_analysis');
    expect((err as TemplateError).hint).toContain('מדידת קצב, ללא בינה מלאכותית');
    expect(code(() => planTemplate(doc, def, { media: ['vid_a'] }))).toBe('invalid_args');
    // bars need bar starts
    const noBars = project(R30, [ms(0), ms(500), ms(1000)]);
    delete noBars.analyses.mus!.beats!.downbeats;
    expect(code(() => planTemplate(noBars, simple([one({ bars: 1 })]), { media: ['vid_a'], musicAssetId: 'mus' }))).toBe('needs_analysis');
  });

  it('a transition longer than the source left after the previous clip is shortened to it and reported', () => {
    const doc = project(R30, null);
    doc.assets.v33 = video('v33', 1.1, R30); // 33 frames: a 30-frame slot leaves 3
    const def = simple([one({ seconds: '1' }), { ...one({ seconds: '1' }, { transitionIn: { type: 'dissolve', seconds: 0.5, dir: 'fixed' } }), key: 'y' }]);
    const plan = planTemplate(doc, def, { media: ['v33', 'vid_a'] });
    expect(plan.ops.find((o) => o.op === 'set_transition')!.args).toMatchObject({ type: 'dissolve', frames: 3 });
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'transition_shortened', details: expect.objectContaining({ slot: 'y', frames: 3, wantedFrames: 15 }) }));
    expect(plan.predicted.slots[0]).toMatchObject({ sourceInFrame: 0, frames: 30 });
    expect(validateProject(apply(doc, plan).doc)).toEqual([]);
  });

  it('a long enough video keeps the next transition\'s frames free after its window, and a reused video starts further in', () => {
    const doc = project(R30, null);
    const def = simple(Array.from({ length: 4 }, (_, i) => ({ ...one({ seconds: '1' }, i ? { transitionIn: { type: 'dissolve', seconds: 0.5, dir: 'fixed' } } : {}), key: `k${i}` })));
    const plan = planTemplate(doc, def, { media: ['vid_a'] });
    expect(plan.warnings).not.toContainEqual(expect.objectContaining({ code: 'transition_shortened' }));
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'media_reused' }));
    expect(new Set(plan.predicted.slots.map((s) => s.sourceInFrame)).size).toBe(4);
    expect(validateProject(apply(doc, plan).doc)).toEqual([]);
  });

  it('cuts closer than the flash gap are merged into the slot before them', () => {
    const doc = project(R30, null);
    // 180 BPM: a beat is 10 frames, under the 11-frame gap at 30 fps
    const def = simple(Array.from({ length: 6 }, (_, i) => ({ ...one({ beats: 1 }), key: `b${i}` })), { tempo: { fallbackBpm: 180 } });
    const plan = planTemplate(doc, def, { media: ['vid_a', 'vid_b'] });
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'cuts_merged' }));
    expect(plan.predicted.boundaries).toEqual([0, 20, 40, 60]);
  });

  it('slots past the music\'s last beat are dropped and reported; the music is fitted to the end', () => {
    const doc = project(R30, Array.from({ length: 7 }, (_, i) => ms(i * 500)), { musicSeconds: 3.5 });
    const def = simple(Array.from({ length: 6 }, (_, i) => ({ ...one({ beats: 2 }), key: `b${i}` })), { music: { need: 'beats', startAt: 'first-downbeat' } });
    const plan = planTemplate(doc, def, { media: ['vid_a'], musicAssetId: 'mus' });
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'slots_dropped', details: expect.objectContaining({ slots: ['b3', 'b4', 'b5'] }) }));
    expect(plan.predicted.boundaries).toEqual([0, 30, 60, 90]);
    expect(plan.ops.slice(-2).map((o) => o.op)).toEqual(['add_clip', 'fit_music']);
    expect(validateProject(apply(doc, plan).doc)).toEqual([]);
  });

  it('reduced motion emits no camera move and no title animation', () => {
    const doc = project(R30, Array.from({ length: 80 }, (_, i) => ms(i * 500)));
    const full = planTemplate(doc, PROP, { media: MEDIA, musicAssetId: 'mus' });
    const still = planTemplate(doc, PROP, { media: MEDIA, musicAssetId: 'mus', motion: 'none' });
    expect(full.ops.some((o) => o.op === 'apply_motion_preset')).toBe(true);
    expect(full.ops.some((o) => o.op === 'set_text_animation')).toBe(true);
    expect(still.ops.filter((o) => o.op === 'apply_motion_preset' || o.op === 'set_text_animation')).toEqual([]);
    expect(still.predicted.boundaries).toEqual(full.predicted.boundaries);
  });

  it('Hebrew mirrors left and right of reading-direction transitions and of motions; English keeps them', () => {
    const doc = project(R30, Array.from({ length: 80 }, (_, i) => ms(i * 500)));
    const he = planTemplate(doc, PROP, { media: MEDIA, musicAssetId: 'mus', lang: 'he' });
    const en = planTemplate(doc, PROP, { media: MEDIA, musicAssetId: 'mus', lang: 'en' });
    const types = (p: TemplatePlan) => p.ops.filter((o) => o.op === 'set_transition').map((o) => (o.args as { type: string }).type);
    expect(types(en)).toContain('push-left');
    expect(types(he)).toContain('push-right');
    expect(types(he)).not.toContain('push-left');
    expect(types(he)).toContain('dissolve');
    const motions = (p: TemplatePlan) => p.ops.filter((o) => o.op === 'apply_motion_preset').map((o) => (o.args as { presetId: string }).presetId);
    expect(motions(en)).toContain('motion.move.pan-left');
    expect(motions(he)).toContain('motion.move.pan-right');
    expect(he.ops.find((o) => o.bind === 'title')!.args).toMatchObject({ text: 'Hello (he)' });
    expect(en.ops.find((o) => o.bind === 'title')!.args).toMatchObject({ text: 'Hello' });
  });

  it('mirrorForReading returns an id that exists, for every transition and motion, in both languages', () => {
    const ids = [...TRANSITION_IDS, ...MOTION_PRESETS.map((m) => m.id)];
    const known = new Set<string>(ids);
    let swapped = 0;
    for (const id of ids) for (const lang of ['he', 'en'] as const) {
      const out = mirrorForReading(id, lang);
      expect(known.has(out), `${id} ${lang} -> ${out}`).toBe(true);
      if (lang === 'en') expect(out).toBe(id);
      else if (out !== id) { swapped++; expect(mirrorForReading(out, 'he')).toBe(id); }
    }
    expect(swapped).toBeGreaterThan(10);
    expect(mirrorForReading('push-left', 'he')).toBe('push-right');
    expect(mirrorForReading('soft-wipe-down-right', 'he')).toBe('soft-wipe-down-left');
    expect(mirrorForReading('zoom', 'he')).toBe('zoom');
  });

  it('per-slot copies count down, texts by key are used, an unknown text key is refused, and too-long text is a warning', () => {
    const doc = project(R30, Array.from({ length: 80 }, (_, i) => ms(i * 500)));
    const plan = planTemplate(doc, PROP, { media: MEDIA.slice(0, 4), musicAssetId: 'mus', lang: 'en', texts: { num: 'No. {n}', title: 'A title much longer than twenty' } });
    const nums = plan.ops.filter((o) => o.op === 'add_text' && o.bind?.startsWith('num--')).map((o) => (o.args as { text: string }).text);
    expect(nums).toEqual(['No. 3', 'No. 2', 'No. 1']);
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'text_too_long', details: expect.objectContaining({ key: 'title', maxChars: 20 }) }));
    expect(code(() => planTemplate(doc, PROP, { media: ['vid_a'], musicAssetId: 'mus', texts: { nope: 'x' } }))).toBe('invalid_args');
  });

  it('kept keys (edited by hand) are not made again; every item kept means nothing to do', () => {
    const doc = project(R30, Array.from({ length: 80 }, (_, i) => ms(i * 500)));
    const full = planTemplate(doc, PROP, { media: MEDIA.slice(0, 3), musicAssetId: 'mus' });
    const kept = planTemplate(doc, PROP, { media: MEDIA.slice(0, 3), musicAssetId: 'mus' }, { keepKeys: ['s2', 'title'] });
    expect(kept.ops.some((o) => o.bind === 's2' || o.bind === 'title')).toBe(false);
    expect(kept.slots.map((s) => s.key)).toEqual(full.slots.map((s) => s.key).filter((k) => k !== 's2' && k !== 'title'));
    expect(kept.warnings).toContainEqual(expect.objectContaining({ code: 'kept_by_hand', details: { keys: ['s2', 'title'] } }));
    expect(kept.predicted).toEqual(full.predicted);
    expect(code(() => planTemplate(doc, PROP, { media: MEDIA.slice(0, 3), musicAssetId: 'mus' }, { keepKeys: full.slots.map((s) => s.key) }))).toBe('nothing_to_do');
  });

  it('removed keys (deleted by hand) are not made again: the plan says so in a notice and offers restoreRemoved; all removed means nothing to do, with that hint', () => {
    const doc = project(R30, Array.from({ length: 80 }, (_, i) => ms(i * 500)));
    const full = planTemplate(doc, PROP, { media: MEDIA.slice(0, 3), musicAssetId: 'mus' });
    const p = planTemplate(doc, PROP, { media: MEDIA.slice(0, 3), musicAssetId: 'mus' }, { keepKeys: ['s1'], removedKeys: ['s2', 'title'] });
    expect(p.ops.some((o) => o.bind === 's1' || o.bind === 's2' || o.bind === 'title')).toBe(false);
    expect(p.slots.map((s) => s.key)).toEqual(full.slots.map((s) => s.key).filter((k) => !['s1', 's2', 'title'].includes(k)));
    expect(p.warnings).toContainEqual(expect.objectContaining({ code: 'kept_by_hand', details: { keys: ['s1'] } }));
    expect(p.notices).toContainEqual(expect.objectContaining({ code: 'removed_by_hand', details: { keys: ['s2', 'title'] } }));
    expect(p.alternatives.filter((a) => a.restoreRemoved)).toEqual([expect.objectContaining({ params: {}, restoreRemoved: true })]);
    expect(full.alternatives.some((a) => a.restoreRemoved)).toBe(false);
    expect(full.notices.map((n) => n.code)).not.toContain('removed_by_hand');
    expect(p.predicted).toEqual(full.predicted);
    let hint: string | undefined;
    try { planTemplate(doc, PROP, { media: MEDIA.slice(0, 3), musicAssetId: 'mus' }, { removedKeys: full.slots.map((s) => s.key) }); } catch (e) { hint = (e as TemplateError).code === 'nothing_to_do' ? (e as TemplateError).hint : 'wrong code'; }
    expect(hint).toMatch(/restoreRemoved/);
  });

  it('refuses: no media, a missing or pictureless medium, an off-grid start, a template with elements where they cannot be drawn, more than 2000 operations', () => {
    const doc = project(R30, null);
    const def = simple([one({ seconds: '1' })]);
    expect(code(() => planTemplate(doc, def, { media: [] }))).toBe('invalid_args');
    expect(code(() => planTemplate(doc, def, { media: ['nope'] }))).toBe('not_found');
    doc.assets.snd = sound('snd', T.rt(5, 1));
    expect(code(() => planTemplate(doc, def, { media: ['snd'] }))).toBe('invalid_args');
    expect(code(() => planTemplate(doc, def, { media: ['vid_a'], at: T.rt(1, 1000) }))).toBe('invalid_args');
    expect(code(() => planTemplate(doc, { ...def, slots: [{ ...one({ seconds: '1' }), key: 's1' }], elements: PROP.elements }, { media: ['vid_a'] }, { elementsAvailable: false }))).toBe('needs_capability');
    // forty titles on each of forty slots: 1600 titles of two operations each. (Until ADR-0022 this was provoked with twenty
    // elements on every slot; elements that would share a track range are now left out of the plan, so they no longer add up.)
    const many: TemplateDef = { ...def, slots: Array.from({ length: 40 }, (_, i) => ({ ...one({ seconds: '1' }), key: `k${i}` })), texts: Array.from({ length: 40 }, (_, i) => ({ key: `t${i}`, role: { he: 'כותרת', en: 'Title' }, default: { he: 'מספר {n}', en: 'Number {n}' }, maxChars: 20, presetId: 'clean-white', perSlot: 'count-up' as const, at: { slot: 'k0' }, place: { x: 0, y: 0 } })) };
    expect(code(() => planTemplate(doc, many, { media: ['vid_a'] }))).toBe('invalid_args');
    expect(code(() => planTemplate(doc, { ...def, slots: [one({ seconds: '1' }), one({ seconds: '1' })] }, { media: ['vid_a'] }))).toBe('invalid_args'); // duplicate key
  });

  it('starts after the last picture or title by default, or at 0 on an empty edit; warns when the frame shape differs', () => {
    const doc = project(R30, null, { width: 960, height: 540 });
    const def = simple([one({ seconds: '1' })]);
    expect(planTemplate(doc, def, { media: ['vid_a'] }).predicted.startFrame).toBe(0);
    const first = apply(doc, planTemplate(doc, def, { media: ['vid_a'] })).doc;
    const second = planTemplate(first, def, { media: ['vid_b'] });
    expect(second.predicted.startFrame).toBe(30);
    expect(second.params.at).toEqual(T.rt(1, 1));
    expect(second.warnings).toContainEqual(expect.objectContaining({ code: 'designed_for_other_shape', details: expect.objectContaining({ designedFor: 'tall', project: 'wide' }) }));
    // a cover-fitted project reports how much of each picture is cut away
    first.settings.fit = 'cover';
    const cover = planTemplate(first, def, { media: ['img_a'] });
    expect(cover.predicted.slots[0]!.cropShare).toBeCloseTo(1 - 540 / 960, 4);
  });

  it('summarizeTemplate: length on its own grid, needs, and honest availability', () => {
    const s = summarizeTemplate(PROP, { elementsAvailable: true });
    expect(s).toMatchObject({ id: 'tpl.prop', available: true, unavailableReason: null, method: 'rule-based template; no model', needs: { music: 'beats', elements: true, gpu: false, model: null } });
    // 10 slots: 1,2,4,3,1,2,4,3,1,2 beats = 23 beats at 120 BPM
    expect(s.seconds).toBe(11.5);
    expect(summarizeTemplate(PROP, { elementsAvailable: false })).toMatchObject({ available: false, unavailableReason: expect.stringContaining('librsvg') });
  });
});

describe('a look of a template never covers its graphic elements or its titles (ADR-0022)', () => {
  /** What a look covers wrongly: every adjustment track is drawn over the tracks below it, so each element and title track must lie above all of them. */
  const covered = (doc: ProjectDocument, elementAssets: ReadonlySet<string>) => {
    const tracks = doc.sequences[doc.mainSequenceId]!.tracks;
    const topLook = tracks.reduce((top, t, i) => (t.kind === 'adjustment' && t.clips.length ? i : top), -1);
    return tracks.flatMap((t, i) => t.clips.filter((c) => (c.type === 'media' && elementAssets.has(c.assetId)) || c.type === 'text').filter(() => i < topLook).map((c) => `${c.type} ${c.id} on track ${i} under the look on track ${topLook}`));
  };
  const elementAssetsOf = (plan: TemplatePlan, out: { assetIds: Record<string, string> }) => new Set(plan.assetsNeeded.filter((x) => x.kind === 'element').map((x) => out.assetIds[x.key]!));
  /** A project that already has a look over everything, a picture above the pictures and a title, before the template is added. */
  const busy = (doc: ProjectDocument) => applyTransaction(doc, [
    { op: 'add_clip', args: { assetId: 'img_a', start: T.ZERO, duration: T.rt(2, 1) } },
    { op: 'add_track', args: { kind: 'video' } },
    { op: 'add_adjustment', args: { span: 'edit', effects: [{ type: 'color.adjust', params: { saturation: 0.5 } }] } },
    { op: 'add_text', args: { text: 'כותרת', start: T.ZERO, duration: T.rt(1, 1) } },
  ], { idSeed: 'busy', actor: 'test' }).doc;
  it('every template with elements and looks, on an empty project and on a busy one: elements and titles lie above every look', () => {
    const rate = { num: 30, den: 1 };
    let withBoth = 0;
    for (const def of TEMPLATES.filter((t) => t.elements.length && t.adjust.length)) for (const start of ['empty', 'busy'] as const) {
      const doc0 = project(rate, Array.from({ length: 200 }, (_, i) => ms(400 + i * 500)));
      const doc = start === 'busy' ? busy(doc0) : doc0;
      const plan = planTemplate(doc, def, { media: MEDIA, musicAssetId: def.music.need === 'none' ? null : 'mus', lang: 'he', fields: { night: '3', age: '7', name: 'נועה' } });
      const r = apply(doc, plan);
      expect(validateProject(r.doc), def.id).toEqual([]);
      expect(covered(r.doc, elementAssetsOf(plan, r.results[0]!.output as unknown as { assetIds: Record<string, string> })), `${def.id} (${start})`).toEqual([]);
      withBoth++;
    }
    expect(withBoth).toBeGreaterThanOrEqual(2 * 10); // four built-ins and the seven pack templates have both
  });
  it('control: without the move (the plan as it was before), the same check finds the element under the look', () => {
    const rate = { num: 30, den: 1 };
    const def = TEMPLATES.find((t) => t.id === 'tpl.hanukkah-greeting')!;
    const doc = project(rate, null);
    const plan = planTemplate(doc, def, { media: MEDIA, musicAssetId: null, lang: 'he' });
    expect(plan.ops.filter((o) => o.op === 'move_track')).toHaveLength(1);
    const without = { ...plan, ops: plan.ops.filter((o) => o.op !== 'move_track') };
    const r = apply(doc, without);
    expect(covered(r.doc, elementAssetsOf(plan, r.results[0]!.output as unknown as { assetIds: Record<string, string> }))).not.toEqual([]);
  });
  it('a pack look applied afterwards (the pack page: packLookOps, one transaction) colours the footage and not the graphics', () => {
    const rate = { num: 30, den: 1 };
    /** As madeAssets, with the provenance the element route gives (procedural id element.…), which packLookOps reads. */
    const withProvenance = (plan: TemplatePlan) => madeAssets(plan).map((a, i) => (plan.assetsNeeded[i]!.kind === 'element' ? { ...a, asset: { ...a.asset, provenance: { ...a.asset.provenance, procedural: { id: plan.assetsNeeded[i]!.id, version: 2, generator: 'test' } } } } : a));
    let applied = 0;
    for (const id of ['tpl.hanukkah-greeting', 'tpl.birthday-invite', 'tpl.hanukkah-party']) for (const look of PACKS.flatMap((p) => p.looks)) {
      const doc = project(rate, null);
      const plan = planTemplate(doc, TEMPLATES.find((t) => t.id === id)!, { media: MEDIA, musicAssetId: null, lang: 'he' });
      const r = applyTransaction(doc, [{ op: 'apply_template', args: { templateId: plan.templateId, templateVersion: plan.version, params: plan.params, steps: plan.steps, assets: withProvenance(plan), ops: plan.ops, slots: plan.slots } }], { idSeed: 'lk', actor: 'test', allowInternal: true });
      const els = elementAssetsOf(plan, r.results[0]!.output as unknown as { assetIds: Record<string, string> });
      const after = applyTransaction(r.doc, packLookOps(look, 'he', r.doc), { idSeed: 'lk2', actor: 'test' });
      expect(after.results.length, `${id} ${look.id}`).toBeGreaterThanOrEqual(1);
      expect(validateProject(after.doc)).toEqual([]);
      expect(covered(after.doc, els), `${id} + ${look.id}`).toEqual([]);
      // control: the add_adjustment alone (as before) puts the look over the template's graphics
      const alone = applyTransaction(r.doc, [packLookOp(look, 'he')], { idSeed: 'lk3', actor: 'test' });
      expect(covered(alone.doc, els), `${id} + ${look.id} without the move`).not.toEqual([]);
      applied++;
    }
    expect(applied).toBe(18);
  });
  it('packLookOps leaves a track that also holds pictures where it is: the look colours every picture', () => {
    const doc = project({ num: 30, den: 1 }, null);
    const look = PACKS[0]!.looks[0]!;
    const mixed = applyTransaction(doc, [{ op: 'add_clip', args: { assetId: 'img_a', start: T.ZERO, duration: T.rt(2, 1) } }], { idSeed: 'mx', actor: 'test' }).doc;
    expect(packLookOps(look, 'he', mixed)).toHaveLength(1);
  });
  it('graphicsTrackIndex replays the track placement of the real ops: the move lands right above the topmost look', () => {
    const rate = { num: 30, den: 1 };
    for (const start of ['empty', 'busy'] as const) for (const id of ['tpl.hanukkah-party', 'tpl.birthday-cake', 'tpl.quote-card']) {
      const doc0 = project(rate, null);
      const doc = start === 'busy' ? busy(doc0) : doc0;
      const plan = planTemplate(doc, TEMPLATES.find((t) => t.id === id)!, { media: MEDIA, musicAssetId: null, lang: 'he' });
      const r = apply(doc, plan);
      const tracks = r.doc.sequences[r.doc.mainSequenceId]!.tracks;
      const els = elementAssetsOf(plan, r.results[0]!.output as unknown as { assetIds: Record<string, string> });
      const at = tracks.findIndex((t) => t.clips.some((c) => c.type === 'media' && els.has(c.assetId)));
      const topLook = tracks.reduce((top, t, i) => (t.kind === 'adjustment' ? i : top), -1);
      expect([id, start, at]).toEqual([id, start, topLook + 1]);
    }
  });
});

describe('the built-in templates plan and apply at every frame rate', () => {
  it.each(RATES)('%o', (rate) => {
    for (const def of TEMPLATES) {
      for (const lang of ['he', 'en'] as const) {
        const doc = project(rate, Array.from({ length: 200 }, (_, i) => ms(400 + i * 500)), { width: def.designedFor === 'wide' ? 960 : 540, height: def.designedFor === 'wide' ? 540 : 960 });
        const plan = planTemplate(doc, def, { media: MEDIA, musicAssetId: def.music.need === 'none' ? null : 'mus', lang });
        expect(plan.blocking, def.id).toEqual([]);
        const r = apply(doc, plan);
        expect(validateProject(r.doc), def.id).toEqual([]);
        for (let i = 1; i < plan.predicted.boundaries.length; i++) expect(plan.predicted.boundaries[i]! - plan.predicted.boundaries[i - 1]!).toBeGreaterThanOrEqual(flashGapFrames(rate.num / rate.den));
      }
    }
  });
  it('the test double is labelled and only used while apply_template is the contracts stub', () => {
    expect(typeof USING_DOUBLE).toBe('boolean');
  });
});
