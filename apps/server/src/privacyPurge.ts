/**
 * The privacy purge (ADR-0024, owner decision 2026-11-18: privacy over speed). Rendered segments are pictures of the project as it
 * was: when a commit changes what is hidden, stored segments may show what the owner has just hidden, so the commit path purges
 * that project's cached segments at once (Store.onPrivacyChange → SegmentStore.purgeProject(projectId, { revision })).
 *
 * "Changes what is hidden" is decided from the commit's own entity changes, so every op counts the same way (set_redact_region,
 * a template, removing a clip that carries a region, an undo or a redo, restore_entities, a future op): a clip whose `redact`
 * list differs before and after, or a motion track that a privacy region follows (in the document before or after) whose
 * samples changed — a followed region is drawn where its track says, so editing the track moves the hidden area.
 */
import { canonical, type EntityChange, type ProjectDocument } from '@pulseframe/core';

/** The motion tracks some privacy region of the document follows. */
function followedTracks(doc: ProjectDocument): Set<string> {
  const out = new Set<string>();
  for (const seq of Object.values(doc.sequences)) for (const t of seq.tracks) for (const c of t.clips) for (const r of (c as { redact?: { motionTrackId: string | null }[] }).redact ?? []) if (r.motionTrackId) out.add(r.motionTrackId);
  return out;
}
const redactOf = (state: EntityChange['before']): string => (state?.kind === 'clip' ? canonical((state.clip as { redact?: unknown }).redact ?? null) : 'null');

/** True when this commit adds, changes or removes a privacy region, or moves one by editing the motion track it follows. */
export function privacyChanged(changes: readonly EntityChange[], before: ProjectDocument, after: ProjectDocument): boolean {
  let followed: Set<string> | null = null;
  for (const ch of changes) {
    const kind = (ch.after ?? ch.before)?.kind;
    if (kind === 'clip' && redactOf(ch.before) !== redactOf(ch.after)) return true;
    if (kind === 'motionTrack') {
      followed ??= new Set([...followedTracks(before), ...followedTracks(after)]);
      if (followed.has(ch.id)) return true;
    }
  }
  return false;
}
