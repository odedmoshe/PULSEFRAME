/**
 * Semantic checks of the musicfit track's two optional fields (wave 7; .artifacts/wave7/musicfit-decisions.md §4). Lead-built,
 * complete. Called by validate.ts validateProject.
 *
 * fitted_provenance (Asset.provenance.fitted): origin 'derived'; no upload, procedural, derived or voice record beside it (a library
 *   record copied from the source IS allowed: validate.ts library_provenance); a sound file; startAt <= removed.from < removed.to;
 *   a crossfade of MUSICFIT.crossfadeMinMs to MUSICFIT.crossfadeMaxMs; joinAt = removed.from − startAt exactly. sourceAssetId is not
 *   checked against the library: the song may be removed later (every reader checks).
 * clip_impact (MediaClip.impact): not negative and before the end of the clip's file; never on a still picture or a freeze frame.
 *   Not checked against the part the clip shows (it means something only while it is shown; trims may move it out and back).
 */
import * as T from '@pulseframe/time';
import type { ProjectDocument } from './schema.ts';
import type { Issue } from './validate.ts';
import { MUSICFIT } from './musicFitContract.ts';

export function musicFitIssues(doc: ProjectDocument): Issue[] {
  const out: Issue[] = [];
  for (const a of Object.values(doc.assets)) {
    const f = a.provenance.fitted;
    if (!f) continue;
    const bad = (why: string) => out.push({ code: 'fitted_provenance', message: `asset ${a.id}: ${why}`, ids: [a.id] });
    const p = a.provenance;
    if (p.origin !== 'derived') bad('a shortened song is a derived file');
    if (p.upload || p.procedural || p.derived || p.voice) bad('a shortened song carries no upload, formula, tool or voice record');
    if (a.kind !== 'audio' || !a.audio || a.video) bad('a shortened song is a sound file');
    if (T.isNegative(f.startAt) || T.lt(f.removed.from, f.startAt) || !T.lt(f.removed.from, f.removed.to)) bad('its removed stretch must lie after its start and end after it starts');
    const lo = T.rt(MUSICFIT.crossfadeMinMs, 1000), hi = T.rt(MUSICFIT.crossfadeMaxMs, 1000);
    if (T.lt(f.crossfade, lo) || T.lt(hi, f.crossfade)) bad(`its crossfade lasts ${MUSICFIT.crossfadeMinMs} to ${MUSICFIT.crossfadeMaxMs} ms`);
    if (!T.eq(f.joinAt, T.sub(f.removed.from, f.startAt))) bad('its join lies where the removed stretch begins');
  }
  for (const seq of Object.values(doc.sequences))
    for (const tr of seq.tracks)
      for (const c of tr.clips) {
        if (c.type !== 'media' || c.impact === undefined) continue;
        const asset = Object.hasOwn(doc.assets, c.assetId) ? doc.assets[c.assetId] : undefined;
        const bad = (why: string) => out.push({ code: 'clip_impact', message: `clip ${c.id}: ${why}`, ids: [c.id] });
        if (c.freeze || asset?.kind === 'image') bad('a still or a freeze frame has no moment to mark');
        else if (T.isNegative(c.impact) || (asset && !T.lt(c.impact, asset.duration))) bad('its marked moment lies outside its file');
      }
  return out;
}
