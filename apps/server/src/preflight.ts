/**
 * Creative preflight (SPEC §19.14): look at one output (the master or a linked format) before export and list what would
 * go wrong or look wrong, each issue tied to the objects involved and, where a mechanical fix exists, the ops that apply it.
 * Blockers stop an export; warnings and notes do not. Read-only. Text extents are ESTIMATES (the server does not shape text).
 */
import * as T from '@pulseframe/time';
import { own, previousAdjacent, sequenceDuration, velocityLimit, velocityNeeds, type MediaClip, type OpCall, type ProjectDocument, type Track, type Transition } from '@pulseframe/core';
import { audioPlan, captionCues, decodeOverBudget, type DecodeStretch } from '@pulseframe/engine';
import type { Exporter } from './export.ts';
import { variantDoc } from './export.ts';

export interface PreflightIssue {
  code: string;
  severity: 'blocker' | 'warning' | 'note';
  message: string;
  ids: string[];
  range?: { startFrame: number; endFrame: number };
  /** A mechanical fix the caller may apply as one transaction (or propose). Absent when the fix needs judgement. */
  fix?: { label: string; ops: OpCall[] };
}
export interface PreflightOptions { variantId?: string; maxCharsPerSecond?: number }
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
  const doc = variantDoc(master, opts.variantId);
  const variant = opts.variantId ? own(master.variants, opts.variantId)! : null; // variantDoc above refused an id that names no format
  const { width: W, height: H, frameRate: rate } = doc.settings;
  const seq = doc.sequences[doc.mainSequenceId]!;
  const total = T.frameCount(sequenceDuration(doc), rate);
  const fi = (t: T.RationalTime) => T.frameIndexAt(t, rate);

  // 1. what would stop the render
  const plan = exporter.plan(master, revision, opts.variantId ? { variantId: opts.variantId } : {});
  for (const b of plan.blockers) issues.push({ code: b.code, severity: 'blocker', message: b.message, ids: b.ids });
  // A sound-effect tail cut at the end of the video is how effects are designed to behave (ADR-0010), so it is a note here.
  for (const w of plan.warnings) issues.push({ code: w.code, severity: w.code === 'audio_tail_cut' ? 'note' : 'warning', message: w.message, ids: w.ids });

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
        if (dims) {
          const fit = (doc.settings.fit === 'cover' ? Math.max : Math.min)(W / dims.width, H / dims.height);
          const enlarge = fit * c.transform.scale;
          if (enlarge > 1.5) issues.push({ code: 'upscaled', severity: 'warning', message: `"${asset!.name}" (${dims.width}×${dims.height}) is shown ${enlarge.toFixed(2)}× larger than its own pixels in this ${W}×${H} output and will look soft`, ids: [c.id, c.assetId] });
        }
      }
      // 6. titles against the safe area (estimated extent)
      if (c.type === 'text' && variant?.safeArea && !track.hidden) {
        const sa = variant.safeArea;
        const lines = c.text.split('\n');
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
          issues.push({ code: 'outside_safe_area', severity: 'warning', message: `the title "${c.text.slice(0, 30)}" probably reaches outside the safe area of ${variant.name} (${Object.entries(out).filter(([, v]) => v).map(([k2]) => k2).join(', ')}); app interface elements may cover it. The extent is an estimate`, ids: [c.id, variant.id], fix: { label: k < 1 ? 'Shrink and move it inside the safe area in this format only' : 'Move it inside the safe area in this format only', ops: [{ op: 'set_variant_override', args: { variantId: variant.id, clipId: c.id, transform: { x: Number(nx.toFixed(4)), y: Number(ny.toFixed(4)), ...(k < 1 ? { scale: Number((c.transform.scale * k).toFixed(4)) } : {}) } } }] } });
        }
      }
    }
    if (track.kind === 'caption' && track.caption && !track.hidden) {
      // 7. captions against the safe area and reading speed
      const st = track.caption.style;
      if (variant?.safeArea && st.position !== 'center') {
        const need = st.position === 'bottom' ? variant.safeArea.bottom : variant.safeArea.top;
        if (st.marginFrac < need) issues.push({ code: 'captions_outside_safe_area', severity: 'warning', message: `captions sit ${(st.marginFrac * 100).toFixed(0)}% from the ${st.position} edge, inside the ${(need * 100).toFixed(0)}% zone that ${variant.name} marks as likely covered. Caption style is shared by all formats`, ids: [track.id, variant.id], fix: { label: 'Raise the caption margin (all formats)', ops: [{ op: 'set_caption_style', args: { trackId: track.id, style: { marginFrac: Number(Math.min(0.45, need + 0.02).toFixed(3)) } } }] } });
      }
      const limit = opts.maxCharsPerSecond ?? 20;
      const fast = captionCues(doc, seq, track).filter((q) => q.text.replace(/\s+/g, '').length / Math.max(0.001, T.toSeconds(T.sub(q.end, q.start))) > limit);
      if (fast.length) issues.push({ code: 'captions_too_fast', severity: 'warning', message: `${fast.length} caption(s) exceed ${limit} characters per second and may be hard to read (first: "${fast[0]!.text.slice(0, 30)}"). The limit is a setting, not a universal rule`, ids: [track.id], range: { startFrame: fi(fast[0]!.start), endFrame: fi(fast[0]!.end) } });
    }
  }
  const count = (s: PreflightIssue['severity']) => issues.filter((i) => i.severity === s).length;
  return {
    revision, variantId: opts.variantId ?? null, output: { width: W, height: H, frames: total, fit: doc.settings.fit ?? 'contain', safeArea: variant?.safeArea ?? null },
    ok: count('blocker') === 0, blockers: count('blocker'), warnings: count('warning'), notes: count('note'), issues,
    scope: 'Checked: render blockers, empty picture, loudness setup, sound-effect tails cut at the end of the video, video decoders needed at once, transition handles (velocity ramps included), upscaling, safe areas (estimated text extents), caption reading speed. Not checked: picture quality, audio clipping (use measure_loudness), how the sound effects sound (nobody has listened to them), accessibility contrast, platform rules.',
  };
}
