/**
 * Player.timelineSecondsAt and Player.monitorSound (ADR-0025, perform/contract.ts PerformPlayerPort). The real Player; the audio
 * clock is a labelled stand-in (Node has no audio device): a context whose getOutputTimestamp and currentTime are set by the test.
 * "Playing" and the clock origin are set directly (the transport sets them in play()), because no device exists here.
 */
import { describe, expect, it, vi } from 'vitest';
import { createProject, type ProjectDocument } from '@pulseframe/core';
import type { MediaPool } from './media.ts';
import { Player } from './player.ts';

// the drawing is a labelled stand-in (Node has no canvas)
vi.mock('@pulseframe/engine', async (importOriginal) => ({ ...(await importOriginal<typeof import('@pulseframe/engine')>()), drawGraph: async () => ({ unavailableEffects: [], unavailableReasons: {} }) }));
class FakeCanvas { width = 0; height = 0; dataset: Record<string, string> = {}; getContext() { return { canvas: this, drawImage: () => {} }; } }
vi.stubGlobal('document', { createElement: () => new FakeCanvas() });

const R = { num: 30, den: 1 };
const doc = (): ProjectDocument => createProject({ id: 'prj_pf', name: 'PF', frameRate: R, width: 320, height: 180 });
interface Internals { playing: boolean; shuttleRate: number; clock: 'audio' | 'monotonic'; origin: { clock: number; frame: number }; actx: unknown; doc: ProjectDocument | null }
const mk = (pool: unknown = {}) => {
  const p = new Player(new FakeCanvas() as unknown as HTMLCanvasElement, pool as MediaPool, () => {}, (e) => { throw e; });
  p.doc = doc();
  return { p, i: p as unknown as Internals };
};

describe('timelineSecondsAt', () => {
  it('maps a performance time through the output timestamp of the audio clock to timeline seconds', () => {
    const { p, i } = mk();
    // playback started at timeline frame 60 (2 s) when the context's clock read 10 s
    Object.assign(i, { playing: true, clock: 'audio', origin: { clock: 10, frame: 60 } });
    // the context time 12 is being output at performance time 5000 ms: an event at 5250 ms is heard at context time 12.25
    i.actx = { currentTime: 99, outputLatency: 0.05, getOutputTimestamp: () => ({ contextTime: 12, performanceTime: 5000 }) };
    expect(p.timelineSecondsAt(5250)).toBeCloseTo(2 + (12.25 - 10), 9);
    expect(p.timelineSecondsAt(5000)).toBeCloseTo(4, 9);
  });
  it('falls back to the context clock less its output latency when the browser has no output timestamp', () => {
    const { p, i } = mk();
    Object.assign(i, { playing: true, clock: 'audio', origin: { clock: 0, frame: 0 } });
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    i.actx = { currentTime: 3, outputLatency: 0.04, getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }) };
    expect(p.timelineSecondsAt(1100)).toBeCloseTo(3 - 0.04 + 0.1, 9);
    vi.restoreAllMocks();
  });
  it('uses the monotonic clock when no sound plays', () => {
    const { p, i } = mk();
    Object.assign(i, { playing: true, clock: 'monotonic', origin: { clock: 2, frame: 30 } });
    expect(p.timelineSecondsAt(4500)).toBeCloseTo(1 + 2.5, 9);
  });
  it('is null when nothing plays at normal speed (stopped, shuttling) or there is no document', () => {
    const { p, i } = mk();
    expect(p.timelineSecondsAt(1000)).toBeNull();
    Object.assign(i, { playing: true, clock: 'monotonic', origin: { clock: 0, frame: 0 }, shuttleRate: 0.5 });
    expect(p.timelineSecondsAt(1000)).toBeNull();
    Object.assign(i, { shuttleRate: 0, doc: null });
    expect(p.timelineSecondsAt(1000)).toBeNull();
  });
});

describe('monitorSound and the picture document', () => {
  const ctxFake = () => {
    const started: number[] = [];
    const node = () => ({ connect: (x: unknown) => x, gain: { value: 1 }, buffer: null as unknown, start: (w: number) => { started.push(w); } });
    return { started, ctx: { state: 'running', currentTime: 7, destination: {}, createBufferSource: node, createGain: node } };
  };
  const poolFake = () => {
    const opens = { n: 0 };
    return { opens, pool: { openAudio: async () => { opens.n++; return { origin: 0, sampleRate: 48000, dispose() {}, sink: { async *buffers() { yield { buffer: { duration: 0.5 }, duration: 0.5, timestamp: 0 }; yield { buffer: { duration: 0.25 }, duration: 0.25, timestamp: 0.5 }; } } }; } } };
  };
  it('decodes once, plays the buffers back to back straight to the output, and gain 0 only decodes', async () => {
    const { pool, opens } = poolFake();
    const { p, i } = mk(pool);
    const { ctx, started } = ctxFake();
    i.actx = ctx;
    p.monitorSound('ast_1', 0); // warm-up: decodes, no sound
    await vi.waitFor(() => expect((p as unknown as { monitorCache: Map<string, unknown> }).monitorCache.get('ast_1')).toBeInstanceOf(Array));
    expect(started).toEqual([]);
    p.monitorSound('ast_1', 1);
    p.monitorSound('ast_1', 1);
    expect(started).toEqual([7, 7.5, 7, 7.5]);
    expect(opens.n).toBe(1);
  });
  it('does nothing without a running audio context, and does not touch the transport', () => {
    const { p, i } = mk(poolFake().pool);
    const pause = vi.spyOn(p, 'pause'), setDoc = vi.spyOn(p, 'setDoc');
    p.monitorSound('ast_1', 1);
    i.actx = { state: 'suspended' };
    p.monitorSound('ast_1', 1);
    expect(pause).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
  });
  it('a picture-only live document replaces the drawn one without a pause (setPictureDoc, the live picture of a take)', () => {
    const { p, i } = mk();
    i.playing = true;
    const pause = vi.spyOn(p, 'pause');
    const same = structuredClone(p.doc!);
    expect(p.setPictureDoc(same)).toBe(true);
    expect(pause).not.toHaveBeenCalled();
    expect(p.doc).toBe(same);
  });
});
