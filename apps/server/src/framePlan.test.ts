/**
 * Frame-job planning (ADR-0017): exact ranges, chunk plans, output rates, held frames and every refusal before a job row exists.
 * Pure: documents are built from hand-made asset records (fixtures, labelled), no file is read.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, findClip, type MediaClip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { VIDEO_ENHANCE, VIDEO_SMOOTH_SLOWMO, type ComfyDescriptor } from '@pulseframe/providers';
import {
  admitFramePlan, buildFramePlan, chunkKeptFrames, chunkProviderFrames, chunkSourceFrames, frameOutputSize, outFactor, pairwiseChunkOutput, ramChunkFrames, rateText, resolveFrameSource, scratchBytes,
  type AdmitInput,
} from './framePlan.ts';
import { ApiError } from './store.ts';

let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `fp${n++}_`, actor: 'test', allowInternal });
const refused = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof ApiError) return `${e.status}:${e.code}${e.details.reason ? `:${e.details.reason}` : ''}`; throw e; } return 'accepted'; };
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
/** Fixture asset record (no file behind it). */
const videoAsset = (rate: { num: number; den: number }, frames: number, extra: Record<string, unknown> = {}) => ({
  kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${String(n).padStart(64, '0')}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4',
  duration: T.frameTime(frames, rate), video: { width: 640, height: 360, frameRate: rate, codec: 'h264', rotation: 0, frameCount: frames }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov, ...extra,
});
function project(projectRate: { num: number; den: number }, assetRate: { num: number; den: number }, frames: number) {
  let r = tx(createProject({ id: 'prj_fp', name: 'plan', frameRate: projectRate }), [{ op: 'import_asset', args: { asset: videoAsset(assetRate, frames) } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  return { doc: r.doc, assetId };
}

describe('pairwise plans: exact counts, rates and holds', () => {
  it('(N−1)·m+1 frames come from the chunks, plus m−1 trailing holds, = N·m; chunks overlap by one frame', () => {
    for (const [N, m, c] of [[60, 4, 48], [60, 2, 48], [48, 4, 48], [49, 4, 48], [150, 4, 48], [2, 2, 48], [1, 4, 48], [97, 2, 10]] as const) {
      const p = buildFramePlan({ mode: 'pairwise', firstFrame: 10, frameCount: N, rate: { num: 30, den: 1 }, width: 64, height: 36, chunkFrames: c, multiplier: m });
      const produced = p.chunks.reduce((s, _ch, k) => s + chunkKeptFrames(p, k), 0);
      expect(produced, `N=${N} m=${m}`).toBe((N - 1) * m + 1);
      expect(p.heldFrames, `N=${N} m=${m}`).toEqual(Array.from({ length: m - 1 }, (_, j) => (N - 1) * m + 1 + j));
      expect(produced + p.heldFrames.length, `N=${N} m=${m}`).toBe(N * m);
      expect(p.expectedOutputFrames).toBe(N * m);
      // every source frame is read, the overlap frames twice; each chunk after the first starts on the previous chunk's last frame
      expect(new Set(p.chunks.flatMap((_ch, k) => chunkSourceFrames(p, k)))).toEqual(new Set(Array.from({ length: N }, (_, i) => 10 + i)));
      for (let k = 1; k < p.chunks.length; k++) {
        expect(p.chunks[k]!.overlapIn).toBe(1);
        expect(p.chunks[k]!.first).toBe(p.chunks[k - 1]!.first + p.chunks[k - 1]!.count - 1);
        expect(chunkProviderFrames(p, k)).toBe(pairwiseChunkOutput(p.chunks[k]!.count, m));
      }
      expect(p.chunks.every((ch) => ch.count <= c)).toBe(true);
    }
  });
  it('30000/1001 × 4 gives outputRate 120000/1001 exactly; 25/1 × 2 gives 50/1', () => {
    const p = buildFramePlan({ mode: 'pairwise', firstFrame: 0, frameCount: 60, rate: { num: 30000, den: 1001 }, width: 320, height: 180, chunkFrames: 48, multiplier: 4 });
    expect(p.outputRate).toEqual({ num: 120000, den: 1001 });
    expect(rateText(p.outputRate)).toBe('120000/1001');
    expect(buildFramePlan({ mode: 'pairwise', firstFrame: 0, frameCount: 5, rate: { num: 50, den: 2 }, width: 2, height: 2, chunkFrames: 48, multiplier: 2 }).outputRate).toEqual({ num: 50, den: 1 });
    // the result is exactly as long as the source range: N·m frames at r·m = N / r
    expect(T.eq(T.frameTime(p.expectedOutputFrames, p.outputRate), T.frameTime(60, { num: 30000, den: 1001 }))).toBe(true);
  });
  it('pairs across a scene cut are held: their new frames repeat the frame before the cut', () => {
    const p = buildFramePlan({ mode: 'pairwise', firstFrame: 100, frameCount: 10, rate: { num: 25, den: 1 }, width: 8, height: 8, chunkFrames: 48, multiplier: 4, cuts: [50, 100, 104, 110, 200] });
    // only the cut at 104 lies inside (100, 110): the pair (103, 104) is output frames 12..16; 13, 14, 15 are held
    expect(p.heldFrames).toEqual([13, 14, 15, 37, 38, 39]);
  });
  it('per-frame and sampled plans', () => {
    const p = buildFramePlan({ mode: 'per-frame', firstFrame: 5, frameCount: 50, rate: { num: 24000, den: 1001 }, width: 8, height: 8, chunkFrames: 24 });
    expect(p.chunks.map((c) => [c.first, c.count, c.overlapIn])).toEqual([[5, 24, 0], [29, 24, 0], [53, 2, 0]]);
    expect(p).toMatchObject({ outputRate: { num: 24000, den: 1001 }, expectedOutputFrames: 50, heldFrames: [], multiplier: null });
    const s = buildFramePlan({ mode: 'sampled', firstFrame: 0, frameCount: 100, rate: { num: 30, den: 1 }, width: 8, height: 8, chunkFrames: 4, sampleFps: 3 });
    expect(s).toMatchObject({ sampleEvery: 10, expectedOutputFrames: 10, outputRate: { num: 3, den: 1 } });
    expect(chunkSourceFrames(s, 1)).toEqual([40, 50, 60, 70]);
    expect(s.chunks.reduce((t, c) => t + c.count, 0)).toBe(10);
  });
});

describe('chunk size follows the memory formula: budget / (W·H·3·4·(1 + outFactor))', () => {
  it('computes the bound and the factor per descriptor', () => {
    const GiB = 1024 ** 3;
    expect(ramChunkFrames(3 * GiB, 640, 360, 4)).toBe(Math.floor((3 * GiB) / (640 * 360 * 12 * 5)));
    expect(ramChunkFrames(3 * GiB, 640, 360, 4)).toBe(233);
    expect(outFactor(VIDEO_SMOOTH_SLOWMO, { multiplier: 4 })).toBe(4);
    expect(outFactor(VIDEO_SMOOTH_SLOWMO, { multiplier: 2 })).toBe(2);
    expect(outFactor(VIDEO_ENHANCE, { scale: 1 })).toBe(32); // x4 model output (16) plus the scaled copy (16)
    expect(outFactor(VIDEO_ENHANCE, { scale: 0.5 })).toBe(20); // 16 + 4
    // enhance at 640x360 with the default 3 GiB: 35 frames fit, so the descriptor's 24 is the chunk size
    expect(ramChunkFrames(3 * GiB, 640, 360, 32)).toBe(35);
    expect(Math.min(VIDEO_ENHANCE.frames!.chunkFrames, ramChunkFrames(3 * GiB, 640, 360, 32))).toBe(24);
    // a small budget makes smaller chunks
    expect(ramChunkFrames(256 * 1024 ** 2, 1280, 720, 4)).toBe(4);
  });
});

describe('clip and asset ranges map to exact frame ranges', () => {
  it('a 25 fps asset in a 30 fps project: the clip\'s source span, rounded outward to whole source frames', () => {
    const { doc, assetId } = project({ num: 30, den: 1 }, { num: 25, den: 1 }, 250);
    // the clip shows source 1/30 s .. 11/30 s (10 project frames from source time 1/30 s)
    const r = tx(doc, [{ op: 'add_clip', args: { assetId, start: T.frameTime(30, { num: 30, den: 1 }), sourceIn: T.rt(1, 30), duration: T.frameTime(10, { num: 30, den: 1 }) } }]);
    const clipId = r.results[0]!.output!.clipId as string;
    const s = resolveFrameSource(r.doc, { clipId });
    // floor(1/30 × 25) = 0; ceil(11/30 × 25 = 9.1667) = 10
    expect(s).toMatchObject({ assetId, clipId, firstFrame: 0, frameCount: 10, rate: { num: 25, den: 1 }, startFrames: 0, width: 640, height: 360, audio: { sampleRate: 48000, channels: 2 } });
    expect(T.eq(s.sourceRangeStart, T.ZERO)).toBe(true);
    // the result covers what the clip shows: [0, 10/25) ⊇ [1/30, 11/30)
    const clip = findClip(r.doc, clipId)!.clip as MediaClip;
    expect(T.lte(s.sourceRangeStart, clip.sourceIn)).toBe(true);
    expect(T.lte(T.rt(11, 30), T.add(s.sourceRangeStart, T.frameTime(s.frameCount, s.rate)))).toBe(true);
    // a clip that starts exactly on a source frame and ends exactly on one maps to exactly those frames
    const r2 = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: T.frameTime(90, { num: 30, den: 1 }), sourceIn: T.rt(2, 1), duration: T.rt(2, 1) } }]);
    expect(resolveFrameSource(r2.doc, { clipId: r2.results[0]!.output!.clipId as string })).toMatchObject({ firstFrame: 50, frameCount: 50 });
  });
  it('a clip at speed 2 reads twice the source; a transition into the next clip adds the frames it plays', () => {
    const R = { num: 30, den: 1 };
    const { doc, assetId } = project(R, R, 300);
    let r = tx(doc, [{ op: 'add_clip', args: { assetId, start: T.ZERO, sourceIn: T.frameTime(30, R), duration: T.frameTime(30, R), withLinkedAudio: false } }]);
    const a = r.results[0]!.output!.clipId as string;
    r = tx(r.doc, [{ op: 'set_clip_speed', args: { clipId: a, speed: 2 } }]);
    expect(resolveFrameSource(r.doc, { clipId: a })).toMatchObject({ firstFrame: 30, frameCount: 30 }); // 15 frames at speed 2
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: T.frameTime(15, R), sourceIn: T.frameTime(200, R), duration: T.frameTime(30, R), withLinkedAudio: false } }]);
    const b = r.results[0]!.output!.clipId as string;
    r = tx(r.doc, [{ op: 'set_transition', args: { clipId: b, type: 'dissolve', frames: 6 } }]);
    expect(resolveFrameSource(r.doc, { clipId: a })).toMatchObject({ firstFrame: 30, frameCount: 42 }); // + 6 frames at speed 2
  });
  it('a library asset maps to its range or all of its frames; a range past the end is refused', () => {
    const { doc, assetId } = project({ num: 30, den: 1 }, { num: 30000, den: 1001 }, 120);
    expect(resolveFrameSource(doc, { assetId })).toMatchObject({ firstFrame: 0, frameCount: 120, rate: { num: 30000, den: 1001 } });
    const s = resolveFrameSource(doc, { assetId, range: { firstFrame: 30, frameCount: 60 } });
    expect(s).toMatchObject({ firstFrame: 30, frameCount: 60, clipId: null });
    expect(T.eq(s.sourceRangeStart, T.rt(1001, 1000))).toBe(true); // 30 × 1001/30000 s
    expect(refused(() => resolveFrameSource(doc, { assetId, range: { firstFrame: 100, frameCount: 21 } }))).toBe('422:out_of_bounds');
    expect(refused(() => resolveFrameSource(doc, { assetId: 'ast_missing' }))).toBe('404:asset_not_found');
  });
  it('freeze, reversed and ramped clips are refused; so are sound clips and stills', () => {
    const R = { num: 30, den: 1 };
    const { doc, assetId } = project(R, R, 300);
    const place = (d: ProjectDocument, at: number) => { const r = tx(d, [{ op: 'add_clip', args: { assetId, start: T.frameTime(at, R), sourceIn: T.frameTime(30, R), duration: T.frameTime(30, R) } }]); return { doc: r.doc, clip: r.results[0]!.output!.clipId as string, sound: r.results[0]!.output!.audioClipId as string }; };
    let p = place(doc, 0);
    const reversed = tx(p.doc, [{ op: 'set_clip_reverse', args: { clipId: p.clip, reverse: true } }]).doc;
    expect(refused(() => resolveFrameSource(reversed, { clipId: p.clip }))).toBe('422:incompatible:reverse');
    const ramped = tx(p.doc, [{ op: 'set_clip_speed_ramp', args: { clipId: p.clip, from: 1, to: 0.5 } }]).doc;
    expect(refused(() => resolveFrameSource(ramped, { clipId: p.clip }))).toBe('422:incompatible:ramp');
    const frozen = structuredClone(p.doc);
    (findClip(frozen, p.clip)!.clip as MediaClip).freeze = true; // a freeze frame (built directly; the op that makes one splits the clip)
    expect(refused(() => resolveFrameSource(frozen, { clipId: p.clip }))).toBe('422:incompatible:freeze');
    expect(refused(() => resolveFrameSource(p.doc, { clipId: p.sound }))).toBe('422:incompatible');
    expect(refused(() => resolveFrameSource(p.doc, { clipId: 'clp_nope' }))).toBe('404:clip_not_found');
  });
});

describe('refusals before a job row exists', () => {
  const GiB = 1024 ** 3;
  const limits = { agentMaxFramesPerJob: 300, aiFirstRunMaxFrames: 60, aiConfirmMinutes: 10, aiScratchBytes: 2 * GiB };
  const admit = (d: ComfyDescriptor, over: Partial<AdmitInput> & { frames?: number; rate?: { num: number; den: number }; m?: number; w?: number; h?: number } = {}) => {
    const plan = buildFramePlan({ mode: d.frames!.mode, firstFrame: 0, frameCount: over.frames ?? 60, rate: over.rate ?? { num: 30, den: 1 }, width: over.w ?? 320, height: over.h ?? 180, chunkFrames: d.frames!.chunkFrames, multiplier: d.frames!.mode === 'pairwise' ? (over.m ?? 4) : null });
    return refused(() => admitFramePlan({ d, plan, agent: false, limits, measured: true, seconds: null, scratchBytes: scratchBytes(plan, frameOutputSize(d, { multiplier: over.m ?? 4, scale: 1 }, plan), true), freeBytes: 100 * GiB, ...over }));
  };
  it('a 60 fps source at 4x is refused (maxOutputRate 120); 30000/1001 at 4x is accepted', () => {
    expect(admit(VIDEO_SMOOTH_SLOWMO, { rate: { num: 60, den: 1 }, m: 4 })).toBe('422:output_rate_too_high');
    expect(admit(VIDEO_SMOOTH_SLOWMO, { rate: { num: 60000, den: 1001 }, m: 2 })).toBe('accepted'); // 119.88
    expect(admit(VIDEO_SMOOTH_SLOWMO, { rate: { num: 30000, den: 1001 }, m: 4 })).toBe('accepted');
  });
  it('maxFrames and maxPixels of the descriptor', () => {
    expect(admit(VIDEO_SMOOTH_SLOWMO, { frames: 151 })).toBe('422:input_too_large');
    expect(admit(VIDEO_SMOOTH_SLOWMO, { frames: 150 })).toBe('accepted');
    expect(admit(VIDEO_ENHANCE, { w: 1280, h: 720 })).toBe('422:input_too_large');
    expect(admit(VIDEO_ENHANCE, { w: 640, h: 360, frames: 60 })).toBe('accepted');
  });
  it('an agent over 300 frames gets 409 agent_limit; the owner does not', () => {
    expect(admit(VIDEO_ENHANCE, { frames: 300, agent: true })).toBe('accepted');
    const big = { ...VIDEO_ENHANCE, limits: { ...VIDEO_ENHANCE.limits, maxFrames: 1000 } };
    expect(admit(big, { frames: 301, agent: true, freeBytes: null, limits: { ...limits, aiScratchBytes: 100 * GiB } })).toBe('409:agent_limit');
    expect(admit(big, { frames: 301, agent: false, freeBytes: null, limits: { ...limits, aiScratchBytes: 100 * GiB } })).toBe('accepted');
  });
  it('the first run on this machine is capped at 60 frames until a measurement exists; a long estimate needs confirmation', () => {
    expect(admit(VIDEO_ENHANCE, { frames: 61, measured: false })).toBe('409:first_run_limit');
    expect(admit(VIDEO_ENHANCE, { frames: 60, measured: false })).toBe('accepted');
    expect(admit(VIDEO_ENHANCE, { frames: 61, measured: true })).toBe('accepted');
    expect(admit(VIDEO_ENHANCE, { seconds: 601 })).toBe('409:confirm_long_run');
    expect(admit(VIDEO_ENHANCE, { seconds: 601, confirmLongRun: true })).toBe('accepted');
    expect(admit(VIDEO_ENHANCE, { seconds: 599 })).toBe('accepted');
  });
  it('the scratch budget and the free space of the scratch volume', () => {
    expect(admit(VIDEO_ENHANCE, { limits: { ...limits, aiScratchBytes: 1000 } })).toBe('409:scratch_budget_exceeded');
    expect(admit(VIDEO_ENHANCE, { freeBytes: 1000 })).toBe('409:disk_insufficient');
  });
});

describe('frame output size follows the size contract', () => {
  it('enhance at scale 1 and 0.5; slow motion keeps the size', () => {
    const plan = { width: 320, height: 180 };
    expect(frameOutputSize(VIDEO_ENHANCE, { scale: 1 }, plan)).toEqual({ width: 1280, height: 720 });
    expect(frameOutputSize(VIDEO_ENHANCE, { scale: 0.5 }, plan)).toEqual({ width: 640, height: 360 });
    expect(frameOutputSize(VIDEO_SMOOTH_SLOWMO, { multiplier: 4 }, plan)).toEqual(plan);
  });
});
