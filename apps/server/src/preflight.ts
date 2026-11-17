/**
 * Creative preflight (SPEC §19.14): look at one output (the master or a linked format) before export and list what would
 * go wrong or look wrong, each issue tied to the objects involved and, where a mechanical fix exists, the ops that apply it.
 * Blockers stop an export; warnings and notes do not. Read-only. Text extents are ESTIMATES (the server does not shape text).
 */
import * as T from '@pulseframe/time';
import { handleAfterEnd, sequenceDuration, type OpCall, type ProjectDocument } from '@pulseframe/core';
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

export function preflight(exporter: Exporter, master: ProjectDocument, revision: number, opts: PreflightOptions = {}) {
  const issues: PreflightIssue[] = [];
  const doc = variantDoc(master, opts.variantId);
  const variant = opts.variantId ? master.variants[opts.variantId]! : null;
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
        // 4. a transition whose outgoing clip has run out of source: the outgoing picture would freeze
        if (c.transition) {
          const prev = track.clips.find((p) => p.type === 'media' && p.id !== c.id && T.eq(T.add(p.start, p.duration), c.start));
          const pa = prev && prev.type === 'media' ? doc.assets[prev.assetId] : undefined;
          if (prev && prev.type === 'media' && pa && pa.kind !== 'image') {
            const handle = fi(handleAfterEnd(prev, pa.duration));
            if (handle < c.transition.frames) issues.push({ code: 'transition_freeze', severity: 'warning', message: `the ${c.transition.type} transition needs ${c.transition.frames} spare source frames after the previous clip but only ${Math.max(0, handle)} exist; the outgoing picture will freeze`, ids: [c.id, prev.id], fix: handle > 0 ? { label: `Shorten the transition to ${handle} frames`, ops: [{ op: 'set_transition', args: { clipId: c.id, type: c.transition.type, frames: handle } }] } : { label: 'Remove the transition', ops: [{ op: 'set_transition', args: { clipId: c.id, type: null } }] } });
          }
        }
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
    scope: 'Checked: render blockers, empty picture, loudness setup, sound-effect tails cut at the end of the video, video decoders needed at once, transition handles, upscaling, safe areas (estimated text extents), caption reading speed. Not checked: picture quality, audio clipping (use measure_loudness), how the sound effects sound (nobody has listened to them), accessibility contrast, platform rules.',
  };
}
