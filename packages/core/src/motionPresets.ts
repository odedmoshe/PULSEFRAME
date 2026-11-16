/**
 * Clip motion presets: entrances, exits, loops and whole-clip moves. Pure and deterministic.
 * `motionKeys` turns a preset into per-property keyframes in whole clip-local frames; a caller converts
 * them to ordinary keyframes. Nothing here touches project state.
 *
 * Each preset is a normalised spec: per property a list of [t, v, easing] with t in 0..1 (position inside the
 * motion's span) and v relative to the clip's resting transform: x/y/rotation ADD v, scale/opacity MULTIPLY by v.
 * `amount` scales the deviation from rest (0 = no motion, 1 = as designed, 2 = twice as strong) for every kind.
 * Direction naming: in-presets slide-left/right/up/down enter FROM that side (up = from below);
 * out-presets leave TOWARD that side. Pan presets move the picture toward that side.
 */

export type MotionKind = 'in' | 'out' | 'loop' | 'move';
export type MotionProperty = 'x' | 'y' | 'scale' | 'rotation' | 'opacity';
export type MotionEasing = 'linear' | 'hold' | 'ease-in' | 'ease-out' | 'ease-in-out';
export interface MotionKey { frame: number; value: number; easing: MotionEasing }
export interface MotionPreset {
  id: string;
  kind: MotionKind;
  name: { he: string; en: string };
  /** in/out: default length in frames; loop: default period in frames; move: 0 (spans the whole clip) */
  defaultFrames: number;
  properties: readonly MotionProperty[];
}
export interface MotionContext {
  /** clip length in whole frames, >= 2 */
  totalFrames: number;
  /** in/out length or loop period; default = preset.defaultFrames */
  frames?: number;
  /** the clip's resting transform */
  rest: { x: number; y: number; scale: number; rotation: number; opacity: number };
  /** 0..2, default 1: how strong the move is */
  amount?: number;
}

type K = readonly [t: number, v: number, easing?: MotionEasing];
type Spec = Partial<Record<MotionProperty, readonly K[]>>;
interface Def {
  id: string;
  kind: MotionKind;
  he: string;
  en: string;
  frames: number;
  spec: Spec;
  /** loop only: properties that keep progressing every period (e.g. a full turn per period) */
  cumulative?: readonly MotionProperty[];
}

const EO = 'ease-out' as const;
const EI = 'ease-in' as const;
const EIO = 'ease-in-out' as const;
const HOLD = 'hold' as const;

/** Fixed integer hash -> -1..1. Used for shake so the output never depends on randomness. */
function hash(i: number): number {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(i + 7, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  return ((h >>> 0) % 2001) / 1000 - 1;
}
function shakeSpec(): Spec {
  const steps = 6;
  const xs: K[] = [[0, 0]];
  const ys: K[] = [[0, 0]];
  for (let j = 1; j < steps; j++) {
    xs.push([j / steps, 0.012 * hash(j)]);
    ys.push([j / steps, 0.012 * hash(j + 100)]);
  }
  xs.push([1, 0]);
  ys.push([1, 0]);
  return { x: xs, y: ys };
}

const FADE_IN: readonly K[] = [[0, 0], [1, 1]];
const FADE_OUT: readonly K[] = [[0, 1], [1, 0]];
const FADE_IN_EARLY: readonly K[] = [[0, 0], [0.4, 1], [1, 1]];
const FADE_OUT_LATE: readonly K[] = [[0, 1], [0.6, 1], [1, 0]];
const PAN_SCALE: readonly K[] = [[0, 1.12], [1, 1.12]];

const DEFS: readonly Def[] = [
  // ---- entrances ----
  { id: 'motion.in.fade', kind: 'in', he: 'דהייה פנימה', en: 'Fade in', frames: 15, spec: { opacity: FADE_IN } },
  { id: 'motion.in.zoom-in', kind: 'in', he: 'זום פנימה', en: 'Zoom in', frames: 18, spec: { scale: [[0, 0.6, EO], [1, 1]], opacity: FADE_IN_EARLY } },
  { id: 'motion.in.zoom-out', kind: 'in', he: 'זום החוצה', en: 'Zoom out', frames: 18, spec: { scale: [[0, 1.5, EO], [1, 1]], opacity: FADE_IN_EARLY } },
  { id: 'motion.in.pop', kind: 'in', he: 'קפיצה', en: 'Pop', frames: 18, spec: { scale: [[0, 0.6, EO], [0.6, 1.12, EIO], [1, 1]], opacity: [[0, 0], [0.3, 1], [1, 1]] } },
  { id: 'motion.in.elastic', kind: 'in', he: 'אלסטי', en: 'Elastic', frames: 30, spec: { scale: [[0, 0.5, EO], [0.3, 1.15, EIO], [0.55, 0.94, EIO], [0.8, 1.04, EIO], [1, 1]], opacity: [[0, 0], [0.2, 1], [1, 1]] } },
  { id: 'motion.in.bounce-drop', kind: 'in', he: 'נפילה מקפצת', en: 'Bounce drop', frames: 36, spec: { y: [[0, -0.6, EI], [0.5, 0, EO], [0.7, -0.15, EI], [0.85, 0, EO], [0.93, -0.04, EI], [1, 0]], opacity: [[0, 0], [0.1, 1], [1, 1]] } },
  { id: 'motion.in.drop', kind: 'in', he: 'צנחה', en: 'Drop', frames: 18, spec: { y: [[0, -0.3, EO], [1, 0]], opacity: FADE_IN } },
  { id: 'motion.in.rise', kind: 'in', he: 'עלייה', en: 'Rise', frames: 18, spec: { y: [[0, 0.3, EO], [1, 0]], opacity: FADE_IN } },
  { id: 'motion.in.slide-left', kind: 'in', he: 'החלקה משמאל', en: 'Slide from left', frames: 18, spec: { x: [[0, -0.4, EO], [1, 0]], opacity: FADE_IN_EARLY } },
  { id: 'motion.in.slide-right', kind: 'in', he: 'החלקה מימין', en: 'Slide from right', frames: 18, spec: { x: [[0, 0.4, EO], [1, 0]], opacity: FADE_IN_EARLY } },
  { id: 'motion.in.slide-up', kind: 'in', he: 'החלקה מלמטה', en: 'Slide up', frames: 18, spec: { y: [[0, 0.4, EO], [1, 0]], opacity: FADE_IN_EARLY } },
  { id: 'motion.in.slide-down', kind: 'in', he: 'החלקה מלמעלה', en: 'Slide down', frames: 18, spec: { y: [[0, -0.4, EO], [1, 0]], opacity: FADE_IN_EARLY } },
  { id: 'motion.in.whip-left', kind: 'in', he: 'הצלפה משמאל', en: 'Whip from left', frames: 12, spec: { x: [[0, -1, EO], [0.75, 0.04, EIO], [1, 0]], opacity: [[0, 0], [0.3, 1], [1, 1]] } },
  { id: 'motion.in.whip-right', kind: 'in', he: 'הצלפה מימין', en: 'Whip from right', frames: 12, spec: { x: [[0, 1, EO], [0.75, -0.04, EIO], [1, 0]], opacity: [[0, 0], [0.3, 1], [1, 1]] } },
  { id: 'motion.in.spin', kind: 'in', he: 'סיבוב', en: 'Spin', frames: 24, spec: { rotation: [[0, -180, EO], [1, 0]], scale: [[0, 0.3, EO], [1, 1]], opacity: [[0, 0], [0.5, 1], [1, 1]] } },
  { id: 'motion.in.roll-left', kind: 'in', he: 'גלגול משמאל', en: 'Roll in from left', frames: 24, spec: { x: [[0, -0.5, EO], [1, 0]], rotation: [[0, -120, EO], [1, 0]], opacity: FADE_IN_EARLY } },
  { id: 'motion.in.roll-right', kind: 'in', he: 'גלגול מימין', en: 'Roll in from right', frames: 24, spec: { x: [[0, 0.5, EO], [1, 0]], rotation: [[0, 120, EO], [1, 0]], opacity: FADE_IN_EARLY } },
  { id: 'motion.in.swing', kind: 'in', he: 'נדנוד', en: 'Swing', frames: 30, spec: { rotation: [[0, 25, EIO], [0.25, -18, EIO], [0.5, 12, EIO], [0.72, -6, EIO], [0.88, 2, EIO], [1, 0]], opacity: [[0, 0], [0.15, 1], [1, 1]] } },
  { id: 'motion.in.stretch', kind: 'in', he: 'מתיחה', en: 'Stretch', frames: 24, spec: { scale: [[0, 0, EO], [0.55, 1.2, EIO], [0.8, 0.95, EIO], [1, 1]], opacity: [[0, 0], [0.2, 1], [1, 1]] } },

  // ---- exits ----
  { id: 'motion.out.fade', kind: 'out', he: 'דהייה החוצה', en: 'Fade out', frames: 15, spec: { opacity: FADE_OUT } },
  { id: 'motion.out.zoom-out', kind: 'out', he: 'כיווץ', en: 'Zoom out', frames: 18, spec: { scale: [[0, 1, EI], [1, 0.6]], opacity: FADE_OUT_LATE } },
  { id: 'motion.out.zoom-in', kind: 'out', he: 'הגדלה', en: 'Zoom in', frames: 18, spec: { scale: [[0, 1, EI], [1, 1.5]], opacity: FADE_OUT } },
  { id: 'motion.out.slide-left', kind: 'out', he: 'החלקה שמאלה', en: 'Slide left', frames: 18, spec: { x: [[0, 0, EI], [1, -0.4]], opacity: FADE_OUT_LATE } },
  { id: 'motion.out.slide-right', kind: 'out', he: 'החלקה ימינה', en: 'Slide right', frames: 18, spec: { x: [[0, 0, EI], [1, 0.4]], opacity: FADE_OUT_LATE } },
  { id: 'motion.out.slide-up', kind: 'out', he: 'החלקה למעלה', en: 'Slide up', frames: 18, spec: { y: [[0, 0, EI], [1, -0.4]], opacity: FADE_OUT_LATE } },
  { id: 'motion.out.slide-down', kind: 'out', he: 'החלקה למטה', en: 'Slide down', frames: 18, spec: { y: [[0, 0, EI], [1, 0.4]], opacity: FADE_OUT_LATE } },
  { id: 'motion.out.drop', kind: 'out', he: 'צנחה', en: 'Drop', frames: 18, spec: { y: [[0, 0, EI], [1, 0.3]], opacity: FADE_OUT } },
  { id: 'motion.out.rise', kind: 'out', he: 'עלייה', en: 'Rise', frames: 18, spec: { y: [[0, 0, EI], [1, -0.3]], opacity: FADE_OUT } },
  { id: 'motion.out.spin', kind: 'out', he: 'סיבוב', en: 'Spin', frames: 24, spec: { rotation: [[0, 0, EI], [1, 180]], scale: [[0, 1, EI], [1, 0.3]], opacity: [[0, 1], [0.5, 1], [1, 0]] } },
  { id: 'motion.out.whip-left', kind: 'out', he: 'הצלפה שמאלה', en: 'Whip left', frames: 12, spec: { x: [[0, 0, EIO], [0.2, 0.04, EI], [1, -1]], opacity: [[0, 1], [0.7, 1], [1, 0]] } },
  { id: 'motion.out.whip-right', kind: 'out', he: 'הצלפה ימינה', en: 'Whip right', frames: 12, spec: { x: [[0, 0, EIO], [0.2, -0.04, EI], [1, 1]], opacity: [[0, 1], [0.7, 1], [1, 0]] } },
  { id: 'motion.out.shrink-pop', kind: 'out', he: 'קפיצה וכיווץ', en: 'Shrink pop', frames: 18, spec: { scale: [[0, 1, EO], [0.25, 1.12, EI], [1, 0]], opacity: [[0, 1], [0.7, 1], [1, 0]] } },

  // ---- loops (first key = rest; value repeats every period) ----
  { id: 'motion.loop.pulse', kind: 'loop', he: 'דופק', en: 'Pulse', frames: 30, spec: { scale: [[0, 1, EIO], [0.5, 1.04, EIO], [1, 1]] } },
  { id: 'motion.loop.breathe', kind: 'loop', he: 'נשימה', en: 'Breathe', frames: 120, spec: { scale: [[0, 1, EIO], [0.5, 1.02, EIO], [1, 1]] } },
  { id: 'motion.loop.float', kind: 'loop', he: 'ציפה', en: 'Float', frames: 90, spec: { y: [[0, 0, EIO], [0.5, -0.015, EIO], [1, 0]] } },
  { id: 'motion.loop.sway', kind: 'loop', he: 'התנדנדות', en: 'Sway', frames: 60, spec: { rotation: [[0, 0, EIO], [0.25, 3, EIO], [0.75, -3, EIO], [1, 0]] } },
  { id: 'motion.loop.wobble', kind: 'loop', he: 'התנודדות', en: 'Wobble', frames: 36, spec: { rotation: [[0, 0, EIO], [0.25, 4, EIO], [0.75, -4, EIO], [1, 0]], x: [[0, 0, EIO], [0.25, 0.01, EIO], [0.75, -0.01, EIO], [1, 0]] } },
  { id: 'motion.loop.shake', kind: 'loop', he: 'רעידה', en: 'Shake', frames: 8, spec: shakeSpec() },
  { id: 'motion.loop.heartbeat', kind: 'loop', he: 'פעימות לב', en: 'Heartbeat', frames: 45, spec: { scale: [[0, 1, EO], [0.12, 1.06, EI], [0.24, 1, EO], [0.36, 1.08, EI], [0.5, 1, EIO], [1, 1]] } },
  { id: 'motion.loop.spin', kind: 'loop', he: 'סיבוב', en: 'Spin', frames: 90, spec: { rotation: [[0, 0], [1, 360]] }, cumulative: ['rotation'] },
  { id: 'motion.loop.pendulum', kind: 'loop', he: 'מטוטלת', en: 'Pendulum', frames: 60, spec: { rotation: [[0, 0, EO], [0.25, 15, EIO], [0.75, -15, EIO], [1, 0, EI]], x: [[0, 0, EO], [0.25, 0.02, EIO], [0.75, -0.02, EIO], [1, 0, EI]] } },
  { id: 'motion.loop.bounce', kind: 'loop', he: 'קפיצה', en: 'Bounce', frames: 24, spec: { y: [[0, 0, EO], [0.5, -0.06, EI], [1, 0]] } },
  { id: 'motion.loop.flicker', kind: 'loop', he: 'הבהוב', en: 'Flicker', frames: 24, spec: { opacity: [[0, 1, HOLD], [0.1, 0.4, HOLD], [0.15, 1, HOLD], [0.6, 1, HOLD], [0.65, 0.6, HOLD], [0.7, 1, HOLD], [1, 1]] } },
  { id: 'motion.loop.fade-pulse', kind: 'loop', he: 'פעימת שקיפות', en: 'Opacity pulse', frames: 60, spec: { opacity: [[0, 1, EIO], [0.5, 0.8, EIO], [1, 1]] } },
  { id: 'motion.loop.drift', kind: 'loop', he: 'סחף', en: 'Drift', frames: 120, spec: { x: [[0, 0, EIO], [0.5, 0.015, EIO], [1, 0]] } },

  // ---- whole-clip moves ----
  { id: 'motion.move.ken-burns-in', kind: 'move', he: 'קן ברנס פנימה', en: 'Ken Burns in', frames: 0, spec: { scale: [[0, 1, EIO], [1, 1.18]] } },
  { id: 'motion.move.ken-burns-out', kind: 'move', he: 'קן ברנס החוצה', en: 'Ken Burns out', frames: 0, spec: { scale: [[0, 1.18, EIO], [1, 1]] } },
  { id: 'motion.move.pan-left', kind: 'move', he: 'פנורמה שמאלה', en: 'Pan left', frames: 0, spec: { scale: PAN_SCALE, x: [[0, 0.04, EIO], [1, -0.04]] } },
  { id: 'motion.move.pan-right', kind: 'move', he: 'פנורמה ימינה', en: 'Pan right', frames: 0, spec: { scale: PAN_SCALE, x: [[0, -0.04, EIO], [1, 0.04]] } },
  { id: 'motion.move.pan-up', kind: 'move', he: 'פנורמה למעלה', en: 'Pan up', frames: 0, spec: { scale: PAN_SCALE, y: [[0, 0.04, EIO], [1, -0.04]] } },
  { id: 'motion.move.pan-down', kind: 'move', he: 'פנורמה למטה', en: 'Pan down', frames: 0, spec: { scale: PAN_SCALE, y: [[0, -0.04, EIO], [1, 0.04]] } },
  { id: 'motion.move.push-in-tilt', kind: 'move', he: 'התקרבות עם הטיה', en: 'Push in with tilt', frames: 0, spec: { scale: [[0, 1, EIO], [1, 1.12]], rotation: [[0, 0, EIO], [1, 2]] } },
  { id: 'motion.move.pull-back-tilt', kind: 'move', he: 'התרחקות עם הטיה', en: 'Pull back with tilt', frames: 0, spec: { scale: [[0, 1.12, EIO], [1, 1]], rotation: [[0, 2, EIO], [1, 0]] } },
];

const PROP_ORDER: readonly MotionProperty[] = ['x', 'y', 'scale', 'rotation', 'opacity'];
const BY_ID = new Map<string, Def>(DEFS.map((d) => [d.id, d]));

export const MOTION_PRESETS: readonly MotionPreset[] = DEFS.map((d) => ({
  id: d.id,
  kind: d.kind,
  name: { he: d.he, en: d.en },
  defaultFrames: d.kind === 'move' ? 0 : d.frames,
  properties: PROP_ORDER.filter((p) => d.spec[p] !== undefined),
}));

const RANGE: Record<MotionProperty, readonly [number, number]> = {
  x: [-4, 4],
  y: [-4, 4],
  scale: [0.01, 20],
  rotation: [-3600, 3600],
  opacity: [0, 1],
};
const ADDITIVE: Record<MotionProperty, boolean> = { x: true, y: true, rotation: true, scale: false, opacity: false };

function clamp(p: MotionProperty, v: number): number {
  const [lo, hi] = RANGE[p];
  if (!Number.isFinite(v)) return p === 'scale' ? 1 : p === 'opacity' ? 1 : 0;
  return Math.min(hi, Math.max(lo, v));
}

const EASE: Record<MotionEasing, (u: number) => number> = {
  linear: (u) => u,
  hold: () => 0,
  'ease-in': (u) => u * u * u,
  'ease-out': (u) => 1 - (1 - u) ** 3,
  'ease-in-out': (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2),
};

/**
 * Drop keys that land on an already used frame (rounding on short spans). The first key is always kept;
 * the final key wins over a middle key on the same frame so the span's end value is preserved.
 */
function dedupe(raw: MotionKey[]): MotionKey[] {
  const out: MotionKey[] = [];
  raw.forEach((k, i) => {
    const prev = out[out.length - 1];
    if (prev && k.frame <= prev.frame) {
      if (i === raw.length - 1 && out.length >= 2) out[out.length - 1] = k;
      return;
    }
    out.push(k);
  });
  return out;
}

export function motionKeys(presetId: string, ctx: MotionContext): Partial<Record<MotionProperty, MotionKey[]>> {
  const def = BY_ID.get(presetId);
  if (!def) throw new Error(`unknown motion preset: ${presetId}`);
  const total = Math.max(2, Math.floor(ctx.totalFrames));
  const amt = ctx.amount === undefined || !Number.isFinite(ctx.amount) ? 1 : Math.min(2, Math.max(0, ctx.amount));
  const req = ctx.frames !== undefined && Number.isFinite(ctx.frames) ? Math.floor(ctx.frames) : def.frames;
  const result: Partial<Record<MotionProperty, MotionKey[]>> = {};

  for (const prop of PROP_ORDER) {
    const spec = def.spec[prop];
    if (!spec) continue;
    const rest = ctx.rest[prop];
    const value = (v: number, extra = 0): number => clamp(prop, ADDITIVE[prop] ? rest + (v + extra) * amt : rest * (1 + (v + extra - 1) * amt));
    const mk = (frame: number, v: number, e: MotionEasing | undefined, extra = 0): MotionKey => ({ frame, value: value(v, extra), easing: e ?? 'linear' });

    if (def.kind === 'loop') {
      const p = Math.max(1, req);
      const cycles = Math.ceil(total / p);
      const cumulative = def.cumulative?.includes(prop) === true;
      const span = cumulative ? spec[spec.length - 1]![1] - spec[0]![1] : 0;
      const raw: MotionKey[] = [];
      for (let c = 0; c < cycles; c++) {
        spec.forEach(([t, v, e], j) => {
          if (c > 0 && j === 0) return;
          raw.push(mk(c * p + Math.round(t * p), v, e, cumulative ? c * span : 0));
        });
      }
      const all = dedupe(raw);
      const keys = all.filter((k) => k.frame <= total);
      const last = keys[keys.length - 1]!;
      if (last.frame < total) {
        const next = all[keys.length];
        let v = last.value;
        if (next) v = last.value + (next.value - last.value) * EASE[last.easing]((total - last.frame) / (next.frame - last.frame));
        keys.push({ frame: total, value: clamp(prop, v), easing: 'linear' });
      }
      result[prop] = keys;
      continue;
    }

    const n = def.kind === 'move' ? total : Math.max(1, Math.min(total, Number.isFinite(req) ? req : def.frames));
    const base = def.kind === 'out' ? total - n : 0;
    result[prop] = dedupe(spec.map(([t, v, e]) => mk(base + Math.round(t * n), v, e)));
  }
  return result;
}
