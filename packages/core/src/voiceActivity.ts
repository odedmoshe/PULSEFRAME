/**
 * Where the voice sounds in a sound file (W1; contract storyContract.ts VoiceMeasure, VOICE_RULES; plan §4.1 with C6): a level
 * measurement from the waveform's level-0 peaks, integers only, so Node and Chromium give the same answer. A heuristic, never speech
 * recognition: a barking dog counts as voice, a whisper under the room noise does not.
 * LEAD PRE-PASS: final signature only; throws StoryNotBuilt until W1 builds it.
 */
import { StoryNotBuilt, type VoiceMeasure } from './storyContract.ts';

/** True once voiceActivity is built (W1 flips it). */
export const VOICE_ACTIVITY_BUILT: boolean = false;

/**
 * `peaks`: interleaved min,max per 256 samples (level 0 of the waveform derivative, 48 kHz mono, from the file's time zero);
 * `totalSamples`: the decoded sample count. Ranges come back in source samples at VOICE_RATE.
 */
export function voiceActivity(_peaks: Int16Array, _totalSamples: number): VoiceMeasure {
  throw new StoryNotBuilt('voiceActivity');
}
