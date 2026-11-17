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
    expect(await gpuTransition({ type: 'ripple', progress: 0.5 }, picture, picture, out.ctx, env)).toBe(true);
    expect(Array.from(out.pixels()!.slice(0, 4))).toEqual(colourOf(2)); // pipeline 1 was the reference check
    expect(takeUnavailable()).toEqual({ effects: [], reasons: {} });
  });

  it('a transition whose shader does not compile is unavailable with the adapter\'s message, and leaves the picture alone instead of the last pass\'s pixels', async () => {
    const before = fakeContext();
    expect(await gpuTransition({ type: 'ripple', progress: 0.5 }, picture, picture, before.ctx, env)).toBe(true); // the readback now holds ripple's pixels
    fake.rules.brokenShader = (code) => code.includes(WHIP);
    const out = fakeContext();
    expect(await gpuTransition({ type: 'whip-left', progress: 0.5 }, picture, picture, out.ctx, env)).toBe(false);
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
      expect(await gpuTransition({ type: type, progress: 0.25 }, picture, picture, out.ctx, env)).toBe(false);
      expect(out.pixels()).toBeNull();
      const told = takeUnavailable();
      expect(told.effects).toEqual([type]);
      expect(told.reasons[type]).toMatch(/Error while parsing WGSL/);
    }
    expect(compiled()).toBe(first);
    const ok = fakeContext();
    expect(await gpuTransition({ type: 'ripple', progress: 0.5 }, picture, picture, ok.ctx, env)).toBe(true);
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
    expect(await gpuTransition({ type: 'checker', progress: 0.5 }, picture, picture, warm.ctx, env)).toBe(true);
    fake.rules.rejectBindGroups = true;
    const out = fakeContext();
    expect(await gpuTransition({ type: 'checker', progress: 0.5 }, picture, picture, out.ctx, env)).toBe(false);
    expect(out.pixels()).toBeNull();
    const told = takeUnavailable();
    expect(told.effects).toEqual(['checker']);
    expect(told.reasons.checker).toMatch(/rejected.*Binding doesn't exist/);
    expect(fake.scopes).toEqual([]);
    fake.rules.rejectBindGroups = false;
    const again = fakeContext();
    expect(await gpuTransition({ type: 'checker', progress: 0.5 }, picture, picture, again.ctx, env)).toBe(true);
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
    expect(await gpuTransition({ type: 'ripple', progress: 0.5 }, picture, picture, ok.ctx, env)).toBe(true);
    expect(takeUnavailable().effects).toEqual([]);
  });

  it('a frame larger than the adapter allows is unavailable with the adapter\'s message (not a failed map), and the next frame of an allowed size draws', async () => {
    fake.rules.maxSide = 32;
    const out = fakeContext();
    expect(await gpuTransition({ type: 'ripple', progress: 0.5 }, picture, picture, out.ctx, { ...env, width: 64, height: 16 })).toBe(false);
    expect(out.pixels()).toBeNull();
    const told = takeUnavailable();
    expect(told.effects).toEqual(['ripple']);
    expect(told.reasons.ripple).toMatch(/rejected.*Texture size \(64x16\) exceeds/);
    expect(fake.scopes).toEqual([]);
    const ok = fakeContext();
    expect(await gpuTransition({ type: 'ripple', progress: 0.5 }, picture, picture, ok.ctx, env)).toBe(true);
    expect(ok.pixels()).not.toBeNull();
    expect(fake.uncaptured).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// A static check of the WGSL the passes are made of.
//
// NOT a WGSL compiler. No adapter and no WGSL compiler (naga, tint) exists on the machine the unit tests run on, so the
// passes are compiled for real only on an adapter, by `pnpm proof:gpu` and `pnpm proof:trend-light`. What a compiler
// would reject in the part of WGSL the passes use is checked here instead: the syntax; every name declared before it is
// used, not twice in one scope and not a keyword or reserved word; `let` never assigned; the type of every expression
// under WGSL's rules (abstract numbers that become f32, i32 or u32, no implicit conversion between those, vector/scalar
// shapes, swizzles, the argument types of built-in and of the shader's own functions, constructors); conditions that are
// bool; and that a function with a result returns on every path. It is itself checked against every shader that has run
// on an adapter (the 39 transitions and the effects of earlier waves) and against broken shaders it must refuse.
// ---------------------------------------------------------------------------------------------------------------------
type Sc = 'f32' | 'i32' | 'u32' | 'bool' | 'AI' | 'AF';
type Ty = { k: 's'; s: Sc } | { k: 'v'; n: number; s: Sc } | { k: 'a'; e: Ty; n: number } | { k: 'st'; name: string } | { k: 'tex' } | { k: 'smp' } | { k: 'void' };
const sc = (s: Sc): Ty => ({ k: 's', s }), vec = (n: number, s: Sc): Ty => ({ k: 'v', n, s });
const show = (t: Ty): string => (t.k === 's' ? t.s : t.k === 'v' ? `vec${t.n}<${t.s}>` : t.k === 'a' ? `array<${show(t.e)},${t.n}>` : t.k === 'st' ? t.name : t.k === 'tex' ? 'texture_2d<f32>' : t.k === 'smp' ? 'sampler' : 'void');
const KEYWORDS = 'alias break case const const_assert continue continuing default diagnostic discard else enable false fn for if let loop override requires return struct switch true var while'.split(' ');
const RESERVED = ('NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto await become binding_array cast catch class co_await co_return co_yield coherent column_major common compile compile_fragment concept const_cast consteval constexpr constinit crate debugger decltype delete demote demote_to_helper do dynamic_cast enum explicit export extends extern external fallthrough filter final finally friend from fxgroup get goto groupshared highp impl implements import inline instanceof interface layout lowp macro macro_rules match mediump meta mod module move mut mutable namespace new nil noexcept noinline nointerpolation noperspective null nullptr of operator package packoffset partition pass patch pixelfragment precise precision premerge priv protected pub public readonly ref regardless register reinterpret_cast require resource restrict self set shared sizeof smooth snorm static static_assert static_cast std subroutine super target template this thread_local throw trait try type typedef typeid typename typeof union unless unorm unsafe unsized use using varying virtual volatile wgsl where with writeonly yield').split(' ');
const isF = (s: Sc) => s === 'f32' || s === 'AF', isInt = (s: Sc) => s === 'i32' || s === 'u32' || s === 'AI', isNum = (s: Sc) => s !== 'bool';
/** May a value of scalar type `a` be used where `b` is expected (WGSL's automatic conversion of abstract numbers)? */
const convS = (a: Sc, b: Sc) => a === b || (a === 'AI' && (b === 'i32' || b === 'u32' || b === 'f32' || b === 'AF')) || (a === 'AF' && b === 'f32');
function conv(a: Ty, b: Ty): boolean {
  if (a.k === 's' && b.k === 's') return convS(a.s, b.s);
  if (a.k === 'v' && b.k === 'v') return a.n === b.n && convS(a.s, b.s);
  if (a.k === 'a' && b.k === 'a') return a.n === b.n && conv(a.e, b.e) && conv(b.e, a.e);
  if (a.k === 'st' && b.k === 'st') return a.name === b.name;
  return a.k === b.k && (a.k === 'tex' || a.k === 'smp' || a.k === 'void');
}
const unifyS = (a: Sc, b: Sc): Sc | null => (convS(a, b) ? b : convS(b, a) ? a : null);
const concrete = (t: Ty): Ty => (t.k === 's' || t.k === 'v' ? { ...t, s: t.s === 'AI' ? 'i32' : t.s === 'AF' ? 'f32' : t.s } : t);
const elemOf = (t: Ty): Sc | null => (t.k === 's' || t.k === 'v' ? t.s : null);
const width = (t: Ty) => (t.k === 'v' ? t.n : t.k === 's' ? 1 : 0);
const withS = (t: Ty, s: Sc): Ty => (t.k === 'v' ? vec(t.n, s) : sc(s));

interface Tok { t: 'id' | 'num' | 'op'; v: string; line: number }
function lexWgsl(src: string): Tok[] {
  const out: Tok[] = [];
  const ops = ['<<=', '>>=', '&&', '||', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '++', '--', '->', '<<', '>>'];
  let i = 0, line = 1;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (src.startsWith('/*', i)) { const j = src.indexOf('*/', i + 2); if (j < 0) throw new Error(`line ${line}: unterminated comment`); line += src.slice(i, j).split('\n').length - 1; i = j + 2; continue; }
    const rest = src.slice(i, i + 80);
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (id) { out.push({ t: 'id', v: id[0], line }); i += id[0].length; continue; }
    const num = /^(0[xX][0-9a-fA-F]+[iu]?|(\d+\.\d*|\.\d+)([eE][+-]?\d+)?[fh]?|\d+[eE][+-]?\d+[fh]?|\d+[iufh]?)/.exec(rest);
    if (num) { out.push({ t: 'num', v: num[0], line }); i += num[0].length; continue; }
    const op = ops.find((o) => src.startsWith(o, i)) ?? c;
    if (!'(){}[];:,.<>=+-*/%&|^!~@'.includes(op[0]!)) throw new Error(`line ${line}: unexpected character ${JSON.stringify(c)}`);
    out.push({ t: 'op', v: op, line }); i += op.length;
  }
  return out;
}

interface Binding { ty: Ty; kind: 'let' | 'var' | 'const' | 'param' | 'uniform' | 'handle' }
interface Fn { params: Ty[]; ret: Ty }
interface Val { ty: Ty; place: 'var' | 'let' | null; call: boolean }
const SCALAR_NAMES: Record<string, Sc> = { f32: 'f32', i32: 'i32', u32: 'u32', bool: 'bool' };
const VEC_ALIAS: Record<string, Ty> = {};
for (const n of [2, 3, 4]) for (const [suffix, s] of [['f', 'f32'], ['i', 'i32'], ['u', 'u32']] as const) VEC_ALIAS[`vec${n}${suffix}`] = vec(n, s);
const TEMPLATED = new Set(['vec2', 'vec3', 'vec4', 'array', 'texture_2d', 'bitcast', 'ptr']);

/** Checks a WGSL module; throws an Error naming the line and the problem. */
function checkWgsl(src: string): void {
  const toks = lexWgsl(src);
  let pos = 0;
  const peek = (o = 0): Tok | undefined => toks[pos + o];
  const line = () => (peek() ?? toks[toks.length - 1])?.line ?? 0;
  const fail = (msg: string): never => { throw new Error(`line ${line()}: ${msg}`); };
  const is = (v: string, o = 0) => peek(o)?.v === v && peek(o)?.t !== 'num';
  const eat = (v: string) => { if (is(v)) { pos++; return true; } return false; };
  const expect = (v: string) => { if (!eat(v)) fail(`expected '${v}', found '${peek()?.v ?? 'end'}'`); };
  const ident = () => { const t = peek(); if (t?.t !== 'id') fail(`expected a name, found '${t?.v ?? 'end'}'`); pos++; return t!.v; };
  const structs = new Map<string, Map<string, Ty>>();
  const fns = new Map<string, Fn>();
  const scopes: Map<string, Binding>[] = [new Map()];
  const lookup = (name: string) => { for (let i = scopes.length - 1; i >= 0; i--) { const b = scopes[i]!.get(name); if (b) return b; } return undefined; };
  const declare = (name: string, b: Binding) => {
    if (KEYWORDS.includes(name) || RESERVED.includes(name)) fail(`'${name}' is a keyword or reserved word`);
    const top = scopes[scopes.length - 1]!;
    if (top.has(name)) fail(`'${name}' is declared twice in one scope`);
    top.set(name, b);
  };
  const skipAttributes = () => { while (eat('@')) { ident(); if (eat('(')) { let d = 1; while (d > 0) { const t = peek(); if (!t) fail('unclosed attribute'); pos++; if (t!.v === '(') d++; if (t!.v === ')') d--; } } } };

  // ---- types ----
  function closeTemplate() { if (is('>>')) { toks[pos] = { ...toks[pos]!, v: '>' }; return; } expect('>'); }
  function parseType(): Ty {
    const name = ident();
    if (SCALAR_NAMES[name]) return sc(SCALAR_NAMES[name]!);
    if (VEC_ALIAS[name]) return VEC_ALIAS[name]!;
    if (/^vec[234]$/.test(name)) { expect('<'); const e = parseType(); closeTemplate(); if (e.k !== 's') fail('vector of a non-scalar'); return vec(Number(name[3]), (e as { s: Sc }).s); }
    if (name === 'array') { expect('<'); const e = parseType(); expect(','); const n = peek(); if (n?.t !== 'num') fail('array length must be a number'); pos++; closeTemplate(); return { k: 'a', e, n: parseInt(n!.v, 10) }; }
    if (name === 'texture_2d') { expect('<'); const e = parseType(); closeTemplate(); if (!(e.k === 's' && e.s === 'f32')) fail('only texture_2d<f32> is modelled'); return { k: 'tex' }; }
    if (name === 'sampler') return { k: 'smp' };
    if (structs.has(name)) return { k: 'st', name };
    return fail(`unknown type '${name}'`);
  }

  // ---- expressions ----
  function binary(op: string, a: Ty, b: Ty): Ty {
    const ea = elemOf(a), eb = elemOf(b);
    if (ea === null || eb === null) return fail(`'${op}' on ${show(a)} and ${show(b)}`);
    if (a.k === 'v' && b.k === 'v' && a.n !== b.n) fail(`'${op}' on ${show(a)} and ${show(b)}`);
    const s = unifyS(ea, eb);
    if (s === null) return fail(`'${op}' mixes ${show(a)} and ${show(b)} (WGSL never converts between f32, i32 and u32)`);
    const shape = a.k === 'v' ? a : b;
    if (['==', '!=', '<', '<=', '>', '>='].includes(op)) {
      if (s === 'bool' && !['==', '!='].includes(op)) fail(`'${op}' on bool`);
      return withS(shape, 'bool');
    }
    if (['&&', '||'].includes(op)) { if (!(a.k === 's' && b.k === 's' && s === 'bool')) fail(`'${op}' needs two bools, got ${show(a)} and ${show(b)}`); return sc('bool'); }
    if (['&', '|', '^'].includes(op)) { if (!(isInt(s) || s === 'bool')) fail(`'${op}' on ${show(a)}`); if (a.k !== b.k) fail(`'${op}' on ${show(a)} and ${show(b)}`); return withS(shape, s); }
    if (s === 'bool') fail(`'${op}' on bool`);
    return withS(shape, s);
  }
  function shift(op: string, a: Ty, b: Ty): Ty {
    const ea = elemOf(a), eb = elemOf(b);
    if (ea === null || eb === null || !isInt(ea) || !(eb === 'u32' || eb === 'AI') || width(a) !== width(b)) fail(`'${op}' on ${show(a)} and ${show(b)}`);
    return a;
  }
  function primary(): Val {
    const t = peek();
    if (!t) return fail('unexpected end');
    if (t.t === 'num') {
      pos++;
      const v = t.v;
      const s: Sc = /[u]$/.test(v) ? 'u32' : /i$/.test(v) ? 'i32' : /[fh]$/.test(v) && !/^0[xX]/.test(v) ? 'f32' : /[.eE]/.test(v) && !/^0[xX]/.test(v) ? 'AF' : 'AI';
      return { ty: sc(s), place: null, call: false };
    }
    if (eat('(')) { const v = expr(); expect(')'); return { ty: v.ty, place: null, call: false }; }
    if (t.t !== 'id') return fail(`unexpected '${t.v}'`);
    if (t.v === 'true' || t.v === 'false') { pos++; return { ty: sc('bool'), place: null, call: false }; }
    // a type used as a constructor, or a templated built-in
    const start = pos;
    const name = ident();
    let tmpl: Ty | null = null;
    if (TEMPLATED.has(name) && is('<')) { pos = start; tmpl = name === 'bitcast' ? (ident(), expect('<'), (() => { const x = parseType(); closeTemplate(); return x; })()) : parseType(); }
    if (eat('(')) {
      const args: Ty[] = [];
      if (!eat(')')) { do { args.push(expr().ty); } while (eat(',')); expect(')'); }
      return { ty: call(name, tmpl, args), place: null, call: true };
    }
    if (tmpl) fail(`'${name}<…>' without arguments`);
    const b = lookup(name);
    if (!b) return fail(`'${name}' is not declared`);
    return { ty: b.ty, place: b.kind === 'var' ? 'var' : b.kind === 'let' || b.kind === 'param' || b.kind === 'const' ? 'let' : null, call: false };
  }
  function postfix(): Val {
    let v = primary();
    for (;;) {
      if (eat('.')) {
        const m = ident();
        if (v.ty.k === 'v') {
          const set = /^[xyzw]{1,4}$/.test(m) ? 'xyzw' : /^[rgba]{1,4}$/.test(m) ? 'rgba' : null;
          if (!set || [...m].some((ch) => set.indexOf(ch) >= (v.ty as { n: number }).n)) fail(`no component '${m}' in ${show(v.ty)}`);
          v = { ty: m.length === 1 ? sc(v.ty.s) : vec(m.length, v.ty.s), place: m.length === 1 ? v.place : null, call: false };
        } else if (v.ty.k === 'st') {
          const f = structs.get(v.ty.name)!.get(m);
          if (!f) fail(`no member '${m}' in ${v.ty.name}`);
          v = { ty: f!, place: v.place, call: false };
        } else fail(`'.${m}' on ${show(v.ty)}`);
      } else if (eat('[')) {
        const i = expr().ty;
        expect(']');
        if (!(i.k === 's' && isInt(i.s))) fail(`index of type ${show(i)}`);
        if (v.ty.k === 'a') v = { ty: v.ty.e, place: v.place, call: false };
        else if (v.ty.k === 'v') v = { ty: sc(v.ty.s), place: v.place, call: false };
        else fail(`index into ${show(v.ty)}`);
      } else return v;
    }
  }
  function unary(): Val {
    if (eat('-')) { const v = unary(); const e = elemOf(v.ty); if (e === null || e === 'bool' || e === 'u32') fail(`unary '-' on ${show(v.ty)}`); return { ty: v.ty, place: null, call: false }; }
    if (eat('!')) { const v = unary(); if (elemOf(v.ty) !== 'bool') fail(`'!' on ${show(v.ty)}`); return { ty: v.ty, place: null, call: false }; }
    if (eat('~')) { const v = unary(); const e = elemOf(v.ty); if (e === null || !isInt(e)) fail(`'~' on ${show(v.ty)}`); return { ty: v.ty, place: null, call: false }; }
    return postfix();
  }
  const LEVELS: string[][] = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!=', '<', '<=', '>', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
  function level(i: number): Val {
    if (i === LEVELS.length) return unary();
    let v = level(i + 1);
    while (peek()?.t === 'op' && LEVELS[i]!.includes(peek()!.v)) {
      const op = peek()!.v; pos++;
      const r = level(i + 1);
      v = { ty: op === '<<' || op === '>>' ? shift(op, v.ty, r.ty) : binary(op, v.ty, r.ty), place: null, call: false };
    }
    return v;
  }
  const expr = (): Val => level(0);

  // ---- calls: built-in functions, constructors and the module's own functions ----
  function same(name: string, args: Ty[], n: number, floatOnly: boolean): Ty {
    if (args.length !== n) fail(`${name} takes ${n} arguments, got ${args.length}`);
    let t = args[0]!;
    for (const a of args.slice(1)) {
      const s = elemOf(t) !== null && elemOf(a) !== null ? unifyS(elemOf(t)!, elemOf(a)!) : null;
      if (s === null || width(a) !== width(t)) fail(`${name}(${args.map(show).join(', ')}): the arguments must have one type`);
      t = withS(t, s!);
    }
    const e = elemOf(t);
    if (e === null || e === 'bool' || (floatOnly && !isF(e))) fail(`${name}(${args.map(show).join(', ')})`);
    return t;
  }
  function construct(target: Ty, args: Ty[], name: string): Ty {
    if (target.k === 's') {
      if (args.length === 0) return target;
      if (args.length !== 1 || args[0]!.k !== 's') fail(`${name}(${args.map(show).join(', ')})`);
      return target;
    }
    if (target.k === 'v') {
      if (args.length === 0) return target;
      if (args.length === 1 && args[0]!.k === 's') { if (!convS(args[0]!.s, target.s)) fail(`${name}(${show(args[0]!)}): a splat must have the element type`); return target; }
      if (args.length === 1 && args[0]!.k === 'v' && args[0]!.n === target.n) return target; // conversion of each component
      let count = 0;
      for (const a of args) { const e = elemOf(a); if (e === null || !convS(e, target.s)) fail(`${name}(${args.map(show).join(', ')}): ${show(a)} is not ${target.s}`); count += width(a); }
      if (count !== target.n) fail(`${name}(${args.map(show).join(', ')}): ${count} components for ${target.n}`);
      return target;
    }
    if (target.k === 'a') { if (args.length !== target.n || args.some((a) => !conv(a, target.e))) fail(`${name}(${args.map(show).join(', ')})`); return target; }
    return fail(`cannot construct ${show(target)}`);
  }
  function call(name: string, tmpl: Ty | null, args: Ty[]): Ty {
    const sig = (n: number) => { if (args.length !== n) fail(`${name} takes ${n} arguments, got ${args.length}`); };
    const own = fns.get(name);
    if (own) {
      if (args.length !== own.params.length) fail(`${name} takes ${own.params.length} arguments, got ${args.length}`);
      args.forEach((a, i) => { if (!conv(a, own.params[i]!)) fail(`argument ${i + 1} of ${name}: ${show(a)} is not ${show(own.params[i]!)}`); });
      return own.ret;
    }
    if (name === 'bitcast') { sig(1); const e = elemOf(args[0]!); if (!tmpl || e === null || e === 'bool' || width(args[0]!) !== width(tmpl)) fail('bitcast'); return tmpl!; }
    if (tmpl) return construct(tmpl, args, name);
    if (SCALAR_NAMES[name]) return construct(sc(SCALAR_NAMES[name]!), args, name);
    if (VEC_ALIAS[name]) return construct(VEC_ALIAS[name]!, args, name);
    if (structs.has(name)) { const f = [...structs.get(name)!.values()]; if (args.length !== f.length || args.some((a, i) => !conv(a, f[i]!))) fail(`${name}(…)`); return { k: 'st', name }; }
    if (['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'exp2', 'log', 'log2', 'sqrt', 'inverseSqrt', 'floor', 'ceil', 'fract', 'round', 'trunc', 'degrees', 'radians', 'saturate'].includes(name)) return same(name, args, 1, true);
    if (name === 'abs' || name === 'sign') return same(name, args, 1, false);
    if (['pow', 'atan2', 'step'].includes(name)) return same(name, args, 2, true);
    if (name === 'min' || name === 'max') return same(name, args, 2, false);
    if (name === 'clamp') return same(name, args, 3, false);
    if (name === 'smoothstep' || name === 'fma') return same(name, args, 3, true);
    if (name === 'mix') {
      sig(3);
      const ab = same(name, args.slice(0, 2), 2, true), t = args[2]!;
      if (t.k === 's' && ab.k === 'v') { if (unifyS(t.s, ab.s) === null || !isF(t.s)) fail(`mix(${args.map(show).join(', ')})`); return ab; }
      return same(name, args, 3, true);
    }
    if (name === 'length') { sig(1); const e = elemOf(args[0]!); if (e === null || !isF(e)) fail(`length(${show(args[0]!)})`); return sc(e!); }
    if (name === 'distance' || name === 'dot') { const t = same(name, args, 2, name === 'distance'); if (name === 'dot' && t.k !== 'v') fail('dot of scalars'); return sc(elemOf(t)!); }
    if (name === 'normalize') { const t = same(name, args, 1, true); if (t.k !== 'v') fail('normalize of a scalar'); return t; }
    if (name === 'select') {
      sig(3);
      const t = same(name, args.slice(0, 2), 2, false), c = args[2]!;
      if (!(elemOf(c) === 'bool' && (c.k === 's' || width(c) === width(t)))) fail(`select condition ${show(c)}`);
      return t;
    }
    if (name === 'textureSampleLevel') {
      sig(4);
      if (args[0]!.k !== 'tex' || args[1]!.k !== 'smp' || !conv(args[2]!, vec(2, 'f32')) || !conv(args[3]!, sc('f32'))) fail(`textureSampleLevel(${args.map(show).join(', ')})`);
      return vec(4, 'f32');
    }
    if (name === 'textureDimensions') { if (args.length < 1 || args.length > 2 || args[0]!.k !== 'tex' || (args[1] && !(args[1].k === 's' && isInt(args[1].s)))) fail('textureDimensions'); return vec(2, 'u32'); }
    if (name === 'textureLoad') { sig(3); const c = args[1]!; if (args[0]!.k !== 'tex' || !(c.k === 'v' && c.n === 2 && isInt(c.s)) || !(args[2]!.k === 's' && isInt((args[2] as { s: Sc }).s))) fail('textureLoad'); return vec(4, 'f32'); }
    return fail(`'${name}' is not a function`);
  }

  // ---- statements; each returns whether it always returns ----
  let fnRet: Ty = { k: 'void' };
  function declaration(): void {
    const kind = ident() as 'let' | 'var' | 'const';
    const name = ident();
    let ty: Ty | null = eat(':') ? parseType() : null;
    if (eat('=')) {
      const v = expr().ty;
      if (ty && !conv(v, ty)) fail(`${name}: ${show(v)} is not ${show(ty)}`);
      ty ??= kind === 'const' ? v : concrete(v);
    } else if (kind !== 'var' || !ty) fail(`${name} needs a value`);
    if (ty!.k === 'void') fail(`${name} has no value`);
    declare(name, { ty: ty!, kind });
  }
  function simple(): void {
    if (is('let') || is('var') || is('const')) return declaration();
    const v = unary();
    const op = peek()?.v ?? '';
    if (['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^='].includes(op)) {
      pos++;
      if (v.place !== 'var') fail(v.place === 'let' ? 'a let (or a parameter) cannot be assigned' : 'this cannot be assigned');
      const r = expr().ty;
      const result = op === '=' ? r : binary(op.slice(0, -1), v.ty, r);
      if (!conv(result, v.ty)) fail(`assigning ${show(result)} to ${show(v.ty)}`);
      return;
    }
    if (op === '++' || op === '--') { pos++; if (v.place !== 'var' || !(v.ty.k === 's' && isInt(v.ty.s))) fail(`'${op}' on ${show(v.ty)}`); return; }
    if (!v.call) fail('an expression that is not a call cannot be a statement');
  }
  function block(): boolean {
    expect('{');
    scopes.push(new Map());
    let returns = false;
    while (!eat('}')) { if (!peek()) fail('unclosed block'); returns = statement() || returns; }
    scopes.pop();
    return returns;
  }
  function condition() { const c = expr().ty; if (!(c.k === 's' && c.s === 'bool')) fail(`condition of type ${show(c)}`); }
  function statement(): boolean {
    if (is('{')) return block();
    if (eat('return')) {
      if (eat(';')) { if (fnRet.k !== 'void') fail('return without a value'); return true; }
      const v = expr().ty;
      if (!conv(v, fnRet)) fail(`returns ${show(v)} from a function that returns ${show(fnRet)}`);
      expect(';');
      return true;
    }
    if (eat('if')) {
      condition();
      const a = block();
      if (eat('else')) { const b = is('if') ? statement() : block(); return a && b; }
      return false;
    }
    if (eat('for')) {
      expect('(');
      scopes.push(new Map());
      if (!is(';')) simple();
      expect(';');
      if (!is(';')) condition();
      expect(';');
      if (!is(')')) simple();
      expect(')');
      block();
      scopes.pop();
      return false;
    }
    if (eat('while')) { condition(); block(); return false; }
    if (eat('loop')) { block(); return false; }
    if (eat('break') || eat('continue') || eat('discard')) { expect(';'); return false; }
    simple();
    expect(';');
    return false;
  }

  // ---- the module ----
  while (peek()) {
    skipAttributes();
    if (eat('struct')) {
      const name = ident();
      if (structs.has(name) || KEYWORDS.includes(name) || RESERVED.includes(name)) fail(`struct ${name}`);
      const fields = new Map<string, Ty>();
      expect('{');
      while (!eat('}')) { skipAttributes(); const f = ident(); expect(':'); if (fields.has(f)) fail(`member ${f} twice`); fields.set(f, parseType()); if (!eat(',')) { expect('}'); break; } }
      structs.set(name, fields);
      eat(';');
    } else if (eat('var')) {
      let kind: Binding['kind'] = 'handle';
      if (eat('<')) { const space = ident(); if (space !== 'uniform') fail(`address space ${space} is not modelled`); kind = 'uniform'; closeTemplate(); }
      const name = ident();
      expect(':');
      declare(name, { ty: parseType(), kind });
      expect(';');
    } else if (eat('fn')) {
      const name = ident();
      if (fns.has(name) || KEYWORDS.includes(name) || RESERVED.includes(name)) fail(`fn ${name}`);
      expect('(');
      const params: [string, Ty][] = [];
      if (!eat(')')) { do { skipAttributes(); const p = ident(); expect(':'); params.push([p, parseType()]); } while (eat(',')); expect(')'); }
      let ret: Ty = { k: 'void' };
      if (eat('->')) { skipAttributes(); ret = parseType(); }
      fns.set(name, { params: params.map((p) => p[1]), ret });
      fnRet = ret;
      scopes.push(new Map());
      for (const [p, ty] of params) declare(p, { ty, kind: 'param' });
      const returns = block();
      scopes.pop();
      if (ret.k !== 'void' && !returns) fail(`fn ${name} does not return a value on every path`);
    } else fail(`unexpected '${peek()!.v}' at module scope`);
  }
}

describe('static WGSL check of the passes (not a compiler: see checkWgsl)', () => {
  const fake = fakeGpu();
  const shaders = new Map<string, string>(); // transition id -> its whole shader module, as the adapter would receive it
  beforeAll(async () => {
    // a fresh copy of gpu.ts with its own (mock) device, so the shaders of every pass are seen once each
    vi.resetModules();
    vi.stubGlobal('navigator', { gpu: fake.gpu });
    vi.stubGlobal('OffscreenCanvas', class {});
    const g = await import('./gpu.ts');
    expect((await g.initGpu()).available).toBe(true);
    for (const id of Object.keys(g.GPU_TRANSITIONS)) {
      const before = fake.shaderModules.length;
      await g.gpuTransition({ type: id, progress: 0.5, light: 0.5, color: '#FF9A4A', seed: 3 }, picture, picture, fakeContext().ctx, env);
      // variants of one kernel share its pipeline: take the module of the kernel's first variant
      shaders.set(id, fake.shaderModules.slice(before).find((c) => c.includes('fn transition(')) ?? [...shaders.entries()].find(([other]) => g.GPU_TRANSITIONS[other]!.kernel === g.GPU_TRANSITIONS[id]!.kernel)![1]);
    }
    return () => vi.unstubAllGlobals();
  });

  it('every one of the 46 GPU transitions has a written kernel: no body says PLACEHOLDER', () => {
    expect(shaders.size).toBe(46);
    for (const [id, code] of shaders) expect(code, id).not.toMatch(/PLACEHOLDER/);
  });

  it('every transition shader passes the check: the 39 that have compiled on adapters and the 7 trend-pack ones (film-burn, light-leak, ink-bleed, brush, page-turn)', () => {
    for (const [id, code] of shaders) expect(() => checkWgsl(code), id).not.toThrow();
  });

  it('the effect shaders of earlier waves pass it too (a check of the checker against code that has compiled on adapters)', async () => {
    const g = await import('./gpu.ts');
    for (const [type, fx] of Object.entries(g.GPU_EFFECTS)) {
      const before = fake.shaderModules.length;
      const strip = { key: `k-${type}`, size: 2, width: 4, height: 2, data: new Uint8Array(4 * 2 * 4) };
      await g.gpuEffect(type, fx.lut ? { [fx.lut]: 'a1' } : {}, picture, fakeContext().ctx, { ...env, luts: new Map([['a1', strip]]) });
      const code = fake.shaderModules.slice(before).find((c) => c.includes('fn effect('));
      expect(code, type).toBeDefined();
      expect(() => checkWgsl(code!), type).not.toThrow();
    }
  });

  it('reads the whole of each trend-pack kernel: a fault put into any of them is found', () => {
    const KEEP = 'if (keep != keep) { return vec4f(0.0); }';
    for (const id of ['film-burn', 'light-leak', 'ink-bleed', 'brush-left', 'page-turn-right']) {
      const code = shaders.get(id)!;
      expect(code).toContain(KEEP);
      const lastReturn = code.lastIndexOf('return', code.indexOf('@fragment'));
      for (const fault of [
        code.replace(KEEP, `${KEEP} let light = 1.0;`), // a name of transition() declared again
        code.replace(KEEP, `${KEEP} let q0: u32 = p;`), // an f32 where a u32 is declared
        code.slice(0, lastReturn) + 'return vec3f(1.0) * ' + code.slice(lastReturn + 'return'.length), // the body's last result times a vec3
      ]) expect(() => checkWgsl(fault), id).toThrow();
    }
  });

  it('refuses what a WGSL compiler refuses', () => {
    const wrap = (body: string) => `
      fn hash(x: u32) -> u32 { return x * 747796405u; }
      fn t(uv: vec2f, p: f32, seed: u32) -> vec4f {${body}
      }`;
    expect(() => checkWgsl(wrap('let a = 1.0; return vec4f(a);'))).not.toThrow();
    const bad: Record<string, string> = {
      'an undeclared name': 'return vec4f(dirr);',
      'a let assigned': 'let a = 1.0; a = 2.0; return vec4f(a);',
      'f32 and u32 mixed': 'let a = p + seed; return vec4f(a);',
      'f32 times i32': 'let i = 2; return vec4f(p * i);',
      'the wrong result type': 'return uv.xyy;',
      'a name declared twice': 'let a = 1.0; let a = 2.0; return vec4f(a);',
      'a reserved word': 'let from = 1.0; return vec4f(from);',
      'a path without return': 'if (p > 0.5) { return vec4f(1.0); }',
      'a swizzle out of range': 'return vec4f(uv.z);',
      'a built-in with too few arguments': 'return vec4f(smoothstep(0.0, p));',
      'a u32 loop counter against an f32': 'var s = 0.0; for (var i = 0u; i < p; i++) { s += 1.0; } return vec4f(s);',
      'an f32 condition': 'if (p) { return vec4f(1.0); } return vec4f(0.0);',
      'a vec2 where a vec4 is expected': 'return vec4f(uv, uv, 1.0);',
      'an own function with the wrong argument type': 'return vec4f(f32(hash(p)));',
      'a splat of the wrong type': 'return vec4f(vec3f(seed), 1.0);',
      'unary minus on u32': 'return vec4f(f32(-seed));',
    };
    for (const [what, body] of Object.entries(bad)) expect(() => checkWgsl(wrap(body)), what).toThrow();
  });
});
