/**
 * The pearls track's contract in core (wave 7; .artifacts/wave7/pearls-decisions.md): the optional `sourceRanges` key and its
 * entity, exact undo of the emptied map, migration of an imported `{}`, the language assistant's exclusion, the honest "not built"
 * state of the three operations and of the functions, the film contract's additions, and the cascade call sites that change nothing
 * while no range can be made. The it.todo rows name what builders A and B must make pass.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, assistantOps, ASSISTANT_EXCLUDED_OPS, createProject, creativeProjection, diffEntities, entityMap, FamilyFilmParamsSchema, filmRunRecordParams, filmRunRemovedPicks, FILM_PEARL_LEFT_OUT_WHY,
  FILM_REASON_CODES, FILM_WARNING_CODES, listOps, migrateProject, OpError, ProjectSchema, rangeUsage, restoreEntities, screenTime, SOURCE_RANGE_OPS, SOURCE_RANGE_OPS_BUILT, SOURCE_RANGE_REFUSALS,
  SOURCE_RANGE_SUMMARIES, SourceRangesNotBuilt, summarize, validateProject, type ProjectDocument, type SourceRange,
} from './index.ts';

const R = { num: 30, den: 1 };
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const videoAsset = { kind: 'video' as const, name: 'hanukkah.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(300, R), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 300 }, provenance: prov };
function project() {
  const r = applyTransaction(createProject({ id: 'prj_pc', name: 'P' }), [{ op: 'import_asset', args: { asset: videoAsset } }], { idSeed: 'pc_', actor: 'test', allowInternal: true });
  return { doc: r.doc, assetId: r.results[0]!.output!.assetId as string };
}
const range = (assetId: string, over: Partial<SourceRange> = {}): SourceRange => ({ id: 'rng_1', assetId, kind: 'pearl', span: { start: T.frameTime(30, R), end: T.frameTime(75, R) }, label: 'סופגנייה של דינוזאורים', createdBy: 'user:local', ...over });

describe('the sourceRanges key and its entity', () => {
  it('a new project has no sourceRanges key; a document with a range passes the schema', () => {
    const { doc, assetId } = project();
    expect(Object.hasOwn(doc, 'sourceRanges')).toBe(false);
    const withRange = { ...doc, sourceRanges: { rng_1: range(assetId) } };
    expect(ProjectSchema.safeParse(withRange).success).toBe(true);
    expect(ProjectSchema.safeParse({ ...doc, sourceRanges: { rng_1: range(assetId, { label: 'two\nlines' }) } }).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...doc, sourceRanges: { rng_1: range(assetId, { people: [] }) } }).success).toBe(false);
  });
  it('an imported empty map reads as absent', () => {
    const { doc } = project();
    expect(Object.hasOwn(migrateProject({ ...doc, sourceRanges: {} }), 'sourceRanges')).toBe(false);
  });
  it('a range is its own entity; restoring "absent" deletes it and the emptied map, restoring it brings it back exactly', () => {
    const { doc, assetId } = project();
    const after: ProjectDocument = { ...structuredClone(doc), sourceRanges: { rng_1: range(assetId) } };
    expect(entityMap(after).get('rng_1')).toEqual({ kind: 'sourceRange', range: range(assetId) });
    const changes = diffEntities(doc, after);
    expect(changes.map((c) => c.id)).toEqual(['rng_1']);
    const back = structuredClone(after);
    restoreEntities(back, changes.map((c) => ({ id: c.id, state: c.before })));
    expect(Object.hasOwn(back, 'sourceRanges')).toBe(false);
    expect(JSON.stringify(back)).toBe(JSON.stringify(doc));
    const again = structuredClone(back);
    restoreEntities(again, changes.map((c) => ({ id: c.id, state: c.after })));
    expect(creativeProjection(again)).toBe(creativeProjection(after));
  });
  it('summarize says nothing about ranges until there are some, and never a label', () => {
    const { doc, assetId } = project();
    expect(Object.hasOwn(summarize(doc), 'pearls')).toBe(false);
    const s = summarize({ ...doc, sourceRanges: { rng_1: range(assetId) } }) as { pearls?: unknown };
    expect(s.pearls).toEqual({ count: 1, unused: 1 });
    expect(JSON.stringify(s)).not.toContain('סופגנייה');
  });
});

describe('the three operations', () => {
  it('are public, excluded from the language assistant, and refuse as not built until builder A', () => {
    const names = listOps().filter((o) => !o.internal).map((o) => o.name);
    for (const op of SOURCE_RANGE_OPS) { expect(names).toContain(op); expect(ASSISTANT_EXCLUDED_OPS).toContain(op); expect(assistantOps()).not.toContain(op); }
    if (SOURCE_RANGE_OPS_BUILT) return;
    const { doc, assetId } = project();
    for (const [op, args] of [['add_source_range', { assetId }], ['update_source_range', { rangeId: 'rng_x', label: 'x' }], ['remove_source_range', { rangeId: 'rng_x' }]] as const) {
      let err: unknown;
      try { applyTransaction(doc, [{ op, args }], { idSeed: 'pn_', actor: 'test' }); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(OpError);
      expect((err as OpError).message).toBe(SOURCE_RANGE_REFUSALS.notBuilt.message(op));
    }
  });
  it('summaries name the file, never a label or a person', () => {
    for (const f of Object.values(SOURCE_RANGE_SUMMARIES)) expect(typeof f).toBe('function');
    expect(SOURCE_RANGE_SUMMARIES.pearl('x'.repeat(100))).toBe(`Marked a pearl in "${'x'.repeat(60)}"`);
    expect(SOURCE_RANGE_SUMMARIES.untagged(3)).toBe('; untagged from 3 marked range(s)');
  });
  it('remove_asset and remove_person keep their summaries and outputs while no range exists (the cascades change nothing)', () => {
    const { doc, assetId } = project();
    const r = applyTransaction(doc, [{ op: 'remove_asset', args: { assetId } }], { idSeed: 'ra_', actor: 'test' });
    expect(r.summary).toBe('Removed "hanukkah.mp4" from the library');
    const p = applyTransaction(doc, [{ op: 'add_person', args: { name: 'אלף' } }], { idSeed: 'ap_', actor: 'test' });
    const personId = p.results[0]!.output!.personId as string;
    const rp = applyTransaction(p.doc, [{ op: 'remove_person', args: { personId } }], { idSeed: 'rp_', actor: 'test' });
    expect(rp.summary).toBe('Removed "אלף" from the people of the project');
    expect(validateProject(rp.doc)).toEqual([]);
  });
  it('the functions throw "not built" instead of answering', () => {
    if (SOURCE_RANGE_OPS_BUILT) return;
    const { doc } = project();
    expect(() => rangeUsage(doc)).toThrow(SourceRangesNotBuilt);
    expect(() => screenTime(doc)).toThrow(SourceRangesNotBuilt);
  });
  it('A: built — an add commits, undoes to the stored JSON and is counted; the functions answer with numbers (cases: sourceRanges.test.ts, sourceRanges.property.test.ts)', () => {
    expect(SOURCE_RANGE_OPS_BUILT).toBe(true);
    const { doc, assetId } = project();
    const r = applyTransaction(doc, [{ op: 'add_source_range', args: { assetId, start: T.frameTime(30, R), end: T.frameTime(75, R), label: 'x' } }], { idSeed: 'pb_', actor: 'user:local' });
    const rangeId = r.results[0]!.output!.rangeId as string;
    expect(r.doc.sourceRanges![rangeId]!.span).toEqual({ start: T.frameTime(30, R), end: T.frameTime(75, R) });
    const back = structuredClone(r.doc);
    restoreEntities(back, diffEntities(doc, r.doc).map((c) => ({ id: c.id, state: c.before })));
    expect(JSON.stringify(back)).toBe(JSON.stringify(doc));
    expect(rangeUsage(r.doc).unused).toEqual([rangeId]);
    expect(screenTime(r.doc).pictureFrames).toBe(0);
  });
});

describe('the family film contract', () => {
  it('picks.pearls takes prefer only, and the new codes are listed', () => {
    expect(FamilyFilmParamsSchema.safeParse({ assetIds: ['a'], picks: { pearls: 'prefer' } }).success).toBe(true);
    expect(FamilyFilmParamsSchema.safeParse({ assetIds: ['a'], picks: { pearls: 'only' } }).success).toBe(false);
    expect(FILM_REASON_CODES).toContain('pearl');
    expect(FILM_WARNING_CODES).toEqual(expect.arrayContaining(['pearl_cut_short', 'pearl_left_out', 'pearl_under_music']));
    expect(FILM_PEARL_LEFT_OUT_WHY).toContain('one_per_file');
  });
  it('the run record carries rangeId only where a pick has one, and reads it back', () => {
    const params = filmRunRecordParams({ params: {} as never, picks: [
      { key: 'm000000000001', assetId: 'a', order: 0, startFrame: 0, frames: 30, span: null, sourceInFrame: 0, sourceFrames: 30, kind: 'pearl', windowIndex: null, windowsAvailable: 0, reasons: [{ code: 'pearl', rangeId: 'rng_1', fromSecond: 1, toSecond: 2.5 }], captureAt: null, ownSound: false, rangeId: 'rng_1' },
      { key: 'm000000000002', assetId: 'b', order: 1, startFrame: 30, frames: 30, span: null, sourceInFrame: 0, sourceFrames: 30, kind: 'measured', windowIndex: 0, windowsAvailable: 1, reasons: [], captureAt: null, ownSound: false },
    ] }, [{ key: 'm000000000003', assetId: 'c', windowIndex: null, rangeId: 'rng_9' }]);
    const picked = params.picked as { rangeId?: string }[];
    expect(picked[0]!.rangeId).toBe('rng_1');
    expect(Object.hasOwn(picked[1]!, 'rangeId')).toBe(false);
    expect(filmRunRemovedPicks(params)).toEqual([{ key: 'm000000000003', assetId: 'c', windowIndex: null, rangeId: 'rng_9' }]);
    expect(filmRunRemovedPicks({ removedPicks: [{ key: 'k', assetId: 'a', windowIndex: 1 }] })).toEqual([{ key: 'k', assetId: 'a', windowIndex: 1 }]);
  });
});
