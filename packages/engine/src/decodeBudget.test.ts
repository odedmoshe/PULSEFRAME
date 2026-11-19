/**
 * Video decoders a frame needs at once (ADR-0011), counted the way drawGraph asks for pictures: a source frame that several
 * layers or taps of one frame show is decoded once (stacked copies of a clip, a freeze frame, taps held at the run start,
 * slow motion). maxDecodeLanes is the cheap upper bound; frameDecoders counts one frame exactly; decodeOverBudget lists
 * exactly the frames a pool of a given size refuses (decode_budget).
 * Node only: the real drawGraph runs on a stand-in context with a frame provider that records what it is asked for and
 * answers null (labelled test seam), so nothing is drawn and no decoder exists.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { evaluate, type VideoLayer } from './evaluate.ts';
import { drawGraph, frameDecoders, type Ctx2D, type FrameProvider } from './compositor2d.ts';
import { decodeOverBudget } from './decodeBudget.ts';
import { decodeLaneSteps, maxDecodeLanes } from './taps.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `db${n++}_`, actor: 'test', allowInternal });
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const video = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'9'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, provenance };
const still = { kind: 'image' as const, name: 'p.png', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance };

function base() {
  const r = tx(createProject({ id: 'prj_db', name: 'DB' }), [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: still } }], true);
  return { doc: r.doc, assetId: r.results[0]!.output!.assetId as string, stillId: r.results[1]!.output!.assetId as string };
}
/** A clip from source frame 0 (each on the first free video track), with a time effect when one is given. */
function clip(doc: ProjectDocument, assetId: string, start: number, duration: number, effect?: { type: string; params?: Record<string, unknown> }, extra: Record<string, unknown> = {}) {
  let r = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(start), duration: f(duration), ...extra } }]);
  const clipId = r.results[0]!.output!.clipId as string;
  if (effect) r = tx(r.doc, [{ op: 'add_effect', args: { clipId, type: effect.type, params: effect.params ?? {} } }]);
  return { doc: r.doc, clipId };
}
const echo5 = { type: 'time.echo', params: { count: 5 } }; // delay 3 (default)

/** Echo-5 copies of one clip at these starts, 40 frames each, one per track. */
function echoes(starts: number[]) {
  let { doc, assetId } = base();
  const ids: string[] = [];
  for (const s of starts) { const c = clip(doc, assetId, s, 40, echo5); doc = c.doc; ids.push(c.clipId); }
  return { doc, ids };
}

/** Documents that share pictures inside a frame in every way the evaluator makes them. */
function cases(): Record<string, ProjectDocument> {
  const out: Record<string, ProjectDocument> = {};
  out.stacked = echoes([0, 0, 0]).doc;
  out.staggered = echoes([0, 10, 20]).doc;
  {
    const { doc, assetId } = base();
    const a = clip(doc, assetId, 0, 90, { type: 'time.echo', params: { count: 4, delay: 2 } });
    out.freeze = tx(a.doc, [{ op: 'freeze_frame', args: { clipId: a.clipId, at: f(40), duration: f(30) } }]).doc;
  }
  {
    const { doc, assetId } = base();
    const a = clip(doc, assetId, 0, 60, echo5);
    const b = clip(a.doc, assetId, 60, 60, echo5, { sourceIn: T.rt(100, 30), trackId: a.doc.sequences[a.doc.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!.id });
    out.transition = tx(b.doc, [{ op: 'set_transition', args: { clipId: b.clipId, type: 'dissolve', frames: 15 } }]).doc;
  }
  {
    const { doc, assetId } = base();
    const a = clip(doc, assetId, 0, 60, { type: 'time.echo', params: { count: 5, delay: 1 } });
    // slow motion: neighbouring taps often show the same source frame, so the count wavers (2, 3, 2, …)
    out.slow = tx(a.doc, [{ op: 'set_clip_speed', args: { clipId: a.clipId, speed: 0.4 } }]).doc;
  }
  {
    const { doc, assetId, stillId } = base();
    const a = clip(doc, assetId, 0, 80, { type: 'time.split', params: { lag: 2 } });
    let d = tx(a.doc, [{ op: 'split_clip', args: { clipId: a.clipId, at: f(37) } }]).doc;
    d = clip(d, assetId, 10, 50, { type: 'time.shutter', params: { samples: 4 } }).doc;
    d = clip(d, assetId, 20, 40, { type: 'time.stutter', params: { hold: 3 } }).doc;
    d = clip(d, stillId, 5, 50, echo5).doc;
    out.mixed = d;
  }
  return out;
}
const lastFrame = (doc: ProjectDocument) => Math.max(0, ...doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips.map((c) => T.frameIndexAt(T.add(c.start, c.duration), R)))) + 2;
/** The upper bound (maxDecodeLanes' steps) on frame F. */
const boundAt = (doc: ProjectDocument, F: number) => { let v = 0; for (const [at, lanes] of decodeLaneSteps(doc)) { if (at > F) break; v = lanes; } return v; };

/** The decoders the real drawGraph asks a pool for on frame F: distinct (clip, lane) of the video pictures requested. */
async function askedByDrawGraph(doc: ProjectDocument, F: number): Promise<number> {
  const keys = new Set<string>();
  const frames: FrameProvider = Object.assign(async (l: Parameters<FrameProvider>[0]) => { if (l.kind === 'video') keys.add(`${l.clipId}:${l.lane ?? 0}`); return null; }, { begin: () => keys.clear() });
  const ctx = new Proxy({}, { get: () => () => {}, set: () => true }) as unknown as Ctx2D;
  await drawGraph(ctx, evaluate(doc, f(F)), frames);
  return keys.size;
}

describe('video decoders a frame needs', () => {
  it('frameDecoders equals what drawGraph asks the pool for, on every frame; maxDecodeLanes never counts fewer', async () => {
    for (const [name, doc] of Object.entries(cases())) {
      for (let F = 0; F < lastFrame(doc); F++) {
        const asked = await askedByDrawGraph(doc, F);
        expect({ name, F, n: frameDecoders(evaluate(doc, f(F))).count }).toEqual({ name, F, n: asked });
        expect(asked, `${name} frame ${F}`).toBeLessThanOrEqual(boundAt(doc, F));
      }
    }
  });

  it('decodeOverBudget lists exactly the frames that need more than the budget, with their peak and clips', () => {
    for (const [name, doc] of Object.entries(cases())) for (const budget of [1, 2, 3, 5, 7, 9, 12]) {
      const need = Array.from({ length: lastFrame(doc) }, (_, F) => frameDecoders(evaluate(doc, f(F))).count);
      const over = need.flatMap((x, F) => (x > budget ? [F] : []));
      const got = decodeOverBudget(doc, budget);
      expect({ name, budget, frames: got.flatMap((s) => Array.from({ length: s.toFrame - s.fromFrame }, (_, k) => s.fromFrame + k)) }).toEqual({ name, budget, frames: over });
      for (const s of got) expect(s.peak).toBe(Math.max(...need.slice(s.fromFrame, s.toFrame)));
      // stretches are separate (a frame within budget lies between two of them)
      for (let k = 1; k < got.length; k++) expect(got[k]!.fromFrame).toBeGreaterThan(got[k - 1]!.toFrame);
    }
    // slow motion wavers around a budget of 2: many short stretches
    expect(decodeOverBudget(cases().slow!, 2).length).toBeGreaterThan(5);
  });

  it('three echo-5 copies stacked at frame 0: the bound says 15, but they show the same pictures and need 7 (3 own + 4 shared taps); none is refused at 12', () => {
    const { doc } = echoes([0, 0, 0]);
    expect(maxDecodeLanes(doc)).toEqual({ lanes: 15, fromFrame: 0, toFrame: 40 });
    const need = Array.from({ length: 40 }, (_, F) => frameDecoders(evaluate(doc, f(F))).count);
    expect(Math.max(...need)).toBe(7);
    expect(need.slice(0, 13)).toEqual([3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7]); // taps held at the run start share its first picture
    expect(decodeOverBudget(doc, 12)).toEqual([]);
  });

  it('echo-5 clips at 0, 10 and 20: frames 24–39 need more than 12 (up to 15); 20–23 do not, though all three play there', () => {
    const { doc, ids } = echoes([0, 10, 20]);
    expect(maxDecodeLanes(doc)).toEqual({ lanes: 15, fromFrame: 20, toFrame: 40 });
    const need = Array.from({ length: 24 }, (_, k) => frameDecoders(evaluate(doc, f(18 + k))).count);
    expect(need.slice(0, 7)).toEqual([9, 9, 10, 11, 11, 12, 13]); // frames 18–24
    const [s, ...rest] = decodeOverBudget(doc, 12);
    expect(rest).toEqual([]);
    expect({ ...s!, clipIds: [...s!.clipIds].sort() }).toEqual({ fromFrame: 24, toFrame: 40, peak: 15, clipIds: [...ids].sort() });
  });

  it('a freeze frame with echo decodes one picture; a still and a title decode none', () => {
    const doc = cases().freeze!;
    const held = doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.type === 'media' && c.freeze)!;
    const F = T.frameIndexAt(held.start, R) + 10;
    expect((evaluate(doc, f(F)).layers[0] as VideoLayer).time?.taps.length).toBe(4); // the held picture keeps its echo
    expect(frameDecoders(evaluate(doc, f(F))).count).toBe(1);
    let r = tx(createProject({ id: 'prj_t', name: 'T' }), [{ op: 'add_text', args: { text: 'echo', start: f(0), duration: f(30) } }]);
    r = tx(r.doc, [{ op: 'add_effect', args: { clipId: r.results[0]!.output!.clipId as string, type: 'time.echo', params: {} } }]);
    expect(frameDecoders(evaluate(r.doc, f(20)))).toEqual({ count: 0, clipIds: [] });
    expect(decodeOverBudget(r.doc, 0)).toEqual([]);
  });
});
