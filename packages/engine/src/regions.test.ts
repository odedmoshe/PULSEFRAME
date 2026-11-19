/**
 * Privacy regions in the compositor (ADR-0015), checked for structure only. FAKE: Node has no 2D canvas, so OffscreenCanvas is
 * replaced here by a recording fake that draws nothing and logs every call with the composite operation and filter in force.
 * What the pixels look like is measured in a real browser by the tracking proof (packages/evals/src/tracking-proof.ts, P9-P10).
 * Checked here: which scratch slots are used (15 and 16 only, wave-3 allocation), the blur radius and pixel block size, the
 * shape and where it is drawn, and the order that keeps the original from showing through: the copy is cut to the shape
 * (destination-in), the picture is erased there (destination-out), then the copy is added (lighter).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_REDACT_REGION, type ResolvedRegion } from '@pulseframe/core';
import { applyRegions, REGION_COPY_SLOT, REGION_MASK_SLOT, regionBlocks, regionBlurPx, scratch, type Buf, type LayerBox } from './look.ts';

type Call = [string, ...unknown[]];
const all: FakeCanvas[] = [];
const STATE = ['globalAlpha', 'globalCompositeOperation', 'filter', 'fillStyle', 'imageSmoothingEnabled'] as const;
class FakeCtx {
  log: Call[] = [];
  globalAlpha = 1; globalCompositeOperation = 'source-over'; filter = 'none'; fillStyle: unknown = '#000'; imageSmoothingEnabled = true; imageSmoothingQuality = 'low';
  private stack: Record<string, unknown>[] = [];
  constructor(public canvas: FakeCanvas) {}
  private rec(name: string, ...args: unknown[]) { this.log.push([name, ...args]); }
  save() { this.rec('save'); this.stack.push(Object.fromEntries(STATE.map((k) => [k, this[k]]))); }
  restore() { this.rec('restore'); Object.assign(this, this.stack.pop() ?? {}); }
  setTransform(...a: number[]) { this.rec('setTransform', ...a); } translate(...a: number[]) { this.rec('translate', ...a); } rotate(a: number) { this.rec('rotate', a); } scale(...a: number[]) { this.rec('scale', ...a); }
  clearRect(...a: number[]) { this.rec('clearRect', ...a); } fillRect(...a: number[]) { this.rec('fillRect', this.fillStyle, ...a); }
  beginPath() { this.rec('beginPath'); } rect(...a: number[]) { this.rec('rect', ...a); } clip() { this.rec('clip'); } fill() { this.rec('fill', this.filter); }
  ellipse(...a: number[]) { this.rec('ellipse', ...a); } roundRect(...a: number[]) { this.rec('roundRect', ...a); }
  drawImage(src: FakeCanvas, ...a: number[]) { this.rec('drawImage', src.id, this.globalCompositeOperation, this.filter, this.imageSmoothingEnabled, ...a); }
}
class FakeCanvas { id = `c${all.length}`; private c = new FakeCtx(this); constructor(public width: number, public height: number) { all.push(this); } getContext() { return this.c; } }
const real = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
beforeAll(() => { (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = FakeCanvas; });
afterAll(() => { (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = real; });

const ctxOf = (b: Buf) => b.ctx as unknown as FakeCtx;
const idOf = (b: Buf) => (b.canvas as unknown as FakeCanvas).id;
const region = (r: Partial<ResolvedRegion>): ResolvedRegion => ({ id: 'rgn_1', shape: 'ellipse', x: 0.1, y: -0.2, width: 0.2, height: 0.3, feather: 0, style: DEFAULT_REDACT_REGION.style, strength: 0.8, color: '#123456', whole: false, state: 'tracked', sourceFrame: 7, ...r });
/** Each size gets its own scratch pool: a fresh size per case, so the canvases made by the call are its own slots. */
let size = 300;
function run(r: ResolvedRegion, box: LayerBox) {
  const W = size++, H = 200;
  const canvas = new FakeCanvas(W, H);
  const buf = { canvas, ctx: canvas.getContext() } as unknown as Buf;
  const first = all.length;
  applyRegions(buf, [r], { width: W, height: H, box });
  const ofSize = all.slice(first).filter((c) => c.width === W && c.height === H);
  const [copyC, maskC] = ofSize;
  const logs = { buf: [...ctxOf(buf).log], copy: [...copyC!.getContext().log], mask: [...maskC!.getContext().log] };
  // exactly two pictures of the frame's size were made, and they are scratch slots 15 (the copy) and 16 (the shape)
  expect(ofSize.length).toBe(2);
  expect(scratch(REGION_COPY_SLOT, W, H).canvas).toBe(copyC);
  expect(scratch(REGION_MASK_SLOT, W, H).canvas).toBe(maskC);
  const copy = { canvas: copyC, ctx: copyC!.getContext() } as unknown as Buf, mask = { canvas: maskC, ctx: maskC!.getContext() } as unknown as Buf;
  return { W, H, buf, copy, mask, logs, copyLog: logs.copy, maskLog: logs.mask };
}
const box: LayerBox = { cx: 160, cy: 100, w: 240, h: 135, rotation: 10, scale: 1.5 };

describe('privacy regions in the compositor (structure, recording fake)', () => {
  it('blur: a copy blurred by (0.04 + 0.21·strength) of the region height on screen, cut to the shape, then erase and add', () => {
    const { buf, copy, mask, logs, copyLog, maskLog } = run(region({ style: 'blur', strength: 0.8 }), box);
    const px = regionBlurPx(0.8, 0.3 * 135 * 1.5);
    expect(px).toBeCloseTo((0.04 + 0.168) * 60.75, 12);
    const filtered = copyLog.find((c) => c[0] === 'drawImage' && c[3] !== 'none')!;
    expect(filtered[3]).toBe(`blur(${px.toFixed(3)}px)`);
    // the shape: in the layer's space (translate, rotate, scale), clipped to its picture, an ellipse of the region's size
    expect(maskLog.filter((c) => ['translate', 'rotate', 'scale', 'rect', 'clip', 'ellipse'].includes(c[0]))).toEqual([
      ['translate', 160, 100], ['rotate', (10 * Math.PI) / 180], ['scale', 1.5, 1.5], ['rect', -120, -67.5, 240, 135], ['clip'], ['ellipse', 0.1 * 240, -0.2 * 135, (0.2 * 240) / 2, (0.3 * 135) / 2, 0, 0, Math.PI * 2],
    ]);
    // copy: cut to the shape; the picture: erased there, then the copy added. Nothing else is drawn on the picture.
    expect(copyLog.at(-1)).toEqual(['drawImage', idOf(mask), 'destination-in', 'none', true, 0, 0]);
    expect(logs.buf.filter((c) => c[0] === 'drawImage')).toEqual([['drawImage', idOf(mask), 'destination-out', 'none', true, 0, 0], ['drawImage', idOf(copy), 'lighter', 'none', true, 0, 0]]);
    expect(ctxOf(buf).globalCompositeOperation).toBe('source-over'); // restored for whatever draws next
  });
  it('pixelate: blocks across the region height from 24 (strength 0) to 4 (strength 1), the small picture made in the mask slot first', () => {
    expect([0, 0.5, 1].map(regionBlocks)).toEqual([24, 14, 4]);
    const { W, H, mask, copyLog, maskLog } = run(region({ style: 'pixelate', strength: 1 }), box);
    const block = (0.3 * 135 * 1.5) / 4;
    const smallDraw = maskLog.find((c) => c[0] === 'drawImage')!;
    expect(smallDraw.slice(5)).toEqual([0, 0, W, H, 0, 0, W / block, H / block]);
    const up = copyLog.find((c) => c[0] === 'drawImage' && c[1] === idOf(mask) && c[2] === 'source-over')!;
    expect(up[4]).toBe(false); // hard block edges
    expect(up.slice(5)).toEqual([0, 0, Math.ceil(W / block), Math.ceil(H / block), 0, 0, Math.ceil(W / block) * block, Math.ceil(H / block) * block]);
  });
  it('fill: the exact colour; a feathered shape is blurred by feather of the output height', () => {
    const { H, copyLog, maskLog } = run(region({ style: 'fill', color: '#00ff7f', feather: 0.02, shape: 'rect' }), box);
    expect(copyLog.find((c) => c[0] === 'fillRect')!.slice(1, 2)).toEqual(['#00ff7f']);
    expect(maskLog.find((c) => c[0] === 'fill')).toEqual(['fill', `blur(${(0.02 * H).toFixed(3)}px)`]);
    expect(maskLog.find((c) => c[0] === 'roundRect')).toEqual(['roundRect', 0.1 * 240 - (0.2 * 240) / 2, -0.2 * 135 - (0.3 * 135) / 2, 0.2 * 240, 0.3 * 135, 0]);
  });
  it('whole (the loss fallback): the layer\'s whole picture, blurred by the layer\'s height on screen', () => {
    const { copyLog, maskLog } = run(region({ whole: true, style: 'blur', strength: 0.6 }), box);
    expect(copyLog.find((c) => c[0] === 'drawImage' && c[3] !== 'none')![3]).toBe(`blur(${regionBlurPx(0.6, 135 * 1.5).toFixed(3)}px)`);
    expect(maskLog.filter((c) => ['rect', 'clip', 'roundRect', 'ellipse'].includes(c[0]))).toEqual([['roundRect', -120, -67.5, 240, 135, 0]]);
  });
});
