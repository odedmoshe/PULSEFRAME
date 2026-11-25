/**
 * Programme loudness: mix the current timeline exactly as export would and measure it (EBU R128). Read-only. Moved out of http.ts
 * unchanged in the wave 7 send pre-pass; worker A's file from then on (it gains `limiter` — what export would do — and
 * `soundChecks`, read from the WAV export would write; send-decisions C9, C12).
 */
import fs from 'node:fs';
import path from 'node:path';
import { timeOriginSeconds } from '@pulseframe/core';
import { audioPlan } from '@pulseframe/engine';
import { measureLoudness, mixToRaw, normalisationGain } from './audiomix.ts';
import { heavy } from './analysis.ts';
import { outputDoc } from './export.ts';
import { ApiError, type Store } from './store.ts';

export async function programmeLoudness(store: Store, projectId: string, sequenceId?: string) {
  const stored = store.getProject(projectId);
  // a sequence (a short, ADR-0018) is measured as it exports: alone, with its own loudness target
  const p = { revision: stored.revision, doc: outputDoc(stored.doc, { sequenceId }) };
  const plan = audioPlan(p.doc);
  if (plan.totalSamples === 0 || plan.clips.length === 0) return { revision: p.revision, integratedLufs: null, truePeakDbtp: null, rangeLu: null, clips: 0, note: 'The timeline has no audible sound.' };
  if (plan.totalSamples > plan.sampleRate * 3600) throw new ApiError(422, 'too_long', 'loudness measurement is limited to one hour of programme');
  const raw = path.join(store.tmpDir, `loud_${projectId}_${p.revision}_${Date.now()}.f32`);
  return heavy(async () => {
  try {
    const { clips, peak } = await mixToRaw(plan, (assetId) => store.blobPath(p.doc.assets[assetId]!.contentHash), 0, plan.totalSamples, raw, undefined, (assetId) => timeOriginSeconds(p.doc.assets[assetId]), (assetId) => p.doc.assets[assetId]?.audio?.channels === 1);
    const m = await measureLoudness(raw, plan.sampleRate);
    const target = p.doc.settings.loudness ?? null;
    const g = target ? normalisationGain(m, target.target, target.truePeak) : null;
    return {
      revision: p.revision, clips, seconds: Number((plan.totalSamples / plan.sampleRate).toFixed(3)), ...m,
      mixPeakDbfs: peak > 0 ? Number((20 * Math.log10(peak)).toFixed(2)) : null, wouldClipWithoutNormalisation: peak > 1,
      target, exportWouldApplyGainDb: g ? Number(g.gainDb.toFixed(2)) : 0, limitedByPeak: g?.limitedByPeak ?? false,
      method: 'ffmpeg ebur128 (EBU R128 / ITU-R BS.1770) on the same mix export renders',
    };
  } finally {
    fs.rmSync(raw, { force: true });
  }
  });
}
