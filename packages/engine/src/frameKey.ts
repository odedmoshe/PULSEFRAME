/**
 * The one key of the render cache (ADR-0024, plan §2 with the verifier's corrections): a frame's key is a digest of exactly what
 * the render page draws for it — the graph `evaluate` returns at the output size, without `audio` — plus what that frame reads
 * outside the graph (file and font bytes by content hash, effect versions, transition types, the GPU adapter when it runs a GPU
 * pass). A stale or unknown input is never guessed: it throws UnkeyableError and the segment is rendered every time.
 *
 * LEAD STUBS, final signatures. W1 (engine) owns the bodies; nothing here may be changed in shape without the lead.
 * The engine imports no crypto module: the digest is injected (the server passes node:crypto sha256).
 */
import type { ProjectDocument, UncacheableCode } from '@pulseframe/core';
import type { RenderGraph } from './evaluate.ts';

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

/**
 * Sorted keys, no whitespace, `undefined` object members omitted, numbers as JSON.stringify prints them.
 * NaN, +Infinity, -Infinity and -0 are ENCODED as tagged tokens written outside string quotes (`#NaN`, `#+Inf`, `#-Inf`, `#-0`),
 * which no JSON number or string can equal: flashSince is Infinity before a strobe's first flash (strobeSchedule.ts) and
 * heldOverlayParams gives `__speedLimit: Infinity` (overlays.ts), and both frames must stay cacheable.
 * Throws UnkeyableError('unkeyable_value', path) only for values with no stable encoding: function, symbol, bigint, Map, Set,
 * typed arrays / ArrayBuffer / DataView, and class instances (any object whose prototype is neither Object.prototype nor null, other than arrays).
 */
export function canonicalJson(value: unknown): string {
  void value;
  throw new Error('canonicalJson: not built yet (segment cache W1)');
}

/** A GPU pass's adapter as the render worker states it (RenderHost.identity). */
export interface GpuAdapterIdentity { adapter: string; software: boolean }

export interface FrameKeyContext {
  digest: Digest;
  /** Default: doc.mainSequenceId (wave-4 sequences pass theirs, on the projected document). */
  sequenceId?: string;
  /** The raster size the page draws at (render.ts: `{ ...g, width: outWidth, height: outHeight }`). */
  output: { width: number; height: number };
  /** Content hash of the stored bytes of an asset; null = not available (the frame is then unkeyable: asset_unhashed). */
  assetHash(assetId: string): string | null;
  /** Hash of the font files of a family; null = not bundled (asset_unhashed). */
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

/** Everything the frame reads outside the graph. Exhaustive switch over layer kinds (anything else: unknown_layer_kind). Throws UnkeyableError. */
export function frameInputs(doc: ProjectDocument, graph: RenderGraph, ctx: FrameKeyContext): FrameInputs {
  void doc; void graph; void ctx;
  throw new Error('frameInputs: not built yet (segment cache W1)');
}

/**
 * digest(FRAME_KEY_PREFIX + canonicalJson({ g, in })) where g = the graph with width/height replaced by ctx.output and WITHOUT
 * `audio` (the compositor never reads it; a gain change must not re-render pictures), and in = frameInputs.
 */
export function frameKeyOfGraph(doc: ProjectDocument, graph: RenderGraph, ctx: FrameKeyContext): string {
  void doc; void graph; void ctx;
  throw new Error('frameKeyOfGraph: not built yet (segment cache W1)');
}

/** evaluate(doc, frameTime(frameIndex, doc.settings.frameRate), ctx.sequenceId) then frameKeyOfGraph. `frameIndex` is a programme frame. */
export function frameKey(doc: ProjectDocument, frameIndex: number, ctx: FrameKeyContext): string {
  void doc; void frameIndex; void ctx;
  throw new Error('frameKey: not built yet (segment cache W1)');
}
