/**
 * WebGPU effect passes (ADR-0008). Layout, text and layering stay in the Canvas2D compositor; an effect whose maths needs
 * every pixel runs here: the layer buffer is uploaded as a texture, one WGSL fragment pass renders it into a texture, and the
 * result is read back into the 2D pipeline. One WGSL source per effect, for preview, stills and export.
 *
 * The result comes back through a buffer, not by drawing a WebGPU canvas into the 2D canvas: measured on the software
 * adapter of the headless worker, that shortcut returns an empty picture and loses the device. The buffer path costs a
 * readback per effect (9 ms for 1080x1920 in one sample on integrated graphics) and makes the pass asynchronous.
 *
 * Nothing here is assumed to work: `initGpu()` asks for an adapter and renders a fixed shader whose two reference pixels
 * must come back (the same pixels were measured on Intel, NVIDIA and a software adapter). Until that has passed, GPU effects
 * are reported as unavailable and are never approximated: the layer is drawn without the effect and the effect id is
 * recorded so the caller can say so (preview) or refuse (still, export).
 *
 * Conventions: 8-bit, premultiplied alpha in and out, non-linear (sRGB-encoded) maths like the rest of the compositor.
 */
type C2D = OffscreenCanvasRenderingContext2D;
export interface GpuStatus { available: boolean; reason: string; adapter: { vendor: string | null; architecture: string | null; software: boolean } | null }
interface EffectEnv { width: number; height: number; /** Timeline time of the frame in seconds: effects that move are a function of it, so any frame can be drawn on its own. */ seconds?: number }
interface GpuEffect { /** Body of `fn effect(uv: vec2f) -> vec4f` (premultiplied in, premultiplied out). `P` holds the eight parameters. */ wgsl: string; /** Up to eight numbers, in the order the shader reads them. */ params(p: Record<string, unknown>, env: EffectEnv): number[] }

const n = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const rgb = (hex: unknown, fallback: string) => { const h = typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : fallback; return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]; };

/** The implementation of every effect whose registry entry has cost 'gpu' (packages/core/src/effects.ts). */
export const GPU_EFFECTS: Record<string, GpuEffect> = {
  // Remove a background colour. Distance is measured in the chroma plane (Cb, Cr), so brightness changes of the screen matter less.
  'key.chroma': {
    params: (p) => [...rgb(p.color, '#00FF00'), n(p.tolerance, 0.18), n(p.softness, 0.08), n(p.spill, 0.5)],
    wgsl: `
      let s = textureSampleLevel(src, smp, uv, 0.0);
      if (s.a <= 0.0) { return s; }
      let c = s.rgb / s.a;
      let key = vec3f(P.a.x, P.a.y, P.a.z);
      let d = distance(chroma(c), chroma(key));
      let keep = smoothstep(P.a.w, P.a.w + max(P.b.x, 0.0001), d);
      // spill: pull colours that are still close to the key toward their own grey
      let near = 1.0 - smoothstep(P.a.w + P.b.x, P.a.w + P.b.x + 0.25, d);
      let grey = vec3f(dot(c, vec3f(0.2126, 0.7152, 0.0722)));
      let outc = mix(c, grey, near * P.b.y);
      let a = s.a * keep;
      return vec4f(outc * a, a);`,
  },
  // Displace the picture along a travelling sine wave. Lengths are fractions of the frame height.
  'distort.wave': {
    // the wave travels: its phase advances by one full turn per wave that passes (a clip saved before `speed` existed has none and stays still)
    params: (p, env) => [n(p.amplitude, 0.01), Math.max(n(p.wavelength, 0.2), 0.005), (n(p.phase) * Math.PI) / 180 + 2 * Math.PI * (((n(p.speed) * (env.seconds ?? 0)) % 1 + 1) % 1), p.direction === 'vertical' ? 1 : 0, env.height / env.width],
    wgsl: `
      let amp = P.a.x; let len = P.a.y; let phase = P.a.z; let aspect = P.b.x;
      var at = uv;
      if (P.a.w > 0.5) { at.y = at.y + amp * sin(6.2831853 * (uv.x / (len * aspect)) + phase); }
      else { at.x = at.x + amp * aspect * sin(6.2831853 * (uv.y / len) + phase); }
      // outside the picture there is nothing to show
      if (at.x < 0.0 || at.x > 1.0 || at.y < 0.0 || at.y > 1.0) { return vec4f(0.0); }
      return textureSampleLevel(src, smp, at, 0.0);`,
  },
};
export const isGpuEffect = (type: string) => type in GPU_EFFECTS;

const VERTEX = `
  struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
  @vertex fn v(@builtin(vertex_index) i: u32) -> V {
    var p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
    var o: V; o.pos = vec4f(p[i], 0, 1); o.uv = vec2f(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5); return o;
  }`;
const shaderOf = (body: string) => `${VERTEX}
  struct Params { a: vec4f, b: vec4f }
  @group(0) @binding(0) var src: texture_2d<f32>;
  @group(0) @binding(1) var smp: sampler;
  @group(0) @binding(2) var<uniform> P: Params;
  fn chroma(c: vec3f) -> vec2f { return vec2f(-0.1146 * c.r - 0.3854 * c.g + 0.5 * c.b, 0.5 * c.r - 0.4542 * c.g - 0.0458 * c.b); }
  fn effect(uv: vec2f) -> vec4f {${body}
  }
  // straight alpha out: the result is read back as ordinary image data
  @fragment fn f(i: V) -> @location(0) vec4f { let c = effect(i.uv); if (c.a <= 0.0) { return vec4f(0.0); } return vec4f(c.rgb / c.a, c.a); }`;
/** The fixed shader of the adapter check, and the pixels it must give at (0,0) and (540,960) of a 1080x1920 target. */
const REFERENCE = { wgsl: `${VERTEX}
  @fragment fn f(i: V) -> @location(0) vec4f { let p = i.pos; var c = vec3f(0); for (var k = 0; k < 16; k++) { c += 0.0625 * (0.5 + 0.5 * sin(vec3f(p.x, p.y, p.x + p.y) * 0.01 * f32(k + 1))); } return vec4f(c, 1); }`, first: [133, 133, 138, 255], middle: [116, 128, 133, 255] };

interface State { adapter: any; device: any; sampler: any; pipelines: Map<string, any>; size: { source: any; target: any; readback: any; stride: number; width: number; height: number } | null; uniforms: any }
let state: State | null = null;
let status: GpuStatus = { available: false, reason: 'not checked yet', adapter: null };
let starting: Promise<GpuStatus> | null = null;
/** Effect ids that could not be applied since the last `takeUnavailableEffects()`. */
const skipped = new Set<string>();

export const gpuStatus = (): GpuStatus => status;
export function takeUnavailableEffects(): string[] { const out = [...skipped]; skipped.clear(); return out; }

/** Ask for an adapter and prove it renders the reference pixels. Safe to call many times; resolves to the same status. */
export function initGpu(): Promise<GpuStatus> {
  starting ??= (async () => {
    const fail = (reason: string, adapter: GpuStatus['adapter'] = null) => (status = { available: false, reason, adapter });
    try {
      const gpu = (globalThis.navigator as { gpu?: any } | undefined)?.gpu;
      if (!gpu || typeof OffscreenCanvas === 'undefined') return fail('this browser has no WebGPU');
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return fail('the browser offers WebGPU but gave no graphics adapter');
      const info = adapter.info ?? {};
      const about = { vendor: info.vendor ?? null, architecture: info.architecture ?? null, software: !!(adapter.isFallbackAdapter ?? info.isFallbackAdapter) };
      const device = await adapter.requestDevice();
      // ---- reference check ----
      const W = 1080, H = 1920;
      device.pushErrorScope('validation');
      const target = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: 0x10 | 0x01 });
      const mod = device.createShaderModule({ code: REFERENCE.wgsl });
      const pipe = device.createRenderPipeline({ layout: 'auto', vertex: { module: mod, entryPoint: 'v' }, fragment: { module: mod, entryPoint: 'f', targets: [{ format: 'rgba8unorm' }] } });
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      pass.setPipeline(pipe); pass.draw(3); pass.end();
      const stride = Math.ceil((W * 4) / 256) * 256;
      const buf = device.createBuffer({ size: stride * H, usage: 0x01 | 0x08 });
      enc.copyTextureToBuffer({ texture: target }, { buffer: buf, bytesPerRow: stride }, [W, H]);
      device.queue.submit([enc.finish()]);
      const invalid = await device.popErrorScope();
      if (invalid) return fail(`the adapter rejected the reference pass: ${String(invalid.message).slice(0, 160)}`, about);
      await buf.mapAsync(0x01);
      const bytes = new Uint8Array(buf.getMappedRange());
      const at = (x: number, y: number) => Array.from(bytes.slice(stride * y + x * 4, stride * y + x * 4 + 4));
      const same = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]!) <= 1);
      const first = at(0, 0), middle = at(W >> 1, H >> 1);
      buf.unmap(); buf.destroy(); target.destroy();
      if (!same(first, REFERENCE.first) || !same(middle, REFERENCE.middle)) return fail(`the adapter renders the reference shader differently (${JSON.stringify(middle)} instead of ${JSON.stringify(REFERENCE.middle)})`, about);
      // ---- ready ----
      state = { adapter, device, sampler: device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' }), pipelines: new Map(), size: null, uniforms: device.createBuffer({ size: 32, usage: 0x40 /* UNIFORM */ | 0x08 /* COPY_DST */ }) };
      device.lost.then((l: { message?: string }) => { state = null; status = { available: false, reason: `the graphics device was lost: ${l?.message ?? 'no reason given'}`, adapter: about }; starting = null; });
      return (status = { available: true, reason: `${about.software ? 'software' : 'hardware'} adapter${about.vendor ? ` (${about.vendor})` : ''}, reference pixels match`, adapter: about });
    } catch (e) { return fail(`WebGPU could not be started: ${String((e as Error)?.message ?? e).slice(0, 200)}`); }
  })();
  return starting;
}

/**
 * Run one GPU effect from `src` into `dst` (both the size of the frame; `dst` is replaced).
 * Resolves to false, and records the effect as unavailable, when WebGPU is not ready or the pass fails: the caller then
 * draws the layer unchanged. Callers must not let another frame use the same buffers while this is pending.
 */
export async function gpuEffect(type: string, params: Record<string, unknown>, src: OffscreenCanvas, dst: C2D, env: EffectEnv): Promise<boolean> {
  const fx = GPU_EFFECTS[type];
  const s = state;
  if (!fx || !s) { skipped.add(type); return false; }
  const { device } = s;
  const W = env.width, H = env.height;
  try {
    if (!s.size || s.size.width !== W || s.size.height !== H) {
      s.size?.source.destroy(); s.size?.target.destroy(); s.size?.readback.destroy();
      const stride = Math.ceil((W * 4) / 256) * 256;
      s.size = {
        source: device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: 0x02 /* COPY_DST */ | 0x04 /* TEXTURE_BINDING */ | 0x10 /* RENDER_ATTACHMENT */ }),
        target: device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: 0x10 /* RENDER_ATTACHMENT */ | 0x01 /* COPY_SRC */ }),
        readback: device.createBuffer({ size: stride * H, usage: 0x01 /* MAP_READ */ | 0x08 /* COPY_DST */ }), stride, width: W, height: H,
      };
    }
    const z = s.size;
    device.queue.copyExternalImageToTexture({ source: src }, { texture: z.source, premultipliedAlpha: true }, [W, H]);
    let pipe = s.pipelines.get(type);
    if (!pipe) {
      const mod = device.createShaderModule({ code: shaderOf(fx.wgsl) });
      pipe = device.createRenderPipeline({ layout: 'auto', vertex: { module: mod, entryPoint: 'v' }, fragment: { module: mod, entryPoint: 'f', targets: [{ format: 'rgba8unorm' }] } });
      s.pipelines.set(type, pipe);
    }
    const p = new Float32Array(8);
    p.set(fx.params(params, env).slice(0, 8));
    device.queue.writeBuffer(s.uniforms, 0, p);
    const bind = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: z.source.createView() }, { binding: 1, resource: s.sampler }, { binding: 2, resource: { buffer: s.uniforms } }] });
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: z.target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
    enc.copyTextureToBuffer({ texture: z.target }, { buffer: z.readback, bytesPerRow: z.stride }, [W, H]);
    device.queue.submit([enc.finish()]);
    await z.readback.mapAsync(0x01);
    const bytes = new Uint8Array(z.readback.getMappedRange());
    const img = dst.createImageData(W, H);
    if (z.stride === W * 4) img.data.set(bytes.subarray(0, W * H * 4));
    else for (let y = 0; y < H; y++) img.data.set(bytes.subarray(y * z.stride, y * z.stride + W * 4), y * W * 4);
    z.readback.unmap();
    dst.putImageData(img, 0, 0);
    return true;
  } catch (e) {
    // a lost device or a rejected pass: say so once, never draw something else in its place
    status = { ...status, available: !!state, reason: `a GPU pass failed: ${String((e as Error)?.message ?? e).slice(0, 160)}` };
    skipped.add(type);
    return false;
  }
}
