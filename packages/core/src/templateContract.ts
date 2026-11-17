/**
 * Templates (ADR-0016): the shared contract of the template definitions, the planner, the internal op apply_template and the
 * server routes. Templates are versioned code data with no frame numbers; a pure planner (templatePlan.ts) compiles one into
 * public ops, and the server applies them as ONE internal op (templateOps.ts) whose arguments carry everything (asset records,
 * resolved ops), so replay never reads the catalogue. The run record (RecipeRun with recipeId `template:<id>`) holds the slots.
 * Rule-based; no model. Templates that would need a model are listed as unavailable (MODEL_GATED_TEMPLATES) and never run.
 */
import { z } from 'zod';
import { AssetSchema, RationalTimeSchema, SlotRecordSchema, TEMPLATE_SLOT_KINDS, TEXT_ANIM_IN, TEXT_ANIM_LOOP, TEXT_ANIM_OUT, type SlotRecord } from './schema.ts';

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
export const TemplateAssetSchema = z.object({ key: BindName, asset: AssetSchema.omit({ id: true }) }).strict();
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
}).strict();
export type ApplyTemplateArgs = z.infer<typeof ApplyTemplateArgsSchema>;
/** apply_template OpResult.output. The run record: recipeRuns[runId] = { recipeId: `template:${templateId}`, params: {...params, templateVersion}, createdIds, fingerprints, steps, slots }. */
export interface ApplyTemplateOutput { runId: string; createdIds: string[]; slots: SlotRecord[]; assetIds: Record<string, string> }

export const TEMPLATE_GENRES = ['montage', 'celebration', 'promo', 'quote', 'list', 'memories'] as const;
/** Slot length: whole beats or bars of the grid, or exact seconds 'n' or 'n/d'. Every absolute end is snapped once; durations are differences of snapped ends. */
export const SpanSchema = z.union([
  z.object({ beats: z.number().int().min(1).max(64) }).strict(),
  z.object({ bars: z.number().int().min(1).max(16) }).strict(),
  z.object({ seconds: z.string().regex(/^[1-9]\d{0,3}(\/[1-9]\d{0,3})?$/) }).strict(),
]);
/** Frame fractions from the centre (TransformSchema x/y). sizeFrac = title size (fraction of frame height). scale = element scale. */
export const PlaceSchema = z.object({ x: z.number().min(-0.5).max(0.5), y: z.number().min(-0.5).max(0.5), sizeFrac: z.number().min(0.01).max(0.4).optional(), scale: z.number().min(0.05).max(4).optional() }).strict();
export const EffectSpecSchema = z.object({ type: z.string().min(1).max(48), params: z.record(z.string(), z.union([z.number(), z.string().max(64), z.boolean()])).optional() }).strict();
export const SlotDefSchema = z.object({
  key: BindName, role: Words(40), accept: z.enum(['video', 'image', 'any']), span: SpanSchema,
  /** MOTION_PRESETS id. move.* spans the whole slot; in/out/loop presets use their default frames, clamped to the slot. Omitted when input.motion = 'none'. */
  motion: z.object({ presetId: z.string().max(48), amount: z.number().min(0).max(2).optional() }).strict().optional(),
  /** TRANSITIONS id at the start of this slot. frames = round(seconds*fps), clamped to the slot and to the previous slot's source handle (shortened or dropped transitions are reported). dir 'reading': left and right are mirrored when lang = 'he'. */
  transitionIn: z.object({ type: z.string().max(32), seconds: z.number().min(0.04).max(2), dir: z.enum(['reading', 'fixed']) }).strict().optional(),
  /** Keep the clip's own sound (default false: the music carries the sound). */
  keepAudio: z.boolean().optional(),
  tag: z.string().regex(/^[a-z][a-z0-9-]{0,15}$/).optional(),
}).strict();
const TimingSchema = z.object({ slot: BindName, offsetBeats: z.number().int().min(0).max(32).optional(), spanSlots: z.number().int().min(1).max(40).optional() }).strict();
export const TextDefSchema = z.object({
  key: BindName, role: Words(40), default: Words(200), maxChars: z.number().int().min(1).max(500),
  /** TEXT_PRESETS id, applied with apply_text_preset (direction stays auto). */
  presetId: z.string().max(48),
  anim: z.object({ by: z.enum(['letter', 'word', 'line']), in: z.enum(TEXT_ANIM_IN).nullable(), out: z.enum(TEXT_ANIM_OUT).nullable(), loop: z.enum(TEXT_ANIM_LOOP).nullable(), inSeconds: z.number().min(0.04).max(10), outSeconds: z.number().min(0.04).max(10) }).strict().optional(),
  /** Starts at slot `at.slot` (+ offsetBeats grid beats) and lasts spanSlots slots (default 1). */
  at: TimingSchema,
  /** count-down / count-up: one copy on each used picture slot from at.slot onwards; "{n}" becomes N..1 or 1..N. */
  perSlot: z.enum(['none', 'count-down', 'count-up']).optional(),
  place: PlaceSchema,
}).strict();
export const ElementDefSchema = z.object({ key: BindName, elementId: z.string().max(64), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(), at: TimingSchema, perSlot: z.enum(['none', 'count-down', 'count-up']).optional(), place: PlaceSchema, motion: z.object({ presetId: z.string().max(48) }).strict().optional() }).strict();
export const SfxDefSchema = z.object({
  key: BindName, sfxId: z.string().max(48),
  /** boundaries = every slot start except the first (every everyN-th); first = template start; last = last slot start; {slot}/{text} = that item's start. */
  at: z.union([z.enum(['boundaries', 'first', 'last']), z.object({ slot: BindName }).strict(), z.object({ text: BindName }).strict()]),
  everyN: z.number().int().min(1).max(16).optional(), gain: z.number().min(0).max(2).optional(),
}).strict();
export const AdjustDefSchema = z.object({
  key: BindName,
  /** all = the template's own range; slots = first listed slot start to last listed slot end; tag = each contiguous run of slots with that tag. */
  span: z.union([z.literal('all'), z.object({ slots: z.array(BindName).min(1).max(40) }).strict(), z.object({ tag: z.string().max(16) }).strict()]),
  effects: z.array(EffectSpecSchema).min(1).max(16),
  /** Opacity fade at both ends, as opacity keyframes on the adjustment clip. */
  fadeSeconds: z.number().min(0).max(2).optional(),
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
  music: z.object({ need: z.enum(['beats', 'optional', 'none']), startAt: z.enum(['first-downbeat', 'zero']) }).strict(),
  slots: z.array(SlotDefSchema).min(1).max(40),
  /** all = every slot is used (media cycle, each reuse of a video starts further in); media = the first max(min, media count) slots are used. */
  slotUse: z.object({ mode: z.enum(['all', 'media']), min: z.number().int().min(1).max(40) }).strict(),
  texts: z.array(TextDefSchema).max(40), elements: z.array(ElementDefSchema).max(20), sfx: z.array(SfxDefSchema).max(20), adjust: z.array(AdjustDefSchema).max(8),
}).strict();
export type TemplateDef = z.infer<typeof TemplateDefSchema>;

export const TemplateInputSchema = z.object({
  media: z.array(z.string()).max(40).default([]).describe('Picture or video asset ids, in order'),
  musicAssetId: z.string().nullable().default(null),
  texts: z.record(z.string(), z.string().min(1).max(500)).default({}).describe('By text key'),
  at: RationalTimeSchema.optional().describe('Frame-aligned start on the main sequence; default 0 when it is empty, else the end of the last picture or title'),
  lang: z.enum(['he', 'en']).default('he'),
  order: z.enum(['sequence', 'shuffle']).default('sequence'),
  seed: z.number().int().min(0).max(1_000_000).default(1),
  tempo: z.enum(['normal', 'half', 'double']).default('normal').describe('half = slots twice as long; double = half as long (never under the flash gap)'),
  motion: z.enum(['full', 'none']).default('full').describe('none = no camera moves or animated titles (reduced motion)'),
}).strict();
export type TemplateInput = z.infer<typeof TemplateInputSchema>;
export const TEMPLATE_WARNING_CODES = ['slot_too_short', 'slots_dropped', 'cuts_merged', 'media_unused', 'media_reused', 'transition_shortened', 'text_too_long', 'designed_for_other_shape', 'kept_by_hand'] as const;
export interface TemplateWarning { code: (typeof TEMPLATE_WARNING_CODES)[number]; message: string; details: Record<string, unknown> }
export interface PredictedSlot { key: string; startFrame: number; frames: number; assetId: string | null; sourceInFrame: number | null; /** 1 - visible share of the picture under the project fit (cover) or letterbox share (contain); null for no picture. */ cropShare: number | null }
export interface TemplatePlan {
  templateId: string; version: number; params: TemplateInput;
  steps: string[]; basis: string[]; warnings: TemplateWarning[];
  /** Non-empty = apply refuses (409 template_blocked). */
  blocking: TemplateWarning[];
  alternatives: { label: string; params: Partial<TemplateInput> }[];
  /** Procedural media the server makes (makeSfx / makeElement) and passes as apply_template.assets under `key`. */
  assetsNeeded: { key: string; kind: 'sfx' | 'element'; id: string; color?: string }[];
  ops: TemplateStep[];
  slots: PlannedSlot[];
  predicted: { startFrame: number; endFrame: number; boundaries: number[]; gapFrames: number; slots: PredictedSlot[] };
}
export class TemplateError extends Error {
  constructor(public code: 'not_found' | 'needs_analysis' | 'needs_capability' | 'invalid_args' | 'nothing_to_do', message: string, public hint?: string) { super(message); }
}
export interface TemplatePlanContext { /** keys of the previous run's items edited by hand (regeneration): not emitted, kept */ keepKeys?: readonly string[]; elementsAvailable?: boolean }

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
    available: false, unavailableReason: t.reason, method: GATED_TEMPLATE_METHOD,
  };
}
/** The refusal for planning or applying a gated template (the server maps needs_capability to 409). */
export const gatedTemplateError = (t: ModelGatedTemplate) => new TemplateError('needs_capability', `template ${t.id} ${t.reason}`, 'Choose one of the available templates (GET /api/v1/templates).');

export interface TemplatePlanView { revision: number; templateId: string; version: number; params: TemplateInput; steps: string[]; basis: string[]; warnings: TemplateWarning[]; blocking: TemplateWarning[]; alternatives: TemplatePlan['alternatives']; operations: number; predicted: TemplatePlan['predicted']; method: string; note: string }
export interface TemplateApplyResult { revision: number; runId: string; createdIds: string[]; slots: SlotRecord[]; steps: string[]; warnings: TemplateWarning[] }
export interface TemplateRegenerateResult extends TemplateApplyResult { replaced: number; protected: string[] }
export const TemplateBodySchema = z.object({ params: z.unknown().optional(), expectedRevision: z.number().int().min(0).optional() }).strict();
/**
 * REST routes. Every mutating route calls gov.assertMayAct(p, id, 'edit') (propose mode -> 403 insufficient_scope) and gov.assertUnrestricted.
 * - GET  /api/v1/templates -> { templates: TemplateSummary[] }: the built-ins (summarizeTemplate) followed by
 *   MODEL_GATED_TEMPLATES.map(gatedTemplateSummary); catalog().templates is the same list.
 * - POST /api/v1/projects/:id/templates/:templateId/plan {params} -> TemplatePlanView (read-only).
 * - POST /api/v1/projects/:id/templates/:templateId/apply {params, expectedRevision?} -> TemplateApplyResult.
 * - POST /api/v1/projects/:id/template-runs/:runId/regenerate {params?: Partial<TemplateInput>} -> TemplateRegenerateResult.
 * - plan/apply of a gated id -> 409 needs_capability (gatedTemplateError); an unknown id -> 404 not_found.
 * MCP tools: plan_template, apply_template, regenerate_template.
 */
