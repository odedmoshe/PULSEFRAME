/**
 * Creative preflight (SPEC §19.14): look at one output (the master or a linked format) before export and list what would
 * go wrong or look wrong, each issue tied to the objects involved and, where a mechanical fix exists, the ops that apply it.
 * Blockers stop an export; warnings and notes do not. Read-only. Text extents are ESTIMATES (the server does not shape text).
 */
import * as T from '@pulseframe/time';
import { BACKDROP, BACKDROP_MIN_BLUR, MULTICAM_PREFLIGHT_CODE, own, multicamGroupOf, segmentSyncOffset, outputSafeArea, previousAdjacent, sequenceDuration, sequenceOf, velocityLimit, velocityNeeds, type Clip, type FollowStateName, type MediaClip, type OpCall, type ProjectDocument, type ResolvedRegion, type Track, type Transition } from '@pulseframe/core';
import { audioPlan, captionCues, decodeOverBudget, evaluate, type DecodeStretch, type Layer } from '@pulseframe/engine';
import type { Exporter } from './export.ts';
import { LIBRARY_EXPORT_NOTES, outputDoc } from './export.ts';
import { fieldIssues, fieldTextExtent, isFieldIssueCode } from './preflight.fields.ts';

export interface PreflightIssue {
  code: string;
  severity: 'blocker' | 'warning' | 'note';
  message: string;
  ids: string[];
  range?: { startFrame: number; endFrame: number };
  /** A mechanical fix the caller may apply as one transaction (or propose). Absent when the fix needs judgement. */
  fix?: { label: string; ops: OpCall[] };
}
/** variantId: a linked format; sequenceId: a sequence of the project (a short, ADR-0018), default the main edit. Both: the format over the sequence. */
export interface PreflightOptions { variantId?: string; sequenceId?: string; maxCharsPerSecond?: number }
/** Video decoders the render worker and browser export open at most (apps/web render.ts, browserExport.ts). */
const RENDER_DECODERS = 12;

/**
 * Item 4 (ADR-0012). set_transition and set_transition_options check the source a transition reads, but a later trim, slip
 * or speed change of either clip is not refused for it: validateProject gates every transaction, and a plain transition's
 * handle has always been a warning here, not a refusal. The evaluator then clamps to the last or the first source frame,
 * so the picture freezes. Two issues, at most one per transition:
 * - transition_freeze: the previous clip has fewer spare frames after its end than the transition's `frames`. The fix
 *   shortens it to those frames, keeping each option that still fits at that length (a velocity ramp reads more than
 *   `frames`, so it is dropped; a beat lock needs 3 frames), or removes it when none are left.
 * - velocity_source: `frames` fit, but the velocity ramp reads more (velocityNeeds) after the previous clip, before the
 *   clip's start, or both. The fix lowers the ramp to the largest the source allows (velocityLimit) or removes it.
 * Each fix is ops that the same check (ops.ts checkTransition) accepts; preflight.transitions.test.ts applies them.
 */
function transitionSourceIssue(doc: ProjectDocument, track: Track, c: MediaClip): PreflightIssue | null {
  const tr = c.transition!, n = tr.frames, v = tr.velocity;
  const { maxVelocity, haveOutFrames: haveOut, haveHeadFrames: haveHead } = velocityLimit(doc, c.id); // null: that side never runs out
  const need = v ? velocityNeeds(n, v) : { outFrames: n, headFrames: 0 };
  const shortOut = haveOut !== null && haveOut < need.outFrames;
  const shortHead = !!v && haveHead !== null && haveHead < need.headFrames;
  if (!shortOut && !shortHead) return null;
  const prev = previousAdjacent(track, c);
  if (haveOut !== null && haveOut < n) {
    const ramp = v ? ` (${need.outFrames} with its ×${v} velocity ramp)` : '';
    return {
      code: 'transition_freeze', severity: 'warning',
      message: `the ${tr.type} transition needs ${n} spare source frames after the previous clip${ramp} but only ${Math.max(0, haveOut)} exist; the outgoing picture will freeze`,
      ids: [c.id, prev!.id],
      fix: haveOut > 0 ? shortenTransition(c.id, tr, haveOut, haveOut, haveHead) : { label: 'Remove the transition', ops: [{ op: 'set_transition', args: { clipId: c.id, type: null } }] },
    };
  }
  const sides = [
    ...(shortOut ? [`${need.outFrames} spare source frames after the previous clip (${Math.max(0, haveOut!)} exist)`] : []),
    ...(shortHead ? [`${need.headFrames} source frames before the clip's start (${Math.max(0, haveHead!)} exist)`] : []),
  ];
  return {
    code: 'velocity_source', severity: 'warning',
    message: `the ${tr.type} transition's ×${v} velocity ramp needs ${sides.join(' and ')}; the ${shortOut && shortHead ? 'outgoing and incoming pictures' : shortOut ? 'outgoing picture' : 'incoming picture'} will freeze`,
    ids: [c.id, ...(shortOut && prev ? [prev.id] : [])],
    fix: maxVelocity > 1
      ? { label: `Lower the velocity ramp to ×${maxVelocity}`, ops: [{ op: 'set_transition_options', args: { clipId: c.id, velocity: maxVelocity } }] }
      : { label: 'Remove the velocity ramp', ops: [{ op: 'set_transition_options', args: { clipId: c.id, velocity: null } }] },
  };
}
const VELOCITIES = [4, 3, 2] as const;
/** The fix that shortens a transition to m frames (m <= haveOut), keeping each option that still fits at that length. */
function shortenTransition(clipId: string, tr: Transition, m: number, haveOut: number, haveHead: number | null): NonNullable<PreflightIssue['fix']> {
  const fits = (vv: number) => { const nd = velocityNeeds(m, vv); return nd.outFrames <= haveOut && (haveHead === null || nd.headFrames <= haveHead); };
  const velocity = tr.velocity ? VELOCITIES.find((vv) => vv <= tr.velocity! && fits(vv)) : undefined;
  const sync = tr.sync && m >= 3 ? tr.sync : undefined;
  const dropped = [...(tr.velocity && velocity !== tr.velocity ? [velocity ? `at velocity ×${velocity}` : 'without its velocity ramp'] : []), ...(tr.sync && !sync ? ['without the beat lock'] : [])];
  const label = `Shorten the transition to ${m} frames${dropped.length ? `, ${dropped.join(' and ')}` : ''}`;
  if (!dropped.length) return { label, ops: [{ op: 'set_transition', args: { clipId, type: tr.type, frames: m } }] };
  // set_transition keeps the beat lock and the ramp, so on its own it is refused when one of them no longer fits: the
  // transition is removed, put back at the new length, and given again the options that fit (one transaction, one undo)
  const options = { ...(sync ? { sync } : {}), ...(velocity ? { velocity } : {}), ...(tr.color !== undefined ? { color: tr.color } : {}), ...(tr.seed !== undefined ? { seed: tr.seed } : {}) };
  return {
    label,
    ops: [
      { op: 'set_transition', args: { clipId, type: null } },
      { op: 'set_transition', args: { clipId, type: tr.type, frames: m } },
      ...(Object.keys(options).length ? [{ op: 'set_transition_options', args: { clipId, ...options } }] : []),
    ],
  };
}

export function preflight(exporter: Exporter, master: ProjectDocument, revision: number, opts: PreflightOptions = {}) {
  const issues: PreflightIssue[] = [];
  const target = { sequenceId: opts.sequenceId, variantId: opts.variantId };
  const doc = outputDoc(master, target);
  const variant = opts.variantId ? own(master.variants, opts.variantId)! : null; // outputDoc above refused an id that names no format
  // The safe-area guides of this output (ADR-0018): the variant's, else the short's own format's. A short's own fixes edit the
  // short itself (its clip's transform, its caption track); a variant's stay per format (set_variant_override).
  const short = !variant && opts.sequenceId !== undefined && opts.sequenceId !== master.mainSequenceId ? sequenceOf(master, opts.sequenceId) ?? null : null;
  const guide = variant ? { id: variant.id, name: variant.name, safeArea: variant.safeArea } : short ? { id: short.id, name: short.name, safeArea: outputSafeArea(master, target) } : null;
  const { width: W, height: H, frameRate: rate } = doc.settings;
  const seq = doc.sequences[doc.mainSequenceId]!;
  const total = T.frameCount(sequenceDuration(doc), rate);
  const fi = (t: T.RationalTime) => T.frameIndexAt(t, rate);

  // 1. what would stop the render
  const plan = exporter.plan(master, revision, { ...(opts.variantId ? { variantId: opts.variantId } : {}), ...(opts.sequenceId !== undefined ? { sequenceId: opts.sequenceId } : {}) });
  // the life line's issues (ADR-0021) are listed once, below, with their frame ranges; the plan carries them without
  for (const b of plan.blockers) if (!isFieldIssueCode(b.code)) issues.push({ code: b.code, severity: 'blocker', message: b.message, ids: b.ids });
  // A sound-effect tail cut at the end of the video is how effects are designed to behave (ADR-0010), so it is a note here.
  // Library content (wave 7): the credits for the description and stock footage with people are notes; a credit the licence wants in
  // the video and no visible title shows is a warning whose fix is the credits card of this output's sequence.
  for (const w of plan.warnings) if (!isFieldIssueCode(w.code)) issues.push({ code: w.code, severity: w.code === 'audio_tail_cut' || LIBRARY_EXPORT_NOTES.has(w.code) ? 'note' : 'warning', message: w.message, ids: w.ids,
    ...(w.code === 'credit_not_on_screen' ? { fix: { label: 'Add a credits card at the end', ops: [{ op: 'add_credits_card', args: opts.sequenceId !== undefined ? { sequenceId: opts.sequenceId } : {} }] } } : {}) });

  // 2. stretches with no picture at all (the background colour would show)
  const covered = seq.tracks.filter((t) => (t.kind === 'video' || t.kind === 'text') && !t.hidden).flatMap((t) => t.clips.map((c) => [fi(c.start), fi(T.add(c.start, c.duration))] as [number, number])).sort((a, b) => a[0] - b[0]);
  let cursor = 0;
  const gap = (a: number, b: number) => issues.push({ code: 'empty_picture', severity: 'warning', message: `nothing is on screen for ${b - a} frame(s) starting at frame ${a}; only the background colour shows`, ids: [], range: { startFrame: a, endFrame: b }, fix: { label: 'Remove this stretch from every track', ops: [{ op: 'cut_range', args: { start: T.frameTime(a, rate), end: T.frameTime(b, rate) } }] } });
  for (const [a, b] of covered) { if (a > cursor) gap(cursor, a); cursor = Math.max(cursor, b); }
  if (cursor < total) gap(cursor, total);

  // 3. sound
  const ap = audioPlan(doc);
  if (total > 0 && ap.clips.length === 0) issues.push({ code: 'no_sound', severity: 'note', message: 'the programme has no audible sound', ids: [] });
  else if (!doc.settings.loudness && ap.clips.length > 0) issues.push({ code: 'no_loudness_target', severity: 'note', message: 'no loudness target is set, so the export keeps the mix level as it is', ids: [doc.id], fix: { label: 'Normalise to -14 LUFS (common for social video)', ops: [{ op: 'set_loudness_target', args: { target: -14 } }] } });

  // 4a. frames that need more video pictures decoded at once than the renderer opens decoders for (time effects decode each
  // earlier picture separately, ADR-0011). Counted exactly as the compositor asks for pictures (a source frame that several
  // layers or taps of a frame show is decoded once), so these frames, and only these, would refuse with effect_unavailable
  // (decode_budget). Stretches less than a second apart make one issue, so a count that wavers around the budget (slow
  // motion) is not listed frame by frame.
  const near = Math.max(1, Math.round(rate.num / rate.den));
  const groups: DecodeStretch[][] = [];
  for (const s of decodeOverBudget(doc, RENDER_DECODERS)) {
    const g = groups.at(-1);
    if (g && s.fromFrame - g.at(-1)!.toFrame < near) g.push(s); else groups.push([s]);
  }
  for (const g of groups) {
    const from = g[0]!.fromFrame, to = g.at(-1)!.toFrame;
    const refused = g.reduce((k, s) => k + s.toFrame - s.fromFrame, 0);
    const frames = to - from === 1 ? `frame ${from}` : `frames ${from}–${to - 1}`;
    const where = refused === to - from ? frames : `${refused} of the ${frames}`;
    issues.push({ code: 'decode_budget', severity: 'warning', message: `on ${where}, more video pictures must be decoded at once than the ${RENDER_DECODERS} the renderer can open (up to ${Math.max(...g.map((s) => s.peak))}); those frames would be refused. Time effects such as echo and time split decode each earlier picture separately (a picture shown more than once in a frame is decoded once). Lower the count of a time effect, remove one, or move the overlapping clips apart`, ids: [...new Set(g.flatMap((s) => s.clipIds))], range: { startFrame: from, endFrame: to } });
  }

  for (const track of seq.tracks) {
    for (const c of track.clips) {
      if (c.type === 'media' && track.kind === 'video' && !track.hidden) {
        const asset = doc.assets[c.assetId];
        // 4. a transition whose source has run out: the outgoing picture (the previous clip's spare frames after its end) or,
        // with a velocity ramp, the incoming one (the clip's frames before its start) would freeze
        if (c.transition) { const issue = transitionSourceIssue(doc, track, c); if (issue) issues.push(issue); }
        // 5. pictures enlarged well beyond their own pixels look soft
        const dims = asset?.video ?? asset?.image;
        // a blurred backdrop (shorts, ADR-0018: a picture-only copy under the contained foreground) is meant to be soft
        const backdrop = (c.effects ?? []).some((e) => e.enabled && e.type === BACKDROP.effect && typeof e.params.radius === 'number' && e.params.radius >= BACKDROP_MIN_BLUR);
        if (dims && !backdrop) {
          const fit = (doc.settings.fit === 'cover' ? Math.max : Math.min)(W / dims.width, H / dims.height);
          const enlarge = fit * c.transform.scale;
          if (enlarge > 1.5) issues.push({ code: 'upscaled', severity: 'warning', message: `"${asset!.name}" (${dims.width}×${dims.height}) is shown ${enlarge.toFixed(2)}× larger than its own pixels in this ${W}×${H} output and will look soft`, ids: [c.id, c.assetId] });
        }
      }
      // 6. titles against the safe area (estimated extent)
      if (c.type === 'text' && guide?.safeArea && !track.hidden) {
        const sa = guide.safeArea;
        const lines = (c.fields ? fieldTextExtent(doc, seq.id, c) : c.text).split('\n'); // a title with live fields: the longest text it resolves to (ADR-0021)
        const hFrac = lines.length * c.style.sizeFrac * c.style.lineHeight * c.transform.scale;
        const wFrac = Math.min(0.9, Math.max(...lines.map((l) => l.length)) * c.style.sizeFrac * 0.55 * (H / W)) * c.transform.scale;
        const cx = 0.5 + c.transform.x, cy = 0.5 + c.transform.y;
        const e = 1e-3; // rounding slack, so a title placed by the fix is not flagged again
        const out = { top: cy - hFrac / 2 < sa.top - e, bottom: cy + hFrac / 2 > 1 - sa.bottom + e, left: cx - wFrac / 2 < sa.left - e, right: cx + wFrac / 2 > 1 - sa.right + e };
        if (out.top || out.bottom || out.left || out.right) {
          // If the title is larger than the safe rectangle, moving cannot fix it: shrink it for this format first, then place it.
          const availW = 1 - sa.left - sa.right, availH = 1 - sa.top - sa.bottom;
          const k = Math.min(1, (availW / wFrac) * 0.98, (availH / hFrac) * 0.98);
          const w2 = wFrac * k, h2 = hFrac * k;
          const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
          const nx = clamp(cx, sa.left + w2 / 2, 1 - sa.right - w2 / 2) - 0.5, ny = clamp(cy, sa.top + h2 / 2, 1 - sa.bottom - h2 / 2) - 0.5;
          const transform = { x: Number(nx.toFixed(4)), y: Number(ny.toFixed(4)), ...(k < 1 ? { scale: Number((c.transform.scale * k).toFixed(4)) } : {}) };
          issues.push({ code: 'outside_safe_area', severity: 'warning', message: `the title "${c.text.slice(0, 30)}" probably reaches outside the safe area of ${guide.name} (${Object.entries(out).filter(([, v]) => v).map(([k2]) => k2).join(', ')}); app interface elements may cover it. The extent is an estimate`, ids: [c.id, guide.id],
            fix: variant
              ? { label: k < 1 ? 'Shrink and move it inside the safe area in this format only' : 'Move it inside the safe area in this format only', ops: [{ op: 'set_variant_override', args: { variantId: variant.id, clipId: c.id, transform } }] }
              : { label: k < 1 ? 'Shrink and move it inside the safe area of this short' : 'Move it inside the safe area of this short', ops: [{ op: 'set_clip_transform', args: { clipId: c.id, transform } }] } });
        }
      }
    }
    if (track.kind === 'caption' && track.caption && !track.hidden) {
      // 7. captions against the safe area and reading speed
      const st = track.caption.style;
      if (guide?.safeArea && st.position !== 'center') {
        const need = st.position === 'bottom' ? guide.safeArea.bottom : guide.safeArea.top;
        const style = { marginFrac: Number(Math.min(0.45, need + 0.02).toFixed(3)) };
        if (st.marginFrac < need) issues.push({ code: 'captions_outside_safe_area', severity: 'warning', message: `captions sit ${(st.marginFrac * 100).toFixed(0)}% from the ${st.position} edge, inside the ${(need * 100).toFixed(0)}% zone that ${guide.name} marks as likely covered. ${variant ? 'Caption style is shared by all formats' : 'The caption track belongs to this short'}`, ids: [track.id, guide.id],
          fix: variant
            ? { label: 'Raise the caption margin (all formats)', ops: [{ op: 'set_caption_style', args: { ...(opts.sequenceId !== undefined ? { sequenceId: opts.sequenceId } : {}), trackId: track.id, style } }] }
            : { label: 'Raise the caption margin of this short', ops: [{ op: 'set_caption_style', args: { sequenceId: short!.id, trackId: track.id, style } }] } });
      }
      const limit = opts.maxCharsPerSecond ?? 20;
      const fast = captionCues(doc, seq, track).filter((q) => q.text.replace(/\s+/g, '').length / Math.max(0.001, T.toSeconds(T.sub(q.end, q.start))) > limit);
      if (fast.length) issues.push({ code: 'captions_too_fast', severity: 'warning', message: `${fast.length} caption(s) exceed ${limit} characters per second and may be hard to read (first: "${fast[0]!.text.slice(0, 30)}"). The limit is a setting, not a universal rule`, ids: [track.id], range: { startFrame: fi(fast[0]!.start), endFrame: fi(fast[0]!.end) } });
    }
  }
  // 8. motion tracking (ADR-0015): followers whose track is not reliable there or whose target picture is not there, and
  // privacy regions whose tracking is lost or uncertain. Warnings only: the owner decides (SPEC: privacy warnings never block).
  issues.push(...trackingIssues(doc, rate));
  // 9. life line (ADR-0021): a title field without data or with an undecided sunset answer (blockers: the film would lack words the
  // author placed), a date taken from a file-name estimate (note), a capture-sourced date stamp that draws nothing (warning)
  issues.push(...fieldIssues(doc));
  // 10. multicam (ADR-0020): a program segment out of step with the master sound by more than half a frame (warning; fix: slip)
  issues.push(...multicamIssues(master, opts.sequenceId ?? master.mainSequenceId));
  // 11. stabilisation (wave 7): frames of a stabilised clip whose source frames were not measured, and frames where the cover
  // limit weakens the correction (warnings; the fix recalculates the crop)
  issues.push(...stabiliseIssues(doc, rate));

  const count = (s: PreflightIssue['severity']) => issues.filter((i) => i.severity === s).length;
  return {
    revision, variantId: opts.variantId ?? null, sequenceId: opts.sequenceId ?? null, output: { width: W, height: H, frames: total, fit: doc.settings.fit ?? 'contain', safeArea: guide?.safeArea ?? null },
    ok: count('blocker') === 0, blockers: count('blocker'), warnings: count('warning'), notes: count('note'), issues,
    scope: 'Checked: render blockers, empty picture, loudness setup, sound-effect tails cut at the end of the video, video decoders needed at once, transition handles (velocity ramps included), upscaling, safe areas (estimated text extents), caption reading speed, title fields without data and capture-sourced date stamps without a date, motion tracking (clips that follow a track or blur along it, on frames where the tracking is lost or uncertain or the followed picture is absent), multicam segments out of step with the master sound by more than half a frame, stabilised clips (frames whose camera motion was not measured, frames where the correction is weakened so no empty edge shows). Not checked: picture quality, audio clipping (use measure_loudness), how the sound effects sound (nobody has listened to them), accessibility contrast, platform rules.',
  };
}

/**
 * Multicam (ADR-0020 plan §7): every tagged picture segment of the sequence whose group time at its start or end differs from
 * the master sound's by more than half a frame (core segmentSyncOffset: positive = picture late). A warning, never a blocker;
 * the fix slips the picture alone (includeLinked false) by the whole frames that bring it back, when that is not zero.
 */
export function multicamIssues(master: ProjectDocument, sequenceId: string): PreflightIssue[] {
  if (!master.multicam) return [];
  const seq = sequenceOf(master, sequenceId);
  if (!seq) return [];
  const rate = master.settings.frameRate, fps = rate.num / rate.den;
  const out: PreflightIssue[] = [];
  for (const track of seq.tracks) {
    if (track.kind !== 'video') continue;
    for (const c of track.clips) {
      if (c.type !== 'media' || !c.multicam) continue;
      const off = segmentSyncOffset(master, c.id);
      if (!off || (Math.abs(off.startFrames) <= 0.5 && Math.abs(off.endFrames) <= 0.5)) continue;
      const worst = Math.abs(off.startSeconds) >= Math.abs(off.endSeconds) ? off.startSeconds : off.endSeconds;
      const label = multicamGroupOf(master, c.multicam.groupId)?.angles.find((a) => a.id === c.multicam!.angleId)?.label ?? c.multicam.angleId;
      const slipFrames = Math.round(T.toSeconds(off.slipBy) * fps);
      out.push({
        code: MULTICAM_PREFLIGHT_CODE, severity: 'warning',
        message: `the picture of angle "${label}" is ${Math.round(Math.abs(worst) * 1000)} ms ${worst > 0 ? 'late' : 'early'} against the master sound (${Math.abs(worst * fps).toFixed(1)} frames)`,
        ids: [c.id], range: { startFrame: T.frameIndexAt(c.start, rate), endFrame: T.frameIndexAt(T.add(c.start, c.duration), rate) },
        ...(T.isZero(off.slipBy) ? {} : { fix: { label: `Slip the picture by ${slipFrames} frame(s) to match the sound`, ops: [{ op: 'slip_clip', args: { clipId: c.id, by: off.slipBy, includeLinked: false } }] } }),
      });
    }
  }
  return out;
}

/** Stretches listed per clip and kind of problem; any more are counted in one further issue. */
const MAX_TRACK_RUNS = 20;
const LOSS_STATES: ReadonlySet<string> = new Set(['unknown', 'weak', 'lost', 'outside']);
const frames = (a: number, b: number) => (b - a === 1 ? `frame ${a}` : `frames ${a}–${b - 1}`);

/**
 * Tracking problems found by running the evaluator (the same one preview and export use) over every frame of each clip that
 * follows a motion track or carries a tracked privacy region, so speed, reverse, trims, time effects and transitions are
 * mapped exactly as they render. Only the tracks those clips and their targets sit on are evaluated. A layer's follow state
 * and a region's state are the evaluator's (FollowInfo, ResolvedRegion); a region is a problem where it is drawn as the
 * whole-picture fallback or its state is weak, lost, unknown or outside the track.
 */
export function trackingIssues(doc: ProjectDocument, rate: { num: number; den: number }): PreflightIssue[] {
  const seq = doc.sequences[doc.mainSequenceId]!;
  const fi = (t: T.RationalTime) => T.frameIndexAt(t, rate);
  const bound = new Map<string, { clip: Clip; trackId: string }>();
  const keep = new Set<string>();
  for (const track of seq.tracks)
    for (const c of track.clips) {
      const follow = c.type !== 'caption' ? c.follow : undefined;
      const redacts = c.type === 'media' && !!c.redact?.some((r) => r.motionTrackId !== null);
      if (!follow && !redacts) continue;
      bound.set(c.id, { clip: c, trackId: track.id });
      keep.add(track.id);
      if (follow) keep.add(follow.targetTrackId);
    }
  if (!bound.size) return [];
  const only = { ...doc, sequences: { ...doc.sequences, [doc.mainSequenceId]: { ...seq, tracks: seq.tracks.filter((t) => keep.has(t.id)) } } };
  // the frames to look at: the union of the bound clips' spans, in order
  const spans = [...bound.values()].map(({ clip }) => [fi(clip.start), fi(T.add(clip.start, clip.duration))] as [number, number]).sort((a, b) => a[0] - b[0]);
  type Kind = 'follow_track_loss' | 'follow_target_missing' | 'redact_track_loss';
  const runs = new Map<string, { kind: Kind; clipId: string; ids: Set<string>; states: Set<string>; whole: boolean; ranges: [number, number][] }>();
  const mark = (kind: Kind, clipId: string, f: number, state: string, ids: string[], whole = false) => {
    const key = `${kind}|${clipId}`;
    let r = runs.get(key);
    if (!r) runs.set(key, (r = { kind, clipId, ids: new Set(), states: new Set(), whole: false, ranges: [] }));
    for (const id of ids) r.ids.add(id);
    r.states.add(state);
    if (whole) r.whole = true;
    const last = r.ranges.at(-1);
    if (last && last[1] === f) last[1] = f + 1;
    else if (!last || last[1] < f) r.ranges.push([f, f + 1]);
  };
  const regionsOf = (l: Layer): ResolvedRegion[] => (l.kind !== 'video' ? [] : [...(l.regions ?? []), ...(l.time?.taps ?? []).flatMap((t) => (t.layer.kind === 'video' ? t.layer.regions ?? [] : []))]);
  let cursor = -1;
  for (const [a, b] of spans)
    for (let f = Math.max(a, cursor); f < b; f++) {
      cursor = f + 1;
      const g = evaluate(only, T.frameTime(f, rate));
      for (const l of g.layers) {
        if (l.kind === 'caption' || l.kind === 'adjust') continue; // an adjustment layer never follows a track or carries regions (ADR-0016)
        const b0 = bound.get(l.clipId);
        if (!b0) continue;
        const c = b0.clip;
        const fo = l.follow;
        if (fo && c.type !== 'caption' && c.follow) {
          const st: FollowStateName = fo.state;
          if (st === 'target-missing' || st === 'target-absent') mark('follow_target_missing', c.id, f, st, [c.id, fo.motionTrackId, c.follow.targetTrackId]);
          else if (LOSS_STATES.has(st)) mark('follow_track_loss', c.id, f, st, [c.id, fo.motionTrackId]);
        }
        if (c.type === 'media' && c.redact)
          for (const r of regionsOf(l)) {
            if (r.state === 'fixed') continue;
            if (r.whole || LOSS_STATES.has(r.state)) mark('redact_track_loss', c.id, f, r.state, [c.id, ...c.redact.filter((x) => x.id === r.id && x.motionTrackId).map((x) => x.motionTrackId!)], r.whole);
          }
      }
    }
  const name = (c: Clip) => (c.type === 'text' ? `the title "${c.text.slice(0, 30)}"` : c.type === 'media' ? `"${doc.assets[c.assetId]?.name ?? c.id}"` : c.id);
  const trackName = (ids: Set<string>) => [...ids].map((id) => own(doc.motionTracks, id)?.name).filter(Boolean).map((n) => `"${n}"`).join(', ') || 'its motion track';
  const out: PreflightIssue[] = [];
  for (const r of runs.values()) {
    const c = bound.get(r.clipId)!.clip;
    const states = [...r.states].filter((x) => x !== 'tracked').sort().join(', ');
    for (const [a, b] of r.ranges.slice(0, MAX_TRACK_RUNS)) {
      const message =
        r.kind === 'follow_track_loss' ? `on ${frames(a, b)} ${name(c)} follows ${trackName(r.ids)} where the tracking is ${states}: it is not reliable there and holds the last usable position. Check these frames, or correct the track (edit_motion_track)`
        : r.kind === 'follow_target_missing' ? `on ${frames(a, b)} the picture ${name(c)} follows is not on its target track at that time (${states}): it stays where the nearest clip of that picture leaves it. Move the clip, or follow another track`
        : `on ${frames(a, b)} the tracking of the privacy region on ${name(c)} (${trackName(r.ids)}) is ${states || 'lost'}${r.whole ? '; the whole picture is blurred there instead' : '; the region holds its last usable position'}; automatic tracking is not guaranteed redaction, so check these frames before publishing and correct the track where it is wrong`;
      out.push({ code: r.kind, severity: 'warning', message, ids: [...r.ids], range: { startFrame: a, endFrame: b } });
    }
    if (r.ranges.length > MAX_TRACK_RUNS) {
      const more = r.ranges.slice(MAX_TRACK_RUNS);
      out.push({ code: r.kind, severity: 'warning', message: `${more.length} more stretch(es) of the same problem on ${name(c)}, ${more.reduce((n, [a, b]) => n + b - a, 0)} frame(s) in all, from frame ${more[0]![0]} to frame ${more.at(-1)![1] - 1}${r.kind === 'redact_track_loss' ? '; automatic tracking is not guaranteed redaction' : ''}`, ids: [...r.ids] });
    }
  }
  return out;
}

/** The most ranges listed per stabilised clip and code; more are summed up in one more issue. */
const MAX_STEADY_RUNS = 20;
/**
 * Stabilisation (wave 7; core steady.ts) found by running the evaluator over every frame of each stabilised clip, and over the
 * frames it plays on into its handle while the next clip's transition runs, so speed, reverse, ramps, time taps and transitions
 * are mapped exactly as they render. Only the tracks of stabilised clips are evaluated. Per clip, as timeline ranges:
 * - stabilise_unmeasured: a picture of the clip (its own, a tap's or a ramp's) shows a source frame no measured stretch holds
 *   (state `outside`): it keeps the correction of the nearest measured frame. Next step: measure again.
 * - stabilise_limited: the cover limit weakened the correction there (VideoLayer.steady.limited). 'clip': the clip changed since
 *   its crop was computed; 'reach': only a velocity ramp or a transition handle shows frames outside the clip. The fix recalculates
 *   the crop at the clip's strength (set_clip_stabilise, whose zoom covers the reach as well).
 * Warnings only: a weaker correction or a held one never shows an empty edge.
 */
export function stabiliseIssues(doc: ProjectDocument, rate: { num: number; den: number }): PreflightIssue[] {
  const seq = doc.sequences[doc.mainSequenceId]!;
  const fi = (t: T.RationalTime) => T.frameIndexAt(t, rate);
  const bound = new Map<string, MediaClip>();
  const keep = new Set<string>();
  const spans: [number, number][] = [];
  for (const track of seq.tracks)
    for (const c of track.clips) {
      if (c.type !== 'media' || !c.stabilise || track.kind !== 'video') continue;
      bound.set(c.id, c);
      keep.add(track.id);
      const end = T.add(c.start, c.duration);
      const next = track.clips.find((x) => x.type === 'media' && x.id !== c.id && T.eq(x.start, end) && x.transition);
      const handle = next && next.type === 'media' && next.transition ? Math.min(next.transition.frames, T.frameCount(next.duration, rate)) : 0;
      spans.push([fi(c.start), fi(end) + handle]);
    }
  if (!bound.size) return [];
  const only = { ...doc, sequences: { ...doc.sequences, [doc.mainSequenceId]: { ...seq, tracks: seq.tracks.filter((t) => keep.has(t.id)) } } };
  spans.sort((a, b) => a[0] - b[0]);
  type Kind = 'stabilise_unmeasured' | 'stabilise_limited';
  const runs = new Map<string, { kind: Kind; clipId: string; reasons: Set<string>; ranges: [number, number][] }>();
  const mark = (kind: Kind, clipId: string, f: number, reason = '') => {
    const key = `${kind}|${clipId}`;
    let r = runs.get(key);
    if (!r) runs.set(key, (r = { kind, clipId, reasons: new Set(), ranges: [] }));
    if (reason) r.reasons.add(reason);
    const last = r.ranges.at(-1);
    if (last && last[1] === f) last[1] = f + 1;
    else if (!last || last[1] < f) r.ranges.push([f, f + 1]);
  };
  let cursor = -1;
  for (const [a, b] of spans)
    for (let f = Math.max(a, cursor); f < b; f++) {
      cursor = f + 1;
      const g = evaluate(only, T.frameTime(f, rate));
      for (const l of g.layers) {
        if (l.kind !== 'video' || !bound.has(l.clipId)) continue;
        const pictures = [l, ...(l.time?.taps ?? []).map((t) => t.layer).filter((x): x is typeof l => x.kind === 'video')];
        const steady = pictures.map((p) => p.steady).filter((x) => !!x);
        if (steady.some((s) => s.state === 'outside')) mark('stabilise_unmeasured', l.clipId, f);
        const limited = steady.find((s) => s.limited);
        if (limited?.limited) mark('stabilise_limited', l.clipId, f, limited.limited);
      }
    }
  const name = (c: MediaClip) => `"${doc.assets[c.assetId]?.name ?? c.id}"`;
  const out: PreflightIssue[] = [];
  for (const r of runs.values()) {
    const c = bound.get(r.clipId)!;
    const why = r.reasons.has('clip') ? 'the clip changed since its crop was computed' : 'a transition handle or a velocity ramp shows frames outside the clip';
    const fix = { label: 'Recalculate the crop', ops: [{ op: 'set_clip_stabilise', args: { clipId: c.id, stabilise: { strength: c.stabilise!.strength } } }] };
    const listed = r.ranges.length > MAX_STEADY_RUNS ? r.ranges.slice(0, MAX_STEADY_RUNS - 1) : r.ranges;
    for (const [a, b] of listed)
      out.push(r.kind === 'stabilise_unmeasured'
        ? { code: r.kind, severity: 'warning', message: `on ${frames(a, b)} the camera motion of ${name(c)} was not measured for the source frames shown; they keep the correction of the nearest measured frame. Measure the clip again (stabilise_clip) to steady them`, ids: [c.id, c.assetId], range: { startFrame: a, endFrame: b } }
        : { code: r.kind, severity: 'warning', message: `on ${frames(a, b)} the stabilisation of ${name(c)} is weakened so that no empty edge shows: ${why}. Recalculate the crop`, ids: [c.id], range: { startFrame: a, endFrame: b }, fix });
    if (listed.length < r.ranges.length) {
      const more = r.ranges.slice(listed.length);
      out.push({ code: r.kind, severity: 'warning', message: `${more.length} more stretch(es) of the same problem on ${name(c)}, ${more.reduce((n, [a, b]) => n + b - a, 0)} frame(s) in all, from frame ${more[0]![0]} to frame ${more.at(-1)![1] - 1}`, ids: r.kind === 'stabilise_unmeasured' ? [c.id, c.assetId] : [c.id], ...(r.kind === 'stabilise_limited' ? { fix } : {}) });
    }
  }
  return out;
}
