import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { sameIds, singleFlight } from './oneAtATime.ts';
import { curveApplier, type CurveHost } from './speedCurves.apply.ts';

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
  let open!: () => void;
  let gate: Promise<void> = Promise.resolve();
  let queue: Promise<unknown> = Promise.resolve();
  const host: CurveHost = {
    commit(ops) {
      state.sent++;
      const run = async () => {
        await gate;
        try { const out = tx(state.doc, ops); state.doc = out.doc; return { results: out.results }; } catch { return null; }
      };
      const p = queue.then(run, run);
      queue = p;
      return p;
    },
    select(id, mode = 'replace') { state.selection = mode === 'replace' ? [id] : state.selection.includes(id) ? state.selection.filter((x) => x !== id) : [...state.selection, id]; },
    selection: () => state.selection,
  };
  const videoClips = () => state.doc.sequences[state.doc.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!.clips;
  return { host, state, clipId, videoClips, hold() { gate = new Promise<void>((res) => { open = res; }); }, release() { open(); } };
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
