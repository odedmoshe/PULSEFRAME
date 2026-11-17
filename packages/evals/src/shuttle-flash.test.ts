/**
 * The verdict of gpu-proof's shuttle check (shuttle-flash.ts), on simulated editors: no browser here.
 *
 * A simulated player shuttles at 8x through three strobes (3, 2.5 and 3 a second, the third starting 5 frames later, as the
 * proof's project) and paints `paints` frames a second, each through a FlashGuard with the real time of painting, as
 * apps/web/src/player.ts does. A simulated display refreshes 60 times a second and samples what is on it: the brightness
 * (a grey picture plus the light the painted graph adds) and the frame number.
 *
 * What must hold: a working guard on an editor that paints fast enough is `ok`; the guard switched off (new FlashGuard(0))
 * is never `ok` at any paint rate; a guard that works but whose counter is not reported is `guard-idle`; an editor that
 * paints too slowly for the guard to be needed is `blocked`, with or without the guard: never a pass.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { evaluate, FlashGuard } from '@pulseframe/engine';
import { graphLight, judgeShuttle, measureShuttle, mostInOneSecond, riseTimes, type ShuttleSample } from './shuttle-flash.ts';

const R = { num: 30, den: 1 };
let seed = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `sf${seed++}_`, actor: 'test' });
function project(frames = 7200) {
  let doc = createProject({ id: 'prj_sf', name: 'SF', frameRate: R });
  for (const [rate, from] of [[3, 0], [2.5, 0], [3, 5]] as const) {
    const t = tx(doc, [{ op: 'add_text', args: { text: 'S', start: T.frameTime(from, R), duration: T.frameTime(frames - from, R) } }]);
    doc = tx(t.doc, [{ op: 'add_effect', args: { clipId: t.results[0]!.output!.clipId as string, type: 'light.strobe', params: { amount: 0.8, rate } } }]).doc;
  }
  return doc;
}
const doc = project();

/**
 * `seconds` of shuttle at 8x with `paints` paints a second (every paint `jitter(k)` seconds late), seen on a 60 Hz display.
 * Returns the display's samples and the guard's count of held frames.
 */
function shuttle(guard: FlashGuard, paints: number, seconds: number, jitter: (k: number) => number = () => 0) {
  const painted: { at: number; frame: number; light: number }[] = [];
  for (let k = 0; ; k++) {
    const at = k / paints + jitter(k);
    if (at > seconds) break;
    const frame = Math.trunc(at * 8 * 30);
    painted.push({ at, frame, light: graphLight(guard.apply(evaluate(doc, T.frameTime(frame, R)), at)) });
  }
  const samples: ShuttleSample[] = [];
  for (let r = 0, p = -1; r / 60 <= seconds; r++) {
    while (p + 1 < painted.length && painted[p + 1]!.at <= r / 60) p++;
    if (p >= 0) samples.push([r / 60, 100 + 150 * painted[p]!.light, painted[p]!.frame]);
  }
  return { samples, held: guard.leftOut };
}
const verdict = (run: { samples: ShuttleSample[]; held: number }, shown = '▶▶ ×8') => judgeShuttle(measureShuttle(run.samples, doc), run.held, shown);
const uneven = (k: number) => ((k * 7919) % 17) / 1000; // up to 16 ms late, never the same twice in a row

describe('shuttle check: the verdict', () => {
  it('a working guard on an editor that paints 12 to 60 frames a second: safe on screen, needed, and it held frames back', () => {
    for (const paints of [12, 15, 24, 30, 60]) {
      const run = shuttle(new FlashGuard(), paints, 4, uneven);
      const m = measureShuttle(run.samples, doc);
      expect(m.mostInOneSecond, `${paints} paints a second: on screen`).toBeLessThanOrEqual(3);
      expect(m.mostInOneSecondWithoutGuard, `${paints} paints a second: without the guard`).toBeGreaterThan(3);
      expect(run.held, `${paints} paints a second`).toBeGreaterThan(0);
      expect(verdict(run), `${paints} paints a second`).toBe('ok');
    }
  });

  it('the guard switched off (new FlashGuard(0)) is never ok: unsafe when the editor paints fast, blocked when it paints slowly', () => {
    for (const paints of [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 24, 30, 45, 60]) {
      for (const jitter of [() => 0, uneven]) {
        const run = shuttle(new FlashGuard(0), paints, 6, jitter);
        expect(run.held).toBe(0);
        const v = verdict(run);
        expect(v, `${paints} paints a second`).not.toBe('ok');
        expect(['unsafe', 'blocked'], `${paints} paints a second`).toContain(v);
      }
    }
    for (const paints of [15, 30, 60]) expect(verdict(shuttle(new FlashGuard(0), paints, 6, uneven)), `${paints} paints a second`).toBe('unsafe');
  });

  it('a guard that works but whose count of held frames is not reported (0, or no number at all) is guard-idle, not ok', () => {
    const run = shuttle(new FlashGuard(), 30, 4, uneven);
    expect(verdict(run)).toBe('ok');
    expect(verdict({ ...run, held: 0 })).toBe('guard-idle');
    expect(verdict({ ...run, held: Number(null) })).toBe('guard-idle');
    expect(verdict({ ...run, held: Number(undefined) })).toBe('guard-idle'); // NaN: the attribute is not written any more
  });

  it('an editor that paints 6 frames a second or fewer cannot show more than three flashes a second: blocked, with or without the guard', () => {
    for (const paints of [2, 3, 4, 5, 6]) {
      for (const guard of [new FlashGuard(), new FlashGuard(0)]) {
        const run = shuttle(guard, paints, 30, uneven);
        const m = measureShuttle(run.samples, doc);
        expect(m.mostInOneSecondWithoutGuard, `${paints} paints a second`).toBeLessThanOrEqual(3);
        expect(m.guardNeeded).toBe(false);
        expect(verdict(run), `${paints} paints a second`).toBe('blocked');
      }
    }
  });

  it('a held frame alone is not enough: when the guard was not needed the verdict stays blocked whatever the counter says', () => {
    const run = shuttle(new FlashGuard(), 5, 10, uneven);
    expect(verdict({ ...run, held: 7 })).toBe('blocked');
  });

  it('not at 8x, too few samples or a preview that does not flash: not measured', () => {
    const run = shuttle(new FlashGuard(), 30, 4, uneven);
    expect(verdict(run, '▶▶ ×4')).toBe('not-measured');
    expect(verdict(run, '')).toBe('not-measured');
    expect(verdict({ samples: run.samples.slice(0, 20), held: run.held })).toBe('not-measured');
    // the frames move (and would flash without a guard) but the picture stays grey: the preview shows no flash at all
    expect(verdict({ samples: run.samples.map(([t, , f]) => [t, 100, f] as ShuttleSample), held: run.held })).toBe('not-measured');
  });

  it('rises: the first value is no rise, a slow rise counts once, a rise needs a fall before the next', () => {
    expect(riseTimes([[0, 200], [1, 200], [2, 100], [3, 200]], 8)).toEqual([3]);
    expect(riseTimes([[0, 0], [1, 5], [2, 10], [3, 15], [4, 20]], 8)).toEqual([2]);
    expect(riseTimes([[0, 0], [1, 50], [2, 100], [3, 95], [4, 150]], 8)).toEqual([1]);
    expect(riseTimes([[0, 0], [1, 50], [2, 10], [3, 60]], 8)).toEqual([1, 3]);
    expect(mostInOneSecond([0, 0.4, 0.8, 1.0, 1.5])).toBe(4);
    expect(mostInOneSecond([0, 0.4, 0.8, 1.01])).toBe(3);
  });
});
