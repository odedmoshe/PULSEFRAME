import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, DEFAULT_TEXT_ANIMATION, findClip, OpError, type OpCall, type ProjectDocument, type TextAnimation } from '@pulseframe/core';
import { fitTextAnimation, framesRoom } from './textAnimation.fit.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `t${n++}_`, actor: 'test' });

/** A title of `frames` frames, driven the way the panel drives it: read the clip, fit the change, send the op. */
function title(frames: number) {
  const r = tx(createProject({ id: 'prj_t', name: 'T', frameRate: R }), [{ op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(frames) } }]);
  const clipId = r.results[0]!.output!.clipId as string;
  let doc = r.doc;
  const clip = () => { const c = findClip(doc, clipId)!.clip; if (c.type !== 'text') throw new Error('not a title'); return c; };
  const now = (): TextAnimation => clip().animation ?? DEFAULT_TEXT_ANIMATION;
  const total = () => T.frameIndexAt(clip().duration, doc.settings.frameRate);
  const send = (animation: Partial<TextAnimation>) => { doc = tx(doc, [{ op: 'set_text_animation', args: { clipId, animation } }]).doc; };
  return {
    clipId, now, total, stored: () => clip().animation,
    /** What the panel does for a change: returns whether a length was shortened; throws if the op still refuses. */
    change(patch: Partial<TextAnimation>) {
      const fit = fitTextAnimation(now(), patch, total());
      if (Object.keys(fit.patch).length) send(fit.patch);
      return fit;
    },
    /** What the panel did before: the bare patch. */
    raw: send,
  };
}
const refusal = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof OpError ? e.code : `other: ${e}`; } return 'ok'; };

describe('text animation on a short title', () => {
  it('the bare patch is refused on a title shorter than the default lengths (the reported defect)', () => {
    expect(refusal(() => title(15).raw({ in: 'fade' }))).toBe('out_of_bounds'); // default entrance: 20 frames
    expect(refusal(() => title(14).raw({ out: 'fade' }))).toBe('out_of_bounds'); // default exit: 15 frames
    const t = title(15);
    t.raw({ inFrames: 8 }); // accepted, but a title without animation stores nothing, so this does not help
    expect(t.stored()).toBeUndefined();
  });

  it('turning on an entrance or an exit shortens the default length to the title', () => {
    const a = title(15);
    expect(a.change({ in: 'fade' }).shortened).toBe(true);
    expect(a.stored()).toMatchObject({ in: 'fade', inFrames: 15, out: null });
    const d = title(14);
    expect(d.change({ out: 'fade' }).shortened).toBe(true);
    expect(d.stored()).toMatchObject({ out: 'fade', outFrames: 14, in: null });
    const one = title(1);
    one.change({ in: 'typewriter' });
    expect(one.stored()).toMatchObject({ in: 'typewriter', inFrames: 1 });
  });

  it('the side being turned on takes the room the other side leaves', () => {
    const t = title(15);
    expect(t.change({ out: 'fade' }).shortened).toBe(false); // 15 frames fit exactly
    t.change({ outFrames: 3 });
    const fit = t.change({ in: 'fade' });
    expect(fit.shortened).toBe(true);
    expect(fit.frames).toEqual({ inFrames: 12, outFrames: 3 });
    expect(t.stored()).toMatchObject({ in: 'fade', inFrames: 12, out: 'fade', outFrames: 3 });
  });

  it('when the other side leaves no room it gives up just enough for one frame', () => {
    const t = title(15);
    t.change({ out: 'fade' }); // the exit fills the title
    const fit = t.change({ in: 'pop' });
    expect(fit.frames).toEqual({ inFrames: 1, outFrames: 14 });
    expect(t.stored()).toMatchObject({ in: 'pop', inFrames: 1, out: 'fade', outFrames: 14 });
  });

  it('a one-frame title cannot hold both; the op refuses and nothing is stored for the second side', () => {
    const t = title(1);
    t.change({ in: 'fade' });
    expect(refusal(() => t.change({ out: 'fade' }))).toBe('out_of_bounds');
    expect(t.stored()).toMatchObject({ in: 'fade', inFrames: 1, out: null });
  });

  it('a long title is left alone: the patch goes out as it is', () => {
    const t = title(60);
    const patch = { in: 'fade' as const };
    const fit = fitTextAnimation(t.now(), patch, t.total());
    expect(fit.patch).toBe(patch);
    expect(fit.shortened).toBe(false);
    t.change(patch);
    expect(t.stored()).toMatchObject({ in: 'fade', inFrames: 20 });
    expect(t.change({ loop: 'wave' }).shortened).toBe(false);
    expect(t.change({ by: 'letter' }).shortened).toBe(false);
  });
});

describe('typing a length', () => {
  it('a length longer than the title is shortened to what fits instead of being refused', () => {
    const t = title(60);
    t.change({ in: 'fade' });
    expect(refusal(() => title(60).raw({ in: 'fade', inFrames: 90 }))).toBe('out_of_bounds'); // what typing 90 used to send
    const fit = t.change({ inFrames: 90 });
    expect(fit.shortened).toBe(true);
    expect(fit.patch).toEqual({ inFrames: 60 });
    expect(t.stored()).toMatchObject({ inFrames: 60 });
    // typing it again changes nothing: there is nothing to send, and the field goes back to the stored 60
    const again = fitTextAnimation(t.now(), { inFrames: 90 }, t.total());
    expect(again.patch).toEqual({});
    expect(again.shortened).toBe(true);
    expect(again.frames.inFrames).toBe(60);
  });

  it('the typed side takes the room; the other side keeps its length', () => {
    const t = title(60);
    t.change({ in: 'fade' });
    t.change({ out: 'sink' });
    expect(t.stored()).toMatchObject({ inFrames: 20, outFrames: 15 });
    expect(t.change({ inFrames: 90 }).frames).toEqual({ inFrames: 45, outFrames: 15 });
    expect(t.change({ outFrames: 600 }).frames).toEqual({ inFrames: 45, outFrames: 15 });
    expect(t.change({ inFrames: 10 }).shortened).toBe(false);
    expect(t.change({ outFrames: 600 }).frames).toEqual({ inFrames: 10, outFrames: 50 });
    expect(t.stored()).toMatchObject({ inFrames: 10, outFrames: 50 });
  });

  it('framesRoom is the most a side can take, and at least one frame', () => {
    const base: TextAnimation = { ...DEFAULT_TEXT_ANIMATION, in: 'fade', out: 'fade', inFrames: 20, outFrames: 15 };
    expect(framesRoom(base, 'inFrames', 60)).toBe(45);
    expect(framesRoom(base, 'outFrames', 60)).toBe(40);
    expect(framesRoom({ ...base, out: null }, 'inFrames', 60)).toBe(60); // an exit that is off takes no room
    expect(framesRoom(base, 'inFrames', 15)).toBe(1);
    expect(framesRoom(base, 'inFrames', 0)).toBe(1);
  });
});
