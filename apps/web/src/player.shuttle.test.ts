/**
 * Player.shuttle at the ends of the timeline, on a fake clock with animation frames every 16 ms.
 *
 * Found while writing player.flash.test.ts: a shuttle started forwards from frame 0 less than 1/(rate × fps) s before the
 * next animation frame (about 4 ms at 8x and 30 fps) computed frame 0 again on its first tick and stopped there, as if it had
 * reached the start of the timeline; the same backwards from the last frame. A shuttle stops only past the end it moves towards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject } from '@pulseframe/core';
import type { MediaPool } from './media.ts';
import { Player } from './player.ts';

// ---- labelled stand-ins (test only) ----
// Drawing: Node has no canvas, so a draw takes 5 ms of the fake clock and paints nothing. What is tested is which frames the
// shuttle asks for and when it stops, not the picture (the drawing has its own tests in packages/engine).
vi.mock('@pulseframe/engine', async (importOriginal) => {
  const real = await importOriginal<typeof import('@pulseframe/engine')>();
  return { ...real, drawGraph: async () => { await new Promise((r) => setTimeout(r, 5)); return { missing: [], unavailableEffects: [] }; } };
});
class FakeCanvas {
  width = 0; height = 0; dataset: Record<string, string> = {};
  getContext() { return { canvas: this, drawImage: () => {} }; }
}
// ---- end of stand-ins ----

const R = { num: 30, den: 1 }, FRAMES = 300;
/** A 10 s project at 30 fps: one title over the whole of it. */
function doc() {
  const base = createProject({ id: 'prj_sh', name: 'Shuttle', frameRate: R, width: 360, height: 640 });
  return applyTransaction(base, [{ op: 'add_text', args: { text: 'SHUTTLE', start: T.ZERO, duration: T.frameTime(FRAMES, R) } }], { idSeed: 'sh_', actor: 'test' }).doc;
}

let player: Player;
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
/** Call `run` `before` ms ahead of an animation frame of the fake clock (frames are 16 ms apart). */
async function aheadOfFrame(before: number, run: () => void) {
  let called = false;
  requestAnimationFrame(() => setTimeout(() => { called = true; run(); }, 16 - before));
  while (!called) await advance(1); // stop at the call, before the frame that follows it
}
beforeEach(() => {
  // Node has no animation frames: placeholders, which the fake timers replace with frames every 16 ms of the fake clock
  const g = globalThis as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
  g.requestAnimationFrame ??= () => 0; g.cancelAnimationFrame ??= () => {};
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  (globalThis as { document?: unknown }).document = { createElement: () => new FakeCanvas() };
  player = new Player(new FakeCanvas() as unknown as HTMLCanvasElement, { frames: {}, draftFrames: {} } as unknown as MediaPool, () => {}, (e) => { throw e; });
  player.setDoc(doc());
});
afterEach(() => {
  player.pause();
  vi.useRealTimers();
  delete (globalThis as { document?: unknown }).document;
});

describe('player: shuttle at the ends of the timeline', () => {
  it('8x forwards from frame 0, started 1 ms before an animation frame: keeps moving', async () => {
    await advance(100);
    expect(player.frame).toBe(0);
    await aheadOfFrame(1, () => player.shuttle(8));
    expect(player.playing).toBe(true);
    await advance(1); // the first tick: 1 ms in, still frame 0
    expect(player.playing, 'the first tick computes frame 0 again: it is not the end of a forward shuttle').toBe(true);
    expect(player.shuttleRate).toBe(8);
    expect(player.frame).toBe(0);
    await advance(500);
    expect(player.playing).toBe(true);
    expect(player.frame).toBeGreaterThan(100); // 0.5 s at 8 × 30 fps = 120 frames, less a tick
  });

  it('8x backwards from the last frame, started 1 ms before an animation frame: keeps moving', async () => {
    player.seek(FRAMES - 1);
    await advance(100);
    await aheadOfFrame(1, () => player.shuttle(-8));
    await advance(1);
    expect(player.playing, 'the first tick computes the last frame again: it is not the end of a backward shuttle').toBe(true);
    expect(player.frame).toBe(FRAMES - 1);
    await advance(500);
    expect(player.playing).toBe(true);
    expect(player.frame).toBeLessThan(FRAMES - 1 - 100);
  });

  it('stops at the end it moves towards, on that end', async () => {
    await aheadOfFrame(1, () => player.shuttle(8));
    await advance(2000); // 300 frames at 240 a second: 1.25 s
    expect(player.playing).toBe(false);
    expect(player.shuttleRate).toBe(0);
    expect(player.frame).toBe(FRAMES - 1);
    await aheadOfFrame(1, () => player.shuttle(-8));
    await advance(2000);
    expect(player.playing).toBe(false);
    expect(player.frame).toBe(0);
  });

  it('nowhere to go: forwards from the last frame and backwards from frame 0 do not start', () => {
    player.shuttle(-8);
    expect(player.playing).toBe(false);
    player.seek(FRAMES - 1);
    player.shuttle(8);
    expect(player.playing).toBe(false);
    expect(player.frame).toBe(FRAMES - 1);
  });
});
