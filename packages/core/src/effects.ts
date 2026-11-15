/**
 * Effect, blend, mask and transition registries (SPEC §8 effect contract, §12 catalog, §13).
 * This file is the contract: ids, versions, parameter schemas, defaults and declared properties.
 * The single implementation lives in the shared compositor (packages/engine), used by preview and export alike.
 *
 * Scope of this batch: what a Canvas2D compositor can do faithfully. GPU shader families (distortion, glitch,
 * film, keying, depth) are not here and are not approximated under their names.
 * Lengths are fractions of the output frame height, so a scaled preview or export looks the same.
 */
import { z } from 'zod';

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/).describe('#RRGGBB');
const frac = (max: number, def: number, what: string) => z.number().min(0).max(max).default(def).describe(what);

export interface EffectDef<S extends z.ZodObject = z.ZodObject> {
  id: string;
  version: number;
  category: 'color' | 'blur' | 'light' | 'stylize' | 'digital';
  name: { he: string; en: string };
  description: string;
  params: S;
  /** filter = one compositor filter pass; layer = needs its own layer buffer pass (costlier). */
  cost: 'filter' | 'layer';
  /** Depends only on the current frame (no neighbouring frames), so random seek equals sequential playback. */
  temporal: false;
  /** Uses seeded noise that varies per frame. */
  seeded: boolean;
}
const def = <S extends z.ZodObject>(d: EffectDef<S>) => d;

export const EFFECTS = [
  def({ id: 'color.adjust', version: 1, category: 'color', name: { he: 'כיוון צבע', en: 'Color adjust' }, description: 'Brightness, contrast, saturation and hue rotation.', cost: 'filter', temporal: false, seeded: false,
    params: z.object({ brightness: z.number().min(0).max(3).default(1), contrast: z.number().min(0).max(3).default(1), saturation: z.number().min(0).max(3).default(1), hue: z.number().min(-180).max(180).default(0).describe('degrees') }).strict() }),
  def({ id: 'color.grayscale', version: 1, category: 'color', name: { he: 'שחור־לבן', en: 'Black & white' }, description: 'Remove colour.', cost: 'filter', temporal: false, seeded: false, params: z.object({ amount: frac(1, 1, '0 = off, 1 = full') }).strict() }),
  def({ id: 'color.sepia', version: 1, category: 'color', name: { he: 'ספיה', en: 'Sepia' }, description: 'Warm brown tone.', cost: 'filter', temporal: false, seeded: false, params: z.object({ amount: frac(1, 1, '0 = off, 1 = full') }).strict() }),
  def({ id: 'color.invert', version: 1, category: 'color', name: { he: 'היפוך צבעים', en: 'Invert' }, description: 'Invert colours.', cost: 'filter', temporal: false, seeded: false, params: z.object({ amount: frac(1, 1, '0 = off, 1 = full') }).strict() }),
  def({ id: 'color.tint', version: 1, category: 'color', name: { he: 'גוון', en: 'Tint' }, description: 'Lay a colour over the layer with a blend mode.', cost: 'layer', temporal: false, seeded: false,
    params: z.object({ color: Color.default('#FF7A00'), amount: frac(1, 0.35, 'strength'), mode: z.enum(['color', 'multiply', 'screen', 'overlay', 'soft-light']).default('color') }).strict() }),
  def({ id: 'blur.gaussian', version: 1, category: 'blur', name: { he: 'טשטוש', en: 'Blur' }, description: 'Gaussian blur.', cost: 'filter', temporal: false, seeded: false, params: z.object({ radius: frac(0.2, 0.01, 'blur radius, fraction of frame height') }).strict() }),
  def({ id: 'light.vignette', version: 1, category: 'light', name: { he: 'וינייטה', en: 'Vignette' }, description: 'Darken toward the edges of the layer.', cost: 'layer', temporal: false, seeded: false,
    params: z.object({ amount: frac(1, 0.5, 'darkness at the corners'), size: frac(1, 0.45, 'radius of the untouched centre, fraction of the layer half-diagonal') }).strict() }),
  def({ id: 'light.diffusion', version: 1, category: 'light', name: { he: 'ריכוך זוהר', en: 'Diffusion glow' }, description: 'Soft glow: a blurred copy screened over the layer. Not a threshold bloom.', cost: 'layer', temporal: false, seeded: false,
    params: z.object({ radius: frac(0.1, 0.02, 'glow radius, fraction of frame height'), amount: frac(1, 0.5, 'strength') }).strict() }),
  def({ id: 'stylize.shadow', version: 1, category: 'stylize', name: { he: 'צל', en: 'Drop shadow' }, description: 'Shadow behind the visible pixels of the layer (titles, cut-outs).', cost: 'filter', temporal: false, seeded: false,
    params: z.object({ color: Color.default('#000000'), opacity: frac(1, 0.6, 'shadow opacity'), blur: frac(0.1, 0.01, 'softness, fraction of frame height'), x: z.number().min(-0.2).max(0.2).default(0.004), y: z.number().min(-0.2).max(0.2).default(0.006) }).strict() }),
  def({ id: 'stylize.pixelate', version: 1, category: 'stylize', name: { he: 'פיקסלים', en: 'Pixelate' }, description: 'Mosaic of square blocks.', cost: 'layer', temporal: false, seeded: false, params: z.object({ size: z.number().min(0.002).max(0.2).default(0.02).describe('block size, fraction of frame height') }).strict() }),
  def({ id: 'stylize.grain', version: 1, category: 'stylize', name: { he: 'גרעיניות', en: 'Grain' }, description: 'Seeded monochrome noise that changes every frame; the same frame always gets the same noise.', cost: 'layer', temporal: false, seeded: true,
    params: z.object({ amount: frac(1, 0.25, 'strength'), seed: z.number().int().min(0).max(1_000_000).default(1) }).strict() }),
  def({ id: 'digital.rgb-split', version: 1, category: 'digital', name: { he: 'פיצול צבעים', en: 'RGB split' }, description: 'Offsets the red and blue channels in opposite directions.', cost: 'layer', temporal: false, seeded: false,
    params: z.object({ amount: frac(0.05, 0.006, 'offset, fraction of frame height'), angle: z.number().min(-180).max(180).default(0).describe('degrees') }).strict() }),
] as const;
export type EffectType = (typeof EFFECTS)[number]['id'];
export const findEffect = (type: string): EffectDef | undefined => (EFFECTS as readonly EffectDef[]).find((e) => e.id === type);
/** Validate and complete parameters for an effect type. Throws ZodError on bad input. */
export const effectParams = (type: string, params: unknown): Record<string, number | string | boolean> => findEffect(type)!.params.parse(params ?? {}) as Record<string, number | string | boolean>;

/** Blend modes, named as in the spec; each maps to exactly one Canvas2D composite operation. */
export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light', 'add', 'difference', 'exclusion', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hue', 'saturation', 'color', 'luminosity'] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export const MaskSchema = z
  .object({
    shape: z.enum(['rect', 'ellipse']),
    x: z.number().min(-1).max(1).describe('Mask centre, fraction of the layer width from the layer centre'),
    y: z.number().min(-1).max(1),
    width: z.number().min(0.01).max(2).describe('Fraction of the layer width'),
    height: z.number().min(0.01).max(2),
    radius: z.number().min(0).max(1).describe('rect only: corner rounding, 1 = fully round'),
    feather: z.number().min(0).max(0.2).describe('Edge softness, fraction of frame height'),
    invert: z.boolean(),
  })
  .strict();
export const DEFAULT_MASK = { shape: 'rect', x: 0, y: 0, width: 0.8, height: 0.8, radius: 0, feather: 0, invert: false } as const satisfies z.infer<typeof MaskSchema>;
export type Mask = z.infer<typeof MaskSchema>;

export const TRANSITIONS = [
  { id: 'dissolve', name: { he: 'מעבר רך', en: 'Cross dissolve' }, usesOutgoing: true },
  { id: 'dip-black', name: { he: 'דרך שחור', en: 'Dip to black' }, usesOutgoing: true },
  { id: 'dip-white', name: { he: 'דרך לבן', en: 'Dip to white' }, usesOutgoing: true },
  { id: 'wipe-left', name: { he: 'ניגוב שמאלה', en: 'Wipe left' }, usesOutgoing: true },
  { id: 'wipe-right', name: { he: 'ניגוב ימינה', en: 'Wipe right' }, usesOutgoing: true },
  { id: 'wipe-up', name: { he: 'ניגוב למעלה', en: 'Wipe up' }, usesOutgoing: true },
  { id: 'wipe-down', name: { he: 'ניגוב למטה', en: 'Wipe down' }, usesOutgoing: true },
  { id: 'push-left', name: { he: 'דחיפה שמאלה', en: 'Push left' }, usesOutgoing: true },
  { id: 'push-right', name: { he: 'דחיפה ימינה', en: 'Push right' }, usesOutgoing: true },
  { id: 'push-up', name: { he: 'דחיפה למעלה', en: 'Push up' }, usesOutgoing: true },
  { id: 'push-down', name: { he: 'דחיפה למטה', en: 'Push down' }, usesOutgoing: true },
  { id: 'zoom', name: { he: 'זום', en: 'Zoom in' }, usesOutgoing: true },
] as const;
export const TRANSITION_IDS = TRANSITIONS.map((t) => t.id) as [TransitionType, ...TransitionType[]];
export type TransitionType = (typeof TRANSITIONS)[number]['id'];
/** A transition plays over the FIRST `frames` of the clip that carries it; the previous clip on the track keeps playing underneath from its source handle. */
export const TransitionSchema = z.object({ type: z.enum(TRANSITION_IDS), frames: z.number().int().min(1).max(150) }).strict();
export type Transition = z.infer<typeof TransitionSchema>;

export const EffectInstanceSchema = z
  .object({ id: z.string().min(1).max(64), type: z.string().min(1).max(48), enabled: z.boolean(), params: z.record(z.string(), z.union([z.number(), z.string().max(64), z.boolean()])) })
  .strict();
export type EffectInstance = z.infer<typeof EffectInstanceSchema>;

/** Discovery payload for REST/MCP/Lab: everything registered, with JSON Schemas and defaults. */
export function describeCatalog() {
  return {
    effects: (EFFECTS as readonly EffectDef[]).map((e) => ({ id: e.id, version: e.version, category: e.category, name: e.name, description: e.description, cost: e.cost, seeded: e.seeded, temporal: e.temporal, implementation: 'canvas2d', defaults: e.params.parse({}), paramsSchema: z.toJSONSchema(e.params) })),
    transitions: TRANSITIONS.map((t) => ({ ...t, version: 1, implementation: 'canvas2d', audio: 'unchanged (hard cut)' })),
    blendModes: [...BLEND_MODES],
    mask: { shapes: ['rect', 'ellipse'], defaults: DEFAULT_MASK, paramsSchema: z.toJSONSchema(MaskSchema) },
  };
}
