/**
 * Semantic checks of Asset.provenance.instruments (wave 7 instruments track «כלים מוקלטים»; .artifacts/wave7/instruments-decisions.md
 * §4.4). Lead-built, complete. Called by validate.ts validateProject; code instruments_provenance.
 *
 * - A recorded track is built-in music: origin 'generated', procedural.id a built-in music style, procedural.generator
 *   MUSIC_RECORDED_GENERATOR — and that generator never appears without provenance.instruments (the honest generator both ways:
 *   MUSIC_GENERATOR says "no samples", so it never sits beside instruments).
 * - It carries no library, upload, fitted, derived or voice record beside it: its library duties live in instruments.records only.
 * - Every record passes the core licence table (libraryDuties.ts libraryRecordIssues): known licence, credit present where due,
 *   marked non-commercial and disk-only where the licence says so. A share-alike or no-derivatives record can never be stored here.
 */
import type { ProjectDocument } from './schema.ts';
import type { Issue } from './validate.ts';
import { libraryRecordIssues } from './libraryDuties.ts';
import { MUSIC_RECORDED_GENERATOR } from './musicKits.ts';
import { MUSIC_GENERATOR, MUSIC_STYLE_ID } from './musicStyles.ts';

export function instrumentsIssues(doc: ProjectDocument): Issue[] {
  const out: Issue[] = [];
  for (const a of Object.values(doc.assets)) {
    const p = a.provenance;
    const ins = p.instruments;
    const bad = (why: string) => out.push({ code: 'instruments_provenance', message: `asset ${a.id}: ${why}`, ids: [a.id] });
    if (!ins) {
      if (p.procedural?.generator === MUSIC_RECORDED_GENERATOR) bad('a track that says it was made with recorded instruments must name its kit and library records');
      continue;
    }
    if (p.origin !== 'generated') bad('built-in music with recorded instruments is a generated file');
    if (!p.procedural || !MUSIC_STYLE_ID.test(p.procedural.id)) bad('recorded instruments belong to built-in music only');
    else if (p.procedural.generator !== MUSIC_RECORDED_GENERATOR) bad(p.procedural.generator === MUSIC_GENERATOR ? 'a track made with recorded samples cannot say it has no samples' : 'its generator must say it was made with recorded instruments');
    if (p.library || p.upload || p.fitted || p.derived || p.voice) bad('a recorded built-in track carries its library records in instruments only, and no upload, shortening, tool or voice record');
    if (a.kind !== 'audio' || !a.audio || a.video) bad('a recorded built-in track is a sound file');
    for (const r of ins.records) for (const m of libraryRecordIssues(r)) bad(`instrument source ${r.sourceId}: ${m}`);
  }
  return out;
}
