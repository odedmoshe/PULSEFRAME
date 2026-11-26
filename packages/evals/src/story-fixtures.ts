/**
 * Synthetic sound fixtures of the story proof (wave 7 story track; lead pre-pass, C15). Made by ffmpeg from formulas, in the proof's
 * own temporary folder; nothing is downloaded and no real voice or family media is ever used. Both proof parts (story-proof.server.ts
 * W2, story-proof.ui.ts W3) import the table of times from here, so a check is computed from the fixture's design, not measured
 * back from the file.
 *
 * "Voice" is two tones (300 Hz and 700 Hz) switched on in bursts; the "room" is seeded white noise. Levels: dBFS of the peak.
 *   narration  24 s: bursts NARRATION_BURSTS over a −60 dBFS floor (pauses 1.5, 1.2, 2.0, 0.3 s; the 0.3 s pause must stay inside one range)
 *   gated      the same bursts with true digital silence between them (a phone recorder's gate; C6)
 *   mic        8 s: 0.3 s bursts at MIC_BURSTS over a −60 dBFS floor (the fake microphone of the UI proof, U2)
 *   quiet      the narration's bursts at −45 dBFS; hot: at full scale, clipped; flat: steady noise at −30 dBFS, no bursts
 *   narration.m4a (AAC, Chromium plays it) and narration-alac.m4a (ALAC, Chromium does not: the honest unplayable state, U15)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Burst [start, end) seconds of narration.wav, gated.wav, quiet.wav and hot.wav. */
export const NARRATION_BURSTS: readonly (readonly [number, number])[] = [[0.5, 3.0], [4.5, 7.0], [8.2, 13.0], [15.0, 18.0], [18.3, 23.5]];
export const NARRATION_SECONDS = 24;
/** Burst starts of mic.wav (each 0.3 s long). */
export const MIC_BURSTS: readonly number[] = [0.4, 1.5, 2.6];
export const MIC_BURST_SECONDS = 0.3;
export const MIC_SECONDS = 8;
/** The ranges the measurement should find in narration.wav: the five bursts, the last two joined across the 0.3 s pause. */
export const NARRATION_RANGES: readonly (readonly [number, number])[] = [[0.5, 3.0], [4.5, 7.0], [8.2, 13.0], [15.0, 23.5]];
export const STORY_FIXTURE_NAMES = ['narration.wav', 'gated.wav', 'mic.wav', 'quiet.wav', 'hot.wav', 'flat.wav', 'narration.m4a', 'narration-alac.m4a'] as const;
export type StoryFixtureName = (typeof STORY_FIXTURE_NAMES)[number];

const on = (bursts: readonly (readonly [number, number])[]) => bursts.map(([a, b]) => `between(t,${a},${b - 0.0001})`).join('+');
const tones = (amp: number) => `${amp}*(sin(2*PI*300*t)+sin(2*PI*700*t))`;
/** ffmpeg arguments for one fixture (out = its path). Exported so a check can state how a file was made. */
export function storyFixtureArgs(name: StoryFixtureName, out: string, dir: string): string[] {
  const head = ['-hide_banner', '-loglevel', 'error', '-y'];
  const wav = ['-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', out];
  const voice = (bursts: readonly (readonly [number, number])[], amp: number, seconds: number) => ['-f', 'lavfi', '-i', `aevalsrc='(${on(bursts)})*${tones(amp)}':s=48000:d=${seconds}`];
  const noise = (amp: number, seconds: number) => ['-f', 'lavfi', '-i', `anoisesrc=a=${amp}:c=white:seed=7:r=48000:d=${seconds}`];
  const mix = ['-filter_complex', '[0:a][1:a]amix=inputs=2:normalize=0:duration=first'];
  const micBursts = MIC_BURSTS.map((s) => [s, s + MIC_BURST_SECONDS] as const);
  switch (name) {
    case 'narration.wav': return [...head, ...voice(NARRATION_BURSTS, 0.25, NARRATION_SECONDS), ...noise(0.001, NARRATION_SECONDS), ...mix, ...wav];
    case 'gated.wav': return [...head, ...voice(NARRATION_BURSTS, 0.25, NARRATION_SECONDS), ...wav];
    case 'mic.wav': return [...head, ...voice(micBursts, 0.25, MIC_SECONDS), ...noise(0.001, MIC_SECONDS), ...mix, ...wav];
    case 'quiet.wav': return [...head, ...voice(NARRATION_BURSTS, 0.0028, NARRATION_SECONDS), ...noise(0.0005, NARRATION_SECONDS), ...mix, ...wav];
    case 'hot.wav': return [...head, ...voice(NARRATION_BURSTS, 0.75, NARRATION_SECONDS), ...noise(0.001, NARRATION_SECONDS), ...mix, ...wav];
    case 'flat.wav': return [...head, ...noise(0.0316, NARRATION_SECONDS), ...wav];
    case 'narration.m4a': return [...head, '-i', path.join(dir, 'narration.wav'), '-c:a', 'aac', '-b:a', '128k', out];
    case 'narration-alac.m4a': return [...head, '-i', path.join(dir, 'narration.wav'), '-c:a', 'alac', out];
  }
}
/** Makes every fixture in `dir` (narration.wav first: the two copies are made from it). Returns name → path. */
export function makeStoryFixtures(dir: string, ffmpeg = 'ffmpeg'): Record<StoryFixtureName, string> {
  fs.mkdirSync(dir, { recursive: true });
  const out = {} as Record<StoryFixtureName, string>;
  for (const name of STORY_FIXTURE_NAMES) {
    const file = path.join(dir, name);
    execFileSync(ffmpeg, storyFixtureArgs(name, file, dir), { stdio: ['ignore', 'ignore', 'pipe'] });
    out[name] = file;
  }
  return out;
}
