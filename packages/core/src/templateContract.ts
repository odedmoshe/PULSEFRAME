/**
 * Templates (ADR-0016): the shared contract of the template definitions, the planner, the internal op apply_template and the
 * server routes. Templates are versioned code data with no frame numbers; a pure planner (templatePlan.ts) compiles one into
 * public ops, and the server applies them as ONE internal op (templateOps.ts) whose arguments carry everything (asset records,
 * resolved ops), so replay never reads the catalogue. The run record (RecipeRun with recipeId `template:<id>`) holds the slots.
 * Rule-based; no model. Templates that would need a model are listed as unavailable (MODEL_GATED_TEMPLATES) and never run.
 */
import { z } from 'zod';
import { AssetSchema, TextStyleSchema, isRealWallDate, RationalTimeSchema, SlotRecordSchema, TEMPLATE_SLOT_KINDS, TEXT_ANIM_IN, TEXT_ANIM_LOOP, TEXT_ANIM_OUT, WALL_DATE, type SlotRecord } from './schema.ts';
import { KnownGridSchema, MUSIC_MAX_SEED, MUSIC_STYLE_ID } from './musicStyles.ts';

export const BIND_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
export const BindName = z.string().regex(BIND_NAME);
const Words = (max: number) => z.object({ he: z.string().min(1).max(max), en: z.string().min(1).max(max) }).strict();

/**
 * Bindings inside apply_template step args. They are replaced BEFORE the step's own zod parse.
 * - {"$ref":n} -> output.clipId of the earlier step bound as n.
 * - {"$ref":n,"out":k} -> output[k], which must be a string or a string[].
 * - {"$ref":n,"out":k,"at":i} -> output[k][i], which must be a string.
 * - {"$asset":k} -> the project asset id that assets[k] resolved to.
 * Refused with invalid_args: any other key next to $ref/$asset; a forward or unknown name; a wrong value type; a duplicate bind name.
 * Lookups never reach inherited members: bind names and asset keys are kept in Maps, and `out` is read only when it is an own
 * property of the output (Object.hasOwn), so names such as "constructor" or "toString" find nothing.
 */
export const RefSchema = z.object({ $ref: BindName, out: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,31}$/).optional(), at: z.number().int().min(0).max(4999).optional() }).strict();
export const AssetRefSchema = z.object({ $asset: BindName }).strict();
export const TemplateStepSchema = z.object({ op: z.string().min(1).max(64), args: z.unknown(), bind: BindName.optional() }).strict();
export type TemplateStep = z.infer<typeof TemplateStepSchema>;
export const PlannedSlotSchema = z.object({ key: BindName, kind: z.enum(TEMPLATE_SLOT_KINDS), clipId: z.union([z.string().min(1).max(64), RefSchema]), accept: z.enum(['video', 'image', 'any']).optional(), beats: SlotRecordSchema.shape.beats }).strict();
export type PlannedSlot = z.infer<typeof PlannedSlotSchema>;
/**
 * Procedural media a template carries. `analysis` (ADR-0022) is the known beat grid of a built-in music track: apply_template
 * attaches it to the asset as attachKnownGrid does (packOps.ts), in the same step. Optional, so old logs replay unchanged.
 */
export const TemplateAssetSchema = z.object({ key: BindName, asset: AssetSchema.omit({ id: true }), analysis: KnownGridSchema.optional() }).strict();
export const ApplyTemplateArgsSchema = z.object({
  runId: z.string().optional(),
  templateId: z.string().regex(/^tpl\.[a-z0-9-]{1,40}$/),
  templateVersion: z.number().int().min(1),
  params: z.record(z.string(), z.unknown()),
  steps: z.array(z.string().max(400)).max(50),
  assets: z.array(TemplateAssetSchema).max(64).optional(),
  removeClipIds: z.array(z.string()).max(5000).optional(),
  keepIds: z.array(z.string()).max(5000).optional(),
  keepSlots: z.array(SlotRecordSchema).max(400).optional(),
  ops: z.array(TemplateStepSchema).min(1).max(2000),
  slots: z.array(PlannedSlotSchema).max(400),
  /**
   * Optional and additive (ADR-0016 decision 6, amendment of 2026-11-24): record in the run where each of its clips lies, with
   * its track (RecipeRun.ranges), so a later regeneration can tell a clip that was only moved in time (templateOps.ts movedOnly).
   * A clip named in keepIds keeps the entry of the earlier run, as it keeps that run's fingerprint. Absent in every older log,
   * which therefore replays to the same document as before.
   */
  recordRanges: z.literal(true).optional(),
}).strict();
export type ApplyTemplateArgs = z.infer<typeof ApplyTemplateArgsSchema>;
/** apply_template OpResult.output. The run record: recipeRuns[runId] = { recipeId: `template:${templateId}`, params: {...params, templateVersion}, createdIds, fingerprints, steps, slots }. */
export interface ApplyTemplateOutput { runId: string; createdIds: string[]; slots: SlotRecord[]; assetIds: Record<string, string> }

export const TEMPLATE_GENRES = ['montage', 'celebration', 'promo', 'quote', 'list', 'memories', 'holiday'] as const;
/** The id of a content pack (packs/contract.ts). */
export const PACK_ID = /^pack\.[a-z0-9-]{1,24}$/;
const Colour = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const MusicStyleId = z.string().regex(MUSIC_STYLE_ID);

// ---------- pack fields (ADR-0022) ----------
/**
 * Fields a pack template's titles may hold: `{name}`, `{name2}`, `{age}`, `{night}`, `{place}`, `{when}`. They are LITERAL: the
 * caller gives their words (TemplateInput.fields) and the planner writes them into the title's text once, at plan time, so
 * the result is ordinary editable text and a regeneration with the same parameters gives the same title.
 * They are not the life line's live fields (fields.ts: {date} {hebrewDate} {year} {hebrewYear} {event}), which a title may
 * hold as well and which stay live: such a title is made with its live fields on. `{n}` stays the planner's own per-slot
 * counter of count-down titles. `night` is the Hanukkah candle (1..8); when it is not given, the planner works it out from
 * `date` and `atLighting` (packs/suggest.ts candleNight). Nothing here reads a clock: the date is an input.
 */
export const PACK_FIELD_KEYS = ['name', 'name2', 'age', 'night', 'place', 'when'] as const;
export type PackFieldKey = (typeof PACK_FIELD_KEYS)[number];
export type PackFieldValues = Readonly<Partial<Record<PackFieldKey, string>>>;
const FieldWords = z.string().min(1).max(80).regex(/^[^\n\r]*$/);
export const PackFieldsInputSchema = z.object({
  name: FieldWords.optional(), name2: FieldWords.optional(), age: FieldWords.optional(), night: FieldWords.optional(), place: FieldWords.optional(), when: FieldWords.optional(),
  date: z.string().regex(WALL_DATE).refine(isRealWallDate, { message: 'not a real calendar day between 1900 and 2100' }).optional().describe('YYYY-MM-DD, the day it was filmed: used only to work out {night} (the Hanukkah candle) when night is not given'),
  atLighting: z.boolean().optional().describe('with date: true (the default) = filmed at that evening\'s candle lighting, which belongs to the next Hebrew day'),
}).strict();
export type PackFieldsInput = z.infer<typeof PackFieldsInputSchema>;
const PACK_TOKEN = new RegExp(`\\{(${PACK_FIELD_KEYS.join('|')})\\}`, 'g');
/** The pack fields a text holds, each once, in the order of PACK_FIELD_KEYS. */
export const packFieldsIn = (text: string): PackFieldKey[] => { const found = new Set([...text.matchAll(PACK_TOKEN)].map((m) => m[1] as PackFieldKey)); return PACK_FIELD_KEYS.filter((k) => found.has(k)); };
/**
 * Replace the pack tokens of `text` by their values. Only the six tokens of PACK_FIELD_KEYS are touched: every other brace
 * group (the planner's own `{n}`, a live field such as `{hebrewDate}`) is left exactly as it is. `missing` lists the pack
 * fields of the text without a value (their tokens are left in place; the caller then uses the title's fallback words).
 * `escape` is applied to each value before it is written in (a title with live fields stores plain braces doubled:
 * fields.ts escapeFieldText). A value is written once and never read again as text with tokens.
 */
export function fillFields(text: string, fields: PackFieldValues, escape: (value: string) => string = (v) => v): { text: string; missing: PackFieldKey[] } {
  const missing = new Set<PackFieldKey>();
  const filled = text.replace(PACK_TOKEN, (token, key: PackFieldKey) => {
    const value = Object.hasOwn(fields, key) ? fields[key] : undefined;
    if (value === undefined || value === '') { missing.add(key); return token; }
    return escape(value);
  });
  return { text: filled, missing: PACK_FIELD_KEYS.filter((k) => missing.has(k)) };
}
// ---------- own templates (wave 8 owntemplate «שמירת הסרט כתבנית»; ownTemplateContract.ts) ----------
/** Ticks per beat of an own template's beats axis (MIDI-style PPQ): every denominator of TICK_DENOMS divides it. */
export const TICKS_PER_BEAT = 192;
/** The denominators a captured cut is tried at, smallest first (ownTemplate.ts quantisation; verifier C12). */
export const TICK_DENOMS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 192] as const;
/** A position or length in ticks (1/192 beat): at most 4096 beats. */
export const OwnTicksSchema = z.number().int().min(0).max(TICKS_PER_BEAT * 4096);
/** A position or length in frames of `own.rate`. */
export const OwnFramesSchema = z.number().int().min(0).max(1_000_000);
/** Slot length: whole beats or bars of the grid, or exact seconds 'n' or 'n/d'; own templates only: ticks (beats axis) or frames (frames axis). Every absolute end is snapped once; durations are differences of snapped ends. */
export const SpanSchema = z.union([
  z.object({ beats: z.number().int().min(1).max(64) }).strict(),
  z.object({ bars: z.number().int().min(1).max(16) }).strict(),
  z.object({ seconds: z.string().regex(/^[1-9]\d{0,3}(\/[1-9]\d{0,3})?$/) }).strict(),
  /** Own templates, beats axis: the length in 1/192 beats (never through scaleSpan: verifier C4). */
  z.object({ ticks: OwnTicksSchema.min(1) }).strict(),
  /** Own templates, frames axis: the length in frames at own.rate. */
  z.object({ frames: OwnFramesSchema.min(1) }).strict(),
]);
/** The span arms only own templates may use (TemplateDefSchema refuses them in a template without `own`). */
export const OWN_SPAN_ARMS = ['ticks', 'frames'] as const;
/**
 * Absolute place of an own item on the template's axis (ticks or frames from the axis origin; verifier C7): [from, to). `slot` is
 * the slot covering `from` (the item is dropped with it: warning items_dropped). The item's `at` / `span` stays as the meaningful
 * fallback (that same slot); `on` together with offsetBeats or spanSlots is refused.
 */
export const OnAxisSchema = z.object({ slot: BindName, from: OwnFramesSchema, to: OwnFramesSchema.min(1) }).strict();
export type OnAxis = z.infer<typeof OnAxisSchema>;
/**
 * The `own` block of a template saved from the owner's film. Numbers and enums only. `origin` is shown in the dialog and never used
 * to plan. beats axis: `lead` = ticks from the origin (a bar start, else a beat) to the first cut, 0 <= lead < meter·192; the
 * planner puts the first picture AT the anchor and shifts the music by the lead (verifier C3). frames axis: lead is 0.
 */
export const OwnInfoSchema = z.object({
  madeFrom: z.literal('own-film'),
  axis: z.enum(['beats', 'frames']),
  rate: z.object({ num: z.number().int().min(1).max(240000), den: z.number().int().min(1).max(100000) }).strict(),
  lead: OwnTicksSchema,
  meter: z.number().int().min(1).max(12),
  origin: z.object({ bpm: z.number().min(20).max(400).nullable(), beats: z.number().int().min(0).max(50000), seconds: z.number().min(0).max(86400), slots: z.number().int().min(1).max(120) }).strict(),
  /** True when the owner ticked «להשאיר את הטקסט»: the texts' default words are the film's own (stripped for every reader but the owner's own session, verifier C2h). */
  keptWords: z.boolean(),
}).strict();
export type OwnInfo = z.infer<typeof OwnInfoSchema>;
/** The id prefix of an own template; reserved (a catalogue template may not use it; verifier C10). */
export const OWN_TEMPLATE_ID_PREFIX = 'tpl.own-';
export const OWN_TEMPLATE_ID = /^tpl\.own-[0-9a-f]{12}$/;
export const isOwnTemplateId = (id: string): boolean => id.startsWith(OWN_TEMPLATE_ID_PREFIX);
/**
 * Every limit of a template definition, for a built-in (catalogue or pack) template and for an own one (verifier C8). The schema
 * allows the own numbers; TemplateDefSchema's refinement holds a template without `own` to the built-in ones, so no built-in can grow
 * by accident. The places the old 40 is written: TimingSchema.spanSlots and the look's span slots (own items use `on` instead, so they
 * stay 40), slots, slotUse.min (own templates use {mode:'all', min:1}, so it stays 40), texts, and TemplateInputSchema.media.
 */
export const TEMPLATE_LIMITS = {
  builtin: { slots: 40, texts: 40, elements: 20, sfx: 20, adjust: 8 },
  own: { slots: 120, texts: 80, elements: 0, sfx: 0, adjust: 16 },
  spanSlots: 40, lookSpanSlots: 40, slotUseMin: 40, media: 120,
} as const;
/** Frame fractions from the centre (TransformSchema x/y). sizeFrac = title size (fraction of frame height). scale = element scale. */
/**
 * The keys of a title's style an own template keeps (verifier C2: every one a number, an enum, a #hex colour, or fontFamily, which
 * capture takes only from FONT_CATALOG and otherwise replaces by DEFAULT_TEXT_STYLE.fontFamily, reporting font_family). A key that
 * TextStyleSchema gains later is not in this list, so it is never kept until someone adds it here (ownTemplateKeys.test.ts fails
 * until the key is classified).
 */
export const OWN_TEXT_STYLE_KEYS = ['fontFamily', 'fontWeight', 'sizeFrac', 'color', 'align', 'direction', 'lineHeight', 'background', 'stroke', 'strokeFrac', 'gradient', 'tracking', 'stroke2', 'glow', 'extrude', 'longShadow'] as const;
export const OwnTextStyleSchema = TextStyleSchema.pick(Object.fromEntries(OWN_TEXT_STYLE_KEYS.map((k) => [k, true])) as { [K in (typeof OWN_TEXT_STYLE_KEYS)[number]]: true }).strict();
export const PlaceSchema = z.object({ x: z.number().min(-0.5).max(0.5), y: z.number().min(-0.5).max(0.5), sizeFrac: z.number().min(0.01).max(0.4).optional(), scale: z.number().min(0.05).max(4).optional() }).strict();
export const EffectSpecSchema = z.object({ type: z.string().min(1).max(48), params: z.record(z.string(), z.union([z.number(), z.string().max(64), z.boolean()])).optional() }).strict();
export const SlotDefSchema = z.object({
  key: BindName, role: Words(40), accept: z.enum(['video', 'image', 'any']), span: SpanSchema,
  /** MOTION_PRESETS id. move.* spans the whole slot; in/out/loop presets use their default frames, clamped to the slot. Omitted when input.motion = 'none'. */
  motion: z.object({ presetId: z.string().max(48), amount: z.number().min(0).max(2).optional() }).strict().optional(),
  /** TRANSITIONS id at the start of this slot. frames = round(seconds*fps), clamped to the slot and to the previous slot's source handle (shortened or dropped transitions are reported). dir 'reading': left and right are mirrored when lang = 'he'. */
  transitionIn: z.object({ type: z.string().max(32), seconds: z.number().min(0.04).max(2), dir: z.enum(['reading', 'fixed']),
    /** Own templates only (TemplateDefSchema refuses them elsewhere): set_transition_options after set_transition. No `seed` (cut in version 1). */
    sync: z.literal('beat').optional(), velocity: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(), color: Colour.optional() }).strict().optional(),
  /** Keep the clip's own sound (default false: the music carries the sound). */
  keepAudio: z.boolean().optional(),
  tag: z.string().regex(/^[a-z][a-z0-9-]{0,15}$/).optional(),
  /** Own templates only: the shot's own effects with static params (add_effect after the clip). Params: numbers, booleans, enum members and #hex colours only (ownTemplateKeys.ts). */
  effects: z.array(EffectSpecSchema).max(16).optional(),
}).strict();
const TimingSchema = z.object({ slot: BindName, offsetBeats: z.number().int().min(0).max(32).optional(), spanSlots: z.number().int().min(1).max(TEMPLATE_LIMITS.spanSlots).optional() }).strict();
export const TextDefSchema = z.object({
  key: BindName, role: Words(40), default: Words(200), maxChars: z.number().int().min(1).max(500),
  /**
   * The words used instead of `default` when a pack field of `default` has no value, or a live field of it has no capture
   * date to read (ADR-0022). No pack field and no live field in it. Required when `default` holds either (checkDef).
   */
  fallback: Words(200).optional(),
  /** TEXT_PRESETS id, applied with apply_text_preset (direction stays auto). */
  presetId: z.string().max(48),
  anim: z.object({ by: z.enum(['letter', 'word', 'line']), in: z.enum(TEXT_ANIM_IN).nullable(), out: z.enum(TEXT_ANIM_OUT).nullable(), loop: z.enum(TEXT_ANIM_LOOP).nullable(), inSeconds: z.number().min(0.04).max(10), outSeconds: z.number().min(0.04).max(10) }).strict().optional(),
  /** Starts at slot `at.slot` (+ offsetBeats grid beats) and lasts spanSlots slots (default 1). */
  at: TimingSchema,
  /** count-down / count-up: one copy on each used picture slot from at.slot onwards; "{n}" becomes N..1 or 1..N. */
  perSlot: z.enum(['none', 'count-down', 'count-up']).optional(),
  place: PlaceSchema,
  /**
   * Own templates only. `style`: the title's whole style (OwnTextStyleSchema: the kept keys of TextStyleSchema), applied with
   * update_text AFTER apply_text_preset, so presetId stays required (verifier C7). `on`: its own [from, to) on the axis.
   */
  style: OwnTextStyleSchema.optional(),
  on: OnAxisSchema.optional(),
}).strict();
/**
 * color / color2: left out = the element's own default colours (ElementDef.defaults), else white and teal.
 * An element that shows a number the titles say (ADR-0022): `elementId` may hold the planner's per-slot counter `{n}` (with
 * perSlot) and pack fields (`{night}`, `{age}`…), e.g. 'element.holiday.hanukkiah-{night}': the planner writes them in, and
 * when a field has no value or the id it gives does not exist (a night of «שלישי» or 9), `fallbackElementId` is drawn instead
 * (notice field_missing). `fallbackElementId` is required exactly when `elementId` holds a brace group, and names no number.
 */
export const ElementDefSchema = z.object({ key: BindName, elementId: z.string().max(64), fallbackElementId: z.string().max(64).optional(), color: Colour.optional(), color2: Colour.optional(), at: TimingSchema, perSlot: z.enum(['none', 'count-down', 'count-up']).optional(), place: PlaceSchema, motion: z.object({ presetId: z.string().max(48) }).strict().optional() }).strict();
/** The brace groups an element id may hold (ElementDefSchema): the per-slot counter and the pack fields. */
export const ELEMENT_ID_TOKEN = /\{([a-z0-9]+)\}/g;
/**
 * Every element an ElementDef can draw: its id as it stands, or, when it holds a brace group, its id with `{n}` = 1..slotCount and
 * `{night}` = 1..8 written in (the values other fields may take cannot be listed) and its fallback. For the checks of the catalogue.
 */
export function elementIdChoices(e: { elementId: string; fallbackElementId?: string | undefined }, slotCount: number): string[] {
  if (!e.elementId.includes('{')) return [e.elementId];
  let ids = [e.elementId];
  for (const [token, count] of [['{n}', slotCount], ['{night}', 8]] as const)
    if (e.elementId.includes(token)) ids = ids.flatMap((id) => Array.from({ length: count }, (_, i) => id.replaceAll(token, String(i + 1))));
  return [...ids.filter((id) => !id.includes('{')), ...(e.fallbackElementId !== undefined ? [e.fallbackElementId] : [])];
}
export const SfxDefSchema = z.object({
  key: BindName, sfxId: z.string().max(48),
  /** boundaries = every slot start except the first (every everyN-th); first = template start; last = last slot start; {slot}/{text} = that item's start. */
  at: z.union([z.enum(['boundaries', 'first', 'last']), z.object({ slot: BindName }).strict(), z.object({ text: BindName }).strict()]),
  everyN: z.number().int().min(1).max(16).optional(), gain: z.number().min(0).max(2).optional(),
}).strict();
export const AdjustDefSchema = z.object({
  key: BindName,
  /** all = the template's own range; slots = first listed slot start to last listed slot end; tag = each contiguous run of slots with that tag. */
  span: z.union([z.literal('all'), z.object({ slots: z.array(BindName).min(1).max(TEMPLATE_LIMITS.lookSpanSlots) }).strict(), z.object({ tag: z.string().max(16) }).strict()]),
  effects: z.array(EffectSpecSchema).min(1).max(16),
  /** Opacity fade at both ends, as opacity keyframes on the adjustment clip. */
  fadeSeconds: z.number().min(0).max(2).optional(),
  /** Own templates only: the look's own [from, to) on the axis; `span` stays as the fallback ({slots:[the covering slot]}). */
  on: OnAxisSchema.optional(),
}).strict();
export const TemplateDefSchema = z.object({
  id: z.string().regex(/^tpl\.[a-z0-9-]{1,40}$/), version: z.number().int().min(1),
  name: Words(60), hint: Words(200), genre: z.enum(TEMPLATE_GENRES), designedFor: z.enum(['tall', 'square', 'wide']),
  tempo: z.object({ fallbackBpm: z.number().min(60).max(180) }).strict(),
  /**
   * need:
   * - beats = music with at least 2 analysed beats is required;
   * - optional = use music if given (with its beats), otherwise the fallback grid;
   * - none = music is never placed.
   * startAt: the music's sourceIn is its first bar start (else its first beat), or 0.
   */
  music: z.object({ need: z.enum(['beats', 'optional', 'none']), startAt: z.enum(['first-downbeat', 'zero']),
    /** A built-in music style that suits the template (musicStyles.ts). A suggestion for the dialog only: nothing is made or preselected from it. */
    builtin: MusicStyleId.optional() }).strict(),
  /** The content pack this template belongs to (packs/contract.ts PackDef.templates). */
  pack: z.string().regex(PACK_ID).optional(),
  /** Limits: TEMPLATE_LIMITS (the own numbers here; a template without `own` is held to the built-in ones by the refinement below). */
  slots: z.array(SlotDefSchema).min(1).max(TEMPLATE_LIMITS.own.slots),
  /** all = every slot is used (media cycle, each reuse of a video starts further in); media = the first max(min, media count) slots are used. */
  slotUse: z.object({ mode: z.enum(['all', 'media']), min: z.number().int().min(1).max(TEMPLATE_LIMITS.slotUseMin) }).strict(),
  texts: z.array(TextDefSchema).max(TEMPLATE_LIMITS.own.texts), elements: z.array(ElementDefSchema).max(TEMPLATE_LIMITS.builtin.elements), sfx: z.array(SfxDefSchema).max(TEMPLATE_LIMITS.builtin.sfx), adjust: z.array(AdjustDefSchema).max(TEMPLATE_LIMITS.own.adjust),
  /** Wave 8 owntemplate: present exactly on a template saved from the owner's film (id tpl.own-…). Absent on every built-in, which therefore parses and plans exactly as before. */
  own: OwnInfoSchema.optional(),
}).strict().superRefine((d, ctx) => { for (const problem of templateDefProblems(d)) ctx.addIssue({ code: 'custom', message: problem }); });
export type TemplateDef = z.infer<typeof TemplateDefSchema>;

/**
 * What TemplateDefSchema refuses beyond the shapes (verifier C7, C8, C10), as messages; [] = fine. Complete in the pre-pass:
 * - without `own` (every catalogue and pack template): the built-in limits of TEMPLATE_LIMITS; no id with the reserved prefix
 *   tpl.own-; none of the own-only fields (ticks or frames spans, slot effects, transition sync/velocity/color, title style or
 *   `on`, look `on`). So a built-in parses, and plans, exactly as before.
 * - with `own`: the id is tpl.own-<12 hex>; no graphic elements or sound effects (not carried in version 1); slotUse is
 *   {mode:'all', min:1}; every span is ticks (axis beats) or every span is frames (axis frames); frames axis: lead 0; beats axis:
 *   lead < meter·192; an item with `on` names a slot of the template, has from < to, and its `at` has no offsetBeats or spanSlots.
 */
export function templateDefProblems(d: Omit<TemplateDef, never>): string[] {
  const out: string[] = [];
  const L = d.own ? TEMPLATE_LIMITS.own : TEMPLATE_LIMITS.builtin;
  if (d.slots.length > L.slots) out.push(`at most ${L.slots} slots (${d.slots.length})`);
  if (d.texts.length > L.texts) out.push(`at most ${L.texts} texts (${d.texts.length})`);
  if (d.adjust.length > L.adjust) out.push(`at most ${L.adjust} looks (${d.adjust.length})`);
  if (d.elements.length > L.elements) out.push(d.own ? 'a template saved from a film carries no graphic elements' : `at most ${L.elements} elements`);
  if (d.sfx.length > L.sfx) out.push(d.own ? 'a template saved from a film carries no sound effects' : `at most ${L.sfx} sound effects`);
  const ownOnly: string[] = [];
  d.slots.forEach((s) => {
    if ('ticks' in s.span || 'frames' in s.span) ownOnly.push(`slot ${s.key}: span ${Object.keys(s.span)[0]}`);
    if (s.effects !== undefined) ownOnly.push(`slot ${s.key}: effects`);
    if (s.transitionIn && (s.transitionIn.sync !== undefined || s.transitionIn.velocity !== undefined || s.transitionIn.color !== undefined)) ownOnly.push(`slot ${s.key}: transition sync, velocity or color`);
  });
  d.texts.forEach((t) => { if (t.style !== undefined) ownOnly.push(`text ${t.key}: style`); if (t.on !== undefined) ownOnly.push(`text ${t.key}: on`); });
  d.adjust.forEach((a) => { if (a.on !== undefined) ownOnly.push(`look ${a.key}: on`); });
  if (!d.own) {
    if (isOwnTemplateId(d.id)) out.push(`the id prefix ${OWN_TEMPLATE_ID_PREFIX} is reserved for templates saved from a film`);
    for (const x of ownOnly) out.push(`${x} is only for a template saved from a film (own)`);
    return out;
  }
  const own = d.own;
  if (!OWN_TEMPLATE_ID.test(d.id)) out.push(`a template saved from a film has the id ${OWN_TEMPLATE_ID_PREFIX}<12 hex digits>`);
  if (d.slotUse.mode !== 'all' || d.slotUse.min !== 1) out.push('a template saved from a film uses slotUse {mode: all, min: 1}');
  const arm = own.axis === 'beats' ? 'ticks' : 'frames';
  d.slots.forEach((s) => { if (!(arm in s.span)) out.push(`slot ${s.key}: every span of a ${own.axis}-axis template is in ${arm}`); });
  if (own.axis === 'frames' && own.lead !== 0) out.push('a frames-axis template has lead 0');
  if (own.axis === 'beats' && own.lead >= own.meter * TICKS_PER_BEAT) out.push(`lead must be under one bar (${own.meter * TICKS_PER_BEAT} ticks)`);
  const slotKeys = new Set(d.slots.map((s) => s.key));
  const onRule = (what: string, on: OnAxis | undefined, extra: boolean) => {
    if (!on) return;
    if (!slotKeys.has(on.slot)) out.push(`${what}: on.slot "${on.slot}" is not a slot of the template`);
    if (on.from >= on.to) out.push(`${what}: on.from must be before on.to`);
    if (extra) out.push(`${what}: on together with offsetBeats or spanSlots`);
  };
  d.texts.forEach((t) => onRule(`text ${t.key}`, t.on, t.at.offsetBeats !== undefined || t.at.spanSlots !== undefined));
  d.adjust.forEach((a) => onRule(`look ${a.key}`, a.on, false));
  return out;
}

export const TemplateInputSchema = z.object({
  media: z.array(z.string()).max(TEMPLATE_LIMITS.media).default([]).describe('Picture or video asset ids, in order (at most 120)'),
  musicAssetId: z.string().nullable().default(null),
  texts: z.record(z.string(), z.string().min(1).max(500)).default({}).describe('By text key'),
  at: RationalTimeSchema.optional().describe('Frame-aligned start on the main sequence; default 0 when it is empty, else the end of the last picture or title'),
  lang: z.enum(['he', 'en']).default('he'),
  order: z.enum(['sequence', 'shuffle']).default('sequence'),
  seed: z.number().int().min(0).max(1_000_000).default(1),
  tempo: z.enum(['normal', 'half', 'double']).default('normal').describe('half = slots twice as long; double = half as long (never under the flash gap)'),
  motion: z.enum(['full', 'none']).default('full').describe('none = no camera moves or animated titles (reduced motion)'),
  /** Optional without a default, like `fields`, so the parameters of plans and runs made before ADR-0022 are unchanged. */
  builtinMusic: z.object({ styleId: MusicStyleId, seed: z.number().int().min(0).max(MUSIC_MAX_SEED).default(1),
    /** Wave 7 musicfit: 'exact' = the track is made for exactly the pictures with its own ending (no fade); absent or 'bars' = today. B builds it. */
    ending: z.enum(['bars', 'exact']).optional() }).strict().nullable().optional()
    .describe('Built-in synthesised music (GET /api/v1/music) made to the length of the template; not together with musicAssetId (send musicAssetId: null with it)'),
  fields: PackFieldsInputSchema.optional().describe('Words for {name} {name2} {age} {night} {place} {when} in the template\'s own titles; literal text'),
}).strict();
export type TemplateInput = z.infer<typeof TemplateInputSchema>;
export const TEMPLATE_WARNING_CODES = ['slot_too_short', 'slots_dropped', 'cuts_merged', 'media_unused', 'media_reused', 'transition_shortened', 'text_too_long', 'designed_for_other_shape', 'kept_by_hand', 'items_dropped'] as const;
export interface TemplateWarning { code: (typeof TEMPLATE_WARNING_CODES)[number]; message: string; details: Record<string, unknown> }
/**
 * What the planner decided by itself about fields, built-in music and elements (ADR-0022), with the reason. A list of its
 * own beside `warnings` (which name chosen media or slots that did not fit): nothing here needs an answer before applying.
 * - field_missing: a title's pack field has no value; the title's fallback words were used.
 * - field_no_date: a title's live field would have no capture date to read under it; the fallback words were used.
 * - builtin_music_faded: the built-in track is longer than the pictures; it is cut at the last picture and faded out.
 * - element_dropped: two graphic elements of the plan would lie on the same track range; the earlier one was left out.
 * - removed_by_hand (regeneration): items of the previous run that were deleted by hand since (their slot record names a clip no
 *   longer in the document) are not made again; details.keys names them. The plan's alternatives offer to bring them back
 *   (restoreRemoved: true on the regenerate request).
 * - moved_back (regeneration): items of the previous run whose only change since is their place in time on their own track (a
 *   ripple delete before them closed the gap, or they were dragged along the track) are not kept as hand edits: they are made
 *   again on the place the template gives them; details.keys names them (a slot's own sound under the key of its picture).
 */
export const TEMPLATE_NOTICE_CODES = ['field_missing', 'field_no_date', 'builtin_music_faded', 'element_dropped', 'removed_by_hand', 'moved_back'] as const;
export interface TemplateNotice { code: (typeof TEMPLATE_NOTICE_CODES)[number]; message: string; details: Record<string, unknown> }
export interface PredictedSlot { key: string; startFrame: number; frames: number; assetId: string | null; sourceInFrame: number | null; /** 1 - visible share of the picture under the project fit (cover) or letterbox share (contain); null for no picture. */ cropShare: number | null }
export interface TemplatePlan {
  templateId: string; version: number; params: TemplateInput;
  steps: string[]; basis: string[]; warnings: TemplateWarning[];
  /** See TEMPLATE_NOTICE_CODES. Always present; empty for a plan without fields, built-in music or dropped elements. */
  notices: TemplateNotice[];
  /** Non-empty = apply refuses (409 template_blocked). */
  blocking: TemplateWarning[];
  /** restoreRemoved: the choice to regenerate again with the items removed by hand made again (notice removed_by_hand). */
  alternatives: { label: string; params: Partial<TemplateInput>; restoreRemoved?: true }[];
  /**
   * Procedural media the server makes (makeSfx / makeElement / makeMusic) and passes as apply_template.assets under `key`.
   * music: `id` is the style, the track has exactly `bars` bars, and the server passes its known grid as assets[].analysis.
   */
  assetsNeeded: ({ key: string; kind: 'sfx' | 'element'; id: string; color?: string; color2?: string } | { key: string; kind: 'music'; id: string; bars: number; seed: number; /** wave 7 musicfit: the ending in sample frames (ending 'exact'); absent = one bar */ endFrames?: number })[];
  ops: TemplateStep[];
  slots: PlannedSlot[];
  predicted: { startFrame: number; endFrame: number; boundaries: number[]; gapFrames: number; slots: PredictedSlot[] };
}
export class TemplateError extends Error {
  constructor(public code: 'not_found' | 'needs_analysis' | 'needs_capability' | 'invalid_args' | 'nothing_to_do', message: string, public hint?: string) { super(message); }
}
export interface TemplatePlanContext {
  /** keys of the previous run's items edited by hand (regeneration): not emitted, kept */
  keepKeys?: readonly string[];
  /**
   * keys of the previous run's items deleted by hand (regeneration): their slot record names a clip that is no longer in the
   * document. Not emitted, so a hand delete survives the regeneration; the plan says so (notice removed_by_hand) and offers the
   * alternative restoreRemoved. Derived from the run's slot records and the document, never stored as a flag.
   */
  removedKeys?: readonly string[];
  /**
   * keys of the previous run's items that were only moved in time since the run (regeneration; templateOps.ts movedOnly). They
   * are emitted like any untouched item; the plan says which of them it made again (notice moved_back).
   */
  movedKeys?: readonly string[];
  elementsAvailable?: boolean;
}

/**
 * Model capabilities a template may need and this build does not have (ADR-0016). No built-in template uses one; the
 * templates that would are listed in MODEL_GATED_TEMPLATES as unavailable.
 */
export const TEMPLATE_MODEL_NEEDS = ['video-segmentation', 'depth-estimation'] as const;
export type TemplateModelNeed = (typeof TEMPLATE_MODEL_NEEDS)[number];
export const TEMPLATE_METHOD = 'rule-based template; no model' as const;
export const GATED_TEMPLATE_METHOD = 'needs a model that is not installed; never run' as const;
export interface TemplateSummary {
  id: string; version: number; name: { he: string; en: string }; hint: { he: string; en: string }; genre: (typeof TEMPLATE_GENRES)[number]; designedFor: 'tall' | 'square' | 'wide';
  slots: { key: string; role: { he: string; en: string }; accept: 'video' | 'image' | 'any' }[];
  texts: { key: string; role: { he: string; en: string }; default: { he: string; en: string }; maxChars: number }[];
  /** model: the missing model capability of a gated template (MODEL_GATED_TEMPLATES); null for every built-in template. */
  seconds: number; needs: { music: 'beats' | 'optional' | 'none'; elements: boolean; gpu: boolean; model: TemplateModelNeed | null };
  /** unavailableReason is English (API wording); the editor words it from `needs` (i18n `template.unavailable.*`). */
  available: boolean; unavailableReason: string | null; method: typeof TEMPLATE_METHOD | typeof GATED_TEMPLATE_METHOD;
  /** ADR-0022. pack: the content pack it belongs to; fields: the pack fields its titles hold (the dialog asks for these); liveFields: a title holds a live field of the life line; builtinMusic: the style it suggests. */
  pack: string | null; fields: PackFieldKey[]; liveFields: boolean; builtinMusic: string | null;
}

/**
 * Templates that need a model this build does not have (decided for wave 3: shown unavailable with an honest reason until the
 * segmentation and depth models of the AI-model wave are installed). They are listed after the built-ins in the template
 * gallery (GET /api/v1/templates, catalog().templates) so it is honest about what exists. They are never planned or applied:
 * plan and apply of one of these ids answer 409 needs_capability with the reason (TemplateError 'needs_capability'), and
 * nothing is downloaded for them.
 */
export interface ModelGatedTemplate {
  id: string; version: number; name: { he: string; en: string }; hint: { he: string; en: string };
  genre: (typeof TEMPLATE_GENRES)[number]; designedFor: 'tall' | 'square' | 'wide'; needsModel: TemplateModelNeed; reason: string;
}
export const MODEL_GATED_TEMPLATES: readonly ModelGatedTemplate[] = [
  {
    id: 'tpl.text-behind-subject', version: 1,
    name: { he: 'טקסט מאחורי הדמות', en: 'Text behind subject' },
    hint: { he: 'כותרת גדולה שהאדם בצילום עובר לפניה', en: 'A large title that the person in the shot passes in front of' },
    genre: 'promo', designedFor: 'tall', needsModel: 'video-segmentation',
    reason: 'needs a video subject-segmentation model (a matte of the person in every frame), which is not installed on this machine; templates never download models',
  },
  {
    id: 'tpl.3d-zoom', version: 1,
    name: { he: 'זום תלת־ממדי', en: '3D zoom' },
    hint: { he: 'תנועת מצלמה עם עומק מתוך תמונה אחת', en: 'A camera move with depth made from a single photo' },
    genre: 'memories', designedFor: 'tall', needsModel: 'depth-estimation',
    reason: 'needs a depth-estimation model (how far each pixel is from the camera), which is not installed on this machine; templates never download models',
  },
];
export const findGatedTemplate = (id: string): ModelGatedTemplate | undefined => MODEL_GATED_TEMPLATES.find((t) => t.id === id);
/** The gallery entry of a gated template: unavailable, with its reason; no slots or texts are offered. */
export function gatedTemplateSummary(t: ModelGatedTemplate): TemplateSummary {
  return {
    id: t.id, version: t.version, name: t.name, hint: t.hint, genre: t.genre, designedFor: t.designedFor, slots: [], texts: [], seconds: 0,
    needs: { music: 'none', elements: false, gpu: false, model: t.needsModel },
    available: false, unavailableReason: t.reason, method: GATED_TEMPLATE_METHOD, pack: null, fields: [], liveFields: false, builtinMusic: null,
  };
}
/** The refusal for planning or applying a gated template (the server maps needs_capability to 409). */
export const gatedTemplateError = (t: ModelGatedTemplate) => new TemplateError('needs_capability', `template ${t.id} ${t.reason}`, 'Choose one of the available templates (GET /api/v1/templates).');

export interface TemplatePlanView { revision: number; templateId: string; version: number; params: TemplateInput; steps: string[]; basis: string[]; warnings: TemplateWarning[]; /** The server always sends it (ADR-0022); optional so that a view made without it stays one. */ notices?: TemplateNotice[]; blocking: TemplateWarning[]; alternatives: TemplatePlan['alternatives']; operations: number; predicted: TemplatePlan['predicted']; method: string; note: string }
export interface TemplateApplyResult { revision: number; runId: string; createdIds: string[]; slots: SlotRecord[]; steps: string[]; warnings: TemplateWarning[]; notices?: TemplateNotice[] }
/**
 * removed: the keys of the items deleted by hand that this regeneration left out (empty with restoreRemoved); alternatives: the
 * plan's, among them the explicit choice to restore those items ({restoreRemoved: true}); movedBack: the keys of the items that
 * had only been moved in time and were made again on their place (notice moved_back; a template run always sends it; a family
 * film answers with its own result, which has the same field and warning moved_back).
 */
export interface TemplateRegenerateResult extends TemplateApplyResult { replaced: number; protected: string[]; removed: string[]; movedBack?: string[]; alternatives: TemplatePlan['alternatives'] }
export const TemplateBodySchema = z.object({ params: z.unknown().optional(), expectedRevision: z.number().int().min(0).optional() }).strict();
/**
 * The regenerate request: restoreRemoved true makes the items deleted by hand since the last run again (the explicit choice the
 * plan offers); absent or false leaves them out. Template runs and family film runs alike.
 */
export const TemplateRegenerateBodySchema = TemplateBodySchema.extend({ restoreRemoved: z.boolean().optional() }).strict();
export interface RegenerateOptions { restoreRemoved?: boolean }
/**
 * REST routes. Every mutating route calls gov.assertMayAct(p, id, 'edit') (propose mode -> 403 insufficient_scope) and gov.assertUnrestricted.
 * - GET  /api/v1/templates -> { templates: TemplateSummary[] }: the built-ins (summarizeTemplate) followed by
 *   MODEL_GATED_TEMPLATES.map(gatedTemplateSummary); catalog().templates is the same list.
 * - POST /api/v1/projects/:id/templates/:templateId/plan {params} -> TemplatePlanView (read-only).
 * - POST /api/v1/projects/:id/templates/:templateId/apply {params, expectedRevision?} -> TemplateApplyResult.
 * - POST /api/v1/projects/:id/template-runs/:runId/regenerate {params?: Partial<TemplateInput>, restoreRemoved?} -> TemplateRegenerateResult.
 * - plan/apply of a gated id -> 409 needs_capability (gatedTemplateError); an unknown id -> 404 not_found.
 * MCP tools: plan_template, apply_template, regenerate_template.
 */
