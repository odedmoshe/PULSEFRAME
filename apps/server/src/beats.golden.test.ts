/**
 * Golden over the beat tracker (ADR-0020 W2): the FFT and onset code moved to dsp.ts for the multicam envelope, and the beat
 * output must stay byte-identical. The hashes were recorded from beats.ts BEFORE the move (one per fixture of beats.test.ts).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { detectBeats, onsetEnvelope } from './beats.ts';
import { drumLoop } from './beats.fixtures.ts';

const sha = (b: ArrayBufferView | string) => createHash('sha256').update(typeof b === 'string' ? b : new Uint8Array(b.buffer, b.byteOffset, b.byteLength)).digest('hex').slice(0, 24);
const FIXTURES: [string, () => Float32Array][] = [
  ['120', () => drumLoop(() => 120, 24).x],
  ['90', () => drumLoop(() => 90, 24).x],
  ['drift', () => drumLoop((t) => 120 + (7 * t) / 24, 24).x],
  ['bars4', () => drumLoop(() => 96, 30, 0.2, 3, 4).x],
  ['bars3', () => drumLoop(() => 132, 30, 0.3, 5, 3).x],
];
const GOLDEN: Record<string, { onset: string; beats: string }> = {
  '120': { onset: 'e8407243602403d7c52c90c3', beats: 'f8f705ca799b6f520c6a9782' },
  '90': { onset: 'dbe37b3525e9419a2634c747', beats: '12e5d914070530a8661f0bf3' },
  drift: { onset: 'c096958d4923230298de262a', beats: '7393c03ead1d3125dc86cd5e' },
  bars4: { onset: '8a764defbd7bd6e19ea683cf', beats: 'a3e1e6c3302c5ead93497665' },
  bars3: { onset: '6f600065e34c9ee7b53a644d', beats: '3f737be3eb5dffe2a881f971' },
};

describe('beat output golden (byte-identical across the DSP move)', () => {
  it.each(FIXTURES)('%s', (name, make) => {
    const x = make();
    const got = { onset: sha(onsetEnvelope(x)), beats: sha(JSON.stringify(detectBeats(x))) };
    if (process.env.PF_PRINT_GOLDEN) console.log(`GOLDEN ${name} ${JSON.stringify(got)}`);
    expect(got).toEqual(GOLDEN[name]);
  });
});
