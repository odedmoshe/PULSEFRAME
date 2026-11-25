/**
 * What the «ייצוב תמונה» block shows and does, as pure functions over the document (wave 7 stabilise track). The component only
 * draws what these return. Nothing here measures anything: the camera motion is stored on the file's analysis record (core
 * steadyContract.ts) and the maths of the crop, the cover limit and the weaker places are core steady.ts, the same functions the
 * operation and the evaluator use, so the line the block shows while the slider moves is the line the commit will store.
 */
import * as T from '@pulseframe/time';
import {
  cameraMotionSummary, clipSourceFrames, isMovingPicture, measuredFrames, planStabilise, sourceFrameIndexAt, STEADY_DEFAULT_MAX_CROP, STEADY_DEFAULT_STRENGTH,
  STEADY_MIN_MEASURED_PERCENT, steadyPose, stretchEnd, type CameraMotion, type ClipStabilise, type MediaClip, type OpCall, type ProjectDocument, type SetClipStabiliseOutput,
  type StabilisePlan,
} from '@pulseframe/core';

export type BlockKind = 'still' | 'multicam' | 'not-measured' | 'off' | 'on';
/** The panel's data-state: the kind of the block, or what is happening to it now. */
export type PanelState = 'not-offered' | 'not-measured' | 'measuring' | 'on' | 'off' | 'limited' | 'refused';

export interface ReportItem {
  kind: 'weak' | 'unknown' | 'cut';
  /** Source frames [from, to) the run covers, clipped to the frames the clip shows. */
  from: number; to: number;
}
export interface StabiliseView {
  kind: BlockKind;
  /** The file's camera motion, when it has one. */
  motion: CameraMotion | undefined;
  measured: SetClipStabiliseOutput['measured'] | null;
  /** Whether the switch may be pressed without a measurement job (the file's motion covers every shown frame, and enough is measured). */
  switchable: boolean;
  /** The stored strength and zoom, when the clip is on. */
  stored: ClipStabilise | null;
  /** The crop and limits of what is stored (null when the clip is off or not offered). */
  plan: StabilisePlan | null;
  limited: { clip: boolean; reach: boolean };
  /** True when a window boundary (start or end of the file, or a cut) lies inside the frames the clip shows at the strength in use. */
  weakerNearEdges: boolean;
  report: ReportItem[];
  /** The clip plays faster than normal speed: slow sway then looks faster. */
  sped: boolean;
}

const asMedia = (c: unknown): MediaClip | null => (c && (c as { type?: string }).type === 'media' ? (c as MediaClip) : null);

/** Why the block is not offered for this clip, or null. */
export function notOffered(doc: ProjectDocument, clip: MediaClip): 'still' | 'multicam' | null {
  const asset = Object.hasOwn(doc.assets, clip.assetId) ? doc.assets[clip.assetId] : undefined;
  if (!isMovingPicture(asset)) return 'still';
  if (clip.multicam) return 'multicam';
  return null;
}

/** True when the file's motion covers every frame the clip shows and at least STEADY_MIN_MEASURED_PERCENT of them are measured. */
export function switchableFrom(measured: SetClipStabiliseOutput['measured'] | null): boolean {
  if (!measured || measured.frames <= 0) return false;
  return measured.outside === 0 && (measured.ok + measured.weak) * 100 >= STEADY_MIN_MEASURED_PERCENT * measured.frames;
}

/** True when the pose of any frame in [first, last] was computed from a window cut short by a boundary. */
export function weakerNearEdges(motion: CameraMotion, strength: number, rate: { num: number; den: number }, first: number, last: number): boolean {
  for (let f = first; f <= last; f++) { const p = steadyPose(motion, f, strength, rate); if (p.state !== 'outside' && p.boundary) return true; }
  return false;
}

/** The runs to review that fall inside [first, last] (weak, unknown, and a cut inside a stretch), ascending, clipped. */
export function reportItems(motion: CameraMotion, first: number, last: number, max = 40): { items: ReportItem[]; more: number } {
  const all: ReportItem[] = [];
  for (const r of cameraMotionSummary(motion).review) {
    const from = Math.max(r.from, first), to = Math.min(r.to, last + 1);
    if (from >= to) continue;
    all.push({ kind: r.state === 'start' ? 'cut' : r.state, from, to });
  }
  return { items: all.slice(0, max), more: Math.max(0, all.length - max) };
}

export function stabiliseView(doc: ProjectDocument, clipIn: unknown): StabiliseView | null {
  const clip = asMedia(clipIn);
  if (!clip) return null;
  const why = notOffered(doc, clip);
  const base = { motion: undefined, measured: null, switchable: false, stored: null, plan: null, limited: { clip: false, reach: false }, weakerNearEdges: false, report: [] as ReportItem[], sped: false };
  if (why) return { ...base, kind: why };
  const asset = doc.assets[clip.assetId]!;
  const motion = doc.analyses?.[clip.assetId]?.cameraMotion;
  const frames = clipSourceFrames(doc, clip);
  const measured = measuredFrames(motion, frames);
  const sped = !!clip.speed && clip.speed.num > clip.speed.den;
  const stored = clip.stabilise ?? null;
  const switchable = switchableFrom(measured);
  if (!motion || (!stored && !switchable)) return { ...base, kind: 'not-measured', motion, measured, sped };
  const rate = asset.video!.frameRate;
  const strength = stored?.strength ?? STEADY_DEFAULT_STRENGTH;
  const plan = stored ? planStabilise(doc, clip, { strength: stored.strength, zoomPm: stored.zoomPm }) : null;
  const rep = reportItems(motion, frames.first, frames.last);
  return {
    kind: stored ? 'on' : 'off', motion, measured, switchable, stored, plan,
    limited: { clip: !!plan?.limitedFrames.some((l) => l.reason === 'clip'), reach: !!plan?.limitedFrames.some((l) => l.reason === 'reach') },
    weakerNearEdges: weakerNearEdges(motion, strength, rate, frames.first, frames.last),
    report: rep.items, sped,
  };
}

/** The crop and limits at a strength the slider is on (the operation, given only the strength, stores exactly this zoom). */
export function previewPlan(doc: ProjectDocument, clip: MediaClip, strength: number): StabilisePlan {
  return planStabilise(doc, clip, { strength: Math.max(1, Math.min(100, Math.round(strength))) });
}
/** The value editor.previewStabilise shows for a plan. */
export const previewValue = (plan: StabilisePlan): ClipStabilise => ({ strength: plan.strength, zoomPm: plan.zoomPm });

/** The panel's data-state. A refusal on view wins over the others; a running job shows as measuring. */
export function panelState(view: StabiliseView, o: { measuring: boolean; refused: boolean }): PanelState {
  if (view.kind === 'still' || view.kind === 'multicam') return 'not-offered';
  if (o.measuring) return 'measuring';
  if (o.refused) return 'refused';
  if (view.kind === 'not-measured') return 'not-measured';
  if (view.kind === 'off') return 'off';
  return view.limited.clip ? 'limited' : 'on';
}

/** The zoom as the crop line says it: ×1.07 (two decimals). */
export const zoomText = (zoomPm: number): string => (zoomPm / 1000).toFixed(2);
/** The percentage as the crop line says it: one decimal, as the operation's areaPercent. */
export const percentText = (areaPercent: number): string => areaPercent.toFixed(1);

// ---------- strength memory and the run in progress (per clip, kept while the editor is open) ----------
const remembered = new Map<string, number>();
export const rememberStrength = (clipId: string, strength: number): void => { remembered.set(clipId, strength); };
export const rememberedStrength = (clipId: string): number | undefined => remembered.get(clipId);
export const forgetStrengths = (): void => { remembered.clear(); };
const runs = new Map<string, string>();
export const rememberRun = (clipId: string, jobId: string): void => { runs.set(clipId, jobId); };
export const rememberedRun = (clipId: string): string | undefined => runs.get(clipId);
export const forgetRun = (clipId: string): void => { runs.delete(clipId); };

// ---------- the operations the block commits ----------
/** The strength stored in the clip now, or the one it had when it was switched off, or the default. */
export const strengthToUse = (clip: MediaClip): number => clip.stabilise?.strength ?? rememberedStrength(clip.id) ?? STEADY_DEFAULT_STRENGTH;
/** Switch on a clip whose file is measured: its remembered strength as it was, or the one-press default with the crop limit. */
export function switchOnOp(clip: MediaClip): OpCall {
  const mem = rememberedStrength(clip.id);
  return { op: 'set_clip_stabilise', args: { clipId: clip.id, stabilise: mem !== undefined ? { strength: mem } : { strength: STEADY_DEFAULT_STRENGTH, maxCrop: STEADY_DEFAULT_MAX_CROP } } };
}
export const switchOffOp = (clip: MediaClip): OpCall => ({ op: 'set_clip_stabilise', args: { clipId: clip.id, stabilise: null } });
/** A strength change (and the recalculation of the crop at the strength in use): the zoom is left to the operation, which finds the smallest that covers. */
export const strengthOp = (clip: MediaClip, strength: number): OpCall => ({ op: 'set_clip_stabilise', args: { clipId: clip.id, stabilise: { strength: Math.max(1, Math.min(100, Math.round(strength))) } } });
/** The entity ids the commit depends on (steadyOps.ts: the editor and the job send dependsOn ['analysis:<assetId>']). */
export const dependsOnOf = (assetId: string): string[] => [`analysis:${assetId}`];

/** Clips of the document stabilised with a file's measurement. */
export function stabilisedClipsOf(doc: ProjectDocument, assetId: string): string[] {
  const ids: string[] = [];
  for (const seq of Object.values(doc.sequences)) for (const t of seq.tracks) for (const c of t.clips) if (c.type === 'media' && c.assetId === assetId && c.stabilise) ids.push(c.id);
  return ids;
}
/** remove_camera_motion for the clip's file: this clip alone using it is switched off with it (unbind); otherwise the operation refuses with the number in use. */
export function removeOp(doc: ProjectDocument, clip: MediaClip): OpCall {
  const users = stabilisedClipsOf(doc, clip.assetId);
  const only = users.length > 0 && users.every((id) => id === clip.id);
  return { op: 'remove_camera_motion', args: { assetId: clip.assetId, mode: only ? 'unbind' : 'if-unused' } };
}

// ---------- the job ----------
export const OPEN_JOB = new Set(['queued', 'running', 'cancel-requested']);
/** The progress of the measuring stage in percent, or null while it is not a count ('reading frames', 'saving camera motion'). */
export function stabiliseProgress(stage: string | null | undefined): { phase: 'reading' | 'measuring' | 'saving' | null; percent: number | null } {
  if (!stage) return { phase: null, percent: null };
  if (stage === 'reading frames') return { phase: 'reading', percent: null };
  if (stage === 'saving camera motion') return { phase: 'saving', percent: 100 };
  const m = /^measuring camera motion (\d+)\/(\d+)$/.exec(stage);
  if (!m) return { phase: null, percent: null };
  const done = Number(m[1]), total = Number(m[2]);
  return { phase: 'measuring', percent: Math.round((total > 0 ? Math.min(1, done / total) : 0) * 100) };
}

/**
 * The first timeline frame (project rate) at which THIS clip shows a source frame in [from, to), by scanning its own frames with
 * the evaluator's rule (core sourceFrameIndexAt), so speed, reverse, slips and freezes all name the right picture. null when it
 * shows none of them.
 */
export function jumpFrameIn(doc: ProjectDocument, clip: MediaClip, from: number, to: number): number | null {
  const asset = Object.hasOwn(doc.assets, clip.assetId) ? doc.assets[clip.assetId] : undefined;
  if (!asset?.video) return null;
  const rate = doc.settings.frameRate, a = { ...asset, video: asset.video };
  const first = T.frameIndexAt(clip.start, rate), n = Math.max(0, T.frameIndexAt(T.add(clip.start, clip.duration), rate) - first);
  for (let i = 0; i < n; i++) {
    const idx = sourceFrameIndexAt(a, clip, T.frameTime(first + i, rate), rate);
    if (idx >= from && idx < to) return first + i;
  }
  return null;
}

/** Whether the camera motion stretches hold a source frame (used to say a run lies in the measurement). */
export const stretchesHold = (motion: CameraMotion, frame: number): boolean => motion.stretches.some((s) => frame >= s.from && frame < stretchEnd(s));

/** Step of the keys on the slider: arrows ±1 (native), PageUp/PageDown ±10, Home 1, End 100. null for any other key. */
export function sliderKey(key: string, value: number): number | null {
  const clamp = (v: number) => Math.max(1, Math.min(100, v));
  if (key === 'PageUp') return clamp(value + 10);
  if (key === 'PageDown') return clamp(value - 10);
  if (key === 'Home') return 1;
  if (key === 'End') return 100;
  return null;
}

// ---------- following a run ----------
/** How often the block asks the server for its run when the event stream is not connected (the stream is the way; this is only the fallback). */
export const FALLBACK_POLL_MS = 2000;
/** The fallback read is needed only when the stream is down, or has told nothing of this run yet. */
export const needsFallbackRead = (streamOpen: boolean, stored: { status: string } | undefined | null): boolean => !streamOpen || !stored;
/** What a job event, as the store holds it, means for the block: still open, or how it ended. */
export type Settled =
  | { kind: 'open' }
  | { kind: 'done'; strengthLowered: boolean }
  | { kind: 'canceled' }
  | { kind: 'failed'; code: string; message: string };
export function settledOf(job: { status: string; output?: unknown; error?: { code?: string; message?: string } | null }): Settled {
  if (OPEN_JOB.has(job.status)) return { kind: 'open' };
  if (job.status === 'succeeded') return { kind: 'done', strengthLowered: !!(job.output as { strengthLowered?: boolean } | null)?.strengthLowered };
  if (job.status === 'canceled') return { kind: 'canceled' };
  return { kind: 'failed', code: job.error?.code ?? 'failed', message: job.error?.message ?? '' };
}
