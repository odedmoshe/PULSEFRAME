/**
 * The preview's photosensitivity guard as the editor's Player uses it (ADR-0009 decision 2), with drawing that takes time.
 *
 * Recorded with the real editor on 2026-11-18 (packages/evals/src/shuttle-flash.recorded.ts, UNSAFE_START): at 8x shuttle
 * the screen rose four times in 0.9 s, because (a) the shuttle began from a paused frame painted without its light (the
 * GPU pass not ready) while the guard counted it lit, and (b) the guard was asked when the draw began, so a light reached
 * the screen 0.318 s after the last one had. Here the real Player (pump, shuttle, pause, seek, the real evaluate and
 * FlashGuard) runs on a fake clock; only the drawing is a stand-in. The visible canvas is sampled on every animation frame
 * and measured as gpu-proof measures it: the mean brightness of a picture of 127 of 255 with the strobes of the frame
 * painted on it mixed in; a rise is more than 8 of 255 above the lowest since the last fall.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { GPU_EFFECTS, SCREEN_FLASH_GAP, type RenderGraph } from '@pulseframe/engine';
import type { MediaPool } from './media.ts';
import { Player } from './player.ts';

// ---- labelled stand-ins (test only) ----
// Drawing: the frame's brightness is computed from the graph it is given and put on the off-screen canvas after `delay()`
// milliseconds of the fake clock; while `gpu.ready` is false the strobe pass is reported unavailable and draws no light.
const gpu = vi.hoisted(() => ({ ready: true, delay: (() => 40) as () => number, draws: 0 }));
vi.mock('@pulseframe/engine', async (importOriginal) => {
  const real = await importOriginal<typeof import('@pulseframe/engine')>();
  return {
    ...real,
    drawGraph: async (ctx: { canvas: FakeCanvas }, g: RenderGraph) => {
      const ready = gpu.ready;
      gpu.draws++;
      await new Promise((r) => setTimeout(r, gpu.delay()));
      ctx.canvas.content = brightness(g, ready);
      return { missing: [], unavailableEffects: ready ? [] : ['light.strobe'] };
    },
  };
});
class FakeCanvas {
  width = 0; height = 0; dataset: Record<string, string> = {};
  /** The mean brightness of what is drawn on it. */
  content = 0;
  getContext() { return { canvas: this, drawImage: (src: FakeCanvas) => { this.content = src.content; } }; }
}
// ---- end of stand-ins ----

const R = { num: 30, den: 1 }, PICTURE = 127;
let seed = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `pf${seed++}_`, actor: 'test', allowInternal });
/** gpu-proof's document: a picture filling the frame with two strobes (3 and 2.5 a second, amount 0.8) and a strobing title from frame 5. */
function proofDoc(frames = 14_400) {
  const pic = { kind: 'image' as const, name: 'ramp.png', contentHash: `sha256:${'b'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 360, height: 640, codec: 'png', hasAlpha: false }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' } };
  let r = tx(createProject({ id: 'prj_pf', name: 'PF', frameRate: R, width: 360, height: 640 }), [{ op: 'import_asset', args: { asset: pic } }], true);
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: r.results[0]!.output!.assetId as string, start: T.rt(0, 1), duration: T.frameTime(frames, R) } }]);
  const clipId = r.results[0]!.output!.clipId as string;
  r = tx(r.doc, [{ op: 'add_effect', args: { clipId, type: 'light.strobe', params: { rate: 3, amount: 0.8 } } }, { op: 'add_effect', args: { clipId, type: 'light.strobe', params: { rate: 2.5, amount: 0.8 } } }]);
  r = tx(r.doc, [{ op: 'add_text', args: { text: 'FLASH', start: T.frameTime(5, R), duration: T.frameTime(frames - 5, R) } }]);
  return tx(r.doc, [{ op: 'add_effect', args: { clipId: r.results[0]!.output!.clipId as string, type: 'light.strobe', params: { rate: 3, amount: 1 } } }]).doc;
}
/** Mean brightness of a frame: the picture with every strobe on a picture mixed in (a title's strobe lights its letters only); none without the GPU. */
function brightness(g: RenderGraph, withStrobes: boolean) {
  let m = PICTURE;
  if (!withStrobes) return m;
  for (const l of g.layers) {
    if (l.kind === 'text') continue;
    for (const fx of 'effects' in l ? l.effects ?? [] : []) {
      if (fx.type !== 'light.strobe') continue;
      const [r, gr, b, light] = GPU_EFFECTS['light.strobe']!.params(fx.params, { width: g.width, height: g.height, seconds: T.toSeconds(g.time), beat: null }) as number[];
      m = m * (1 - light!) + (255 * (r! + gr! + b!) / 3) * light!;
    }
  }
  return m;
}
function rises(samples: readonly (readonly [number, number])[]) {
  const out: number[] = [];
  let rising = false, low = Infinity, high = 0;
  for (const [t, v] of samples) {
    if (!rising && v > low + 8) { out.push(t); rising = true; high = v; }
    else if (rising && v < high - 8) { rising = false; low = v; }
    if (rising) high = Math.max(high, v); else low = Math.min(low, v);
  }
  return out;
}
const mostInOneSecond = (times: number[]) => { let most = 0; for (let i = 0, j = 0; i < times.length; i++) { while (times[i]! - times[j]! > 1) j++; most = Math.max(most, i - j + 1); } return most; };
const closest = (times: number[]) => Math.min(Infinity, ...times.slice(1).map((t, i) => t - times[i]!));
/** Pseudo-random numbers in [0, 1), the same on every run. */
const prng = (s: number) => () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);

let canvas: FakeCanvas, player: Player, samples: [number, number][];
const pool = { frames: {}, draftFrames: {} } as unknown as MediaPool;
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
/**
 * Start a shuttle on an animation frame, so that its first tick comes a whole frame later. (This once worked around a shuttle
 * that stopped on its first tick when started just before a frame; that is fixed and tested in player.shuttle.test.ts. Kept
 * so the recorded timings of these tests stay the same.)
 */
const shuttle = (speed: number) => requestAnimationFrame(() => player.shuttle(speed));
beforeEach(() => {
  // Node has no animation frames: placeholders, which the fake timers replace with frames every 16 ms of the fake clock
  const g = globalThis as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
  g.requestAnimationFrame ??= () => 0; g.cancelAnimationFrame ??= () => {};
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  (globalThis as { document?: unknown }).document = { createElement: () => new FakeCanvas() };
  gpu.ready = true; gpu.delay = () => 40; gpu.draws = 0;
  canvas = new FakeCanvas();
  canvas.content = PICTURE;
  player = new Player(canvas as unknown as HTMLCanvasElement, pool, () => {}, (e) => { throw e; });
  // the sampler, registered before anything the player asks for: what the canvas shows on each animation frame
  samples = [];
  const sample = () => { samples.push([performance.now() / 1000, canvas.content]); requestAnimationFrame(sample); };
  requestAnimationFrame(sample);
});
afterEach(() => {
  player.pause();
  vi.useRealTimers();
  delete (globalThis as { document?: unknown }).document;
});

describe('player: the flash guard on what is painted, and when', () => {
  it('reported: a paused frame painted without its light (GPU not ready), then an 8x shuttle with draws of 30 to 60 ms: at most three rises on screen in any second, a third of a second apart', async () => {
    const doc = proofDoc();
    const rnd = prng(11);
    gpu.ready = false;
    player.setDoc(doc); // the paused frame 0 (a flash start) is drawn while the GPU pass is not ready: no light on screen
    await advance(300);
    expect(canvas.content).toBe(PICTURE);
    gpu.ready = true;
    gpu.delay = () => 30 + 30 * rnd();
    const from = samples.length;
    shuttle(8);
    await advance(8000);
    const r = rises(samples.slice(from - 1));
    expect(r.length, 'it keeps flashing').toBeGreaterThanOrEqual(12);
    expect(mostInOneSecond(r)).toBeLessThanOrEqual(3);
    expect(closest(r)).toBeGreaterThanOrEqual(SCREEN_FLASH_GAP - 1e-6);
    expect(Number(canvas.dataset.flashesHeld)).toBeGreaterThan(0);
  });

  it('draws that finish 100 to 300 ms after the decision, mixed with fast ones, forwards and backwards: at most three rises on screen in any second, a third of a second apart', async () => {
    const doc = proofDoc();
    player.setDoc(doc);
    for (const [speed, from] of [[8, 0], [-8, 14_000], [4, 3000]] as const) {
      const rnd = prng(speed + 100);
      gpu.delay = () => (rnd() < 0.6 ? 10 + 20 * rnd() : 100 + 200 * rnd());
      player.seek(from);
      await advance(1000);
      const start = samples.length;
      shuttle(speed);
      await advance(12_000);
      player.pause();
      await advance(500);
      const r = rises(samples.slice(start - 1));
      expect(r.length, `${speed}x: it keeps flashing`).toBeGreaterThanOrEqual(10);
      expect(mostInOneSecond(r), `${speed}x`).toBeLessThanOrEqual(3);
      expect(closest(r), `${speed}x`).toBeGreaterThanOrEqual(SCREEN_FLASH_GAP - 1e-6);
    }
  }, 60_000);

  it('pause and resume, seeks and edits during a shuttle, with slow draws: at most three rises on screen in any second, a third of a second apart', async () => {
    const doc = proofDoc();
    const media = doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.type === 'media')!;
    const moved = tx(doc, [{ op: 'update_effect', args: { clipId: media.id, effectId: media.effects![0]!.id, params: { amount: 0.6 } } }]).doc;
    const rnd = prng(7);
    gpu.delay = () => 20 + 230 * rnd();
    player.setDoc(doc);
    await advance(400);
    const start = samples.length;
    for (let k = 0; k < 24; k++) {
      const step = Math.floor(rnd() * 5);
      if (step === 0) player.pause();
      else if (step === 1) player.seek(Math.floor(rnd() * 14_000));
      else if (step === 2) player.setDoc(k % 2 ? doc : moved); // an edit: playback goes on from the same frame at the same speed
      else shuttle([8, -8, 4, 2, -4][Math.floor(rnd() * 5)]!);
      await advance(200 + 600 * rnd());
    }
    const r = rises(samples.slice(start - 1));
    expect(r.length).toBeGreaterThanOrEqual(6);
    expect(mostInOneSecond(r)).toBeLessThanOrEqual(3);
    expect(closest(r)).toBeGreaterThanOrEqual(SCREEN_FLASH_GAP - 1e-6);
  }, 60_000);
});
