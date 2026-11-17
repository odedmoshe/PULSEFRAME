/**
 * What a GPU pass does when the adapter rejects it. WebGPU does not throw for a shader that does not compile: the module, the
 * pipeline, the bind group and the command buffer just become invalid, the submit does nothing, and the error is only seen
 * through an error scope. The readback buffer is shared, so without a scope the pass would hand back the pixels of the last
 * pass that did run. These tests check that such a pass is reported as unavailable, with the adapter's message, and draws nothing.
 *
 * MOCK: `fakeGpu` below is a test double of a WebGPU device, not a graphics adapter. It follows the WebGPU rules that matter
 * here (invalid objects, errors raised into the innermost matching error scope, invalid command buffers dropped at submit,
 * a mapped buffer keeping its last contents) and fills each draw with a colour that names the pipeline. Real passes are
 * checked on a real adapter by `pnpm proof:gpu`.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GPU_EFFECTS, gpuEffect, gpuTransition, initGpu, takeUnavailable } from './gpu.ts';

type Rgba = [number, number, number, number];
interface Tex { valid: boolean; w: number; h: number; data: Uint8Array; createView(): { texture: Tex }; destroy(): void }
interface Pipe { valid: boolean; id: number; code: string; getBindGroupLayout(i: number): { valid: boolean } }

/** The reference pixels initGpu checks at (0,0) and (540,960); everything else of the reference draw is the second. */
const REF_FIRST: Rgba = [133, 133, 138, 255], REF_MIDDLE: Rgba = [116, 128, 133, 255];
const isReference = (code: string) => code.includes('let p = i.pos; var c = vec3f(0);');
/** Colour a pass with pipeline `id` draws (the reference shader aside). */
const colourOf = (id: number): Rgba => [id * 20, 7, 9, 255];

function fakeGpu() {
  const scopes: { filter: string; error: { message: string } | null }[] = [];
  const uncaptured: string[] = [];
  const shaderModules: string[] = [];
  const rules = { brokenShader: (_code: string) => false, rejectBindGroups: false, maxSide: Infinity };
  let pipelines = 0;
  const raise = (message: string) => {
    const scope = [...scopes].reverse().find((s) => s.filter === 'validation');
    if (!scope) uncaptured.push(message); else scope.error ??= { message };
  };
  const texture = (w: number, h: number): Tex => {
    const valid = w <= rules.maxSide && h <= rules.maxSide;
    if (!valid) raise(`Texture size (${w}x${h}) exceeds the maximum texture dimension (${rules.maxSide}).`);
    const t: Tex = { valid, w, h, data: new Uint8Array(valid ? w * h * 4 : 0), createView: () => ({ texture: t }), destroy: () => {} };
    return t;
  };
  const device = {
    lost: new Promise(() => {}),
    pushErrorScope: (filter: string) => { scopes.push({ filter, error: null }); },
    popErrorScope: () => {
      const s = scopes.pop();
      return s ? Promise.resolve(s.error) : Promise.reject(new Error('OperationError: the error scope stack is empty'));
    },
    createTexture: ({ size }: { size: [number, number] }) => texture(size[0], size[1]),
    createBuffer: ({ size }: { size: number }) => {
      const valid = size <= rules.maxSide * rules.maxSide * 4 * 64;
      if (!valid) raise(`Buffer size (${size}) exceeds the max buffer size limit.`);
      const data = new Uint8Array(valid ? size : 0);
      return { valid, data, mapAsync: () => (valid ? Promise.resolve() : Promise.reject(new Error('OperationError: the buffer is invalid'))), getMappedRange: () => data.buffer, unmap: () => {}, destroy: () => {} };
    },
    createSampler: () => ({}),
    createShaderModule: ({ code }: { code: string }) => {
      shaderModules.push(code);
      const valid = !rules.brokenShader(code);
      if (!valid) raise('Error while parsing WGSL: :12:7 error: unresolved value \'dirr\'');
      return { valid, code };
    },
    createRenderPipeline: (d: { fragment: { module: { valid: boolean; code: string } } }) => {
      const valid = d.fragment.module.valid;
      if (!valid) raise('Invalid ShaderModule (unlabeled).');
      const p: Pipe = {
        valid, id: ++pipelines, code: d.fragment.module.code,
        getBindGroupLayout: () => { if (!p.valid) raise('Invalid RenderPipeline (unlabeled).'); return { valid: p.valid }; },
      };
      return p;
    },
    createBindGroup: ({ layout }: { layout: { valid: boolean } }) => {
      const valid = layout.valid && !rules.rejectBindGroups;
      if (!valid) raise(layout.valid ? 'Binding doesn\'t exist in [BindGroupLayout].' : 'Invalid BindGroupLayout (unlabeled).');
      return { valid };
    },
    createCommandEncoder: () => {
      const enc = { valid: true, ops: [] as (() => void)[] };
      return {
        beginRenderPass: ({ colorAttachments: [a] }: { colorAttachments: [{ view: { texture: Tex }; clearValue: number[] }] }) => {
          const target = a.view.texture;
          if (!target.valid) enc.valid = false;
          let pipe: Pipe | null = null;
          enc.ops.push(() => { for (let i = 0; i < target.data.length; i += 4) target.data.set(a.clearValue.map((v) => Math.round(v * 255)), i); });
          return {
            setPipeline: (p: Pipe) => { pipe = p; if (!p.valid) enc.valid = false; },
            setBindGroup: (_i: number, b: { valid: boolean }) => { if (!b.valid) enc.valid = false; },
            draw: () => {
              const p = pipe;
              if (!p) { enc.valid = false; return; }
              enc.ops.push(() => {
                for (let y = 0; y < target.h; y++) for (let x = 0; x < target.w; x++) {
                  const c = isReference(p.code) ? (x === 0 && y === 0 ? REF_FIRST : REF_MIDDLE) : colourOf(p.id);
                  target.data.set(c, (y * target.w + x) * 4);
                }
              });
            },
            end: () => {},
          };
        },
        copyTextureToBuffer: ({ texture: t }: { texture: Tex }, { buffer, bytesPerRow }: { buffer: { data: Uint8Array }; bytesPerRow: number }) => {
          enc.ops.push(() => { for (let y = 0; y < t.h; y++) buffer.data.set(t.data.subarray(y * t.w * 4, (y + 1) * t.w * 4), y * bytesPerRow); });
        },
        finish: () => { if (!enc.valid) raise('Invalid CommandBuffer (unlabeled).'); return { valid: enc.valid, ops: enc.ops }; },
      };
    },
    queue: {
      submit: (buffers: { valid: boolean; ops: (() => void)[] }[]) => {
        // WebGPU: an invalid command buffer makes the submit a validation error and nothing in it runs.
        if (buffers.some((b) => !b.valid)) { raise('Invalid CommandBuffer in submit.'); return; }
        for (const b of buffers) for (const op of b.ops) op();
      },
      writeBuffer: () => {}, writeTexture: () => {}, copyExternalImageToTexture: () => {},
    },
  };
  const adapter = { info: { vendor: 'mock', architecture: 'mock' }, isFallbackAdapter: false, requestDevice: () => Promise.resolve(device) };
  return { gpu: { requestAdapter: () => Promise.resolve(adapter) }, rules, scopes, uncaptured, shaderModules };
}

/** A 2D context that records what was put into it. */
function fakeContext() {
  let put: Uint8ClampedArray | null = null;
  const ctx = {
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (img: { data: Uint8ClampedArray }) => { put = img.data; },
    drawImage: () => {},
  };
  return { ctx: ctx as unknown as OffscreenCanvasRenderingContext2D, pixels: () => put };
}
const W = 4, H = 2;
const env = { width: W, height: H, seconds: 0, beat: null };
const picture = {} as OffscreenCanvas;
const WHIP = 'let dir = vec2f(va.x, va.y);'; // a line only the whip kernel has

describe('a GPU pass the adapter rejects (mock device)', () => {
  const fake = fakeGpu();
  beforeAll(async () => {
    vi.stubGlobal('navigator', { gpu: fake.gpu });
    vi.stubGlobal('OffscreenCanvas', class {});
    const status = await initGpu();
    expect(status.available).toBe(true);
    return () => vi.unstubAllGlobals();
  });
  beforeEach(() => {
    fake.rules.brokenShader = () => false; fake.rules.rejectBindGroups = false; fake.rules.maxSide = Infinity;
    takeUnavailable();
  });

  it('a pass that compiles draws its own picture', async () => {
    const out = fakeContext();
    expect(await gpuTransition('ripple', 0.5, picture, picture, out.ctx, env)).toBe(true);
    expect(Array.from(out.pixels()!.slice(0, 4))).toEqual(colourOf(2)); // pipeline 1 was the reference check
    expect(takeUnavailable()).toEqual({ effects: [], reasons: {} });
  });

  it('a transition whose shader does not compile is unavailable with the adapter\'s message, and leaves the picture alone instead of the last pass\'s pixels', async () => {
    const before = fakeContext();
    expect(await gpuTransition('ripple', 0.5, picture, picture, before.ctx, env)).toBe(true); // the readback now holds ripple's pixels
    fake.rules.brokenShader = (code) => code.includes(WHIP);
    const out = fakeContext();
    expect(await gpuTransition('whip-left', 0.5, picture, picture, out.ctx, env)).toBe(false);
    expect(out.pixels()).toBeNull();
    const told = takeUnavailable();
    expect(told.effects).toEqual(['whip-left']);
    expect(told.reasons['whip-left']).toMatch(/did not compile.*Error while parsing WGSL/);
    expect(fake.scopes).toEqual([]);
    expect(fake.uncaptured).toEqual([]);
  });

  it('the failure is kept for that shader: the next frame is refused without compiling it again, and the other passes still run', async () => {
    fake.rules.brokenShader = (code) => code.includes(WHIP);
    const compiled = () => fake.shaderModules.filter((c) => c.includes(WHIP)).length;
    const first = compiled();
    expect(first).toBeGreaterThan(0);
    for (const type of ['whip-right', 'whip-up']) { // the same kernel, other variants
      const out = fakeContext();
      expect(await gpuTransition(type, 0.25, picture, picture, out.ctx, env)).toBe(false);
      expect(out.pixels()).toBeNull();
      const told = takeUnavailable();
      expect(told.effects).toEqual([type]);
      expect(told.reasons[type]).toMatch(/Error while parsing WGSL/);
    }
    expect(compiled()).toBe(first);
    const ok = fakeContext();
    expect(await gpuTransition('ripple', 0.5, picture, picture, ok.ctx, env)).toBe(true);
    expect(takeUnavailable().effects).toEqual([]);
    expect(fake.scopes).toEqual([]);
  });

  it('an effect whose shader does not compile is unavailable too', async () => {
    const crt = GPU_EFFECTS['stylize.crt']!.wgsl;
    fake.rules.brokenShader = (code) => code.includes(crt);
    const out = fakeContext();
    expect(await gpuEffect('stylize.crt', {}, picture, out.ctx, env)).toBe(false);
    expect(out.pixels()).toBeNull();
    const told = takeUnavailable();
    expect(told.effects).toEqual(['stylize.crt']);
    expect(told.reasons['stylize.crt']).toMatch(/did not compile.*Error while parsing WGSL/);
    expect(fake.uncaptured).toEqual([]);
  });

  it('a pass the adapter rejects after compiling (here its bind group) is unavailable with the message, not the last pass\'s pixels, and is tried again next time', async () => {
    const warm = fakeContext();
    expect(await gpuTransition('checker', 0.5, picture, picture, warm.ctx, env)).toBe(true);
    fake.rules.rejectBindGroups = true;
    const out = fakeContext();
    expect(await gpuTransition('checker', 0.5, picture, picture, out.ctx, env)).toBe(false);
    expect(out.pixels()).toBeNull();
    const told = takeUnavailable();
    expect(told.effects).toEqual(['checker']);
    expect(told.reasons.checker).toMatch(/rejected.*Binding doesn't exist/);
    expect(fake.scopes).toEqual([]);
    fake.rules.rejectBindGroups = false;
    const again = fakeContext();
    expect(await gpuTransition('checker', 0.5, picture, picture, again.ctx, env)).toBe(true);
    expect(again.pixels()).not.toBeNull();
    expect(fake.uncaptured).toEqual([]);
  });

  it('a pass that throws half-way (a colour table of the wrong size) is unavailable and leaves the error scopes balanced for the next pass', async () => {
    const strip = { key: 'bad', size: 2, width: 3, height: 2, data: new Uint8Array(3 * 2 * 4) };
    const out = fakeContext();
    expect(await gpuEffect('color.lut', { lut: 'a1', intensity: 1 }, picture, out.ctx, { ...env, luts: new Map([['a1', strip]]) })).toBe(false);
    expect(out.pixels()).toBeNull();
    expect(takeUnavailable().effects).toEqual(['color.lut']);
    expect(fake.scopes).toEqual([]);
    const ok = fakeContext();
    expect(await gpuTransition('ripple', 0.5, picture, picture, ok.ctx, env)).toBe(true);
    expect(takeUnavailable().effects).toEqual([]);
  });

  it('a frame larger than the adapter allows is unavailable with the adapter\'s message (not a failed map), and the next frame of an allowed size draws', async () => {
    fake.rules.maxSide = 32;
    const out = fakeContext();
    expect(await gpuTransition('ripple', 0.5, picture, picture, out.ctx, { ...env, width: 64, height: 16 })).toBe(false);
    expect(out.pixels()).toBeNull();
    const told = takeUnavailable();
    expect(told.effects).toEqual(['ripple']);
    expect(told.reasons.ripple).toMatch(/rejected.*Texture size \(64x16\) exceeds/);
    expect(fake.scopes).toEqual([]);
    const ok = fakeContext();
    expect(await gpuTransition('ripple', 0.5, picture, picture, ok.ctx, env)).toBe(true);
    expect(ok.pixels()).not.toBeNull();
    expect(fake.uncaptured).toEqual([]);
  });
});
