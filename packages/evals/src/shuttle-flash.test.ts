/**
 * The verdict of gpu-proof's shuttle check (shuttle-flash.ts), on a recorded run and on simulated editors: no browser here.
 *
 * The document is the proof's: a picture that fills the frame with two strobes (3 and 2.5 a second) and a strobing title
 * over it from frame 5.
 *
 * RECORDED: the frames that came on screen in the proof run of 2026-11-17 that passed under load (5.7 paints a second, the
 * guard held 4 frames; .artifacts/gpu-proof/shuttle-samples.json of that run, one sample per paint). The check then called
 * it `ok`, and so it called the same paints through a guard with a gap of 0.25 s or 0.2 s, or one that lets a flash
 * through every 2 s.
 *
 * RECORDED ON 2026-11-18 (shuttle-flash.recorded.ts): the real editor and guard on a quiet machine (18.5 paints a second),
 * beside two busy loops (9.6 paints a second, the margin still reached), and a quiet run whose screen rose four times in a
 * second with the real guard.
 *
 * SIMULATED: a player shuttles at 8x and paints `paints` frames a second, each through a FlashGuard with the real time of
 * painting, as apps/web/src/player.ts does. A display refreshes 60 times a second and samples what is on it: the brightness
 * (the picture's 127 with the strobes of the painted graph mixed in, which is what the recorded run shows within 1 of 255)
 * and the frame number.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { evaluate, FlashGuard } from '@pulseframe/engine';
import {
  blockedText, childCpuSeconds, frameLight, judgeShuttle, litBrightness, MARGIN_FLASHES, MARGIN_GAPS, measureShuttle, mostInOneSecond, paintsOf,
  replayGuard, RIGHT_GAP, riseTimes, unguarded, type ShuttleSample,
} from './shuttle-flash.ts';
import { BUSY, BUSY_HELD, QUIET, QUIET_HELD, UNSAFE_START, UNSAFE_START_HELD } from './shuttle-flash.recorded.ts';

const R = { num: 30, den: 1 };
const FRAMES = 14_400, PICTURE = 127;
let seed = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `sf${seed++}_`, actor: 'test', allowInternal });
function project() {
  const picture = { kind: 'image' as const, name: 'ramp.png', contentHash: `sha256:${'b'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 360, height: 640, codec: 'png', hasAlpha: false }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' } };
  let r = tx(createProject({ id: 'prj_sf', name: 'SF', frameRate: R, width: 360, height: 640 }), [{ op: 'import_asset', args: { asset: picture } }], true);
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: r.results[0]!.output!.assetId as string, start: T.rt(0, 1), duration: T.frameTime(FRAMES, R) } }]);
  const clipId = r.results[0]!.output!.clipId as string;
  r = tx(r.doc, [{ op: 'add_effect', args: { clipId, type: 'light.strobe', params: { rate: 3, amount: 0.8 } } }, { op: 'add_effect', args: { clipId, type: 'light.strobe', params: { rate: 2.5, amount: 0.8 } } }]);
  r = tx(r.doc, [{ op: 'add_text', args: { text: 'FLASH', start: T.frameTime(5, R), duration: T.frameTime(FRAMES - 5, R) } }]);
  return tx(r.doc, [{ op: 'add_effect', args: { clipId: r.results[0]!.output!.clipId as string, type: 'light.strobe', params: { rate: 3, amount: 1 } } }]).doc;
}
const doc = project();

/** The proof run that passed under load: [real time, mean brightness, timeline frame] each time another frame came on screen. */
const RECORDED: ShuttleSample[] = [[3.796, 250, 0], [4.369, 211, 1], [4.766, 135, 5], [5.103, 127, 76], [5.417, 129, 149], [5.627, 154, 222], [5.898, 129, 281], [6.081, 127, 339], [6.284, 128, 392], [6.504, 230, 440], [6.707, 128, 492], [7.013, 154, 541], [7.219, 127, 615], [7.403, 154, 663], [7.56, 127, 703], [7.674, 127, 747], [7.812, 180, 771], [7.973, 134, 807], [8.11, 128, 843], [8.21, 127, 879], [8.318, 180, 903], [8.427, 154, 927], [8.528, 127, 955], [8.647, 127, 979], [8.764, 129, 1007], [9.227, 154, 1036], [9.348, 141, 1147], [9.477, 127, 1175], [9.611, 127, 1208], [9.729, 128, 1239], [9.833, 141, 1268], [9.96, 134, 1291], [10.055, 127, 1323], [10.144, 127, 1343], [10.286, 141, 1367], [10.419, 154, 1399], [10.584, 180, 1431], [10.711, 127, 1473], [10.883, 128, 1503], [11.064, 180, 1541], [11.147, 154, 1587], [11.228, 127, 1607], [11.313, 127, 1627], [11.405, 134, 1643], [11.506, 128, 1668]];
const RECORDED_HELD = 4;

/** What a screen shows when frames come on it at these times through this guard: the samples (one per paint) and the guard's count. */
function through(guard: FlashGuard, paints: readonly (readonly [t: number, frame: number])[]) {
  const samples = paints.map(([t, frame]): ShuttleSample => [t, litBrightness(PICTURE, frameLight(guard.apply(evaluate(doc, T.frameTime(frame, R)), t))), frame]);
  return { samples, held: guard.leftOut };
}
/**
 * A shuttle at 8x seen on a 60 Hz display. `rate(t)` is the paints a second at real time t; every paint is `jitter(k)` seconds late.
 */
function shuttle(guard: FlashGuard, rate: number | ((t: number) => number), seconds: number, jitter: (k: number) => number = uneven) {
  const painted: { at: number; mean: number; frame: number }[] = [];
  for (let k = 0, due = 0; due <= seconds; k++) {
    const at = due + jitter(k), frame = Math.trunc(at * 8 * 30);
    if (at <= seconds) painted.push({ at, frame, mean: litBrightness(PICTURE, frameLight(guard.apply(evaluate(doc, T.frameTime(frame, R)), at))) });
    due += 1 / (typeof rate === 'number' ? rate : rate(due));
  }
  const samples: ShuttleSample[] = [];
  for (let r = 0, p = -1; r / 60 <= seconds; r++) {
    while (p + 1 < painted.length && painted[p + 1]!.at <= r / 60) p++;
    if (p >= 0) samples.push([r / 60, painted[p]!.mean, painted[p]!.frame]);
  }
  return { samples, held: guard.leftOut };
}
const uneven = (k: number) => ((k * 7919) % 17) / 1000; // up to 16 ms late, never the same twice in a row
const measure = (run: { samples: ShuttleSample[] }) => measureShuttle(run.samples, doc);
const verdict = (run: { samples: ShuttleSample[]; held: number }, shown = '▶▶ ×8') => judgeShuttle(measure(run), run.held, shown);
const paintTimes = (run: readonly ShuttleSample[]) => run.map(([t, , frame]) => [t, frame] as const);
const recordedPaints = paintTimes(RECORDED);
/** The recorded runs' paint times: the slow one that passed under load (5.7 a second), a busy one (9.6) and a quiet one (18.5). */
const RECORDED_RUNS = { slow: recordedPaints, busy: paintTimes(BUSY), quiet: paintTimes(QUIET) };
/** 40 s at 5 paints a second (a busy machine), then 15 s at 15 a second. */
const slowThenFast = (t: number) => (t < 40 ? 5 : 15);

describe('shuttle check: what the screen shows without the guard and through another guard', () => {
  it('the recorded run: every frame on screen is what the document gives with its strobes mixed in (within 1 of 255), or the picture alone; the frames held, as the screen tells it, are the guard\'s count', () => {
    const m = measure({ samples: RECORDED });
    expect(m.pictureBrightness).toBe(PICTURE);
    expect(m.unexplained).toBe(0);
    for (const p of paintsOf(RECORDED, doc)) expect(Math.min(Math.abs(p.mean - PICTURE), Math.abs(p.mean - litBrightness(PICTURE, p.light))), `frame ${p.frame}`).toBeLessThanOrEqual(1);
    expect(m.heldOnScreen).toBe(RECORDED_HELD);
    // the real guard, replayed on the recorded paints, shows what the screen showed
    const replayed = through(new FlashGuard(), recordedPaints);
    expect(replayed.held).toBe(RECORDED_HELD);
    expect(measure(replayed).flashesOnScreen).toBe(m.flashesOnScreen);
    expect(m.flashesWithRightGuard).toBe(m.flashesOnScreen);
  });

  it('the rule restated in the module holds back the same frames as the product\'s guard, at the right gap and at wrong ones', () => {
    for (const run of [RECORDED, shuttle(new FlashGuard(0), 13, 12).samples, shuttle(new FlashGuard(0), 30, 6).samples]) {
      const paints = paintsOf(run, doc);
      for (const gap of [RIGHT_GAP, 0.2, 0.25, 0.3, 2]) {
        const guard = new FlashGuard(gap);
        const held = paints.map((p) => { const g = evaluate(doc, T.frameTime(p.frame, R)); return guard.apply(g, p.t) !== g; });
        expect(replayGuard(paints, gap), `gap ${gap}`).toEqual(held);
      }
      expect(RIGHT_GAP).toBe(1 / 3 + 1e-3); // the rule's third of a second and a thousandth, stated in the module
    }
    expect(unguarded(doc, 440).guard).toBeCloseTo(1, 5); // the title's strobe at full strength: the guard follows it …
    expect(litBrightness(PICTURE, unguarded(doc, 440))).toBeCloseTo(PICTURE + 0.8 * (255 - PICTURE), 0); // … the screen shows the picture's
  });
});

describe('shuttle check, objection 1: a pass must be able to tell the right guard from a wrong one', () => {
  it('the recorded slow run has no margin of need: blocked with the real guard, and never ok through a guard with a gap of 0.25 s or 0.2 s', () => {
    const m = measure({ samples: RECORDED });
    expect(m.mostInOneSecondWithoutGuard).toBeLessThan(MARGIN_FLASHES);
    expect(m.wrongGapsCaught).toEqual([]);
    expect(m.margin).toBe(false);
    expect(judgeShuttle(m, RECORDED_HELD, '▶▶ ×8')).toBe('blocked');
    for (const gap of [0.25, 0.2]) {
      const wrong = through(new FlashGuard(gap), recordedPaints);
      expect(wrong.held, `gap ${gap}`).toBeGreaterThan(0); // it holds frames, it is safe on these paints, it keeps flashing: the old check passed it
      expect(measure(wrong).mostInOneSecond, `gap ${gap}`).toBeLessThanOrEqual(3);
      expect(verdict(wrong), `gap ${gap}`).toBe('blocked');
    }
  });

  it('a guard with a gap of 0.25 s or 0.2 s, replayed on the paint times of every recorded run (5.7, 9.6 and 18.5 paints a second), is never ok; on the busy and the quiet run, where the margin was reached, it is unsafe', () => {
    for (const gap of [0.25, 0.2]) {
      for (const [name, paints] of Object.entries(RECORDED_RUNS)) {
        const v = verdict(through(new FlashGuard(gap), paints));
        expect(v, `gap ${gap}, ${name}`).not.toBe('ok');
        if (name !== 'slow') expect(v, `gap ${gap}, ${name}`).toBe('unsafe');
      }
    }
  });

  it('a guard with a gap of 0.25 s or 0.2 s is never ok at any paint rate, and unsafe once the editor paints 13 frames a second or more', () => {
    for (const gap of [0.25, 0.2]) {
      for (const paints of [5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 20, 24, 30, 45, 60]) {
        for (const seconds of [6, 20]) {
          const v = verdict(shuttle(new FlashGuard(gap), paints, seconds));
          expect(v, `gap ${gap}, ${paints} paints a second, ${seconds} s`).not.toBe('ok');
          if (paints >= 13 && seconds === 20) expect(v, `gap ${gap}, ${paints} paints a second`).toBe('unsafe');
        }
      }
      expect(verdict(shuttle(new FlashGuard(gap), slowThenFast, 55)), `gap ${gap}, slow then fast`).toBe('unsafe');
    }
  });

  it('the real guard on a quiet machine (15 to 60 paints a second, 20 s): ok, with the margin: the same paints would have shown a guard with a gap of 0.25 s or 0.2 s to be unsafe', () => {
    for (const paints of [15, 24, 30, 45, 60]) {
      const run = shuttle(new FlashGuard(), paints, 20);
      const m = measure(run);
      expect(m.mostInOneSecond, `${paints} paints a second: on screen`).toBeLessThanOrEqual(3);
      expect(m.mostInOneSecondWithoutGuard, `${paints} paints a second: without the guard`).toBeGreaterThanOrEqual(MARGIN_FLASHES);
      expect(MARGIN_GAPS).toEqual([0.25, 0.2]);
      for (const gap of [0.2, 0.25]) expect(m.wrongGuards.find((w) => w.gap === gap)!.unsafe, `${paints} paints a second: gap ${gap}`).toBe(true);
      expect(m.unexplained).toBe(0);
      expect(run.held, `${paints} paints a second`).toBeGreaterThan(0);
      expect(verdict(run), `${paints} paints a second`).toBe('ok');
    }
  });

  it('the real guard on the recorded runs with the margin (quiet, 18.5 paints a second; busy, 9.6): ok; the same busy run cut before the margin, and the slow run (5.7): blocked', () => {
    for (const [name, run, held] of [['quiet', QUIET, QUIET_HELD], ['busy', BUSY, BUSY_HELD]] as const) {
      const m = measure({ samples: run });
      expect(m.unexplained, name).toBe(0);
      expect(m.mostInOneSecondWithoutGuard, name).toBeGreaterThanOrEqual(MARGIN_FLASHES);
      expect(m.wrongGapsCaught, name).toEqual(expect.arrayContaining([0.25, 0.2]));
      expect(m.margin, name).toBe(true);
      expect(judgeShuttle(m, held, '▶▶ ×8'), name).toBe('ok');
      // the real guard replayed on the same paint times holds frames and passes too
      expect(verdict(through(new FlashGuard(), paintTimes(run))), `${name}, replayed`).toBe('ok');
    }
    // the busy run up to the moment before its margin: the guard was needed and held frames, and still nothing tells its gap
    const m = measure({ samples: BUSY });
    let cut = BUSY.length;
    while (cut > 31 && measure({ samples: BUSY.slice(0, cut - 1) }).margin) cut--;
    const before = BUSY.slice(0, cut - 1), early = measure({ samples: before });
    expect(m.margin).toBe(true);
    expect(early.margin).toBe(false);
    const heldBefore = through(new FlashGuard(), paintTimes(before)).held;
    expect(heldBefore).toBeGreaterThan(0);
    expect(judgeShuttle(early, heldBefore, '▶▶ ×8')).toBe('blocked');
    expect(judgeShuttle(measure({ samples: RECORDED }), RECORDED_HELD, '▶▶ ×8')).toBe('blocked');
  });

  it('the real guard on a slow machine that then paints fast enough for long enough (40 s at 5 paints a second, 15 s at 15): ok', () => {
    const run = shuttle(new FlashGuard(), slowThenFast, 55);
    const m = measure(run);
    expect(m.margin).toBe(true);
    expect(m.flashesOnScreen).toBeGreaterThanOrEqual(m.flashFloor);
    expect(verdict(run)).toBe('ok');
  });

  it('the recorded quiet run where the real guard let the screen rise four times in 0.9 s is unsafe, margin or not', () => {
    const m = measure({ samples: UNSAFE_START });
    expect(m.unexplained).toBe(0);
    expect(m.mostInOneSecond).toBe(4);
    expect(judgeShuttle(m, UNSAFE_START_HELD, '▶▶ ×8')).toBe('unsafe');
  });

  it('the check judges the screen, not the guard: where the real guard itself lets four flashes on screen in one second, the verdict is unsafe', () => {
    // Today that happens in this simulation at 20 and at 11 paints a second, where the paints fall in step with the strobes:
    // the guard follows the strongest strobe on the frame, the screen shows two strobes of one picture mixed, and their sum
    // rises (180 -> 211 of 255) between two flashes the guard let through, 0.15 s after the last. A weakness of the product,
    // reported with this repair and not this test's to decide: the test holds whether or not the product still does it.
    for (const paints of [11, 20]) {
      const run = shuttle(new FlashGuard(), paints, 20);
      if (measure(run).mostInOneSecond > 3) expect(verdict(run), `${paints} paints a second`).toBe('unsafe');
      else expect(['ok', 'blocked'], `${paints} paints a second`).toContain(verdict(run));
    }
    // a screen that shows a fourth flash inside a second is unsafe whatever else holds
    const ok = shuttle(new FlashGuard(), 30, 20);
    const flash = ok.samples.findIndex(([, m], i) => i > 60 && m > PICTURE + 60);
    const extra = ok.samples.map(([t, m, f], i): ShuttleSample => [t, i > flash + 6 && i <= flash + 9 ? PICTURE + 80 : m, f]); // a flash 0.1 s after one the guard let through
    expect(measure({ samples: extra }).mostInOneSecond).toBeGreaterThan(3);
    expect(verdict({ samples: extra, held: ok.held })).toBe('unsafe');
  });

  it('the real guard at the bare need (more than three in a second without it, but no margin): blocked, not ok', () => {
    let bare = 0;
    for (const paints of [9, 12]) {
      for (const seconds of [6, 10]) {
        const run = shuttle(new FlashGuard(), paints, seconds);
        const m = measure(run);
        if (!m.guardNeeded || m.margin) continue;
        bare++;
        expect(run.held, `${paints} paints a second, ${seconds} s`).toBeGreaterThan(0);
        expect(verdict(run), `${paints} paints a second, ${seconds} s`).toBe('blocked');
      }
    }
    expect(bare).toBeGreaterThanOrEqual(2); // such runs exist: the guard needed and holding, and still nothing shown about its gap
  });
});

describe('shuttle check, objection 2: "keeps flashing" scales with the window', () => {
  it('a guard that lets a flash through every 2 s or every 10 s is never ok: not on the recorded slow run, not on a slow machine, not on a quiet one', () => {
    for (const gap of [2, 10]) {
      for (const [name, paints] of Object.entries(RECORDED_RUNS)) expect(verdict(through(new FlashGuard(gap), paints)), `gap ${gap}, recorded ${name}`).not.toBe('ok');
      expect(verdict(shuttle(new FlashGuard(gap), slowThenFast, 55)), `gap ${gap}, slow then fast`).toBe('not-flashing');
      expect(verdict(shuttle(new FlashGuard(gap), 5, 55)), `gap ${gap}, 5 paints a second`).toBe('not-flashing');
      for (const paints of [13, 30]) expect(verdict(shuttle(new FlashGuard(gap), paints, 20)), `gap ${gap}, ${paints} paints a second`).toBe('not-flashing');
    }
    // the same slow paints with the real guard are not called "not flashing": they are blocked (too few paints), as before
    expect(verdict(shuttle(new FlashGuard(), 5, 55))).toBe('blocked');
  });

  it('the floor for a pass grows with the window: 1 + 0.6 flashes a second and never under three; a guard with a gap of 2 s or more fails it in any window', () => {
    const ok = shuttle(new FlashGuard(), 30, 20);
    const m = measure(ok);
    expect(verdict(ok)).toBe('ok');
    expect(m.flashFloor).toBe(13); // 1 + 0.6 x 20 s
    expect(measure(shuttle(new FlashGuard(), 30, 2.6)).flashFloor).toBe(3);
    expect(measure(shuttle(new FlashGuard(), slowThenFast, 55)).flashFloor).toBe(34);
    // a guard with a gap of g lets through at most 1 + window/g flashes: under the floor for g = 2 s at every window
    for (let w = 1; w <= 60; w += 0.5) expect(1 + Math.floor(w / 2), `${w} s`).toBeLessThan(measure(shuttle(new FlashGuard(), 30, w)).flashFloor);
    // the same run with fewer flashes on screen than the floor, though more than half of what the right guard lets through
    expect(judgeShuttle({ ...m, flashesOnScreen: m.flashFloor, flashesWithRightGuard: 2 * m.flashFloor }, ok.held, '▶▶ ×8')).toBe('ok');
    expect(judgeShuttle({ ...m, flashesOnScreen: m.flashFloor - 1, flashesWithRightGuard: 2 * m.flashFloor - 2 }, ok.held, '▶▶ ×8')).toBe('not-flashing');
    expect(judgeShuttle({ ...m, windowSeconds: 55, flashFloor: 33, flashesOnScreen: 3, flashesWithRightGuard: 3 }, ok.held, '▶▶ ×8')).toBe('not-flashing');
  });
});

describe('shuttle check, objection 3: blocked says what was measured, not why', () => {
  it('the words give the paint rate and what the paints lacked; they name no cause', () => {
    const slow = measure(shuttle(new FlashGuard(), 5, 30));
    const text = blockedText(slow, 30, 3);
    expect(text).toMatch(/^blocked, not a pass: too few paints for the guard to be needed \(\d+(\.\d+)? paints a second\) in 30 s at 8x: /);
    const bare = measure({ samples: shuttle(new FlashGuard(), 9, 10).samples });
    expect(bare.guardNeeded && !bare.margin).toBe(true);
    expect(blockedText(bare, 10, 2)).toMatch(/^blocked, not a pass: too few paints for the guard to be needed with a margin \(/);
    for (const t of [text, blockedText(bare, 10, 2)]) expect(t).not.toMatch(/load|quiet|busy|machine|slow/i);
  });
  it('the CPU time of this process\'s children is a number that does not go down (or null where /proc is not there)', () => {
    const a = childCpuSeconds(), b = childCpuSeconds();
    if (a === null) expect(b).toBeNull(); else { expect(a).toBeGreaterThanOrEqual(0); expect(b!).toBeGreaterThanOrEqual(a); }
  });
});

describe('shuttle check: the verdict, as before', () => {
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
    for (const paints of [15, 30, 60]) expect(verdict(shuttle(new FlashGuard(0), paints, 6)), `${paints} paints a second`).toBe('unsafe');
  });

  it('a guard that works but whose count of held frames is not reported (0, or no number at all) is guard-idle, not ok', () => {
    const run = shuttle(new FlashGuard(), 30, 20);
    expect(verdict(run)).toBe('ok');
    expect(verdict({ ...run, held: 0 })).toBe('guard-idle');
    expect(verdict({ ...run, held: Number(null) })).toBe('guard-idle');
    expect(verdict({ ...run, held: Number(undefined) })).toBe('guard-idle'); // NaN: the attribute is not written any more
  });

  it('an editor that paints 6 frames a second or fewer cannot show more than three flashes a second: blocked, with or without the guard', () => {
    for (const paints of [2, 3, 4, 5, 6]) {
      for (const guard of [new FlashGuard(), new FlashGuard(0)]) {
        const run = shuttle(guard, paints, 30);
        const m = measure(run);
        expect(m.mostInOneSecondWithoutGuard, `${paints} paints a second`).toBeLessThanOrEqual(3);
        expect(m.guardNeeded).toBe(false);
        expect(verdict(run), `${paints} paints a second`).toBe('blocked');
      }
    }
  });

  it('a held frame alone is not enough: when the guard was not needed the verdict stays blocked whatever the counter says', () => {
    const run = shuttle(new FlashGuard(), 5, 10);
    expect(verdict({ ...run, held: 7 })).toBe('blocked');
  });

  it('not at 8x, too few samples, or a screen that is not what the document gives: not measured; a preview that shows no flash at all: not flashing', () => {
    const run = shuttle(new FlashGuard(), 30, 20);
    expect(verdict(run, '▶▶ ×4')).toBe('not-measured');
    expect(verdict(run, '')).toBe('not-measured');
    expect(verdict({ samples: run.samples.slice(0, 20), held: run.held })).toBe('not-measured');
    // every frame 40 of 255 brighter than the document gives it, lit or not: neither the lit picture nor the picture alone
    const lit = paintsOf(run.samples, doc).filter((p) => litBrightness(PICTURE, p.light) - PICTURE > 8).map((p) => p.frame);
    const off = { samples: run.samples.map(([t, m, f]) => [t, lit.includes(f) && m > PICTURE + 8 ? m - 40 : m, f] as ShuttleSample), held: run.held };
    expect(measure(off).unexplained).toBeGreaterThan(measure(off).paints / 20);
    expect(verdict(off)).toBe('not-measured');
    // the frames move (and would flash without a guard) but the picture stays as it is: the preview shows no flash at all
    expect(verdict({ samples: run.samples.map(([t, , f]) => [t, PICTURE, f] as ShuttleSample), held: run.held })).toBe('not-flashing');
  });

  it('rises: the first value is no rise, a slow rise counts once, a rise needs a fall before the next', () => {
    expect(riseTimes([[0, 200], [1, 200], [2, 100], [3, 200]], 8)).toEqual([3]);
    expect(riseTimes([[0, 0], [1, 5], [2, 10], [3, 15], [4, 20]], 8)).toEqual([2]);
    expect(riseTimes([[0, 0], [1, 50], [2, 100], [3, 95], [4, 150]], 8)).toEqual([1]);
    expect(riseTimes([[0, 0], [1, 50], [2, 10], [3, 60]], 8)).toEqual([1, 3]);
    expect(mostInOneSecond([0, 0.4, 0.8, 1.0, 1.5])).toBe(4);
    expect(mostInOneSecond([0, 0.4, 0.8, 1.01])).toBe(3);
    expect(mostInOneSecond([0, 0.3, 0.6, 0.96], 0.95)).toBe(3);
    expect(mostInOneSecond([0, 0.3, 0.6, 0.94], 0.95)).toBe(4);
  });
});
