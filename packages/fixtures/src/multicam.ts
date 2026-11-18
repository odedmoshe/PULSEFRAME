/**
 * Multicam sync fixtures (ADR-0020). LEAD: the signature and the truth it returns; W2: the generator.
 * Sound is NON-periodic seeded speech built from narration-sample-he.m4a (random pitch ±3 semitones, tempo ±10%, gaps
 * 0.3–2 s): a click every second, or the beep fixture, has equal correlation peaks every period and a sync gate rightly calls
 * it ambiguous (plan, "facts both designs missed" c). Video frames carry readBarcode = group frame index (channel 0) and angle
 * index (channel 1), so a proof reads exactly which angle and group frame is on screen.
 * Angles: the reference recorder; angle 2 at +57,321 samples, polarity flipped, pink noise at 10 dB SNR; angle 3 at +100 ppm
 * (asetrate) split into two files at 60% of the length; extra cameras with a periodic music loop only (expect ambiguous), pink
 * noise only (no-shared-sound) and a 2 s internal pause (inconsistent). The dialogue variant: speaker 2 pitch-shifted, mics
 * bleeding at −15 dB, turns that overlap by ≥ 1 s. Capture dates (ADR-0021) may be written per file so the capture-time
 * prior (core multicamPrior.ts) can be checked against the truth.
 */
export interface MulticamFixtureOptions { outDir: string; seconds: number; fps?: { num: number; den: number }; sampleRate?: number; seed?: number; narrationPath: string; dialogue?: boolean; extras?: boolean }
export interface MulticamFixtureFile { path: string; groupStartSamples: number; captureAt?: string }
export interface MulticamFixtureAngle { label: string; kind: 'picture' | 'sound'; files: MulticamFixtureFile[]; truth: { offsetSamples: number; driftPpm: number; polarity: 1 | -1 }; expect: 'reference' | 'confident' | 'ambiguous' | 'no-shared-sound' | 'inconsistent' }
export interface MulticamFixture { sampleRate: number; fps: { num: number; den: number }; angles: MulticamFixtureAngle[]; turns: { speaker: 0 | 1; startSeconds: number; endSeconds: number }[] }
export async function generateMulticamFixture(o: MulticamFixtureOptions): Promise<MulticamFixture> { void o; throw new Error('generateMulticamFixture is not built yet (ADR-0020 W2)'); }
