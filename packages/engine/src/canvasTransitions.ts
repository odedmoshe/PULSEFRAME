/**
 * Canvas2D transitions (ADR-0012 kernel dispatch). A transition id is drawn by the kernel its registry row names
 * (packages/core effects.ts TRANSITIONS[].kernel), looked up here: CANVAS_TRANSITIONS gives each non-GPU id its kernel and
 * the numbers that set its variant (a direction, a shape), CANVAS_KERNELS the code. Nothing is chosen by the id's prefix,
 * so an id without a kernel cannot silently become a cut: a test pins that every non-GPU id has one.
 *
 * Every kernel draws inside compositeLayer's save/restore, with the layer's blend mode already set on `ctx`. It may use
 * scratch slot 6 (as dissolve does) and slot 13 (reserved for the trend-pack kernels, wave3 decisions); no other slot.
 * One implementation for preview, stills and export (ADR-0005).
 */
import type { LayerLook } from './evaluate.ts';
import { scratch, type Buf } from './look.ts';

export interface CanvasTransitionArgs {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  /** The incoming clip's finished layer. */
  incoming: Buf;
  /** The outgoing clip's finished layer, or null when there is no previous clip (the transition reveals over the layers below). */
  outgoing: Buf | null;
  /** The transition state of this frame (progress already eased; options with the registry defaults filled in). */
  t: NonNullable<LayerLook['transition']>;
  /** The variant numbers of the id (CANVAS_TRANSITIONS[id].v). */
  v: readonly [number, number, number];
  W: number;
  H: number;
}
export type CanvasKernel = (a: CanvasTransitionArgs) => void;

/** Scratch slot of the trend-pack Canvas2D kernels (wave3 decisions: 13 is theirs alone). */
export const CANVAS_TRANSITION_SLOT = 13;

/** Non-GPU transition id -> kernel and variant numbers. dip: v0 = 1 for white; wipe and push: v = the direction (x, y). */
export const CANVAS_TRANSITIONS: Record<string, { kernel: string; v: [number, number, number] }> = {
  dissolve: { kernel: 'dissolve', v: [0, 0, 0] },
  'dip-black': { kernel: 'dip', v: [0, 0, 0] }, 'dip-white': { kernel: 'dip', v: [1, 0, 0] },
  'wipe-left': { kernel: 'wipe', v: [-1, 0, 0] }, 'wipe-right': { kernel: 'wipe', v: [1, 0, 0] }, 'wipe-up': { kernel: 'wipe', v: [0, -1, 0] }, 'wipe-down': { kernel: 'wipe', v: [0, 1, 0] },
  'push-left': { kernel: 'push', v: [-1, 0, 0] }, 'push-right': { kernel: 'push', v: [1, 0, 0] }, 'push-up': { kernel: 'push', v: [0, -1, 0] }, 'push-down': { kernel: 'push', v: [0, 1, 0] },
  zoom: { kernel: 'zoom', v: [0, 0, 0] },
  // trend pack (ADR-0012)
  'punch-in': { kernel: 'punch', v: [1, 0, 0] }, 'punch-out': { kernel: 'punch', v: [-1, 0, 0] },
  'blur-dissolve': { kernel: 'blur', v: [0, 0, 0] },
  'split-open-h': { kernel: 'split', v: [0, 0, 0] }, 'split-open-v': { kernel: 'split', v: [1, 0, 0] },
  'shape-heart': { kernel: 'shape', v: [0, 0, 0] }, 'shape-star': { kernel: 'shape', v: [1, 0, 0] },
  'block-left': { kernel: 'block', v: [-1, 0, 0] }, 'block-right': { kernel: 'block', v: [1, 0, 0] },
  'slices-h': { kernel: 'slices', v: [0, 0, 0] }, 'slices-v': { kernel: 'slices', v: [1, 0, 0] },
};

// ---- the five kernels from before ADR-0012, moved verbatim from look.ts compositeLayer ----

/** Exact cross-fade: out*(1-p) + in*p, mixed additively in a buffer so two opaque pictures never dip toward the background. `zoomed`: the incoming picture settles from 1.3×. */
function crossfade({ ctx, incoming: layer, outgoing, t, W, H }: CanvasTransitionArgs, zoomed: boolean) {
  const p = t.progress;
  const mix = scratch(6, W, H);
  if (outgoing) { mix.ctx.globalAlpha = 1 - p; mix.ctx.drawImage(outgoing.canvas, 0, 0); mix.ctx.globalCompositeOperation = 'lighter'; }
  mix.ctx.globalAlpha = p;
  if (zoomed) { const s = 1.3 - 0.3 * p; mix.ctx.translate(W / 2, H / 2); mix.ctx.scale(s, s); mix.ctx.translate(-W / 2, -H / 2); }
  mix.ctx.drawImage(layer.canvas, 0, 0);
  ctx.drawImage(mix.canvas, 0, 0);
}
const dip: CanvasKernel = ({ ctx, incoming: layer, outgoing, t, v, W, H }) => {
  const p = t.progress;
  const first = p < 0.5;
  const shown = first ? outgoing : layer;
  if (shown) ctx.drawImage(shown.canvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = first ? p * 2 : (1 - p) * 2;
  ctx.fillStyle = v[0] === 1 ? '#ffffff' : '#000000';
  ctx.fillRect(0, 0, W, H);
};
const wipe: CanvasKernel = ({ ctx, incoming: layer, outgoing, t, v, W, H }) => {
  const p = t.progress;
  if (outgoing) ctx.drawImage(outgoing.canvas, 0, 0);
  const [dx, dy] = v;
  ctx.beginPath();
  // The reveal edge travels in the named direction: "wipe-left" starts at the right edge and moves left.
  if (dx !== 0) ctx.rect(dx < 0 ? W * (1 - p) : 0, 0, W * p, H);
  else ctx.rect(0, dy < 0 ? H * (1 - p) : 0, W, H * p);
  ctx.clip();
  ctx.drawImage(layer.canvas, 0, 0);
};
const push: CanvasKernel = ({ ctx, incoming: layer, outgoing, t, v, W, H }) => {
  const p = t.progress;
  const [dx, dy] = v;
  if (outgoing) ctx.drawImage(outgoing.canvas, dx * W * p, dy * H * p);
  ctx.drawImage(layer.canvas, -dx * W * (1 - p), -dy * H * (1 - p));
};

/**
 * PLACEHOLDER of a kernel that is not written yet (ADR-0012, worker W1 replaces each one): it draws the incoming picture
 * as it is, a plain cut. It never imitates the transition it stands for; a test fails while any id still uses it.
 */
export const placeholder: CanvasKernel = ({ ctx, incoming }) => { ctx.drawImage(incoming.canvas, 0, 0); };

/** Kernel name -> code. */
export const CANVAS_KERNELS: Record<string, CanvasKernel> = {
  dissolve: (a) => crossfade(a, false),
  zoom: (a) => crossfade(a, true),
  dip, wipe, push,
  // trend pack (ADR-0012): placeholders until W1's kernels land
  punch: placeholder,
  blur: placeholder,
  split: placeholder,
  shape: placeholder,
  block: placeholder,
  slices: placeholder,
};
