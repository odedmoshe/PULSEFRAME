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
/**
 * What drives an effect that hits repeatedly: its own steady setting, or the detected beats of the music playing under the
 * clip (see beatgrid.ts). Where no analysed music plays, the shake, the zoom pulse and the RGB shake fall back to their steady
 * setting; the strobe shows nothing there (packages/engine strobeSchedule.ts). Beats are counted from the first bar start of
 * the music, not from the start of each bar (engine gpu.ts musicHit).
 */
const FOLLOW = {
  follow: z.enum(['steady', 'music']).default('steady').describe('steady = the effect\'s own tempo or rate; music = it hits on the beats detected in the music under the clip (run a beat analysis on the music first). Where no analysed music plays, a strobe shows nothing and the other effects keep their steady setting'),
  every: z.number().int().min(1).max(16).default(1).describe('with follow=music: hit on every Nth beat, counting the beats from the first bar start of the music'),
};

export type EffectCategory = 'color' | 'blur' | 'light' | 'stylize' | 'digital' | 'key' | 'distort' | 'motion' | 'time' | 'overlay';
/**
 * How an effect reads other moments of its clip (SPEC §8: temporal effects sample explicit neighbouring times with bounded
 * windows; random seek equals sequential; ADR-0011, time effects on the shared evaluator). Windows are whole frames of the timeline: nothing in seconds is stored.
 * `false`: depends only on the current frame (no neighbouring frames).
 */
export type Temporal =
  | false
  | { kind: 'taps'; /** most pictures merged per output frame, the current one included */ maxTaps: number; pastFrames: number; futureFrames: number; /** each extra picture of a video clip has its own decode lane */ decodes: boolean }
  | { kind: 'remap'; /** furthest back (frames) the shown picture can lie behind the frame drawn */ pastFrames: number; /** with follow=music it moves on planned beats (taps.ts beatStepFrames) */ followsBeats: boolean };
export interface EffectDef<S extends z.ZodObject = z.ZodObject> {
  id: string;
  version: number;
  category: EffectCategory;
  name: { he: string; en: string };
  description: string;
  params: S;
  /**
   * filter = one compositor filter pass; layer = needs its own layer buffer pass (costlier); gpu = a WebGPU pass (ADR-0008): available only where the browser and the render worker both have a working adapter;
   * time = evaluated by the evaluator (taps or remap) and merged in exact integer arithmetic by the Canvas2D compositor; needs no graphics adapter.
   */
  cost: 'filter' | 'layer' | 'gpu' | 'time';
  temporal: Temporal;
  /** Uses seeded noise that varies per frame. */
  seeded: boolean;
}
const def = <S extends z.ZodObject>(d: EffectDef<S>) => d;
export const SEED = z.number().int().min(0).max(1_000_000).default(1);
/** Integer weights of the pictures a time effect merges add up to this (packages/engine/src/taps.ts). */
export const TAP_WEIGHT_TOTAL = 4096;

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
  def({ id: 'key.chroma', version: 1, category: 'key', name: { he: 'מסך ירוק (הסרת צבע רקע)', en: 'Chroma key (green screen)' }, description: 'Makes a background colour transparent. Needs a graphics adapter (WebGPU). Works on an evenly lit screen; hair and motion blur are not handled specially.', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ color: Color.default('#00FF00').describe('the background colour to remove'), tolerance: frac(1, 0.18, 'how far from that colour still counts as background'), softness: frac(1, 0.08, 'width of the soft edge'), spill: frac(1, 0.5, 'how strongly leftover background colour on the subject is greyed') }).strict() }),
  def({ id: 'distort.wave', version: 1, category: 'distort', name: { he: 'גל', en: 'Wave' }, description: 'Bends the picture along a sine wave that travels at `speed` waves per second (0 = still). Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ amplitude: frac(0.2, 0.01, 'how far pixels move, fraction of frame height'), wavelength: z.number().min(0.005).max(2).default(0.2).describe('length of one wave, fraction of frame height'), phase: z.number().min(-36000).max(36000).default(0).describe('degrees; 360 is one full wave'), speed: z.number().min(-10).max(10).default(0.5).describe('how many waves pass per second; 0 keeps the wave still, a negative value moves it the other way'), direction: z.enum(['horizontal', 'vertical']).default('horizontal').describe('which way pixels move') }).strict() }),
  def({ id: 'distort.bulge', version: 1, category: 'distort', name: { he: 'עדשה (ניפוח או כיווץ)', en: 'Bulge / pinch' }, description: 'Magnifies (positive amount) or pinches (negative) the picture inside a circle. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ amount: z.number().min(-0.9).max(1).default(0.5).describe('positive magnifies the centre, negative pinches it'), radius: z.number().min(0.01).max(2).default(0.35).describe('radius of the circle, fraction of frame height'), x: frac(1, 0.5, 'centre, fraction of the width'), y: frac(1, 0.5, 'centre, fraction of the height') }).strict() }),
  def({ id: 'distort.swirl', version: 1, category: 'distort', name: { he: 'מערבולת', en: 'Swirl' }, description: 'Twists the picture around a point. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ angle: z.number().min(-1080).max(1080).default(180).describe('degrees of twist at the centre'), radius: z.number().min(0.01).max(2).default(0.4).describe('radius of the twist, fraction of frame height'), x: frac(1, 0.5, 'centre, fraction of the width'), y: frac(1, 0.5, 'centre, fraction of the height') }).strict() }),
  def({ id: 'distort.mirror', version: 1, category: 'distort', name: { he: 'מראה', en: 'Mirror' }, description: 'Shows one half of the picture mirrored onto the other half. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ keep: z.enum(['left', 'right', 'top', 'bottom']).default('left').describe('the half that is kept and mirrored') }).strict() }),
  def({ id: 'blur.zoom', version: 1, category: 'blur', name: { he: 'טשטוש זום', en: 'Zoom blur' }, description: 'Blurs along lines through a point, as if zooming during the exposure. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ amount: frac(0.6, 0.15, 'length of the streaks, fraction of the distance to the centre'), x: frac(1, 0.5, 'centre, fraction of the width'), y: frac(1, 0.5, 'centre, fraction of the height') }).strict() }),
  def({ id: 'stylize.posterize', version: 1, category: 'stylize', name: { he: 'פוסטר', en: 'Posterize' }, description: 'Reduces each colour channel to a few levels. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ levels: z.number().int().min(2).max(32).default(4).describe('levels per colour channel') }).strict() }),
  def({ id: 'stylize.edges', version: 1, category: 'stylize', name: { he: 'קווי מתאר', en: 'Edges' }, description: 'Draws the outlines found in the picture, mixed over it. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ amount: frac(1, 1, '0 = the picture, 1 = outlines only'), strength: z.number().min(0.1).max(10).default(2).describe('how strongly faint outlines show') }).strict() }),
  def({ id: 'digital.glitch', version: 1, category: 'digital', name: { he: "גליץ'", en: 'Glitch' }, description: 'Horizontal bands jump sideways with split colours, in a seeded pattern that changes `speed` times per second; the same frame always looks the same. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: true,
    params: z.object({ amount: frac(0.5, 0.08, 'largest sideways jump, fraction of the width'), bands: z.number().int().min(1).max(200).default(24).describe('number of horizontal bands'), density: frac(1, 0.35, 'share of bands that jump at any moment'), split: frac(0.05, 0.004, 'colour split of jumping bands, fraction of frame height'), speed: z.number().min(0).max(60).default(12).describe('pattern changes per second; 0 freezes it'), seed: z.number().int().min(0).max(1_000_000).default(1) }).strict() }),
  def({ id: 'color.grade', version: 1, category: 'color', name: { he: 'תיקון צבע', en: 'Colour grade' }, description: 'Exposure, white balance, contrast, saturation, tinted shadows and highlights and faded blacks in one pass. The named looks are settings of this effect. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ exposure: z.number().min(-2).max(2).default(0).describe('stops; +1 doubles the brightness'), temperature: z.number().min(-1).max(1).default(0).describe('negative is cooler (blue), positive warmer (orange)'), tint: z.number().min(-1).max(1).default(0).describe('negative is greener, positive more magenta'), contrast: z.number().min(0).max(2).default(1), saturation: z.number().min(0).max(2).default(1), shadows: z.number().min(-1).max(1).default(0).describe('colour of the dark areas: positive teal, negative warm'), highlights: z.number().min(-1).max(1).default(0).describe('colour of the bright areas: positive warm, negative cool'), fade: frac(1, 0, 'lifts the blacks, like faded film') }).strict() }),
  def({ id: 'color.lut', version: 1, category: 'color', name: { he: 'טבלת צבע (LUT)', en: 'Colour table (LUT)' }, description: 'Recolours the picture through a 3D colour lookup table imported from a .cube file (upload the file to the project library; it appears there as a colour table). `lut` is the id of that library entry (get_summary lists assets of kind lut; apply_lut sets it in one step); with none chosen the picture is unchanged. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ lut: z.string().max(64).default('').describe('id of a colour table (an asset of kind lut) in this project; empty = none chosen'), intensity: frac(1, 1, '0 = the picture unchanged, 1 = the table fully applied') }).strict() }),
  def({ id: 'stylize.duotone', version: 1, category: 'stylize', name: { he: 'דו־גוון', en: 'Duotone' }, description: 'Dark areas take one colour and bright areas another. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ dark: Color.default('#1B1464').describe('colour of the dark areas'), light: Color.default('#FFD166').describe('colour of the bright areas'), amount: frac(1, 1, '0 = the picture, 1 = two colours only') }).strict() }),
  def({ id: 'stylize.halftone', version: 1, category: 'stylize', name: { he: 'נקודות דפוס', en: 'Halftone' }, description: 'Print dots on white, larger where the picture is darker. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ spacing: z.number().min(0.003).max(0.1).default(0.012).describe('distance between dots, fraction of frame height'), angle: z.number().min(-180).max(180).default(45).describe('degrees of the dot grid') }).strict() }),
  def({ id: 'stylize.scanlines', version: 1, category: 'stylize', name: { he: 'קווי סריקה', en: 'Scanlines' }, description: 'Darkens every other horizontal line, like an old screen. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ lines: z.number().int().min(20).max(1080).default(240).describe('number of lines over the frame height'), amount: frac(1, 0.35, 'how dark the dark lines are') }).strict() }),
  def({ id: 'stylize.vhs', version: 1, category: 'stylize', name: { he: 'קלטת וידאו (VHS)', en: 'VHS tape' }, description: 'Wobbling lines, colour that trails to the side, tape lines and grain, in a seeded pattern that changes `speed` times per second; the same frame always looks the same. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: true,
    params: z.object({ amount: frac(1, 0.5, 'strength'), speed: z.number().min(0).max(60).default(24).describe('pattern changes per second; 0 freezes it'), seed: z.number().int().min(0).max(1_000_000).default(1) }).strict() }),
  def({ id: 'distort.kaleidoscope', version: 1, category: 'distort', name: { he: 'קליידוסקופ', en: 'Kaleidoscope' }, description: 'Repeats one wedge of the picture around a point, mirrored. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ segments: z.number().int().min(2).max(32).default(6).describe('number of wedges'), angle: z.number().min(-360).max(360).default(0).describe('degrees; turns the pattern'), x: frac(1, 0.5, 'centre, fraction of the width'), y: frac(1, 0.5, 'centre, fraction of the height') }).strict() }),
  def({ id: 'distort.fisheye', version: 1, category: 'distort', name: { he: 'עין הדג', en: 'Fisheye' }, description: 'Curves the whole frame like a wide lens (positive) or the opposite way (negative). Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ amount: z.number().min(-0.5).max(1).default(0.4).describe('positive bulges the middle, negative pulls the corners out') }).strict() }),
  def({ id: 'blur.directional', version: 1, category: 'blur', name: { he: 'טשטוש תנועה', en: 'Motion blur' }, description: 'Blurs along one direction, as if the camera moved. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ amount: frac(0.3, 0.03, 'length of the blur, fraction of frame height'), angle: z.number().min(-180).max(180).default(0).describe('degrees; 0 is horizontal') }).strict() }),
  def({ id: 'blur.tilt-shift', version: 1, category: 'blur', name: { he: 'טילט־שיפט (מיניאטורה)', en: 'Tilt-shift' }, description: 'Keeps a horizontal band sharp and blurs above and below it, which makes scenes look like miniatures. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ position: frac(1, 0.5, 'height of the sharp band, 0 = top'), width: frac(1, 0.2, 'height of the sharp band, fraction of the frame'), amount: frac(0.1, 0.02, 'largest blur radius, fraction of frame height') }).strict() }),
  def({ id: 'light.glow', version: 1, category: 'light', name: { he: 'זוהר', en: 'Glow' }, description: 'Bright areas spill light around them. Unlike diffusion, only areas above the threshold glow. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ threshold: frac(1, 0.7, 'how bright an area must be to glow'), radius: frac(0.2, 0.03, 'reach of the glow, fraction of frame height'), amount: frac(3, 0.8, 'strength') }).strict() }),
  def({ id: 'motion.shake', version: 1, category: 'motion', name: { he: 'רעידת מצלמה', en: 'Camera shake' }, description: 'The picture shakes as if hand-held or hit: a seeded, smooth movement, the same on every render. Slightly zoomed in so no edge shows. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: true,
    params: z.object({ amount: frac(0.2, 0.02, 'how far it moves, fraction of frame height'), speed: z.number().min(0).max(30).default(8).describe('changes of direction per second'), seed: z.number().int().min(0).max(1_000_000).default(1), ...FOLLOW }).strict() }),
  def({ id: 'motion.pulse', version: 1, category: 'motion', name: { he: 'פעימת זום לפי קצב', en: 'Beat zoom pulse' }, description: 'The picture jumps a little larger on every beat and settles back. Set the tempo of the music in beats per minute; `offset` shifts where the beat falls. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ amount: frac(0.5, 0.08, 'how much larger on the beat'), bpm: z.number().min(20).max(300).default(120).describe('beats per minute'), offset: z.number().min(0).max(1).default(0).describe('shift of the beat, in beats'), decay: z.number().min(1).max(30).default(6).describe('how quickly it settles; larger is snappier'), ...FOLLOW }).strict() }),
  def({ id: 'motion.sway', version: 1, category: 'motion', name: { he: 'נדנוד עדין', en: 'Gentle sway' }, description: 'A slow tilt from side to side, like a hand-held camera. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ amount: frac(0.3, 0.04, 'strength'), speed: z.number().min(0).max(5).default(0.4).describe('sways per second') }).strict() }),
  def({ id: 'motion.spin', version: 1, category: 'motion', name: { he: 'סיבוב', en: 'Spin' }, description: 'Turns the picture steadily. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ rate: z.number().min(-720).max(720).default(90).describe('degrees per second; negative turns the other way'), zoom: z.number().min(0.2).max(4).default(1).describe('size while turning') }).strict() }),
  def({ id: 'light.leak', version: 1, category: 'light', name: { he: 'דליפת אור', en: 'Light leak' }, description: 'Soft coloured light drifts over the picture, as from a leak in an old camera. Seeded. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: true,
    params: z.object({ color: Color.default('#FF7A2F'), amount: frac(2, 0.6, 'strength'), speed: z.number().min(0).max(5).default(0.3).describe('how fast the light drifts'), seed: z.number().int().min(0).max(1_000_000).default(1) }).strict() }),
  def({ id: 'light.strobe', version: 1, category: 'light', name: { he: 'הבזקים', en: 'Strobe' }, description: 'Brief flashes, at a steady rate or on the beats of the music. All strobes on a timeline share one limit of three flash starts a second (faster flashing is a seizure risk for some viewers), so with several strobes or fast music some flashes are left out. A strobe that follows the music shows nothing where no analysed music plays. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ rate: z.number().min(0).max(3).default(2).describe('with follow=steady: flashes per second (at most 3, shared with every other strobe on the timeline)'), amount: frac(1, 0.6, 'brightness of the flash'), color: Color.default('#FFFFFF'), ...FOLLOW }).strict() }),
  def({ id: 'stylize.film', version: 1, category: 'stylize', name: { he: 'פילם ישן', en: 'Old film' }, description: 'The frame weaves, the light flickers, dust and scratches come and go, the colour fades toward brown. Seeded; the same frame always looks the same. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: true,
    params: z.object({ amount: frac(1, 0.6, 'strength'), seed: z.number().int().min(0).max(1_000_000).default(1) }).strict() }),
  def({ id: 'digital.rgb-shake', version: 1, category: 'digital', name: { he: 'רעידת צבעים', en: 'RGB shake' }, description: 'The colour channels jump apart in a direction that changes several times a second. Seeded. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: true,
    params: z.object({ amount: frac(0.1, 0.01, 'largest split, fraction of frame height'), speed: z.number().min(0).max(60).default(14).describe('changes per second'), seed: z.number().int().min(0).max(1_000_000).default(1), ...FOLLOW }).strict() }),
  def({ id: 'light.sparkle', version: 1, category: 'light', name: { he: 'נצנוצים', en: 'Sparkle' }, description: 'Bright spots send out short star-shaped streaks. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ threshold: frac(1, 0.8, 'how bright a spot must be'), length: frac(0.3, 0.04, 'length of the streaks, fraction of frame height'), amount: frac(4, 1, 'strength') }).strict() }),
  def({ id: 'time.echo', version: 1, category: 'time', name: { he: 'הד ושובל', en: 'Echo trails' }, description: 'Earlier moments of the clip are drawn together with the current one, so whatever moves (the picture, a title, a keyframed move) leaves fading copies behind. Draws `count` pictures per frame; on a video clip each is decoded separately. Always the first effect of its clip; the effects after it apply to the merged picture.', cost: 'time', temporal: { kind: 'taps', maxTaps: 5, pastFrames: 60, futureFrames: 0, decodes: true }, seeded: false,
    params: z.object({ count: z.number().int().min(2).max(5).default(4).describe('pictures merged, the current one included'), delay: z.number().int().min(1).max(15).default(3).describe('frames between two pictures'), decay: z.number().min(0.05).max(1).default(0.6).describe('weight of each older picture relative to the next newer one'), mode: z.enum(['blend', 'trail', 'lighten']).default('blend').describe('blend = weighted average; trail = the current picture over its fading past; lighten = the brightest of the weighted pictures') }).strict() }),
  def({ id: 'time.split', version: 1, category: 'time', name: { he: 'פיצול זמן צבעוני', en: 'Time-split RGB' }, description: 'Red shows this moment, green a moment ago, blue a moment before that (or the other way round): still areas look normal, moving ones leave coloured ghosts. Three pictures per frame; on a video clip each is decoded separately. Always the first effect of its clip.', cost: 'time', temporal: { kind: 'taps', maxTaps: 3, pastFrames: 30, futureFrames: 0, decodes: true }, seeded: false,
    params: z.object({ lag: z.number().int().min(1).max(15).default(4).describe('frames between the colour channels'), order: z.enum(['red-now', 'blue-now']).default('red-now') }).strict() }),
  def({ id: 'time.shutter', version: 1, category: 'time', name: { he: 'טשטוש תנועה (צמצם)', en: 'Shutter motion blur' }, description: 'Motion blur for movement made in the editor (keyframed position, size and rotation, motion presets, animated titles), sampled between frames like a camera shutter. It does not blur movement filmed in the video (no optical flow). Always the first effect of its clip.', cost: 'time', temporal: { kind: 'taps', maxTaps: 16, pastFrames: 2, futureFrames: 1, decodes: false }, seeded: false,
    params: z.object({ angle: z.number().int().min(0).max(720).default(180).describe('shutter angle in degrees; 360 spreads the samples over one whole frame'), samples: z.number().int().min(2).max(16).default(8).describe('pictures averaged per frame'), timing: z.enum(['centred', 'trailing']).default('centred') }).strict() }),
  def({ id: 'time.stutter', version: 1, category: 'time', name: { he: 'קפיצות פריים (סטופ־מושן)', en: 'Stutter / stop-motion' }, description: 'The picture moves on only every few frames, for a stop-motion or dropped-frame look; following the music it moves on (steps) or stops for a moment (freeze) on the beats, never more than three times a second. The sound is not held. Always the first effect of its clip.', cost: 'time', temporal: { kind: 'remap', pastFrames: 60, followsBeats: true }, seeded: false,
    params: z.object({ hold: z.number().int().min(2).max(12).default(3).describe('frames each picture is held'), pattern: z.enum(['steps', 'freeze']).default('steps').describe('steps = the picture moves on every `hold` frames, or on the beats; freeze = following the music, the picture stops for `hold` frames on each beat and then plays on'), motion: z.enum(['held', 'live']).default('held').describe('whether keyframed movement is held with the picture'), ...FOLLOW }).strict() }),
  def({ id: 'overlay.snow', version: 1, category: 'overlay', name: { he: 'שלג', en: 'Snow' }, description: 'Soft snowflakes fall in three depths and sway. A function of the seed and the timeline time: neighbouring clips with the same seed continue the same snow across a cut. area=frame draws over the whole frame.', cost: 'layer', temporal: false, seeded: true,
    params: z.object({ amount: frac(1, 0.9, 'opacity of the flakes'), density: frac(1, 0.5, 'share of places that hold a flake'), size: z.number().min(0.002).max(0.04).default(0.008).describe('flake radius, fraction of frame height'), speed: z.number().min(0).max(1).default(0.15).describe('frame heights per second'), wind: z.number().min(-1).max(1).default(0.1).describe('sideways drift; negative blows left'), area: z.enum(['layer', 'frame']).default('frame'), seed: SEED }).strict() }),
  def({ id: 'overlay.confetti', version: 1, category: 'overlay', name: { he: 'קונפטי', en: 'Confetti' }, description: 'Coloured confetti falling and tumbling, or one burst from a point at the start of the clip.', cost: 'layer', temporal: false, seeded: true,
    params: z.object({ amount: frac(1, 0.9, 'opacity'), density: frac(1, 0.35, 'share of places that hold a piece'), size: z.number().min(0.004).max(0.05).default(0.014).describe('piece size, fraction of frame height'), speed: z.number().min(0).max(1).default(0.2).describe('frame heights per second'), mode: z.enum(['fall', 'burst']).default('fall'), palette: z.enum(['party', 'gold', 'pastel', 'single']).default('party'), color: Color.default('#FFD166'), x: frac(1, 0.5, 'burst point, fraction of the frame width from the left'), y: frac(1, 0.85, 'burst point, fraction of the frame height from the top'), area: z.enum(['layer', 'frame']).default('frame'), seed: SEED }).strict() }),
  def({ id: 'overlay.hearts', version: 1, category: 'overlay', name: { he: 'לבבות מרחפים', en: 'Floating hearts' }, description: 'Hearts rise, wobble gently and fade near the top; following the music they swell a little on the beats.', cost: 'layer', temporal: false, seeded: true,
    params: z.object({ amount: frac(1, 0.9, 'opacity'), density: frac(1, 0.3, 'share of places that hold a heart'), size: z.number().min(0.01).max(0.1).default(0.035).describe('heart size, fraction of frame height'), speed: z.number().min(0).max(0.5).default(0.12).describe('frame heights per second'), color: Color.default('#FF4D6D'), area: z.enum(['layer', 'frame']).default('frame'), seed: SEED, ...FOLLOW }).strict() }),
  def({ id: 'overlay.bokeh', version: 1, category: 'overlay', name: { he: 'אורות בוקה', en: 'Bokeh lights' }, description: 'Large soft out-of-focus discs of light drift slowly and twinkle gently (slower than once a second).', cost: 'layer', temporal: false, seeded: true,
    params: z.object({ amount: frac(1, 0.6, 'strength of the light'), density: frac(1, 0.4, 'share of places that hold a light'), size: z.number().min(0.02).max(0.15).default(0.06).describe('disc radius, fraction of frame height'), speed: z.number().min(0).max(0.2).default(0.03).describe('frame heights per second'), shape: z.enum(['circle', 'hexagon']).default('circle'), color: Color.default('#FFD9A0'), area: z.enum(['layer', 'frame']).default('frame'), seed: SEED }).strict() }),
  def({ id: 'overlay.speed-lines', version: 1, category: 'overlay', name: { he: 'קווי מהירות', en: 'Speed lines' }, description: 'Lines streak in from the edges toward a clear centre, as in comics and anime. They move smoothly and are never re-drawn at random.', cost: 'layer', temporal: false, seeded: true,
    params: z.object({ amount: frac(1, 0.7, 'opacity'), lines: z.number().int().min(16).max(240).default(90), focus: frac(1, 0.35, 'radius of the clear centre, fraction of the half-diagonal'), reach: frac(1, 0.25, 'how far the line tips wander'), thickness: z.number().min(0.1).max(2).default(1), rate: z.number().min(0).max(2).default(1).describe('wanders per second'), x: frac(1, 0.5, 'centre, fraction of the frame width from the left'), y: frac(1, 0.5, 'centre, fraction of the frame height from the top'), color: Color.default('#FFFFFF'), seed: SEED }).strict() }),
  def({ id: 'stylize.date-stamp', version: 1, category: 'stylize', name: { he: 'חותמת תאריך', en: 'Date stamp' }, description: "An orange seven-segment date in a corner with a faint glow, like a camera of the 1990s. Digits, space and . : ' / - only; always drawn left to right. Needs no font.", cost: 'layer', temporal: false, seeded: false,
    params: z.object({ text: z.string().regex(/^[0-9 .:'\/-]{0,20}$/).default("'05 7 14").describe("digits, space and . : ' / -"), size: z.number().min(0.02).max(0.12).default(0.045).describe('digit height, fraction of frame height'), corner: z.enum(['bottom-right', 'bottom-left', 'top-right', 'top-left']).default('bottom-right'), color: Color.default('#FF9A2E'), glow: frac(1, 0.5, 'softness of the glow') }).strict() }),
  def({ id: 'stylize.digicam', version: 1, category: 'stylize', name: { he: 'מצלמה דיגיטלית ישנה', en: 'Old digicam (CCD)' }, description: 'The look of a mid-2000s pocket camera: oversharpened, highlights that bloom, a cool cast, blocky colour and fine coloured noise kept far below a flash. Seeded. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: true,
    params: z.object({ amount: frac(1, 0.8, 'strength'), sharpen: z.number().min(0).max(2).default(0.7), noise: frac(1, 0.3, 'coloured noise'), bloom: frac(1, 0.35, 'highlight bloom'), cool: z.number().min(-1).max(1).default(0.4).describe('negative is warmer'), seed: SEED }).strict() }),
  def({ id: 'stylize.crt', version: 1, category: 'stylize', name: { he: 'מסך שפופרת', en: 'CRT screen' }, description: 'An old picture-tube screen in one pass: curved glass with rounded corners, beam lines that widen in bright areas, an RGB phosphor mask and a slight glow. Does not flicker. Needs a graphics adapter (WebGPU).', cost: 'gpu', temporal: false, seeded: false,
    params: z.object({ curvature: z.number().min(0).max(0.3).default(0.12), phosphor: z.enum(['grille', 'dots', 'slot']).default('grille'), pitch: z.number().min(0.001).max(0.01).default(0.0028).describe('width of one RGB triad, fraction of frame height'), lines: z.number().int().min(120).max(1080).default(480).describe('beam lines over the frame height'), amount: frac(1, 0.8, 'strength'), glow: frac(1, 0.3, 'glow') }).strict() }),
] as const;
/** Effects that run as WebGPU passes (ADR-0008). */
export const GPU_EFFECT_IDS: readonly string[] = (EFFECTS as readonly EffectDef[]).filter((e) => e.cost === 'gpu').map((e) => e.id);
export type EffectType = (typeof EFFECTS)[number]['id'];
export const findEffect = (type: string): EffectDef | undefined => (EFFECTS as readonly EffectDef[]).find((e) => e.id === type);
/** A time effect (echo, time split, shutter, stutter): at most one per clip, always first in its effect list (ops.ts effectSlot). */
export const isTimeEffect = (type: string): boolean => findEffect(type)?.cost === 'time';
export const temporalOf = (type: string): Temporal => findEffect(type)?.temporal ?? false;
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

/**
 * `kernel` is the piece of code that draws a transition; several entries share one with different directions.
 * `gpu: true` entries are WebGPU passes over both pictures (ADR-0008) and exist only where an adapter has proved itself.
 */
export const TRANSITIONS = [
  { id: 'dissolve', kernel: 'dissolve', gpu: false, name: { he: 'מעבר רך', en: 'Cross dissolve' }, usesOutgoing: true },
  { id: 'dip-black', kernel: 'dip', gpu: false, name: { he: 'דרך שחור', en: 'Dip to black' }, usesOutgoing: true },
  { id: 'dip-white', kernel: 'dip', gpu: false, name: { he: 'דרך לבן', en: 'Dip to white' }, usesOutgoing: true },
  { id: 'wipe-left', kernel: 'wipe', gpu: false, name: { he: 'ניגוב שמאלה', en: 'Wipe left' }, usesOutgoing: true },
  { id: 'wipe-right', kernel: 'wipe', gpu: false, name: { he: 'ניגוב ימינה', en: 'Wipe right' }, usesOutgoing: true },
  { id: 'wipe-up', kernel: 'wipe', gpu: false, name: { he: 'ניגוב למעלה', en: 'Wipe up' }, usesOutgoing: true },
  { id: 'wipe-down', kernel: 'wipe', gpu: false, name: { he: 'ניגוב למטה', en: 'Wipe down' }, usesOutgoing: true },
  { id: 'push-left', kernel: 'push', gpu: false, name: { he: 'דחיפה שמאלה', en: 'Push left' }, usesOutgoing: true },
  { id: 'push-right', kernel: 'push', gpu: false, name: { he: 'דחיפה ימינה', en: 'Push right' }, usesOutgoing: true },
  { id: 'push-up', kernel: 'push', gpu: false, name: { he: 'דחיפה למעלה', en: 'Push up' }, usesOutgoing: true },
  { id: 'push-down', kernel: 'push', gpu: false, name: { he: 'דחיפה למטה', en: 'Push down' }, usesOutgoing: true },
  { id: 'zoom', kernel: 'zoom', gpu: false, name: { he: 'זום', en: 'Zoom in' }, usesOutgoing: true },
  { id: 'cross-zoom-in', kernel: 'cross-zoom', gpu: true, name: { he: "זום מטושטש פנימה", en: 'Cross zoom in' }, usesOutgoing: true },
  { id: 'cross-zoom-out', kernel: 'cross-zoom', gpu: true, name: { he: "זום מטושטש החוצה", en: 'Cross zoom out' }, usesOutgoing: true },
  { id: 'swirl-cw', kernel: 'swirl', gpu: true, name: { he: "מערבולת עם השעון", en: 'Swirl clockwise' }, usesOutgoing: true },
  { id: 'swirl-ccw', kernel: 'swirl', gpu: true, name: { he: "מערבולת נגד השעון", en: 'Swirl counter-clockwise' }, usesOutgoing: true },
  { id: 'wave-h', kernel: 'wave', gpu: true, name: { he: "גל אופקי", en: 'Wave sideways' }, usesOutgoing: true },
  { id: 'wave-v', kernel: 'wave', gpu: true, name: { he: "גל אנכי", en: 'Wave up and down' }, usesOutgoing: true },
  { id: 'glitch-cut', kernel: 'glitch', gpu: true, name: { he: "גליץ'", en: 'Glitch' }, usesOutgoing: true },
  { id: 'pixelate', kernel: 'pixelate', gpu: true, name: { he: "פיקסלים", en: 'Pixelate' }, usesOutgoing: true },
  { id: 'clock-cw', kernel: 'clock', gpu: true, name: { he: "שעון", en: 'Clock wipe' }, usesOutgoing: true },
  { id: 'clock-ccw', kernel: 'clock', gpu: true, name: { he: "שעון הפוך", en: 'Clock wipe, reversed' }, usesOutgoing: true },
  { id: 'soft-wipe-right', kernel: 'soft-wipe', gpu: true, name: { he: "ניגוב רך ימינה", en: 'Soft wipe right' }, usesOutgoing: true },
  { id: 'soft-wipe-left', kernel: 'soft-wipe', gpu: true, name: { he: "ניגוב רך שמאלה", en: 'Soft wipe left' }, usesOutgoing: true },
  { id: 'soft-wipe-down', kernel: 'soft-wipe', gpu: true, name: { he: "ניגוב רך למטה", en: 'Soft wipe down' }, usesOutgoing: true },
  { id: 'soft-wipe-up', kernel: 'soft-wipe', gpu: true, name: { he: "ניגוב רך למעלה", en: 'Soft wipe up' }, usesOutgoing: true },
  { id: 'soft-wipe-down-right', kernel: 'soft-wipe', gpu: true, name: { he: "ניגוב רך אלכסוני ימינה־מטה", en: 'Soft wipe to the lower right' }, usesOutgoing: true },
  { id: 'soft-wipe-down-left', kernel: 'soft-wipe', gpu: true, name: { he: "ניגוב רך אלכסוני שמאלה־מטה", en: 'Soft wipe to the lower left' }, usesOutgoing: true },
  { id: 'soft-wipe-up-right', kernel: 'soft-wipe', gpu: true, name: { he: "ניגוב רך אלכסוני ימינה־מעלה", en: 'Soft wipe to the upper right' }, usesOutgoing: true },
  { id: 'soft-wipe-up-left', kernel: 'soft-wipe', gpu: true, name: { he: "ניגוב רך אלכסוני שמאלה־מעלה", en: 'Soft wipe to the upper left' }, usesOutgoing: true },
  { id: 'blinds-h', kernel: 'blinds', gpu: true, name: { he: "תריסים אופקיים", en: 'Horizontal blinds' }, usesOutgoing: true },
  { id: 'blinds-v', kernel: 'blinds', gpu: true, name: { he: "תריסים אנכיים", en: 'Vertical blinds' }, usesOutgoing: true },
  { id: 'iris-open', kernel: 'iris', gpu: true, name: { he: "עיגול נפתח", en: 'Iris open' }, usesOutgoing: true },
  { id: 'iris-close', kernel: 'iris', gpu: true, name: { he: "עיגול נסגר", en: 'Iris close' }, usesOutgoing: true },
  { id: 'diamond-open', kernel: 'diamond', gpu: true, name: { he: "מעוין נפתח", en: 'Diamond open' }, usesOutgoing: true },
  { id: 'diamond-close', kernel: 'diamond', gpu: true, name: { he: "מעוין נסגר", en: 'Diamond close' }, usesOutgoing: true },
  { id: 'flash', kernel: 'flash', gpu: true, name: { he: "הבזק", en: 'Flash' }, usesOutgoing: true },
  { id: 'luma-bright', kernel: 'luma', gpu: true, name: { he: "התמוססות מהבהיר", en: 'Luma fade, bright first' }, usesOutgoing: true },
  { id: 'luma-dark', kernel: 'luma', gpu: true, name: { he: "התמוססות מהכהה", en: 'Luma fade, dark first' }, usesOutgoing: true },
  { id: 'squeeze-h', kernel: 'squeeze', gpu: true, name: { he: "כיווץ אופקי", en: 'Squeeze sideways' }, usesOutgoing: true },
  { id: 'squeeze-v', kernel: 'squeeze', gpu: true, name: { he: "כיווץ אנכי", en: 'Squeeze vertically' }, usesOutgoing: true },
  { id: 'checker', kernel: 'checker', gpu: true, name: { he: "לוח שחמט", en: 'Checkerboard' }, usesOutgoing: true },
  { id: 'bars-h', kernel: 'bars', gpu: true, name: { he: "פסים אקראיים אופקיים", en: 'Random horizontal bars' }, usesOutgoing: true },
  { id: 'bars-v', kernel: 'bars', gpu: true, name: { he: "פסים אקראיים אנכיים", en: 'Random vertical bars' }, usesOutgoing: true },
  { id: 'ripple', kernel: 'ripple', gpu: true, name: { he: "אדווה", en: 'Ripple' }, usesOutgoing: true },
  { id: 'whip-left', kernel: 'whip', gpu: true, name: { he: 'הצלפה שמאלה', en: 'Whip pan left' }, usesOutgoing: true },
  { id: 'whip-right', kernel: 'whip', gpu: true, name: { he: 'הצלפה ימינה', en: 'Whip pan right' }, usesOutgoing: true },
  { id: 'whip-up', kernel: 'whip', gpu: true, name: { he: 'הצלפה למעלה', en: 'Whip pan up' }, usesOutgoing: true },
  { id: 'whip-down', kernel: 'whip', gpu: true, name: { he: 'הצלפה למטה', en: 'Whip pan down' }, usesOutgoing: true },
  { id: 'spin-cw', kernel: 'spin', gpu: true, name: { he: 'סיבוב מהיר עם השעון', en: 'Spin clockwise' }, usesOutgoing: true },
  { id: 'spin-ccw', kernel: 'spin', gpu: true, name: { he: 'סיבוב מהיר נגד השעון', en: 'Spin counter-clockwise' }, usesOutgoing: true },
] as const;
export const TRANSITION_IDS = TRANSITIONS.map((t) => t.id) as [TransitionType, ...TransitionType[]];
/** Transitions that run as WebGPU passes (ADR-0008). */
export const GPU_TRANSITION_IDS: readonly string[] = TRANSITIONS.filter((t) => t.gpu).map((t) => t.id);
export type TransitionType = (typeof TRANSITIONS)[number]['id'];
/** A transition plays over the FIRST `frames` of the clip that carries it; the previous clip on the track keeps playing underneath from its source handle. */
export const TransitionSchema = z.object({ type: z.enum(TRANSITION_IDS), frames: z.number().int().min(1).max(150) }).strict();
export type Transition = z.infer<typeof TransitionSchema>;

/** Same shape as a transform keyframe (schema.ts); repeated here because schema.ts imports this file. */
const EffectKeySchema = z.object({ time: z.object({ value: z.string().regex(/^-?\d+$/), timescale: z.number().int().positive() }).strict(), value: z.number(), easing: z.enum(['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out']) }).strict();
/** A beat modulator on one numeric parameter of an effect instance: value = clamp(base + depth·e^(−decay·seconds since the hit)). */
export const ModulatorSchema = z.object({
  by: z.literal('beat'),
  every: z.number().int().min(1).max(16).default(2), // 2: at most one kick per two beats by default (ADR-0009 decision 3: safe at defaults on fast music)
  depth: z.number().min(-1e6).max(1e6),
  decay: z.number().min(1).max(30).default(6),
}).strict();
export type Modulator = z.infer<typeof ModulatorSchema>;
export const EffectInstanceSchema = z
  .object({
    id: z.string().min(1).max(64), type: z.string().min(1).max(48), enabled: z.boolean(), params: z.record(z.string(), z.union([z.number(), z.string().max(64), z.boolean()])),
    /** Animation of numeric parameters: clip-local times, strictly increasing. A parameter with keys ignores its static value. */
    keyframes: z.record(z.string(), z.array(EffectKeySchema).min(1).max(500)).optional(),
    /** Parameters that kick on the beats of the music under the clip (render-time; nothing computed is stored). At most 4. */
    modulate: z.record(z.string().max(48), ModulatorSchema).refine((m) => Object.keys(m).length <= 4, 'at most 4 modulated parameters').optional(),
  })
  .strict();
/**
 * Numeric parameters that must keep one value for the whole clip, per effect type: no keyframes are accepted for them, and
 * keys that a document carries anyway are not used (animation.ts).
 * The strobe: its flashes are at most three a second only while nothing about them changes over time. A rate that changes
 * moves the flash times closer together, and a brightness that changes is itself a flash.
 */
export const NOT_ANIMATABLE: Readonly<Record<string, readonly string[]>> = {
  'light.strobe': ['rate', 'amount', 'every'],
  // windows and counts of time effects are whole numbers that define which pictures are read; interpolating them would read fractional frames
  'time.echo': ['count', 'delay'], 'time.split': ['lag'], 'time.shutter': ['angle', 'samples'], 'time.stutter': ['hold', 'every'],
  'overlay.speed-lines': ['lines'],
};
/** Names of an effect's parameters that are numbers and can therefore be animated. */
export function animatableParams(type: string): string[] {
  const d = findEffect(type);
  if (!d) return [];
  const defaults = d.params.parse({}) as Record<string, unknown>;
  return Object.keys(defaults).filter((k) => typeof defaults[k] === 'number' && k !== 'seed' && !NOT_ANIMATABLE[type]?.includes(k));
}
export type EffectInstance = z.infer<typeof EffectInstanceSchema>;
/**
 * Parameters that may follow the beat (default-deny). Geometry and texture only: a beat-driven change of brightness or colour
 * is a flash and must join the flash schedule first (wave 2, ADR-0009).
 */
export const MODULATABLE: Readonly<Record<string, readonly string[]>> = {
  'blur.gaussian': ['radius'], 'blur.zoom': ['amount'], 'blur.directional': ['amount'],
  'distort.bulge': ['amount', 'radius'], 'distort.swirl': ['angle'], 'distort.wave': ['amplitude'], 'distort.fisheye': ['amount'], 'distort.kaleidoscope': ['angle'],
  'digital.rgb-split': ['amount'], 'digital.glitch': ['amount'], 'digital.rgb-shake': ['amount'],
  'stylize.pixelate': ['size'], 'motion.shake': ['amount'], 'motion.sway': ['amount'],
};
/** The parameters of an effect type that a beat modulator may drive (set_effect_modulator, list_catalog → effects[].modulatable). */
export const modulatableParams = (type: string): string[] => (MODULATABLE[type] ?? []).filter((p) => animatableParams(type).includes(p));
const ranges = new Map<string, Record<string, { min: number; max: number }>>();
/** The declared numeric range of a parameter (from its zod schema), or null. */
export function paramRange(type: string, param: string): { min: number; max: number } | null {
  let r = ranges.get(type);
  if (!r) {
    const d = findEffect(type);
    if (!d) return null;
    const props = (z.toJSONSchema(d.params) as { properties: Record<string, { type?: string; minimum?: number; maximum?: number }> }).properties;
    r = Object.fromEntries(Object.entries(props).filter(([, p]) => (p.type === 'number' || p.type === 'integer') && p.minimum !== undefined && p.maximum !== undefined).map(([k, p]) => [k, { min: p.minimum!, max: p.maximum! }]));
    ranges.set(type, r);
  }
  return Object.hasOwn(r, param) ? r[param]! : null;
}

/** Discovery payload for REST/MCP/Lab: everything registered, with JSON Schemas and defaults. */
export function describeCatalog() {
  return {
    effects: (EFFECTS as readonly EffectDef[]).map((e) => ({
      id: e.id, version: e.version, category: e.category, name: e.name, description: e.description, cost: e.cost, seeded: e.seeded, temporal: e.temporal,
      implementation: e.cost === 'gpu' ? 'webgpu pass (needs a graphics adapter)' : e.cost === 'time' ? 'evaluator time taps + canvas2d (no graphics adapter)' : 'canvas2d',
      modulatable: modulatableParams(e.id),
      defaults: e.params.parse({}), paramsSchema: z.toJSONSchema(e.params),
    })),
    transitions: TRANSITIONS.map((t) => ({ ...t, version: 1, implementation: t.gpu ? 'webgpu pass (needs a graphics adapter)' : 'canvas2d', audio: 'unchanged (hard cut)' })),
    blendModes: [...BLEND_MODES],
    mask: { shapes: ['rect', 'ellipse'], defaults: DEFAULT_MASK, paramsSchema: z.toJSONSchema(MaskSchema) },
  };
}
