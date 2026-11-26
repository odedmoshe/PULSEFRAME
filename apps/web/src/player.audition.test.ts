import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDocument } from '@pulseframe/core';
import type { AudioPlan, PlannedAudioClip } from '@pulseframe/engine';
import type { MediaPool } from './media.ts';
import { Player } from './player.ts';

// ---- labelled stand-ins (test only) ----
// Node has no audio device and no decoder. A fake AudioContext runs on performance.now() and counts the buffers started on it;
// a fake decoder yields 1024-frame buffers, one every `decodeMs` (decoding takes time in a browser). The engine's plan is
// replaced by two 10 s effect clips at 0 and their voice by an identity voice: what is tested here is how the player schedules
// and ends auditions and how it reports priming, not the effects themselves (those have their own tests in packages/engine).
const fake = vi.hoisted(() => ({ SR: 48000, starts: 0, opens: 0, decodeMs: 20, onOutput: null as null | (() => void) }));
const SR = fake.SR;

vi.mock('@pulseframe/engine', async (importOriginal) => {
  const real = await importOriginal<typeof import('@pulseframe/engine')>();
  const sr = fake.SR;
  const clip = (clipId: string): PlannedAudioClip => ({
    clipId, trackId: 't', assetId: 'a', at: 0, length: 10 * sr, source: 0, speed: 1, gain: 1, pan: 0, fade: [{ s: 0, g: 1 }], duck: [{ s: 0, g: 1 }],
    voice: { chain: [{ id: 'x', type: 'voice.telephone', version: 1, stage: 3, params: {}, seed: 1 }] as unknown as NonNullable<PlannedAudioClip['voice']>['chain'], sourceIn: { value: '0', timescale: 1 }, sourceEnd: { value: '10', timescale: 1 }, speed: { num: 1, den: 1 }, reverse: false, sourceRate: sr, warmWindow: 0, warmRing: 0, aheadWindow: 0, tail: 0 },
  });
  const plan: AudioPlan = { sampleRate: sr, totalSamples: 10 * sr, clips: [clip('c1'), clip('c2')], loudness: null, cutTails: [], missingFx: [] };
  return {
    ...real,
    audioPlan: () => plan,
    openClipVoice: (_c: unknown, _planRate: number, _decRate: number, from: number, to: number) => ({ from, end: to, input: { origin: 0, first: from, last: to, reverse: false }, push: (pcm: Float32Array) => pcm, finish: () => new Float32Array(0) }),
    fillPlayingOrder: () => {},
  };
});

class FakeParam { value = 1; setValueAtTime() {} linearRampToValueAtTime() {} }
class FakeNode {
  gain = new FakeParam(); playbackRate = new FakeParam(); buffer: unknown = null; onended: unknown = null;
  connect(x: unknown) { return x; }
  disconnect() {}
  start() { fake.starts++; }
  stop() {}
}
const epoch = performance.now();
class FakeContext {
  sampleRate: number; state = 'running'; destination = new FakeNode(); audioWorklet = { addModule: async () => {} };
  constructor(o: { sampleRate: number }) { this.sampleRate = o.sampleRate; }
  get currentTime() { return (performance.now() - epoch) / 1000; }
  async resume() {}
  async close() {}
  /** In the effects path the only gain node is the session's master: it is made when the clock origin is set. */
  createGain() { fake.onOutput?.(); return new FakeNode(); }
  createAnalyser() { return Object.assign(new FakeNode(), { fftSize: 0, getFloatTimeDomainData() {} }); }
  createBufferSource() { return new FakeNode(); }
  createBuffer(_channels: number, n: number) { const l = new Float32Array(n), r = new Float32Array(n); return { getChannelData: (c: number) => (c ? r : l) }; }
}
const pool = {
  openAudio: async () => {
    fake.opens++;
    return {
      origin: 0, sampleRate: SR, dispose() {},
      sink: {
        async *buffers(from: number) {
          const ch = new Float32Array(1024).fill(0.1);
          for (let k = Math.round(from * SR); ; k += 1024) {
            await new Promise((r) => setTimeout(r, fake.decodeMs));
            yield { timestamp: k / SR, duration: 1024 / SR, buffer: { length: 1024, sampleRate: SR, numberOfChannels: 1, getChannelData: () => ch } };
          }
        },
      },
    };
  },
} as unknown as MediaPool;
// ---- end of stand-ins ----

const draft = { settings: { sampleRate: SR } } as unknown as ProjectDocument;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000) {
  const end = performance.now() + ms;
  while (!cond()) { if (performance.now() > end) throw new Error('timed out waiting'); await sleep(5); }
}
type Stats = ReturnType<Player['syncStats']>;
const players: Player[] = [];
const player = () => { const p = new Player({} as HTMLCanvasElement, pool, () => {}, (e) => { throw e; }); players.push(p); return p; };

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.assign(fake, { starts: 0, opens: 0, decodeMs: 20, onOutput: null });
});
afterEach(async () => { for (const p of players.splice(0)) p.dispose(); await sleep(150); }); // abandoned pumps stop at their next buffer
afterAll(() => { vi.unstubAllGlobals(); });

describe('audition', () => {
  it('a second audition started while the first is still priming plays on, and stopAudition stops it', async () => {
    const p = player();
    let firstDone = false, secondDone = false;
    void p.audition(draft, 'c1', 2).then(() => { firstDone = true; });
    await until(() => fake.opens === 1); // the first audition's voice is decoding ahead: it is priming, its clock is not set yet
    expect(fake.starts).toBe(0);
    void p.audition(draft, 'c2', 2).then(() => { secondDone = true; }); // the next chip's play button
    await until(() => fake.starts > 0); // the second audition's clock is set and its sound scheduled
    await sleep(100); // the first audition's abandoned pump has long noticed by now
    expect({ firstDone, secondDone, auditioning: p.auditioning, voices: p.syncStats().fxVoices }).toEqual({ firstDone: true, secondDone: false, auditioning: true, voices: 1 });
    p.stopAudition();
    const before = fake.starts;
    await sleep(300);
    expect({ secondDone, auditioning: p.auditioning, startedAfterStop: fake.starts - before }).toEqual({ secondDone: true, auditioning: false, startedAfterStop: 0 });
  });

  it('an audition ends by itself after its seconds', async () => {
    fake.decodeMs = 5;
    const p = player();
    let done = false;
    void p.audition(draft, 'c1', 0.3).then(() => { done = true; });
    await until(() => done, 3000);
    expect({ auditioning: p.auditioning, started: fake.starts > 0 }).toEqual({ auditioning: false, started: true });
  });
});

describe('priming statistics', () => {
  it('priming within the cap: not timed out, and its time is measured', async () => {
    fake.decodeMs = 5; // the first 0.25 s of output is rendered in about 60 ms
    const p = player();
    const seen: { stats?: Stats } = {};
    fake.onOutput = () => { seen.stats ??= p.syncStats(); };
    void p.audition(draft, 'c1', 1);
    await until(() => seen.stats !== undefined);
    expect(seen.stats!.fxPrimeTimedOut).toBe(false);
    expect(seen.stats!.fxPrimeMs).toBeLessThan(Player.FX_PRIME_MAX_MS);
  });

  it('priming slower than the cap: the clock starts at the cap, the stats say it timed out, and fxPrimeMs then gives the real time', async () => {
    fake.decodeMs = 100; // 1024 frames per 100 ms: the first 0.25 s of output needs about 1.2 s
    const p = player();
    const seen: { stats?: Stats } = {};
    fake.onOutput = () => { seen.stats ??= p.syncStats(); };
    void p.audition(draft, 'c1', 4);
    await until(() => seen.stats !== undefined);
    expect(seen.stats!.fxPrimeTimedOut).toBe(true);
    await until(() => p.syncStats().fxPrimeMs >= 1000, 5000); // not the cap: the time the voice really needed
    expect(p.syncStats().fxPrimeTimedOut).toBe(true);
  });
});
