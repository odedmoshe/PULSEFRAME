/** The compute lane (ADR-0017): FIFO, one holder, hooks before each heavy holder, exports pause chunk dispatch. Pure, in-process. */
import { describe, expect, it } from 'vitest';
import { FifoComputeLane } from './lane.ts';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('FifoComputeLane', () => {
  it('grants the lane in arrival order, to a single holder at a time', async () => {
    const lane = new FifoComputeLane();
    const order: string[] = [];
    let inside = 0, maxInside = 0;
    const work = async (label: string, ms: number) => {
      const release = await lane.acquire(label);
      inside++; maxInside = Math.max(maxInside, inside);
      order.push(label);
      expect(lane.busy().holder).toBe(label);
      await new Promise((r) => setTimeout(r, ms));
      inside--;
      release();
    };
    await Promise.all([work('a', 20), work('b', 1), work('c', 10), work('d', 1)]);
    expect(order).toEqual(['a', 'b', 'c', 'd']);
    expect(maxInside).toBe(1);
    expect(lane.busy()).toEqual({ holder: null, waiting: 0 });
  });
  it('busy() names the holder and counts the waiters; a release is idempotent', async () => {
    const lane = new FifoComputeLane();
    const r1 = await lane.acquire('speech');
    const p2 = lane.acquire('chunk 1/3');
    const p3 = lane.acquire('chunk 2/3');
    expect(lane.busy()).toEqual({ holder: 'speech', waiting: 2 });
    r1(); r1();
    const r2 = await p2;
    expect(lane.busy()).toEqual({ holder: 'chunk 1/3', waiting: 1 });
    r2();
    (await p3)();
    expect(lane.busy()).toEqual({ holder: null, waiting: 0 });
  });
  it('onBeforeHeavy runs before each holder starts, with its label; a failing hook does not block the lane', async () => {
    const lane = new FifoComputeLane();
    const calls: string[] = [];
    lane.onBeforeHeavy(async (label) => { await tick(); calls.push(`release kept workers before ${label}`); });
    lane.onBeforeHeavy(() => { throw new Error('worker already gone'); });
    const r1 = await lane.acquire('narration');
    expect(calls).toEqual(['release kept workers before narration']);
    const p2 = lane.acquire('tool');
    await tick();
    expect(calls.length).toBe(1); // the second holder has not started yet
    r1();
    (await p2)();
    expect(calls).toEqual(['release kept workers before narration', 'release kept workers before tool']);
  });
  it('an aborted waiter leaves the queue; the others keep their order', async () => {
    const lane = new FifoComputeLane();
    const r1 = await lane.acquire('a');
    const ctl = new AbortController();
    const pb = lane.acquire('b', ctl.signal);
    const pc = lane.acquire('c');
    ctl.abort(new Error('canceled'));
    await expect(pb).rejects.toThrow('canceled');
    expect(lane.busy().waiting).toBe(1);
    r1();
    const rc = await pc;
    expect(lane.busy().holder).toBe('c');
    rc();
    await expect(lane.acquire('x', AbortSignal.abort(new Error('already')))).rejects.toThrow('already');
  });
  it('an active export pauses chunk dispatch: waitForExportIdle resolves only when every export has ended', async () => {
    const lane = new FifoComputeLane();
    expect(lane.exportActive()).toBe(false);
    await lane.waitForExportIdle(); // nothing running: immediate
    lane.setExportActive(true);
    lane.setExportActive(true); // two overlapping exports
    expect(lane.exportActive()).toBe(true);
    let resumed = false;
    const wait = lane.waitForExportIdle().then(() => { resumed = true; });
    lane.setExportActive(false);
    await tick();
    expect(resumed).toBe(false);
    lane.setExportActive(false);
    await wait;
    expect(resumed).toBe(true);
    expect(lane.exportActive()).toBe(false);
    lane.setExportActive(false); // an unpaired end never goes negative
    expect(lane.exportActive()).toBe(false);
    lane.setExportActive(true);
    const ctl = new AbortController();
    const aborted = lane.waitForExportIdle(ctl.signal);
    ctl.abort(new Error('job canceled'));
    await expect(aborted).rejects.toThrow('job canceled');
  });
});
