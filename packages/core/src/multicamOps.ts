/**
 * The multicam operations (ADR-0020): create_multicam, set_multicam_sync, update_multicam, set_angle_look, place_multicam,
 * switch_angles, detach_from_multicam, remove_multicam (public) and attach_multicam_sync (internal). Registered on import of
 * this module (packages/core/src/index.ts exports it); every one runs only through applyTransaction.
 *
 * The lead's contract fixes the names, versions, descriptions and argument schemas (multicamContract.ts MulticamOpArgs), the
 * outputs, and every refusal with its code, English wording and hint (multicamRefusals.ts MULTICAM_REFUSALS; the Hebrew wording
 * is packages/i18n/src/multicam.ts HE_MULTICAM). The apply bodies (multicam W1) follow plan §3 and the W1 brief; until then each
 * refuses with MULTICAM_REFUSALS.notBuilt and changes nothing. MULTICAM_OPS_BUILT turns the fuzz rows on (ops-fuzz.gen.ts).
 *
 * RULES OF THE BODIES the lead adds to the brief (they settle findings against the moved tree):
 * - A program may sit on any sequence (shorts made sequences ordinary): look sequences up with sequences.ts sequenceOf.
 *   place_multicam with newSequence composes getOp('add_sequence').apply(d, {name, tracks: 'none'}, ctx) and writes
 *   origin {kind: 'multicam', groupId} on that sequence (the only writer of that member).
 * - The `multicam` map is absent until the first group: write (d.multicam ??= {}); remove_multicam deletes the emptied map.
 * - create_multicam takes each angle's kind from its first file when not given; a sound angle needs files with sound, a
 *   picture angle video files (angleKind); a file is named at most once (assetTwice). sampleRate = settings.sampleRate.
 * - set_angle_look with fromClipId: the clip's piece receives its redact and follow (privacy regions follow each angle's OWN
 *   file); clear: removes the look and every piece's redact and follow.
 * - Every op refuses when its changed entities exceed MAX_TOUCHED_ENTITIES (tooManyChanges).
 * - Ids from ctx.newId: 'mcg' (group), 'ang' (angle), 'spk' (speaker), 'clp' / 'trk' through the composed ops, 'fx' (effects).
 */
import type { z } from 'zod';
import * as T from '@pulseframe/time';
import { assertAligned, checkTransitionAt, defineOp, findClip, getOp, mustClip, newTrack, OpError, type OpContext, type OpResult } from './ops.ts';
import {
  MulticamOpArgs, multicamRefusal, MULTICAM_SUMMARIES, timeJson,
  type AttachMulticamSyncOutput, type CreateMulticamOutput, type DetachFromMulticamOutput, type PlaceMulticamOutput, type RemoveMulticamOutput, type SetAngleLookOutput,
  type SetMulticamSyncOutput, type SwitchAnglesOutput, type UpdateMulticamOutput,
} from './multicamContract.ts';
import { DEFAULT_TRANSFORM, type Clip, type MediaClip, type MulticamAngle, type MulticamGroup, type MulticamPiece, type ProjectDocument, type Sequence, type SyncAnchor, type SyncQuality, type Track, type Variant } from './schema.ts';
import {
  coverParts, driftTolerance, frac, fracAdd, fracCmp, fracMul, fracSeconds, groupGrid, isPlaced, lookOfClip, multicamGroupOf, multicamGroups, pieceCoverage, planPicture, planSound,
  programLocator, quantise, remapSource, segmentOf, toGroupExact, type Frac,
} from './multicam.ts';
import { DEFAULT_DRIFT_TOLERANCE_FRAMES, isPlacedVerdict, MAX_MULTICAM_GROUPS, MAX_PROJECT_ANCHORS, MAX_TOUCHED_ENTITIES, type SyncVerdict } from './multicamLimits.ts';
import { canonical, sameEntity } from './entities.ts';
import { sequenceOf } from './sequences.ts';
import { isFreeze, isRamped, isReverse, sourceEnd, speedOf, speedValue, toSourceSpan } from './speed.ts';
import { isTimeEffect } from './effects.ts';
import { clipEnd } from './validate.ts';

/** True once W1 has built the bodies: the operations fuzz (packages/evals/src/ops-fuzz.gen.ts) then draws the multicam rows. */
export const MULTICAM_OPS_BUILT = true;

// ---------- refusals this file raises outside the contract table (Hebrew: packages/i18n/src/refusals.ts HE_MULTICAM_W1) ----------
const refuse = {
  referenceIndex: (i: number, n: number) => new OpError('invalid_args', `referenceAngleIndex ${i} names no angle: the group has ${n} angles`, { referenceAngleIndex: i, angles: n }, 'Give the index (from 0) of one of the angles, or omit it: group time then follows the first sound recorder, else the first angle.'),
  soundAngleProgram: (label: string, angleId: string) => new OpError('incompatible', `"${label}" is a sound angle; a program shows a camera angle`, { angleId }, 'Choose a camera (picture) angle; a sound angle plays through `sound` in place_multicam.'),
  rangeTooShort: (from: number, to: number) => new OpError('invalid_args', `the group-time range from ${from.toFixed(3)}s to ${to.toFixed(3)}s is shorter than one frame`, { from, to }, 'Give a range that lasts at least one frame (from before to), or omit range to lay the whole recording.'),
  outsideFile: (clipId: string) => new OpError('out_of_bounds', `after this sync change, segment ${clipId} would show source outside its file`, { clipId }, 'Detach the segment first (detach_from_multicam), shorten it, or correct the sync by less.'),
  piecesOverlap: (label: string, i: number, j: number, angleId: string) => new OpError('incompatible', `files ${i} and ${j} of angle "${label}" would overlap in group time`, { angleId, pieceIndices: [i, j] }, 'One camera or recorder records one file at a time: correct the sync of one of them, or make them separate angles.'),
  speakerShot: (label: string) => new OpError('incompatible', `the shot of speaker "${label}" must be a picture angle of this group`, {}, 'Choose a camera (picture) angle as shotAngleId, or null to use the wide angle.'),
  speakerId: (id: string) => new OpError('invalid_args', `speaker id "${id.slice(0, 80)}" is used twice or is not 1 to 64 characters`, { id: id.slice(0, 80) }, 'Give each speaker its own short id, or omit id to have one made.'),
  verdictAnchors: (verdict: string) => new OpError('invalid_args', `a file with verdict ${verdict} ${isPlacedVerdict(verdict as SyncVerdict) ? 'needs at least one anchor' : 'cannot carry anchors'}`, { verdict }, 'Measured files that are placed carry anchors; ambiguous, no-shared-sound and inconsistent results carry none.'),
};

// ---------- lookups ----------
const mustGroup = (d: ProjectDocument, groupId: string): MulticamGroup => {
  const g = multicamGroupOf(d, groupId);
  if (!g) throw multicamRefusal('groupNotFound', { groupId, groupIds: multicamGroups(d).map((x) => x.id) }, groupId);
  return g;
};
const mustAngle = (g: MulticamGroup, angleId: string): MulticamAngle => {
  const a = g.angles.find((x) => x.id === angleId);
  if (!a) throw multicamRefusal('angleNotFound', { groupId: g.id, angleId, angleIds: g.angles.map((x) => x.id) }, angleId, g.id);
  return a;
};
const mustPiece = (a: MulticamAngle, pieceIndex: number): MulticamPiece => {
  const p = a.pieces[pieceIndex];
  if (!p) throw multicamRefusal('pieceNotFound', { angleId: a.id, pieceIndex, pieces: a.pieces.length }, a.id, pieceIndex);
  return p;
};
const assetOf = (d: ProjectDocument, id: string) => (Object.hasOwn(d.assets, id) ? d.assets[id] : undefined);
const hasSound = (d: ProjectDocument, a: MulticamAngle) => a.pieces.every((p) => !!assetOf(d, p.assetId)?.audio);
const anglePlaced = (a: MulticamAngle) => a.pieces.some(isPlaced);
const isReferencePiece = (g: MulticamGroup, a: MulticamAngle, i: number) => a.id === g.referenceAngleId && i === 0;
const quality = (verdict: SyncVerdict, anchorsUsed = 0): SyncQuality => ({ verdict, peakZ: null, peakRatio: null, anchorsUsed, anchorsRejected: 0, residualSamples: null, driftPpm: null, overlapSeconds: null, candidates: [], chainDepth: 0, jobId: null });
const sortTrack = (t: Track) => t.clips.sort((a, b) => T.cmp(a.start, b.start) || (a.id < b.id ? -1 : 1));
const lockedTrack = (t: Track) => new OpError('track_locked', `track ${t.id} is locked`, { trackId: t.id });
/** Every tagged clip of a group, wherever it is. */
function taggedClips(d: ProjectDocument, groupId: string): { seq: Sequence; track: Track; clip: MediaClip }[] {
  const out: { seq: Sequence; track: Track; clip: MediaClip }[] = [];
  for (const seq of Object.values(d.sequences)) for (const track of seq.tracks) for (const clip of track.clips) if (clip.type === 'media' && clip.multicam?.groupId === groupId) out.push({ seq, track, clip });
  return out;
}

// ---------- what one step changed, exactly (the entities a diff would report), for MAX_TOUCHED_ENTITIES ----------
class Ledger {
  private clips = new Map<string, { seq: string; track: string; before: Clip | null }>();
  private vars = new Map<string, Variant>();
  readonly other = new Set<string>();
  clip(seq: string, track: string, c: Clip) { if (!this.clips.has(c.id)) this.clips.set(c.id, { seq, track, before: structuredClone(c) }); }
  created(seq: string, track: string, id: string) { if (!this.clips.has(id)) this.clips.set(id, { seq, track, before: null }); }
  variants(d: ProjectDocument) { for (const v of Object.values(d.variants ?? {})) if (!this.vars.has(v.id)) this.vars.set(v.id, structuredClone(v)); }
  touched(): Set<string> { return new Set(this.clips.keys()); }
  changed(d: ProjectDocument): string[] {
    const out = [...this.other];
    const tracks = new Set([...this.clips.values()].map((x) => x.track));
    const now = new Map<string, Clip>();
    for (const seq of Object.values(d.sequences)) for (const t of seq.tracks) if (tracks.has(t.id)) for (const c of t.clips) now.set(c.id, c);
    for (const [id, x] of this.clips) {
      const cur = now.get(id);
      if (!x.before || !cur) { if (x.before || cur) out.push(id); continue; }
      if (!sameEntity({ kind: 'clip', sequenceId: x.seq, trackId: x.track, clip: x.before }, { kind: 'clip', sequenceId: x.seq, trackId: x.track, clip: cur })) out.push(id);
    }
    for (const [id, v] of this.vars) { const cur = Object.hasOwn(d.variants, id) ? d.variants[id] : undefined; if (!cur || !sameEntity({ kind: 'variant', variant: v }, { kind: 'variant', variant: cur })) out.push(id); }
    return out;
  }
  /** The changed ids, refused above MAX_TOUCHED_ENTITIES so the step's undo fits one restore_entities. */
  guard(d: ProjectDocument): string[] {
    const ids = this.changed(d);
    if (ids.length > MAX_TOUCHED_ENTITIES) throw multicamRefusal('tooManyChanges', { count: ids.length, max: MAX_TOUCHED_ENTITIES, why: 'too_many_changes' }, ids.length);
    return ids;
  }
}

// ---------- sync maps ----------
/** The anchor rules of validate.ts multicam_sync, said as refusals: whole samples, strictly increasing both ways, |slope − 1| ≤ 1000 ppm. */
function checkAnchors(g: MulticamGroup, anchors: readonly SyncAnchor[]) {
  const sr = { num: g.sampleRate, den: 1 };
  if (anchors.some((k) => !T.isFrameAligned(k.group, sr) || !T.isFrameAligned(k.source, sr))) throw multicamRefusal('anchorOffSample', { sampleRate: g.sampleRate }, g.sampleRate);
  for (let k = 1; k < anchors.length; k++) {
    const dg = T.sampleIndexAt(anchors[k]!.group, g.sampleRate) - T.sampleIndexAt(anchors[k - 1]!.group, g.sampleRate);
    const ds = T.sampleIndexAt(anchors[k]!.source, g.sampleRate) - T.sampleIndexAt(anchors[k - 1]!.source, g.sampleRate);
    if (dg <= 0 || ds <= 0) throw multicamRefusal('anchorsNotIncreasing', { index: k });
    if (Math.abs(dg - ds) * 1000 > ds) throw multicamRefusal('driftTooLarge', { index: k, maxPpm: 1000 });
  }
}
/** The files of one angle never overlap in group time (one camera records one file at a time; multicamValidate.ts). */
function checkOverlap(d: ProjectDocument, g: MulticamGroup, a: MulticamAngle) {
  const grid = groupGrid(d, g);
  const spans = a.pieces.flatMap((p, i) => { const asset = assetOf(d, p.assetId); const c = asset ? pieceCoverage(p, asset.duration, grid) : null; return c ? [{ i, ...c }] : []; }).sort((x, y) => T.cmp(x.start, y.start));
  for (let k = 1; k < spans.length; k++) if (T.lt(spans[k]!.start, spans[k - 1]!.end)) throw refuse.piecesOverlap(a.label, Math.min(spans[k - 1]!.i, spans[k]!.i), Math.max(spans[k - 1]!.i, spans[k]!.i), a.id);
}
function checkProjectAnchors(d: ProjectDocument) {
  const n = multicamGroups(d).reduce((s, g) => s + g.angles.reduce((t, a) => t + a.pieces.reduce((u, p) => u + p.anchors.length, 0), 0), 0);
  if (n > MAX_PROJECT_ANCHORS) throw multicamRefusal('tooManyAnchors', { anchors: n, max: MAX_PROJECT_ANCHORS });
}
/** The transition at the start of each clip, and at the start of the clip after it, re-checked against the handles the edit left (set_transition's words; details name the clip). */
function checkHandles(d: ProjectDocument, list: Iterable<{ track: Track; clip: MediaClip }>) {
  const seen = new Set<string>();
  for (const { track, clip } of list) {
    const end = clipEnd(clip);
    const next = track.clips.find((c) => c.id !== clip.id && T.eq(c.start, end));
    for (const c of [clip, next]) {
      if (!c || c.type !== 'media' || seen.has(c.id) || track.kind !== 'video') continue;
      seen.add(c.id);
      try { checkTransitionAt(d, track, c); } catch (e) { if (e instanceof OpError) e.details = { ...e.details, clipId: c.id }; throw e; }
    }
  }
}
/**
 * After the maps of some files changed: every tagged segment showing one of them keeps its group time, remapped in the same
 * step with the one rounding of a switch. A segment of a file that is (or was) not placed is left as it is.
 */
function remapChanged(d: ProjectDocument, g: MulticamGroup, before: Map<string, MulticamPiece>, ledger: Ledger): string[] {
  const grid = groupGrid(d, g), out: string[] = [], touched: { track: Track; clip: MediaClip }[] = [];
  for (const { seq, track, clip } of taggedClips(d, g.id)) {
    const seg = segmentOf(d, seq.id, track, clip);
    if (!seg) continue;
    const old = before.get(`${seg.angle.id}:${seg.pieceIndex}`), now = seg.angle.pieces[seg.pieceIndex]!;
    if (!old || !isPlaced(old) || !isPlaced(now)) continue;
    const next = remapSource(old, now, clip.sourceIn, grid);
    if (T.eq(next, clip.sourceIn)) continue;
    if (track.locked) throw lockedTrack(track);
    const asset = assetOf(d, clip.assetId)!;
    const used = toSourceSpan(clip, clip.duration);
    if (T.isNegative(next) || (isFreeze(clip) ? !T.lt(next, asset.duration) : T.lt(asset.duration, T.add(next, used)))) throw refuse.outsideFile(clip.id);
    ledger.clip(seq.id, track.id, clip);
    clip.sourceIn = next;
    out.push(clip.id);
    touched.push({ track, clip });
  }
  checkHandles(d, touched);
  return out;
}

// ---------- looks (D7: the look travels with the angle) ----------
const PLACEMENT = ['x', 'y', 'scale', 'rotation'] as const;
type Report = { dropped: SwitchAnglesOutput['dropped']; warnings: Map<SwitchAnglesOutput['warnings'][number]['code'], Set<string>> };
const newReport = (): Report => ({ dropped: [], warnings: new Map() });
const warn = (r: Report, code: SwitchAnglesOutput['warnings'][number]['code'], clipId: string) => { let s = r.warnings.get(code); if (!s) r.warnings.set(code, (s = new Set())); s.add(clipId); };
const warningsOf = (r: Report, alive?: (id: string) => string | null): SwitchAnglesOutput['warnings'] =>
  [...r.warnings].map(([code, ids]) => ({ code, clipIds: [...new Set([...ids].map((id) => (alive ? alive(id) : id)).filter((x): x is string => !!x))] }));
const droppedOf = (r: Report, alive?: (id: string) => string | null): SwitchAnglesOutput['dropped'] => {
  const seen = new Set<string>(), out: SwitchAnglesOutput['dropped'] = [];
  for (const x of r.dropped) { const id = alive ? alive(x.clipId) : x.clipId; if (!id || seen.has(`${id}:${x.what}`)) continue; seen.add(`${id}:${x.what}`); out.push({ clipId: id, what: x.what }); }
  return out;
};
const own = <V>(rec: Record<string, V>, key: string): V | undefined => (Object.hasOwn(rec, key) ? rec[key] : undefined);
/**
 * Give a segment the look of its (new) angle: the angle's framing (the segment keeps its own opacity and opacity keys), its
 * non-time effects (fresh ids; a time effect stays first), mask, blend and per-format framing, and its piece's privacy regions
 * and follow. Transition, fades, gain and speed stay. What it drops is reported.
 */
function applyLook(d: ProjectDocument, clip: MediaClip, angle: MulticamAngle, piece: MulticamPiece, ctx: OpContext, rep: Report) {
  const look = angle.look, base = look?.transform ?? DEFAULT_TRANSFORM;
  clip.transform = { x: base.x, y: base.y, scale: base.scale, rotation: base.rotation, opacity: clip.transform.opacity };
  if (clip.keyframes) {
    if (PLACEMENT.some((p) => clip.keyframes![p]?.length)) rep.dropped.push({ clipId: clip.id, what: 'keyframes' });
    for (const p of PLACEMENT) delete clip.keyframes[p];
    if (!Object.values(clip.keyframes).some((v) => v?.length)) delete clip.keyframes;
  }
  const time = (clip.effects ?? []).filter((e) => isTimeEffect(e.type));
  if ((clip.effects ?? []).some((e) => !isTimeEffect(e.type) && e.keyframes && Object.keys(e.keyframes).length)) rep.dropped.push({ clipId: clip.id, what: 'effect_keyframes' });
  const effects = [...time, ...(look?.effects ?? []).map((e) => ({ ...structuredClone(e), id: ctx.newId('fx') }))].slice(0, 16);
  if (effects.length) clip.effects = effects; else delete clip.effects;
  if (look?.mask) clip.mask = structuredClone(look.mask); else delete clip.mask;
  if (look?.blend) clip.blend = look.blend; else delete clip.blend;
  const timeFirst = (() => { const f = clip.effects?.find((e) => e.enabled); return !!f && isTimeEffect(f.type); })();
  const follow = piece.follow && !timeFirst ? structuredClone(piece.follow) : undefined;
  if (clip.follow && canonical(clip.follow) !== canonical(follow ?? null)) rep.dropped.push({ clipId: clip.id, what: 'follow' });
  if (follow) clip.follow = follow; else delete clip.follow;
  for (const v of Object.values(d.variants ?? {})) {
    const ov = own(v.overrides, clip.id), next = look?.variantTransforms ? own(look.variantTransforms, v.id) : undefined;
    if (ov?.transform && Object.keys(ov.transform).length && canonical(ov.transform) !== canonical(next ?? null)) rep.dropped.push({ clipId: clip.id, what: 'variant_transform' });
    if (next) { if (ov) ov.transform = structuredClone(next); else v.overrides[clip.id] = { transform: structuredClone(next) }; }
    else if (ov) { delete ov.transform; if (!Object.keys(ov).some((k) => (ov as Record<string, unknown>)[k] !== undefined)) delete v.overrides[clip.id]; }
  }
  const hadRegions = !!clip.redact;
  if (piece.redact) clip.redact = structuredClone(piece.redact); else delete clip.redact;
  if (hadRegions && !piece.redact) warn(rep, 'redaction_missing', clip.id);
  if (speedValue(clip) !== 1) warn(rep, 'speed_not_following_sound', clip.id);
}
/** A look compared with ids ignored (set_angle_look apply 'unedited'): framing without opacity, effects, mask, blend, per-format framing, privacy regions and follow. */
function lookKey(look: { transform?: { x: number; y: number; scale: number; rotation: number }; effects?: { type: string; enabled: boolean; params: unknown; modulate?: unknown }[]; mask?: unknown; blend?: unknown; variantTransforms?: unknown } | undefined, redact: { id: string }[] | undefined, follow: unknown): string {
  const t = look?.transform ?? DEFAULT_TRANSFORM;
  return canonical({
    t: [t.x, t.y, t.scale, t.rotation], e: (look?.effects ?? []).map((e) => ({ type: e.type, enabled: e.enabled, params: e.params, modulate: e.modulate ?? null })),
    m: look?.mask ?? null, b: look?.blend ?? null, v: look?.variantTransforms ?? null, r: (redact ?? []).map(({ id: _id, ...rest }) => rest), f: follow ?? null,
  });
}

// ---------- splitting a program segment (split_clip itself, as split_at_scenes does) ----------
const SCRATCH = 'trk_mc_scratch';
/**
 * Split a segment with split_clip (includeLinked false; only unlinked segments are switched). split_clip finds a clip by a scan
 * over every sequence and re-sorts its track, which over a long program and a thousand cuts is quadratic, so the segment is
 * split on a one-clip scratch track that the scan meets first and then put back in its place. Nothing else differs from an
 * ordinary split (copied per-format overrides, shifted keys, the transition left on the left part).
 */
function splitAt(d: ProjectDocument, seqId: string, track: Track, clip: MediaClip, at: T.RationalTime, ctx: OpContext, ledger: Ledger): MediaClip {
  const idx = track.clips.indexOf(clip);
  ledger.clip(seqId, track.id, clip);
  const first = Object.values(d.sequences)[0]!;
  const scratch: Track = { id: SCRATCH, kind: track.kind, name: '', locked: false, muted: false, hidden: false, clips: [clip] };
  track.clips.splice(idx, 1);
  first.tracks.unshift(scratch);
  let rightId: string;
  try { rightId = getOp('split_clip')!.apply(d, { clipId: clip.id, at, includeLinked: false }, ctx).output!.rightClipId as string; }
  finally { first.tracks.shift(); track.clips.splice(idx, 0, ...scratch.clips); }
  ledger.created(seqId, track.id, rightId);
  return track.clips[idx + 1] as MediaClip;
}

// ---------- create_multicam ----------
function createMulticam(d: ProjectDocument, a: z.infer<typeof MulticamOpArgs.create_multicam>, ctx: OpContext): OpResult {
  const groups = multicamGroups(d);
  if (groups.length >= MAX_MULTICAM_GROUPS) throw multicamRefusal('tooManyGroups', { max: MAX_MULTICAM_GROUPS });
  const seen = new Set<string>();
  const kinds = a.angles.map((an) => {
    for (const id of an.assetIds) {
      if (!assetOf(d, id)) throw new OpError('not_found', `asset ${id} not found`, { assetId: id }, 'Call get_summary to list assets.');
      if (seen.has(id)) throw multicamRefusal('assetTwice', { assetId: id }, id);
      seen.add(id);
    }
    const firstAsset = assetOf(d, an.assetIds[0]!)!;
    const kind = an.kind ?? (firstAsset.kind === 'video' && firstAsset.video ? 'picture' : 'sound');
    for (const id of an.assetIds) { const x = assetOf(d, id)!; if (kind === 'picture' ? !(x.kind === 'video' && x.video) : !x.audio) throw multicamRefusal('angleKind', { assetId: id, kind }, id, kind); }
    return kind;
  });
  const ref = a.referenceAngleIndex ?? Math.max(0, kinds.indexOf('sound'));
  if (ref >= a.angles.length) throw refuse.referenceIndex(ref, a.angles.length);
  const id = ctx.newId('mcg');
  const count = { picture: 0, sound: 0 };
  const angles: MulticamAngle[] = a.angles.map((an, i) => {
    const kind = kinds[i]!, n = ++count[kind];
    return {
      id: ctx.newId('ang'), label: an.label ?? (kind === 'picture' ? `מצלמה ${n}` : `מיקרופון ${n}`), kind,
      pieces: an.assetIds.map((assetId, j) => (i === ref && j === 0 ? { assetId, anchors: [{ group: T.ZERO, source: T.ZERO }], quality: quality('reference') } : { assetId, anchors: [], quality: quality('unsynced') })),
    };
  });
  const name = a.name ?? `מולטיקאם ${groups.length + 1}`;
  const group: MulticamGroup = { id, name, sampleRate: d.settings.sampleRate, referenceAngleId: angles[ref]!.id, angles, speakers: [], wideAngleId: null, origin: { method: 'manual', params: {}, createdAt: 'op', createdBy: ctx.actor, edited: false } };
  (d.multicam ??= {})[id] = group;
  const output: CreateMulticamOutput = { groupId: id, angleIds: angles.map((x) => x.id), referenceAngleId: group.referenceAngleId };
  return { affectedIds: [id], summary: MULTICAM_SUMMARIES.created(name, angles.length), output: output as unknown as Record<string, unknown> };
}

// ---------- attach_multicam_sync (internal) / set_multicam_sync ----------
function attachSync(d: ProjectDocument, a: z.infer<typeof MulticamOpArgs.attach_multicam_sync>, ctx: OpContext): OpResult {
  const g = mustGroup(d, a.groupId);
  const before = new Map<string, MulticamPiece>();
  const touchedAngles = new Set<MulticamAngle>();
  for (const e of a.pieces) {
    const angle = mustAngle(g, e.angleId), piece = mustPiece(angle, e.pieceIndex);
    if (isReferencePiece(g, angle, e.pieceIndex)) throw multicamRefusal('referenceFixed', { groupId: g.id, angleId: angle.id, pieceIndex: e.pieceIndex });
    if (piece.quality.verdict === 'manual' && !a.overwrite) throw multicamRefusal('wouldDiscardManual', { groupId: g.id, angleId: angle.id, pieceIndex: e.pieceIndex, why: 'would_discard_edits' }, angle.label);
    if (e.quality.verdict === 'reference' || e.quality.verdict === 'manual' || isPlacedVerdict(e.quality.verdict) !== e.anchors.length > 0) throw refuse.verdictAnchors(e.quality.verdict);
    checkAnchors(g, e.anchors);
    const key = `${angle.id}:${e.pieceIndex}`;
    if (!before.has(key)) before.set(key, structuredClone(piece));
    piece.anchors = structuredClone(e.anchors);
    piece.quality = structuredClone(e.quality);
    touchedAngles.add(angle);
  }
  for (const an of touchedAngles) checkOverlap(d, g, an);
  checkProjectAnchors(d);
  g.origin = { method: a.method, params: { ...a.params }, createdAt: a.createdAt, createdBy: ctx.actor, edited: g.angles.some((an) => an.pieces.some((p) => p.quality.verdict === 'manual')) };
  const ledger = new Ledger();
  ledger.other.add(g.id);
  const remappedClipIds = remapChanged(d, g, before, ledger);
  const affected = ledger.guard(d);
  const output: AttachMulticamSyncOutput = { pieces: a.pieces.map((e) => ({ angleId: e.angleId, pieceIndex: e.pieceIndex, verdict: e.quality.verdict, anchors: e.anchors.length })), remappedClipIds };
  return { affectedIds: affected, summary: MULTICAM_SUMMARIES.synced(a.pieces.length), output: output as unknown as Record<string, unknown> };
}
function setSync(d: ProjectDocument, a: z.infer<typeof MulticamOpArgs.set_multicam_sync>): OpResult {
  if ([a.nudge, a.offset, a.anchors, a.clear].filter((x) => x !== undefined).length !== 1) throw multicamRefusal('syncForm', {});
  const g = mustGroup(d, a.groupId), angle = mustAngle(g, a.angleId), piece = mustPiece(angle, a.pieceIndex);
  if (isReferencePiece(g, angle, a.pieceIndex)) throw multicamRefusal('referenceFixed', { groupId: g.id, angleId: angle.id, pieceIndex: a.pieceIndex });
  const before = new Map([[`${angle.id}:${a.pieceIndex}`, structuredClone(piece)]]);
  let anchors: SyncAnchor[];
  if (a.clear) anchors = [];
  else if (a.offset) anchors = [{ group: a.offset, source: T.ZERO }];
  else if (a.anchors) anchors = structuredClone(a.anchors);
  else {
    if (!isPlaced(piece)) throw multicamRefusal('notSynced', { groupId: g.id, angleId: angle.id, pieceIndex: a.pieceIndex, why: 'not_synced' }, angle.label);
    // a nudge by a frame at 30000/1001 is not a whole number of samples: it moves the file by the nearest whole sample
    const by = T.rt(T.nearestSampleIndex(a.nudge!, g.sampleRate), g.sampleRate);
    anchors = piece.anchors.map((k) => ({ group: T.add(k.group, by), source: k.source }));
  }
  checkAnchors(g, anchors);
  piece.anchors = anchors;
  piece.quality = quality(a.clear ? 'unsynced' : 'manual', a.clear ? 0 : Math.min(anchors.length, 64));
  g.origin = { ...g.origin, edited: true };
  checkOverlap(d, g, angle);
  checkProjectAnchors(d);
  const ledger = new Ledger();
  ledger.other.add(g.id);
  const remappedClipIds = remapChanged(d, g, before, ledger);
  const output: SetMulticamSyncOutput = { remappedClipIds };
  return { affectedIds: ledger.guard(d), summary: MULTICAM_SUMMARIES.corrected(angle.label), output: output as unknown as Record<string, unknown> };
}

// ---------- update_multicam ----------
const SPEAKER_ID = /^[^\s]{1,64}$/;
function updateMulticam(d: ProjectDocument, a: z.infer<typeof MulticamOpArgs.update_multicam>, ctx: OpContext): OpResult {
  if (a.name === undefined && a.wideAngleId === undefined && a.angles === undefined && a.speakers === undefined) throw multicamRefusal('nothingToUpdate', {});
  const g = mustGroup(d, a.groupId);
  if (a.name !== undefined) g.name = a.name;
  for (const x of a.angles ?? []) mustAngle(g, x.angleId).label = x.label;
  if (a.wideAngleId !== undefined) {
    if (a.wideAngleId === null) g.wideAngleId = null;
    else { const w = mustAngle(g, a.wideAngleId); if (w.kind !== 'picture') throw multicamRefusal('wideNotPicture', { angleId: w.id }, w.label); g.wideAngleId = w.id; }
  }
  if (a.speakers) {
    const ids = new Set<string>();
    g.speakers = a.speakers.map((s) => {
      const id = s.id ?? ctx.newId('spk');
      if (!SPEAKER_ID.test(id) || ids.has(id)) throw refuse.speakerId(id);
      ids.add(id);
      const mic = g.angles.find((x) => x.id === s.micAngleId);
      if (!mic || !hasSound(d, mic)) throw multicamRefusal('speakerMic', { micAngleId: s.micAngleId }, s.label);
      if (s.shotAngleId !== null && g.angles.find((x) => x.id === s.shotAngleId)?.kind !== 'picture') throw refuse.speakerShot(s.label);
      return { id, label: s.label, micAngleId: s.micAngleId, channel: s.channel, shotAngleId: s.shotAngleId, ...(s.transcriptSpeaker !== undefined ? { transcriptSpeaker: s.transcriptSpeaker } : {}) };
    });
  }
  const output: UpdateMulticamOutput = { speakerIds: g.speakers.map((s) => s.id) };
  return { affectedIds: [g.id], summary: MULTICAM_SUMMARIES.updated(g.name), output: output as unknown as Record<string, unknown> };
}

// ---------- set_angle_look ----------
function setAngleLook(d: ProjectDocument, a: z.infer<typeof MulticamOpArgs.set_angle_look>, ctx: OpContext): OpResult {
  if ((a.fromClipId === undefined) === (a.clear === undefined)) throw multicamRefusal('lookForm', {});
  const g = mustGroup(d, a.groupId), angle = mustAngle(g, a.angleId);
  if (angle.kind !== 'picture') throw multicamRefusal('soundAngleLook', { angleId: angle.id }, angle.label);
  const oldKeys = angle.pieces.map((p) => lookKey(angle.look, p.redact, p.follow));
  const rep = newReport();
  if (a.fromClipId !== undefined) {
    const f = findClip(d, a.fromClipId);
    if (!f) throw new OpError('not_found', `clip ${a.fromClipId} not found`, { clipId: a.fromClipId }, 'Call get_timeline to list current clip ids.');
    const seg = segmentOf(d, f.seq.id, f.track, f.clip);
    if (!seg) throw multicamRefusal('notTagged', { clipId: f.clip.id }, f.clip.id);
    if (seg.group.id !== g.id || seg.angle.id !== angle.id) throw multicamRefusal('notThisAngle', { clipId: f.clip.id, angleId: angle.id }, f.clip.id, angle.label);
    const L = lookOfClip(d, seg.clip);
    angle.look = L.look;
    const piece = angle.pieces[seg.pieceIndex]!;
    if (L.redact) piece.redact = L.redact; else delete piece.redact;
    if (L.follow) piece.follow = L.follow; else delete piece.follow;
    for (const what of L.dropped) rep.dropped.push({ clipId: seg.clip.id, what: what as SwitchAnglesOutput['dropped'][number]['what'] });
  } else {
    delete angle.look;
    for (const p of angle.pieces) { delete p.redact; delete p.follow; }
  }
  const mode = a.apply ?? 'unedited';
  const ledger = new Ledger();
  ledger.other.add(g.id);
  ledger.variants(d);
  const applied: string[] = [], kept: string[] = [];
  for (const { seq, track, clip } of taggedClips(d, g.id)) {
    const seg = segmentOf(d, seq.id, track, clip);
    if (!seg || seg.angle.id !== angle.id || track.kind !== 'video') continue;
    if (clip.id === a.fromClipId) { applied.push(clip.id); continue; }
    const { look } = lookOfClip(d, clip);
    const unedited = lookKey(look, clip.redact, clip.follow) === oldKeys[seg.pieceIndex];
    if (mode === 'none' || track.locked || (mode === 'unedited' && !unedited)) { kept.push(clip.id); continue; }
    ledger.clip(seq.id, track.id, clip);
    applyLook(d, clip, angle, angle.pieces[seg.pieceIndex]!, ctx, rep);
    applied.push(clip.id);
  }
  const affected = ledger.guard(d);
  const output: SetAngleLookOutput = { appliedClipIds: applied, keptClipIds: kept, dropped: droppedOf(rep), warnings: warningsOf(rep) };
  return { affectedIds: affected, summary: MULTICAM_SUMMARIES.look(angle.label, applied.length), output: output as unknown as Record<string, unknown> };
}

// ---------- place_multicam ----------
const mustSequence = (d: ProjectDocument, id: string): Sequence => {
  const s = sequenceOf(d, id);
  if (!s) throw new OpError('not_found', `sequence ${id} not found`, { sequenceId: id });
  return s;
};
/** Group-time span the placed files of these angles cover together (min start, max end), or null. */
function coverageOf(d: ProjectDocument, g: MulticamGroup, angles: MulticamAngle[]): { start: T.RationalTime; end: T.RationalTime } | null {
  const grid = groupGrid(d, g);
  let out: { start: T.RationalTime; end: T.RationalTime } | null = null;
  for (const an of angles) for (const p of an.pieces) {
    const asset = assetOf(d, p.assetId), c = asset ? pieceCoverage(p, asset.duration, grid) : null;
    if (c) out = out ? { start: T.min(out.start, c.start), end: T.max(out.end, c.end) } : c;
  }
  return out;
}
const programClip = (id: string, assetId: string, start: T.RationalTime, duration: T.RationalTime, sourceIn: T.RationalTime, groupId: string, angleId: string): MediaClip =>
  ({ id, type: 'media', assetId, start, duration, sourceIn, gain: 1, linkGroupId: null, transform: { ...DEFAULT_TRANSFORM }, multicam: { groupId, angleId } });
function placeMulticam(d: ProjectDocument, a: z.infer<typeof MulticamOpArgs.place_multicam>, ctx: OpContext): OpResult {
  const g = mustGroup(d, a.groupId), angle = mustAngle(g, a.angleId);
  if (angle.kind !== 'picture') throw refuse.soundAngleProgram(angle.label, angle.id);
  if (!anglePlaced(angle)) throw multicamRefusal('notSynced', { groupId: g.id, angleId: angle.id, why: 'not_synced' }, angle.label);
  if (a.newSequence && (a.sequenceId !== undefined || a.trackId !== undefined)) throw multicamRefusal('newSequenceAndTrack', {});
  // program sound: the given angles, else the first sound angle, else the reference when its files have sound
  const firstSound = g.angles.find((x) => x.kind === 'sound');
  const reference = mustAngle(g, g.referenceAngleId);
  const soundIds = a.sound ?? (firstSound ? [firstSound.id] : hasSound(d, reference) ? [reference.id] : []);
  const sounds = [...new Set(soundIds)].map((id) => mustAngle(g, id));
  for (const s of sounds) {
    const silent = s.pieces.find((p) => !assetOf(d, p.assetId)?.audio);
    if (silent) throw multicamRefusal('angleKind', { assetId: silent.assetId, kind: 'sound' }, silent.assetId, 'sound');
    if (!anglePlaced(s)) throw multicamRefusal('notSynced', { groupId: g.id, angleId: s.id, why: 'not_synced' }, s.label);
  }
  assertAligned(d, a.at, 'at');
  if (T.isNegative(a.at)) throw new OpError('out_of_bounds', 'start must be >= 0', { start: a.at });
  const rate = d.settings.frameRate;
  const range = a.range ? { start: a.range.from, end: a.range.to } : coverageOf(d, g, sounds.length ? sounds : [angle])!;
  const from = range.start, to = range.end;
  const frames = T.lt(from, to) ? T.frameIndexAt(T.sub(to, from), rate) : 0;
  if (frames < 1) throw refuse.rangeTooShort(T.toSeconds(from), T.toSeconds(to));
  const duration = T.frameTime(frames, rate);
  const fill = a.fill ?? true, drift = a.driftToleranceFrames ?? DEFAULT_DRIFT_TOLERANCE_FRAMES;
  const pic = planPicture(d, g, { angleId: angle.id, at: a.at, g0: from, duration, fill, driftToleranceFrames: drift });
  if (!pic.segments.length) throw multicamRefusal('notCovering', { groupId: g.id, angleId: angle.id, from: timeJson(from), to: timeJson(to) }, angle.label, T.toSeconds(from), T.toSeconds(to));
  // where the program goes
  const ledger = new Ledger();
  ledger.variants(d);
  let seq: Sequence;
  let video: Track;
  if (a.newSequence) {
    const r = getOp('add_sequence')!.apply(d, { name: a.newSequence.name, tracks: 'empty' }, ctx);
    seq = d.sequences[r.output!.sequenceId as string]!;
    seq.origin = { kind: 'multicam', groupId: g.id };
    for (const id of r.affectedIds) ledger.other.add(id);
  } else seq = a.sequenceId !== undefined ? mustSequence(d, a.sequenceId) : d.sequences[d.mainSequenceId]!;
  if (a.trackId !== undefined) {
    const t = seq.tracks.find((x) => x.id === a.trackId);
    if (!t) throw new OpError('not_found', `track ${a.trackId} not found`, { trackId: a.trackId });
    if (t.kind !== 'video') throw multicamRefusal('trackKind', { trackId: t.id }, t.id, 'video');
    if (t.locked) throw lockedTrack(t);
    if (t.clips.length) throw multicamRefusal('trackNotEmpty', { trackId: t.id }, t.id);
    video = t;
  } else { video = newTrack(seq, 'video', ctx); ledger.other.add(video.id); }
  const rep = newReport();
  const created: string[] = [];
  const filled: PlaceMulticamOutput['filled'] = [];
  const groupAt = (t: T.RationalTime) => T.add(from, T.sub(t, a.at));
  for (const s of pic.segments) {
    const an = mustAngle(g, s.angleId), piece = an.pieces[s.pieceIndex]!;
    const clip = programClip(ctx.newId('clp'), s.assetId, s.start, s.duration, s.sourceIn, g.id, an.id);
    applyLook(d, clip, an, piece, ctx, rep);
    video.clips.push(clip);
    created.push(clip.id);
    ledger.created(seq.id, video.id, clip.id);
    if (an.id !== angle.id) {
      const last = filled.at(-1), start = groupAt(s.start), end = groupAt(T.add(s.start, s.duration));
      if (last && last.angleId === an.id && T.eq(last.end, start)) last.end = timeJson(end);
      else filled.push({ start: timeJson(start), end: timeJson(end), angleId: an.id });
    }
  }
  sortTrack(video);
  const soundTrackIds: string[] = [];
  let soundChunks = 0, maxSoundErrorSeconds = 0;
  for (const s of sounds) {
    const plan = planSound(d, g, { angleId: s.id, at: a.at, g0: from, duration });
    if (!plan.clips.length) continue;
    const track = newTrack(seq, 'audio', ctx);
    ledger.other.add(track.id);
    soundTrackIds.push(track.id);
    for (const c of plan.clips) {
      const clip = programClip(ctx.newId('clp'), c.assetId, c.start, c.duration, c.sourceIn, g.id, s.id);
      if (c.fadeIn) clip.fadeIn = c.fadeIn;
      if (c.fadeOut) clip.fadeOut = c.fadeOut;
      track.clips.push(clip);
      created.push(clip.id);
      ledger.created(seq.id, track.id, clip.id);
    }
    sortTrack(track);
    soundChunks += plan.chunks;
    maxSoundErrorSeconds = Math.max(maxSoundErrorSeconds, plan.maxErrorSeconds);
  }
  const affected = ledger.guard(d);
  const output: PlaceMulticamOutput = {
    sequenceId: seq.id, videoTrackId: video.id, soundTrackIds, createdClipIds: created, filled,
    uncovered: pic.uncovered.map((u) => ({ start: timeJson(u.start), end: timeJson(u.end) })), soundChunks, maxSoundErrorSeconds, warnings: warningsOf(rep),
  };
  return { affectedIds: affected, summary: MULTICAM_SUMMARIES.placed(g.name, pic.segments.length), output: output as unknown as Record<string, unknown> };
}

// ---------- switch_angles ----------
/** The program track of a group: the given one, else the one video track that holds its segments. */
function programTrack(d: ProjectDocument, g: MulticamGroup, sequenceId: string | undefined, trackId: string | undefined): { seq: Sequence; track: Track } {
  const seqs = sequenceId !== undefined ? [mustSequence(d, sequenceId)] : Object.values(d.sequences);
  if (trackId !== undefined) {
    for (const seq of seqs) { const t = seq.tracks.find((x) => x.id === trackId); if (t) { if (t.kind !== 'video') throw multicamRefusal('trackKind', { trackId }, trackId, 'video'); return { seq, track: t }; } }
    throw new OpError('not_found', `track ${trackId} not found`, { trackId });
  }
  const found = seqs.flatMap((seq) => seq.tracks.filter((t) => t.kind === 'video' && t.clips.some((c) => c.type === 'media' && c.multicam?.groupId === g.id)).map((track) => ({ seq, track })));
  if (!found.length) throw multicamRefusal('noProgram', { groupId: g.id });
  if (found.length > 1) throw multicamRefusal('ambiguousTrack', { groupId: g.id, trackIds: found.map((x) => x.track.id) }, found.length);
  return found[0]!;
}
/** Two neighbours that are one stretch of one file shown the same way, which healing makes one segment again. */
function healable(d: ProjectDocument, prev: Clip, cur: Clip, driftStarts: Set<string>): boolean {
  if (prev.type !== 'media' || cur.type !== 'media' || !prev.multicam || !cur.multicam || driftStarts.has(cur.id)) return false;
  if (prev.multicam.groupId !== cur.multicam.groupId || prev.multicam.angleId !== cur.multicam.angleId || prev.assetId !== cur.assetId) return false;
  if (!T.eq(clipEnd(prev), cur.start) || cur.transition || prev.fadeOut || cur.fadeIn || prev.linkGroupId || cur.linkGroupId) return false;
  for (const c of [prev, cur]) if (c.reverse || c.freeze || c.speedEnd || c.keyframes || c.volume || c.audioFx || c.effects?.some((e) => e.keyframes && Object.keys(e.keyframes).length)) return false;
  const sp = speedOf(prev), sc = speedOf(cur);
  if (sp.num * sc.den !== sc.num * sp.den || prev.gain !== cur.gain || !T.eq(cur.sourceIn, sourceEnd(prev))) return false;
  const key = (c: MediaClip) => canonical({ t: c.transform, e: (c.effects ?? []).map(({ id: _id, ...rest }) => rest), m: c.mask ?? null, b: c.blend ?? null, f: c.follow ?? null, r: c.redact ?? null, k: c.keepPitch ?? null,
    v: Object.values(d.variants ?? {}).map((v) => own(v.overrides, c.id) ?? null) });
  return key(prev) === key(cur);
}
function switchAngles(d: ProjectDocument, a: z.infer<typeof MulticamOpArgs.switch_angles>, ctx: OpContext): OpResult {
  const g = mustGroup(d, a.groupId);
  for (const p of [...a.cuts, ...(a.until ? [a.until] : [])]) if ((p.at === undefined) === (p.groupTime === undefined)) throw multicamRefusal('pointForm', {});
  const targets = new Map<string, MulticamAngle>();
  for (const c of a.cuts) {
    const an = mustAngle(g, c.angleId);
    if (an.kind !== 'picture') throw refuse.soundAngleProgram(an.label, an.id);
    if (!anglePlaced(an)) throw multicamRefusal('notSynced', { groupId: g.id, angleId: an.id, why: 'not_synced' }, an.label);
    targets.set(an.id, an);
  }
  const { seq, track } = programTrack(d, g, a.sequenceId, a.trackId);
  if (track.locked) throw lockedTrack(track);
  const rate = d.settings.frameRate, fl = T.frameTime(1, rate), frame = frac(fl), grid = groupGrid(d, g);
  const tol = driftTolerance(d, a.driftToleranceFrames ?? DEFAULT_DRIFT_TOLERANCE_FRAMES);
  const coverage = a.coverage ?? 'refuse';
  const skipped: SwitchAnglesOutput['skipped'] = [];
  // resolve the cuts on the program as it is now (group-time cuts land right after any edit), sort, the last on a frame wins
  const locate = programLocator(d, seq.id, track.id, g.id);
  const resolve = (p: { at?: T.RationalTime; groupTime?: T.RationalTime }): T.RationalTime | null => {
    if (p.at) { assertAligned(d, p.at, 'at'); return p.at; }
    const t = locate(p.groupTime!);
    if (!t) skipped.push({ at: timeJson(p.groupTime!), reason: 'group_time_not_on_track' });
    return t;
  };
  const resolved = a.cuts.flatMap((c, i) => { const at = resolve(c); return at ? [{ at, angleId: c.angleId, i }] : []; }).sort((x, y) => T.cmp(x.at, y.at) || x.i - y.i);
  const cuts = resolved.filter((c, i) => { const next = resolved[i + 1]; if (next && T.eq(next.at, c.at)) { skipped.push({ at: timeJson(c.at), reason: 'same_frame' }); return false; } return true; });
  const ofGroup = (c: Clip | undefined) => !!c && c.type === 'media' && c.multicam?.groupId === g.id;
  const clipAt = (t: T.RationalTime) => { // binary search: the clip covering t, else the first starting after t
    const cl = track.clips;
    let lo = 0, hi = cl.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (T.lte(clipEnd(cl[mid]!), t)) lo = mid + 1; else hi = mid; }
    return lo;
  };
  let until: T.RationalTime | null = null;
  if (cuts.length) {
    if (a.until) until = resolve(a.until);
    if (!until) {
      const last = cuts.at(-1)!.at, cl = track.clips;
      let i = clipAt(last);
      if (i < cl.length && T.lte(cl[i]!.start, last) && ofGroup(cl[i])) { while (i + 1 < cl.length && T.eq(cl[i + 1]!.start, clipEnd(cl[i]!)) && ofGroup(cl[i + 1])) i++; until = clipEnd(cl[i]!); }
      else until = last;
    }
  }
  const ledger = new Ledger();
  ledger.variants(d);
  const rep = newReport();
  const switched = new Set<string>(), driftStarts = new Set<string>();
  const linkCount = new Map<string, number>();
  for (const s of Object.values(d.sequences)) for (const t of s.tracks) for (const c of t.clips) if (c.type === 'media' && c.linkGroupId) linkCount.set(c.linkGroupId, (linkCount.get(c.linkGroupId) ?? 0) + 1);
  const switchSegment = (m: MediaClip, pa: MulticamPiece, B: MulticamAngle) => {
    const N = T.frameIndexAt(m.duration, rate), freeze = isFreeze(m);
    const span = freeze ? { n: 0n, d: 1n } : frac(toSourceSpan(m, fl)), sA = frac(m.sourceIn);
    const gAt = (k: number): Frac => toGroupExact(pa, fracAdd(sA, fracMul({ n: BigInt(k), d: 1n }, span)));
    const plan = coverParts(d, B, { gAt, frames: N, span, frame, drift: !freeze && speedValue(m) === 1 ? { tolerance: tol, mode: 'picture' } : null, grid });
    if (plan.uncovered.length && coverage === 'refuse') {
      const u = plan.uncovered[0]!, cov = coverageOf(d, g, [B]);
      const gFrom = quantise(gAt(u.k0), grid), gTo = quantise(gAt(u.k1), grid);
      throw multicamRefusal('notCovering', { groupId: g.id, angleId: B.id, clipId: m.id, from: timeJson(gFrom), to: timeJson(gTo), coveredFrom: cov ? timeJson(cov.start) : null, coveredTo: cov ? timeJson(cov.end) : null }, B.label, fracSeconds(gAt(u.k0)), fracSeconds(gAt(u.k1)));
    }
    if (!plan.parts.length) { skipped.push({ clipId: m.id, at: timeJson(m.start), reason: 'not_covered' }); return; }
    const cuts = [...new Set([...plan.parts.flatMap((p) => [p.k0, p.k1]), ...plan.uncovered.flatMap((u) => [u.k0, u.k1])])].filter((k) => k > 0 && k < N).sort((x, y) => x - y);
    const at = new Map<number, MediaClip>([[0, m]]);
    let cur = m;
    for (const k of cuts) { cur = splitAt(d, seq.id, track, cur, T.add(m.start, T.frameTime(k, rate)), ctx, ledger); at.set(k, cur); }
    for (const p of plan.parts) {
      const clip = at.get(p.k0)!, piece = B.pieces[p.pieceIndex]!;
      ledger.clip(seq.id, track.id, clip);
      clip.assetId = piece.assetId;
      clip.sourceIn = p.sourceIn;
      clip.multicam = { groupId: g.id, angleId: B.id };
      applyLook(d, clip, B, piece, ctx, rep);
      switched.add(clip.id);
      if (p.after === 'drift') driftStarts.add(clip.id);
    }
    for (const u of plan.uncovered) { const clip = at.get(u.k0)!; skipped.push({ clipId: clip.id, at: timeJson(clip.start), reason: 'not_covered' }); }
  };
  cuts.forEach((cut, ci) => {
    const s = cut.at, e = ci + 1 < cuts.length ? cuts[ci + 1]!.at : until!;
    if (!T.lt(s, e)) return;
    const B = targets.get(cut.angleId)!;
    let cursor = s;
    while (T.lt(cursor, e)) {
      const i = clipAt(cursor), c = track.clips[i];
      if (!c || !T.lt(c.start, e)) { skipped.push({ at: timeJson(cursor), reason: 'gap' }); break; }
      if (T.lt(cursor, c.start)) skipped.push({ at: timeJson(cursor), reason: 'gap' });
      const next = T.min(clipEnd(c), e);
      const seg = segmentOf(d, seq.id, track, c);
      const skip = (reason: SwitchAnglesOutput['skipped'][number]['reason']) => skipped.push({ clipId: c.id, reason });
      if (c.type !== 'media' || !c.multicam) skip('not_tagged');
      else if (c.multicam.groupId !== g.id) skip('other_group');
      else if (!seg) skip('not_tagged');
      else if (isReverse(c)) skip('reversed');
      else if (isRamped(c)) skip('ramped');
      else if (c.linkGroupId && (linkCount.get(c.linkGroupId) ?? 0) > 1) skip('linked');
      else if (seg.angle.id === B.id) skip('already_on_angle');
      else if (!isPlaced(seg.angle.pieces[seg.pieceIndex]!)) skip('not_covered');
      else {
        let mid = c;
        if (T.lt(c.start, s)) mid = splitAt(d, seq.id, track, c, s, ctx, ledger);
        if (T.lt(e, clipEnd(mid))) splitAt(d, seq.id, track, mid, e, ctx, ledger);
        switchSegment(mid, seg.angle.pieces[seg.pieceIndex]!, B);
      }
      cursor = next;
    }
  });
  // heal: neighbours that are one stretch of one file shown the same way become one segment (never across a drift through-edit)
  const touched = ledger.touched(), healed: string[] = [], into = new Map<string, string>();
  for (let i = 1; i < track.clips.length;) {
    const prev = track.clips[i - 1]!, cur = track.clips[i]!;
    if ((a.heal ?? true) && (touched.has(prev.id) || touched.has(cur.id)) && healable(d, prev, cur, driftStarts)) {
      ledger.clip(seq.id, track.id, prev);
      prev.duration = T.add(prev.duration, cur.duration);
      track.clips.splice(i, 1);
      for (const v of Object.values(d.variants ?? {})) if (Object.hasOwn(v.overrides, cur.id)) delete v.overrides[cur.id];
      healed.push(cur.id);
      into.set(cur.id, prev.id);
      touched.add(prev.id);
      continue;
    }
    i++;
  }
  const alive = (id: string): string | null => { let x = id; while (into.has(x)) x = into.get(x)!; return track.clips.some((c) => c.id === x) ? x : null; };
  checkHandles(d, track.clips.filter((c): c is MediaClip => c.type === 'media' && touched.has(c.id)).map((clip) => ({ track, clip })));
  const affected = ledger.guard(d);
  const lo = cuts[0]?.at, hi = until;
  const output: SwitchAnglesOutput = {
    cuts: cuts.map((c) => ({ at: timeJson(c.at), angleId: c.angleId })),
    switchedClipIds: [...new Set([...switched].map(alive).filter((x): x is string => !!x))],
    createdClipIds: lo && hi ? track.clips.filter((c) => ofGroup(c) && T.lt(c.start, hi) && T.lt(lo, clipEnd(c))).map((c) => c.id) : [],
    healedClipIds: healed, skipped, dropped: droppedOf(rep, alive), warnings: warningsOf(rep, alive),
  };
  return { affectedIds: affected, summary: MULTICAM_SUMMARIES.switched(cuts.length), output: output as unknown as Record<string, unknown> };
}

// ---------- detach_from_multicam / remove_multicam ----------
function detach(d: ProjectDocument, a: z.infer<typeof MulticamOpArgs.detach_from_multicam>): OpResult {
  const ledger = new Ledger();
  const out: string[] = [];
  for (const id of new Set(a.clipIds)) {
    const f = mustClip(d, id);
    if (f.clip.type !== 'media' || !f.clip.multicam) throw multicamRefusal('notTagged', { clipId: id }, id);
    ledger.clip(f.seq.id, f.track.id, f.clip);
    delete f.clip.multicam;
    out.push(id);
  }
  const output: DetachFromMulticamOutput = { detachedClipIds: out };
  return { affectedIds: ledger.guard(d), summary: MULTICAM_SUMMARIES.detached(out.length), output: output as unknown as Record<string, unknown> };
}
function removeMulticam(d: ProjectDocument, a: z.infer<typeof MulticamOpArgs.remove_multicam>): OpResult {
  const g = mustGroup(d, a.groupId);
  const tags = taggedClips(d, g.id);
  if (tags.length && !a.detach) throw multicamRefusal('tagsExist', { groupId: g.id, clipIds: tags.slice(0, 50).map((x) => x.clip.id) }, tags.length);
  const ledger = new Ledger();
  ledger.other.add(g.id);
  for (const { seq, track, clip } of tags) {
    if (track.locked) throw lockedTrack(track);
    ledger.clip(seq.id, track.id, clip);
    delete clip.multicam;
  }
  delete d.multicam![g.id];
  if (!Object.keys(d.multicam!).length) delete d.multicam;
  const output: RemoveMulticamOutput = { detachedClipIds: tags.map((x) => x.clip.id) };
  return { affectedIds: ledger.guard(d), summary: MULTICAM_SUMMARIES.removed(g.name), output: output as unknown as Record<string, unknown> };
}

const DESCRIPTIONS: Record<keyof typeof MulticamOpArgs, string> = {
  create_multicam: 'Group 2–9 angles (cameras or sound recorders, each one or more files) into a multicam group. Group time follows the reference angle\'s first file (by default the first sound recorder); every other file starts unsynced until it is synced by sound (the multicam sync route, sync_multicam) or by hand (set_multicam_sync). Default labels «מצלמה N» / «מיקרופון N».',
  attach_multicam_sync: 'Store measured sync maps from the server\'s sync job. Internal. A file synced by hand is kept unless overwrite is true. Program segments showing a changed file keep their group time.',
  set_multicam_sync: 'Correct one file\'s sync by hand: nudge it (rounded to a whole sample), set its offset, give its anchors, or clear it. The file then counts as synced by hand. Program segments showing it keep their group time, so the edit follows the correction. Refused on the reference angle\'s first file, which sets group time.',
  update_multicam: 'Rename a multicam group or its angles, set the wide angle, or set who speaks on which mic and which angle frames them.',
  set_angle_look: 'Make a segment\'s look (framing, grade, effects, mask, per-format framing) the look of its angle, and its privacy regions and follow those of its file; apply them to that angle\'s segments (by default only those still showing the old look). clear removes them.',
  place_multicam: 'Lay a multicam program: picture segments of one angle on a video track (stretches it does not cover filled from the other synced cameras unless fill=false, each fill reported) and continuous sound of the chosen sources (default the first sound recorder), all in sync, with clock drift corrected by invisible cuts (picture) and short consecutive sound parts (a second recorder that drifts). On new tracks, a given empty track, or a new sequence.',
  switch_angles: 'Cut a multicam program to other angles: one cut, a range or a whole list of cuts (at a timeline frame or a group time; the last cut on a frame wins), each lasting to the next cut or `until` (default: the end of the program run). Each segment is re-mapped in group time, so sync is kept after any edit; the segment takes the new angle\'s look; neighbours that become one stretch are healed. One undoable step.',
  detach_from_multicam: 'Turn multicam segments into ordinary clips (they keep their file, timing and look).',
  remove_multicam: 'Delete a multicam group. Refused while segments use it unless detach=true, which turns them into ordinary clips in the same step.',
};
const BODIES: { [K in keyof typeof MulticamOpArgs]: (d: ProjectDocument, a: z.infer<(typeof MulticamOpArgs)[K]>, ctx: OpContext) => OpResult } = {
  create_multicam: createMulticam, attach_multicam_sync: attachSync, set_multicam_sync: setSync, update_multicam: updateMulticam, set_angle_look: setAngleLook,
  place_multicam: placeMulticam, switch_angles: switchAngles, detach_from_multicam: detach, remove_multicam: removeMulticam,
};
for (const name of Object.keys(MulticamOpArgs) as (keyof typeof MulticamOpArgs)[]) {
  const body = BODIES[name] as (d: ProjectDocument, a: unknown, ctx: OpContext) => OpResult;
  defineOp({ name, version: 1, internal: name === 'attach_multicam_sync', description: DESCRIPTIONS[name], args: MulticamOpArgs[name], apply: (d, a, ctx) => body(d, a, ctx) });
}
