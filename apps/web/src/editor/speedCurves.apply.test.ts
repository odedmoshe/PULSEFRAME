import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, findClip, toSourceSpan, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { repeatClick, sameIds, singleFlight } from './oneAtATime.ts';
import { clipsLook, curveApplier, type CurveHost } from './speedCurves.apply.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const asset = {
  kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'e'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(20, 1),
  video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 600 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' },
  provenance: { origin: 'fixture' as const, importedAt: '2026-11-16T00:00:00Z', importedBy: 'test' },
};

/**
 * A stand-in for the editor (labelled test double): writes run one after another like Editor.commit, each through the real
 * ops, and a refused op resolves to null. `gate` holds every write back until the test lets it land, like a slow server.
 */
function fakeEditor() {
  let n = 0;
  const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `s${n++}_`, actor: 'test', allowInternal });
  let r = tx(createProject({ id: 'prj_s', name: 'S' }), [{ op: 'import_asset', args: { asset } }], true);
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: r.results[0]!.output!.assetId as string, start: f(0), sourceIn: T.rt(2, 1), duration: f(300) } }]);
  const clipId = r.results[0]!.output!.clipId as string;
  const state = { doc: r.doc, selection: [clipId] as string[], sent: 0 };
  // Undo and redo the way the editor does them: the server restores the earlier document (same clip ids), and the editor
  // then drops from the selection whatever is no longer there (Editor.load).
  const past: ProjectDocument[] = [], future: ProjectDocument[] = [];
  const show = (doc: ProjectDocument) => { state.doc = doc; state.selection = state.selection.filter((id) => !!findClip(doc, id)); };
  let open!: () => void;
  let gate: Promise<void> = Promise.resolve();
  let queue: Promise<unknown> = Promise.resolve();
  const host: CurveHost = {
    commit(ops) {
      state.sent++;
      const run = async () => {
        await gate;
        try { const out = tx(state.doc, ops); past.push(state.doc); future.length = 0; state.doc = out.doc; return { results: out.results }; } catch { return null; }
      };
      const p = queue.then(run, run);
      queue = p;
      return p;
    },
    select(id, mode = 'replace') { state.selection = mode === 'replace' ? [id] : state.selection.includes(id) ? state.selection.filter((x) => x !== id) : [...state.selection, id]; },
    selection: () => state.selection,
    hasClip: (id) => !!findClip(state.doc, id),
  };
  const videoClips = () => state.doc.sequences[state.doc.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!.clips;
  return {
    host, state, clipId, videoClips, hold() { gate = new Promise<void>((res) => { open = res; }); }, release() { open(); },
    undo() { const doc = past.pop(); if (doc) { future.push(state.doc); show(doc); } },
    redo() { const doc = future.pop(); if (doc) { past.push(state.doc); show(doc); } },
  };
}

describe('singleFlight', () => {
  it('drops a call that arrives while another is running, and takes the next one after it lands', async () => {
    const flight = singleFlight();
    let finish!: (v: string) => void;
    const first = flight.run(() => new Promise<string>((res) => { finish = res; }));
    expect(flight.busy).toBe(true);
    let started = false;
    expect(await flight.run(async () => { started = true; return 'second'; })).toEqual({ dropped: true });
    expect(started).toBe(false);
    finish('first');
    expect(await first).toEqual({ dropped: false, value: 'first' });
    expect(flight.busy).toBe(false);
    expect(await flight.run(async () => 'third')).toEqual({ dropped: false, value: 'third' });
  });
  it('is free again after a failure', async () => {
    const flight = singleFlight();
    await expect(flight.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(flight.busy).toBe(false);
  });
  it('sameIds ignores order and needs the same members', () => {
    expect(sameIds(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameIds(['a'], ['a', 'b'])).toBe(false);
    expect(sameIds(['a', 'c'], ['a', 'b'])).toBe(false);
  });
});

describe('applying a speed curve from the inspector', () => {
  it('without the guard a double-click nests a second curve in the first part (the reported defect, at the op level)', async () => {
    const e = fakeEditor();
    const call: OpCall[] = [{ op: 'apply_speed_curve', args: { clipId: e.clipId, preset: 'hero' } }];
    await Promise.all([e.host.commit(call), e.host.commit(call)]);
    expect(e.videoClips().length).toBe(9); // five parts, then the first of them divided into five again
  });

  it('a double-click while the first commit is on its way sends one op only', async () => {
    const e = fakeEditor();
    const curve = curveApplier(e.host);
    e.hold();
    const first = curve.apply(e.clipId, { preset: 'hero' }, 'Speed curve hero');
    expect(curve.busy).toBe(true);
    const second = await curve.apply(e.clipId, { preset: 'hero' }, 'Speed curve hero');
    expect(second).toEqual({ kind: 'busy' });
    e.release();
    const done = await first;
    expect(done.kind).toBe('applied');
    expect(e.state.sent).toBe(1);
    expect(e.videoClips().length).toBe(5);
    expect(curve.busy).toBe(false);
  });

  it('a second click after the first has landed is not sent while the new parts are still the selection', async () => {
    const e = fakeEditor();
    const curve = curveApplier(e.host);
    const done = await curve.apply(e.clipId, { preset: 'hero' }, 'Speed curve hero');
    expect(done.kind === 'applied' && done.partIds.length).toBe(5);
    expect(done.kind === 'applied' && done.partIds[0]).toBe(e.clipId); // the first part keeps the clip's id: this is why a repeat would land on it
    expect(sameIds(e.state.selection, done.kind === 'applied' ? done.partIds : [])).toBe(true);
    expect(curve.repeat()).toBe(true);
    expect(await curve.apply(e.clipId, { preset: 'hero' }, 'Speed curve hero')).toEqual({ kind: 'repeat' });
    expect(await curve.apply(e.clipId, { preset: 'bullet' }, 'Speed curve bullet')).toEqual({ kind: 'repeat' });
    expect(e.state.sent).toBe(1);
    expect(e.videoClips().length).toBe(5);
  });

  it('choosing one clip afterwards lifts the guard: a curve on that clip is a deliberate edit', async () => {
    const e = fakeEditor();
    const curve = curveApplier(e.host);
    await curve.apply(e.clipId, { preset: 'hero' }, 'Speed curve hero');
    e.host.select(e.clipId); // the user clicks the first part on the timeline
    expect(curve.repeat()).toBe(false);
    const again = await curve.apply(e.clipId, { preset: 'flash-in' }, 'Speed curve flash-in');
    expect(again.kind).toBe('applied');
    expect(e.state.sent).toBe(2);
  });

  it('a one-part curve does not hold the controls: after Smooth ramp and an undo, another curve is taken', async () => {
    const e = fakeEditor();
    const curve = curveApplier(e.host);
    const ramp = await curve.apply(e.clipId, { preset: 'smooth-ramp' }, 'Speed curve smooth-ramp');
    expect(ramp).toEqual({ kind: 'applied', partIds: [e.clipId] }); // one part: the clip itself, still the selection
    expect(e.state.selection).toEqual([e.clipId]);
    expect(curve.repeat()).toBe(false);
    e.undo();
    curve.documentChanged();
    expect(e.videoClips().length).toBe(1);
    expect(curve.repeat()).toBe(false);
    const hero = await curve.apply(e.clipId, { preset: 'hero' }, 'Speed curve hero');
    expect(hero.kind === 'applied' && hero.partIds.length).toBe(5);
    expect(e.state.sent).toBe(2);
  });

  it('a hand-made curve of two points is one part too, and does not hold the controls', async () => {
    const e = fakeEditor();
    const curve = curveApplier(e.host);
    const own = await curve.apply(e.clipId, { points: [{ at: 0, speed: 1 }, { at: 1, speed: 2 }] }, 'Speed curve');
    expect(own).toEqual({ kind: 'applied', partIds: [e.clipId] });
    expect(curve.repeat()).toBe(false);
    e.host.select(e.clipId); // clicking the clip on the timeline changes nothing, and must not be needed
    expect(curve.repeat()).toBe(false);
  });

  it('a curve chosen right after a one-part curve replaces it: nothing is nested, the same stretch of the source is shown', async () => {
    const e = fakeEditor();
    const curve = curveApplier(e.host);
    await curve.apply(e.clipId, { preset: 'smooth-ramp' }, 'Speed curve smooth-ramp');
    const ramped = e.videoClips()[0]!;
    const shown = ramped.type === 'media' ? toSourceSpan(ramped, ramped.duration) : T.ZERO;
    const hero = await curve.apply(e.clipId, { preset: 'hero' }, 'Speed curve hero');
    expect(hero.kind === 'applied' && hero.partIds.length).toBe(5);
    const parts = e.videoClips();
    expect(parts.length).toBe(5); // hero alone, not hero inside a ramp
    const first = parts[0]!, last = parts[4]!;
    expect(first.type === 'media' && first.speedEnd).toBeFalsy(); // the ramp is gone: hero's first part plays at one speed
    expect(first.type === 'media' && T.eq(first.sourceIn, T.rt(2, 1))).toBe(true);
    // the parts stop within one frame's worth of source (at hero's fastest, 2.5 source frames) of where the ramped clip stopped
    const end = last.type === 'media' ? T.add(last.sourceIn, toSourceSpan(last, last.duration)) : T.ZERO;
    const short = T.toSeconds(T.sub(T.add(T.rt(2, 1), shown), end));
    expect(short).toBeGreaterThanOrEqual(0);
    expect(short).toBeLessThan(5 * 2.5 / 30);
  });

  it('undo then redo brings the parts back selected, as the apply left them, so the next tile is not nested in the first part', async () => {
    const e = fakeEditor();
    const curve = curveApplier(e.host);
    const done = await curve.apply(e.clipId, { preset: 'hero' }, 'Speed curve hero');
    const partIds = done.kind === 'applied' ? done.partIds : [];
    expect(curve.documentChanged()).toBeNull(); // the apply itself: nothing to do
    e.undo();
    expect(e.state.selection).toEqual([e.clipId]); // the editor drops the parts that are gone
    expect(curve.documentChanged()).toBe('gone');
    expect(curve.repeat()).toBe(false); // the single clip is back: another curve may be tried
    e.redo();
    expect(e.videoClips().length).toBe(5);
    expect(e.state.selection).toEqual([e.clipId]); // redo alone leaves only the first part selected...
    expect(curve.documentChanged()).toBe('back');
    expect(sameIds(e.state.selection, partIds)).toBe(true); // ...so the control selects them all again
    expect(curve.repeat()).toBe(true);
    expect(await curve.apply(e.clipId, { preset: 'bullet' }, 'Speed curve bullet')).toEqual({ kind: 'repeat' });
    expect(e.videoClips().length).toBe(5);
    expect(e.state.sent).toBe(1);
  });

  it('after a redo the user can still choose one part and give it a curve of its own', async () => {
    const e = fakeEditor();
    const curve = curveApplier(e.host);
    await curve.apply(e.clipId, { preset: 'hero' }, 'Speed curve hero');
    e.undo(); curve.documentChanged();
    e.redo(); curve.documentChanged();
    e.host.select(e.clipId);
    expect(curve.documentChanged()).toBeNull(); // no document change brought the parts back this time: the choice stands
    expect(e.state.selection).toEqual([e.clipId]);
    expect((await curve.apply(e.clipId, { preset: 'flash-in' }, 'Speed curve flash-in')).kind).toBe('applied');
  });

  it('a selection the user changed after the undo is left alone when the parts come back', async () => {
    const e = fakeEditor();
    const curve = curveApplier(e.host);
    await curve.apply(e.clipId, { preset: 'hero' }, 'Speed curve hero');
    e.undo(); curve.documentChanged();
    e.host.select('clp_other');
    e.redo();
    expect(curve.documentChanged()).toBeNull();
    expect(e.state.selection).toEqual([]); // 'clp_other' is not in the document, so the editor dropped it; nothing was selected for the user
  });

  it('the status line is tied to the clips it speaks of: an undo changes how they look, an edit elsewhere does not', async () => {
    const e = fakeEditor();
    const curve = curveApplier(e.host);
    const look = (ids: readonly string[]) => clipsLook((id) => findClip(e.state.doc, id)?.clip, ids);
    const ramp = await curve.apply(e.clipId, { preset: 'smooth-ramp' }, 'Speed curve smooth-ramp');
    const ids = ramp.kind === 'applied' ? ramp.partIds : [];
    const applied = look(ids);
    expect(await e.host.commit([{ op: 'add_marker', args: { time: f(10), label: 'elsewhere' } }])).not.toBeNull();
    expect(look(ids)).toBe(applied); // another edit, even a reload of the same document: the line stays
    expect(clipsLook((id) => structuredClone(findClip(e.state.doc, id)?.clip), ids)).toBe(applied);
    e.undo(); e.undo();
    expect(look(ids)).not.toBe(applied); // the ramp is undone: the line would be stale
    e.redo(); e.redo();
    expect(look(ids)).toBe(applied);
    expect(clipsLook(() => undefined, ['clp_gone'])).toBe('[null]');
  });

  it('the second click of a double-click is recognised by its click count, whatever the timing', () => {
    expect(repeatClick(1)).toBe(false); // a single click
    expect(repeatClick(0)).toBe(false); // Enter or Space on the focused tile
    expect(repeatClick(2)).toBe(true);
    expect(repeatClick(3)).toBe(true);
  });

  it('a refused curve reports refused, selects nothing new and leaves the guard open', async () => {
    const e = fakeEditor();
    const curve = curveApplier(e.host);
    const r = await curve.apply('clp_missing', { preset: 'hero' }, 'Speed curve hero');
    expect(r).toEqual({ kind: 'refused' });
    expect(e.state.selection).toEqual([e.clipId]);
    expect(curve.repeat()).toBe(false);
    expect(curve.busy).toBe(false);
  });
});
