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
  // Magnify (amount > 0) or pinch (amount < 0) inside a circle. Lengths are fractions of the frame height.
  'distort.bulge': {
    params: (p, env) => [n(p.amount, 0.5), Math.max(n(p.radius, 0.35), 0.001), n(p.x, 0.5), n(p.y, 0.5), env.width / env.height],
    wgsl: `
      let c = vec2f(P.a.z, P.a.w); let asp = vec2f(P.b.x, 1.0);
      let d = (uv - c) * asp; let k = length(d) / P.a.y;
      if (k >= 1.0) { return textureSampleLevel(src, smp, uv, 0.0); }
      return textureSampleLevel(src, smp, c + d * pow(max(k, 0.00001), P.a.x) / asp, 0.0);`,
  },
  // Rotate the picture around a point, most at the centre and not at all at the radius.
  'distort.swirl': {
    params: (p, env) => [(n(p.angle, 180) * Math.PI) / 180, Math.max(n(p.radius, 0.4), 0.001), n(p.x, 0.5), n(p.y, 0.5), env.width / env.height],
    wgsl: `
      let c = vec2f(P.a.z, P.a.w); let asp = vec2f(P.b.x, 1.0);
      let d = (uv - c) * asp; let k = length(d) / P.a.y;
      if (k >= 1.0) { return textureSampleLevel(src, smp, uv, 0.0); }
      let t = P.a.x * (1.0 - k) * (1.0 - k);
      let r = vec2f(d.x * cos(t) - d.y * sin(t), d.x * sin(t) + d.y * cos(t));
      return textureSampleLevel(src, smp, c + r / asp, 0.0);`,
  },
  // Show one half of the picture mirrored onto the other.
  'distort.mirror': {
    params: (p) => [({ left: 0, right: 1, top: 2, bottom: 3 } as Record<string, number>)[String(p.keep)] ?? 0],
    wgsl: `
      var at = uv; let m = P.a.x;
      if (m < 0.5) { if (at.x > 0.5) { at.x = 1.0 - at.x; } }
      else if (m < 1.5) { if (at.x < 0.5) { at.x = 1.0 - at.x; } }
      else if (m < 2.5) { if (at.y > 0.5) { at.y = 1.0 - at.y; } }
      else { if (at.y < 0.5) { at.y = 1.0 - at.y; } }
      return textureSampleLevel(src, smp, at, 0.0);`,
  },
  // Blur along lines through a point: 16 samples between the pixel and a point `amount` of the way toward the centre.
  'blur.zoom': {
    params: (p) => [n(p.amount, 0.15), n(p.x, 0.5), n(p.y, 0.5)],
    wgsl: `
      let c = vec2f(P.a.y, P.a.z);
      var sum = vec4f(0.0);
      for (var i = 0; i < 16; i++) { sum += textureSampleLevel(src, smp, c + (uv - c) * (1.0 - P.a.x * f32(i) / 15.0), 0.0); }
      return sum / 16.0;`,
  },
  // Reduce each colour channel to a few levels.
  'stylize.posterize': {
    params: (p) => [Math.max(2, Math.round(n(p.levels, 4)))],
    wgsl: `
      let s = textureSampleLevel(src, smp, uv, 0.0);
      if (s.a <= 0.0) { return s; }
      let L = P.a.x;
      let c = min(floor(s.rgb / s.a * L), vec3f(L - 1.0)) / (L - 1.0);
      return vec4f(c * s.a, s.a);`,
  },
  // Outlines: the strength of brightness changes around each pixel (Sobel), mixed over the picture.
  'stylize.edges': {
    params: (p, env) => [n(p.amount, 1), n(p.strength, 2), 1 / env.width, 1 / env.height],
    wgsl: `
      let s = textureSampleLevel(src, smp, uv, 0.0);
      if (s.a <= 0.0) { return s; }
      let t = vec2f(P.a.z, P.a.w);
      var l: array<f32, 9>;
      for (var j = 0; j < 3; j++) { for (var i = 0; i < 3; i++) {
        let q = textureSampleLevel(src, smp, uv + vec2f(f32(i - 1), f32(j - 1)) * t, 0.0);
        l[j * 3 + i] = dot(q.rgb, vec3f(0.2126, 0.7152, 0.0722));
      } }
      let gx = (l[2] + 2.0 * l[5] + l[8]) - (l[0] + 2.0 * l[3] + l[6]);
      let gy = (l[6] + 2.0 * l[7] + l[8]) - (l[0] + 2.0 * l[1] + l[2]);
      let e = clamp(length(vec2f(gx, gy)) * P.a.y, 0.0, 1.0);
      return vec4f(mix(s.rgb, vec3f(e) * s.a, P.a.x), s.a);`,
  },
  // Horizontal bands jump sideways and the colours split, a different pattern `speed` times per second.
  // The pattern comes from an integer hash of (band, step, seed), so it is the same on every adapter and for every repeat of a frame.
  'digital.glitch': {
    params: (p, env) => [n(p.amount, 0.08), Math.max(1, Math.round(n(p.bands, 24))), Math.min(1, Math.max(0, n(p.density, 0.35))), Math.round(n(p.seed, 1)), Math.floor((env.seconds ?? 0) * n(p.speed, 12) + 1e-6), n(p.split, 0.004) * (env.height / env.width)],
    wgsl: `
      let band = u32(floor(uv.y * P.a.y));
      let key = hash(band * 7919u + u32(P.a.w) * 104729u) ^ hash(u32(P.b.x) + 1u);
      var at = uv;
      var split = 0.0;
      if (unit(key) < P.a.z) { at.x = fract(uv.x + (unit(hash(key)) - 0.5) * 2.0 * P.a.x); split = P.b.y; }
      let r = textureSampleLevel(src, smp, vec2f(at.x + split, at.y), 0.0);
      let g = textureSampleLevel(src, smp, at, 0.0);
      let b = textureSampleLevel(src, smp, vec2f(at.x - split, at.y), 0.0);
      return vec4f(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));`,
  },
  // Colour grading in one pass: exposure, white balance, contrast, saturation, tinted shadows and highlights, faded blacks.
  // All maths is on the stored (non-linear) values, like the rest of the compositor. The 40 named looks are parameter sets of this pass.
  'color.grade': {
    params: (p) => [n(p.temperature), n(p.tint), n(p.exposure), n(p.contrast, 1), n(p.saturation, 1), n(p.fade), n(p.shadows), n(p.highlights)],
    wgsl: `
      let s = textureSampleLevel(src, smp, uv, 0.0);
      if (s.a <= 0.0) { return s; }
      var c = s.rgb / s.a;
      c = c * pow(2.0, P.a.z);
      c = c * vec3f(1.0 + 0.2 * P.a.x, 1.0 - 0.1 * P.a.y, 1.0 - 0.2 * P.a.x);
      c = (c - vec3f(0.5)) * P.a.w + vec3f(0.5);
      let l = luma(clamp(c, vec3f(0.0), vec3f(1.0)));
      c = mix(vec3f(l), c, P.b.x);
      c = c + (1.0 - l) * (1.0 - l) * P.b.z * vec3f(-0.08, 0.02, 0.10) + l * l * P.b.w * vec3f(0.10, 0.04, -0.08);
      c = c * (1.0 - 0.25 * P.b.y) + vec3f(0.12 * P.b.y);
      return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)) * s.a, s.a);`,
  },
  // Map dark to one colour and bright to another.
  'stylize.duotone': {
    params: (p) => [...rgb(p.dark, '#1B1464'), n(p.amount, 1), ...rgb(p.light, '#FFD166')],
    wgsl: `
      let s = textureSampleLevel(src, smp, uv, 0.0);
      if (s.a <= 0.0) { return s; }
      let c = s.rgb / s.a;
      let two = mix(vec3f(P.a.x, P.a.y, P.a.z), vec3f(P.b.x, P.b.y, P.b.z), luma(c));
      return vec4f(mix(c, two, P.a.w) * s.a, s.a);`,
  },
  // Print dots: a rotated grid of dots of the picture's own colour on white, larger where the picture is darker.
  'stylize.halftone': {
    params: (p, env) => [Math.max(n(p.spacing, 0.012) * env.height, 2), (n(p.angle, 45) * Math.PI) / 180, env.width, env.height],
    wgsl: `
      let s = textureSampleLevel(src, smp, uv, 0.0);
      if (s.a <= 0.0) { return s; }
      let size = P.a.x; let ca = cos(P.a.y); let sa = sin(P.a.y); let dim = vec2f(P.a.z, P.a.w);
      let q = uv * dim;
      let r = vec2f(q.x * ca + q.y * sa, -q.x * sa + q.y * ca);
      let cell = (floor(r / size) + vec2f(0.5)) * size;
      let back = vec2f(cell.x * ca - cell.y * sa, cell.x * sa + cell.y * ca) / dim;
      let k = textureSampleLevel(src, smp, clamp(back, vec2f(0.0), vec2f(1.0)), 0.0);
      let kc = k.rgb / max(k.a, 0.0001);
      let radius = sqrt(1.0 - luma(kc)) * size * 0.72;
      let ink = 1.0 - smoothstep(radius - 0.75, radius + 0.75, distance(r, cell));
      return vec4f(mix(vec3f(1.0), kc * 0.85, ink) * s.a, s.a);`,
  },
  // Darken every other horizontal line.
  'stylize.scanlines': {
    params: (p) => [Math.max(2, Math.round(n(p.lines, 240))), n(p.amount, 0.35)],
    wgsl: `
      let s = textureSampleLevel(src, smp, uv, 0.0);
      let dark = step(0.5, fract(uv.y * P.a.x * 0.5));
      return vec4f(s.rgb * (1.0 - P.a.y * dark), s.a);`,
  },
  // Old tape: lines wobble sideways, colour smears to the right, lines and grain on top. Seeded; a new pattern `speed` times per second.
  'stylize.vhs': {
    params: (p, env) => [n(p.amount, 0.5), Math.round(n(p.seed, 1)), Math.floor((env.seconds ?? 0) * n(p.speed, 24) + 1e-6), env.height, 1 / env.width],
    wgsl: `
      let a = P.a.x; let tick = u32(P.a.z); let seed = u32(P.a.y) * 104729u;
      let row = u32(uv.y * P.a.w);
      let wob = (unit(hash(hash(row / 3u + seed) ^ hash(tick + 7u))) - 0.5) * 0.012 * a;
      let at = vec2f(uv.x + wob, uv.y);
      let y = textureSampleLevel(src, smp, at, 0.0);
      // colour is taken from a few pixels to the left: it trails behind the brightness
      var smear = vec3f(0.0);
      for (var i = 1; i <= 6; i++) { smear += textureSampleLevel(src, smp, at - vec2f(f32(i) * 2.0 * P.b.x * a, 0.0), 0.0).rgb; }
      smear = smear / 6.0;
      let ly = luma(y.rgb); let ls = luma(smear);
      var c = mix(y.rgb, smear + vec3f(ly - ls), 0.8 * a);
      c = c * (1.0 - 0.18 * a * step(0.5, fract(uv.y * P.a.w * 0.25)));
      let grain = unit(hash(hash(u32(uv.x / P.b.x) + row * 8191u + seed) ^ hash(tick))) - 0.5;
      c = c + vec3f(grain * 0.10 * a) * y.a;
      return vec4f(clamp(c, vec3f(0.0), vec3f(y.a)), y.a);`,
  },
  // Repeat one wedge of the picture around a point.
  'distort.kaleidoscope': {
    params: (p, env) => [Math.max(2, Math.round(n(p.segments, 6))), (n(p.angle) * Math.PI) / 180, n(p.x, 0.5), n(p.y, 0.5), env.width / env.height],
    wgsl: `
      let c = vec2f(P.a.z, P.a.w); let asp = vec2f(P.b.x, 1.0);
      let d = (uv - c) * asp;
      let wedge = 6.2831853 / P.a.x;
      var t = atan2(d.y, d.x) - P.a.y;
      t = t - wedge * floor(t / wedge);
      if (t > wedge * 0.5) { t = wedge - t; }
      t = t + P.a.y;
      let at = c + length(d) * vec2f(cos(t), sin(t)) / asp;
      // a wedge can reach outside the picture: fold back in rather than show nothing
      let f = abs(fract(at * 0.5 + vec2f(0.5)) * 2.0 - vec2f(1.0));
      return textureSampleLevel(src, smp, vec2f(1.0) - f, 0.0);`,
  },
  // Lens curvature over the whole frame: positive bends the edges outward (barrel), negative inward.
  'distort.fisheye': {
    params: (p, env) => [n(p.amount, 0.4), env.width / env.height],
    wgsl: `
      let asp = vec2f(P.a.y, 1.0);
      let d = (uv - vec2f(0.5)) * asp;
      let at = vec2f(0.5) + d * (1.0 + P.a.x * dot(d, d) * 2.0) / asp;
      if (at.x < 0.0 || at.x > 1.0 || at.y < 0.0 || at.y > 1.0) { return vec4f(0.0); }
      return textureSampleLevel(src, smp, at, 0.0);`,
  },
  // Blur along one direction: 17 samples centred on the pixel. The length is a fraction of the frame height.
  'blur.directional': {
    params: (p, env) => { const a = (n(p.angle) * Math.PI) / 180, d = n(p.amount, 0.03); return [(Math.cos(a) * d * env.height) / env.width, Math.sin(a) * d]; },
    wgsl: `
      let o = vec2f(P.a.x, P.a.y);
      var sum = vec4f(0.0);
      for (var i = 0; i < 17; i++) { sum += textureSampleLevel(src, smp, uv + o * (f32(i) / 16.0 - 0.5), 0.0); }
      return sum / 17.0;`,
  },
  // Sharp in a horizontal band, increasingly blurred above and below it.
  'blur.tilt-shift': {
    params: (p, env) => [n(p.position, 0.5), Math.max(n(p.width, 0.2), 0.001), n(p.amount, 0.02), env.height / env.width],
    wgsl: `
      let away = clamp((abs(uv.y - P.a.x) - P.a.y * 0.5) / max(P.a.y, 0.0001), 0.0, 1.0);
      let radius = P.a.z * away;
      if (radius <= 0.0) { return textureSampleLevel(src, smp, uv, 0.0); }
      var sum = vec4f(0.0);
      // 20 points on a spiral: an even disc without a visible pattern
      for (var i = 0; i < 20; i++) {
        let t = f32(i) * 2.3999632; let r = sqrt((f32(i) + 0.5) / 20.0) * radius;
        sum += textureSampleLevel(src, smp, uv + vec2f(cos(t) * r * P.a.w, sin(t) * r), 0.0);
      }
      return sum / 20.0;`,
  },
  // Bright areas spill light onto their surroundings.
  'light.glow': {
    params: (p, env) => [n(p.threshold, 0.7), n(p.radius, 0.03), n(p.amount, 0.8), env.height / env.width],
    wgsl: `
      let s = textureSampleLevel(src, smp, uv, 0.0);
      var sum = vec3f(0.0);
      for (var i = 0; i < 24; i++) {
        let t = f32(i) * 2.3999632; let r = sqrt((f32(i) + 0.5) / 24.0) * P.a.y;
        let q = textureSampleLevel(src, smp, uv + vec2f(cos(t) * r * P.a.w, sin(t) * r), 0.0);
        sum += q.rgb * smoothstep(P.a.x, min(P.a.x + 0.2, 1.0), luma(q.rgb));
      }
      // light is added inside the layer's own shape only
      return vec4f(min(s.rgb + sum / 24.0 * P.a.z * s.a, vec3f(s.a)), s.a);`,
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
  fn hash(x: u32) -> u32 { let v = x * 747796405u + 2891336453u; let w = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u; return (w >> 22u) ^ w; }
  fn unit(x: u32) -> f32 { return f32(x >> 8u) / 16777216.0; }
  fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
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
