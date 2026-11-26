/**
 * The recorder engine (recorder.ts) and its worklet (apps/web/public/pf-recorder.js) without a browser: a FAKE media stream whose
 * tracks count their stop() calls, a fake AudioContext and AudioWorkletNode (labelled fakes, tests only). The privacy line: every
 * path that must release the microphone has its own test, and each checks that EVERY track was stopped (readyState 'ended') and
 * the context closed.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RECORDER_LIMITS, type RecorderState } from './recorder.contract.ts';
import { createRecorder, encodeWav, peakDbfs, RECORDER_BUILT, RECORDER_CONSTRAINTS } from './recorder.ts';

// ---------- labelled fakes ----------
class FakeTrack {
  readyState: 'live' | 'ended' = 'live';
  stops = 0;
  label = 'Fake microphone';
  kind = 'audio';
  private listeners = new Map<string, Set<() => void>>();
  stop() { this.stops++; this.readyState = 'ended'; }
  addEventListener(t: string, f: () => void) { (this.listeners.get(t) ?? this.listeners.set(t, new Set()).get(t)!).add(f); }
  removeEventListener(t: string, f: () => void) { this.listeners.get(t)?.delete(f); }
  /** The device went away by itself (unplugged, permission revoked): the browser ends the track and fires 'ended'. */
  endByItself() { this.readyState = 'ended'; for (const f of this.listeners.get('ended') ?? []) f(); }
}
class FakeStream {
  constructor(public all: FakeTrack[]) {}
  getTracks() { return this.all as unknown as MediaStreamTrack[]; }
  getAudioTracks() { return this.all as unknown as MediaStreamTrack[]; }
}
class FakePort { onmessage: ((ev: MessageEvent) => void) | null = null; closed = false; close() { this.closed = true; } emit(data: unknown) { this.onmessage?.({ data } as MessageEvent); } }
let lastNode: FakeWorkletNode | null = null;
class FakeWorkletNode {
  port = new FakePort();
  disconnected = 0;
  constructor(public ctx: FakeContext, public name: string, public options: Record<string, any>) { lastNode = this; }
  disconnect() { this.disconnected++; }
}
class FakeContext {
  state: 'running' | 'suspended' | 'closed' = 'running';
  closes = 0;
  modules: string[] = [];
  connectedToOutput = false;
  failModule = false;
  constructor(public sampleRate: number) {}
  audioWorklet = { addModule: async (url: string) => { if (this.failModule) throw new Error('cannot load'); this.modules.push(url); } };
  destination = {};
  async resume() { this.state = 'running'; }
  async close() { this.closes++; this.state = 'closed'; }
  createMediaStreamSource(_s: unknown) {
    const ctx = this;
    return { connect: (n: unknown) => { if (n === ctx.destination) ctx.connectedToOutput = true; }, disconnect: () => {} };
  }
}
const g = globalThis as Record<string, unknown>;
const saved: Record<string, unknown> = {};
beforeEach(() => { for (const k of ['AudioWorkletNode', 'document', 'window', 'fetch']) saved[k] = g[k]; g.AudioWorkletNode = FakeWorkletNode; lastNode = null; });
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete g[k]; else g[k] = v; } });

function rig(opts: { rate?: number; tracks?: number; maxMs?: number; deny?: string; hold?: boolean; failModule?: boolean } = {}) {
  const tracks = Array.from({ length: opts.tracks ?? 2 }, () => new FakeTrack());
  const stream = new FakeStream(tracks);
  const states: RecorderState[] = [];
  const contexts: FakeContext[] = [];
  const asked: MediaStreamConstraints[] = [];
  let grant: (() => void) | null = null;
  const rec = createRecorder({
    getUserMedia: (c) => {
      asked.push(c);
      if (opts.deny) return Promise.reject(Object.assign(new Error('no'), { name: opts.deny }));
      if (opts.hold) return new Promise((res) => { grant = () => res(stream as unknown as MediaStream); });
      return Promise.resolve(stream as unknown as MediaStream);
    },
    createContext: () => { const c = new FakeContext(opts.rate ?? 48000); c.failModule = !!opts.failModule; contexts.push(c); return c as unknown as AudioContext; },
    onState: (s) => states.push(s),
    ...(opts.maxMs ? { maxMs: opts.maxMs } : {}),
  });
  const block = (n = 2048, v = 1000, clipped = 0) => lastNode!.port.emit({ samples: new Int16Array(n).fill(v), peak: Math.abs(v), clipped });
  /** Every track stopped (once at least), ended, and every context closed. */
  const released = () => tracks.every((t) => t.readyState === 'ended' && t.stops >= 1) && contexts.every((c) => c.state === 'closed');
  return { rec, tracks, states, contexts, asked, block, released, grant: () => grant!() };
}
const kinds = (s: RecorderState[]) => s.map((x) => x.kind);

describe('the recorder engine', () => {
  it('is built; asks for the raw mono microphone; loads the static worklet; never connects to the output', async () => {
    expect(RECORDER_BUILT).toBe(true);
    const r = rig();
    await r.rec.start();
    expect(r.asked).toEqual([RECORDER_CONSTRAINTS]);
    expect(RECORDER_CONSTRAINTS.audio).toEqual({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 });
    expect(r.contexts[0]!.modules).toEqual(['/pf-recorder.js']);
    expect(lastNode!.name).toBe('pf-recorder');
    expect(lastNode!.options.numberOfOutputs).toBe(0);
    expect(lastNode!.options.processorOptions.blockSamples).toBeGreaterThanOrEqual(2048);
    expect(r.contexts[0]!.connectedToOutput).toBe(false);
    expect(kinds(r.states)).toEqual(['asking', 'recording']);
    expect(r.rec.tracks().length).toBe(2);
    r.rec.release();
  });
  it('counts samples, the running peak and clipped samples; ignores what is not a block', async () => {
    const r = rig({ rate: 44100 });
    await r.rec.start();
    r.block(2048, 1000);
    r.block(4096, -32768, 7);
    lastNode!.port.emit({ samples: [1, 2, 3] });
    const last = r.states.at(-1) as Extract<RecorderState, { kind: 'recording' }>;
    expect([last.samples, last.rate, last.peakDbfs, last.clipped, last.device]).toEqual([6144, 44100, 0, 7, 'Fake microphone']);
    r.rec.release();
  });
  it('the WAV: 16-bit mono at the context\'s own rate, exactly the samples recorded', async () => {
    const r = rig({ rate: 44100 });
    await r.rec.start();
    r.block(2048, 1234);
    r.block(2048, -5);
    r.rec.stop();
    const s = r.states.at(-1) as Extract<RecorderState, { wav: Blob }>;
    expect(s.kind).toBe('stopped');
    const b = new Uint8Array(await s.wav.arrayBuffer());
    const v = new DataView(b.buffer);
    expect(String.fromCharCode(...b.slice(0, 4), ...b.slice(8, 12))).toBe('RIFFWAVE');
    expect([v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true), v.getUint32(40, true)]).toEqual([1, 1, 44100, 16, 4096 * 2]);
    expect([v.getInt16(44, true), v.getInt16(44 + 2 * 2048, true), b.length]).toEqual([1234, -5, 44 + 8192]);
    expect(s.wav.type).toBe('audio/wav');
  });
  it('stops by itself at the sample limit, cutting the last block to the exact count (state limit)', async () => {
    const r = rig({ rate: 48000, maxMs: 100 }); // 4800 samples
    await r.rec.start();
    r.block(2048); r.block(2048);
    expect(r.states.at(-1)!.kind).toBe('recording');
    r.block(2048);
    const s = r.states.at(-1) as Extract<RecorderState, { wav: Blob }>;
    expect([s.kind, s.samples, s.wav.size]).toEqual(['limit', 4800, 44 + 9600]);
    expect(r.released()).toBe(true); // path 5
    r.block(2048);
    expect(r.states.at(-1)).toBe(s); // nothing after the limit
  });
  it('the default limit is ten minutes of samples', () => expect(RECORDER_LIMITS.maxMs).toBe(600_000));
  it('denied, no device and other failures are honest states, and nothing stays open', async () => {
    for (const [name, kind] of [['NotAllowedError', 'denied'], ['SecurityError', 'denied'], ['NotFoundError', 'no-device'], ['OverconstrainedError', 'no-device'], ['TypeError', 'unsupported']] as const) {
      const r = rig({ deny: name });
      await r.rec.start();
      expect([name, kinds(r.states)]).toEqual([name, ['asking', kind]]);
      expect(r.contexts.length).toBe(0);
      expect(r.rec.tracks()).toEqual([]);
    }
  });
  it('never touches the network (the take stays in memory until the UI saves it through the import path)', async () => {
    let calls = 0;
    g.fetch = () => { calls++; throw new Error('no network in the recorder'); };
    const r = rig();
    await r.rec.start();
    r.block(); r.rec.stop();
    expect(calls).toBe(0);
  });
});

describe('the microphone is released on every path (privacy; each path its own test)', () => {
  it('path 1 — stop: every track stopped, the context closed, the worklet disconnected; the take is kept', async () => {
    const r = rig({ tracks: 3 });
    await r.rec.start();
    r.block();
    r.rec.stop();
    expect(r.released()).toBe(true);
    expect(r.tracks.map((t) => t.stops)).toEqual([1, 1, 1]);
    expect(lastNode!.disconnected).toBe(1);
    expect(lastNode!.port.closed).toBe(true);
    expect(r.rec.tracks()).toEqual([]);
    expect(r.states.at(-1)!.kind).toBe('stopped');
  });
  it('path 2 — record again («הקלטה מחדש», discard): released and the take dropped; a new start opens a fresh stream only', async () => {
    const r = rig();
    await r.rec.start();
    r.block();
    const first = [...r.tracks];
    r.rec.discard();
    expect(r.released()).toBe(true);
    expect(first.every((t) => t.readyState === 'ended')).toBe(true);
    expect(r.states.at(-1)!.kind).toBe('idle');
    r.block(); // a late block of the dropped take changes nothing
    expect(r.states.at(-1)!.kind).toBe('idle');
  });
  it('path 2b — start while recording releases the open stream before asking again (never two microphones)', async () => {
    const r = rig();
    await r.rec.start();
    const ctx0 = r.contexts[0]!;
    r.tracks.forEach((t) => { t.readyState = 'live'; });
    const stopsBefore = r.tracks.map((t) => t.stops);
    await r.rec.start();
    expect(r.tracks.map((t, i) => t.stops - stopsBefore[i]!)).toEqual([1, 1]);
    expect(ctx0.state).toBe('closed');
    r.rec.release();
  });
  it('path 3 — dialog closed: release() stops every track and closes the context; idempotent', async () => {
    const r = rig();
    await r.rec.start();
    r.block();
    r.rec.release();
    expect(r.released()).toBe(true);
    r.rec.release();
    expect(r.tracks.map((t) => t.stops)).toEqual([1, 1]);
    expect(r.contexts[0]!.closes).toBe(1);
  });
  it('path 3b — unmount (the component\'s cleanup calls release()) while the take was stopped already, and while still asking', async () => {
    const r = rig();
    await r.rec.start();
    r.rec.stop();
    r.rec.release();
    expect(r.released()).toBe(true);
    const asking = rig({ hold: true });
    const started = asking.rec.start();
    asking.rec.release(); // unmounted while the browser asks
    asking.grant();
    await started;
    expect(asking.released()).toBe(true);
    expect(asking.tracks.map((t) => t.stops)).toEqual([1, 1]);
    expect(asking.rec.tracks()).toEqual([]);
    expect(kinds(asking.states)).toEqual(['asking']);
  });
  it('path 4 — the page hidden (visibilitychange → hidden): released by the engine itself; the take is kept', async () => {
    const listeners = new Map<string, () => void>();
    const doc = { visibilityState: 'visible', addEventListener: (t: string, f: () => void) => listeners.set(t, f), removeEventListener: (t: string) => listeners.delete(t) };
    g.document = doc;
    const r = rig();
    await r.rec.start();
    r.block();
    listeners.get('visibilitychange')!(); // still visible: nothing happens
    expect(r.tracks.every((t) => t.readyState === 'live')).toBe(true);
    doc.visibilityState = 'hidden';
    listeners.get('visibilitychange')!();
    expect(r.released()).toBe(true);
    expect(r.states.at(-1)!.kind).toBe('stopped');
    expect(listeners.has('visibilitychange')).toBe(false); // the listener is removed with the microphone
  });
  it('path 4b — pagehide releases too', async () => {
    const listeners = new Map<string, () => void>();
    g.window = { addEventListener: (t: string, f: () => void) => listeners.set(t, f), removeEventListener: (t: string) => listeners.delete(t) };
    const r = rig();
    await r.rec.start();
    listeners.get('pagehide')!();
    expect(r.released()).toBe(true);
    expect(listeners.has('pagehide')).toBe(false);
  });
  it('path 6 — the microphone ends by itself (one track ended): every other track is stopped too', async () => {
    const r = rig({ tracks: 2 });
    await r.rec.start();
    r.block();
    r.tracks[0]!.endByItself();
    expect(r.tracks[1]!.readyState).toBe('ended');
    expect(r.tracks[1]!.stops).toBe(1);
    expect(r.contexts[0]!.state).toBe('closed');
    expect(r.states.at(-1)!.kind).toBe('stopped');
  });
  it('path 7 — the worklet cannot load after the microphone was granted: released, state unsupported', async () => {
    const r = rig({ failModule: true });
    await r.rec.start();
    expect(r.released()).toBe(true);
    expect(kinds(r.states)).toEqual(['asking', 'unsupported']);
  });
  it('path 8 — stop or discard while the browser is still asking: the late stream is stopped at once and never recorded', async () => {
    for (const how of ['stop', 'discard'] as const) {
      const r = rig({ hold: true });
      const started = r.rec.start();
      r.rec[how]();
      r.grant();
      await started;
      expect([how, r.released(), r.tracks.map((t) => t.stops)]).toEqual([how, true, [1, 1]]);
      expect(r.states.some((s) => s.kind === 'recording')).toBe(false);
      expect(r.contexts.length).toBe(0);
    }
  });
});

describe('encodeWav and the worklet', () => {
  it('encodeWav writes a 44-byte RIFF header and little-endian samples; refuses a rate that is not a whole number', () => {
    const b = encodeWav(new Int16Array([1, -1, 32767, -32768]), 48000);
    expect(b.length).toBe(52);
    const v = new DataView(b.buffer);
    expect([v.getUint32(4, true), v.getUint32(28, true), v.getUint16(32, true), v.getInt16(46, true), v.getInt16(50, true)]).toEqual([44, 96000, 2, -1, -32768]);
    expect(() => encodeWav(new Int16Array(1), 44100.5)).toThrow(/whole number/);
  });
  it('peakDbfs: full scale is 0, half is −6.0, silence is null', () => {
    expect([peakDbfs(32768), peakDbfs(16384), peakDbfs(0)]).toEqual([0, -6, null]);
  });
  it('pf-recorder.js posts blocks of exactly blockSamples (at least 2048), as 16-bit, with peak and clipped counts', () => {
    const src = fs.readFileSync(path.resolve(import.meta.dirname, '../../../public/pf-recorder.js'), 'utf8');
    const posted: { samples: Int16Array; peak: number; clipped: number }[] = [];
    let Proc: any = null;
    class AudioWorkletProcessor { port = { postMessage: (m: any) => posted.push(m) }; }
    vm.runInNewContext(src, { registerProcessor: (name: string, c: unknown) => { expect(name).toBe('pf-recorder'); Proc = c; }, AudioWorkletProcessor, Int16Array, Math, Number });
    const small = new Proc({ processorOptions: { blockSamples: 100 } });
    expect(small.size).toBe(2048);
    const p = new Proc({ processorOptions: { blockSamples: 4096 } });
    const quantum = (f: (i: number) => number) => p.process([[Float32Array.from({ length: 128 }, (_, i) => f(i))]]);
    for (let q = 0; q < 31; q++) quantum(() => 0.5);
    expect(posted.length).toBe(0);
    quantum((i) => (i === 0 ? 1.2 : i === 1 ? -1 : -0.25));
    expect(posted.length).toBe(1);
    const b = posted[0]!;
    expect([b.samples.length, b.samples[0], b.samples[3968], b.samples[3969], b.samples[3970], b.peak, b.clipped]).toEqual([4096, Math.round(0.5 * 32767), 32767, -32768, -8192, 32768, 2]);
    quantum(() => 0);
    expect(posted.length).toBe(1);
    expect(p.process([[]])).toBe(true);
  });
});
