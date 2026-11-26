/**
 * Export checks (wave 7, track send; send-decisions C10): what the document says should be on screen, and the assembly of the
 * report. Pure (no Date, no float time): frames are compared as exact rationals.
 *
 * `drawn`: a frame where some clip draws a picture — a media clip on a visible video track, or a title on a visible text track
 * (captions are not counted: they never make a frame "not black" on purpose). A black stretch with nothing drawn is context
 * 'gap' (the fact preflight warns about), otherwise 'picture'.
 *
 * `moving` (HEURISTIC): a frame counts only for a non-freeze media clip of a VIDEO asset, on a video track that is not hidden,
 * whose source time at that frame is inside the asset's own length, and with no opaque full-frame clip above it by document
 * geometry. "Opaque full-frame" = a media clip of a video asset or an image without alpha, on a visible video track above, with
 * opacity 1, no keyframes, no mask, no blend mode, no rotation, centred, and big enough by its fit (contain/cover) and scale to
 * cover the frame. Opacity keys, effects, time effects and speed ramps are not modelled (a ramp counts as moving for its whole
 * length): the picture checks say "heuristic" and every finding shows its numbers.
 */
import * as T from '@pulseframe/time';
import type { Asset, MediaClip, ProjectDocument, Track } from './schema.ts';
import { FINDING_KINDS, type ExportChecks, type PictureChecks, type PictureExpectation, type SoundChecks } from './sendContract.ts';

export const EXPORT_CHECKS_BUILT = true;

/** a < b for exact rationals given as value/timescale (BigInt cross-multiplication). */
const big = (t: T.RationalTime) => [BigInt(t.value), BigInt(t.timescale)] as const;
/**
 * Source time of a non-ramped media clip at timeline time t is sourceIn + (t − start)·speed (forward) or, reversed,
 * sourceIn + (duration − (t − start))·speed minus nothing more (its stretch read backwards). True when that time is before the
 * asset's end, so a frame there shows a new source picture (exact: all in BigInt fractions). Exported for qcChecks.ts (wave 8 qc),
 * which compares with the PICTURE end instead (verifier C1); this function and pictureExpectation stay as they are (proof:send K rows).
 */
export function insideSource(c: MediaClip, a: Asset, t: T.RationalTime): boolean {
  if (c.speedEnd) return true; // a ramp is not modelled: counted as moving for its whole length
  const sp = c.speed ?? { num: 1, den: 1 };
  const rel = T.sub(t, c.start);
  const local = c.reverse ? T.sub(c.duration, rel) : rel; // clip-local time read from sourceIn (reverse: from the stretch's end)
  // source = sourceIn + local·num/den ; compare with asset.duration: all as one fraction
  const [ln, ld] = big(local), [sn, sd] = big(c.sourceIn), [dn, dd] = big(a.duration);
  const num = BigInt(sp.num), den = BigInt(sp.den);
  // source = sn/sd + ln·num/(ld·den) = (sn·ld·den + ln·num·sd) / (sd·ld·den)
  const srcN = sn * ld * den + ln * num * sd, srcD = sd * ld * den;
  return c.reverse ? srcN * dd <= dn * srcD : srcN * dd < dn * srcD; // reversed, `local` is one frame past the shown picture
}
const isVideoAsset = (a: Asset | undefined): a is Asset => !!a && a.kind === 'video';
/** True when this clip, by document geometry alone, hides everything under it in the whole frame. Effects and transitions are not looked at: qcChecks.ts adds C3's guard for title_hidden. */
export function coversFrame(doc: ProjectDocument, c: MediaClip): boolean {
  const a = doc.assets[c.assetId];
  if (!a) return false;
  const opaqueSource = a.kind === 'video' ? !!a.video && !a.video.hasAlpha : a.kind === 'image' ? !!a.image && !a.image.hasAlpha : false;
  if (!opaqueSource) return false;
  const tr = c.transform;
  if (tr.opacity !== 1 || tr.x !== 0 || tr.y !== 0 || tr.rotation !== 0 || c.keyframes && Object.values(c.keyframes).some((k) => k && k.length) || c.mask || c.blend || c.follow) return false;
  const v = a.video, im = a.image;
  let w = v ? v.width : im!.width, h = v ? v.height : im!.height;
  if (v && Math.abs(v.rotation) % 180 === 90) [w, h] = [h, w];
  const { width: W, height: H, fit } = doc.settings;
  // placed size before the clip's own scale: contain = min(W/w, H/h), cover = max(...); then × scale; covers when ≥ the frame
  const base = (fit ?? 'contain') === 'cover' ? Math.max(W / w, H / h) : Math.min(W / w, H / h);
  return w * base * tr.scale >= W - 1e-9 && h * base * tr.scale >= H - 1e-9;
}
const activeAt = (c: { start: T.RationalTime; duration: T.RationalTime }, t: T.RationalTime) => T.lte(c.start, t) && T.lt(t, T.add(c.start, c.duration));
/** [from, to) runs of the true frames of a flag array. */
function runsOf(flags: Uint8Array): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < flags.length; k++) if (flags[k] && (k === 0 || !flags[k - 1])) { let e = k; while (e < flags.length && flags[e]) e++; out.push([k, e]); }
  return out;
}

/** Frame intervals of the exported range [firstFrame, firstFrame + frames) (relative to firstFrame) where something is drawn and where a video plays. */
export function pictureExpectation(doc: ProjectDocument, sequenceId: string, firstFrame: number, frames: number): PictureExpectation {
  const seq = doc.sequences[sequenceId];
  if (!seq) throw new Error(`pictureExpectation: unknown sequence ${sequenceId}`);
  const rate = doc.settings.frameRate;
  const drawn = new Uint8Array(Math.max(0, frames)), moving = new Uint8Array(Math.max(0, frames));
  const visible: { track: Track; index: number }[] = seq.tracks.map((track, index) => ({ track, index })).filter((x) => !x.track.hidden && (x.track.kind === 'video' || x.track.kind === 'text'));
  const from = T.frameTime(firstFrame, rate), to = T.frameTime(firstFrame + Math.max(0, frames), rate);
  // only clips that overlap the range matter
  const clips = visible.flatMap(({ track, index }) => track.clips.filter((c) => (c.type === 'media' || c.type === 'text' || c.type === 'drawn') && T.lt(c.start, to) && T.lt(from, T.add(c.start, c.duration))).map((c) => ({ c, track, index })));
  for (let k = 0; k < frames; k++) {
    const t = T.frameTime(firstFrame + k, rate);
    const here = clips.filter((x) => activeAt(x.c, t));
    if (here.length) drawn[k] = 1;
    // the highest covering clip hides every track under it (later tracks draw over earlier ones)
    let coverAt = -1;
    for (const x of here) if (x.track.kind === 'video' && x.c.type === 'media' && x.index > coverAt && coversFrame(doc, x.c)) coverAt = x.index;
    for (const x of here) {
      if (x.track.kind !== 'video' || x.c.type !== 'media' || x.c.freeze || x.index < coverAt) continue;
      const a = doc.assets[x.c.assetId];
      if (isVideoAsset(a) && insideSource(x.c, a, t)) { moving[k] = 1; break; }
    }
  }
  return { drawn: runsOf(drawn), moving: runsOf(moving) };
}
/** Per-frame flags of a list of [from, to) runs (the server's form for PictureCheck.push). */
export function flagsOf(runs: readonly [number, number][], frames: number): Uint8Array {
  const f = new Uint8Array(Math.max(0, frames));
  for (const [a, b] of runs) f.fill(1, Math.max(0, a), Math.min(frames, b));
  return f;
}

/**
 * The report of one export: picture (route) + sound (mix), each with its method and whether it was measured. The quiet state
 * lists what was looked for; nothing here ever says the file is fine. Findings are ordered by start time, then kind.
 */
export function assembleChecks(picture: PictureChecks, sound: SoundChecks): ExportChecks {
  const order = (xs: PictureChecks['findings']) => [...xs].sort((a, b) => T.cmp(a.from, b.from) || FINDING_KINDS.indexOf(a.kind) - FINDING_KINDS.indexOf(b.kind));
  return { picture: { ...picture, findings: order(picture.findings) }, sound: { ...sound, findings: order(sound.findings) }, lookedFor: FINDING_KINDS };
}
