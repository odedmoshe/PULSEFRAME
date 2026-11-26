/**
 * Semantic checks of «תמונה חיה» (wave 8 living; livingContract.ts). Lead-built, complete. Called by validate.ts validateProject.
 *
 * clip_depth: `depth` only on a media clip of an image file on a video track; strokes with an even count of coordinates; at most
 *   MAX_DEPTH_NUMBERS numbers in all (depthProblems).
 * living_effect: at most one depth.living per clip, and only on such a photo clip. An enabled one without a depth, or on a rotated
 *   clip, is NOT a validation issue: a split or an agent can make it, and the compositor reports it unavailable (verifier C6);
 *   preflight warns (living_no_depth, living_rotated).
 */
import type { ProjectDocument } from './schema.ts';
import type { Issue } from './validate.ts';
import { depthProblems, LIVING_EFFECT } from './livingContract.ts';

export const LIVING_VALIDATION = { depth: 'clip_depth', effect: 'living_effect' } as const;

export function livingIssues(doc: ProjectDocument): Issue[] {
  const out: Issue[] = [];
  for (const seq of Object.values(doc.sequences)) for (const track of seq.tracks) for (const c of track.clips) {
    const living = (c.effects ?? []).filter((e) => e.type === LIVING_EFFECT);
    const depth = c.type === 'media' ? c.depth : undefined;
    if (!depth && !living.length) continue;
    const photo = c.type === 'media' && track.kind === 'video' && doc.assets[c.assetId]?.kind === 'image';
    if (depth) {
      if (!photo) out.push({ code: LIVING_VALIDATION.depth, message: `clip ${c.id}: a drawn depth belongs to a photo clip on a picture track`, ids: [c.id] });
      for (const p of depthProblems(depth)) out.push({ code: LIVING_VALIDATION.depth, message: `clip ${c.id}: ${p}`, ids: [c.id] });
    }
    if (living.length > 1) out.push({ code: LIVING_VALIDATION.effect, message: `clip ${c.id}: at most one living picture per clip`, ids: [c.id] });
    if (living.length && !photo) out.push({ code: LIVING_VALIDATION.effect, message: `clip ${c.id}: a living picture belongs to a photo clip on a picture track`, ids: [c.id] });
  }
  return out;
}
