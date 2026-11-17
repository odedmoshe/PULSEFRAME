/**
 * The strobe's safety rule on the SCREEN, in real time: never more than three flash starts in any one second, however
 * the preview moves through the timeline (reported by a skeptic: shuttle at 2x–8x showed 6–12 starts a second; loop
 * wraps and edits during playback were never checked against what was already shown).
 *
 * A simulated player draws frames the way apps/web/src/player.ts does (normal playback, shuttle at any speed and
 * direction, loop, an edit that re-plans the schedule mid-play, paint lateness), sends each graph through FlashGuard
 * with the real time of drawing, and measures the light the strobe pass would add (GPU_EFFECTS['light.strobe'].params)
 * and the light a light transition adds (film-burn, light-leak: the envelope on its incoming layer, ADR-0012).
 * A flash on screen is a rise and a fall of that light, counted here independently of the guard's own bookkeeping: a
 * rise starts when the light goes more than 0.02 above its lowest since the last fall (so a slow rise over many frames
 * counts too), a fall when it goes more than 0.02 below its highest since the rise. A fade played backwards (a rise over
 * several frames, then a drop) is one flash, as is the instant rise of a flash played forwards.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { flashSchedule } from './strobeSchedule.ts';
import { evaluate, GPU_EFFECTS, type RenderGraph } from './index.ts';
import { FlashGuard, SCREEN_FLASH_GAP } from './strobeSchedule.ts';
const STEP = 0.02;

const R = { num: 30, den: 1 };
let seed = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `g${seed++}_`, actor: 'test' });
const RUNS = Number(process.env.STROBE_RUNS ?? 40);

function strobes(rates: number[], frames = 900, rate = R) {
  let doc = createProject({ id: 'prj_g', name: 'G', frameRate: rate });
  for (const [i, r] of rates.entries()) {
    const t = tx(doc, [{ op: 'add_text', args: { text: `S${i}`, start: T.frameTime(i * 7, rate), duration: T.frameTime(frames - i * 7, rate) } }]);
    doc = tx(t.doc, [{ op: 'add_effect', args: { clipId: t.results[0]!.output!.clipId as string, type: 'light.strobe', params: { amount: 1, rate: r } } }]).doc;
  }
  return doc;
}
const light = (g: RenderGraph) => {
  let most = 0;
  for (const l of g.layers) {
    for (const fx of ('effects' in l ? l.effects ?? [] : []))
      if (fx.type === 'light.strobe') most = Math.max(most, GPU_EFFECTS['light.strobe']!.params(fx.params, { width: g.width, height: g.height, seconds: T.toSeconds(g.time), beat: null })[3]!);
    if ('transition' in l && l.transition) most = Math.max(most, l.transition.light ?? 0);
  }
  return most;
};
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const still = (k: number) => ({ kind: 'image' as const, name: `p${k}.png`, contentHash: `sha256:${String(k).repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 64, height: 64, codec: 'png', hasAlpha: false }, provenance });
/**
 * 900 frames of back-to-back stills of `clipFrames` each, every one entering with a light transition (film-burn and
 * light-leak in turn) of `clipFrames` frames; with `strobe`, a steady strobe title over all of it as well.
 */
function lights(clipFrames = 12, strobe = 0, rate = R) {
  let r = applyTransaction(createProject({ id: 'prj_l', name: 'L', frameRate: rate }), [{ op: 'import_asset', args: { asset: still(1) } }, { op: 'import_asset', args: { asset: still(2) } }], { idSeed: `g${seed++}_`, actor: 'test', allowInternal: true });
  const pics = [r.results[0]!.output!.assetId as string, r.results[1]!.output!.assetId as string];
  const ops: OpCall[] = [];
  for (let k = 0; k * clipFrames < 900; k++) ops.push({ op: 'add_clip', args: { assetId: pics[k % 2]!, start: T.frameTime(k * clipFrames, rate), duration: T.frameTime(clipFrames, rate) } });
  r = tx(r.doc, ops);
  r = tx(r.doc, r.results.map((x, k) => ({ op: 'set_transition', args: { clipId: x.output!.clipId as string, type: k % 2 ? 'light-leak' : 'film-burn', frames: clipFrames } })));
  if (!strobe) return r.doc;
  const t = tx(r.doc, [{ op: 'add_text', args: { text: 'S', start: T.frameTime(0, rate), duration: T.frameTime(900, rate) } }]);
  return tx(t.doc, [{ op: 'add_effect', args: { clipId: t.results[0]!.output!.clipId as string, type: 'light.strobe', params: { amount: 1, rate: strobe } } }]).doc;
}
/** Draw `draws` = [real time, timeline frame, document] in order through one guard; return the real times of starts on screen. */
function screen(draws: [number, number, ProjectDocument][], guard = new FlashGuard()) {
  const starts: number[] = [];
  let rising = false, low = 0, high = 0;
  for (const [now, frame, doc] of draws) {
    const shown = light(guard.apply(evaluate(doc, T.frameTime(frame, doc.settings.frameRate)), now));
    if (!rising && shown > low + STEP) { starts.push(now); rising = true; high = shown; }
    else if (rising && shown < high - STEP) { rising = false; low = shown; }
    if (rising) high = Math.max(high, shown); else low = Math.min(low, shown);
  }
  return starts;
}
const mostInOneSecond = (times: number[]) => { let most = 0; for (let i = 0, j = 0; i < times.length; i++) { while (times[i]! - times[j]! > 1) j++; most = Math.max(most, i - j + 1); } return most; };
/** A display refreshing at `hz` for `seconds`; on each refresh the player draws the frame its clock asks for (frames it cannot reach in time are skipped). */
function playback(doc: ProjectDocument, speed: number, seconds: number, hz = 60, from = 0, late: (k: number) => number = () => 0) {
  const fps = doc.settings.frameRate.num / doc.settings.frameRate.den;
  const out: [number, number, ProjectDocument][] = [];
  const last = Math.floor(900);
  for (let k = 0; k < seconds * hz; k++) {
    const t = k / hz;
    const frame = from + Math.trunc(t * speed * fps);
    if (frame < 0 || frame >= last) break;
    out.push([t + late(k), frame, doc]);
  }
  return out.filter((d, i) => i === 0 || d[1] !== out[i - 1]![1]); // a frame is drawn once, when the clock reaches it
}

describe('flash guard: what the screen shows in real time', () => {
  it('reported: shuttle at 2x, 4x and 8x, forwards and backwards, shows at most three flash starts in any second (it showed 6 to 12)', () => {
    const doc = strobes([3, 2.5]);
    for (const speed of [2, 4, 8, -2, -4, -8]) {
      const unguarded = playback(doc, speed, 6, 60, speed > 0 ? 0 : 899);
      const raw = screen(unguarded, new FlashGuard(0)); // a guard with no gap shows everything
      expect(mostInOneSecond(raw), `speed ${speed}: without the guard`).toBeGreaterThan(3); // the reported fault
      const starts = screen(unguarded);
      expect(mostInOneSecond(starts), `speed ${speed}`).toBeLessThanOrEqual(3);
      const seconds = unguarded[unguarded.length - 1]![0];
      expect(starts.length, `speed ${speed}: it still flashes, about as often as allowed`).toBeGreaterThanOrEqual(Math.floor(seconds * 2.5) - 1);
    }
  });

  it('normal playback is not changed: every scheduled start is shown, also with a frame drawn up to a third of a frame late now and then', () => {
    const doc = strobes([3, 2.5, 1.7]);
    const exact = playback(doc, 1, 20);
    const g = new FlashGuard();
    const starts = screen(exact, g);
    expect(g.leftOut).toBe(0);
    expect(mostInOneSecond(starts)).toBeLessThanOrEqual(3);
    // the schedule starts one flash every 11 frames (0.367 s); a frame up to 11 ms late cannot bring two of them within the guard's gap
    const jitter = playback(doc, 1, 20, 60, 0, (k) => ((k * 7919) % 13) / 1000 - 0.006);
    const g2 = new FlashGuard();
    expect(screen(jitter, g2).length).toBe(starts.length);
    expect(g2.leftOut).toBe(0);
  });

  it('loop: the last start before the end and the first after the wrap are kept a third of a second apart on screen', () => {
    // a 30-frame timeline whose strobe starts at frame 0 and again near the end; looped for 5 seconds
    const doc = strobes([3], 30);
    const draws: [number, number, ProjectDocument][] = [];
    for (let k = 0; k < 5 * 30; k++) draws.push([k / 30, k % 30, doc]);
    const starts = screen(draws);
    expect(mostInOneSecond(starts)).toBeLessThanOrEqual(3);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(SCREEN_FLASH_GAP - 1e-9);
  });

  it('an edit during playback that re-plans the schedule does not add a start right after one already shown', () => {
    const a = strobes([3]);
    // the same strobe moved by three frames: its starts now fall 3 frames after the old ones
    const t = a.sequences[a.mainSequenceId]!.tracks.flatMap((x) => x.clips).find((c) => c.type === 'text')!;
    const b = tx(a, [{ op: 'move_clip', args: { clipId: t.id, start: T.frameTime(3, R) } }]).doc;
    const draws: [number, number, ProjectDocument][] = [];
    for (let k = 0; k < 6 * 30; k++) draws.push([k / 30, k, k % 13 < 6 ? a : b]); // switching back and forth, as edits from an agent might
    const starts = screen(draws);
    expect(mostInOneSecond(starts)).toBeLessThanOrEqual(3);
  });

  it('rocking the playhead back and forth across one flash (one scheduled start) shows at most three flashes a second', () => {
    const doc = strobes([2]); // starts at frames 0, 15, 30, …
    const draws: [number, number, ProjectDocument][] = [];
    // 60 times a second the playhead swings between frame 29 and frame 31: across the start at frame 30 and back
    for (let k = 0; k < 120; k++) draws.push([k / 60, k % 2 === 0 ? 29 : 31, doc]);
    expect(mostInOneSecond(screen(draws, new FlashGuard(0)))).toBeGreaterThan(20); // without the guard: a flash on every swing
    expect(mostInOneSecond(screen(draws))).toBeLessThanOrEqual(3);
  });

  it('any mix: random strobes, a random walk of playback speeds, seeks and edits, at random display rates: never more than three starts on screen in a second', () => {
    fc.assert(fc.property(
      fc.array(fc.constantFrom(3, 2.9, 2.5, 2, 1.3), { minLength: 1, maxLength: 4 }),
      fc.constantFrom(30, 50, 60, 120, 144),
      fc.array(fc.record({ seconds: fc.double({ min: 0.05, max: 1.5, noNaN: true }), speed: fc.constantFrom(1, 2, 4, 8, -1, -2, -4, -8, 0.5), seek: fc.option(fc.integer({ min: 0, max: 899 })), edit: fc.boolean() }), { minLength: 1, maxLength: 12 }),
      (rates, hz, steps) => {
        const docs = [strobes(rates), strobes([...rates].reverse())];
        const draws: [number, number, ProjectDocument][] = [];
        let now = 0, frame = 0, which = 0;
        for (const s of steps) {
          if (s.seek !== null) frame = s.seek;
          if (s.edit) which = 1 - which;
          for (let k = 0; k < s.seconds * hz; k++) {
            now += 1 / hz;
            frame = Math.max(0, Math.min(899, frame + Math.round((s.speed * 30) / hz)));
            draws.push([now, frame, docs[which]!]);
          }
        }
        expect(mostInOneSecond(screen(draws))).toBeLessThanOrEqual(3);
      },
    ), { numRuns: RUNS, endOnFailure: true });
  }, 120_000);
  it('light transitions (ADR-0012): shuttle at 2x, 4x and 8x, forwards and backwards, over back-to-back film-burns and light-leaks shows at most three rises in any second', () => {
    const doc = lights(12);
    const plan = [...flashSchedule(doc).lights.values()];
    expect(plan.length).toBe(75);
    expect(plan.filter((x) => x.kept).length, 'a start every 12 frames is more than the 11-frame gap: all kept').toBe(75);
    for (const speed of [2, 4, 8, -2, -4, -8]) {
      const unguarded = playback(doc, speed, 6, 60, speed > 0 ? 0 : 899);
      expect(mostInOneSecond(screen(unguarded, new FlashGuard(0))), `speed ${speed}: without the guard`).toBeGreaterThan(3);
      const starts = screen(unguarded);
      expect(mostInOneSecond(starts), `speed ${speed}`).toBeLessThanOrEqual(3);
      expect(starts.length, `speed ${speed}: the lights still show, about as often as allowed`).toBeGreaterThanOrEqual(Math.floor(unguarded[unguarded.length - 1]![0] * 2.5) - 1);
    }
    // normal playback is not changed: every kept light rises on screen, none is held back
    const g = new FlashGuard();
    expect(screen(playback(doc, 1, 20), g).length).toBe(Math.ceil(20 * 30 / 12));
    expect(g.leftOut).toBe(0);
  });

  it('light transitions and a strobe together, in any transport: never more than three rises on screen in a second (property)', () => {
    fc.assert(fc.property(
      fc.constantFrom(8, 12, 15, 24), fc.constantFrom(0, 3, 2.5, 1.3), fc.constantFrom(30, 60, 144),
      fc.array(fc.record({ seconds: fc.double({ min: 0.05, max: 1.5, noNaN: true }), speed: fc.constantFrom(1, 2, 4, 8, -1, -2, -4, -8, 0.5), seek: fc.option(fc.integer({ min: 0, max: 899 })) }), { minLength: 1, maxLength: 10 }),
      (clipFrames, strobe, hz, steps) => {
        const doc = lights(clipFrames, strobe);
        const draws: [number, number, ProjectDocument][] = [];
        let now = 0, frame = 0;
        for (const s of steps) {
          if (s.seek !== null) frame = s.seek;
          for (let k = 0; k < s.seconds * hz; k++) { now += 1 / hz; frame = Math.max(0, Math.min(899, frame + Math.round((s.speed * 30) / hz))); draws.push([now, frame, doc]); }
        }
        expect(mostInOneSecond(screen(draws))).toBeLessThanOrEqual(3);
      },
    ), { numRuns: RUNS, endOnFailure: true });
  }, 120_000);

  it('a held rise draws no light: the copy the guard returns has the transition light at 0, the graph it was given is unchanged', () => {
    const doc = lights(12); // light starts on frames 1, 13, 25, … (film-burn of 12 frames lights from its frame 1)
    const inLight = (gr: RenderGraph) => gr.layers.map((l) => ('transition' in l && l.transition?.role === 'in' ? l.transition.light ?? 0 : 0)).reduce((a, b) => Math.max(a, b), 0);
    const g = new FlashGuard();
    expect(inLight(g.apply(evaluate(doc, T.frameTime(1, R)), 0))).toBeGreaterThan(0.02); // a rise, shown
    g.apply(evaluate(doc, T.frameTime(7, R)), 0.04); // its peak
    g.apply(evaluate(doc, T.frameTime(11, R)), 0.08); // falling
    const next = evaluate(doc, T.frameTime(14, R)); // the next light, drawn 0.1 s of real time after the first rise (shuttle)
    expect(inLight(next)).toBeGreaterThan(0.02);
    const shown = g.apply(next, 0.1);
    expect(inLight(shown)).toBe(0);
    expect(shown.layers.map((l) => l.kind)).toEqual(next.layers.map((l) => l.kind)); // the pictures are all still drawn
    expect(inLight(next)).toBeGreaterThan(0.02); // the guard copied, it did not change the graph
    expect(g.leftOut).toBe(1);
    // a third of a second after the first rise the light may rise again
    expect(inLight(g.apply(evaluate(doc, T.frameTime(26, R)), 0.34))).toBeGreaterThan(0.02);
  });
});
