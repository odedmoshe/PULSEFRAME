/**
 * The one key of the render cache (ADR-0024, plan §2 with the verifier's corrections): a frame's key is a digest of exactly what
 * the render page draws for it — the graph `evaluate` returns at the output size, without `audio` — plus what that frame reads
 * outside the graph (file and font bytes by content hash, effect versions, transition types, the GPU adapter when it runs a GPU
 * pass). A stale or unknown input is never guessed: it throws UnkeyableError and the segment is rendered every time.
 *
 * LEAD STUBS, final signatures. W1 (engine) owns the bodies; nothing here may be changed in shape without the lead.
 * The engine imports no crypto module: the digest is injected (the server passes node:crypto sha256).
 */
import * as T from '@pulseframe/time';
import { lutRef, type ProjectDocument, type UncacheableCode } from '@pulseframe/core';
import { evaluate, type Layer, type RenderGraph, type TimeTap } from './evaluate.ts';
import { isGpuEffect, isGpuTransition, lutIdOf } from './gpu.ts';

export const FRAME_KEY_VERSION = 1;
/** Prefix of the hashed text of a frame key; bump FRAME_KEY_VERSION and this together. */
export const FRAME_KEY_PREFIX = 'pf-frame/1\n';
/** Lowercase hex SHA-256 of the UTF-8 bytes of `text`. Injected: the engine imports no crypto module. */
export type Digest = (text: string) => string;

/** The UncacheableCode values a key computation can raise (asset_unhashed: a null assetHash or fontHash). */
export type UnkeyableCode = Extract<UncacheableCode, 'unkeyable_value' | 'unknown_layer_kind' | 'gpu_not_reproducible' | 'asset_unhashed'>;
export class UnkeyableError extends Error {
  constructor(readonly code: UnkeyableCode, readonly path: string) {
    super(`${code} at ${path}`);
    this.name = 'UnkeyableError';
  }
}


/*
 * Tagged tokens for the numbers JSON cannot spell, and for `undefined` where it cannot be left out (an array slot, the top
 * level). They start with '#', which no JSON number, string, literal, array or object starts with, and they are written
 * outside string quotes, so no value can produce the same text: the string "#NaN" is written `"#NaN"`.
 */
const NAN = '#NaN';
const POS_INF = '#+Inf';
const NEG_INF = '#-Inf';
const NEG_ZERO = '#-0';
const UNDEF = '#undef';

type Path = (string | number)[];
const IDENT = /^[A-Za-z_$][\w$]*$/;
/** `$.g.layers[0].effects[1].params["x y"]`: where a value that cannot be keyed sits (built only when one is found). */
const pathText = (path: Path) => `$${path.map((p) => (typeof p === 'number' ? `[${p}]` : IDENT.test(p) ? `.${p}` : `[${JSON.stringify(p)}]`)).join('')}`;
const unkeyable = (path: Path, what: string) => new UnkeyableError('unkeyable_value', `${pathText(path)} (${what})`);

/** JSON.stringify's text for finite numbers (both use Number::toString), a tagged token for NaN, ±Infinity and -0. */
function numberText(n: number): string {
  if (n !== n) return NAN;
  if (n === Infinity) return POS_INF;
  if (n === -Infinity) return NEG_INF;
  if (n === 0 && 1 / n < 0) return NEG_ZERO;
  return String(n);
}

/** One serialisation: the text so far, where it is (for errors), the objects open on the way down (a cycle has no encoding), and the string leaves seen (the asset scan). */
interface Writer { out: string; path: Path; open: Set<object>; strings: Set<string> | null }

function write(w: Writer, v: unknown): void {
  switch (typeof v) {
    case 'string': w.out += JSON.stringify(v); w.strings?.add(v); return;
    case 'number': w.out += numberText(v); return;
    case 'boolean': w.out += v ? 'true' : 'false'; return;
    // object members that are undefined are left out before they get here; an array slot or the top level is tagged
    case 'undefined': w.out += UNDEF; return;
    case 'object': break;
    default: throw unkeyable(w.path, typeof v); // function, symbol, bigint
  }
  if (v === null) { w.out += 'null'; return; }
  if (w.open.has(v)) throw unkeyable(w.path, 'cycle');
  const proto = Object.getPrototypeOf(v) as unknown;
  if (Array.isArray(v)) {
    if (proto !== Array.prototype) throw unkeyable(w.path, 'array subclass');
    w.open.add(v);
    w.out += '[';
    for (let i = 0; i < v.length; i++) {
      if (i) w.out += ',';
      w.path.push(i);
      write(w, v[i]); // a hole reads as undefined
      w.path.pop();
    }
    w.out += ']';
    w.open.delete(v);
    return;
  }
  // Map, Set, typed arrays, ArrayBuffer, DataView, Date, RegExp, class instances: no stable encoding of what they hold
  if (proto !== Object.prototype && proto !== null) throw unkeyable(w.path, `instance of ${(v as { constructor?: { name?: string } }).constructor?.name || 'unknown class'}`);
  if (Object.getOwnPropertySymbols(v).length) throw unkeyable(w.path, 'symbol key');
  w.open.add(v);
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  w.out += '{';
  let first = true;
  for (const k of keys) {
    const x = o[k];
    if (x === undefined) continue;
    if (!first) w.out += ',';
    first = false;
    w.out += JSON.stringify(k);
    w.out += ':';
    w.path.push(k);
    write(w, x);
    w.path.pop();
  }
  w.out += '}';
  w.open.delete(v);
}

function serialize(value: unknown, at: Path, strings: Set<string> | null): string {
  const w: Writer = { out: '', path: at, open: new Set(), strings };
  write(w, value);
  return w.out;
}

/**
 * Sorted keys, no whitespace, `undefined` object members omitted, numbers as JSON.stringify prints them.
 * NaN, +Infinity, -Infinity and -0 are ENCODED as tagged tokens written outside string quotes (`#NaN`, `#+Inf`, `#-Inf`, `#-0`),
 * which no JSON number or string can equal: flashSince is Infinity before a strobe's first flash (strobeSchedule.ts) and
 * heldOverlayParams gives `__speedLimit: Infinity` (overlays.ts), and both frames must stay cacheable. `undefined` in an array
 * slot (or as the whole value) is the tagged token `#undef`, so `[undefined]` and `[null]` differ.
 * Throws UnkeyableError('unkeyable_value', path) only for values with no stable encoding: function, symbol, bigint, Map, Set,
 * typed arrays / ArrayBuffer / DataView, and class instances (any object whose prototype is neither Object.prototype nor null, other than arrays),
 * as well as a symbol-keyed member and a cycle.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, [], null);
}

/** A GPU pass's adapter as the render worker states it (RenderHost.identity). */
export interface GpuAdapterIdentity { adapter: string; software: boolean }

export interface FrameKeyContext {
  digest: Digest;
  /** Default: doc.mainSequenceId (wave-4 sequences pass theirs, on the projected document). */
  sequenceId?: string;
  /** The raster size the page draws at (render.ts: `{ ...g, width: outWidth, height: outHeight }`). */
  output: { width: number; height: number };
  /** Content hash of the stored bytes of an asset; null = not available (the frame is then unkeyable: asset_unhashed, as for anything but a non-empty string). Ids are free text: look them up with Object.hasOwn or a Map, never `table[id]`. */
  assetHash(assetId: string): string | null;
  /** Hash of the font files of a family; null = not bundled (asset_unhashed, as for anything but a non-empty string). Families are free text ("__proto__" included): look them up with Object.hasOwn or a Map. */
  fontHash(family: string): string | null;
  /** Registry version of an effect type (0 = unknown). */
  effectVersion(type: string): number;
  /**
   * The adapter GPU passes run on; null = unknown. A frame with a GPU pass (isGpuEffect / isGpuTransition) is keyable in wave 1
   * only when this is a software adapter; otherwise UnkeyableError('gpu_not_reproducible').
   */
  gpu: GpuAdapterIdentity | null;
}

export interface FrameInputs {
  /** assetId -> content hash: the explicit walk (video/image layers, time taps, colour tables via lutRef) plus every string leaf of the graph that is an own key of doc.assets. */
  assets: Record<string, string>;
  /** family -> font hash for text and caption layers. */
  fonts: Record<string, string>;
  /** effect type -> registry version, for every effect entry on every layer (adjustment layers and the time effect included). */
  effects: Record<string, number>;
  /** Transition types drawn in the frame, sorted. */
  transitions: string[];
  /** The adapter string when the frame runs a GPU pass (software only), else null. */
  gpu: string | null;
}

/** The graph exactly as the render page hands it to drawGraph, at the output size, without `audio`. */
function pictureOf(graph: RenderGraph, ctx: FrameKeyContext): Omit<RenderGraph, 'audio'> {
  // `audio` is left out on purpose: drawGraph (compositor2d.ts) never reads graph.audio, nor does anything it calls (look.ts,
  // gpu.ts); sound is mixed whole for every export, so a gain or sound-effect change must not re-render a single picture.
  const { audio: _sound, ...picture } = graph;
  return { ...picture, width: ctx.output.width, height: ctx.output.height };
}

/** Every string leaf of `v` (plain objects and arrays only): the over-inclusive asset scan, when no serialisation has collected them. */
function collectStrings(v: unknown, into: Set<string>): void {
  if (typeof v === 'string') { into.add(v); return; }
  if (typeof v !== 'object' || v === null) return;
  if (Array.isArray(v)) { for (const x of v) collectStrings(x, into); return; }
  for (const k in v) if (Object.hasOwn(v, k)) collectStrings((v as Record<string, unknown>)[k], into);
}

type Look = { effects?: { type: string; params: Record<string, unknown> }[] };
/**
 * What the frame reads outside the graph. `strings`: the graph's string leaves (without `audio`), for the over-inclusive scan.
 * Paths in errors are those of the key text (`$.g.layers[i]…`, `$.in.fonts…`).
 */
function inputsOf(doc: ProjectDocument, graph: RenderGraph, ctx: FrameKeyContext, strings: ReadonlySet<string>): FrameInputs {
  // null-prototype records: an asset id, font family or effect type is free text, and on a `{}` an assignment to "__proto__"
  // goes to the prototype setter (a string is ignored there), so that input would never be keyed. canonicalJson accepts them.
  const assets: Record<string, string> = Object.create(null) as Record<string, string>;
  const fonts: Record<string, string> = Object.create(null) as Record<string, string>;
  const effects: Record<string, number> = Object.create(null) as Record<string, number>;
  /** Only a non-empty string is a hash: a lookup that answers a prototype member (table["constructor"] on a `{}`) is not one. */
  const isHash = (h: unknown): h is string => typeof h === 'string' && h.length > 0;
  const transitions = new Set<string>();
  let gpuPass: string | null = null;
  const asset = (id: string, at: string) => {
    if (!id || Object.hasOwn(assets, id)) return;
    const hash = ctx.assetHash(id);
    if (!isHash(hash)) throw new UnkeyableError('asset_unhashed', `${at} (asset ${id})`);
    assets[id] = hash;
  };
  const font = (family: string, at: string) => {
    if (Object.hasOwn(fonts, family)) return;
    const hash = ctx.fontHash(family);
    if (!isHash(hash)) throw new UnkeyableError('asset_unhashed', `${at} (font ${family})`);
    fonts[family] = hash;
  };
  const effect = (type: string, params: Record<string, unknown>, at: string) => {
    if (!Object.hasOwn(effects, type)) effects[type] = ctx.effectVersion(type);
    // a colour table is read by asset id: core lutRef for color.lut, and gpu.ts lutIdOf for any table effect of the registry
    const table = lutIdOf(type, params) || lutRef({ type, params });
    if (table) asset(table, `${at}.params`);
    if (isGpuEffect(type)) gpuPass ??= at;
  };
  const lookOf = (l: Look, at: string) => l.effects?.forEach((e, k) => effect(e.type, e.params, `${at}.effects[${k}]`));
  /** A picture without look: the layer itself or a time tap (ADR-0011). */
  const bare = (l: TimeTap['layer'], at: string) => {
    switch (l.kind) {
      case 'video': case 'image': asset(l.assetId, `${at}.assetId`); return;
      case 'text': font(l.style.fontFamily, `${at}.style.fontFamily`); return;
      default: { const other: never = l; throw new UnkeyableError('unknown_layer_kind', `${at} (kind ${String((other as { kind?: unknown }).kind)})`); }
    }
  };
  graph.layers.forEach((layer: Layer, i) => {
    const at = `$.g.layers[${i}]`;
    switch (layer.kind) {
      case 'video': case 'image': case 'text': {
        bare(layer, at);
        lookOf(layer, at);
        if (layer.time) {
          effect(layer.time.type, layer.time.params, `${at}.time`);
          layer.time.taps.forEach((t, k) => bare(t.layer, `${at}.time.taps[${k}].layer`));
        }
        if (layer.remap) effect(layer.remap.type, {}, `${at}.remap`);
        if (layer.transition) {
          transitions.add(layer.transition.type);
          if (isGpuTransition(layer.transition.type)) gpuPass ??= `${at}.transition`;
        }
        return;
      }
      case 'adjust': lookOf(layer, at); return;
      case 'caption': font(layer.style.fontFamily, `${at}.style.fontFamily`); return;
      default: { const other: never = layer; throw new UnkeyableError('unknown_layer_kind', `${at} (kind ${String((other as { kind?: unknown }).kind)})`); }
    }
  });
  // over-inclusive: any string of the picture that names a library entry, so a future field that names an asset is keyed by default
  for (const s of strings) if (Object.hasOwn(doc.assets, s)) asset(s, `$.g (names asset ${s})`);
  let gpu: string | null = null;
  if (gpuPass) {
    if (!ctx.gpu || !ctx.gpu.software) throw new UnkeyableError('gpu_not_reproducible', `${gpuPass} (${ctx.gpu ? 'hardware' : 'unknown'} adapter)`);
    gpu = ctx.gpu.adapter;
  }
  return { assets, fonts, effects, transitions: [...transitions].sort(), gpu };
}

/** Everything the frame reads outside the graph. Exhaustive switch over layer kinds (anything else: unknown_layer_kind). Throws UnkeyableError. */
export function frameInputs(doc: ProjectDocument, graph: RenderGraph, ctx: FrameKeyContext): FrameInputs {
  const strings = new Set<string>();
  collectStrings(pictureOf(graph, ctx), strings);
  return inputsOf(doc, graph, ctx, strings);
}

/**
 * digest(FRAME_KEY_PREFIX + canonicalJson({ g, in })) where g = the graph with width/height replaced by ctx.output and WITHOUT
 * `audio` (the compositor never reads it; a gain change must not re-render pictures), and in = frameInputs.
 * The graph is serialised once: the same pass collects its strings for the asset scan, and the text is put together as
 * canonicalJson would ("g" sorts before "in").
 */
export function frameKeyOfGraph(doc: ProjectDocument, graph: RenderGraph, ctx: FrameKeyContext): string {
  const strings = new Set<string>();
  const g = serialize(pictureOf(graph, ctx), ['g'], strings);
  const inputs = serialize(inputsOf(doc, graph, ctx, strings), ['in'], null);
  return ctx.digest(`${FRAME_KEY_PREFIX}{"g":${g},"in":${inputs}}`);
}

/** evaluate(doc, frameTime(frameIndex, doc.settings.frameRate), ctx.sequenceId) then frameKeyOfGraph. `frameIndex` is a programme frame. */
export function frameKey(doc: ProjectDocument, frameIndex: number, ctx: FrameKeyContext): string {
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) throw new RangeError(`frameKey: frame ${frameIndex} is not a programme frame`);
  return frameKeyOfGraph(doc, evaluate(doc, T.frameTime(frameIndex, doc.settings.frameRate), ctx.sequenceId ?? doc.mainSequenceId), ctx);
}
