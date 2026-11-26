/**
 * Versions: what restore composes and what «מה השתנה» says (wave 7 craft; craft-plan.md §4.4 and "Corrected" C6;
 * craft-decisions.md §2.6). Pure; the server (apps/server/src/craft/versions.ts) stores the copies and commits the restore.
 * - privacyDigest: a canonical hash (SHA-256) of every clip's `redact` list (by clip id), the samples of every motion track a
 *   region follows — the facts apps/server/src/privacyPurge.ts privacyChanged reads — and the ids of the people of the project.
 *   A version whose digest differs from the current document's was saved before a privacy change (a region added, removed,
 *   moved or changed, or a person added or removed): its still, diff and restore are the owner's only. The people ids are in the
 *   digest so that a stored version never becomes a way to see a person removed since (stricter, as a version with MORE regions
 *   is also the owner's only); a person's name or birth date alone does not change it (names are readable by every credential,
 *   and birth dates are taken out of every document a credential without the people scope receives).
 * - composeRestore: EDIT entities from the version (project settings without the name, sequences with their tracks, track order
 *   and clips, markers, formats, recipe runs); LIBRARY entities as they are now (files, transcripts, analyses, motion tracks,
 *   multicam groups, events, people), adding from the version only files, transcripts of those files, motion tracks and multicam
 *   groups that are missing now and that a restored entity refers to (followed to a fixed point: a re-added motion track brings
 *   its file). People and events are NEVER taken from the version.
 * - describeDiff: counts and names over diffEntities(from, to) (entities.ts), each row marked `restores` exactly when
 *   composeRestore(to, from) gives that entity another state than `to` has; library rows that restore leaves as they are have
 *   restores=false («לא ישוחזר — נשאר כמו עכשיו»); at most 500 rows, then `more`; `privacy` counts the regions restore would add,
 *   remove or change.
 */
import { canonical, diffEntities, entityMap, sameEntity, type EntityState } from './entities.ts';
import type { ProjectDocument } from './schema.ts';
import { sha256Hex } from './sha256.ts';
import { drawnName } from './drawn.ts';
import type { DiffEntityKind, DiffRow, DiffSummary } from './craftContract.ts';

/** Rows «מה השתנה» lists before it only counts. */
export const DIFF_ROW_LIMIT = 500;

type Region = { id: string; motionTrackId: string | null };
const redactOf = (clip: unknown): Region[] => ((clip as { redact?: Region[] }).redact ?? []);
/** Every clip carrying privacy regions, by clip id, and the motion tracks those regions follow. */
function regionsOf(doc: ProjectDocument): { clips: Map<string, Region[]>; followed: Set<string> } {
  const clips = new Map<string, Region[]>();
  const followed = new Set<string>();
  for (const seq of Object.values(doc.sequences)) for (const t of seq.tracks) for (const c of t.clips) {
    const r = redactOf(c);
    if (!r.length) continue;
    clips.set(c.id, r);
    for (const x of r) if (x.motionTrackId) followed.add(x.motionTrackId);
  }
  return { clips, followed };
}
const samplesOf = (doc: ProjectDocument, trackId: string) => {
  const m = doc.motionTracks?.[trackId];
  return m ? { from: m.from, box: m.box ?? null, x: m.x, y: m.y, s: m.s ?? null, q: m.q, st: m.st } : null;
};

export function privacyDigest(doc: ProjectDocument): string {
  const { clips, followed } = regionsOf(doc);
  const regions = [...clips].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const tracks = [...followed].sort().map((id) => [id, samplesOf(doc, id)]);
  const people = Object.keys(doc.people ?? {}).sort();
  return sha256Hex(canonical({ regions, tracks, people }));
}

/** Every string anywhere in a value (ids are strings; a library entity is "referred to" when its id appears). */
function strings(v: unknown, out: Set<string>): Set<string> {
  if (typeof v === 'string') out.add(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}

/** The document restore commits (through diffEntities + restore_entities), from the current one and the version's copy. */
export function composeRestore(current: ProjectDocument, version: ProjectDocument): ProjectDocument {
  const t = structuredClone(current);
  // edit entities: the version's (the name stays as it is now)
  t.settings = structuredClone(version.settings);
  t.sequences = structuredClone(version.sequences);
  t.markers = structuredClone(version.markers ?? {});
  t.variants = structuredClone(version.variants ?? {});
  t.recipeRuns = structuredClone(version.recipeRuns ?? {});
  // library entities: as now, plus what a restored entity refers to and is missing now (never people or events)
  const queue = [...strings([t.sequences, t.markers, t.variants, t.recipeRuns], new Set())];
  const seen = new Set<string>();
  while (queue.length) {
    const s = queue.pop()!;
    if (seen.has(s)) continue;
    seen.add(s);
    const added: unknown[] = [];
    if (Object.hasOwn(version.assets, s) && !Object.hasOwn(t.assets, s)) {
      t.assets[s] = structuredClone(version.assets[s]!); added.push(t.assets[s]);
      const tr = version.transcripts?.[s];
      if (tr && !Object.hasOwn(t.transcripts, s)) { t.transcripts[s] = structuredClone(tr); added.push(t.transcripts[s]); }
    }
    const mt = version.motionTracks?.[s];
    if (mt && !Object.hasOwn(t.motionTracks ?? {}, s)) { (t.motionTracks ??= {})[s] = structuredClone(mt); added.push(mt); }
    const g = version.multicam?.[s];
    if (g && !Object.hasOwn(t.multicam ?? {}, s)) { (t.multicam ??= {})[s] = structuredClone(g); added.push(g); }
    for (const x of strings(added, new Set())) if (!seen.has(x)) queue.push(x);
  }
  return t;
}

const KIND: Record<EntityState['kind'], DiffEntityKind> = {
  project: 'project', asset: 'asset', track: 'track', clip: 'clip', transcript: 'transcript', analysis: 'analysis', variant: 'variant',
  recipeRun: 'recipeRun', marker: 'marker', motionTrack: 'motionTrack', lifeEvent: 'event', person: 'person', sequence: 'sequence',
  multicamGroup: 'multicam', trackOrder: 'other',
  // a marked range (wave 7 pearls) is listed among the rest; restore never takes ranges (composeRestore above)
  sourceRange: 'other',
};
/** The order rows are listed in: the edit first, then the library. */
const ORDER: DiffEntityKind[] = ['project', 'sequence', 'track', 'clip', 'marker', 'variant', 'recipeRun', 'other', 'asset', 'transcript', 'analysis', 'motionTrack', 'multicam', 'event', 'person'];
const short = (s: string) => { const one = s.replace(/\s+/g, ' ').trim(); return one.length > 80 ? `${one.slice(0, 79)}…` : one; };

/** The name a row shows: what the owner calls the thing (a title's words, a file's name), else its id. */
function nameOf(s: EntityState, id: string, docs: ProjectDocument[]): string {
  const asset = (assetId: string) => docs.map((d) => d.assets[assetId]?.name).find((n) => n) ?? assetId;
  const seqName = (sid: string) => docs.map((d) => d.sequences[sid]?.name).find((n) => n) || sid;
  switch (s.kind) {
    case 'project': return s.name;
    case 'asset': return s.asset.name || id;
    case 'track': return s.track.name || id;
    case 'clip': {
      const c = s.clip;
      if (c.type === 'text' || c.type === 'caption') return short(c.text) || id;
      if (c.type === 'media') return asset(c.assetId);
      if (c.type === 'drawn') return drawnName(c.drawn).he; // a drawing or a map: its kind's name (it has no words of its own)
      return c.label || id;
    }
    case 'transcript': return asset(s.transcript.assetId);
    case 'analysis': return asset(s.analysis.assetId);
    case 'variant': return s.variant.name;
    case 'recipeRun': return s.run.recipeId;
    case 'marker': return s.marker.label || id;
    case 'motionTrack': return s.track.name;
    case 'lifeEvent': return s.event.name || id;
    case 'person': return s.person.name;
    case 'sequence': return s.sequence.name || id;
    case 'multicamGroup': return s.group.name;
    case 'trackOrder': return seqName(s.sequenceId);
    // its file's name, never the label (labels are family notes; peoplePrivacy.ts)
    case 'sourceRange': return asset(s.range.assetId);
  }
}

/** Privacy regions by clip and region id, each with what it is drawn from (its own fields and the samples it follows). */
function regionStates(doc: ProjectDocument): Map<string, string> {
  const out = new Map<string, string>();
  for (const [clipId, list] of regionsOf(doc).clips) for (const r of list) out.set(`${clipId}/${r.id}`, canonical({ r, follows: r.motionTrackId ? samplesOf(doc, r.motionTrackId) : null }));
  return out;
}

/** `from` → `to`: what changed; `restores` marks the rows composeRestore(to=current, from=version) would apply. */
export function describeDiff(from: ProjectDocument, to: ProjectDocument): DiffSummary {
  const changes = diffEntities(from, to);
  const target = composeRestore(to, from);
  const toMap = entityMap(to), targetMap = entityMap(target);
  const all: DiffRow[] = changes.map((c) => {
    const state = (c.after ?? c.before)!;
    return {
      entity: KIND[state.kind],
      id: c.id,
      change: c.before === null ? 'added' : c.after === null ? 'removed' : 'changed',
      name: nameOf(state, c.id, [to, from]),
      restores: !sameEntity(targetMap.get(c.id), toMap.get(c.id)),
    };
  });
  all.sort((a, b) => ORDER.indexOf(a.entity) - ORDER.indexOf(b.entity) || Number(b.restores) - Number(a.restores) || (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const counts = { added: 0, removed: 0, changed: 0 };
  for (const r of all) counts[r.change]++;
  const now = regionStates(to), after = regionStates(target);
  const privacy = { added: 0, removed: 0, changed: 0 };
  for (const [k, v] of after) if (!now.has(k)) privacy.added++; else if (now.get(k) !== v) privacy.changed++;
  for (const k of now.keys()) if (!after.has(k)) privacy.removed++;
  return { counts, rows: all.slice(0, DIFF_ROW_LIMIT), more: Math.max(0, all.length - DIFF_ROW_LIMIT), privacy };
}
