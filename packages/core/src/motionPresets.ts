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
  /** loop only: properties that keep progressing every period (e.g. a full turn per period); a rotation that does so keeps turning for any clip length (see wrapTurns) */
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

/**
 * A rotation that keeps adding turns (loop.spin) would pass the largest rotation a key may hold (±3600°) after ten turns.
 * An angle a whole number of turns away is the same angle, so the keys restart from the equivalent angle between 0° and 360°
 * just before they would leave the range. Two keys cannot share a frame, and a segment from an angle to its equivalent would
 * spin backwards, so the last frame before the restart is a 'hold' key: it shows its own angle for that one frame and the next
 * frame starts from the equivalent angle. At whole frames, which is where a clip is drawn, the turning is unbroken; between
 * those two frames the angle waits instead of moving on. A segment that is not linear is written frame by frame where it
 * has to restart, so its shape is kept at whole frames too.
 */
function wrapTurns(keys: MotionKey[]): MotionKey[] {
  const [lo, hi] = RANGE.rotation;
  const inside = (v: number) => v >= lo && v <= hi;
  if (keys.every((k) => inside(k.value))) return keys;
  const out: MotionKey[] = [];
  let off = 0; // whole turns taken off so far, in degrees
  // `raw` is the true angle. When it would leave the range, the key before it (always one frame earlier) holds and this one restarts.
  const put = (frame: number, raw: number, easing: MotionEasing) => {
    let v = raw - off;
    if (!inside(v)) {
      const turns = 360 * Math.floor(v / 360);
      off += turns;
      v -= turns;
      const prev = out[out.length - 1];
      if (prev) prev.easing = 'hold';
    }
    out.push({ frame, value: v, easing });
  };
  put(keys[0]!.frame, keys[0]!.value, keys[0]!.easing);
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]!, b = keys[i]!;
    if (inside(b.value - off)) { put(b.frame, b.value, b.easing); continue; } // easings never overshoot, so the whole segment stays inside
    const at = (g: number) => (g === b.frame ? b.value : a.value + (b.value - a.value) * EASE[a.easing]((g - a.frame) / (b.frame - a.frame)));
    const straight = a.easing === 'linear';
    for (let g = a.frame + 1; g <= b.frame; g++) {
      const leaves = !inside(at(g) - off);
      if (leaves && out[out.length - 1]!.frame < g - 1) put(g - 1, at(g - 1), 'linear');
      if (leaves || g === b.frame || !straight) put(g, at(g), g === b.frame ? b.easing : 'linear');
    }
  }
  return out;
}

/** Frame rate at which the default lengths of the presets were designed; at another rate they keep their length in seconds. */
export const MOTION_DESIGN_FPS = 30;
/** A preset's default length (in/out) or period (loop) in frames of a project at `fps`: the same seconds as at 30 frames a second. */
export function defaultMotionFrames(presetId: string, fps: number): number {
  const def = BY_ID.get(presetId);
  if (!def) throw new Error(`unknown motion preset: ${presetId}`);
  return def.frames > 0 ? Math.max(1, Math.round((def.frames * fps) / MOTION_DESIGN_FPS)) : 0;
}
/**
 * SAFETY: the shortest period (in frames at `fps`) at which an opacity loop (flicker, opacity pulse) dims and returns at
 * most three times in any one second; null for a loop that does not change opacity. Each dip (a local minimum of the
 * opacity over one period) is a flash: a pair of opposing changes. Four dips in a row must span more than a second, so
 * the period P must make the shortest span of four consecutive dips longer than one second, with a frame to spare for
 * the rounding of keys to frames. (A preset is offered faster than that by no route: apply_motion_preset refuses it.)
 */
export function shortestSafeLoopFrames(presetId: string, fps: number): number | null {
  const def = BY_ID.get(presetId);
  if (!def || def.kind !== 'loop' || !def.spec.opacity) return null;
  const keys = def.spec.opacity, values = keys.map((k) => k[1]);
  const dips: number[] = [];
  for (let i = 0; i < keys.length - 1; i++) { // the last key repeats the first (a period ends where it began)
    const prev = values[(i - 1 + keys.length - 1) % (keys.length - 1)]!, here = values[i]!, next = values[i + 1]!;
    if (here < prev && here <= next) dips.push(keys[i]![0]);
  }
  if (!dips.length) return null;
  // phases of the dips over four periods; the shortest span (in periods) of any four consecutive ones
  const all = [0, 1, 2, 3, 4].flatMap((c) => dips.map((t) => c + t));
  let span = Infinity;
  for (let i = 0; i + 3 < all.length; i++) span = Math.min(span, all[i + 3]! - all[i]!);
  return Math.floor(fps / span) + 2;
}

export function motionKeys(presetId: string, ctx: MotionContext): Partial<Record<MotionProperty, MotionKey[]>> {
  const def = BY_ID.get(presetId);
  if (!def) throw new Error(`unknown motion preset: ${presetId}`);
  return keysFor(def, ctx);
}

/** The entrances and exits animate_clip offers (besides 'none'). */
export const ANIMATE_CLIP_MOTIONS = ['fade', 'pop', 'slide-up', 'slide-down', 'slide-left', 'slide-right'] as const;
export type AnimateClipMotion = (typeof ANIMATE_CLIP_MOTIONS)[number];
/**
 * The keys animate_clip writes for one entrance ('in') or exit ('out'), as motionKeys gives them for a preset: the shapes
 * below (ANIMATE_CLIP_SHAPES), which previousMotion also recognises, at full strength, `ctx.frames` long (default 12).
 */
export function animateClipKeys(kind: 'in' | 'out', name: AnimateClipMotion, ctx: MotionContext): Partial<Record<MotionProperty, MotionKey[]>> {
  const def = ANIMATE_CLIP_SHAPES.find((d) => d.id === `animate_clip.${kind}.${name}`);
  if (!def) throw new Error(`unknown animate_clip motion: ${kind} ${name}`);
  return keysFor(def, { ...ctx, amount: def.amount });
}

function keysFor(def: Def, ctx: MotionContext): Partial<Record<MotionProperty, MotionKey[]>> {
  const total = Math.max(2, Math.floor(ctx.totalFrames));
  const amt = ctx.amount === undefined || !Number.isFinite(ctx.amount) ? 1 : Math.min(2, Math.max(0, ctx.amount));
  const req = ctx.frames !== undefined && Number.isFinite(ctx.frames) ? Math.floor(ctx.frames) : def.frames;
  const result: Partial<Record<MotionProperty, MotionKey[]>> = {};

  for (const prop of PROP_ORDER) {
    const spec = def.spec[prop];
    if (!spec) continue;
    const rest = ctx.rest[prop];
    const free = (v: number, extra = 0): number => (ADDITIVE[prop] ? rest + (v + extra) * amt : rest * (1 + (v + extra - 1) * amt));
    const value = (v: number, extra = 0): number => clamp(prop, free(v, extra));
    const mk = (frame: number, v: number, e: MotionEasing | undefined, extra = 0): MotionKey => ({ frame, value: value(v, extra), easing: e ?? 'linear' });

    if (def.kind === 'loop') {
      const p = Math.max(1, req);
      const cycles = Math.ceil(total / p);
      const cumulative = def.cumulative?.includes(prop) === true;
      const span = cumulative ? spec[spec.length - 1]![1] - spec[0]![1] : 0;
      // A rotation that keeps adding turns is built from its true angles and brought back into range by whole turns at the end
      // (clamping it instead would stop the turning at the edge of the range).
      const turning = cumulative && prop === 'rotation' && Number.isFinite(rest);
      const raw: MotionKey[] = [];
      for (let c = 0; c < cycles; c++) {
        spec.forEach(([t, v, e], j) => {
          if (c > 0 && j === 0) return;
          const k = mk(c * p + Math.round(t * p), v, e, cumulative ? c * span : 0);
          raw.push(turning ? { ...k, value: free(v, c * span) } : k);
        });
      }
      const all = dedupe(raw);
      const keys = all.filter((k) => k.frame <= total);
      const last = keys[keys.length - 1]!;
      if (last.frame < total) {
        const next = all[keys.length];
        let v = last.value;
        if (next) v = last.value + (next.value - last.value) * EASE[last.easing]((total - last.frame) / (next.frame - last.frame));
        keys.push({ frame: total, value: turning ? v : clamp(prop, v), easing: 'linear' });
      }
      result[prop] = turning ? wrapTurns(keys) : keys;
      continue;
    }

    const n = def.kind === 'move' ? total : Math.max(1, Math.min(total, Number.isFinite(req) ? req : def.frames));
    const base = def.kind === 'out' ? total - n : 0;
    result[prop] = dedupe(spec.map(([t, v, e]) => mk(base + Math.round(t * n), v, e)));
  }
  return result;
}

/** A key as it sits on a clip: `frame` is its clip-local time in frames (after a trim or a cut it can be negative or past the end). */
export interface PlacedMotionKey { frame: number; value: number; easing: MotionEasing }
const OFF_FRAME = 1e-6;
const sameValue = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * The entrances and exits that animate_clip writes (the inspector's Animate control): fade, pop and four slides, two keys per
 * property, the first eased out (entrance) or in (exit). They are not presets of this library, but a clip may carry one, and
 * a library entrance or exit has to replace it like one of its own. animate_clip has no strength setting: its values are
 * exactly these. It writes them with animateClipKeys and places them exactly as a library entrance or exit is placed
 * (ops.ts placeMotion), so it replaces a library motion at its end of the clip as well.
 */
const ANIMATE_CLIP_FAR: Readonly<Record<AnimateClipMotion, Partial<Record<MotionProperty, number>>>> = { fade: {}, pop: { scale: 0.6 }, 'slide-up': { y: 0.08 }, 'slide-down': { y: -0.08 }, 'slide-left': { x: 0.1 }, 'slide-right': { x: -0.1 } };
const ANIMATE_CLIP_SHAPES: readonly (Def & { amount: number })[] = ANIMATE_CLIP_MOTIONS.map((name) => [name, ANIMATE_CLIP_FAR[name]] as const).flatMap(([name, far]) =>
  (['in', 'out'] as const).map((kind) => ({
    id: `animate_clip.${kind}.${name}`, kind, he: '', en: '', frames: 12, amount: 1,
    spec: Object.fromEntries(Object.entries({ ...far, opacity: 0 }).map(([p, v]) => {
      const rest = ADDITIVE[p as MotionProperty] ? 0 : 1;
      return [p, kind === 'in' ? [[0, v, EO], [1, rest]] : [[0, rest, EI], [1, v]]];
    })) as Spec,
  })),
);
const RECOGNISED: readonly (Def & { amount?: number })[] = [...DEFS.filter((d) => d.kind === 'in' || d.kind === 'out'), ...ANIMATE_CLIP_SHAPES];

/** The longest entrance or exit apply_motion_preset and animate_clip accept, and the largest strength. */
const MAX_MOTION_FRAMES = 600;
const MAX_AMOUNT = 2;

interface ShapeKey { at: number; easing: MotionEasing; dev: number }
/**
 * The keys an entrance or exit of `n` frames writes on one property, listed from its outer end inward (an entrance from its
 * first frame on, an exit from its last frame back): `at` is the distance in frames from that outer end, `dev` how far the key
 * is from the resting value at full strength (added to it for x, y and rotation; as a share of it for scale and opacity).
 * The last one is the resting key.
 */
function shapeOf(def: Def, prop: MotionProperty, n: number): ShapeKey[] {
  const spec = def.spec[prop]!;
  const rest = (def.kind === 'in' ? spec[spec.length - 1]! : spec[0]!)[1];
  const keys = dedupe(spec.map(([t, v, e]) => ({ frame: Math.round(t * n), value: v - rest, easing: e ?? 'linear' })));
  const out = keys.map((k) => ({ at: def.kind === 'in' ? k.frame : n - k.frame, easing: k.easing, dev: k.value }));
  return def.kind === 'in' ? out : out.reverse();
}

interface Fit {
  /** keys of the motion found on the property, its resting key included */
  keys: number;
  /** how many of them, counted from the outer end, go when the motion is replaced */
  remove: number;
  /** the strengths (`amount`) at which the motion would have written exactly these values: from..to */
  amount: readonly [number, number];
  /** every key of the motion is there (nothing overwritten by the opposite motion) */
  whole: boolean;
  /** the value the motion rests at on this property */
  rest: number;
}
const AMOUNT_SLACK = 1e-6;
/**
 * Are the outermost keys of a property (`have`, listed from the outer end inward) the keys `shape` describes?
 * They must sit at the same distances, carry the same easings, and hold the values the motion writes at ONE strength from the
 * value it rests at. The strength and the resting value themselves are free (the motion may have been made at any amount,
 * from any transform), but every key has to agree on them: a key at the edge of the property's range may have been clamped
 * there, so it only says "at least this strong". That is what tells a motion's keys from keys that merely move the same way.
 *
 * `cut` is the index in `have` of the nearest key of the opposite motion (the first key of an exit, seen from an entrance),
 * or -1. That key is at rest too, so the motion may share it as its own resting key (the two meet), and its easing may be
 * the opposite motion's. If the opposite motion was made later and overlaps this one, it has overwritten this one's inner keys:
 * then the keys before `cut` are what is left of it, and they fit when they are the first keys of the shape and the opposite
 * motion begins no later than the next key of the shape would be.
 *
 * What goes when the motion is replaced: every key but the resting one. The resting key goes as well when it is the motion's
 * own and nothing further in moves away from it; it stays when it is shared, or when later animation on the property starts
 * from it (a slow zoom, a hand-made move): without it that animation would start from its own next key and the property
 * would sit at that key's value for the whole stretch before it.
 */
function fitProperty(kind: 'in' | 'out', prop: MotionProperty, shape: readonly ShapeKey[], have: readonly PlacedMotionKey[], cut: number): Fit | null {
  const m = shape.length, limit = cut < 0 ? have.length : cut + 1;
  const dist = (i: number) => Math.abs(have[i]!.frame - have[0]!.frame);
  let j = 0;
  // The easing of a key shapes what comes after it. The resting key of an entrance is its last key, so its easing belongs to
  // whatever follows the entrance; that of an exit is its first key and shapes the exit itself.
  const free = (i: number) => i === cut || (kind === 'in' && i === m - 1);
  while (j < m && j < limit && Math.abs(dist(j) - shape[j]!.at) <= OFF_FRAME && (free(j) || have[j]!.easing === shape[j]!.easing)) j++;
  const whole = j === m;
  if (!whole && !(cut >= 0 && (j === cut + 1 || (j === cut && dist(cut) <= shape[j]!.at + OFF_FRAME)))) return null;
  const lead = whole ? m - 1 : cut; // the keys before the resting key
  const rest = have[lead]!.value;
  let from = 0, to = Infinity;
  for (let i = 0; i < lead; i++) {
    const dev = shape[i]!.dev, value = have[i]!.value;
    if (Math.abs(dev) < 1e-12) { if (!sameValue(value, rest)) return null; continue; }
    const amount = (value - rest) / (ADDITIVE[prop] ? dev : rest * dev); // value = rest + dev·amount, or rest·(1 + dev·amount)
    if (!(amount > 0) || !Number.isFinite(amount)) return null; // moves the other way, or not at all
    from = Math.max(from, amount);
    if (!RANGE[prop].some((bound) => sameValue(value, bound))) to = Math.min(to, amount);
  }
  if (from > to + AMOUNT_SLACK * Math.max(1, to)) return null;
  const amount = [from, to] as const;
  if (!whole || lead === cut) return { keys: lead, remove: lead, amount, whole, rest };
  const next = have[m];
  return { keys: m, remove: next === undefined || sameValue(next.value, rest) ? m : lead, amount, whole, rest };
}

/**
 * The entrance ('in') or exit ('out') on a clip, read from its keys: per property of that motion, how many keys it has there.
 * `rest` is the clip's resting transform; `cuts` says, per property, how many keys at the inner side belong to the opposite
 * motion (see fitProperty).
 */
function recognise(kind: 'in' | 'out', keys: Partial<Record<MotionProperty, readonly PlacedMotionKey[]>>, totalFrames: number, rest: MotionContext['rest'], cuts: Partial<Record<MotionProperty, number>>): Partial<Record<MotionProperty, Fit>> {
  let best: Partial<Record<MotionProperty, Fit>> = {}, bestKeys = 0;
  for (const def of RECOGNISED) {
    if (def.kind !== kind) continue;
    const props = PROP_ORDER.filter((p) => def.spec[p] !== undefined);
    if (props.some((p) => !keys[p]?.length)) continue;
    const have = props.map((p) => (kind === 'in' ? keys[p]! : [...keys[p]!].reverse()));
    const cut = props.map((p, i) => (cuts[p] ? have[i]!.length - cuts[p]! : -1));
    // Where the motion begins (entrance) or ends (exit): the same frame on every property that still has a key of it.
    const own = props.map((_, i) => i).filter((i) => cut[i] !== 0);
    if (!own.length) continue;
    const edge = have[own[0]!]![0]!.frame;
    if (own.some((i) => Math.abs(have[i]![0]!.frame - edge) > OFF_FRAME)) continue;
    // A property whose keys all belong to the opposite motion: that motion must reach this one's outer end to have overwritten it there.
    if (props.some((_, i) => cut[i] === 0 && (kind === 'in' ? have[i]![0]!.frame > edge + OFF_FRAME : have[i]![0]!.frame < edge - OFF_FRAME))) continue;
    // Where it may be: at its own end of the clip (or beyond it, after a trim), or anywhere when the clip is fully transparent
    // on the outer side of it (then nothing is seen there, and it can only be an entrance or exit the clip's end has moved away from).
    const opacity = props.indexOf('opacity');
    const atEnd = kind === 'in' ? edge <= OFF_FRAME : edge >= totalFrames - OFF_FRAME;
    if (!atEnd && !(opacity >= 0 && cut[opacity] !== 0 && have[opacity]![0]!.value <= 1e-9)) continue;
    // Lengths to try: wherever a key sits that could be the resting key. If every property may have been cut short by the
    // opposite motion, no resting key is left to read the length from, so every length is tried.
    const lengths = new Set<number>();
    props.forEach((p, i) => {
      const limit = cut[i]! < 0 ? have[i]!.length : cut[i]! + 1;
      for (let k = 1; k < Math.min(limit, def.spec[p]!.length); k++) {
        const n = Math.abs(have[i]![k]!.frame - edge);
        if (n >= 1 - OFF_FRAME && Math.abs(n - Math.round(n)) <= OFF_FRAME) lengths.add(Math.round(n));
      }
    });
    if (props.every((p, i) => cut[i]! >= 0 && cut[i]! < def.spec[p]!.length)) for (let n = 1; n <= MAX_MOTION_FRAMES; n++) lengths.add(n);
    for (const n of lengths) {
      const fits: Fit[] = [];
      for (let i = 0; i < props.length; i++) {
        const fit: Fit | null = cut[i] === 0 ? { keys: 0, remove: 0, amount: [0, Infinity], whole: false, rest: NaN } : fitProperty(kind, props[i]!, shapeOf(def, props[i]!, n), have[i]!, cut[i]!);
        if (!fit) break;
        fits.push(fit);
      }
      if (fits.length < props.length) continue;
      // A property taken over entirely says nothing about this motion (in particular not its strength, when it is the opacity).
      // What is left may be two keys on one property, and so is a loop that the end of the clip cuts short in its first swing.
      // The difference: a loop starts from the clip's resting value and moves away; an entrance arrives at it (an exit leaves
      // from it). So here the motion must be whole on its other properties and rest exactly where the clip rests now.
      if (cut.includes(0) && !own.every((i) => fits[i]!.whole && sameValue(fits[i]!.rest, rest[props[i]!]))) continue;
      // one strength for the whole motion, within what the ops accept
      const from = Math.max(def.amount ?? 0, ...fits.map((x) => x.amount[0])), to = Math.min(def.amount ?? MAX_AMOUNT, ...fits.map((x) => x.amount[1]));
      if (from > to + AMOUNT_SLACK * Math.max(1, to)) continue;
      const total = fits.reduce((a, b) => a + b.keys, 0);
      if (total > bestKeys) { bestKeys = total; best = Object.fromEntries(props.map((p, i) => [p, fits[i]!])); }
    }
  }
  return best;
}
/**
 * The keys an earlier entrance ('in') or exit ('out') left on a clip, so that a new one can replace it as a whole: per
 * property, how many of its first keys (entrance) or last keys (exit) to take off; a property that is not listed keeps all.
 * A clip does not record which preset made its keys, so this reads the keys themselves (`totalFrames` is the clip's length,
 * `rest` its resting transform).
 *
 * Rule: an earlier entrance (exit) is one of the entrances (exits) of this library or of animate_clip, at some length and
 * at one strength, whose keys are the first (last) keys of EVERY property it uses, all beginning (ending) on the same frame
 * (fitProperty says what "its keys" means). Of several that fit, the one with the most keys wins: a drop is read as a drop,
 * not as the fade it contains. Asking for all of its properties, with values that agree on one strength, is what keeps a
 * move, a loop or keys made by hand on one property from being read as part of an entrance.
 *  - Where: at the clip's own end. An entrance begins on the first frame, or before it (the start was trimmed); an exit ends on
 *    the last frame, or after it (the end was trimmed or cut). Further inside the clip it is recognised only when the clip is
 *    fully transparent on the outer side of it: an exit made before the clip got longer hides the clip from there on, and the
 *    new exit has to replace it, not follow it.
 *  - Next to the opposite motion: the exit (for an entrance; the entrance for an exit) is recognised first. Where the two meet
 *    they share the key between them; where the one made later overlaps the other, it has overwritten that one's inner keys,
 *    and what is left of it still counts (short titles: an entrance and an exit of default length on a title of a second).
 *    If it has replaced every key on one of the properties (a fade out as long as the title replaces the opacity keys of the
 *    entrance), the motion is recognised by its other properties when it is whole there and rests at the clip's resting value.
 *  - What goes: all its keys but the resting one; the resting key too unless it is shared or later animation starts from it.
 *
 * What this cannot tell apart, or does not see:
 *  - keys made by hand at the clip's own end, at the same distances, with the same easings and with values an entrance or
 *    exit would write at some strength on all of its properties, are one as far as the keys say, and are replaced: in practice a plain fade
 *    (two linear opacity keys) from the first frame or to the last. The same keys further inside the clip are left alone,
 *    unless they fade from or to fully transparent as the first or last opacity keys: that looks exactly like an entrance or
 *    exit left behind by a change of length, and is replaced;
 *  - the last, unfinished cycle of an opacity loop (fade pulse, flicker) ends at the last frame in two linear keys going down
 *    and is read as a fade out when an exit is applied (the exit takes over the opacity of those frames in any case);
 *  - an entrance or exit left inside the clip by a change of length is not recognised if it was made weaker than full strength
 *    (it does not reach fully transparent), and stays;
 *  - on a clip no longer than its exit, where the exit has replaced the entrance's opacity keys altogether, the entrance is
 *    not recognised, and stays, if the clip's resting transform was changed after it was made (and the same for an exit under
 *    an entrance as long as the clip). In the same place, keys made by hand that arrive at the resting value like an entrance
 *    (or leave it like an exit) on one property are taken for one; so is the last, unfinished swing of a pendulum loop when it
 *    begins exactly on the loop's closing key, which rests and eases in like the first key of a slide out;
 *  - an entrance or exit that a loop, a move or a hand edit made later has changed on one of its properties is no longer
 *    recognised: its other keys stay, as do those of a motion made with amount 0 or clamped flat (they move nothing). Nor is
 *    what is left of the motion at the other end when such a changed motion had overlapped it (it is found through the one
 *    that overlaps it).
 */
export function previousMotion(kind: 'in' | 'out', keys: Partial<Record<MotionProperty, readonly PlacedMotionKey[]>>, totalFrames: number, rest: MotionContext['rest']): Partial<Record<MotionProperty, number>> {
  const other = recognise(kind === 'in' ? 'out' : 'in', keys, totalFrames, rest, {});
  const cuts: Partial<Record<MotionProperty, number>> = {};
  for (const p of PROP_ORDER) if (other[p]) cuts[p] = other[p]!.keys;
  const mine = recognise(kind, keys, totalFrames, rest, cuts);
  const out: Partial<Record<MotionProperty, number>> = {};
  for (const p of PROP_ORDER) if (mine[p] && mine[p]!.remove > 0) out[p] = mine[p]!.remove;
  return out;
}
