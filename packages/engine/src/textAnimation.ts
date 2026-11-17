/**
 * Letter / word / line animation of titles, as plain numbers: for unit `index` of `count` (in reading order) at a moment
 * of the clip, how visible it is, how far it is moved (in units of the font size) and how large it is drawn.
 * The compositor only applies these numbers, so a rendered title can be checked against them.
 * A pure function of its arguments: every frame can be drawn on its own, and the same frame is always the same.
 */
import type { TextAnimation } from '@pulseframe/core';

export interface UnitPose { alpha: number; /** horizontal offset in font sizes; positive = toward the right of the screen */ dx: number; /** vertical offset in font sizes; positive = down */ dy: number; scale: number }
const REST: UnitPose = { alpha: 1, dx: 0, dy: 0, scale: 1 };
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const outCubic = (u: number) => 1 - (1 - u) ** 3;
const inCubic = (u: number) => u ** 3;
/** Ease-out with a small overshoot (reaches about 1.1 on the way to 1). */
const outBack = (u: number) => { const c = 1.70158; return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; };
/** Share of an entrance or exit that one unit takes; the rest is the stagger between the first and the last unit. */
const UNIT_SHARE = 0.45;
const hash = (a: number, b: number) => { let h = (a * 374761393 + b * 668265263) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/** Progress (0…1) of unit `index` through a staggered phase that lasts `length` seconds, `t` seconds after it began. */
export function unitProgress(index: number, count: number, t: number, length: number): number {
  if (length <= 0) return 1;
  const unit = count > 1 ? length * UNIT_SHARE : length;
  const start = count > 1 ? ((length - unit) * index) / (count - 1) : 0;
  if (t >= start + unit - 1e-9) return 1; // exactly finished: no rounding leaves a unit a hair short of rest
  return clamp01((t - start) / unit);
}

/**
 * Frames are counted the way they are rendered: a clip of N frames shows frames 0 … N − 1, and there is no frame at its end time.
 * An exit of n frames is therefore the LAST n frames of the clip, in n steps: step 1 on the first of them, complete
 * (nothing visible) on the clip's last frame. An entrance of n frames is the first n frames, also in n steps: step 1 on the
 * clip's first frame (something of the first unit already shows), at rest on frame n − 1. So the moment within a phase
 * is one frame ahead of the time since the phase began. The typewriter is the exception: it shows whole units only,
 * the first one on the first frame and all of them from frame n on.
 */
const entranceTime = (a: TextAnimation & { local: number; fps: number }) => a.local + 1 / a.fps;
const exitTime = (a: TextAnimation & { local: number; total: number; fps: number }) => a.local - (a.total - a.outFrames / a.fps) + 1 / a.fps;

/** True when nothing animates at this moment: the title is then drawn exactly like a title without animation. */
export function textAtRest(a: TextAnimation & { local: number; total: number; fps: number }): boolean {
  if (a.loop) return false;
  if (a.in && (a.in === 'typewriter' ? a.local : entranceTime(a)) < a.inFrames / a.fps - 1e-9) return false;
  if (a.out && exitTime(a) > 1e-9) return false;
  return true;
}

/**
 * The pose of one unit. `rtl` is the reading direction of the unit's line: a slide comes from the side reading starts on
 * (the right for Hebrew) and leaves toward the side reading ends on.
 */
export function unitPose(a: TextAnimation & { local: number; total: number; fps: number }, index: number, count: number, rtl: boolean): UnitPose {
  const p: UnitPose = { ...REST };
  const startSide = rtl ? 1 : -1;
  if (a.in) {
    const length = a.inFrames / a.fps;
    if (a.in === 'typewriter') { if (a.local < (length * index) / Math.max(1, count) - 1e-9) p.alpha = 0; }
    else {
      const u = unitProgress(index, count, entranceTime(a), length), e = outCubic(u);
      if (a.in === 'fade') p.alpha *= u;
      else if (a.in === 'rise') { p.alpha *= u; p.dy += (1 - e) * 0.7; }
      else if (a.in === 'drop') { p.alpha *= u; p.dy -= (1 - e) * 0.7; }
      else if (a.in === 'slide') { p.alpha *= u; p.dx += (1 - e) * 1.2 * startSide; }
      else if (a.in === 'zoom') { p.alpha *= u; p.scale *= 1 + (1 - e) * 1.2; }
      else if (a.in === 'pop') { p.alpha *= clamp01(u * 3); p.scale *= u >= 1 ? 1 : Math.max(0.01, 0.3 + 0.7 * outBack(u)); }
    }
  }
  if (a.out) {
    const length = a.outFrames / a.fps, t = exitTime(a);
    if (t > 1e-9) {
      const w = unitProgress(index, count, t, length), e = inCubic(w);
      p.alpha *= 1 - w;
      if (a.out === 'sink') p.dy += e * 0.7;
      else if (a.out === 'lift') p.dy -= e * 0.7;
      else if (a.out === 'shrink') p.scale *= Math.max(0.01, 1 - e * 0.7);
      else if (a.out === 'slide') p.dx -= e * 1.2 * startSide;
    }
  }
  if (a.loop) {
    const phase = 2 * Math.PI * a.local * 1.2 - index * 0.6;
    if (a.loop === 'wave') p.dy += Math.sin(phase) * 0.12;
    else if (a.loop === 'bounce') p.dy -= Math.abs(Math.sin(phase / 2)) * 0.18;
    else if (a.loop === 'pulse') p.scale *= 1 + 0.06 * Math.sin(phase);
    else { const tick = Math.floor(a.local * 12 + 1e-6); p.dx += (hash(index, tick) - 0.5) * 0.06; p.dy += (hash(index + 7919, tick) - 0.5) * 0.06; }
  }
  return p;
}

const RTL_LETTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/, LTR_LETTER = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;
/**
 * True for a line that holds both right-to-left letters and left-to-right letters (Hebrew with a Latin name in it, or the
 * other way round). Where each word, number and punctuation mark of such a line ends up is decided by the full bidi
 * algorithm of the browser; the word-by-word placement used for lines of one direction can differ from it. Such a line is
 * therefore animated only from positions the browser itself reports (pieceRects), or as one piece.
 * Digits are not letters here: a Hebrew line with numbers in it is not mixed.
 */
export const mixesDirections = (line: string): boolean => RTL_LETTER.test(line) && LTR_LETTER.test(line);

/**
 * The pieces of a line that animate on their own, in reading order, as [start, end) offsets into the line: its words, or
 * its letters (`graphemes` divides a word into user-perceived characters). Spaces belong to no piece.
 */
export function unitRanges(line: string, by: 'letter' | 'word', graphemes: (word: string) => string[]): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  for (const word of line.split(' ')) {
    if (word && by === 'word') out.push([at, at + word.length]);
    else { let g = at; for (const letter of graphemes(word)) { out.push([g, g + letter.length]); g += letter.length; } }
    at += word.length + 1;
  }
  return out;
}

/** A stretch of a line as laid out: its left edge, measured from the left edge of the line, and its width. */
export interface Stretch { x: number; width: number }
/**
 * Where the browser's own layout of a whole line put each of the given ranges of it: one or more stretches per range (a
 * word can be in two places: "Friday!" inside a Hebrew line has its "!" at the far left). `metrics` is what
 * `measureText(line)` returned; the answer comes from its `getSelectionRects(start, end)`, which not every browser has.
 * Returns null when the method is missing or throws, or when its answers do not add up to the line: every range needs a
 * stretch inside the line, and the stretches of all ranges and of the spaces between them must cover the line's width
 * once, without overlapping. The caller then animates the line as one piece instead.
 */
export function pieceRects(metrics: unknown, line: string, ranges: [number, number][], lineWidth: number): Stretch[][] | null {
  const m = metrics as { getSelectionRects?: (start: number, end: number) => ArrayLike<{ x: number; width: number }> } | null;
  if (typeof m?.getSelectionRects !== 'function' || !(lineWidth > 0)) return null;
  const slack = Math.max(1, lineWidth * 0.01);
  const all: Stretch[] = [];
  const stretches = (start: number, end: number): Stretch[] => {
    const found = Array.from(m.getSelectionRects!(start, end), (r) => ({ x: Number(r.x), width: Number(r.width) })).filter((r) => r.width > 0);
    if (found.some((r) => !Number.isFinite(r.x) || !Number.isFinite(r.width) || r.x < -slack || r.x + r.width > lineWidth + slack)) throw new Error('outside the line');
    all.push(...found);
    return found;
  };
  try {
    let at = 0;
    const out = ranges.map(([start, end]) => {
      if (start > at) stretches(at, start); // the spaces before this piece
      at = end;
      const found = stretches(start, end);
      if (!found.length) throw new Error('a piece without a place');
      return found;
    });
    if (at < line.length) stretches(at, line.length);
    all.sort((p, q) => p.x - q.x);
    if (all.some((r, i) => i > 0 && r.x < all[i - 1]!.x + all[i - 1]!.width - slack)) return null; // two stretches on the same spot
    return Math.abs(all.reduce((n, r) => n + r.width, 0) - lineWidth) <= slack ? out : null;
  } catch { return null; }
}

/**
 * The window through which each stretch is drawn: the stretch itself, widened by up to `pad` on each side into free
 * space, so that an outline or a slanted letter reaching past its own advance is not cut off. Where another stretch is
 * closer than twice `pad`, each gets half of the space between them; stretches that touch are not widened there.
 */
export function widenStretches(pieces: Stretch[][], pad: number): Stretch[][] {
  const flat = pieces.flat().sort((p, q) => p.x - q.x);
  const room = new Map<Stretch, [number, number]>();
  flat.forEach((r, i) => {
    const before = i > 0 ? Math.max(0, r.x - (flat[i - 1]!.x + flat[i - 1]!.width)) / 2 : pad;
    const after = i + 1 < flat.length ? Math.max(0, flat[i + 1]!.x - (r.x + r.width)) / 2 : pad;
    room.set(r, [Math.min(pad, before), Math.min(pad, after)]);
  });
  return pieces.map((rects) => rects.map((r) => { const [before, after] = room.get(r)!; return { x: r.x - before, width: r.width + before + after }; }));
}
