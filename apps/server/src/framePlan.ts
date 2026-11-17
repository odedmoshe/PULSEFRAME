/**
 * Frame-job planning (ADR-0017, route R2). Pure: reads the document and the reviewed descriptor, never the disk or a provider.
 *
 * A frame job reads an exact half-open range [f0, f0 + N) of decoded picture frames of one video asset. Frame k of an asset is
 * shown at asset time (k + startOffsetFrames) / r, so the derived output's time zero is the asset time
 * sourceRangeStart = (f0 + startOffsetFrames) / r (exact). Output rates are exact rationals: r for per-frame, r·m for pairwise
 * (interpolated), r / s for sampled. Nothing here is measured in float seconds.
 *
 * Chunks: per-frame and sampled chunks are consecutive; pairwise chunks overlap by one frame so every pair is interpolated once
 * (the overlap's output frame is dropped when the chunk is collected). The chunk size is the descriptor's chunkFrames, bounded by the
 * provider's host memory: ComfyUI holds IMAGE batches as 32-bit floats, so one chunk needs about W·H·3·4·(1 + outFactor) bytes per
 * input frame, where outFactor counts the output pixels each input pixel becomes.
 */
import * as T from '@pulseframe/time';
import { clipEnd, findClip, isFreeze, isRamped, isReverse, sourceEnd, startOffsetFrames, timeOriginSeconds, toSourceSpan, type MediaClip, type ProjectDocument } from '@pulseframe/core';
import { expectedOutputSize, type ComfyDescriptor, type PixelSize } from '@pulseframe/providers';
import type { FramePlan, RunSource } from './aiContracts.ts';
import { ApiError } from './store.ts';

export interface Rate { num: number; den: number }
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
export const reduceRate = (r: Rate): Rate => { const g = gcd(r.num, r.den) || 1; return { num: r.num / g, den: r.den / g }; };
/** The exact text ffprobe prints as r_frame_rate for a constant rate (lowest terms). */
export const rateText = (r: Rate): string => { const x = reduceRate(r); return `${x.num}/${x.den}`; };
const ceilFrame = (t: T.RationalTime, r: Rate) => T.frameIndexAt(t, r) + (T.isFrameAligned(t, r) ? 0 : 1);

/** The exact source of a frame job, resolved from a clip or a library asset. Persisted in job.input.frameSource. */
export interface FrameSource {
  assetId: string;
  /** The clip the run was started on (its exact source span, plus the frames a transition after it plays), or null for a library asset. */
  clipId: string | null;
  trackId: string | null;
  /** Decoded-frame indices [firstFrame, firstFrame + frameCount) of the asset's first video stream. */
  firstFrame: number;
  frameCount: number;
  rate: Rate;
  width: number;
  height: number;
  /** Whole frames by which the asset's picture starts after its time zero (startOffsetFrames). */
  startFrames: number;
  /** Asset time of the output's time zero: (firstFrame + startFrames) / rate, exact. */
  sourceRangeStart: T.RationalTime;
  /** The asset's sound, copied back over exactly the same time range; null when it has none. */
  audio: { sampleRate: number; channels: number } | null;
  /** The file's own start time in seconds (Asset.timeOrigin; ffmpeg's raw timestamps minus this are asset times). */
  timeOrigin: number;
  /** How the asset's YCbCr colours are read when frames are extracted (the editor's reading: BT.709 unless the owner chose BT.601). */
  colourMatrix: 'auto' | 'bt709' | 'bt601';
}

/** Clips a frame job cannot replace: they do not show a stretch of source in order at one speed. */
function refuseClip(clip: MediaClip): void {
  if (isFreeze(clip)) throw new ApiError(422, 'incompatible', 'a freeze frame shows one picture; a frame job needs a clip that plays its source', { clipId: clip.id, reason: 'freeze' }, 'Run the tool on the clip before freezing it, or on its file in the library.');
  if (isReverse(clip)) throw new ApiError(422, 'incompatible', 'a clip that plays backwards cannot be processed as a frame job yet', { clipId: clip.id, reason: 'reverse' }, 'Play it forwards (set_clip_reverse), run the tool, then reverse it again.');
  if (isRamped(clip)) throw new ApiError(422, 'incompatible', 'a clip that changes speed gradually cannot be processed as a frame job yet', { clipId: clip.id, reason: 'ramp' }, 'Give it one speed first (set_clip_speed).');
}

/**
 * Map a run source to an exact frame range. A clip maps to the frames of its source span [sourceIn, sourceEnd) on the asset clock,
 * rounded outward to whole frames, plus the source frames a transition on the next adjacent clip plays from it (replace_clip_asset
 * requires the result to cover them). A library asset maps to its own range, or all of its frames.
 */
export function resolveFrameSource(doc: ProjectDocument, source: RunSource): FrameSource {
  let assetId: string, clipId: string | null = null, trackId: string | null = null;
  let range: { first: number; count: number } | null = null;
  let clip: MediaClip | null = null;
  if ('clipId' in source) {
    const f = findClip(doc, source.clipId);
    if (!f) throw new ApiError(404, 'clip_not_found', `clip ${source.clipId} not found`, { clipId: source.clipId });
    if (f.clip.type !== 'media') throw new ApiError(422, 'incompatible', 'only a clip that shows a file can be processed', { clipId: source.clipId });
    if (f.track.kind !== 'video') throw new ApiError(422, 'incompatible', 'this tool works on the picture; pick a clip on a picture track', { clipId: source.clipId, trackKind: f.track.kind });
    clip = f.clip;
    refuseClip(clip);
    assetId = clip.assetId;
    clipId = clip.id;
    trackId = f.track.id;
  } else assetId = source.assetId;
  const asset = Object.hasOwn(doc.assets, assetId) ? doc.assets[assetId] : undefined;
  if (!asset) throw new ApiError(404, 'asset_not_found', `asset ${assetId} is not in this project`, { assetId });
  if (asset.kind !== 'video' || !asset.video) throw new ApiError(422, 'incompatible', `this tool needs a video; ${assetId} is ${asset.kind}`, { assetId });
  const v = asset.video;
  if (!v.frameCount) throw new ApiError(422, 'incompatible', 'the number of frames of this video is not known, so an exact frame range cannot be planned', { assetId });
  const rate = reduceRate(v.frameRate);
  const startFrames = startOffsetFrames(v);
  if (clip) {
    let end = sourceEnd(clip);
    const track = findClip(doc, clip.id)!.track;
    const after = track.clips.find((c) => c.id !== clip!.id && T.eq(c.start, clipEnd(clip!)));
    if (after?.type === 'media' && after.transition) end = T.add(end, toSourceSpan(clip, T.frameTime(after.transition.frames, doc.settings.frameRate)));
    const f0 = Math.max(0, T.frameIndexAt(clip.sourceIn, rate) - startFrames);
    const f1 = Math.min(v.frameCount, ceilFrame(end, rate) - startFrames);
    if (f1 <= f0) throw new ApiError(422, 'incompatible', 'the clip shows no whole frame of its file', { clipId });
    range = { first: f0, count: f1 - f0 };
  } else if ('range' in source && source.range) {
    if (source.range.firstFrame + source.range.frameCount > v.frameCount) throw new ApiError(422, 'out_of_bounds', `frames ${source.range.firstFrame}–${source.range.firstFrame + source.range.frameCount - 1} are outside the video (${v.frameCount} frames)`, { assetId, frameCount: v.frameCount });
    range = { first: source.range.firstFrame, count: source.range.frameCount };
  } else range = { first: 0, count: v.frameCount };
  return {
    assetId, clipId, trackId, firstFrame: range.first, frameCount: range.count, rate, width: v.width, height: v.height, startFrames,
    sourceRangeStart: T.frameTime(range.first + startFrames, rate),
    audio: asset.audio ? { sampleRate: asset.audio.sampleRate, channels: asset.audio.channels } : null,
    timeOrigin: timeOriginSeconds(asset),
    colourMatrix: v.readColourAs === 'bt601' ? 'bt601' : v.untaggedColour ? 'bt709' : 'auto',
  };
}

/** Output pixels each input pixel of a chunk becomes inside the provider (for the memory bound). */
export function outFactor(d: ComfyDescriptor, params: Record<string, unknown>): number {
  const f = d.frames;
  if (f?.mode === 'pairwise') return Number(params[f.multiplierParam ?? ''] ?? 2);
  const exp = d.outputs.find((o) => o.mediaType === 'video')?.expectSize ?? null;
  if (exp && 'scaleOfInput' in exp) return exp.scaleOfInput.factor ** 2;
  if (exp && 'scaleOfInputByParam' in exp) {
    // the model's own output (base² pixels) is held while the scaled copy (base·k)² is made
    const k = Number(params[exp.scaleOfInputByParam.param] ?? 1);
    return exp.scaleOfInputByParam.base ** 2 + (exp.scaleOfInputByParam.base * k) ** 2;
  }
  return 1;
}
/** Frames of a chunk that fit the provider's host-memory budget: budget / (W·H·3·4·(1 + outFactor)), floored. */
export const ramChunkFrames = (budgetBytes: number, width: number, height: number, factor: number): number => Math.floor(budgetBytes / (width * height * 3 * 4 * (1 + factor)));

export interface PlanInput {
  mode: FramePlan['mode'];
  firstFrame: number;
  frameCount: number;
  rate: Rate;
  width: number;
  height: number;
  /** Already bounded by the memory budget. */
  chunkFrames: number;
  multiplier?: number | null;
  sampleFps?: number;
  /** Absolute source frame indices that start a new shot (scenes analysis); pairs across them are held, not interpolated. */
  cuts?: number[];
}
/** Output frames one pairwise chunk of `count` source frames produces (FrameInterpolate: (count − 1)·m + 1). */
export const pairwiseChunkOutput = (count: number, m: number) => (count - 1) * m + 1;

/** The persisted plan: chunks, exact output rate, exact output frame count and the held output frames. */
export function buildFramePlan(i: PlanInput): FramePlan {
  const N = i.frameCount;
  const c = Math.max(1, Math.floor(i.chunkFrames));
  const rate = reduceRate(i.rate);
  const chunks: FramePlan['chunks'] = [];
  if (i.mode === 'pairwise') {
    const m = i.multiplier ?? 0;
    if (!Number.isInteger(m) || m < 2) throw new ApiError(422, 'invalid_parameter', 'a pairwise frame plan needs a whole multiplier of at least 2', { multiplier: i.multiplier });
    if (c < 2 && N > 1) throw new ApiError(422, 'input_too_large', 'a pairwise chunk needs at least two frames', { chunkFrames: c });
    let first = i.firstFrame;
    const last = i.firstFrame + N - 1;
    for (let k = 0; ; k++) {
      const overlapIn: 0 | 1 = k === 0 ? 0 : 1;
      const count = Math.min(c, last - first + 1);
      chunks.push({ k, first, count, overlapIn });
      if (first + count - 1 >= last) break;
      first = first + count - 1; // the next chunk starts on this chunk's last frame
    }
    const held = new Set<number>();
    for (let j = (N - 1) * m + 1; j < N * m; j++) held.add(j); // trailing holds of the last frame
    for (const cut of i.cuts ?? []) {
      if (cut <= i.firstFrame || cut >= i.firstFrame + N) continue;
      const p = cut - 1 - i.firstFrame; // the pair (cut − 1, cut) straddles the cut: its new frames repeat frame cut − 1
      for (let j = 1; j < m; j++) held.add(p * m + j);
    }
    return {
      mode: 'pairwise', firstFrame: i.firstFrame, frameCount: N, rate, outputRate: reduceRate({ num: rate.num * m, den: rate.den }), width: i.width, height: i.height,
      multiplier: m, sampleEvery: null, chunks, expectedOutputFrames: N * m, heldFrames: [...held].sort((a, b) => a - b),
    };
  }
  if (i.mode === 'sampled') {
    const fps = i.sampleFps ?? 0;
    if (!(fps > 0)) throw new ApiError(422, 'invalid_parameter', 'a sampled frame plan needs a sampling rate', {});
    const every = Math.max(1, Math.round(rate.num / (rate.den * fps)));
    const samples = Math.ceil(N / every);
    for (let s = 0, k = 0; s < samples; s += c, k++) chunks.push({ k, first: i.firstFrame + s * every, count: Math.min(c, samples - s), overlapIn: 0 });
    return {
      mode: 'sampled', firstFrame: i.firstFrame, frameCount: N, rate, outputRate: reduceRate({ num: rate.num, den: rate.den * every }), width: i.width, height: i.height,
      multiplier: null, sampleEvery: every, chunks, expectedOutputFrames: samples, heldFrames: [],
    };
  }
  for (let s = 0, k = 0; s < N; s += c, k++) chunks.push({ k, first: i.firstFrame + s, count: Math.min(c, N - s), overlapIn: 0 });
  return { mode: 'per-frame', firstFrame: i.firstFrame, frameCount: N, rate, outputRate: rate, width: i.width, height: i.height, multiplier: null, sampleEvery: null, chunks, expectedOutputFrames: N, heldFrames: [] };
}
/** The source frame indices one chunk reads (pairwise chunks include their overlap frame). */
export const chunkSourceFrames = (plan: FramePlan, k: number): number[] => {
  const ch = plan.chunks[k]!;
  const step = plan.mode === 'sampled' ? plan.sampleEvery! : 1;
  return Array.from({ length: ch.count }, (_, j) => ch.first + j * step);
};
/** Output frames the provider returns for chunk k, before the overlap frame is dropped. */
export const chunkProviderFrames = (plan: FramePlan, k: number): number => {
  const ch = plan.chunks[k]!;
  return plan.mode === 'pairwise' ? pairwiseChunkOutput(ch.count, plan.multiplier!) : ch.count;
};
/** Output frames chunk k contributes after the overlap frame is dropped. */
export const chunkKeptFrames = (plan: FramePlan, k: number): number => chunkProviderFrames(plan, k) - plan.chunks[k]!.overlapIn;

/** The exact size of each output frame, by the descriptor's size contract (fails closed: an unresolvable contract throws). */
export function frameOutputSize(d: ComfyDescriptor, params: Record<string, unknown>, plan: Pick<FramePlan, 'width' | 'height'>): PixelSize {
  const out = d.outputs.find((o) => o.mediaType === 'video');
  if (!out?.expectSize) throw new ApiError(422, 'capability_blocked', 'a frame job must declare the size of its frames', { capabilityId: d.id });
  return expectedOutputSize(out.expectSize, params, (input) => (input === d.frames?.input ? { width: plan.width, height: plan.height } : null));
}

/**
 * Upper estimate of the scratch space a run needs at once: one staged chunk (PNG ≈ raw RGB), every collected output frame (PNG ≈ raw
 * RGB; held frames are hard links), the assembled file and the extracted sound. Labelled an estimate wherever it is shown.
 */
export function scratchBytes(plan: FramePlan, out: PixelSize, hasAudio: boolean): number {
  const png = (w: number, h: number) => Math.ceil(w * h * 3 * 1.1) + 4096;
  const biggestChunk = Math.max(...plan.chunks.map((c) => c.count));
  const produced = plan.expectedOutputFrames - plan.heldFrames.length + plan.chunks.length; // overlap frames are collected, then dropped
  const seconds = (plan.frameCount * plan.rate.den) / plan.rate.num;
  return biggestChunk * png(plan.width, plan.height) + produced * png(out.width, out.height) + Math.ceil((plan.expectedOutputFrames * out.width * out.height * 3) / 4) + (hasAudio ? Math.ceil(seconds * 48_000 * 2 * 2) + 4096 : 0);
}

export interface AdmitInput {
  d: ComfyDescriptor;
  plan: FramePlan;
  /** The caller is an agent (actor 'agent:…'): the agent caps apply. */
  agent: boolean;
  limits: { agentMaxFramesPerJob: number; aiFirstRunMaxFrames: number; aiConfirmMinutes: number; aiScratchBytes: number };
  /** A measurement of this capability exists for this machine (a measured profile or a recorded run); until then the first-run cap applies. */
  measured: boolean;
  /** Estimated seconds from a measurement, or null when there is none. */
  seconds: number | null;
  confirmLongRun?: boolean;
  scratchBytes: number;
  /** Free bytes on the scratch volume (statfs), or null when unknown. */
  freeBytes: number | null;
}
/**
 * Every refusal a frame plan can meet before a job row exists, in the order a person can act on them. Throws ApiError:
 * 422 input_too_large (maxPixels, maxFrames), 422 output_rate_too_high (maxOutputRate), 409 agent_limit (agent frame cap),
 * 409 first_run_limit, 409 confirm_long_run, 409 scratch_budget_exceeded, 409 disk_insufficient.
 */
export function admitFramePlan(a: AdmitInput): void {
  const { d, plan } = a;
  const px = plan.width * plan.height;
  if (d.limits.maxPixels && px > d.limits.maxPixels) throw new ApiError(422, 'input_too_large', `the video is ${plan.width}x${plan.height}; this tool is qualified up to ${d.limits.maxPixels} pixels per frame`, { width: plan.width, height: plan.height, maxPixels: d.limits.maxPixels });
  if (d.limits.maxFrames && plan.frameCount > d.limits.maxFrames) throw new ApiError(422, 'input_too_large', `the range has ${plan.frameCount} frames; this tool is qualified up to ${d.limits.maxFrames} per run`, { frames: plan.frameCount, maxFrames: d.limits.maxFrames }, 'Run it on a shorter range.');
  const maxRate = d.frames?.maxOutputRate ?? 120;
  if (plan.outputRate.num > maxRate * plan.outputRate.den) throw new ApiError(422, 'output_rate_too_high', `the result would play at ${rateText(plan.outputRate)} frames per second; this tool allows at most ${maxRate}`, { outputRate: plan.outputRate, maxOutputRate: maxRate }, 'Pick a smaller multiplier.');
  if (a.agent && plan.frameCount > a.limits.agentMaxFramesPerJob) throw new ApiError(409, 'agent_limit', `an agent may process at most ${a.limits.agentMaxFramesPerJob} frames per run; this range has ${plan.frameCount}`, { frames: plan.frameCount, limit: a.limits.agentMaxFramesPerJob }, 'Ask the owner to run it, or run a shorter range.');
  if (!a.measured && plan.frameCount > a.limits.aiFirstRunMaxFrames) throw new ApiError(409, 'first_run_limit', `this tool has not been measured on this machine yet, so a first run may process at most ${a.limits.aiFirstRunMaxFrames} frames; this range has ${plan.frameCount}`, { frames: plan.frameCount, limit: a.limits.aiFirstRunMaxFrames }, 'Run it once on a short range; its time is then measured and longer runs can be estimated.');
  if (a.seconds !== null && a.seconds > a.limits.aiConfirmMinutes * 60 && !a.confirmLongRun) throw new ApiError(409, 'confirm_long_run', `this run is estimated at ${Math.round(a.seconds / 60)} minutes (measured on this machine), more than ${a.limits.aiConfirmMinutes}`, { seconds: a.seconds, limitMinutes: a.limits.aiConfirmMinutes }, 'Confirm the long run (confirmLongRun: true), or run a shorter range.');
  if (a.scratchBytes > a.limits.aiScratchBytes) throw new ApiError(409, 'scratch_budget_exceeded', `this run needs about ${a.scratchBytes} bytes of scratch space; one job may use ${a.limits.aiScratchBytes}`, { scratchBytes: a.scratchBytes, limit: a.limits.aiScratchBytes }, 'Run it on a shorter range or at a smaller size.');
  if (a.freeBytes !== null && a.freeBytes < a.scratchBytes) throw new ApiError(409, 'disk_insufficient', `this run needs about ${a.scratchBytes} bytes of scratch space; ${a.freeBytes} are free`, { scratchBytes: a.scratchBytes, freeBytes: a.freeBytes }, 'Free some disk space and try again.');
}
