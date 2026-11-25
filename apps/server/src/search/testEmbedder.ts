/**
 * TEST DOUBLE (labelled) of the picture model of «חיפוש בצילומים» (wave 7 search track; decisions §4). Used ONLY by unit tests and by
 * pnpm proof:search (startServer's TEST-only `searchEmbedder`); never chosen from the environment. It is NOT SigLIP and understands
 * nothing: it proves the plumbing (decode, batches, index, ranking, deletion), never quality. Its id is FOOTAGE_EMBEDDERS.testDouble and
 * every answer that used it names it.
 *
 * Pictures: every 4th pixel is put in one of nine colour bins (red, orange, yellow, green, blue, purple, white, black, other) by hue and
 * lightness; the bin counts are dims 0–8. Dims 600–631 carry a small deterministic signature of the frame's bytes (FNV-1a), so every
 * stored row is distinctive and a test can find (or prove absent) its exact bytes in the index file. Text: a 16-word colour table
 * (Hebrew and English); each word found sets its bin; a text with no known word points at dim 767, which no picture uses, so it matches
 * nothing (an honest "nothing found"). Relevance = sigmoid(20·cos − 10), so cos 0 is far below core PICTURE_MIN_RELEVANCE.
 */
import { FOOTAGE_EMBEDDERS, FOOTAGE_LIMITS } from '@pulseframe/core';
import type { Embedder } from './contract.ts';

export const TEST_DOUBLE_LABEL = 'TEST-DOUBLE-embedder/1 (labelled test double: proves plumbing, never quality)';
const DIM = FOOTAGE_LIMITS.embedDim;
const SIDE = 256;
const FRAME_BYTES = SIDE * SIDE * 3;
const BINS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'white', 'black', 'other'] as const;
type Bin = (typeof BINS)[number];
/** The 16-word colour table (8 colours × Hebrew and English). */
export const TEST_DOUBLE_WORDS: Readonly<Record<string, Bin>> = {
  red: 'red', 'אדום': 'red', orange: 'orange', 'כתום': 'orange', yellow: 'yellow', 'צהוב': 'yellow', green: 'green', 'ירוק': 'green',
  blue: 'blue', 'כחול': 'blue', purple: 'purple', 'סגול': 'purple', white: 'white', 'לבן': 'white', black: 'black', 'שחור': 'black',
};

function binOf(r: number, g: number, b: number): Bin {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, c = max - min;
  if (c < 40) return l < 64 ? 'black' : l > 190 ? 'white' : 'other';
  let h: number;
  if (max === r) h = ((g - b) / c) * 60; else if (max === g) h = ((b - r) / c) * 60 + 120; else h = ((r - g) / c) * 60 + 240;
  if (h < 0) h += 360;
  if (h < 15 || h >= 345) return 'red';
  if (h < 45) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 170) return 'green';
  if (h < 260) return 'blue';
  return 'purple';
}
function normalise(v: Float32Array, at: number): void {
  let n = 0;
  for (let i = 0; i < DIM; i++) n += v[at + i]! * v[at + i]!;
  n = Math.sqrt(n);
  for (let i = 0; i < DIM; i++) v[at + i] = v[at + i]! / n;
}

export interface TestEmbedderOptions {
  /** wait this long per batch (tests of cancel, restart and the export wait) */
  delayMs?: number;
  /** break the vectors of a call, for the validation checks (S16): which side, and how */
  fault?: { on: 'images' | 'text'; kind: 'wrongLength' | 'nan' | 'notUnit' } | null;
}
/** The labelled test double with counters a test can read. */
export interface TestEmbedder extends Embedder {
  readonly label: string;
  options: TestEmbedderOptions;
  calls: { images: number; frames: number; text: number; releases: number };
}

export function createTestEmbedder(options: TestEmbedderOptions = {}): TestEmbedder {
  const calls = { images: 0, frames: 0, text: 0, releases: 0 };
  const wait = (ms: number, signal: AbortSignal) => new Promise<void>((res, rej) => {
    if (!ms) return res();
    const t = setTimeout(() => { signal.removeEventListener('abort', ab); res(); }, ms);
    const ab = () => { clearTimeout(t); rej(signal.reason ?? new Error('aborted')); };
    signal.addEventListener('abort', ab, { once: true });
  });
  const broken = (v: Float32Array, on: 'images' | 'text'): Float32Array => {
    const f = self.options.fault;
    if (!f || f.on !== on) return v;
    if (f.kind === 'wrongLength') return v.slice(0, v.length - 1);
    if (f.kind === 'nan') { const w = v.slice(); w[0] = Number.NaN; return w; }
    const w = v.slice(); for (let i = 0; i < w.length; i++) w[i] = w[i]! * 1.5; return w;
  };
  const self: TestEmbedder = {
    id: FOOTAGE_EMBEDDERS.testDouble,
    label: TEST_DOUBLE_LABEL,
    dim: DIM,
    options,
    calls,
    relevance: (cos) => 1 / (1 + Math.exp(-(20 * cos - 10))),
    async embedImages(rgb, count, signal) {
      if (rgb.length !== count * FRAME_BYTES) throw new Error(`test double: ${rgb.length} bytes for ${count} frames`);
      await wait(self.options.delayMs ?? 0, signal);
      calls.images++; calls.frames += count;
      const out = new Float32Array(count * DIM);
      for (let k = 0; k < count; k++) {
        const base = k * FRAME_BYTES, at = k * DIM;
        let h = 0x811c9dc5;
        for (let p = 0; p < SIDE * SIDE; p += 4) {
          const o = base + p * 3;
          out[at + BINS.indexOf(binOf(rgb[o]!, rgb[o + 1]!, rgb[o + 2]!))]! += 1;
        }
        for (let o = base; o < base + FRAME_BYTES; o += 97) { h ^= rgb[o]!; h = Math.imul(h, 0x01000193) >>> 0; }
        let max = 0;
        for (let i = 0; i < BINS.length; i++) max = Math.max(max, out[at + i]!);
        for (let i = 0; i < 32; i++) { h ^= i; h = Math.imul(h, 0x01000193) >>> 0; out[at + 600 + i] = max * (0.01 + ((h >>> 8) % 1000) / 25000); }
        normalise(out, at);
      }
      return broken(out, 'images');
    },
    async embedText(texts, signal) {
      await wait(0, signal);
      calls.text++;
      const out = new Float32Array(texts.length * DIM);
      texts.forEach((t, k) => {
        const at = k * DIM;
        let any = false;
        for (const w of t.toLowerCase().split(/[\s,.;:!?"'()]+/u)) {
          const bin = Object.hasOwn(TEST_DOUBLE_WORDS, w) ? TEST_DOUBLE_WORDS[w] : undefined;
          if (bin) { out[at + BINS.indexOf(bin)] = 1; any = true; }
        }
        if (!any) out[at + DIM - 1] = 1;
        normalise(out, at);
      });
      return broken(out, 'text');
    },
    async release() { calls.releases++; },
  };
  return self;
}
