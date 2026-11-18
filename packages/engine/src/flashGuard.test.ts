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
import { FLASH_SINCE } from './gpu.ts';
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
    // A shuttle that shows the light's first frame (weak) and its peak 0.04 s later times the rise from the peak, where a
    // viewer sees it: a third of a second after the first frame is then too early for the next light.
    const jump = new FlashGuard();
    jump.apply(evaluate(doc, T.frameTime(1, R)), 0);
    jump.apply(evaluate(doc, T.frameTime(6, R)), 0.04);
    jump.apply(evaluate(doc, T.frameTime(11, R)), 0.08);
    expect(inLight(jump.apply(evaluate(doc, T.frameTime(26, R)), 0.34))).toBe(0);
    expect(inLight(jump.apply(evaluate(doc, T.frameTime(27, R)), 0.38))).toBeGreaterThan(0.02);
    const g = new FlashGuard();
    expect(inLight(g.apply(evaluate(doc, T.frameTime(6, R)), 0))).toBeGreaterThan(0.02); // a rise (the light's peak), shown
    g.apply(evaluate(doc, T.frameTime(7, R)), 0.04); // falling
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

// ---------------------------------------------------------------------------------------------------------------------
// WHAT IS PAINTED, AND WHEN. The tests above give the guard the time at which a frame is drawn and assume it is on screen
// at once. In the editor a frame is drawn off screen (decoding, GPU passes: tens to hundreds of milliseconds) and then
// copied to the screen, and what it paints can differ from what the graph says (a GPU effect that is not ready draws no
// light). Recorded with the real editor on 2026-11-18 (packages/evals/src/shuttle-flash.recorded.ts, UNSAFE_START): one
// quiet run at 8x shuttle in eight where the screen rose four times in 0.9 s, because (a) the shuttle started from a paused
// frame painted without its light while the guard counted it lit, and (b) the guard timed a rise from its decision, before
// the draw, so a weak light came on screen 0.318 s after the last rise did.
//
// Below, the path every frame takes to the screen is the product's own (FlashGuard.paint, which the player and the
// effect gallery call), driven on a virtual clock. The screen is measured as gpu-proof measures it: the mean brightness of
// a picture of 127 of 255 with the strobes on it mixed in, sampled on every display refresh; a rise is more than 8 of 255
// above the lowest since the last fall. The previous use of the guard (apply when the draw begins) is replayed beside it.
// ---------------------------------------------------------------------------------------------------------------------
import { UNSAFE_START } from '../../evals/src/shuttle-flash.recorded.ts';
import type { FlashPainted } from './strobeSchedule.ts';

/** Test stand-in: a virtual clock with an event loop. Timers fire in time order; the promises they settle run before the next one, as in a browser. */
class VirtualLoop {
  t = 0;
  private q: { at: number; n: number; run: () => void }[] = [];
  private n = 0;
  at(at: number, run: () => void) { this.q.push({ at: Math.max(at, this.t), n: this.n++, run }); }
  sleep = (s: number) => new Promise<void>((r) => this.at(this.t + s, r));
  async run(until: number) {
    await settled();
    for (;;) {
      let i = -1;
      for (let k = 0; k < this.q.length; k++) if (i < 0 || this.q[k]!.at < this.q[i]!.at || (this.q[k]!.at === this.q[i]!.at && this.q[k]!.n < this.q[i]!.n)) i = k;
      if (i < 0 || this.q[i]!.at > until) break;
      const [e] = this.q.splice(i, 1);
      this.t = e!.at;
      e!.run();
      await settled();
    }
    this.t = until;
  }
}
const settled = () => new Promise<void>((r) => setImmediate(r));

/** The proof's document (gpu-proof, shuttle-flash.test.ts): a picture filling the frame with two strobes (3 and 2.5 a second, amount 0.8) and a strobing title from frame 5. */
const PICTURE = 127;
function proofDoc(amounts: [number, number] = [0.8, 0.8], frames = 14_400, title = 1) {
  const pic = { kind: 'image' as const, name: 'ramp.png', contentHash: `sha256:${'b'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 360, height: 640, codec: 'png', hasAlpha: false }, provenance };
  let r = applyTransaction(createProject({ id: 'prj_sf', name: 'SF', frameRate: R, width: 360, height: 640 }), [{ op: 'import_asset', args: { asset: pic } }], { idSeed: `g${seed++}_`, actor: 'test', allowInternal: true });
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: r.results[0]!.output!.assetId as string, start: T.rt(0, 1), duration: T.frameTime(frames, R) } }]);
  const clipId = r.results[0]!.output!.clipId as string;
  r = tx(r.doc, [{ op: 'add_effect', args: { clipId, type: 'light.strobe', params: { rate: 3, amount: amounts[0] } } }, { op: 'add_effect', args: { clipId, type: 'light.strobe', params: { rate: 2.5, amount: amounts[1] } } }]);
  r = tx(r.doc, [{ op: 'add_text', args: { text: 'FLASH', start: T.frameTime(5, R), duration: T.frameTime(frames - 5, R) } }]);
  return title ? tx(r.doc, [{ op: 'add_effect', args: { clipId: r.results[0]!.output!.clipId as string, type: 'light.strobe', params: { rate: 3, amount: title } } }]).doc : r.doc;
}
/** The mean brightness of a painted frame as gpu-proof samples it: the picture with every strobe on a picture mixed in (a title's strobe lights its letters only), none when drawing reported the strobe unavailable. */
function brightness(g: RenderGraph, painted: FlashPainted = {}) {
  let m = PICTURE;
  if (painted.unavailableEffects?.includes('light.strobe')) return m;
  for (const l of g.layers) {
    if (l.kind === 'text' || ('clipId' in l && painted.missing?.includes(l.clipId))) continue;
    for (const fx of 'effects' in l ? l.effects ?? [] : []) {
      if (fx.type !== 'light.strobe') continue;
      const [r, gr, b, light] = GPU_EFFECTS['light.strobe']!.params(fx.params, { width: g.width, height: g.height, seconds: T.toSeconds(g.time), beat: null }) as number[];
      m = m * (1 - light!) + (255 * (r! + gr! + b!) / 3) * light!;
    }
  }
  return m;
}
/** Real times at which the sampled brightness starts a rise of more than 8 of 255 (gpu-proof's measure: riseTimes in shuttle-flash.ts). */
function rises(samples: readonly (readonly [number, number])[], step = 8) {
  const out: number[] = [];
  let rising = false, low = Infinity, high = 0;
  for (const [t, v] of samples) {
    if (!rising && v > low + step) { out.push(t); rising = true; high = v; }
    else if (rising && v < high - step) { rising = false; low = v; }
    if (rising) high = Math.max(high, v); else low = Math.min(low, v);
  }
  return out;
}
const closest = (times: number[]) => Math.min(Infinity, ...times.slice(1).map((t, i) => t - times[i]!));

/**
 * The guard as it was until 2026-11-18 (commit 3db5e4f, FlashGuard.apply), restated: it followed the strongest light on
 * the frame, timed a rise from the moment it was asked, and took for granted that what it let through was painted.
 */
class GuardBefore {
  private last = -Infinity; private rising = false; private low = 0; private high = 0;
  apply(graph: RenderGraph, now: number): RenderGraph {
    const light = Math.max(0, ...graph.layers.flatMap((l) => [
      ...('effects' in l ? l.effects ?? [] : []).filter((fx) => fx.type === 'light.strobe').map((fx) => GPU_EFFECTS['light.strobe']!.params(fx.params, { width: graph.width, height: graph.height, seconds: T.toSeconds(graph.time), beat: null })[3]!),
      'transition' in l && l.transition?.light ? l.transition.light : 0,
    ]));
    let out = graph, shown = light;
    if (!this.rising && light > this.low + STEP) {
      if (now - this.last >= SCREEN_FLASH_GAP) { this.last = now; this.rising = true; this.high = light; }
      else { shown = 0; out = { ...graph, layers: graph.layers.map((l) => ({ ...l, ...('effects' in l && l.effects ? { effects: l.effects.map((fx) => (fx.type === 'light.strobe' ? { ...fx, params: { ...fx.params, [FLASH_SINCE]: Infinity } } : fx)) } : {}), ...('transition' in l && l.transition ? { transition: { ...l.transition, light: 0 } } : {}) }) as typeof l) }; }
    }
    if (this.rising) { this.high = Math.max(this.high, shown); if (shown < this.high - STEP) { this.rising = false; this.low = shown; } }
    else this.low = Math.min(this.low, shown);
    return out;
  }
}
type Path = 'paint' | 'before';
/** One frame to the screen. 'paint': the product's path. 'before': the player as it was until this fix (GuardBefore.apply when the draw begins, the screen whatever was drawn). */
async function toScreen(path: Path, guard: FlashGuard, graph: RenderGraph, io: { now: () => number; draw: (g: RenderGraph) => Promise<FlashPainted>; copy: () => void; sleep: (s: number) => Promise<void>; nextFrame: (run: () => void) => void }, before?: GuardBefore) {
  if (path === 'paint') return guard.paint(graph, io);
  const drawn = await io.draw(before!.apply(graph, io.now()));
  io.copy();
  return drawn;
}

interface Want { frame: number; doc: ProjectDocument }
/**
 * A player on a display refreshing `hz` times a second. On each refresh the screen is sampled (before anything else runs on
 * that refresh, like gpu-proof's sampler) and then the transport may ask for a frame; one pump draws the latest frame asked
 * for (frames asked for meanwhile are skipped), each draw taking `drawSeconds(k)` and reporting `painted(k)`. The screen
 * shows the last frame copied to it. Returns the samples [real time, brightness] and the guard.
 */
async function player(o: { want: (t: number, refresh: number) => Want | null; seconds: number; hz?: number; drawSeconds: (k: number) => number; painted?: (k: number) => FlashPainted; path?: Path; guard?: FlashGuard }) {
  const hz = o.hz ?? 60, loop = new VirtualLoop(), guard = o.guard ?? new FlashGuard(), path = o.path ?? 'paint', before = new GuardBefore();
  let want: Want | null = null, busy = false, k = 0, screen = PICTURE, back = PICTURE;
  const samples: [number, number][] = [];
  const pump = async () => {
    busy = true;
    while (want) {
      const w: Want = want, n = k++;
      want = null;
      await toScreen(path, guard, evaluate(w.doc, T.frameTime(w.frame, w.doc.settings.frameRate)), {
        now: () => loop.t,
        draw: async (g) => { await loop.sleep(o.drawSeconds(n)); const p = o.painted?.(n) ?? {}; back = brightness(g, p); return p; },
        copy: () => { screen = back; },
        sleep: loop.sleep,
        nextFrame: (run) => loop.at((Math.floor(loop.t * hz + 1e-9) + 1) / hz, run),
      }, before);
    }
    busy = false;
  };
  for (let r = 0; r <= o.seconds * hz; r++) loop.at(r / hz, () => { samples.push([loop.t, screen]); const w = o.want(loop.t, r); if (w) { want = w; if (!busy) void pump(); } });
  await loop.run(o.seconds);
  return { samples, guard, rises: rises(samples) };
}
/** Pseudo-random numbers in [0, 1), the same on every run. */
const prng = (s: number) => () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
/** A shuttle from `from` at `speed` times real time, starting at real time `t0` (frames from absolute elapsed time, as the player computes them). */
const shuttleFrom = (doc: ProjectDocument, from: number, speed: number, t0: number) => (t: number): Want | null => (t < t0 ? null : { frame: Math.max(0, Math.min(14_399, from + Math.trunc((t - t0) * speed * 30))), doc });

describe('flash guard: what is painted, and when it reaches the screen', () => {
  it('reported (UNSAFE_START, 2026-11-18): the recorded run replayed through the real path shows at most three rises in any second, a third of a second apart; the guard used as before shows the recorded four in 0.9 s', async () => {
    const doc = proofDoc();
    const s = UNSAFE_START;
    // Each frame came on screen by the refresh that sampled it, copied between that refresh and the one before (here: half
    // way). The pump starts the next frame as soon as it copied one (the shuttle always has a newer frame waiting), so each
    // draw took from one copy to the next. The paused frame on screen as the shuttle began was drawn (here at 0.2 s) before
    // the GPU was ready: painted without its light, as the screen showed it (127).
    const copies = s.map(([t], i) => (i === 0 ? 0.25 : (s[i - 1]![0] + t) / 2));
    const run = async (path: Path) => {
      const loop = new VirtualLoop(), guard = new FlashGuard(), before = new GuardBefore();
      let screen = PICTURE, back = PICTURE;
      const samples: [number, number][] = [];
      for (const [t] of s) loop.at(t, () => samples.push([loop.t, screen]));
      const nextRefresh = () => s.find(([t]) => t > loop.t)?.[0] ?? loop.t + 1 / 60;
      const io = (i: number) => ({
        now: () => loop.t,
        draw: async (g: RenderGraph) => { await loop.sleep(copies[i]! - (i === 0 ? 0.2 : copies[i - 1]!)); const p: FlashPainted = i === 0 ? { unavailableEffects: ['light.strobe'] } : {}; back = brightness(g, p); return p; },
        copy: () => { screen = back; },
        sleep: loop.sleep,
        nextFrame: (run: () => void) => loop.at(nextRefresh(), run),
      });
      loop.at(0.2, () => void (async () => { for (let i = 0; i < s.length; i++) await toScreen(path, guard, evaluate(doc, T.frameTime(s[i]![2], R)), io(i), before); })());
      await loop.run(s[s.length - 1]![0]);
      return { samples, guard, rises: rises(samples) };
    };
    const before = await run('before');
    // the previous use of the guard, replayed, paints what the editor painted: every sample within 1 of 255 up to 6.4 s (one
    // weak light near the end, 134 at 6.451 s, came through a decision time this reconstruction does not hit)
    const off = before.samples.filter(([t, m], i) => t !== s[i]![0] || Math.abs(m - s[i]![1]) > 1);
    expect(off.map(([t]) => t)).toEqual([6.451]);
    expect(before.rises.slice(0, 4)).toEqual([0.898, 1.102, 1.42, 1.799]);
    expect(mostInOneSecond(before.rises)).toBe(4); // the fault, reproduced
    const now = await run('paint');
    expect(mostInOneSecond(now.rises)).toBeLessThanOrEqual(3);
    expect(closest(now.rises)).toBeGreaterThanOrEqual(SCREEN_FLASH_GAP);
    expect(now.rises.length, 'it still flashes').toBeGreaterThanOrEqual(10);
  });

  it('a paused frame painted without its light (the GPU not ready yet), then a shuttle: the first lit frame is a rise on screen, and the next waits a third of a second; also from a paused frame painted with its light', async () => {
    const doc = proofDoc();
    for (const gpuAtFirst of [false, true]) {
      for (const path of ['before', 'paint'] as const) {
        // Paused on frame 0 (a flash start of the picture's strobes) at 0.1 s. At 1 s the shuttle starts at 8x, as recorded:
        // its first frame is a few frames after that flash (frame 3: light 0.11, +26 of 255 over the unlit picture), then a
        // dark one (frame 8), then the next flash start (frame 11) and on from there; draws take 30 to 60 ms.
        const rnd = prng(5), d = Array.from({ length: 200 }, () => 0.03 + 0.03 * rnd());
        let asked = -1;
        const run = await player({
          path, seconds: 4, drawSeconds: (k) => d[k % 200]!, painted: (k) => (k === 0 && !gpuAtFirst ? { unavailableEffects: ['light.strobe'] } : {}),
          want: (t, r) => {
            const w = r === 6 ? { frame: 0, doc } : t >= 1 && t < 1.06 ? { frame: 3, doc } : t >= 1.06 && t < 1.12 ? { frame: 8, doc } : shuttleFrom(doc, 11, 8, 1.12)(t);
            if (!w || w.frame === asked) return null;
            asked = w.frame;
            return w;
          },
        });
        const label = `${path}, paused frame ${gpuAtFirst ? 'with' : 'without'} its light`;
        // the guard as it was counted the paused frame lit and took frame 3 for a fall: frame 11 rose about 0.12 s after frame 3 did
        if (path === 'before') { if (!gpuAtFirst) expect(closest(run.rises), `${label}: the fault`).toBeLessThan(0.2); continue; }
        expect(mostInOneSecond(run.rises), label).toBeLessThanOrEqual(3);
        expect(closest(run.rises), label).toBeGreaterThanOrEqual(SCREEN_FLASH_GAP);
        expect(run.rises.length, label).toBeGreaterThanOrEqual(6);
        if (!gpuAtFirst) expect(run.rises[0]!, `${label}: the first rise is frame 3 coming on screen`).toBeLessThan(1.1);
      }
    }
  });

  it('draws that finish 100 to 300 ms after the decision: at most three rises on screen in any second, a third of a second apart, forwards and backwards (the guard as it was: rises 0.2 to 0.3 s apart; with fast and slow draws mixed, four in a second)', async () => {
    const doc = proofDoc();
    const slow = (seed0: number) => { const rnd = prng(seed0); return Array.from({ length: 400 }, () => 0.1 + 0.2 * rnd()); };
    const mixed = (seed0: number) => { const rnd = prng(seed0); return Array.from({ length: 400 }, () => (rnd() < 0.7 ? 0.01 + 0.02 * rnd() : 0.1 + 0.2 * rnd())); };
    for (const speed of [8, 4, 2, -8, -4]) {
      for (const seed0 of [1, 2, 3]) {
        const d = slow(seed0 * 7919 + speed);
        const now = await player({ seconds: 20, drawSeconds: (k) => d[k % 400]!, want: shuttleFrom(doc, speed > 0 ? 0 : 14_399, speed, 0) });
        const label = `${speed}x, draws ${seed0}`;
        expect(mostInOneSecond(now.rises), label).toBeLessThanOrEqual(3);
        expect(closest(now.rises), label).toBeGreaterThanOrEqual(SCREEN_FLASH_GAP);
        expect(now.rises.length, `${label}: it still flashes`).toBeGreaterThanOrEqual(10);
        expect(now.guard.longestWait, `${label}: a wait is never longer than about one draw`).toBeLessThanOrEqual(0.3 + 0.05 + 1 / 60);
      }
    }
    for (const seed0 of [1, 2, 3]) {
      const d = slow(seed0 * 7919 + 8);
      expect(closest((await player({ path: 'before', seconds: 20, drawSeconds: (k) => d[k % 400]!, want: shuttleFrom(doc, 0, 8, 0) })).rises), `the guard as it was, draws ${seed0}`).toBeLessThan(0.31);
    }
    let four = 0;
    for (const seed0 of [5, 6, 7]) {
      const d = mixed(seed0 * 7919 + 8);
      const go = (path: Path) => player({ path, seconds: 20, drawSeconds: (k) => d[k % 400]!, want: shuttleFrom(doc, 0, 8, 0) });
      const now = await go('paint');
      expect(mostInOneSecond(now.rises), `mixed draws ${seed0}`).toBeLessThanOrEqual(3);
      expect(closest(now.rises), `mixed draws ${seed0}`).toBeGreaterThanOrEqual(SCREEN_FLASH_GAP);
      if (mostInOneSecond((await go('before')).rises) > 3) four++;
    }
    expect(four, 'the guard as it was shows four rises in a second on these draws').toBeGreaterThan(0);
  }, 60_000);

  it('weak lights count (a rise of more than 8 of 255, as gpu-proof counts it): strobes that brighten the picture by 9 to 13 of 255 only, in shuttles fast enough to need the guard and with slow draws mixed in', async () => {
    for (const amounts of [[0.07, 0.07], [0.1, 0.07]] as [number, number][]) {
      const doc = proofDoc(amounts, 14_400, 0); // no title strobe: every light of this document is weak
      const lift = brightness(evaluate(doc, T.frameTime(11, R))) - PICTURE; // frame 11: a start of the first strobe (its 3 a second capped to one start every 11 frames)
      expect(lift, `${amounts}`).toBeGreaterThan(8);
      expect(lift, `${amounts}`).toBeLessThan(13);
      let early = 0;
      for (const speed of [8, -8, 4]) {
        for (const mix of ['fast', 'mixed'] as const) {
          for (const seed0 of [1, 2, 3]) {
            const rnd = prng(31 * seed0 + speed);
            const d = Array.from({ length: 400 }, () => (mix === 'fast' ? 0.01 + 0.03 * rnd() : rnd() < 0.7 ? 0.01 + 0.02 * rnd() : 0.1 + 0.2 * rnd()));
            const go = (path: Path, guard?: FlashGuard) => player({ path, ...(guard ? { guard } : {}), seconds: 20, drawSeconds: (k) => d[k % 400]!, want: shuttleFrom(doc, speed > 0 ? 0 : 14_399, speed, 0) });
            const label = `${amounts} at ${speed}x, ${mix} draws ${seed0}`;
            const now = await go('paint'), none = await go('paint', new FlashGuard(0)), before = await go('before');
            if (mix === 'fast') expect(mostInOneSecond(none.rises), `${label}: without the guard`).toBeGreaterThan(3);
            expect(mostInOneSecond(now.rises), label).toBeLessThanOrEqual(3);
            expect(closest(now.rises), label).toBeGreaterThanOrEqual(SCREEN_FLASH_GAP);
            expect(now.rises.length, `${label}: it still flashes`).toBeGreaterThanOrEqual(Math.min(10, before.rises.length));
            if (closest(before.rises) < 0.3) early++;
          }
        }
      }
      expect(early, `${amounts}: the guard as it was let weak lights on screen less than 0.3 s after the last rise`).toBeGreaterThan(0);
    }
  }, 120_000);

  it('normal playback with a schedule that keeps the rule: every scheduled start rises on screen and nothing is held, with draws of 5 to 60 ms (a copy waits at most the spread of the draws and two refreshes)', async () => {
    for (const fps of [24, 25, 30, 50, 60]) {
      const rate = { num: fps, den: 1 };
      const doc = strobes([3, 2.5, 1.7], 900, rate);
      const schedule = flashSchedule(doc);
      const starts = new Set([...schedule.shown.values()].flatMap((f) => [...f]));
      const n = [...starts].filter((f) => f < 14.9 * fps).length; // frame 0 too: the screen starts dark
      for (const hz of [60, 120]) {
        const rnd = prng(fps * hz);
        const d = Array.from({ length: 4000 }, () => 0.005 + 0.055 * rnd());
        const picture = (t: number): Want => ({ frame: Math.floor(t * fps), doc });
        // a title strobe lights only its letters: measure the guard's own light on screen here, with its own step
        const g = new FlashGuard();
        const loop = new VirtualLoop();
        let want: Want | null = null, busy = false, k = 0, lit = 0, back = 0;
        const shown: [number, number][] = [];
        const pump = async () => { busy = true; while (want) { const w: Want = want; want = null; const i = k++; await g.paint(evaluate(w.doc, T.frameTime(w.frame, rate)), { now: () => loop.t, draw: async (gr) => { await loop.sleep(d[i % 4000]!); back = light(gr); return {}; }, copy: () => { lit = back; }, sleep: loop.sleep, nextFrame: (run) => loop.at((Math.floor(loop.t * hz + 1e-9) + 1) / hz, run) }); } busy = false; };
        for (let r = 0; r <= 15 * hz; r++) loop.at(r / hz, () => { shown.push([loop.t, lit]); want = picture(loop.t); if (!busy) void pump(); });
        await loop.run(15);
        const label = `${fps} fps on a ${hz} Hz display`;
        expect(g.leftOut, label).toBe(0);
        expect(rises(shown.filter(([t]) => t < 14.9 + 0.1), STEP).filter((t) => t < 14.9 + 0.08).length, label).toBe(n);
        // A copy may wait: draws that differ by up to 55 ms can bring two scheduled rises closer on screen than the gap,
        // although the schedule keeps them further apart; and at 60 fps the schedule's 21 frames (0.35 s) are exactly the
        // least a 60 Hz display can show at least 0.334 s apart (21 refreshes), so a rise a refresh late keeps the next one
        // as late. No rise is held, and none waits longer than the spread of the draws and two refreshes.
        expect(g.longestWait, label).toBeLessThanOrEqual(0.055 + 2 / hz + 1e-3);
      }
    }
  }, 60_000);

  it('any mix, with drawing that takes time: random transports (play, shuttle at any speed, pause and resume, seeks, loop wraps, edits), draws of 5 to 300 ms, paused frames painted without their light: never more than three rises on screen in a second (property)', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.constantFrom(0.8, 0.5, 0.15, 0.07), { minLength: 2, maxLength: 2 }),
      fc.constantFrom(30, 60, 120, 144),
      fc.array(fc.record({ seconds: fc.double({ min: 0.05, max: 1.5, noNaN: true }), speed: fc.constantFrom(1, 2, 4, 8, -1, -2, -4, -8, 0.5, 0), seek: fc.option(fc.integer({ min: 0, max: 899 })), edit: fc.boolean(), gpuLate: fc.boolean() }), { minLength: 1, maxLength: 10 }),
      fc.array(fc.double({ min: 0.005, max: 0.3, noNaN: true }), { minLength: 1, maxLength: 40 }),
      async (amounts, hz, steps, draws) => {
        const docs = [proofDoc(amounts as [number, number], 900), proofDoc([amounts[1]!, amounts[0]!], 900)];
        // the transport, step by step: a speed of 0 is a pause (the paused frame is drawn again, as the player does on pause);
        // `gpuLate`: the first frame drawn in this step is painted without its strobes (the GPU not ready, a device lost)
        const plan: { from: number; to: number; speed: number; seek: number | null; doc: number; gpuLate: boolean }[] = [];
        let at = 0, which = 0;
        for (const s of steps) { if (s.edit) which = 1 - which; plan.push({ from: at, to: (at += s.seconds), speed: s.speed, seek: s.seek, doc: which, gpuLate: s.gpuLate }); }
        let frame = 0, step = -1, last = -1, lateFrom = -1;
        let k = 0;
        const run = await player({
          seconds: at, hz, drawSeconds: (n) => draws[n % draws.length]!,
          painted: (n) => (n === lateFrom ? { unavailableEffects: ['light.strobe'] } : {}),
          want: (t) => {
            const i = plan.findIndex((p) => t >= p.from && t < p.to);
            if (i < 0) return null;
            const p = plan[i]!;
            if (i !== step) { step = i; if (p.seek !== null) frame = p.seek; if (p.gpuLate) lateFrom = k; last = -1; }
            frame = ((frame + Math.round((p.speed * 30) / hz)) % 900 + 900) % 900; // a loop wraps around both ways
            if (frame === last && p.speed !== 0) return null;
            if (p.speed === 0 && last !== -1) return null;
            last = frame; k++;
            return { frame, doc: docs[p.doc]! };
          },
        });
        expect(mostInOneSecond(run.rises)).toBeLessThanOrEqual(3);
      },
    ), { numRuns: RUNS, endOnFailure: true });
  }, 600_000);
});
