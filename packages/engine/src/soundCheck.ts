/**
 * Sound checks of an export (wave 7, track send). Worker A's file; a stub until A lands it (send-decisions C9): one pass over
 * the WRITTEN 16-bit WAV in blocks of 0.1 s — clipped = a block holding at least 3 samples at −32768 or 32767; silence = blocks
 * whose RMS is under −60 dBFS for at least 2 s. Positions are sample indices of the export; the server adds the range's first
 * sample, so findings are timeline times { value: sample, timescale: sampleRate }.
 */
export interface SoundRun { kind: 'silence' | 'clipped'; fromSample: number; toSample: number; measured: Record<string, number> }
export const SOUND_CHECK_BUILT = false;
export class SoundCheck {
  constructor(readonly sampleRate: number, readonly channels: number) {}
  /** Interleaved 16-bit samples, in order. */
  push(samples: Int16Array): void { void samples; throw new Error('SoundCheck.push is not built yet (send A)'); }
  runs(): SoundRun[] { throw new Error('SoundCheck.runs is not built yet (send A)'); }
}
