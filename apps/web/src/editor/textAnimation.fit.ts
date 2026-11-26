/**
 * Lengths of a title's entrance and exit that fit the title. `set_text_animation` refuses when the entrance plus the exit are
 * longer than the clip, and the default lengths (20 and 15 frames) are longer than a short title. The control therefore
 * shortens what it sends to what fits, down to one frame each, and says so, instead of sending a value the op must refuse.
 */
import type { TextAnimation } from '@pulseframe/core';

export type Side = 'inFrames' | 'outFrames';
const SIDES = ['inFrames', 'outFrames'] as const;
const other = (side: Side): Side => (side === 'inFrames' ? 'outFrames' : 'inFrames');
const isOn = (a: TextAnimation, side: Side) => (side === 'inFrames' ? !!a.in : !!a.out);

/** The longest entrance (or exit) the title has room for, given the other side as it is now. Never below one frame. */
export function framesRoom(a: TextAnimation, side: Side, totalFrames: number): number {
  const rest = other(side);
  return Math.max(1, totalFrames - (isOn(a, rest) ? a[rest] : 0));
}

/**
 * The patch to send for a change in the panel. `a` is the animation as it is now (the defaults when the title has none),
 * `patch` what the user changed, `totalFrames` the title's length in frames.
 *  - When everything fits, the patch is sent as it is.
 *  - Otherwise the side the change is about (the one turned on, or whose length was typed) takes the room the other side
 *    leaves; the other side keeps its length unless it leaves no room at all, and then it gives up just enough for one frame.
 * `shortened` says that a length differs from what was asked for; the lengths that result are in `frames`.
 */
export function fitTextAnimation(a: TextAnimation, patch: Partial<TextAnimation>, totalFrames: number): { patch: Partial<TextAnimation>; shortened: boolean; frames: { inFrames: number; outFrames: number } } {
  const next = { ...a, ...patch };
  const want = { inFrames: isOn(next, 'inFrames') ? next.inFrames : 0, outFrames: isOn(next, 'outFrames') ? next.outFrames : 0 };
  if (want.inFrames + want.outFrames <= totalFrames) return { patch, shortened: false, frames: { inFrames: next.inFrames, outFrames: next.outFrames } };
  const mine: Side = 'out' in patch || 'outFrames' in patch ? 'outFrames' : 'inFrames';
  const rest = other(mine);
  const fit = { inFrames: next.inFrames, outFrames: next.outFrames };
  if (isOn(next, mine) && isOn(next, rest)) {
    fit[rest] = Math.max(1, Math.min(want[rest], totalFrames - 1));
    fit[mine] = Math.max(1, Math.min(want[mine], totalFrames - fit[rest]));
  } else {
    const only = isOn(next, mine) ? mine : rest;
    fit[only] = Math.max(1, Math.min(want[only], totalFrames));
  }
  const out: Partial<TextAnimation> = { ...patch };
  // send a length only where it changes what is stored (for a title without animation, the op fills in the same defaults)
  for (const side of SIDES) if (fit[side] !== a[side]) out[side] = fit[side]; else delete out[side];
  return { patch: out, shortened: true, frames: fit };
}
