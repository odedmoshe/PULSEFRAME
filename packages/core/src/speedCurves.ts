/**
 * Speed curves: named shapes of speed over a clip (fast, slow, fast again…), the kind of thing short-form editors offer
 * as "curve" or "velocity" presets. The shapes and numbers here are this project's own.
 *
 * A curve is a list of segments over the clip's SOURCE. Each segment takes a share of the source (an integer weight) and
 * either plays it at one speed or changes speed gradually across it. Applying a curve (the `apply_speed_curve` op)
 * replaces the clip by one ordinary clip per segment, so every time stays an exact rational and each part can still be
 * edited like any other clip.
 */
export interface CurveSegment { /** share of the source shown, as a positive whole-number weight */ weight: number; /** speed at the start of the segment (0.1–8) */ from: number; /** speed at its end; equal to `from` for one speed */ to: number }
export interface SpeedCurve { id: string; name: { he: string; en: string }; hint: { he: string; en: string }; /** gradual segments ease out of their first speed and into their last */ smooth: boolean; segments: readonly CurveSegment[] }

const seg = (weight: number, from: number, to = from): CurveSegment => ({ weight, from, to });
const repeat = <X,>(n: number, xs: X[]): X[] => Array.from({ length: n }, () => xs).flat();

export const SPEED_CURVES: readonly SpeedCurve[] = [
  { id: 'hero', smooth: true, name: { he: 'גיבור', en: 'Hero' }, hint: { he: 'מהיר, האטה חזקה באמצע, ושוב מהיר', en: 'Fast, a deep slow-down in the middle, fast again' },
    segments: [seg(35, 2.5), seg(8, 2.5, 0.4), seg(14, 0.4), seg(8, 0.4, 2.5), seg(35, 2.5)] },
  { id: 'bullet', smooth: true, name: { he: 'קליע', en: 'Bullet' }, hint: { he: 'מהיר מאוד, צניחה כמעט מיידית להילוך איטי, וחזרה', en: 'Very fast, an almost instant drop to slow motion, and back' },
    segments: [seg(40, 4), seg(4, 4, 0.2), seg(12, 0.2), seg(4, 0.2, 4), seg(40, 4)] },
  { id: 'montage', smooth: true, name: { he: 'מונטאז׳', en: 'Montage' }, hint: { he: 'מהיר ואיטי לסירוגין, פעמיים, ונחיתה במהירות רגילה', en: 'Fast and slow in turn, twice, landing at normal speed' },
    segments: [seg(24, 3), seg(5, 3, 0.5), seg(10, 0.5), seg(5, 0.5, 3), seg(24, 3), seg(5, 3, 0.5), seg(10, 0.5), seg(5, 0.5, 1), seg(12, 1)] },
  { id: 'jump-cut', smooth: false, name: { he: 'קפיצות', en: 'Jump cut' }, hint: { he: 'מדרגות חדות: מהיר, איטי, מהיר, איטי', en: 'Hard steps: fast, slow, fast, slow' },
    segments: repeat(4, [seg(18, 3), seg(7, 0.5)]) },
  { id: 'flash-in', smooth: true, name: { he: 'כניסה מהירה', en: 'Flash in' }, hint: { he: 'מתחיל מהר ונרגע למהירות רגילה', en: 'Starts fast and settles to normal speed' },
    segments: [seg(50, 4, 1), seg(50, 1)] },
  { id: 'flash-out', smooth: true, name: { he: 'יציאה מהירה', en: 'Flash out' }, hint: { he: 'מהירות רגילה שמאיצה לקראת הסוף', en: 'Normal speed that accelerates towards the end' },
    segments: [seg(50, 1), seg(50, 1, 4)] },
  { id: 'slow-down', smooth: true, name: { he: 'האטה', en: 'Slow down' }, hint: { he: 'מהירות רגילה שנמסה להילוך איטי', en: 'Normal speed melting into slow motion' },
    segments: [seg(40, 1), seg(20, 1, 0.3), seg(40, 0.3)] },
  { id: 'build-up', smooth: true, name: { he: 'האצה', en: 'Build up' }, hint: { he: 'מתחיל לאט ומאיץ עד מהיר מאוד', en: 'Starts slow and accelerates to very fast' },
    segments: [seg(30, 0.5), seg(40, 0.5, 4), seg(30, 4)] },
  { id: 'wave', smooth: true, name: { he: 'גל', en: 'Wave' }, hint: { he: 'המהירות עולה ויורדת ברצף, בלי מדרגות', en: 'Speed rises and falls continuously, with no steps' },
    segments: [seg(20, 2, 0.5), seg(20, 0.5, 2), seg(20, 2, 0.5), seg(20, 0.5, 2), seg(20, 2, 0.5)] },
  { id: 'emphasis', smooth: true, name: { he: 'הדגשה', en: 'Emphasis' }, hint: { he: 'רגע אחד באמצע בהילוך איטי, השאר במהירות רגילה', en: 'One moment in the middle in slow motion, the rest at normal speed' },
    segments: [seg(38, 1), seg(8, 1, 0.25), seg(8, 0.25), seg(8, 0.25, 1), seg(38, 1)] },
  { id: 'surge', smooth: true, name: { he: 'פעימות', en: 'Surge' }, hint: { he: 'חמש האצות קצרות על רקע מהירות רגילה', en: 'Five short bursts of speed over normal playback' },
    segments: repeat(5, [seg(10, 1), seg(5, 1, 3), seg(5, 3, 1)]) },
  { id: 'fast-forward', smooth: true, name: { he: 'הרצה קדימה', en: 'Fast forward' }, hint: { he: 'פתיחה וסיום רגילים, האמצע רץ פי שישה', en: 'Normal opening and ending, the middle runs six times faster' },
    segments: [seg(20, 1), seg(10, 1, 6), seg(40, 6), seg(10, 6, 1), seg(20, 1)] },
  { id: 'smooth-ramp', smooth: true, name: { he: 'רמפה חלקה', en: 'Smooth ramp' }, hint: { he: 'האצה אחת רציפה, מאיטי למהיר, לאורך כל הקליפ', en: 'One continuous acceleration, slow to fast, across the whole clip' },
    segments: [seg(100, 0.5, 2.5)] },
  { id: 'stutter', smooth: false, name: { he: 'גמגום', en: 'Stutter' }, hint: { he: 'מהירות רגילה עם שש עצירות קצרצרות כמעט מוחלטות', en: 'Normal speed with six very short near-stops' },
    segments: [...repeat(6, [seg(32, 1), seg(1, 0.1)]), seg(6, 1)] },
];
export const SPEED_CURVE_IDS = SPEED_CURVES.map((c) => c.id) as [string, ...string[]];
export const findSpeedCurve = (id: string): SpeedCurve | undefined => SPEED_CURVES.find((c) => c.id === id);

/** One control point of a hand-made curve: `at` is the position in the clip's source (0 = its first frame, 1 = its last), `speed` the speed there. */
export interface CurvePoint { at: number; speed: number }
/**
 * Segments of a hand-made curve: between two neighbouring points the speed changes gradually from one to the other.
 * Positions are taken to a thousandth. Returns null when the points do not describe a curve (fewer than two, not
 * starting at 0 and ending at 1, or not in increasing order).
 */
export function segmentsFromPoints(points: readonly CurvePoint[]): CurveSegment[] | null {
  if (points.length < 2) return null;
  const at = points.map((p) => Math.round(p.at * 1000));
  if (at[0] !== 0 || at[at.length - 1] !== 1000) return null;
  const out: CurveSegment[] = [];
  for (let i = 1; i < points.length; i++) {
    const weight = at[i]! - at[i - 1]!;
    if (weight <= 0) return null;
    out.push({ weight, from: points[i - 1]!.speed, to: points[i]!.speed });
  }
  return out;
}

/**
 * The curve as a line for drawing: speed against TIMELINE position (0–1 across the result), which is what a viewer
 * experiences: slow stretches take more room than their share of the source. For display only.
 */
export function curvePolyline(segments: readonly CurveSegment[], smooth: boolean, samplesPerRamp = 8): { x: number; speed: number }[] {
  const length = (s: CurveSegment) => s.weight / ((s.from + s.to) / 2); // timeline time of a segment, in arbitrary units
  const total = segments.reduce((n, s) => n + length(s), 0);
  const out: { x: number; speed: number }[] = [];
  let t = 0;
  for (const s of segments) {
    const len = length(s);
    if (s.from === s.to) out.push({ x: t / total, speed: s.from }, { x: (t + len) / total, speed: s.to });
    else for (let i = 0; i <= samplesPerRamp; i++) {
      const u = i / samplesPerRamp;
      out.push({ x: (t + len * u) / total, speed: s.from + (s.to - s.from) * (smooth ? u * u * (3 - 2 * u) : u) });
    }
    t += len;
  }
  return out;
}
