/**
 * «בדיקה לפני ייצוא» — the silence and clipped findings of the CHOSEN output's measurement, shown before export (wave 8 qc; B2
 * builds it). Mounted by ExportSheet.tsx `Checks` under the loudness row; `sound` comes from the same measure_loudness call the row
 * makes (verifier C2: the short on screen and the lead format). Until B2 builds it: renders nothing.
 * B2: one row per finding (QC_TESTIDS.soundItem, data-kind) with its time in <bdi dir="ltr">, the measured numbers in words, and
 * «מעבר לקטע» (QC_TESTIDS.soundJump) → onJump(frame). Explained findings (`explained`) are listed apart and not counted (C8).
 */
import type { SoundChecks } from '@pulseframe/core';

export interface PreflightSoundProps { lang: 'he' | 'en'; sound: SoundChecks | null; rate: { num: number; den: number }; onJump(frame: number): void }
export function PreflightSound(props: PreflightSoundProps) {
  void props;
  return null;
}
