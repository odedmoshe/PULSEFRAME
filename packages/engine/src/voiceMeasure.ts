/**
 * Voice measurement for voice cleanup «ניקוי קול» (ADR-0013): background-noise level in the 24 bands of the noise profile
 * (core voiceClean.ts), mains hum, speech level, peak and SNR, from interleaved stereo PCM at 48 kHz. Streaming, pure,
 * deterministic and model-free; framed exactly as the cleanup.denoise kernel frames its input (fft.ts). Read-only: what it
 * measures is returned as candidate clean_voice operations by measure_voice (apps/server/src/voiceClean.ts), never stored.
 *
 * SKELETON of the lead's contracts pass (plan "Lead contracts" 10): W1 implements every body.
 */

export const VOICE_MEASURE_RATE = 48000;
export interface VoiceMeasureOptions { /** seconds from the first frame pushed that hold only noise; omitted = find the quietest stretches */ noiseRanges?: readonly { start: number; end: number }[] }
export interface VoiceMeasurement {
  analysedSeconds: number;
  noise: { mode: 'auto' | 'ranges'; bandsDb: number[]; profile: string; quietSeconds: number; confidence: number; ranges: { start: number; end: number }[]; warning: 'no_pause_found' | 'ranges_too_short' | null };
  hum: { hz: 50 | 60; levelDb: number; harmonics: number } | null;
  speech: { levelDb: number | null; peakDb: number; snrDb: number | null };
}
export interface VoiceMeter { push(pcm: Float32Array /* interleaved stereo at 48 kHz; mono as L = R */): void; finish(): VoiceMeasurement }
/** Streaming, pure, deterministic, model-free. Memory ≤ 64 MB for 600 s. */
export function voiceMeter(_opts?: VoiceMeasureOptions): VoiceMeter {
  throw new Error('not implemented: W1');
}
/** 0.35 at ≥ 30 dB SNR, falling linearly to 0.85 at ≤ 10 dB; 0.6 when the SNR is unknown. */
export function recommendedStrength(_m: VoiceMeasurement): number {
  throw new Error('not implemented: W1');
}
