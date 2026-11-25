/**
 * Where the voice sounds in a sound file (W1; contract storyContract.ts VoiceMeasure, VOICE_RULES; plan §4.1 with C6): a level
 * measurement from the waveform's level-0 peaks, integers only, so Node and Chromium give the same answer. A heuristic, never speech
 * recognition: a barking dog counts as voice, a whisper under the room noise does not.
 *
 * THE RULE (every figure is VOICE_RULES; every quantity an integer):
 * 1. amp[b] = max(|min|, |max|) of bucket b (256 samples at 48 kHz, 5.33 ms); a frame is 4 buckets (1024 samples, 21.3 ms) and
 *    holds the integer mean (floor) of its buckets' amp. Buckets past totalSamples are ignored.
 * 2. noise = the 10th percentile of the frames (floorPct, as multicamAuto.ts's floor); speech = the 90th percentile (speechPct, as
 *    multicamAuto.ts's speech level) of the frames ABOVE that floor (integer selection on a sorted copy: index floor(p·n/100)).
 * 3. C6: noise = max(noise, 16) (noiseClamp, about −66 dBFS) before anything else uses it, so digital silence (true zeros in the
 *    pauses: a phone's noise gate, a messaging app's voice note) still gives thresholds above zero.
 * 4. Flat (no usable contrast; no ranges) when speech < 4 × noise (flatRatio, about 12 dB) or speech < 328 (flatMin, −40 dBFS).
 * 5. on = isqrt(noise × speech) (halfway in dB); off = max(floor(on / 2), 2 × noise). A range opens at a frame ≥ on and closes when
 *    the frames stay < off for holdMs (350 ms = 17 frames, rounded up); it ends after its last frame ≥ off.
 * 6. Ranges shorter than minRangeMs (a key click, a door) are dropped; each is widened padBeforeMs before and padAfterMs after
 *    (clamped to the file), then overlapping or touching ranges merge. At most maxRanges (`truncated` beyond).
 * Edges are sample indices at VOICE_RATE from the file's time zero (the waveform is decoded from the file's own start, derive.ts).
 * noiseDb10 / voiceDb10 (tenths of dBFS of 32768) are for display only.
 * Why a fourth measurement and not detectSilences, the multicam envelope or voice clean-up's pause finder: the ADR of the story
 * track says (the peaks are ready at import, so planning needs no decode and no job).
 */
import { VOICE_ALGO, VOICE_RATE, VOICE_RULES, type VoiceMeasure } from './storyContract.ts';

/** True once voiceActivity is built (W1 flips it). */
export const VOICE_ACTIVITY_BUILT: boolean = true;

const SAMPLES_PER_FRAME = VOICE_RULES.samplesPerBucket * VOICE_RULES.frameBuckets;
const PER_MS = VOICE_RATE / 1000; // 48 samples a millisecond (an integer)

/** The integer square root (floor) of a non-negative safe integer. */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let x = Math.floor(Math.sqrt(n));
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}
/** Tenths of dBFS of an amplitude out of 32768, for display only (clamped to −1000..0). */
const db10 = (amp: number) => (amp <= 0 ? -1000 : Math.max(-1000, Math.min(0, Math.round(200 * Math.log10(amp / 32768)))));
/** The p-th percentile (integer p) of an ascending list: the element at floor(p·n/100). */
const pct = (sorted: Int32Array, from: number, p: number) => sorted[from + Math.min(sorted.length - from - 1, Math.floor(((sorted.length - from) * p) / 100))]!;

/**
 * `peaks`: interleaved min,max per 256 samples (level 0 of the waveform derivative, 48 kHz mono, from the file's time zero);
 * `totalSamples`: the decoded sample count. Ranges come back in source samples at VOICE_RATE.
 */
export function voiceActivity(peaks: Int16Array, totalSamples: number): VoiceMeasure {
  const total = Math.max(0, Math.floor(totalSamples));
  const buckets = Math.min(Math.floor(peaks.length / 2), Math.ceil(total / VOICE_RULES.samplesPerBucket));
  const frameCount = Math.ceil(buckets / VOICE_RULES.frameBuckets);
  const frames = new Int32Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    let sum = 0, n = 0;
    for (let b = f * VOICE_RULES.frameBuckets; b < Math.min(buckets, (f + 1) * VOICE_RULES.frameBuckets); b++) {
      sum += Math.max(Math.abs(peaks[2 * b]!), Math.abs(peaks[2 * b + 1]!));
      n++;
    }
    frames[f] = Math.floor(sum / n);
  }
  if (!frameCount) {
    const level = db10(VOICE_RULES.noiseClamp);
    return { algo: VOICE_ALGO, noiseDb10: level, voiceDb10: level, flat: true, ranges: [] };
  }
  const sorted = frames.slice().sort();
  const floorRaw = pct(sorted, 0, VOICE_RULES.floorPct);
  let above = 0;
  while (above < sorted.length && sorted[above]! <= floorRaw) above++;
  const noise = Math.max(floorRaw, VOICE_RULES.noiseClamp);
  const voice = Math.max(noise, above < sorted.length ? pct(sorted, above, VOICE_RULES.speechPct) : floorRaw);
  const flat = voice < VOICE_RULES.flatRatio * noise || voice < VOICE_RULES.flatMin;
  const out: VoiceMeasure = { algo: VOICE_ALGO, noiseDb10: db10(noise), voiceDb10: db10(voice), flat, ranges: [] };
  if (flat) return out;

  const on = isqrt(noise * voice), off = Math.max(Math.floor(on / 2), 2 * noise);
  const hold = Math.ceil((VOICE_RULES.holdMs * PER_MS) / SAMPLES_PER_FRAME);
  const raw: { start: number; end: number }[] = [];
  let open = -1, lastLoud = -1;
  const close = () => { raw.push({ start: open * SAMPLES_PER_FRAME, end: Math.min(total, (lastLoud + 1) * SAMPLES_PER_FRAME) }); open = -1; };
  for (let f = 0; f < frameCount; f++) {
    const v = frames[f]!;
    if (open < 0) { if (v >= on) { open = f; lastLoud = f; } continue; }
    if (v >= off) lastLoud = f;
    else if (f - lastLoud >= hold) close();
  }
  if (open >= 0) close();
  const minLen = VOICE_RULES.minRangeMs * PER_MS, before = VOICE_RULES.padBeforeMs * PER_MS, after = VOICE_RULES.padAfterMs * PER_MS;
  for (const r of raw) {
    if (r.end - r.start < minLen) continue;
    const start = Math.max(0, r.start - before), end = Math.min(total, r.end + after);
    const last = out.ranges[out.ranges.length - 1];
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else out.ranges.push({ start, end });
  }
  if (out.ranges.length > VOICE_RULES.maxRanges) { out.ranges.length = VOICE_RULES.maxRanges; out.truncated = true; }
  return out;
}
