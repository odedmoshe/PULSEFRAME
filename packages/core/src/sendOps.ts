/**
 * The two operations of track send (wave 7), lead-built and complete. Generic exact undo (one transaction, entity diffs).
 * - set_master_limiter: settings.limiter (absent = no limiter; export and preview then run exactly as before the field existed).
 * - match_clip_loudness: new clip gains from measured loudness, planned in core (loudnessMatch.ts planMatchGain). The measurement
 *   (POST …/analysis/clip-loudness, MCP measure_clip_loudness) returns its revision; callers commit with expectedRevision, and
 *   the op's gain guard is a second line (send-decisions C15).
 */
import { z } from 'zod';
import { defineOp, mustClip, OpError } from './ops.ts';
import { matchCeiling, planMatchGain } from './loudnessMatch.ts';
import { LOUDNESS_MATCH, SEND_REFUSALS as R, type MatchClipOutput } from './sendContract.ts';

defineOp({
  name: 'set_master_limiter',
  version: 1,
  description: 'Turn the master limiter on with a ceiling in dBTP (-9…0), or off with ceiling=null. With it, export applies the loudness target gain (no longer stopped by the peak) and then a look-ahead brick-wall limiter so no sample of the 16-bit sound exceeds the ceiling; preview runs the same limiter on its own mix. Without it, export is exactly as before.',
  args: z.object({ ceiling: z.number().min(-9).max(0).nullable() }).strict(),
  apply(d, a) {
    if (a.ceiling === null) delete d.settings.limiter; else d.settings.limiter = { ceiling: a.ceiling };
    return { affectedIds: [d.id], summary: a.ceiling === null ? 'Master limiter off' : `Master limiter ${a.ceiling} dB` };
  },
});

const MatchClip = z.object({ clipId: z.string(), measuredLufs: z.number().min(-70).max(0), peakDbfs: z.number().min(-120).max(24), gain: z.number().gt(0).max(LOUDNESS_MATCH.maxGain) }).strict();
defineOp({
  name: 'match_clip_loudness',
  version: 1,
  description: 'Set the gains of sound clips so each measures the target loudness (LUFS), from the values measure_clip_loudness returned (commit with its revision as expectedRevision). A clip whose peak would pass the ceiling (limiter ceiling, else the loudness true-peak, else 0 dBFS; plus 6 dB when the master limiter is on) is raised only to it (limitedBy peak); gains stay in (0, 8] (limitedBy range). One undo restores every clip. LUFS is a measurement, not how loud it feels.',
  args: z.object({ target: z.number().min(-40).max(-5), clips: z.array(MatchClip).min(1).max(LOUDNESS_MATCH.maxClips) }).strict(),
  apply(d, a) {
    const seen = new Set<string>();
    const ceiling = matchCeiling(d);
    const out: MatchClipOutput[] = [];
    for (const m of a.clips) {
      if (seen.has(m.clipId)) throw new OpError(R.duplicate.code, R.duplicate.message(m.clipId), { clipId: m.clipId }, R.duplicate.hint);
      seen.add(m.clipId);
      const { clip, track } = mustClip(d, m.clipId);
      if (clip.type !== 'media' || track.kind !== 'audio' || !d.assets[clip.assetId]?.audio) throw new OpError(R.notSound.code, R.notSound.message(m.clipId), { clipId: m.clipId }, R.notSound.hint);
      if (clip.gain !== m.gain) throw new OpError(R.stale.code, R.stale.message(m.clipId), { clipId: m.clipId, reason: R.stale.reason, gain: clip.gain, measuredAt: m.gain }, R.stale.hint);
      const plan = planMatchGain(m, a.target, ceiling);
      clip.gain = plan.to;
      out.push(plan);
    }
    return { affectedIds: out.map((x) => x.clipId), summary: `Matched the loudness of ${out.length} clip(s) to ${a.target} LUFS`, output: { target: a.target, ...ceiling, clips: out } };
  },
});
