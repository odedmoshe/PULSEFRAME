import * as T from '@pulseframe/time';
import { animatableParams, findEffect, isTimeEffect, modulatableParams, NOT_ANIMATABLE, paramRange, transitionDef } from './effects.ts';
import { sourceEnd, speedValue } from './speed.ts';
import { findAudioEffect } from './audioEffects.ts';
import { ANIMATABLE, CaptureSchema, LifeEventSchema, MAX_LIFE_EVENTS, MAX_PEOPLE, PersonSchema, TransformSchema, type Clip, type ProjectDocument, type Track } from './schema.ts';
import { personNameKey } from './people.ts';
import { lifeIssues } from './fields.ts';
import { MAX_MOTION_TRACKS, MAX_PROJECT_TRACK_SAMPLES, TRACK_STATES } from './tracking.ts';
import { momentsProblem } from './momentsContract.ts';

export interface Issue { code: string; message: string; ids: string[] }

export const clipEnd = (c: Clip) => T.add(c.start, c.duration);

/** Tracks whose clips may not overlap in time. Audio overlaps are intentional and allowed (SPEC §5). */
export const forbidsOverlap = (t: Track) => t.kind !== 'audio';

export function sequenceDuration(doc: ProjectDocument, sequenceId = doc.mainSequenceId): T.RationalTime {
  let end = T.ZERO;
  for (const tr of doc.sequences[sequenceId]?.tracks ?? []) for (const c of tr.clips) end = T.max(end, clipEnd(c));
  return end;
}

/**
 * Why an effect cannot go on an adjustment clip, or null when it can (ADR-0016). An adjustment has no picture of its own:
 * it acts on the picture already drawn below it.
 */
export function adjustmentRefusal(type: string): string | null {
  if (isTimeEffect(type)) return 'a time effect needs a clip\'s own source; it cannot act on the picture below';
  if (type === 'key.chroma') return 'a chroma key over the whole picture below would cut holes through to the background';
  if (type === 'stylize.shadow') return 'a drop shadow has no visible result on a full-frame picture';
  return null;
}

/** The project's colour tables: library entries of kind 'lut' (imported .cube files). */
export const lutAssets = (doc: ProjectDocument) => Object.values(doc.assets).filter((a) => a.kind === 'lut');
/** The colour table an effect instance names: the asset id of a color.lut effect, or '' when it names none (or is another effect). */
export const lutRef = (fx: { type: string; params: Record<string, unknown> }): string => (fx.type === 'color.lut' && typeof fx.params.lut === 'string' ? fx.params.lut : '');
/** Ids of the clips (in every sequence) that carry a color.lut effect naming this asset, enabled or bypassed. */
export function lutUsers(doc: ProjectDocument, assetId: string): string[] {
  if (!assetId) return [];
  return Object.values(doc.sequences).flatMap((sq) => sq.tracks.flatMap((t) => t.clips)).filter((c) => (c.effects ?? []).some((fx) => lutRef(fx) === assetId)).map((c) => c.id);
}

/**
 * Clips (in every sequence, in document order) that carry a link id no other clip carries: a link group of one, which links
 * to nothing.
 *
 * No edit leaves one behind: an edit that removes, divides or detaches clips of a link group clears the link id of a clip it
 * leaves as the only member (ops.ts dissolveLoneLinks). A project saved before that rule may still hold some, and
 * validateProject deliberately does not report them: every transaction is validated as a whole, so an issue here would make
 * such a project impossible to edit at all. They are inert: no other clip moves, trims, splits, reverses or is deleted with
 * such a clip (it has no partner), link_clips and fit_music treat it as unlinked, unlink_clip clears it, and an edit that
 * divides or cuts it clears it on the way. (The editor shows the link control for any clip with a link id.)
 */
export function loneLinkClips(doc: ProjectDocument): string[] {
  const members = new Map<string, string[]>();
  for (const seq of Object.values(doc.sequences))
    for (const tr of seq.tracks)
      for (const c of tr.clips) if (c.type === 'media' && c.linkGroupId) { const list = members.get(c.linkGroupId); if (list) list.push(c.id); else members.set(c.linkGroupId, [c.id]); }
  return [...members.values()].filter((ids) => ids.length === 1).map((ids) => ids[0]!);
}

/**
 * Semantic validation beyond the zod shape: references, bounds, frame alignment, overlap policy, sorted clips, id uniqueness.
 * Not reported, on purpose: a link id that no other clip carries (see loneLinkClips).
 */
export function validateProject(doc: ProjectDocument): Issue[] {
  const issues: Issue[] = [];
  const rate = doc.settings.frameRate;
  const motionTracks = doc.motionTracks ?? {};
  const seen = new Set<string>();
  const uniq = (id: string) => {
    if (seen.has(id)) issues.push({ code: 'duplicate_id', message: `duplicate id ${id}`, ids: [id] });
    seen.add(id);
  };
  if (!doc.sequences[doc.mainSequenceId]) issues.push({ code: 'missing_sequence', message: 'mainSequenceId does not exist', ids: [doc.mainSequenceId] });
  for (const [key, a] of Object.entries(doc.assets)) {
    if (key !== a.id) issues.push({ code: 'key_mismatch', message: `asset key ${key} != id ${a.id}`, ids: [key] });
    uniq(a.id);
    // ADR-0017: the frame mapping of a frame-job result
    const fr = a.provenance.derived?.frames;
    if (fr) {
      if ((fr.mapping === 'interpolated') !== (fr.multiplier !== undefined)) issues.push({ code: 'derived_frames', message: `asset ${a.id}: an interpolated result names its multiplier, and only it does`, ids: [a.id] });
      if (fr.heldFrames.some((f, i) => i > 0 && f <= fr.heldFrames[i - 1]!)) issues.push({ code: 'derived_frames', message: `asset ${a.id}: held frames must be strictly ascending`, ids: [a.id] });
    }
    // ADR-0023: how a file arrived through the import queue. Only uploads carry it; a phone file names its drop code (by id) and
    // only a phone file does; only a folder file has a path inside the folder.
    const up = a.provenance.upload;
    if (up) {
      if (a.provenance.origin !== 'upload') issues.push({ code: 'import_provenance', message: `asset ${a.id}: only an uploaded file records how it was uploaded`, ids: [a.id] });
      if ((up.via === 'phone') !== (up.dropId !== undefined)) issues.push({ code: 'import_provenance', message: `asset ${a.id}: a file from a phone names its drop code, and only such a file does`, ids: [a.id] });
      if (up.relativePath !== undefined && up.via !== 'folder') issues.push({ code: 'import_provenance', message: `asset ${a.id}: only a file from a dropped folder has a path inside it`, ids: [a.id] });
    }
    const rangeStart = a.provenance.derived?.sourceRangeStart;
    if (rangeStart && T.isNegative(rangeStart)) issues.push({ code: 'derived_range', message: `asset ${a.id}: its source range cannot start before 0`, ids: [a.id] });
  }
  for (const [key, seq] of Object.entries(doc.sequences)) {
    if (key !== seq.id) issues.push({ code: 'key_mismatch', message: `sequence key ${key} != id ${seq.id}`, ids: [key] });
    uniq(seq.id);
    for (const tr of seq.tracks) {
      uniq(tr.id);
      if ((tr.kind === 'caption') !== !!tr.caption) issues.push({ code: 'caption_config', message: `track ${tr.id}: caption settings must exist exactly on caption tracks`, ids: [tr.id] });
      if (tr.audio && tr.kind !== 'audio') issues.push({ code: 'audio_config', message: `track ${tr.id}: audio settings belong to audio tracks`, ids: [tr.id] });
      for (const src of tr.audio?.duck?.sourceTrackIds ?? []) {
        const st = seq.tracks.find((t) => t.id === src);
        if (!st || st.kind !== 'audio' || st.id === tr.id) issues.push({ code: 'duck_source', message: `track ${tr.id} ducks under ${src}, which is missing, not an audio track, or itself`, ids: [tr.id] });
      }
      if (tr.caption?.linkedTrackId) {
        const linked = seq.tracks.find((t) => t.id === tr.caption!.linkedTrackId);
        if (!linked || (linked.kind !== 'audio' && linked.kind !== 'video')) issues.push({ code: 'caption_link', message: `caption track ${tr.id} is linked to a missing or non-media track`, ids: [tr.id] });
      }
      let prev: Clip | undefined;
      for (const c of tr.clips) {
        uniq(c.id);
        if (T.isNegative(c.start)) issues.push({ code: 'negative_start', message: `clip ${c.id} starts before 0`, ids: [c.id] });
        if (!T.lt(T.ZERO, c.duration)) issues.push({ code: 'empty_clip', message: `clip ${c.id} has non-positive duration`, ids: [c.id] });
        if (!T.isFrameAligned(c.start, rate) || !T.isFrameAligned(c.duration, rate))
          issues.push({ code: 'not_frame_aligned', message: `clip ${c.id} is not aligned to ${rate.num}/${rate.den} fps frames`, ids: [c.id] });
        if (prev && T.lt(c.start, prev.start)) issues.push({ code: 'unsorted_clips', message: `track ${tr.id} clips are not sorted by start`, ids: [tr.id] });
        if (prev && forbidsOverlap(tr) && T.lt(c.start, clipEnd(prev)))
          issues.push({ code: 'overlap', message: `clips ${prev.id} and ${c.id} overlap on ${tr.kind} track ${tr.id}`, ids: [prev.id, c.id] });
        prev = c;
        for (const prop of ANIMATABLE) {
          const keys = c.keyframes?.[prop];
          if (!keys) continue;
          if (keys.length === 0) issues.push({ code: 'empty_keyframes', message: `clip ${c.id} has an empty ${prop} keyframe list`, ids: [c.id] });
          keys.forEach((k, i) => {
            if (i > 0 && !T.lt(keys[i - 1]!.time, k.time)) issues.push({ code: 'unsorted_keyframes', message: `clip ${c.id} ${prop} keyframes are not strictly increasing in time`, ids: [c.id] });
            if (!T.isFrameAligned(k.time, rate)) issues.push({ code: 'not_frame_aligned', message: `clip ${c.id} ${prop} keyframe is not on a frame boundary`, ids: [c.id] });
            if (!TransformSchema.shape[prop].safeParse(k.value).success) issues.push({ code: 'keyframe_out_of_range', message: `clip ${c.id} ${prop} keyframe value ${k.value} is out of range`, ids: [c.id] });
          });
        }
        const seenFx = new Set<string>();
        for (const fx of c.effects ?? []) {
          const d = findEffect(fx.type);
          if (!d) issues.push({ code: 'unknown_effect', message: `clip ${c.id} uses effect "${fx.type}", which this build does not have`, ids: [c.id] });
          else if (!d.params.safeParse(fx.params).success) issues.push({ code: 'effect_params', message: `clip ${c.id} effect ${fx.type} has invalid parameters`, ids: [c.id] });
          const table = lutRef(fx);
          if (table && doc.assets[table]?.kind !== 'lut') issues.push({ code: 'missing_lut', message: `clip ${c.id} effect color.lut names colour table ${table}, which is not a colour table in this project's library`, ids: [c.id, table] });
          for (const [param, keys] of Object.entries(fx.keyframes ?? {})) {
            // Keys on a parameter that may no longer be animated (effects.ts NOT_ANIMATABLE) are tolerated in a document
            // that already holds them: they are inert (animation.ts effectParamsAt ignores them) and no op adds new ones.
            // Refusing them here would make an older project impossible to edit at all.
            if (d && NOT_ANIMATABLE[fx.type]?.includes(param)) continue;
            const ok = !!d && animatableParams(fx.type).includes(param) && keys.every((k, i) => (i === 0 || T.lt(keys[i - 1]!.time, k.time)) && T.isFrameAligned(k.time, rate) && d.params.safeParse({ ...fx.params, [param]: k.value }).success);
            if (!ok) issues.push({ code: 'effect_keyframes', message: `clip ${c.id} effect ${fx.type}: keyframes of "${param}" are not animatable, out of range, unsorted or off the frame grid`, ids: [c.id] });
          }
          // Time effects and beat modulators are new fields: these rules can only fire on documents that use them, so an
          // older project stays editable (see the note on NOT_ANIMATABLE keys above).
          const list = c.effects ?? [];
          if (d?.cost === 'time' && list.indexOf(fx) > 0) issues.push({ code: 'time_effect_order', message: `clip ${c.id}: the time effect ${fx.type} must be the first effect`, ids: [c.id] });
          if (d?.cost === 'time' && list.filter((e) => isTimeEffect(e.type)).length > 1 && list.find((e) => isTimeEffect(e.type)) === fx) issues.push({ code: 'time_effect_count', message: `clip ${c.id} carries more than one time effect`, ids: [c.id] });
          for (const [param, m] of Object.entries(fx.modulate ?? {})) {
            if (!d || !modulatableParams(fx.type).includes(param)) { issues.push({ code: 'modulator_param', message: `clip ${c.id} effect ${fx.type}: "${param}" cannot follow the beat`, ids: [c.id] }); continue; }
            const r = paramRange(fx.type, param);
            if (!r || Math.abs(m.depth) > r.max - r.min) issues.push({ code: 'modulator_range', message: `clip ${c.id} effect ${fx.type}: modulation depth of "${param}" exceeds its range`, ids: [c.id] });
          }
          if (seenFx.has(fx.id)) issues.push({ code: 'duplicate_id', message: `clip ${c.id} has two effects with id ${fx.id}`, ids: [c.id] });
          seenFx.add(fx.id);
        }
        if ((c.effects?.length || c.blend) && (tr.kind === 'audio' || tr.kind === 'caption')) issues.push({ code: 'incompatible_track', message: `clip ${c.id} on a ${tr.kind} track cannot carry picture effects`, ids: [c.id, tr.id] });
        // Motion tracking (ADR-0015): new optional fields, so these rules can only fire on documents that use them.
        if (c.follow) {
          if (!(c.type === 'text' || (c.type === 'media' && tr.kind === 'video'))) issues.push({ code: 'follow_clip', message: `clip ${c.id}: only a title, or a picture on a video track, can follow a motion track`, ids: [c.id, tr.id] });
          if (!Object.hasOwn(motionTracks, c.follow.motionTrackId)) issues.push({ code: 'follow_track', message: `clip ${c.id} follows motion track ${c.follow.motionTrackId}, which does not exist`, ids: [c.id, c.follow.motionTrackId] });
          const first = c.effects?.find((e) => e.enabled);
          if (first && isTimeEffect(first.type)) issues.push({ code: 'follow_time_effect', message: `clip ${c.id}: a clip with a time effect cannot follow a motion track yet`, ids: [c.id] });
          // a targetTrackId that names no track is not an issue: the evaluator reports the follow as target-missing
        }
        if (c.type === 'media' && c.redact) {
          if (tr.kind !== 'video') issues.push({ code: 'incompatible_track', message: `clip ${c.id}: privacy regions belong to video clips on video tracks`, ids: [c.id, tr.id] });
          const asset = doc.assets[c.assetId];
          // a region on a still would be stored and never drawn: a silent privacy gap, so it is invalid
          if (asset && !asset.video) issues.push({ code: 'redact_still', message: `clip ${c.id}: privacy regions are drawn on video pictures only, and asset ${asset.id} has no video`, ids: [c.id, asset.id] });
          const regionIds = new Set<string>();
          for (const r of c.redact) {
            // ids are unique within the clip only: split_clip copies the clip whole, regions included
            if (regionIds.has(r.id)) issues.push({ code: 'duplicate_id', message: `clip ${c.id} has two privacy regions with id ${r.id}`, ids: [c.id] });
            regionIds.add(r.id);
            if (r.motionTrackId === null) continue;
            const mt = Object.hasOwn(motionTracks, r.motionTrackId) ? motionTracks[r.motionTrackId] : undefined;
            if (!mt) issues.push({ code: 'redact_track', message: `clip ${c.id}: privacy region ${r.id} follows motion track ${r.motionTrackId}, which does not exist`, ids: [c.id, r.motionTrackId] });
            else if (mt.assetId !== c.assetId) issues.push({ code: 'redact_track', message: `clip ${c.id}: privacy region ${r.id} follows motion track ${mt.id} of another file`, ids: [c.id, mt.id] });
          }
        }
        if (c.type === 'media' && (c.mask || c.transition) && tr.kind !== 'video') issues.push({ code: 'incompatible_track', message: `clip ${c.id}: masks and transitions belong to picture clips`, ids: [c.id, tr.id] });
        // Adjustment clips live only on adjustment tracks and use opacity alone (ADR-0016). This rule can only fire on
        // documents that use them (schema v2), so an older project stays editable.
        if (c.type === 'adjustment' || tr.kind === 'adjustment') {
          if (c.type !== 'adjustment' || tr.kind !== 'adjustment')
            issues.push({ code: 'incompatible_track', message: c.type === 'adjustment' ? `adjustment clip ${c.id} on ${tr.kind} track` : `${c.type} clip ${c.id} on adjustment track ${tr.id}`, ids: [c.id, tr.id] });
          if (c.type === 'adjustment') {
            const t = c.transform;
            if (t.x !== 0 || t.y !== 0 || t.scale !== 1 || t.rotation !== 0 || (['x', 'y', 'scale', 'rotation'] as const).some((p) => c.keyframes?.[p]?.length))
              issues.push({ code: 'adjustment_transform', message: `adjustment clip ${c.id}: only opacity can be set or animated`, ids: [c.id] });
            for (const fx of c.effects ?? []) { const why = adjustmentRefusal(fx.type); if (why) issues.push({ code: 'adjustment_effect', message: `adjustment clip ${c.id}: ${fx.type}: ${why}`, ids: [c.id] }); }
          }
          continue;
        }
        if (c.type === 'media' && c.transition) {
          // Transition options (ADR-0012): new optional fields, so these rules can only fire on documents that use them.
          const t = c.transition, options = transitionDef(t.type)?.options ?? [];
          for (const option of ['color', 'seed'] as const) if (t[option] !== undefined && !options.includes(option)) issues.push({ code: 'invalid_transition_option', message: `clip ${c.id}: the ${t.type} transition has no ${option} option`, ids: [c.id] });
          if (t.sync && t.frames < 3) issues.push({ code: 'invalid_transition_sync', message: `clip ${c.id}: a transition locked to the beat needs at least 3 frames`, ids: [c.id] });
          if (t.velocity) {
            const prev = tr.clips.find((o) => o.type === 'media' && o.id !== c.id && T.eq(clipEnd(o), c.start));
            const timeFirst = (x: Clip) => { const first = x.effects?.find((e) => e.enabled); return !!first && isTimeEffect(first.type); };
            const bad = [c, ...(prev ? [prev] : [])].filter((x) => x.type === 'media' && (x.reverse || x.freeze || timeFirst(x)));
            if (bad.length) issues.push({ code: 'incompatible_velocity', message: `clip ${c.id}: a velocity ramp cannot remap a clip that plays backwards, is a freeze frame or starts with a time effect`, ids: [c.id, ...bad.filter((x) => x.id !== c.id).map((x) => x.id)] });
          }
        }
        if (c.type === 'text' || c.type === 'caption') {
          if (tr.kind !== c.type) issues.push({ code: 'incompatible_track', message: `${c.type} clip ${c.id} on ${tr.kind} track`, ids: [c.id, tr.id] });
          continue;
        }
        if (tr.kind === 'caption') issues.push({ code: 'incompatible_track', message: `media clip ${c.id} on caption track`, ids: [c.id, tr.id] });
        const asset = doc.assets[c.assetId];
        if (!asset) { issues.push({ code: 'missing_asset', message: `clip ${c.id} references missing asset ${c.assetId}`, ids: [c.id, c.assetId] }); continue; }
        if (tr.kind === 'text') issues.push({ code: 'incompatible_track', message: `media clip ${c.id} on text track`, ids: [c.id, tr.id] });
        if (tr.kind === 'video' && !asset.video && !(asset.kind === 'image' && asset.image)) issues.push({ code: 'incompatible_track', message: `asset ${asset.id} has no picture for video track`, ids: [c.id, tr.id] });
        if (tr.kind === 'audio' && !asset.audio) issues.push({ code: 'incompatible_track', message: `asset ${asset.id} has no audio for audio track`, ids: [c.id, tr.id] });
        if (c.reverse && (c.freeze || asset.kind === 'image' || (tr.kind === 'video' ? !asset.video : tr.kind === 'audio' ? !asset.audio : true))) issues.push({ code: 'incompatible_track', message: `clip ${c.id}: only a video clip on a video track or a sound clip on a sound track can play backwards`, ids: [c.id] });
        if ((c.rampWindow || c.speedCurve) && !c.speedEnd) issues.push({ code: 'incompatible_ramp', message: `clip ${c.id}: a ramp window or curve without a ramp`, ids: [c.id] });
        if (c.rampWindow && !T.lt(T.ZERO, c.rampWindow.total)) issues.push({ code: 'incompatible_ramp', message: `clip ${c.id}: the ramp must have a positive length`, ids: [c.id] });
        if (c.speedEnd && (c.freeze || c.reverse || c.keepPitch || c.transition || asset.kind === 'image')) issues.push({ code: 'incompatible_ramp', message: `clip ${c.id}: a clip that changes speed gradually cannot be a freeze frame, play backwards, keep its pitch, carry a transition or show a still image`, ids: [c.id] });
        if (c.freeze && (tr.kind !== 'video' || !asset.video)) issues.push({ code: 'incompatible_track', message: `clip ${c.id}: a freeze frame needs a video asset on a video track`, ids: [c.id] });
        if (c.volume) {
          if (tr.kind !== 'audio') issues.push({ code: 'incompatible_track', message: `clip ${c.id}: volume automation belongs to clips on audio tracks`, ids: [c.id] });
          if (c.volume.some((k, i) => !T.isFrameAligned(k.time, doc.settings.frameRate) || (i > 0 && !T.lt(c.volume![i - 1]!.time, k.time)))) issues.push({ code: 'volume_keys', message: `clip ${c.id}: volume keys must be frame-aligned and strictly ascending`, ids: [c.id] });
        }
        if (c.audioFx) {
          if (tr.kind !== 'audio') issues.push({ code: 'incompatible_track', message: `clip ${c.id}: sound effects belong to clips on audio tracks`, ids: [c.id, tr.id] });
          const ids = new Set<string>(), types = new Set<string>();
          let voices = 0;
          for (const fx of c.audioFx) {
            const d = findAudioEffect(fx.type);
            if (!d) issues.push({ code: 'unknown_audio_effect', message: `clip ${c.id} uses sound effect "${fx.type}", which this build does not have`, ids: [c.id] });
            else if (!d.params.safeParse(fx.params).success) issues.push({ code: 'audio_effect_params', message: `clip ${c.id} sound effect ${fx.type} has invalid parameters`, ids: [c.id] });
            if (ids.has(fx.id)) issues.push({ code: 'duplicate_id', message: `clip ${c.id} has two sound effects with id ${fx.id}`, ids: [c.id] });
            if (types.has(fx.type)) issues.push({ code: 'audio_effect_duplicate', message: `clip ${c.id} carries sound effect ${fx.type} twice`, ids: [c.id] });
            ids.add(fx.id); types.add(fx.type);
            if (d?.exclusive === 'voice') voices++;
          }
          if (voices > 1) issues.push({ code: 'audio_effect_voice', message: `clip ${c.id} carries more than one character voice`, ids: [c.id] });
          if (c.audioFx.some((f) => f.enabled) && (c.speedEnd || (c.keepPitch && speedValue(c) !== 1)))
            issues.push({ code: 'audio_fx_time_map', message: `clip ${c.id}: a sound that keeps its pitch at another speed, or changes speed gradually, cannot carry sound effects yet`, ids: [c.id] });
        }
        if ((c.fadeIn || c.fadeOut) && tr.kind !== 'audio') issues.push({ code: 'incompatible_track', message: `clip ${c.id}: audio fades belong to clips on audio tracks`, ids: [c.id] });
        if ((c.fadeIn && T.isNegative(c.fadeIn)) || (c.fadeOut && T.isNegative(c.fadeOut)) || T.lt(c.duration, T.add(c.fadeIn ?? T.ZERO, c.fadeOut ?? T.ZERO))) issues.push({ code: 'fade_out_of_bounds', message: `clip ${c.id}: fades are negative or longer than the clip`, ids: [c.id] });
        if (T.isNegative(c.sourceIn)) issues.push({ code: 'source_out_of_bounds', message: `clip ${c.id} sourceIn < 0`, ids: [c.id] });
        if (asset.kind !== 'image' && T.lt(asset.duration, sourceEnd(c)))
          issues.push({ code: 'source_out_of_bounds', message: `clip ${c.id} reads past the end of asset ${asset.id}`, ids: [c.id, asset.id] });
      }
    }
  }
  for (const [key, mk] of Object.entries(doc.markers ?? {})) {
    if (key !== mk.id) issues.push({ code: 'key_mismatch', message: `marker key ${key} != id ${mk.id}`, ids: [key] });
    uniq(mk.id);
    if (!doc.sequences[mk.sequenceId]) issues.push({ code: 'missing_sequence', message: `marker ${mk.id} refers to a missing sequence`, ids: [mk.id] });
    if (T.isNegative(mk.time) || !T.isFrameAligned(mk.time, doc.settings.frameRate)) issues.push({ code: 'marker_time', message: `marker ${mk.id} must sit on a non-negative whole frame`, ids: [mk.id] });
  }
  // Motion tracks (ADR-0015): one sample per source frame of a video asset, in equal-length integer columns.
  let samples = 0;
  for (const [key, mt] of Object.entries(motionTracks)) {
    if (key !== mt.id) issues.push({ code: 'key_mismatch', message: `motion track key ${key} != id ${mt.id}`, ids: [key] });
    uniq(mt.id); // an entity of its own (entities.ts): its id must not be another entity's
    const asset = doc.assets[mt.assetId];
    if (!asset?.video) issues.push({ code: 'missing_asset', message: `motion track ${mt.id} refers to asset ${mt.assetId}, which is missing or has no video`, ids: [mt.id, mt.assetId] });
    const n = mt.x.length;
    samples += n;
    if (mt.y.length !== n || mt.q.length !== n || mt.st.length !== n || (mt.s && mt.s.length !== n)) issues.push({ code: 'track_shape', message: `motion track ${mt.id}: its sample columns differ in length`, ids: [mt.id] });
    if ((mt.kind === 'region') !== !!mt.s || (mt.kind === 'region') !== !!mt.box) issues.push({ code: 'track_shape', message: `motion track ${mt.id}: sizes and a box belong exactly to region tracks`, ids: [mt.id] });
    if (asset?.video && asset.video.frameCount !== null && mt.from + n > asset.video.frameCount) issues.push({ code: 'track_range', message: `motion track ${mt.id} reaches past the last frame of asset ${asset.id}`, ids: [mt.id, asset.id] });
    if (mt.st.some((v) => !Number.isInteger(v) || v < 0 || v >= TRACK_STATES.length)) issues.push({ code: 'track_state', message: `motion track ${mt.id} has a state code outside 0..${TRACK_STATES.length - 1}`, ids: [mt.id] });
  }
  if (Object.keys(motionTracks).length > MAX_MOTION_TRACKS) issues.push({ code: 'track_limit', message: `the project has more than ${MAX_MOTION_TRACKS} motion tracks`, ids: [] });
  if (samples > MAX_PROJECT_TRACK_SAMPLES) issues.push({ code: 'track_limit', message: `the motion tracks hold ${samples} samples, more than ${MAX_PROJECT_TRACK_SAMPLES}`, ids: [] });
  for (const [key, va] of Object.entries(doc.variants ?? {})) {
    if (key !== va.id) issues.push({ code: 'key_mismatch', message: `variant key ${key} != id ${va.id}`, ids: [key] });
    uniq(va.id);
    // ADR-0017: a language variant made by translation says which language it is in, and a reviewed one says who reviewed it
    const tl = va.translation;
    if (tl && va.language !== tl.to) issues.push({ code: 'variant_translation', message: `variant ${va.id}: its language must be the language it was translated to`, ids: [va.id] });
    if (tl && tl.review === 'reviewed' && !tl.reviewedBy) issues.push({ code: 'variant_translation', message: `variant ${va.id}: a reviewed translation names its reviewer`, ids: [va.id] });
    if (tl && tl.review === 'needed' && (tl.reviewedBy || tl.reviewedAt)) issues.push({ code: 'variant_translation', message: `variant ${va.id}: a translation that needs review names no reviewer`, ids: [va.id] });
  }
  for (const [key, an] of Object.entries(doc.analyses ?? {})) {
    if (key !== an.assetId || !doc.assets[an.assetId]) issues.push({ code: 'missing_asset', message: `analysis ${key} refers to a missing asset`, ids: [key] });
    for (const [name, list] of [['scene cuts', an.scenes?.cuts], ['beats', an.beats?.beats], ['bar starts', an.beats?.downbeats]] as const)
      if (list?.some((t, i) => T.isNegative(t) || (i > 0 && !T.lt(list[i - 1]!, t)))) issues.push({ code: 'analysis_order', message: `${name} of asset ${key} must be non-negative and strictly ascending`, ids: [key] });
    // music sections (ADR-0022): each ends where the next starts, so they are ascending and the first starts with the file
    const sections = an.beats?.sections;
    if (sections?.length && (!T.isZero(sections[0]!.start) || sections.some((x, i) => i > 0 && !T.lt(sections[i - 1]!.start, x.start)))) issues.push({ code: 'analysis_sections', message: `music sections of asset ${key} must start at 0 and be strictly ascending`, ids: [key] });
    // measured moments (wave 5 family film, ADR-0026): windows of a video, inside its frames, each around its own peak
    const mo = an.moments;
    if (mo) {
      const asset = Object.hasOwn(doc.assets, an.assetId) ? doc.assets[an.assetId] : undefined;
      const why = momentsProblem(asset, mo);
      if (why) issues.push({ code: 'analysis_moments', message: `moments of asset ${key}: ${why}`, ids: [key] });
    }
  }
  for (const [key, tr] of Object.entries(doc.transcripts ?? {})) {
    if (key !== tr.assetId) issues.push({ code: 'key_mismatch', message: `transcript key ${key} != assetId ${tr.assetId}`, ids: [key] });
    if (!doc.assets[tr.assetId]?.audio) issues.push({ code: 'missing_asset', message: `transcript refers to asset ${tr.assetId}, which is missing or has no audio`, ids: [tr.assetId] });
    let prevEnd = T.ZERO;
    for (const seg of tr.segments) {
      uniq(seg.id);
      const end = T.add(seg.start, seg.duration);
      if (T.lt(seg.start, prevEnd) || !T.lt(T.ZERO, seg.duration)) issues.push({ code: 'transcript_order', message: `segment ${seg.id} overlaps the previous one or has no duration`, ids: [seg.id] });
      prevEnd = end;
      let w = seg.start;
      for (const word of seg.words) {
        uniq(word.id);
        if (T.lt(word.start, w) || T.lt(end, T.add(word.start, word.duration)) || T.isNegative(word.duration)) issues.push({ code: 'transcript_order', message: `word ${word.id} is out of order or outside its segment`, ids: [word.id, seg.id] });
        w = T.add(word.start, word.duration);
      }
    }
  }
  // life line (ADR-0021): the structure of the events; the grammar of live title fields is checked by lifeIssues (fields.ts).
  // A capture date and an event must also be ones the stored format holds (a real day inside the years, a total shift inside
  // its bound, 1 to MAX_EVENT_FILES files, a one-line name): the store writes a committed document as it is and parses it
  // only when it is read again, so anything the schema refuses here would be a project that no longer opens. An operation
  // that would leave one is refused (invalid_result) instead; the operations' own refusals (lifeOps.ts) come first.
  const storedAs = (schema: { safeParse(v: unknown): { success: true } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, value: unknown): string | null => {
    const parsed = schema.safeParse(value);
    if (parsed.success) return null;
    const first = parsed.error.issues[0];
    return first ? `${first.path.map(String).join('.') || 'value'}: ${first.message}` : 'not the stored shape';
  };
  for (const asset of Object.values(doc.assets)) {
    const why = asset.capture === undefined ? null : storedAs(CaptureSchema, asset.capture);
    if (why) issues.push({ code: 'life_capture', message: `file ${asset.id} has a capture date that cannot be stored (${why})`, ids: [asset.id] });
  }
  const inEvent = new Map<string, string>();
  for (const [key, ev] of Object.entries(doc.events ?? {})) {
    if (key !== ev.id) issues.push({ code: 'key_mismatch', message: `event key ${key} != id ${ev.id}`, ids: [key] });
    const why = storedAs(LifeEventSchema, ev);
    if (why) issues.push({ code: 'life_event_shape', message: `event ${ev.id} cannot be stored (${why})`, ids: [ev.id] });
    uniq(ev.id); // an entity of its own (entities.ts): its id must not be another entity's
    for (const assetId of ev.assetIds) {
      const asset = Object.hasOwn(doc.assets, assetId) ? doc.assets[assetId] : undefined;
      if (!asset || (asset.kind !== 'video' && asset.kind !== 'image')) issues.push({ code: 'life_event_asset', message: `event ${ev.id} lists file ${assetId}, which is missing or is not a picture or a video`, ids: [ev.id, assetId] });
      const other = inEvent.get(assetId);
      if (other !== undefined) issues.push({ code: 'life_event_overlap', message: other === ev.id ? `event ${ev.id} lists file ${assetId} twice` : `file ${assetId} is in two events (${other} and ${ev.id})`, ids: [ev.id, assetId] });
      inEvent.set(assetId, ev.id);
    }
  }
  if (Object.keys(doc.events ?? {}).length > MAX_LIFE_EVENTS) issues.push({ code: 'life_event_limit', message: `the project has more than ${MAX_LIFE_EVENTS} events`, ids: [] });
  // people (ADR-0021, people section): the same net as for events. A person must be one the stored format holds, an entity
  // of its own, and the only one with that name (compared as people.ts personNameKey does). A live field that names a
  // person who is not here is NOT an issue: it has no words and the export preflight reports it (field_no_data), so that
  // undoing an add_person never leaves a document that cannot be stored. No message here ever holds a birth date.
  const names = new Map<string, string>();
  for (const [key, person] of Object.entries(doc.people ?? {})) {
    if (key !== person.id) issues.push({ code: 'key_mismatch', message: `person key ${key} != id ${person.id}`, ids: [key] });
    const parsed = PersonSchema.safeParse(person);
    // only the name of the field that is wrong is given: the schema's own message could quote a value
    if (!parsed.success) issues.push({ code: 'life_person_shape', message: `person ${person.id} cannot be stored (${parsed.error.issues[0]?.path.map(String).join('.') || 'value'})`, ids: [person.id] });
    uniq(person.id);
    const nameKey = typeof person.name === 'string' ? personNameKey(person.name) : '';
    const other = names.get(nameKey);
    if (other !== undefined) issues.push({ code: 'life_person_name', message: `people ${other} and ${person.id} have the same name`, ids: [other, person.id] });
    names.set(nameKey, person.id);
  }
  if (Object.keys(doc.people ?? {}).length > MAX_PEOPLE) issues.push({ code: 'life_person_limit', message: `the project has more than ${MAX_PEOPLE} people`, ids: [] });
  issues.push(...lifeIssues(doc));
  return issues;
}
