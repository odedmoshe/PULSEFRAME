/**
 * Validation of multicam groups and tags (ADR-0020 plan §2). Lead-built; validate.ts validateProject calls it. These rules
 * fire only on documents that hold the new keys, so an older project stays editable. Ids are looked up as own properties.
 *
 * W1 (with the map maths of multicam.ts): the placed pieces of one angle do not overlap in group time (code multicam_sync): one
 * camera or recorder records one file at a time, so a group time never names two files of one angle.
 */
import * as T from '@pulseframe/time';
import type { Issue } from './validate.ts';
import type { ProjectDocument } from './schema.ts';
import { isPlacedVerdict, MAX_MULTICAM_GROUPS, MAX_PROJECT_ANCHORS } from './multicamLimits.ts';
import { pieceCoverage, syncGrid } from './multicam.ts';

/** Every multicam issue of the document. `uniq` is validateProject's: a group is an entity of its own (entities.ts), so its id must not be another entity's. */
export function multicamIssues(doc: ProjectDocument, uniq: (id: string) => void): Issue[] {
  const issues: Issue[] = [];
  const groups = doc.multicam ?? {};
  const motionTracks = doc.motionTracks ?? {};
  const asset = (id: string) => (Object.hasOwn(doc.assets, id) ? doc.assets[id] : undefined);
  if (Object.keys(groups).length > MAX_MULTICAM_GROUPS) issues.push({ code: 'multicam_limit', message: `the project has more than ${MAX_MULTICAM_GROUPS} multicam groups`, ids: [] });
  let anchors = 0;
  for (const [key, g] of Object.entries(groups)) {
    if (key !== g.id) issues.push({ code: 'key_mismatch', message: `multicam group key ${key} != id ${g.id}`, ids: [key] });
    uniq(g.id);
    const bad = (message: string, ...ids: string[]) => issues.push({ code: 'multicam_group', message: `multicam group ${g.id}: ${message}`, ids: [g.id, ...ids] });
    const angleIds = new Set<string>();
    for (const an of g.angles) { if (angleIds.has(an.id)) bad(`two angles have id ${an.id}`); angleIds.add(an.id); }
    const angleOf = (id: string) => g.angles.find((an) => an.id === id);
    const seenAssets = new Set<string>();
    for (const an of g.angles) {
      an.pieces.forEach((p, i) => {
        const a = asset(p.assetId);
        if (!a) issues.push({ code: 'multicam_asset', message: `multicam group ${g.id}: angle ${an.id} file ${i} is asset ${p.assetId}, which is missing`, ids: [g.id, p.assetId] });
        else if (an.kind === 'picture' ? !(a.kind === 'video' && a.video) : !a.audio) issues.push({ code: 'multicam_asset', message: `multicam group ${g.id}: asset ${a.id} has no ${an.kind} for ${an.kind} angle ${an.id}`, ids: [g.id, a.id] });
        if (seenAssets.has(p.assetId)) issues.push({ code: 'multicam_asset', message: `multicam group ${g.id}: asset ${p.assetId} is named twice`, ids: [g.id, p.assetId] });
        seenAssets.add(p.assetId);
        // the sync map: placed verdicts have anchors and the others none; strictly increasing, whole samples, |slope − 1| ≤ 1000 ppm
        const sync = (message: string) => issues.push({ code: 'multicam_sync', message: `multicam group ${g.id}: angle ${an.id} file ${i}: ${message}`, ids: [g.id] });
        anchors += p.anchors.length;
        if (isPlacedVerdict(p.quality.verdict) !== p.anchors.length > 0) sync(`verdict ${p.quality.verdict} ${p.anchors.length ? 'cannot carry anchors' : 'needs at least one anchor'}`);
        const sr = { num: g.sampleRate, den: 1 };
        if (p.anchors.some((k) => !T.isFrameAligned(k.group, sr) || !T.isFrameAligned(k.source, sr))) sync(`anchors must fall on whole samples at ${g.sampleRate} Hz`);
        else for (let k = 1; k < p.anchors.length; k++) {
          const dg = T.sampleIndexAt(p.anchors[k]!.group, g.sampleRate) - T.sampleIndexAt(p.anchors[k - 1]!.group, g.sampleRate);
          const ds = T.sampleIndexAt(p.anchors[k]!.source, g.sampleRate) - T.sampleIndexAt(p.anchors[k - 1]!.source, g.sampleRate);
          if (dg <= 0 || ds <= 0) { sync('anchors must increase in both group time and source time'); break; }
          if (Math.abs(dg - ds) * 1000 > ds) { sync('the map runs more than 1000 ppm off the reference between two anchors'); break; }
        }
        // privacy regions and follow of THIS file follow motion tracks of this file
        if ((p.redact || p.follow) && an.kind !== 'picture') sync('privacy regions and follow belong to picture angles');
        for (const r of p.redact ?? []) {
          if (r.motionTrackId === null) continue;
          const mt = Object.hasOwn(motionTracks, r.motionTrackId) ? motionTracks[r.motionTrackId] : undefined;
          if (!mt || mt.assetId !== p.assetId) issues.push({ code: 'redact_track', message: `multicam group ${g.id}: a privacy region of angle ${an.id} file ${i} follows motion track ${r.motionTrackId}, which is missing or of another file`, ids: [g.id, r.motionTrackId] });
        }
        if (p.follow) {
          const mt = Object.hasOwn(motionTracks, p.follow.motionTrackId) ? motionTracks[p.follow.motionTrackId] : undefined;
          if (!mt || mt.assetId !== p.assetId) issues.push({ code: 'follow_track', message: `multicam group ${g.id}: angle ${an.id} file ${i} follows motion track ${p.follow.motionTrackId}, which is missing or of another file`, ids: [g.id, p.follow.motionTrackId] });
        }
      });
    }
    // the placed files of one angle do not overlap in group time (W1); only once the maps above are well formed
    if (!issues.some((i) => i.code === 'multicam_sync' && i.ids[0] === g.id)) {
      const grid = syncGrid(g.sampleRate, doc.settings.frameRate);
      for (const an of g.angles) {
        const spans = an.pieces.flatMap((p, i) => { const a = asset(p.assetId); const c = a ? pieceCoverage(p, a.duration, grid) : null; return c ? [{ i, ...c }] : []; }).sort((x, y) => T.cmp(x.start, y.start));
        for (let k = 1; k < spans.length; k++) if (T.lt(spans[k]!.start, spans[k - 1]!.end)) issues.push({ code: 'multicam_sync', message: `multicam group ${g.id}: files ${spans[k - 1]!.i} and ${spans[k]!.i} of angle ${an.id} overlap in group time`, ids: [g.id] });
      }
    }
    // the reference: its first file sets group time, exactly {0,0}
    const ref = angleOf(g.referenceAngleId);
    if (!ref) bad(`the reference angle ${g.referenceAngleId} is not one of its angles`);
    else {
      const p0 = ref.pieces[0]!;
      if (p0.quality.verdict !== 'reference' || p0.anchors.length !== 1 || !T.isZero(p0.anchors[0]!.group) || !T.isZero(p0.anchors[0]!.source)) bad('the first file of the reference angle must have exactly the anchor {0, 0} and verdict reference');
    }
    for (const an of g.angles) an.pieces.forEach((p, i) => { if (p.quality.verdict === 'reference' && !(an.id === g.referenceAngleId && i === 0)) bad(`only the first file of the reference angle has verdict reference (angle ${an.id} file ${i})`); });
    if (g.wideAngleId !== null && angleOf(g.wideAngleId)?.kind !== 'picture') bad(`the wide angle ${g.wideAngleId} is not a picture angle of the group`);
    const speakerIds = new Set<string>();
    for (const sp of g.speakers) {
      if (speakerIds.has(sp.id)) bad(`two speakers have id ${sp.id}`);
      speakerIds.add(sp.id);
      const mic = angleOf(sp.micAngleId);
      if (!mic || !mic.pieces.every((p) => !!asset(p.assetId)?.audio)) bad(`the mic of speaker ${sp.id} is not an angle of the group with sound`);
      if (sp.shotAngleId !== null && angleOf(sp.shotAngleId)?.kind !== 'picture') bad(`the shot of speaker ${sp.id} is not a picture angle of the group`);
    }
  }
  if (anchors > MAX_PROJECT_ANCHORS) issues.push({ code: 'multicam_limit', message: `the project has more than ${MAX_PROJECT_ANCHORS} sync anchors`, ids: [] });
  // tags of program segments
  for (const seq of Object.values(doc.sequences))
    for (const tr of seq.tracks)
      for (const c of tr.clips) {
        if (c.type !== 'media' || !c.multicam) continue;
        const tag = (message: string) => issues.push({ code: 'multicam_tag', message: `clip ${c.id}: ${message}`, ids: [c.id] });
        const g = Object.hasOwn(groups, c.multicam.groupId) ? groups[c.multicam.groupId] : undefined;
        const an = g?.angles.find((x) => x.id === c.multicam!.angleId);
        if (!g) { tag(`multicam group ${c.multicam.groupId} does not exist`); continue; }
        if (!an) { tag(`angle ${c.multicam.angleId} is not an angle of multicam group ${g.id}`); continue; }
        if (!an.pieces.some((p) => p.assetId === c.assetId)) tag(`asset ${c.assetId} is not a file of angle ${an.id}`);
        // a picture angle shows on a video track (its own sound may play on a sound track); a sound angle only on a sound track
        if (an.kind === 'sound' ? tr.kind !== 'audio' : tr.kind !== 'video' && tr.kind !== 'audio') tag(`a ${an.kind} angle cannot sit on ${tr.kind} track ${tr.id}`);
      }
  return issues;
}
