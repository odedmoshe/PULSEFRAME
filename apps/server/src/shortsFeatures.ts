/**
 * Audio features of a source file for the shorts finder (ADR-0018, plan §4.3; contract core shortsContract.ts §3): per 100 ms
 * hop, RMS level in dBFS (not LUFS), spectral flatness 100 Hz–7.9 kHz and positive log-spectral flux, from ffmpeg mono 16 kHz
 * in 20-minute windows (-copyts minus the file's time origin, capped at 4 h, as analysis.ts beatsOfWindow), under heavy() with
 * the 10-minute kill, checking `abandoned()` between windows. Cached under <store.dataDir>/features/<contentHash>.audio-v1.bin
 * + .json, keyed by content hash and AUDIO_FEATURES_VERSION; never in the document. W2 builds the bodies; this pre-pass fixes
 * the signatures and refuses honestly (501 not_built): it never returns made-up measurements.
 */
import { SHORTS_STATUS, shortsRefusal, type Asset, type AudioFeatures } from '@pulseframe/core';
import { ApiError, type Store } from './store.ts';

const notBuilt = (what: string): never => { const e = shortsRefusal('notBuilt', { part: 'audio features' }, what); throw new ApiError(SHORTS_STATUS[e.code], e.code, e.message, e.details, e.hint); };

/** Measure (or read from the cache) the audio features of `asset`; stops between windows once `abandoned()` is true. */
export async function audioFeaturesOf(_store: Store, _asset: Asset, _abandoned?: () => boolean): Promise<AudioFeatures> {
  return notBuilt('measuring the sound for shorts');
}
/** The cached features of `asset` for this AUDIO_FEATURES_VERSION, or null when they were never measured. Never spawns ffmpeg. */
export function cachedAudioFeatures(_store: Store, _asset: Asset): AudioFeatures | null {
  return notBuilt('reading the measured sound for shorts');
}
