/**
 * The pearls track's privacy contract on the server (wave 7; .artifacts/wave7/pearls-decisions.md §2.2, §3), landed complete in the
 * pre-pass: labels are read like birth dates (namesOnly, scrubPeople, the REST net's quick test), a 'names' credential may not give
 * a label, only the owner's own session tags people or touches a tagged range or person (assertOwnerTagsPeople, people 'full'
 * grants included), the archive «בלי פרטי משפחה» holds no range, and the read view answers an honest 501 until builder B.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type ProjectDocument, type SourceRange } from '@pulseframe/core';
import { assertMayWritePeople, assertOwnerTagsPeople, HUMAN_TAG_REFUSALS, mayHoldPeople, namesOnly, scrubPeople, withoutFamily } from './peoplePrivacy.ts';
import { PEARLS_SERVER_BUILT, pearlsView } from './pearls.ts';
import { ApiError } from './store.ts';
import type { Grant, Principal } from './governance.ts';

const R = { num: 30, den: 1 };
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const asset = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(300, R), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 300 }, provenance: prov };
const LABEL = 'אני רוצה סופגנייה עם ריבה של דינוזאורים';
function project(): { doc: ProjectDocument; personId: string } {
  const r = applyTransaction(createProject({ id: 'prj_pp', name: 'P' }), [{ op: 'import_asset', args: { asset } }], { idSeed: 'pp_', actor: 'test', allowInternal: true });
  const assetId = r.results[0]!.output!.assetId as string;
  const p = applyTransaction(r.doc, [{ op: 'add_person', args: { name: 'נועה', birthDate: '2020-02-29' } }], { idSeed: 'pq_', actor: 'test' });
  const personId = p.results[0]!.output!.personId as string;
  const span = { start: T.frameTime(30, R), end: T.frameTime(75, R) };
  const ranges: Record<string, SourceRange> = {
    rng_tagged: { id: 'rng_tagged', assetId, kind: 'pearl', span, label: LABEL, people: [personId], createdBy: 'user:local' },
    rng_free: { id: 'rng_free', assetId, kind: 'pearl', span: { start: T.frameTime(90, R), end: T.frameTime(120, R) }, label: '', createdBy: 'agent:x' },
  };
  return { doc: { ...p.doc, sourceRanges: ranges }, personId };
}
const grant = (people: 'names' | 'full'): Grant => ({ id: 'grt_1', name: 'g', mode: 'edit', projectIds: null, trackIds: null, range: null, budgetCents: 0, requestsPerMinute: null, exportsPerDay: null, people, expiresAt: null, revokedAt: null, createdAt: '2026-11-25T00:00:00Z', createdBy: 'user:local' });
const owner: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const agent: Principal = { actor: 'agent:a', kind: 'agent', scopes: ['observe', 'edit'] };
const fullAgent: Principal = { actor: 'agent:g', kind: 'agent', scopes: ['observe', 'edit'], grant: grant('full') };
const refusedWith = (fn: () => void): { status: number; code: string; message: string } | null => {
  try { fn(); return null; } catch (e) { if (e instanceof ApiError) return { status: e.status, code: e.code, message: e.message }; throw e; }
};

describe('labels are read like birth dates', () => {
  it('the reader document of a names credential has every label blank and nothing else of a range changed', () => {
    const { doc } = project();
    const out = namesOnly(doc);
    expect(JSON.stringify(out)).not.toContain('דינוזאורים');
    expect(out.sourceRanges!.rng_tagged).toEqual({ ...doc.sourceRanges!.rng_tagged, label: '' });
    expect(out.people![Object.keys(out.people!)[0]!]!.birthDate).toBeNull();
    expect(namesOnly(out)).toBe(out);
    const unlabelled = { ...doc, people: undefined, sourceRanges: { rng_free: doc.sourceRanges!.rng_free! } };
    expect(namesOnly(unlabelled)).toBe(unlabelled);
  });
  it('scrubPeople blanks a range wherever it sits and drops the label argument of a call; the REST net looks', () => {
    const { doc } = project();
    const row = { changes: [{ id: 'rng_tagged', before: null, after: { kind: 'sourceRange', range: doc.sourceRanges!.rng_tagged } }], ops: [{ op: 'add_source_range', args: { assetId: 'a', label: LABEL } }, { op: 'apply_transaction', args: { ops: [{ op: 'update_source_range', args: { rangeId: 'r', label: LABEL } }] } }] };
    const out = scrubPeople(row);
    expect(JSON.stringify(out)).not.toContain('דינוזאורים');
    expect(out.ops[0]!.args).toEqual({ assetId: 'a' });
    expect(JSON.stringify(row)).toContain('דינוזאורים');
    expect(mayHoldPeople(JSON.stringify(row))).toBe(true);
    expect(mayHoldPeople(JSON.stringify({ marker: { label: 'x', kind: 'note' } }))).toBe(false);
  });
  it('a names credential may not give a label; a people "full" grant and the owner may', () => {
    const ops = [{ op: 'add_source_range', args: { assetId: 'a', label: 'x' } }];
    expect(refusedWith(() => assertMayWritePeople(agent, ops))).toEqual({ status: 403, code: 'people_scope_required', message: HUMAN_TAG_REFUSALS.label });
    expect(refusedWith(() => assertMayWritePeople(agent, [{ op: 'apply_transaction', args: { ops } }]))?.code).toBe('people_scope_required');
    expect(refusedWith(() => assertMayWritePeople(fullAgent, ops))).toBeNull();
    expect(refusedWith(() => assertMayWritePeople(owner, ops))).toBeNull();
    expect(refusedWith(() => assertMayWritePeople(agent, [{ op: 'add_source_range', args: { assetId: 'a' } }]))).toBeNull();
  });
});

describe('only the owner tags people', () => {
  const { doc, personId } = project();
  const whole = () => doc;
  const tag = (p: Principal, ops: unknown) => refusedWith(() => assertOwnerTagsPeople(p, ops, whole));
  it('people arguments and presence tags are refused for every agent, also with people "full", also nested; the owner passes', () => {
    for (const p of [agent, fullAgent]) {
      expect(tag(p, [{ op: 'add_source_range', args: { assetId: 'a', people: [personId] } }])).toEqual({ status: 403, code: 'human_tag_required', message: HUMAN_TAG_REFUSALS.tagging });
      expect(tag(p, [{ op: 'update_source_range', args: { rangeId: 'rng_free', people: [] } }])?.message).toBe(HUMAN_TAG_REFUSALS.tagging);
      expect(tag(p, [{ op: 'add_source_range', args: { assetId: 'a', kind: 'presence' } }])?.message).toBe(HUMAN_TAG_REFUSALS.tagging);
      expect(tag(p, [{ op: 'apply_transaction', args: { ops: [{ op: 'add_source_range', args: { assetId: 'a', people: [personId] } }] } }])?.code).toBe('human_tag_required');
    }
    expect(tag(owner, [{ op: 'add_source_range', args: { assetId: 'a', kind: 'presence', people: [personId] } }])).toBeNull();
  });
  it('a range or a person the owner tagged is the owner\'s to change or remove; untagged ones are open', () => {
    expect(tag(fullAgent, [{ op: 'update_source_range', args: { rangeId: 'rng_tagged', label: 'x' } }])?.message).toBe(HUMAN_TAG_REFUSALS.taggedRange);
    expect(tag(agent, [{ op: 'remove_source_range', args: { rangeId: 'rng_tagged' } }])?.message).toBe(HUMAN_TAG_REFUSALS.taggedRange);
    expect(tag(agent, [{ op: 'remove_person', args: { personId } }])?.message).toBe(HUMAN_TAG_REFUSALS.taggedPerson);
    expect(tag(agent, [{ op: 'update_source_range', args: { rangeId: 'rng_free', start: T.ZERO, end: T.frameTime(10, R) } }])).toBeNull();
    expect(tag(agent, [{ op: 'remove_source_range', args: { rangeId: 'rng_free' } }])).toBeNull();
    expect(tag(agent, [{ op: 'remove_source_range', args: { rangeId: 'constructor' } }])).toBeNull();
    expect(tag(agent, [{ op: 'remove_person', args: { personId: 'per_other' } }])).toBeNull();
    expect(tag(owner, [{ op: 'remove_person', args: { personId } }])).toBeNull();
  });
  it('reads the document only when a range or person call is present', () => {
    let reads = 0;
    assertOwnerTagsPeople(agent, [{ op: 'add_clip', args: {} }], () => { reads++; return doc; });
    expect(reads).toBe(0);
  });
});

describe('the archive and the read view', () => {
  it('«בלי פרטי משפחה» holds no range and validates', () => {
    const { doc } = project();
    const out = withoutFamily(doc).doc;
    expect(Object.hasOwn(out, 'sourceRanges')).toBe(false);
    expect(Object.hasOwn(out, 'people')).toBe(false);
  });
  it('the view answers 404 for an unknown sequence and 501 pearls_not_built until builder B', () => {
    const { doc } = project();
    expect(refusedWith(() => pearlsView(doc, 1, owner, 'seq_none'))?.status).toBe(404);
    if (!PEARLS_SERVER_BUILT) expect(refusedWith(() => pearlsView(doc, 1, owner))).toMatchObject({ status: 501, code: 'pearls_not_built' });
  });
  it.todo('B: GET …/pearls and get_pearls answer PearlsView from the reader document: labels "" and labelsHidden for a names credential, names only, usage and screen time from core, SCREEN_TIME_LABEL and USAGE_LIMITS with them');
  it.todo('B: through the routes, an agent\'s commit, dry run, nested apply_transaction and propose_transaction with people are 403 human_tag_required; a planted label is in no answer of peopleSurfaces for a names credential');
});
