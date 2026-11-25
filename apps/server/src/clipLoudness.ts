/**
 * Loudness of single clips (wave 7, track send): POST /api/v1/projects/:id/analysis/clip-loudness and MCP measure_clip_loudness.
 * Worker A's file. The body schema and the signature are the lead's contract. Read-only.
 *
 * The measurement (send-plan §4.5, send-decisions C15): each clip alone through the export mixer — mixToRaw with a one-clip plan
 * (its effects, speed, fades, volume keys, clip × track gain, balance; ducking set flat, because ducking depends on the other
 * tracks) — over the samples the clip sounds (its tail included), then ffmpeg's EBU R128 meter and the sample peak of that mix.
 * Under 0.4 s a clip is too_short (not measured: the R128 gate needs 0.4 s blocks); under 3 s it is short (measured, less
 * reliable); a clip whose mix is below the R128 absolute gate is silent. A clip on a track that does not sound (muted or hidden)
 * mixes to nothing and is reported silent. The result carries the project revision (commit the match with expectedRevision) and
 * each clip's gain at measurement (the op's second, gain-only guard).
 * Refusals: an unknown clip 404 not_found; a clip that is not a media clip with sound on a sound track 422 incompatible (the op's
 * own wording, core SEND_REFUSALS.notSound); more than one hour of clips 422 too_long (the programme measurement's limit).
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import * as T from '@pulseframe/time';
import { LOUDNESS_MATCH, medianLufs, own, SEND_API_REFUSALS, SEND_REFUSALS, timeOriginSeconds, type ClipLoudnessResult, type ClipLoudnessRow } from '@pulseframe/core';
import { audioPlan, soundEnd, type AudioPlan, type PlannedAudioClip } from '@pulseframe/engine';
import { measureLoudness, mixToRaw } from './audiomix.ts';
import { heavy } from './analysis.ts';
import { outputDoc } from './export.ts';
import { ApiError, type Store } from './store.ts';

export const ClipLoudnessBody = z.object({
  clipIds: z.array(z.string()).min(1).max(LOUDNESS_MATCH.maxClips).describe('The clips to measure (sound clips on sound tracks)'),
  sequenceId: z.string().optional().describe('The sequence the clips are in; absent = the main edit'),
  background: z.boolean().optional().describe('Run as a durable analysis job (202 with a jobId)'),
}).strict();
export type ClipLoudnessBodyT = z.infer<typeof ClipLoudnessBody>;
export const CLIP_LOUDNESS_BUILT = true;
const A = SEND_API_REFUSALS.clipLoudnessNotBuilt;
export const clipLoudnessNotBuilt = () => new ApiError(A.status, A.code, A.message(), {}, A.hint);

export const CLIP_LOUDNESS_METHOD = 'each clip mixed alone exactly as export mixes it (its effects, speed, fades, volume keys, clip and track gain; ducking left out), then ffmpeg ebur128 (EBU R128 / ITU-R BS.1770) integrated loudness and the sample peak of that mix; LUFS is a measurement, not how loud it feels';

/** A plan holding one clip, ducking flat (1 over the whole clip and its tail). Everything else as the export plans it. */
export function soloPlan(plan: AudioPlan, clip: PlannedAudioClip): AudioPlan {
  const len = soundEnd(clip) - clip.at;
  const { limiter: _l, ...rest } = plan;
  void _l;
  return { ...rest, loudness: null, clips: [{ ...clip, duck: [{ s: 0, g: 1 }, { s: len, g: 1 }] }] };
}

/** Whether `seconds` (exact) is under a rational limit. */
const under = (t: T.RationalTime, lim: { num: number; den: number }) => T.lt(t, T.rt(lim.num, lim.den));

/** Measure each clip as export would mix it alone. Read-only. */
export async function measureClipLoudness(store: Store, projectId: string, body: ClipLoudnessBodyT, isCanceled: () => boolean = () => false): Promise<ClipLoudnessResult> {
  const stored = store.getProject(projectId);
  const seqId = body.sequenceId;
  if (seqId !== undefined && !own(stored.doc.sequences, seqId)) throw new ApiError(404, 'not_found', `sequence ${seqId} not found`, { sequenceId: seqId }, 'Name a sequence of this project, or leave sequenceId out for the main edit.');
  const doc = outputDoc(stored.doc, { sequenceId: seqId });
  const seq = doc.sequences[doc.mainSequenceId]!;
  const plan = audioPlan(doc);
  // find every clip first: a refusal changes and measures nothing
  const wanted: { clipId: string; duration: T.RationalTime; gain: number; planned: PlannedAudioClip | undefined }[] = [];
  const seen = new Set<string>();
  for (const id of body.clipIds) {
    if (seen.has(id)) { const R = SEND_REFUSALS.duplicate; throw new ApiError(400, R.code, R.message(id), { clipId: id }, R.hint); }
    seen.add(id);
    let hit: { clip: (typeof seq.tracks)[number]['clips'][number]; kind: string } | null = null;
    for (const tr of seq.tracks) { const c = tr.clips.find((x) => x.id === id); if (c) { hit = { clip: c, kind: tr.kind }; break; } }
    if (!hit) throw new ApiError(404, 'not_found', `clip ${id} not found${seqId ? ` in sequence ${seqId}` : ' in the main edit'}`, { clipId: id }, 'Name clips of this sequence; the project may have changed since you looked.');
    const c = hit.clip;
    if (c.type !== 'media' || hit.kind !== 'audio' || !doc.assets[c.assetId]?.audio) { const R = SEND_REFUSALS.notSound; throw new ApiError(422, R.code, R.message(id), { clipId: id }, R.hint); }
    wanted.push({ clipId: id, duration: c.duration, gain: c.gain, planned: plan.clips.find((p) => p.clipId === id) });
  }
  const totalSeconds = wanted.reduce((s, w) => s + T.toSeconds(w.duration), 0);
  if (totalSeconds > 3600) throw new ApiError(422, 'too_long', 'clip loudness measurement is limited to one hour of clips per request', { seconds: Number(totalSeconds.toFixed(3)) }, 'Measure fewer clips at a time.');
  const rows: ClipLoudnessRow[] = [];
  await heavy(async () => {
    for (const w of wanted) {
      if (isCanceled()) throw new Error('canceled');
      const seconds = Number(T.toSeconds(w.duration).toFixed(3));
      const base = { clipId: w.clipId, gain: w.gain, seconds };
      if (under(w.duration, LOUDNESS_MATCH.tooShortSeconds)) { rows.push({ ...base, status: 'too_short', measuredLufs: null, peakDbfs: null }); continue; }
      if (!w.planned) { rows.push({ ...base, status: 'silent', measuredLufs: null, peakDbfs: null }); continue; } // its track does not sound
      const clip = w.planned, solo = soloPlan(plan, clip), frames = soundEnd(clip) - clip.at;
      const raw = path.join(store.tmpDir, `clipl_${projectId}_${stored.revision}_${clip.clipId}_${Date.now()}.f32`);
      try {
        const { peak } = await mixToRaw(solo, (assetId) => store.blobPath(doc.assets[assetId]!.contentHash), clip.at, frames, raw, isCanceled, (assetId) => timeOriginSeconds(doc.assets[assetId]), (assetId) => doc.assets[assetId]?.audio?.channels === 1);
        const m = await measureLoudness(raw, plan.sampleRate);
        const peakDbfs = peak > 0 ? Number((20 * Math.log10(peak)).toFixed(2)) : null;
        if (m.integratedLufs === null || peakDbfs === null) rows.push({ ...base, status: 'silent', measuredLufs: null, peakDbfs });
        else rows.push({ ...base, status: under(w.duration, LOUDNESS_MATCH.shortSeconds) ? 'short' : 'measured', measuredLufs: m.integratedLufs, peakDbfs });
      } finally {
        fs.rmSync(raw, { force: true });
      }
    }
  });
  return { revision: stored.revision, clips: rows, medianLufs: medianLufs(rows.filter((r) => r.measuredLufs !== null).map((r) => r.measuredLufs!)), method: CLIP_LOUDNESS_METHOD };
}
