/**
 * Validation rules of stabilisation (wave 7 stabilise track; stabilise-decisions.md §4). LEAD-BUILT and final; validate.ts calls
 * steadyIssues once. New optional fields, so these rules can only fire on documents that use them.
 * - stabilise_clip: `stabilise` only on a media clip on a video track whose file is a moving picture, never on a multicam segment.
 * - stabilise_path: a stabilised clip's file has camera motion.
 * - camera_motion: every stretch has equal columns, sample 0 `start`, values in range, lies inside its file's frames; stretches
 *   ascend and neither overlap nor touch; at most MAX_CAMERA_STRETCHES and MAX_STEADY_SAMPLES per file; motion-track plus camera
 *   samples at most MAX_PROJECT_TRACK_SAMPLES per project.
 */
import type { ProjectDocument } from './schema.ts';
import type { Issue } from './validate.ts';
import { isMovingPicture, videoFrames } from './momentsContract.ts';
import { MAX_CAMERA_STRETCHES, MAX_STEADY_SAMPLES, SST, cameraSamples, projectCameraSamples, projectTrackSamples, stretchEnd } from './steadyContract.ts';
import { MAX_PROJECT_TRACK_SAMPLES } from './tracking.ts';

const RANGE: Record<'dx' | 'dy' | 'dr' | 'dz' | 'st', [number, number]> = { dx: [-200_000, 200_000], dy: [-200_000, 200_000], dr: [-500_000, 500_000], dz: [-300_000, 300_000], st: [0, 3] };

export function steadyIssues(doc: ProjectDocument): Issue[] {
  const issues: Issue[] = [];
  for (const seq of Object.values(doc.sequences))
    for (const tr of seq.tracks)
      for (const c of tr.clips) {
        if (c.type !== 'media' || !c.stabilise) continue;
        const asset = Object.hasOwn(doc.assets, c.assetId) ? doc.assets[c.assetId] : undefined;
        if (tr.kind !== 'video' || !isMovingPicture(asset) || c.multicam) issues.push({ code: 'stabilise_clip', message: `clip ${c.id}: only a video clip on a video track, not a multicam segment, can be stabilised`, ids: [c.id, tr.id] });
        else if (!doc.analyses?.[c.assetId]?.cameraMotion) issues.push({ code: 'stabilise_path', message: `clip ${c.id} is stabilised, but asset ${c.assetId} has no camera motion`, ids: [c.id, c.assetId] });
      }
  let any = false;
  for (const [key, an] of Object.entries(doc.analyses ?? {})) {
    const m = an.cameraMotion;
    if (!m) continue;
    any = true;
    const asset = Object.hasOwn(doc.assets, an.assetId) ? doc.assets[an.assetId] : undefined;
    const bad = (why: string) => issues.push({ code: 'camera_motion', message: `camera motion of asset ${key}: ${why}`, ids: [key] });
    if (!isMovingPicture(asset)) { bad('the file is not a moving picture'); continue; }
    const frames = videoFrames(asset!)!;
    if (m.stretches.length > MAX_CAMERA_STRETCHES) bad(`more than ${MAX_CAMERA_STRETCHES} stretches`);
    if (cameraSamples(m) > MAX_STEADY_SAMPLES) bad(`more than ${MAX_STEADY_SAMPLES} samples`);
    m.stretches.forEach((s, i) => {
      const n = s.st.length;
      if (s.dx.length !== n || s.dy.length !== n || s.dr.length !== n || s.dz.length !== n) bad(`stretch ${i}: its columns differ in length`);
      for (const c of ['dx', 'dy', 'dr', 'dz', 'st'] as const) if (s[c].some((v) => !Number.isInteger(v) || v < RANGE[c][0] || v > RANGE[c][1])) bad(`stretch ${i}: ${c} holds a value out of range`);
      if (s.st[0] !== SST.start) bad(`stretch ${i}: sample 0 is not a start`);
      if (stretchEnd(s) > frames) bad(`stretch ${i} reaches past the last frame (${frames})`);
      if (i > 0 && s.from <= stretchEnd(m.stretches[i - 1]!)) bad(`stretch ${i} overlaps or touches the one before`);
    });
  }
  if (any) {
    const total = projectTrackSamples(doc) + projectCameraSamples(doc);
    if (total > MAX_PROJECT_TRACK_SAMPLES) issues.push({ code: 'camera_motion', message: `the motion tracks and camera measurements hold ${total} samples, more than ${MAX_PROJECT_TRACK_SAMPLES}`, ids: [] });
  }
  return issues;
}
