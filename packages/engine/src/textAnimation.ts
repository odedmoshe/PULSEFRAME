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

/** True when nothing animates at this moment: the title is then drawn exactly like a title without animation. */
export function textAtRest(a: TextAnimation & { local: number; total: number; fps: number }): boolean {
  if (a.loop) return false;
  if (a.in && a.local < a.inFrames / a.fps - 1e-9) return false;
  if (a.out && a.local > a.total - a.outFrames / a.fps + 1e-9) return false;
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
      const u = unitProgress(index, count, a.local, length), e = outCubic(u);
      if (a.in === 'fade') p.alpha *= u;
      else if (a.in === 'rise') { p.alpha *= u; p.dy += (1 - e) * 0.7; }
      else if (a.in === 'drop') { p.alpha *= u; p.dy -= (1 - e) * 0.7; }
      else if (a.in === 'slide') { p.alpha *= u; p.dx += (1 - e) * 1.2 * startSide; }
      else if (a.in === 'zoom') { p.alpha *= u; p.scale *= 1 + (1 - e) * 1.2; }
      else if (a.in === 'pop') { p.alpha *= clamp01(u * 3); p.scale *= u >= 1 ? 1 : Math.max(0.01, 0.3 + 0.7 * outBack(u)); }
    }
  }
  if (a.out) {
    const length = a.outFrames / a.fps, t = a.local - (a.total - length);
    if (t > 0) {
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
