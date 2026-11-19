import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, creativeProjection, diffEntities, restoreEntities, timeline, validateProject, OpError, ProjectSchema, type OpCall, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `m${n++}_`, actor: 'test' });

describe('user markers', () => {
  it('add, rename, recolour, move and remove; listed in time order by the timeline query', () => {
    const base = createProject({ id: 'prj_m', name: 'M' });
    let r = tx(base, [{ op: 'add_marker', args: { time: f(90), label: 'chorus', color: 'red' } }, { op: 'add_marker', args: { time: f(30) } }]);
    const [a, b] = r.results.map((x) => x.output!.markerId as string) as [string, string];
    expect(validateProject(r.doc)).toEqual([]);
    expect(timeline(r.doc)!.markers.user.map((m) => [m.id, m.seconds, m.label, m.color])).toEqual([[b, 1, '', 'blue'], [a, 3, 'chorus', 'red']]);
    r = tx(r.doc, [{ op: 'update_marker', args: { markerId: b, label: 'שלום intro', color: 'green', time: f(120) } }]);
    expect(timeline(r.doc)!.markers.user.map((m) => m.id)).toEqual([a, b]);
    expect(r.doc.markers[b]).toMatchObject({ label: 'שלום intro', color: 'green' });
    r = tx(r.doc, [{ op: 'remove_marker', args: { markerId: a } }]);
    expect(Object.keys(r.doc.markers)).toEqual([b]);
  });
  it('refuses off-frame, negative and duplicate positions, and unknown markers', () => {
    const d = tx(createProject({ id: 'prj_m2', name: 'M' }), [{ op: 'add_marker', args: { time: f(10) } }, { op: 'add_marker', args: { time: f(20) } }]);
    const second = d.results[1]!.output!.markerId as string;
    expect(() => tx(d.doc, [{ op: 'add_marker', args: { time: T.rt(1, 7) } }])).toThrow(OpError);
    expect(() => tx(d.doc, [{ op: 'add_marker', args: { time: f(-1) } }])).toThrow(OpError);
    expect(() => tx(d.doc, [{ op: 'add_marker', args: { time: f(10) } }])).toThrow(OpError);
    expect(() => tx(d.doc, [{ op: 'update_marker', args: { markerId: second, time: f(10) } }])).toThrow(OpError);
    expect(() => tx(d.doc, [{ op: 'remove_marker', args: { markerId: 'mrk_nope' } }])).toThrow(OpError);
  });
  it('markers are entities: changes are diffed and can be restored (undo path); documents saved before markers existed still load', () => {
    const before = tx(createProject({ id: 'prj_m3', name: 'M' }), [{ op: 'add_marker', args: { time: f(10), label: 'a' } }]).doc;
    const id = Object.keys(before.markers)[0]!;
    const after = tx(before, [{ op: 'update_marker', args: { markerId: id, label: 'b' } }, { op: 'add_marker', args: { time: f(50) } }]).doc;
    const changes = diffEntities(before, after);
    expect(changes.map((c) => c.after?.kind ?? c.before?.kind)).toEqual(['marker', 'marker']);
    const draft = structuredClone(after);
    restoreEntities(draft, changes.map((c) => ({ id: c.id, state: c.before })));
    expect(creativeProjection(draft)).toBe(creativeProjection(before));
    const { markers: _dropped, ...old } = createProject({ id: 'prj_old', name: 'old' });
    expect(ProjectSchema.parse(old).markers).toEqual({});
  });
});
