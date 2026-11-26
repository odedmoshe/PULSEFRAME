/**
 * The owntemplate contract (wave 8 lead pre-pass): the template format's own-only fields are gated so built-ins keep their old
 * limits and presetId stays required (C7, C8), the reserved id prefix (C10), the partition rule (C6), the refusal table, the
 * whitelist key classification (C2g), and the planner never scales an own span (C4). The `todo` rows are the builders' checks.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  AdjustmentClipSchema, BUILTIN_TEMPLATES, ClipSchema, createProject, DEFAULT_TEXT_STYLE, EffectInstanceSchema, MediaClipSchema, OWN_ADJUSTMENT_CLIP_KEYS, OWN_ANTICIPATED_KEYS, OWN_CLIP_TYPES,
  OWN_EFFECT_INSTANCE_KEYS, OWN_MEDIA_CLIP_KEYS, OWN_NOT_KEPT_CODES, OWN_TEMPLATE_BUILT, OWN_TEMPLATE_REFUSALS, OWN_TEXT_ANIMATION_KEYS, OWN_TEXT_CLIP_KEYS, OWN_TEXT_STYLE_KEY_CLASSES, OWN_TRACK_KEYS,
  OWN_TRANSITION_KEYS, OwnTemplatePreviewBodySchema, OwnTemplateRefusal, OwnTemplateSaveBodySchema, partitionProblems, planTemplate, steadyGrid, TEMPLATE_LIMITS, TEMPLATE_WARNING_CODES, TemplateDefSchema,
  TemplateInputSchema, TextAnimationSchema, TextClipSchema, TextStyleSchema, TICK_DENOMS, TICKS_PER_BEAT, TrackSchema, TransitionSchema, type KeyClass, type TemplateDef,
} from './index.ts';

const base = BUILTIN_TEMPLATES[0]!;
const words = (s: string) => ({ he: s, en: s });
/** A minimal own definition (beats axis, three slots, one title with `on` and a style). */
function ownDef(o: Partial<TemplateDef> = {}): TemplateDef {
  return {
    id: 'tpl.own-0123456789ab', version: 1, name: words('ours'), hint: words('3 shots'), genre: 'memories', designedFor: 'wide',
    tempo: { fallbackBpm: 96 }, music: { need: 'optional', startAt: 'first-downbeat' },
    slots: [0, 1, 2].map((i) => ({ key: `shot${i + 1}`, role: words(`Shot ${i + 1}`), accept: 'any' as const, span: { ticks: 384 } })),
    slotUse: { mode: 'all', min: 1 },
    texts: [{ key: 'title1', role: words('Title 1'), default: words('Title 1'), maxChars: 60, presetId: base.texts[0]?.presetId ?? 'title-card', at: { slot: 'shot1' }, place: { x: 0, y: 0 }, on: { slot: 'shot1', from: 0, to: 288 } }],
    elements: [], sfx: [], adjust: [],
    own: { madeFrom: 'own-film', axis: 'beats', rate: { num: 30, den: 1 }, lead: 96, meter: 4, origin: { bpm: 96, beats: 6, seconds: 3.75, slots: 3 }, keptWords: false },
    ...o,
  } as TemplateDef;
}
const problems = (d: unknown) => { const r = TemplateDefSchema.safeParse(d); return r.success ? [] : r.error.issues.map((i) => i.message); };

describe('the template format: own-only fields are gated, built-ins keep their limits (C7, C8, C10)', () => {
  it('every built-in and pack template still parses; none has `own`', () => {
    for (const t of BUILTIN_TEMPLATES) { expect(problems(t), t.id).toEqual([]); expect(t.own).toBeUndefined(); }
  });
  it('a minimal own definition parses', () => { expect(problems(ownDef())).toEqual([]); });
  it('a template without `own` is held to the built-in limits (slots 40, texts 40, looks 8); an own one to 120, 80, 16', () => {
    const slots = (n: number, span: object) => Array.from({ length: n }, (_, i) => ({ ...base.slots[0]!, key: `s${i}`, span }));
    expect(problems({ ...base, slots: slots(41, { beats: 1 }) }).join()).toMatch(/at most 40 slots/);
    expect(problems({ ...base, slots: slots(40, { beats: 1 }), texts: [], elements: [], sfx: [], adjust: [] })).toEqual([]);
    expect(problems(ownDef({ slots: slots(120, { ticks: 192 }).map((s) => ({ ...s, transitionIn: undefined, motion: undefined })) as never, texts: [] }))).toEqual([]);
    expect(problems(ownDef({ slots: slots(121, { ticks: 192 }) as never, texts: [] })).length).toBeGreaterThan(0);
    expect(TEMPLATE_LIMITS.builtin).toEqual({ slots: 40, texts: 40, elements: 20, sfx: 20, adjust: 8 });
    expect([TEMPLATE_LIMITS.spanSlots, TEMPLATE_LIMITS.lookSpanSlots, TEMPLATE_LIMITS.slotUseMin]).toEqual([40, 40, 40]);
  });
  it('the plan input takes up to 120 media (the old 40, C8)', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `a${i}`);
    expect(TemplateInputSchema.safeParse({ media: ids(120) }).success).toBe(true);
    expect(TemplateInputSchema.safeParse({ media: ids(121) }).success).toBe(false);
  });
  it('the own-only fields are refused in a template without `own`', () => {
    const s0 = base.slots[0]!;
    expect(problems({ ...base, slots: [{ ...s0, span: { ticks: 192 } }] }).join()).toMatch(/span ticks is only for a template saved from a film/);
    expect(problems({ ...base, slots: [{ ...s0, span: { frames: 30 } }] }).join()).toMatch(/span frames/);
    expect(problems({ ...base, slots: [{ ...s0, effects: [] }] }).join()).toMatch(/effects is only/);
    expect(problems({ ...base, slots: [{ ...s0, transitionIn: { type: 'crossfade', seconds: 0.5, dir: 'fixed', sync: 'beat' } }] }).join()).toMatch(/transition sync, velocity or color/);
    const t0 = base.texts[0]!;
    expect(problems({ ...base, texts: [{ ...t0, on: { slot: s0.key, from: 0, to: 1 } }] }).join()).toMatch(/: on is only/);
    expect(problems({ ...base, texts: [{ ...t0, style: { ...DEFAULT_TEXT_STYLE } }] }).join()).toMatch(/: style is only/);
  });
  it('the id prefix tpl.own- is reserved for own templates, and an own template must use it', () => {
    expect(problems({ ...base, id: 'tpl.own-0123456789ab' }).join()).toMatch(/reserved/);
    expect(problems(ownDef({ id: 'tpl.mine' })).join()).toMatch(/tpl\.own-<12 hex digits>/);
  });
  it('presetId stays required for every title, own ones included (C7)', () => {
    const t = ownDef().texts[0]!;
    const { presetId: _drop, ...noPreset } = t;
    expect(problems(ownDef({ texts: [noPreset as never] })).length).toBeGreaterThan(0);
  });
  it('own rules: one span arm per axis, lead under a bar, `on` names a slot with from < to and no offsetBeats/spanSlots, slotUse all/1, no elements or sfx', () => {
    expect(problems(ownDef({ slots: [{ ...ownDef().slots[0]!, span: { frames: 30 } }] as never })).join()).toMatch(/every span of a beats-axis template is in ticks/);
    expect(problems(ownDef({ own: { ...ownDef().own!, lead: 4 * TICKS_PER_BEAT } })).join()).toMatch(/lead must be under one bar/);
    expect(problems(ownDef({ own: { ...ownDef().own!, axis: 'frames' }, slots: ownDef().slots.map((s) => ({ ...s, span: { frames: 30 } })) as never })).join()).toMatch(/frames-axis template has lead 0/);
    const t = ownDef().texts[0]!;
    expect(problems(ownDef({ texts: [{ ...t, on: { slot: 'shot9', from: 0, to: 10 } }] })).join()).toMatch(/not a slot/);
    expect(problems(ownDef({ texts: [{ ...t, on: { slot: 'shot1', from: 10, to: 10 } }] })).join()).toMatch(/before on.to/);
    expect(problems(ownDef({ texts: [{ ...t, at: { slot: 'shot1', offsetBeats: 1 } }] })).join()).toMatch(/offsetBeats or spanSlots/);
    expect(problems(ownDef({ slotUse: { mode: 'media', min: 1 } })).join()).toMatch(/slotUse/);
  });
  it('TICK_DENOMS all divide 192; items_dropped is a warning code', () => {
    for (const d of TICK_DENOMS) expect(TICKS_PER_BEAT % d).toBe(0);
    expect(TEMPLATE_WARNING_CODES).toContain('items_dropped');
  });
});

describe('the planner never scales an own span (C4); stubs are honest', () => {
  it('an own definition is refused as not built before any span is scaled', () => {
    const doc = createProject({ id: 'prj_own', name: 'own', width: 1920, height: 1080, frameRate: { num: 30, den: 1 } });
    doc.assets.img = { id: 'img', kind: 'image', name: 'img.png', contentHash: `sha256:${'1'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 10, height: 10, codec: 'png', hasAlpha: false }, provenance: { origin: 'fixture', importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' } } as never;
    expect(OWN_TEMPLATE_BUILT).toBe(false);
    let err: unknown;
    try { planTemplate(doc, ownDef(), { media: ['img'], musicAssetId: null }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(OwnTemplateRefusal);
    expect((err as OwnTemplateRefusal).code).toBe('own_template_not_built');
    expect(() => steadyGrid(T.ZERO, 120).timeAt(1n, 2n)).toThrow(OwnTemplateRefusal);
  });
  it.todo('W1: Grid.timeAt is exact on listGrid and steadyGrid (property test at 24, 25, 30000/1001 and 60 fps, uneven 48000-timescale beats, a 6-decimal bpm; C12)');
  it.todo('W1: a ticks definition plans without ever calling scaleSpan; a built-in never calls placeOwnSlots (both goldens unchanged)');
  it.todo('W1: the first picture starts exactly at `at`; with a music file its sourceIn = first bar start + time(lead) (C3)');
  it.todo('W1: tempo half and double scale position − lead, not lead (C12)');
  it.todo('W1: a beats-axis template without music folds the tempo by octaves into 60–180, median interval when bpm is null, basis line (C11)');
  it.todo('W1: an item whose slot was dropped or merged away gives items_dropped');
  it.todo('W1: summarizeTemplate counts slot effects in needs.gpu (C4) and sets `own`');
});

describe('whitelist: every key of the read schemas is kept or listed as not kept (C2g)', () => {
  const keysOf = (s: { shape: Record<string, unknown> }) => Object.keys(s.shape).sort();
  const rows: [string, { shape: Record<string, unknown> }, Record<string, KeyClass>, readonly string[]][] = [
    ['MediaClipSchema', MediaClipSchema, OWN_MEDIA_CLIP_KEYS, OWN_ANTICIPATED_KEYS.media],
    ['TextClipSchema', TextClipSchema, OWN_TEXT_CLIP_KEYS, OWN_ANTICIPATED_KEYS.text],
    ['TextStyleSchema', TextStyleSchema, OWN_TEXT_STYLE_KEY_CLASSES, []],
    ['TextAnimationSchema', TextAnimationSchema, OWN_TEXT_ANIMATION_KEYS, []],
    ['AdjustmentClipSchema', AdjustmentClipSchema, OWN_ADJUSTMENT_CLIP_KEYS, []],
    ['EffectInstanceSchema', EffectInstanceSchema, OWN_EFFECT_INSTANCE_KEYS, OWN_ANTICIPATED_KEYS.effect],
    ['TransitionSchema', TransitionSchema, OWN_TRANSITION_KEYS, []],
    ['TrackSchema', TrackSchema, OWN_TRACK_KEYS, []],
  ];
  for (const [name, schema, table, anticipated] of rows) {
    it(`${name}: every key is classified, and every classified key exists (or is anticipated from this wave)`, () => {
      const unclassified = keysOf(schema).filter((k) => !Object.hasOwn(table, k));
      expect(unclassified, `${name} gained keys that are neither kept nor listed as not kept: classify them in ownTemplateKeys.ts`).toEqual([]);
      const stale = Object.keys(table).filter((k) => !keysOf(schema).includes(k) && !anticipated.includes(k));
      expect(stale, `${name}: classified keys the schema does not have`).toEqual([]);
      for (const [k, c] of Object.entries(table)) if ('notKept' in c && c.notKept !== null) expect(OWN_NOT_KEPT_CODES, `${name}.${k}`).toContain(c.notKept);
    });
  }
  it('every clip type is classified; drawn and caption clips are not kept', () => {
    const types = (ClipSchema as unknown as { options: { shape: { type: { value: string } } }[] }).options.map((o) => o.shape.type.value).sort();
    expect(Object.keys(OWN_CLIP_TYPES).sort()).toEqual(types);
    expect(OWN_CLIP_TYPES.drawn).toEqual(expect.objectContaining({ notKept: 'drawn' }));
    expect(OWN_CLIP_TYPES.caption).toEqual(expect.objectContaining({ notKept: 'captions' }));
  });
  it('the fields arriving this wave are listed as not kept, never copied', () => {
    expect(OWN_MEDIA_CLIP_KEYS.depth).toEqual(expect.objectContaining({ notKept: 'depth' }));
    expect(OWN_MEDIA_CLIP_KEYS.subject).toEqual(expect.objectContaining({ notKept: 'subject' }));
    expect(OWN_TEXT_CLIP_KEYS.behind).toEqual(expect.objectContaining({ notKept: 'behind' }));
    expect(OWN_EFFECT_INSTANCE_KEYS.curves).toEqual(expect.objectContaining({ notKept: 'curves' }));
    expect(OWN_TEXT_CLIP_KEYS.role).toEqual(expect.objectContaining({ notKept: 'credits_card' }));
    expect(OWN_TRANSITION_KEYS.seed).toEqual(expect.objectContaining({ notKept: 'transition_seed' }));
  });
});

describe('the save preview and save answers (C6)', () => {
  it('both bodies carry expectedRevision; save needs a name and a genre; keepWords is off by default', () => {
    expect(OwnTemplatePreviewBodySchema.safeParse({ lang: 'he' }).success).toBe(false);
    expect(OwnTemplatePreviewBodySchema.parse({ lang: 'he', expectedRevision: 3 }).keepWords).toBe(false);
    expect(OwnTemplateSaveBodySchema.safeParse({ lang: 'he', expectedRevision: 3, genre: 'memories' }).success).toBe(false);
    expect(OwnTemplateSaveBodySchema.safeParse({ lang: 'he', expectedRevision: 3, genre: 'memories', name: 'יום הולדת' }).success).toBe(true);
  });
  it('partitionProblems: every clip of the main sequence exactly once, nothing else', () => {
    const doc = createProject({ id: 'prj_p', name: 'p', width: 640, height: 360, frameRate: { num: 30, den: 1 } });
    const track = doc.sequences[doc.mainSequenceId]!.tracks[0]!;
    track.clips.push({ id: 'c1' } as never, { id: 'c2' } as never);
    expect(partitionProblems(doc, { clips: [{ clipId: 'c1', kept: true, as: 'slot', key: 'shot1' }, { clipId: 'c2', kept: false, code: 'drawn' }] })).toEqual([]);
    expect(partitionProblems(doc, { clips: [{ clipId: 'c1', kept: true, as: 'slot', key: 'shot1' }] })).toEqual(['clip c2 appears 0 times']);
    expect(partitionProblems(doc, { clips: [{ clipId: 'c1', kept: true, as: 'slot', key: 'shot1' }, { clipId: 'c1', kept: false, code: 'drawn' }, { clipId: 'c2', kept: false, code: 'drawn' }, { clipId: 'x', kept: false, code: 'drawn' }] })).toEqual(['clip c1 appears 2 times', 'clip x is not on the main sequence']);
  });
  it('every refusal has a reason and a next step; the C10 wording is exact', () => {
    for (const [k, x] of Object.entries(OWN_TEMPLATE_REFUSALS)) { expect(x.hint.length, k).toBeGreaterThan(10); expect(x.status, k).toBeGreaterThanOrEqual(400); }
    expect(OWN_TEMPLATE_REFUSALS.notOnThisComputer.message('tpl.own-0123456789ab')).toBe('the template "tpl.own-0123456789ab" is not saved on this computer; undo still works and every clip stays editable');
  });
  it.todo('W1: captureOwnTemplate report.clips passes partitionProblems on the proof fixture film (and rows for other sequences, the caption style and credits cards)');
  it.todo('W1: the «מה נשמר» counts are computed from the saved def itself');
  it.todo('W1: capture refuses too_many_operations at save with the numbers when ownTemplateOpCount exceeds MAX_TEMPLATE_OPS (C8)');
  it.todo('W1: capture never spreads a style, effect or clip object: a planted unknown key on each read schema never reaches the def');
  it.todo('W1: person tokens become placeholders (person_field); fontFamily outside FONT_CATALOG becomes the default (font_family); color.lut is dropped whole (lut); credits cards are not kept');
  it.todo('W1: cuts closer than the flash gap are reported cuts_close with times (C5)');
  it.todo('W1: scanOwnTemplate runs the deny check only on free-text leaves (an asset named color.mp4 does not refuse color.lut; C2f)');
  it.todo('W2: ownSummaryForReader strips the kept words for every reader but the owner\'s own session; the name stays (C2h)');
});
