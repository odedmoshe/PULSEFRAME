/**
 * Programme loudness: mix the current timeline exactly as export would and measure it (EBU R128). Read-only. Moved out of http.ts
 * in the wave 7 send pre-pass. The measured numbers (integratedLufs, truePeakDbtp, rangeLu) are of the mix before any gain, as
 * before; `limiter` is what export would do (null without settings.limiter) and `soundChecks` are read from the 16-bit WAV export
 * would write, written here to a temporary file by the same master chain (send-decisions C9, C12). `target` is the measured
 * OUTPUT's loudness target (a short's own format loudness, else the project's), so a caller compares against the right number.
 */
import fs from 'node:fs';
import path from 'node:path';
import { timeOriginSeconds } from '@pulseframe/core';
import { audioPlan } from '@pulseframe/engine';
import { masterChain, masterLookaheadFrames, measureLoudness, mixToRaw } from './audiomix.ts';
import { heavy } from './analysis.ts';
import { outputDoc } from './export.ts';
import { ApiError, type Store } from './store.ts';

/** The output to measure: absent = the main edit; a sequence (a short) and/or a linked format or audience version (a variant). */
export interface LoudnessTarget { sequenceId?: string; variantId?: string }

export async function programmeLoudness(store: Store, projectId: string, t: LoudnessTarget = {}) {
  const stored = store.getProject(projectId);
  // the chosen output is measured as it exports (outputDoc, the one projection): a sequence (a short, ADR-0018) alone with its own
  // loudness target, a variant (an audience version, say) with its own clips and sound (wave 8 qc, verifier C2)
  const p = { revision: stored.revision, doc: outputDoc(stored.doc, { ...(t.sequenceId !== undefined ? { sequenceId: t.sequenceId } : {}), ...(t.variantId !== undefined ? { variantId: t.variantId } : {}) }) };
  const plan = audioPlan(p.doc);
  if (plan.totalSamples === 0 || plan.clips.length === 0) return { revision: p.revision, integratedLufs: null, truePeakDbtp: null, rangeLu: null, clips: 0, note: 'The timeline has no audible sound.', limiter: null, soundChecks: { method: 'not measured: the timeline has no audible sound', status: 'not_measured' as const, findings: [] } };
  if (plan.totalSamples > plan.sampleRate * 3600) throw new ApiError(422, 'too_long', 'loudness measurement is limited to one hour of programme');
  const raw = path.join(store.tmpDir, `loud_${projectId}_${p.revision}_${Date.now()}.f32`);
  const wav = `${raw.slice(0, -4)}.wav`;
  return heavy(async () => {
  try {
    // the raw mix carries the limiter's look-ahead after the programme (0 frames without a limiter: the mix of before wave 7)
    const extra = masterLookaheadFrames(plan);
    const { clips, peak } = await mixToRaw(plan, (assetId) => store.blobPath(p.doc.assets[assetId]!.contentHash), 0, plan.totalSamples + extra, raw, undefined, (assetId) => timeOriginSeconds(p.doc.assets[assetId]), (assetId) => p.doc.assets[assetId]?.audio?.channels === 1);
    const m = await measureLoudness(raw, plan.sampleRate, extra ? { frames: plan.totalSamples } : {});
    // what export would write, written here to a temporary WAV: the limiter's report and the sound checks come from it (C9, C12)
    const chain = await masterChain(plan, raw, 0, plan.totalSamples, wav, peak, undefined, m);
    const target = p.doc.settings.loudness ?? null;
    return {
      revision: p.revision, clips, seconds: Number((plan.totalSamples / plan.sampleRate).toFixed(3)), ...m,
      mixPeakDbfs: chain.mixPeakDbfs, wouldClipWithoutNormalisation: extra ? (chain.mixPeakDbfs ?? -Infinity) > 0 : peak > 1,
      target, exportWouldApplyGainDb: chain.loudness?.appliedGainDb ?? 0, limitedByPeak: chain.loudness?.limitedByPeak ?? false,
      limiter: chain.limiter ?? null, soundChecks: chain.checks!,
      method: 'ffmpeg ebur128 (EBU R128 / ITU-R BS.1770) on the same mix export renders',
    };
  } finally {
    fs.rmSync(raw, { force: true });
    fs.rmSync(wav, { force: true });
  }
  });
}
