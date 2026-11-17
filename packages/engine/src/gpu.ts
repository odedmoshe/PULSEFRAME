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
import type { BeatPosition } from '@pulseframe/core';
interface EffectEnv { width: number; height: number; /** Timeline time of the frame in seconds: effects that move are a function of it, so any frame can be drawn on its own. */ seconds?: number; /** Where the frame falls in the beats of the music playing there, if any. */ beat?: BeatPosition | null }
interface GpuEffect { /** Body of `fn effect(uv: vec2f) -> vec4f` (premultiplied in, premultiplied out). `P` holds the eight parameters. */ wgsl: string; /** Up to eight numbers, in the order the shader reads them. */ params(p: Record<string, unknown>, env: EffectEnv): number[] }

const n = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const rgb = (hex: unknown, fallback: string) => { const h = typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : fallback; return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]; };

/** The integer hash used by every seeded pass, in JavaScript: the same numbers as the WGSL `hash`/`unit`. */
export const hash32 = (x: number) => { const v = (Math.imul(x >>> 0, 747796405) + 2891336453) >>> 0; const w = Math.imul(((v >>> ((v >>> 28) + 4)) ^ v) >>> 0, 277803737) >>> 0; return ((w >>> 22) ^ w) >>> 0; };
export const unit32 = (x: number) => (x >>> 8) / 16777216;
/** Smooth seeded noise in [-1, 1]: random values at whole numbers of `t`, eased in between. A pure function of (seed, t). */
export function smoothNoise(seed: number, t: number): number {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  const at = (k: number) => unit32(hash32((hash32(seed >>> 0) ^ hash32((k + 0x40000000) >>> 0)) >>> 0)) * 2 - 1;
  return at(i) * (1 - u) + at(i + 1) * u;
}
/**
 * The movement of the time-driven "motion" effects as plain numbers: zoom, rotation (radians) and offset (fractions of the
 * frame height) at a moment. The shader only applies them, so the picture can be checked against these numbers.
 */
import { BEAT_WINDOW_SECONDS } from '@pulseframe/core';
/**
 * For an effect set to follow the music: how far the moment is into the current hit (`phase`: 0 on the hit, rising to 1
 * just before the next), the seconds between the two hits (`period`) and the seconds since the hit (`since`). Null when
 * the effect keeps its own steady setting or no analysed music plays there.
 *
 * The hits are the beats whose running number (counted from the first bar start, not from each bar) is a multiple of
 * `every`. Without `minGapSeconds` the place between two hits is read from the beat count, which continues the grid
 * before the first beat and after the last.
 *
 * With `minGapSeconds` (the strobe) only real beats of music that is followed are hits (BeatPosition.hits: the beats of
 * every piece of the music, and of other music followed just before or after, each where it is heard), and two hits that
 * count are never closer together than that. A hit counts when both of these hold:
 *  1. it is not thinned out: `every` is multiplied by the smallest whole number that makes the median gap between the
 *     remaining hits at least `minGapSeconds` (the lower median, and a hair more than the gap), judged over the half
 *     second of timeline the hit lies in together with the half second before and after it (so music played fast keeps
 *     a regular flash on every second, third… hit);
 *  2. no other hit that passes 1 lies less than `minGapSeconds` before it, whether or not that one counts.
 * Each rule looks only at the beats near the hit, never at the moment being drawn, so a hit counts at one moment exactly
 * when it counts at every other: the hits that count are one fixed list, and by rule 2 any two of them are at least
 * `minGapSeconds` apart. `since` is Infinity before the first hit that counts, and after a moment without followed
 * music until the next hit that counts (a hit from before the break is not picked up again).
 */
export function musicHit(p: Record<string, unknown>, beat: BeatPosition | null | undefined, minGapSeconds = 0): { phase: number; period: number; since: number } | null {
  if (p.follow !== 'music' || !beat) return null;
  const every = Math.max(1, Math.round(n(p.every, 1)));
  if (!(minGapSeconds > 0)) {
    const x = beat.sinceFirstBar / every + n(p.offset, 0), phase = x - Math.floor(x + 1e-9), period = beat.period * every;
    return { phase, period, since: phase * period };
  }
  const gap = minGapSeconds, now = beat.at;
  const base = beat.hits.filter((h) => mod(h.index, every) === 0); // the hits of this effect, in time order
  const factors = new Map<number, number>();
  const factorAt = (t: number): number => {
    const block = Math.floor(t / THIN_BLOCK);
    let k = factors.get(block);
    if (k === undefined) { const from = (block - 1) * THIN_BLOCK, to = (block + 2) * THIN_BLOCK; factors.set(block, (k = thinning(base.filter((h) => h.t >= from && h.t < to), every, gap))); }
    return k;
  };
  const kept = (h: { t: number; index: number }) => mod(h.index, every * factorAt(h.t)) === 0; // rule 1
  const counts = (i: number): boolean => {
    if (!kept(base[i]!)) return false;
    for (let j = i - 1; j >= 0 && base[i]!.t - base[j]!.t < gap; j--) if (kept(base[j]!)) return false; // rule 2
    return true;
  };
  // Only hits well inside the listed window are judged, so that every beat their rules look at is listed too: a hit's
  // rules reach back by the gap, then to the start of that hit's block and half a second before it (two blocks at most),
  // and ahead to a second after the start of its own block. A hit further back than `back` no longer shows anyway (its
  // flash has faded to nothing long before); with a gap too long for the window nothing counts.
  const ahead = BEAT_WINDOW_SECONDS - 2 * THIN_BLOCK - 0.05, back = ahead - gap;
  let last = -1, next = -1;
  for (let i = base.length - 1; i >= 0 && now - base[i]!.t <= back; i--) if (base[i]!.t <= now && counts(i)) { last = i; break; }
  for (let i = 0; back > 0 && i < base.length && base[i]!.t - now <= ahead; i++) if (base[i]!.t > now && counts(i)) { next = i; break; }
  const since = last >= 0 && base[last]!.t >= beat.followedFrom ? now - base[last]!.t : Infinity;
  const period = last >= 0 && next >= 0 ? base[next]!.t - base[last]!.t : Math.max(gap, beat.period * every * factorAt(now));
  return { phase: Math.min(1, since / period), period, since };
}
const mod = (a: number, m: number) => ((a % m) + m) % m;
/** Thinning is judged per half second of timeline (see musicHit). */
const THIN_BLOCK = 0.5;
/**
 * The smallest whole factor k for which those of the given hits (an effect's hits, in time order) whose running number is
 * a multiple of every * k have a median gap of at least `gap` seconds. Never more than one above the number of hits.
 */
function thinning(hits: { t: number; index: number }[], every: number, gap: number): number {
  for (let k = 1; k <= hits.length; k++) {
    const at = hits.filter((h) => mod(h.index, every * k) === 0);
    if (at.length < 2) return k;
    const gaps = at.slice(1).map((h, i) => h.t - at[i]!.t).sort((x, y) => x - y);
    if (gaps[(gaps.length - 1) >> 1]! >= gap * (1 + 1e-9)) return k; // a hair more than the gap itself, so that rounding in an even grid exactly at the limit cannot drop some of its hits by rule 2 and keep others
  }
  return hits.length + 1;
}
/** How fast a flash that follows the music fades, per second (the same as a steady strobe at two flashes a second). */
const STROBE_FADE = 20;
/**
 * Two flash times of a strobe are never closer together than this many seconds: a third of a second and a little more.
 * The little more is a third of the time a flash stays above half its strength (ln 2 / STROBE_FADE seconds). A flash
 * start can be seen that much later than its flash time (a clip that begins while the flash is still bright, or a
 * frame that falls a little after the flash time), so four flash starts in a row are seen at least 3 gaps minus that
 * time apart, which is one second: no second holds more than three.
 */
export const STROBE_MIN_GAP = (1 + Math.LN2 / STROBE_FADE) / 3 + 1e-6;
/**
 * The fastest steady strobe, in flashes a second, by the same sum: a steady flash at rate r stays above half its strength
 * for ln 2 / (10 r) seconds, and 3 / r less that time is a second or more only up to r = 3 - ln 2 / 10 = 2.9307.
 */
export const STROBE_MAX_RATE = 2.93;
export function motionAt(type: string, p: Record<string, unknown>, seconds: number, beat?: BeatPosition | null): { scale: number; rotation: number; dx: number; dy: number } {
  const amount = n(p.amount, 0), speed = n(p.speed, 1), seed = Math.round(n(p.seed, 1));
  const hit = musicHit(p, beat);
  switch (type) {
    // following the music, the shake is a jolt on each hit that dies away before the next; the zoom that hides the edges stays
    case 'motion.shake': { const t = seconds * speed, a = amount * (hit ? Math.exp(-hit.phase * 5) : 1); return { scale: 1 + amount * 2.4, rotation: smoothNoise(seed + 2, t) * a * 0.6, dx: smoothNoise(seed, t) * a, dy: smoothNoise(seed + 1, t) * a }; }
    // a beat: full size on the beat, back to rest before the next one
    case 'motion.pulse': { const b = seconds * (n(p.bpm, 120) / 60) + n(p.offset); const ph = hit ? hit.phase : b - Math.floor(b + 1e-9); return { scale: 1 + amount * Math.exp(-ph * n(p.decay, 6)), rotation: 0, dx: 0, dy: 0 }; }
    case 'motion.sway': { const w = 2 * Math.PI * speed * seconds; return { scale: 1 + Math.abs(amount) * 1.2, rotation: Math.sin(w) * amount * 0.5, dx: Math.sin(w * 0.5) * amount * 0.5, dy: 0 }; }
    case 'motion.spin': return { scale: n(p.zoom, 1), rotation: (n(p.rate, 90) * Math.PI / 180) * seconds, dx: 0, dy: 0 };
    default: return { scale: 1, rotation: 0, dx: 0, dy: 0 };
  }
}
const XFORM_WGSL = `
      let asp = vec2f(P.b.x, 1.0);
      let d = (uv - vec2f(0.5)) * asp - vec2f(P.a.z, P.a.w);
      let r = vec2f(d.x * cos(P.a.y) + d.y * sin(P.a.y), -d.x * sin(P.a.y) + d.y * cos(P.a.y)) / P.a.x;
      let at = vec2f(0.5) + r / asp;
      // what moves in from outside the picture is the picture itself, mirrored: never an empty edge
      let f = abs(fract(at * 0.5 + vec2f(0.5)) * 2.0 - vec2f(1.0));
      return textureSampleLevel(src, smp, vec2f(1.0) - f, 0.0);`;
const xform = (type: string): GpuEffect => ({ wgsl: XFORM_WGSL, params: (p, env) => { const m = motionAt(type, p, env.seconds ?? 0, env.beat); return [m.scale, m.rotation, m.dx, m.dy, env.width / env.height]; } });

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
  // Time-driven movement of the whole layer (see motionAt): one shader, four kinds of motion.
  'motion.shake': xform('motion.shake'), 'motion.pulse': xform('motion.pulse'), 'motion.sway': xform('motion.sway'), 'motion.spin': xform('motion.spin'),
  // Soft coloured light drifting over the picture, added on top (screen), as from a leak in the camera.
  'light.leak': {
    params: (p, env) => { const t = (env.seconds ?? 0) * n(p.speed, 0.3), seed = Math.round(n(p.seed, 1)); return [...rgb(p.color, '#FF7A2F'), n(p.amount, 0.6), 0.5 + 0.45 * smoothNoise(seed, t), 0.5 + 0.45 * smoothNoise(seed + 1, t), 0.5 + 0.45 * smoothNoise(seed + 2, t * 0.7), env.width / env.height]; },
    wgsl: `
      let s = textureSampleLevel(src, smp, uv, 0.0);
      let asp = vec2f(P.b.w, 1.0);
      let a = length((uv - vec2f(P.b.x, P.b.y)) * asp); let b = length((uv - vec2f(1.0 - P.b.y, P.b.z)) * asp);
      let glow = exp(-a * a * 5.0) + 0.7 * exp(-b * b * 9.0);
      let leak = vec3f(P.a.x, P.a.y, P.a.z) * clamp(glow * P.a.w, 0.0, 1.0);
      let c = s.rgb / max(s.a, 0.0001);
      return vec4f((vec3f(1.0) - (vec3f(1.0) - c) * (vec3f(1.0) - leak)) * s.a, s.a);`,
  },
  // Brief flashes of light. One strobe on one clip never starts more than three flashes in any one second (flashing
  // faster than that is a seizure risk): the strength is highest at a flash time and only falls until the next one, and
  // two flash times are at least STROBE_MIN_GAP apart, which leaves room for a flash that is first seen a little late
  // (see STROBE_MIN_GAP: the first frame of a clip that begins just after a flash time; a frame just after it).
  //  - steady: the flash times are k / rate on the timeline, rate at most STROBE_MAX_RATE; no parameter of the strobe
  //    can be animated (core effects.ts NOT_ANIMATABLE), so neither the rate nor the brightness changes during the clip.
  //  - following the music: the flash times are the hits that count (musicHit with STROBE_MIN_GAP), and the strength
  //    depends only on the time since the last of them. With no analysed music at the moment there is no flash: a
  //    fallback to the steady rate could put a steady flash right next to a music hit where the music starts or stops.
  // Not limited here: what several strobes add up to (two on one clip, or on clips that overlap or follow one another,
  // with different settings). Each of them keeps to the limit; this function sees only its own effect.
  'light.strobe': {
    params: (p, env) => {
      let strength: number;
      if (p.follow === 'music') strength = Math.exp(-(musicHit(p, env.beat, STROBE_MIN_GAP)?.since ?? Infinity) * STROBE_FADE);
      else { const ph = (env.seconds ?? 0) * Math.min(STROBE_MAX_RATE, Math.max(0, n(p.rate, 2))); strength = Math.exp(-(ph - Math.floor(ph + 1e-9)) * 10); }
      return [...rgb(p.color, '#FFFFFF'), n(p.amount, 0.6) * strength];
    },
    wgsl: `
      let s = textureSampleLevel(src, smp, uv, 0.0);
      return vec4f(mix(s.rgb, vec3f(P.a.x, P.a.y, P.a.z) * s.a, P.a.w), s.a);`,
  },
  // Old film: the frame weaves a little, the light flickers, dust and scratches come and go, the colour fades toward brown.
  'stylize.film': {
    params: (p, env) => { const tick = Math.floor((env.seconds ?? 0) * 18 + 1e-6), seed = Math.round(n(p.seed, 1)), a = n(p.amount, 0.6); return [a, seed, tick, (unit32(hash32(seed * 31 + tick)) - 0.5) * 0.004 * a, 1 - 0.12 * a * unit32(hash32(seed * 57 + tick + 9)), env.width, env.height]; },
    wgsl: `
      let a = P.a.x; let seed = u32(P.a.y) * 104729u; let tick = u32(P.a.z);
      let s = textureSampleLevel(src, smp, vec2f(uv.x, uv.y + P.a.w), 0.0);
      if (s.a <= 0.0) { return s; }
      var c = s.rgb / s.a;
      let l = luma(c);
      c = mix(c, vec3f(l * 1.07, l * 0.98, l * 0.82), 0.55 * a) * P.b.x;
      // scratches: a few thin vertical lines per frame
      let col = u32(uv.x * P.b.y);
      let sc = step(0.9975, unit(hash(hash(col / 2u + seed) ^ hash(tick / 3u + 5u))));
      // dust: sparse dark specks in cells
      let cell = vec2u(u32(uv.x * P.b.y / 6.0), u32(uv.y * P.b.z / 6.0));
      let du = step(0.9985, unit(hash(hash(cell.x + cell.y * 8191u + seed) ^ hash(tick + 77u))));
      c = c * (1.0 - 0.6 * a * du) + vec3f(0.35 * a * sc);
      return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)) * s.a, s.a);`,
  },
  // The colour channels jump apart in a direction that changes several times a second.
  'digital.rgb-shake': {
    params: (p, env) => { const tick = Math.floor((env.seconds ?? 0) * n(p.speed, 14) + 1e-6), seed = Math.round(n(p.seed, 1)); const hit = musicHit(p, env.beat); const ang = unit32(hash32(seed * 131 + tick)) * 2 * Math.PI, k = n(p.amount, 0.01) * (hit ? Math.exp(-hit.phase * 5) : unit32(hash32(seed * 977 + tick + 3))); return [(Math.cos(ang) * k * env.height) / env.width, Math.sin(ang) * k]; },
    wgsl: `
      let o = vec2f(P.a.x, P.a.y);
      let r = textureSampleLevel(src, smp, uv + o, 0.0);
      let g = textureSampleLevel(src, smp, uv, 0.0);
      let b = textureSampleLevel(src, smp, uv - o, 0.0);
      return vec4f(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));`,
  },
  // Star-shaped glints: bright spots send short streaks sideways and up and down.
  'light.sparkle': {
    params: (p, env) => [n(p.threshold, 0.8), n(p.length, 0.04), n(p.amount, 1), env.height / env.width],
    wgsl: `
      let s = textureSampleLevel(src, smp, uv, 0.0);
      var sum = vec3f(0.0);
      for (var i = 1; i <= 10; i++) {
        let t = f32(i) / 10.0; let w = 1.0 - t;
        let h = vec2f(t * P.a.y * P.a.w, 0.0); let v = vec2f(0.0, t * P.a.y);
        for (var k = 0; k < 4; k++) {
          var o = h; if (k == 1) { o = -h; } else if (k == 2) { o = v; } else if (k == 3) { o = -v; }
          let q = textureSampleLevel(src, smp, uv + o, 0.0);
          sum += q.rgb * smoothstep(P.a.x, min(P.a.x + 0.15, 1.0), luma(q.rgb)) * w;
        }
      }
      return vec4f(min(s.rgb + sum / 10.0 * P.a.z * s.a, vec3f(s.a)), s.a);`,
  },
};
export const isGpuEffect = (type: string) => type in GPU_EFFECTS;

/**
 * Transitions over two pictures (the outgoing one and the incoming one). `kernel` picks the WGSL body; `v` are up to three
 * numbers that tell the variants of one kernel apart (`va` in the body). In the body: `p` is the progress 0..1, `asp` width/height,
 * `O(uv)` and `I(uv)` sample the outgoing and incoming pictures (premultiplied), and the result is premultiplied.
 */
const T2: Record<string, string> = {
  'cross-zoom': `
    let k = sin(p * 3.14159265) * 0.45 * va.x; let c = vec2f(0.5);
    var a = vec4f(0.0); var b = vec4f(0.0);
    for (var i = 0; i < 12; i++) { let t = f32(i) / 11.0; a += O(c + (uv - c) * (1.0 - k * t)); b += I(c + (uv - c) * (1.0 - k * t)); }
    return mix(a / 12.0, b / 12.0, smoothstep(0.3, 0.7, p));`,
  swirl: `
    let d = (uv - vec2f(0.5)) * vec2f(asp, 1.0); let r = length(d) / 0.75;
    let t = sin(p * 3.14159265) * 5.0 * va.x * (1.0 - clamp(r, 0.0, 1.0)) * (1.0 - clamp(r, 0.0, 1.0));
    let q = vec2f(0.5) + vec2f(d.x * cos(t) - d.y * sin(t), d.x * sin(t) + d.y * cos(t)) / vec2f(asp, 1.0);
    return mix(O(q), I(q), p);`,
  wave: `
    let k = sin(p * 3.14159265) * 0.06;
    var q = uv;
    if (va.x > 0.5) { q.y = q.y + k * sin(uv.x * 18.0 + p * 12.0); } else { q.x = q.x + k * sin(uv.y * 18.0 + p * 12.0); }
    return mix(O(q), I(q), p);`,
  glitch: `
    let band = u32(floor(uv.y * 28.0)); let tick = u32(floor(p * 14.0));
    let h = hash(band * 7919u + 13u) ; let j = hash(h ^ hash(tick + 3u));
    let k = sin(p * 3.14159265);
    var q = uv; q.x = fract(uv.x + (unit(j) - 0.5) * 0.35 * k * step(0.45, unit(hash(j))));
    // each band switches to the new picture at its own moment
    let sw = step(unit(h), p * 1.2 - 0.1);
    let o = vec4f(O(q + vec2f(0.006 * k, 0.0)).r, O(q).g, O(q - vec2f(0.006 * k, 0.0)).b, O(q).a);
    let n = vec4f(I(q + vec2f(0.006 * k, 0.0)).r, I(q).g, I(q - vec2f(0.006 * k, 0.0)).b, I(q).a);
    return mix(o, n, sw);`,
  pixelate: `
    let cells = mix(dim.y, 14.0, pow(sin(p * 3.14159265), 0.6));
    let q = (floor(uv * vec2f(cells * asp, cells)) + vec2f(0.5)) / vec2f(cells * asp, cells);
    return mix(O(q), I(q), step(0.5, p));`,
  clock: `
    let d = (uv - vec2f(0.5)) * vec2f(asp, 1.0);
    var a = atan2(d.x * va.x, -d.y) / 6.2831853; a = a - floor(a);
    return mix(O(uv), I(uv), 1.0 - smoothstep(p - 0.004, p + 0.004, a + 0.004 - step(1.0, p)));`,
  'soft-wipe': `
    let dir = vec2f(va.x, va.y); let reach = abs(dir.x) + abs(dir.y);
    let s = (dot(uv - vec2f(0.5), dir) / reach) + 0.5; let soft = 0.12;
    return mix(O(uv), I(uv), 1.0 - smoothstep(p * (1.0 + soft) - soft, p * (1.0 + soft), s));`,
  blinds: `
    let f = fract(select(uv.y, uv.x, va.x > 0.5) * 9.0);
    return mix(O(uv), I(uv), 1.0 - smoothstep(p - 0.02, p + 0.02, f * 0.96 + 0.02 - step(1.0, p)));`,
  iris: `
    let r = length((uv - vec2f(0.5)) * vec2f(asp, 1.0)) / (0.5 * length(vec2f(asp, 1.0)));
    let open = 1.0 - smoothstep(p * 1.04 - 0.04, p * 1.04, r);
    let close = smoothstep(1.0 - p * 1.04, 1.0 - p * 1.04 + 0.04, r);
    return mix(O(uv), I(uv), select(open, close, va.x > 0.5));`,
  diamond: `
    let d = abs((uv - vec2f(0.5)) * vec2f(asp, 1.0)); let r = (d.x + d.y) / (0.5 * (asp + 1.0));
    let open = 1.0 - smoothstep(p * 1.04 - 0.04, p * 1.04, r);
    let close = smoothstep(1.0 - p * 1.04, 1.0 - p * 1.04 + 0.04, r);
    return mix(O(uv), I(uv), select(open, close, va.x > 0.5));`,
  flash: `
    let c = mix(O(uv), I(uv), smoothstep(0.4, 0.6, p));
    let w = pow(sin(p * 3.14159265), 2.0);
    return vec4f(min(c.rgb + vec3f(w), vec3f(1.0)), max(c.a, w));`,
  luma: `
    let o = O(uv); var l = luma(o.rgb / max(o.a, 0.0001)); if (va.x > 0.5) { l = 1.0 - l; }
    let soft = 0.15; let edge = 1.0 - p * (1.0 + soft);
    return mix(o, I(uv), smoothstep(edge, edge + soft, l));`,
  squeeze: `
    let t = select(uv.x, uv.y, va.x > 0.5); let cut = 1.0 - p;
    if (t < cut) { let s = t / max(cut, 0.0001); return O(select(vec2f(s, uv.y), vec2f(uv.x, s), va.x > 0.5)); }
    let s = (t - cut) / max(p, 0.0001); return I(select(vec2f(s, uv.y), vec2f(uv.x, s), va.x > 0.5));`,
  checker: `
    let cell = floor(uv * vec2f(8.0 * asp, 8.0)); let local = fract(uv * vec2f(8.0 * asp, 8.0));
    let late = (cell.x + cell.y) - 2.0 * floor((cell.x + cell.y) * 0.5);
    let q = clamp(p * 2.0 - late, 0.0, 1.0);
    return mix(O(uv), I(uv), step(local.x, q) * step(0.00001, q));`,
  bars: `
    let along = select(uv.x, uv.y, va.x > 0.5); let across = select(uv.y, uv.x, va.x > 0.5);
    let delay = unit(hash(u32(floor(across * 22.0)) * 7919u + 5u)) * 0.6;
    let q = clamp((p * 1.6 - delay), 0.0, 1.0);
    return mix(O(uv), I(uv), step(along, q) * step(0.00001, q));`,
  ripple: `
    let d = (uv - vec2f(0.5)) * vec2f(asp, 1.0); let r = length(d);
    let q = uv + normalize(d + vec2f(0.00001)) * sin(r * 40.0 - p * 18.0) * 0.03 * sin(p * 3.14159265) / vec2f(asp, 1.0);
    return mix(O(q), I(q), p);`,
};
/** Transition id -> kernel and the numbers that set its variant. */
export const GPU_TRANSITIONS: Record<string, { kernel: string; v: [number, number, number] }> = {
  'cross-zoom-in': { kernel: 'cross-zoom', v: [1, 0, 0] }, 'cross-zoom-out': { kernel: 'cross-zoom', v: [-1, 0, 0] },
  'swirl-cw': { kernel: 'swirl', v: [1, 0, 0] }, 'swirl-ccw': { kernel: 'swirl', v: [-1, 0, 0] },
  'wave-h': { kernel: 'wave', v: [0, 0, 0] }, 'wave-v': { kernel: 'wave', v: [1, 0, 0] },
  'glitch-cut': { kernel: 'glitch', v: [0, 0, 0] }, pixelate: { kernel: 'pixelate', v: [0, 0, 0] },
  'clock-cw': { kernel: 'clock', v: [1, 0, 0] }, 'clock-ccw': { kernel: 'clock', v: [-1, 0, 0] },
  'soft-wipe-right': { kernel: 'soft-wipe', v: [1, 0, 0] }, 'soft-wipe-left': { kernel: 'soft-wipe', v: [-1, 0, 0] }, 'soft-wipe-down': { kernel: 'soft-wipe', v: [0, 1, 0] }, 'soft-wipe-up': { kernel: 'soft-wipe', v: [0, -1, 0] },
  'soft-wipe-down-right': { kernel: 'soft-wipe', v: [1, 1, 0] }, 'soft-wipe-down-left': { kernel: 'soft-wipe', v: [-1, 1, 0] }, 'soft-wipe-up-right': { kernel: 'soft-wipe', v: [1, -1, 0] }, 'soft-wipe-up-left': { kernel: 'soft-wipe', v: [-1, -1, 0] },
  'blinds-h': { kernel: 'blinds', v: [0, 0, 0] }, 'blinds-v': { kernel: 'blinds', v: [1, 0, 0] },
  'iris-open': { kernel: 'iris', v: [0, 0, 0] }, 'iris-close': { kernel: 'iris', v: [1, 0, 0] },
  'diamond-open': { kernel: 'diamond', v: [0, 0, 0] }, 'diamond-close': { kernel: 'diamond', v: [1, 0, 0] },
  flash: { kernel: 'flash', v: [0, 0, 0] },
  'luma-bright': { kernel: 'luma', v: [0, 0, 0] }, 'luma-dark': { kernel: 'luma', v: [1, 0, 0] },
  'squeeze-h': { kernel: 'squeeze', v: [0, 0, 0] }, 'squeeze-v': { kernel: 'squeeze', v: [1, 0, 0] },
  checker: { kernel: 'checker', v: [0, 0, 0] },
  'bars-h': { kernel: 'bars', v: [0, 0, 0] }, 'bars-v': { kernel: 'bars', v: [1, 0, 0] },
  ripple: { kernel: 'ripple', v: [0, 0, 0] },
};
export const isGpuTransition = (type: string) => type in GPU_TRANSITIONS;
const transitionShader = (body: string) => `${VERTEX}
  struct Params { a: vec4f, b: vec4f }
  @group(0) @binding(0) var outT: texture_2d<f32>;
  @group(0) @binding(1) var smp: sampler;
  @group(0) @binding(2) var<uniform> P: Params;
  @group(0) @binding(3) var inT: texture_2d<f32>;
  fn hash(x: u32) -> u32 { let v = x * 747796405u + 2891336453u; let w = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u; return (w >> 22u) ^ w; }
  fn unit(x: u32) -> f32 { return f32(x >> 8u) / 16777216.0; }
  fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
  fn O(uv: vec2f) -> vec4f { return textureSampleLevel(outT, smp, uv, 0.0); }
  fn I(uv: vec2f) -> vec4f { return textureSampleLevel(inT, smp, uv, 0.0); }
  fn transition(uv: vec2f) -> vec4f {
    let p = P.a.x; let va = vec3f(P.a.y, P.a.z, P.a.w); let asp = P.b.x; let dim = vec2f(P.b.y, P.b.z);
    // every body reads all of them or not; touching them here keeps one binding layout for all kernels
    let keep = va.z + asp + dim.x + O(vec2f(0.0)).a * 0.0 + I(vec2f(0.0)).a * 0.0;
    if (keep != keep) { return vec4f(0.0); }${body}
  }
  @fragment fn f(i: V) -> @location(0) vec4f { let c = transition(i.uv); if (c.a <= 0.0) { return vec4f(0.0); } return vec4f(c.rgb / c.a, c.a); }`;

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

interface State { adapter: any; device: any; sampler: any; pipelines: Map<string, any>; size: { source: any; source2: any; target: any; readback: any; stride: number; width: number; height: number } | null; uniforms: any }
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
export function gpuEffect(type: string, params: Record<string, unknown>, src: OffscreenCanvas, dst: C2D, env: EffectEnv): Promise<boolean> {
  const fx = GPU_EFFECTS[type];
  if (!fx) { skipped.add(type); return Promise.resolve(false); }
  return runPass(type, `fx:${type}`, () => shaderOf(fx.wgsl), fx.params(params, env), src, null, dst, env);
}
/**
 * Run one GPU transition: `outgoing` (may be absent: then it is transparent) and `incoming` into `dst`, at `progress` 0..1.
 * Same contract as gpuEffect: false, and recorded as unavailable, when it cannot run.
 */
export function gpuTransition(type: string, progress: number, outgoing: OffscreenCanvas | null, incoming: OffscreenCanvas, dst: C2D, env: EffectEnv): Promise<boolean> {
  const t = GPU_TRANSITIONS[type];
  if (!t) { skipped.add(type); return Promise.resolve(false); }
  return runPass(type, `tr:${t.kernel}`, () => transitionShader(T2[t.kernel]!), [progress, ...t.v, env.width / env.height, env.width, env.height], outgoing, incoming, dst, env);
}
/** One pass: `first` (and for a transition `second`) in, `dst` replaced. `first` null means a transparent picture. */
async function runPass(type: string, key: string, shader: () => string, numbers: number[], first: OffscreenCanvas | null, second: OffscreenCanvas | null, dst: C2D, env: EffectEnv): Promise<boolean> {
  const s = state;
  if (!s) { skipped.add(type); return false; }
  const { device } = s;
  const W = env.width, H = env.height;
  try {
    if (!s.size || s.size.width !== W || s.size.height !== H) {
      s.size?.source.destroy(); s.size?.source2.destroy(); s.size?.target.destroy(); s.size?.readback.destroy();
      const stride = Math.ceil((W * 4) / 256) * 256;
      s.size = {
        source: device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: 0x02 /* COPY_DST */ | 0x04 /* TEXTURE_BINDING */ | 0x10 /* RENDER_ATTACHMENT */ }),
        source2: device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: 0x02 | 0x04 | 0x10 }),
        target: device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: 0x10 /* RENDER_ATTACHMENT */ | 0x01 /* COPY_SRC */ }),
        readback: device.createBuffer({ size: stride * H, usage: 0x01 /* MAP_READ */ | 0x08 /* COPY_DST */ }), stride, width: W, height: H,
      };
    }
    const z = s.size;
    if (first) device.queue.copyExternalImageToTexture({ source: first }, { texture: z.source, premultipliedAlpha: true }, [W, H]);
    else { const e0 = device.createCommandEncoder(); e0.beginRenderPass({ colorAttachments: [{ view: z.source.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] }).end(); device.queue.submit([e0.finish()]); }
    if (second) device.queue.copyExternalImageToTexture({ source: second }, { texture: z.source2, premultipliedAlpha: true }, [W, H]);
    let pipe = s.pipelines.get(key);
    if (!pipe) {
      const mod = device.createShaderModule({ code: shader() });
      pipe = device.createRenderPipeline({ layout: 'auto', vertex: { module: mod, entryPoint: 'v' }, fragment: { module: mod, entryPoint: 'f', targets: [{ format: 'rgba8unorm' }] } });
      s.pipelines.set(key, pipe);
    }
    const p = new Float32Array(8);
    p.set(numbers.slice(0, 8));
    device.queue.writeBuffer(s.uniforms, 0, p);
    const bind = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: z.source.createView() }, { binding: 1, resource: s.sampler }, { binding: 2, resource: { buffer: s.uniforms } }, ...(second ? [{ binding: 3, resource: z.source2.createView() }] : [])] });
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
