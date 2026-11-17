import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, COLOR_LOOKS, createProject, findClip, OpError, projectVariant, TRANSITIONS, type Clip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { DEFAULT_TRANSITION_FRAMES, isOn, pickCall, pickRefusal, thumbSize, transitionLength, transitionRoom } from './gallery.pick.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `g${n++}_`, actor: 'test', allowInternal });
const video = (c: string) => ({
  kind: 'video' as const, name: `${c}.mp4`, contentHash: `sha256:${c.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(5, 1),
  video: { width: 1920, height: 1080, frameRate: R, codec: 'h264', rotation: 0, frameCount: 150 },
  provenance: { origin: 'fixture' as const, importedAt: '2026-11-16T00:00:00Z', importedBy: 'test' },
});
/** Two whole five-second video files back to back on the first video track. */
function project() {
  let r = tx(createProject({ id: 'prj_g', name: 'G', width: 1920, height: 1080, frameRate: R }), [{ op: 'import_asset', args: { asset: video('a') } }, { op: 'import_asset', args: { asset: video('b') } }], true);
  const [a, b] = r.results.map((x) => x.output!.assetId as string);
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: a, start: f(0), duration: f(150), withLinkedAudio: false } }, { op: 'add_clip', args: { assetId: b, start: f(150), duration: f(150), withLinkedAudio: false } }]);
  const [first, second] = r.results.map((x) => x.output!.clipId as string);
  return { doc: r.doc, first: first!, second: second! };
}
const clipOf = (d: ProjectDocument, id: string): Clip => findClip(d, id)!.clip;
const effectsOf = (d: ProjectDocument, id: string) => { const c = clipOf(d, id); return c.type === 'caption' ? [] : c.effects ?? []; };

describe('gallery picks', () => {
  it('an effect tile adds its effect once: picking a tile that is already on the clip commits nothing', () => {
    const p = project();
    const tile = { kind: 'effect' as const, id: 'color.sepia' };
    expect(isOn(clipOf(p.doc, p.first), tile)).toBe(false);
    const call = pickCall(clipOf(p.doc, p.first), tile);
    expect(call).toEqual({ op: 'add_effect', args: { clipId: p.first, type: 'color.sepia' } });
    const doc = tx(p.doc, [call!]).doc;
    expect(isOn(clipOf(doc, p.first), tile)).toBe(true);
    expect(pickCall(clipOf(doc, p.first), tile)).toBeNull(); // the second activation (and the second half of a double-click)
    expect(effectsOf(doc, p.first).filter((e) => e.type === 'color.sepia').length).toBe(1);
    // another effect is still offered, and the other clip is not affected
    expect(pickCall(clipOf(doc, p.first), { kind: 'effect', id: 'color.invert' })).not.toBeNull();
    expect(pickCall(clipOf(doc, p.second), tile)).not.toBeNull();
    // what used to happen: the op itself accepts a second copy, so the tile must not send it
    expect(effectsOf(tx(doc, [call!]).doc, p.first).filter((e) => e.type === 'color.sepia').length).toBe(2);
  });

  it('looks, transitions, motions and text styles replace what the clip has, so a pressed tile still commits its op', () => {
    const p = project();
    const look = COLOR_LOOKS[0]!;
    const doc = tx(p.doc, [pickCall(clipOf(p.doc, p.first), { kind: 'look', id: look.id })!]).doc;
    expect(isOn(clipOf(doc, p.first), { kind: 'look', id: look.id })).toBe(true);
    const again = tx(doc, [pickCall(clipOf(doc, p.first), { kind: 'look', id: look.id })!]).doc;
    expect(effectsOf(again, p.first).filter((e) => e.type === 'color.grade').length).toBe(1);
    expect(pickCall(clipOf(doc, p.first), { kind: 'motion', id: 'm' })).toEqual({ op: 'apply_motion_preset', args: { clipId: p.first, presetId: 'm' } });
    expect(pickCall(clipOf(doc, p.first), { kind: 'text', id: 't' })).toEqual({ op: 'apply_text_preset', args: { clipId: p.first, presetId: 't' } });
    expect(isOn(clipOf(doc, p.first), { kind: 'look', id: 'no-such-look' })).toBe(false);
  });

  it('a transition between two untrimmed clips is refused by the op with a reason the gallery can show', () => {
    const p = project();
    const call = pickCall(clipOf(p.doc, p.second), { kind: 'transition', id: TRANSITIONS[0]!.id })!;
    expect(call).toEqual({ op: 'set_transition', args: { clipId: p.second, type: TRANSITIONS[0]!.id } });
    let refusal: unknown;
    try { tx(p.doc, [call]); } catch (e) { refusal = e; }
    expect(refusal).toBeInstanceOf(OpError);
    expect((refusal as OpError).code).toBe('out_of_bounds');
    expect((refusal as OpError).message).toMatch(/previous clip has only 0 unused source frames/);
    expect(isOn(clipOf(p.doc, p.second), { kind: 'transition', id: TRANSITIONS[0]!.id })).toBe(false);
  });

  it('pickRefusal reads the reason the editor recorded, and tells a conflict from a refusal', () => {
    expect(pickRefusal({ error: 'Out of range: the previous clip has only 0 unused source frames after its end; the transition needs 15', save: 'save.saved' }))
      .toEqual({ reason: 'Out of range: the previous clip has only 0 unused source frames after its end; the transition needs 15', conflict: false });
    expect(pickRefusal({ error: null, save: 'save.conflict' })).toEqual({ reason: null, conflict: true });
    expect(pickRefusal({ error: null, save: 'save.saved' })).toEqual({ reason: null, conflict: false });
  });
});

describe('gallery thumbnails', () => {
  it('take the shape of the format', () => {
    expect(thumbSize(1920, 1080)).toEqual([180, 101]);
    expect(thumbSize(1080, 1920)).toEqual([101, 180]);
    expect(thumbSize(1080, 1080)).toEqual([180, 180]);
    expect(thumbSize(8192, 16)).toEqual([180, 16]);
    expect(thumbSize(0, 0)).toEqual([180, 101]);
  });
  it('follow the viewed linked format, not the master: the snapshot comes from the preview of the viewed format', () => {
    const p = project();
    const r = tx(p.doc, [{ op: 'add_variant', args: { width: 1080, height: 1920 } }]);
    const view = projectVariant(r.doc, r.results[0]!.output!.variantId as string); // what Editor.viewDoc gives while that format is viewed
    expect(thumbSize(r.doc.settings.width, r.doc.settings.height)).toEqual([180, 101]); // the master: what the gallery used before
    expect(thumbSize(view.settings.width, view.settings.height)).toEqual([101, 180]);
  });
});

describe('the length of a transition picked in the gallery', () => {
  /** Two clips of the five-second files a and b back to back on one track: the first shows a from `inA` for `lenA` frames. */
  function pair(inA: number, lenA: number, lenB = 150) {
    let r = tx(createProject({ id: 'prj_t', name: 'T', width: 1920, height: 1080, frameRate: R }), [{ op: 'import_asset', args: { asset: video('a') } }, { op: 'import_asset', args: { asset: video('b') } }], true);
    const [a, b] = r.results.map((x) => x.output!.assetId as string);
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: a, start: f(0), sourceIn: f(inA), duration: f(lenA), withLinkedAudio: false } }, { op: 'add_clip', args: { assetId: b, start: f(lenA), duration: f(lenB), withLinkedAudio: false } }]);
    const [first, second] = r.results.map((x) => x.output!.clipId as string);
    return { doc: r.doc, first: first!, second: second! };
  }
  const accepts = (doc: ProjectDocument, clipId: string, frames: number) => { try { tx(doc, [{ op: 'set_transition', args: { clipId, type: 'dissolve', frames } }]); return true; } catch (e) { if (e instanceof OpError) return false; throw e; } };

  it('two whole clips: nothing fits, so nothing is sent (the op would refuse every length)', () => {
    const p = pair(0, 150);
    const room = transitionRoom(p.doc, p.second)!;
    expect(room).toEqual({ maxFrames: 0, limit: 'previous' });
    expect(transitionLength(room)).toBe(0);
    expect(accepts(p.doc, p.second, 1)).toBe(false);
  });

  it('the previous clip stops 6 frames before the end of its file: the default 15 is cut to 6, which the op accepts, and 7 it refuses', () => {
    const p = pair(0, 144);
    const room = transitionRoom(p.doc, p.second)!;
    expect(room).toEqual({ maxFrames: 6, limit: 'previous' });
    expect(transitionLength(room)).toBe(6);
    const call = pickCall(clipOf(p.doc, p.second), { kind: 'transition', id: 'dissolve' }, transitionLength(room))!;
    expect(call).toEqual({ op: 'set_transition', args: { clipId: p.second, type: 'dissolve', frames: 6 } });
    const done = tx(p.doc, [call]).doc;
    expect((clipOf(done, p.second) as Extract<Clip, { type: 'media' }>).transition).toEqual({ type: 'dissolve', frames: 6 });
    expect(accepts(p.doc, p.second, 7)).toBe(false);
  });

  it('with enough material the default is kept; a longer current transition keeps its length when it still fits', () => {
    const p = pair(0, 90); // 60 unused frames after the first clip
    const room = transitionRoom(p.doc, p.second)!;
    expect(room).toEqual({ maxFrames: 60, limit: 'previous' });
    expect(transitionLength(room)).toBe(DEFAULT_TRANSITION_FRAMES);
    expect(transitionLength(room, 30)).toBe(30);
    expect(transitionLength(room, 90)).toBe(60);
    expect(accepts(p.doc, p.second, 60)).toBe(true);
    expect(accepts(p.doc, p.second, 61)).toBe(false);
  });

  it('a clip shorter than the default is the limit itself; the first clip (nothing before it) is limited by its own length only', () => {
    const p = pair(0, 90, 10);
    expect(transitionRoom(p.doc, p.second)).toEqual({ maxFrames: 10, limit: 'clip' });
    expect(transitionLength(transitionRoom(p.doc, p.second)!)).toBe(10);
    expect(accepts(p.doc, p.second, 10)).toBe(true);
    expect(accepts(p.doc, p.second, 11)).toBe(false);
    expect(transitionRoom(p.doc, p.first)).toEqual({ maxFrames: 90, limit: 'clip' });
    const whole = project();
    expect(transitionRoom(whole.doc, whole.first)).toEqual({ maxFrames: 150, limit: 'max' }); // 150 frames long: as much as the op takes
    expect(transitionRoom(p.doc, 'no-such-clip')).toBeNull();
  });

  it('agrees with the op at its edge for many trims', () => {
    for (const lenA of [30, 75, 120, 140, 149, 150]) for (const inA of [0, 3]) {
      if (inA + lenA > 150) continue;
      const p = pair(inA, lenA);
      const max = transitionRoom(p.doc, p.second)!.maxFrames;
      if (max >= 1) expect(accepts(p.doc, p.second, max), `${inA}+${lenA}: ${max}`).toBe(true);
      if (max < 150) expect(accepts(p.doc, p.second, max + 1), `${inA}+${lenA}: ${max + 1}`).toBe(false);
    }
  });
});
