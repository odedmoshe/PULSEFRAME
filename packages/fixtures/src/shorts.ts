/**
 * The shorts fixture (ADR-0018, plan §6; the lead's): a long talk with independent truth, for proof:shorts (W2) and the
 * finder's and planner's own checks. Every number is fixed here, so the truth is computed from these formulas and never from
 * the code under test (this file imports nothing from core). No real voice or person is used: the "words" are short bursts
 * of a voiced buzz (harmonics of 140 Hz plus a little noise) with a manual, word-timed Hebrew transcript.
 *
 * Picture (1920×1080, 30 fps): the 16-bit frame-index barcode in the top strip (index.ts BARCODE, readBarcode reads it), and
 * below it a flat background whose colour changes at four planted hard cuts, with a white disc on a known path.
 * Sound (48 kHz stereo, both channels equal): one burst per word at −20 dBFS peak; the words of statement Q at twice the
 * amplitude (+6.02 dB); a 2 s burst of white noise with no word (the reaction heuristic's case); silence elsewhere.
 * Planted statements: Q a question; R opens with «אז כמו שאמרתי»; X holds the excluded word EXCLUDED_WORD; P holds pauses of
 * 0.8 s and 1.5 s and two «אממ» fillers. Times are exact milliseconds, written as "n/1000" rationals.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { barcodeFrame, BARCODE, mulberry32 } from './index.ts';

export const SHORTS_FIXTURE = {
  width: 1920, height: 1080, fps: { num: 30, den: 1 }, seconds: 240, sampleRate: 48000,
  /** First frame of each new shot. */
  cuts: [1500, 2700, 4200, 5700],
  /** Background colours of the five shots (below the barcode strip). */
  shots: [[70, 90, 120], [120, 70, 70], [60, 110, 70], [110, 100, 60], [80, 70, 120]] as [number, number, number][],
  disc: { radius: 48 },
  word: { ms: 320, gapMs: 80 }, statementGapMs: 1000, firstMs: 2000,
  amplitude: 0.1, louderFactor: 2,
  reaction: { ms: 2000, amplitude: 0.3 },
} as const;
export const EXCLUDED_WORD = 'פוליטיקה';
export const FILLER_WORD = 'אממ';
export type StatementTag = 'Q' | 'R' | 'X' | 'P' | null;
export interface ShortsFixtureWord { index: number; segment: number; text: string; startMs: number; endMs: number; start: string; end: string }
export interface ShortsFixtureTruth {
  fps: { num: 30; den: 1 }; width: 1920; height: 1080; frames: number; seconds: number; sampleRate: number;
  /** Words in order. `index` and `segment` are positions: set_transcript gives them their ids (the n-th word of the n-th segment). */
  words: ShortsFixtureWord[];
  statements: { segment: number; firstWord: number; lastWord: number; tag: StatementTag; text: string }[];
  pauses: { start: string; end: string; seconds: number }[]; fillers: number[]; reaction: { start: string; end: string };
  louderDb: 6; cuts: number[]; excludedWord: string;
  /** set_transcript arguments without assetId: origin manual, word timing. */
  transcript: { language: 'he'; origin: 'manual'; segments: { start: { value: string; timescale: 1000 }; duration: { value: string; timescale: 1000 }; text: string; words: { start: { value: string; timescale: 1000 }; duration: { value: string; timescale: 1000 }; text: string }[] }[] };
}

const ms = (n: number) => ({ value: String(n), timescale: 1000 as const });
const rat = (n: number) => `${n}/1000`;
const VOCAB = ['היום', 'אנחנו', 'מדברים', 'על', 'הדרך', 'שבה', 'עובדים', 'יחד', 'בצוות', 'קטן', 'וגם', 'גדול', 'למדנו', 'הרבה', 'מהטעויות', 'שלנו'];
/** Statement k: its words (the last carries its punctuation) and its tag. Fixed, so the truth never depends on the code. */
function statementWords(k: number): { words: string[]; tag: StatementTag; pauseAfter?: number[] } {
  if (k === 6) return { words: ['האם', 'שמתם', 'לב', 'כמה', 'זה', 'פשוט', 'בעצם?'], tag: 'Q' };
  if (k === 12) return { words: ['אז', 'כמו', 'שאמרתי', 'קודם', 'הכול', 'מתחיל', 'בהקשבה.'], tag: 'R' };
  if (k === 18) return { words: ['לא', 'נדבר', 'היום', 'על', EXCLUDED_WORD, 'בכלל.'], tag: 'X' };
  // P: a 0.8 s pause after its 3rd word and a 1.5 s pause after its 6th, and two fillers
  if (k === 24) return { words: ['ואז', FILLER_WORD, 'החלטנו', 'לנסות', FILLER_WORD, 'משהו', 'אחר', 'לגמרי.'], tag: 'P', pauseAfter: [2, 5] };
  const n = 6 + (k % 5);
  const words = Array.from({ length: n }, (_, i) => VOCAB[(k * 3 + i * 5) % VOCAB.length]!);
  words[n - 1] = `${words[n - 1]}.`;
  return { words, tag: null };
}
const P_PAUSES_MS = [800, 1500];
/** After this statement comes the 2 s burst with no word (with a statement gap on each side). */
const REACTION_AFTER = 20;

/** The whole truth for a fixture of `seconds` (default 240): words, statements, pauses, fillers, the reaction burst. */
export function shortsFixtureTruth(seconds: number = SHORTS_FIXTURE.seconds): ShortsFixtureTruth {
  const F = SHORTS_FIXTURE;
  const endMs = seconds * 1000 - 2000;
  const words: ShortsFixtureWord[] = [], statements: ShortsFixtureTruth['statements'] = [], pauses: ShortsFixtureTruth['pauses'] = [], fillers: number[] = [];
  const segments: ShortsFixtureTruth['transcript']['segments'] = [];
  let t = F.firstMs, reaction = { start: '', end: '' };
  for (let k = 0; ; k++) {
    const s = statementWords(k);
    const need = s.words.length * (F.word.ms + F.word.gapMs) + (s.pauseAfter ? P_PAUSES_MS.reduce((a, b) => a + b, 0) : 0);
    if (t + need > endMs) break;
    const first = words.length;
    const segStart = t;
    s.words.forEach((text, i) => {
      const w = { index: words.length, segment: k, text, startMs: t, endMs: t + F.word.ms, start: rat(t), end: rat(t + F.word.ms) };
      words.push(w);
      if (text === FILLER_WORD) fillers.push(w.index);
      t += F.word.ms;
      const p = s.pauseAfter?.indexOf(i) ?? -1;
      if (p >= 0) { pauses.push({ start: rat(t), end: rat(t + P_PAUSES_MS[p]!), seconds: P_PAUSES_MS[p]! / 1000 }); t += P_PAUSES_MS[p]!; }
      else if (i < s.words.length - 1) t += F.word.gapMs;
    });
    const segWords = words.slice(first);
    statements.push({ segment: k, firstWord: first, lastWord: words.length - 1, tag: s.tag, text: segWords.map((w) => w.text).join(' ') });
    segments.push({ start: ms(segStart), duration: ms(t - segStart), text: segWords.map((w) => w.text).join(' '), words: segWords.map((w) => ({ start: ms(w.startMs), duration: ms(F.word.ms), text: w.text })) });
    t += F.statementGapMs;
    if (k === REACTION_AFTER) { reaction = { start: rat(t), end: rat(t + F.reaction.ms) }; t += F.reaction.ms + F.statementGapMs; }
  }
  return {
    fps: { num: 30, den: 1 }, width: 1920, height: 1080, frames: seconds * 30, seconds, sampleRate: F.sampleRate,
    words, statements, pauses, fillers, reaction, louderDb: 6, cuts: F.cuts.filter((c) => c < seconds * 30), excludedWord: EXCLUDED_WORD,
    transcript: { language: 'he', origin: 'manual', segments },
  };
}

/** Disc centre on frame f, in continuous frame pixels (pixel i spans [i, i+1)). Always below the barcode strip. */
export function shortsDisc(f: number): { cx: number; cy: number; r: number } {
  const F = SHORTS_FIXTURE;
  return { cx: F.width / 2 + 640 * Math.sin((2 * Math.PI * f) / 900), cy: 600 + 180 * Math.sin((2 * Math.PI * f) / 450), r: F.disc.radius };
}
/** The shot a frame belongs to (0..cuts.length). */
export const shortsShotOf = (f: number) => SHORTS_FIXTURE.cuts.filter((c) => f >= c).length;
/** Packed RGB24 of frame f: the barcode strip, the shot's background, the white disc. */
export function shortsFrame(f: number): Buffer {
  const F = SHORTS_FIXTURE, W = F.width, H = F.height;
  const buf = barcodeFrame(f, W, H, 30);
  const strip = Math.round(H * BARCODE.stripFrac);
  const [r, g, b] = F.shots[shortsShotOf(f)]!;
  const d = shortsDisc(f);
  for (let y = strip; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      const inside = (x + 0.5 - d.cx) ** 2 + (y + 0.5 - d.cy) ** 2 <= d.r * d.r;
      buf[o] = inside ? 255 : r; buf[o + 1] = inside ? 255 : g; buf[o + 2] = inside ? 255 : b;
    }
  return buf;
}

/** Mono samples of the whole sound track (float, −1..1). Deterministic. */
export function shortsSamples(truth: ShortsFixtureTruth): Float32Array {
  const F = SHORTS_FIXTURE, sr = F.sampleRate;
  const out = new Float32Array(truth.seconds * sr);
  const q = new Set(truth.statements.filter((s) => s.tag === 'Q').flatMap((s) => Array.from({ length: s.lastWord - s.firstWord + 1 }, (_, i) => s.firstWord + i)));
  const ramp = Math.round(0.005 * sr);
  for (const w of truth.words) {
    const rnd = mulberry32(1000 + w.index);
    const a = F.amplitude * (q.has(w.index) ? F.louderFactor : 1);
    const s0 = Math.round((w.startMs * sr) / 1000), s1 = Math.round((w.endMs * sr) / 1000);
    for (let s = s0; s < s1 && s < out.length; s++) {
      const t = (s - s0) / sr;
      let v = 0;
      for (let h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * 140 * h * t + h) / h;
      v = (0.8 * v) / 2.72 + 0.2 * (rnd() * 2 - 1); // |v| ≤ 1
      const env = Math.min(1, (s - s0) / ramp, (s1 - s) / ramp);
      out[s] = a * env * v;
    }
  }
  const rs = Math.round((Number(truth.reaction.start.split('/')[0]) * sr) / 1000), re = Math.round((Number(truth.reaction.end.split('/')[0]) * sr) / 1000);
  const rnd = mulberry32(7);
  for (let s = rs; s < re && s < out.length; s++) out[s] = F.reaction.amplitude * (rnd() * 2 - 1) * Math.min(1, (s - rs) / ramp, (re - s) / ramp);
  return out;
}
function wav16(samples: Float32Array, sr: number): Buffer {
  const n = samples.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { const v = Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767); buf.writeInt16LE(v, 44 + i * 4); buf.writeInt16LE(v, 46 + i * 4); }
  return buf;
}
const run = (args: string[], feed: (stdin: NodeJS.WritableStream) => Promise<void>) =>
  new Promise<void>((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-500)}`))));
    p.stdin.on('error', () => {});
    feed(p.stdin).then(() => p.stdin.end(), reject);
  });

/**
 * Encode the fixture (H.264 CRF 14, 2 B-frames, 1 s GOP; PCM sound as 16-bit stereo WAV muxed as AAC 192k) and write its
 * truth next to it (`<out without extension>.truth.json`). The lead runs it for proof:shorts; it is not run by unit tests.
 */
export async function generateShortsFixture(o: { out: string; seconds?: number }): Promise<ShortsFixtureTruth> {
  const truth = shortsFixtureTruth(o.seconds);
  const F = SHORTS_FIXTURE;
  fs.mkdirSync(path.dirname(o.out), { recursive: true });
  const wav = `${o.out}.wav`;
  fs.writeFileSync(wav, wav16(shortsSamples(truth), F.sampleRate));
  try {
    await run(['-hide_banner', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-video_size', `${F.width}x${F.height}`, '-framerate', '30/1', '-i', 'pipe:0', '-i', wav,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-bf', '2', '-pix_fmt', 'yuv420p', '-g', '30', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', '-fflags', '+bitexact', '-flags:v', '+bitexact', o.out],
    async (stdin) => { for (let i = 0; i < truth.frames; i++) if (!stdin.write(shortsFrame(i))) await new Promise((r) => stdin.once('drain', r)); });
  } finally {
    fs.rmSync(wav, { force: true });
  }
  fs.writeFileSync(o.out.replace(/\.[^.\\/]+$/, '') + '.truth.json', JSON.stringify(truth, null, 1) + '\n');
  return truth;
}
