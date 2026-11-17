/**
 * The lead's server contracts of the people step (ADR-0021, people section): the people scope of a grant (off by default,
 * only the owner sets it, rows stored before it existed read as 'names') and the redaction helpers of peoplePrivacy.ts that
 * every surface uses (peopleSurfaces.ts says which surface uses which; peopleSurfaces.test.ts walks them). withoutFamily and
 * peopleSuggestions are W2's and are tested in W2's files.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProject, type ProjectDocument } from '@pulseframe/core';
import { Governance, GrantInput, type Principal } from './governance.ts';
import { assertMayTakeRendered, assertMayWritePeople, docForPrincipal, forPrincipal, mayHoldPeople, namesOnly, peopleAccess, PEOPLE_SCOPE_REQUIRED, readerAccess, readingAs, scrubPeople } from './peoplePrivacy.ts';
import { ApiError, Store } from './store.ts';

const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const AGENT: Principal = { actor: 'agent:x', kind: 'agent', scopes: ['observe', 'edit'] };
const NOA = { id: 'per_noa', name: 'נועה', birthDate: '2014-11-04', form: 'f' as const };
const withPeople = (people: object[]): ProjectDocument => ({ ...createProject({ id: 'p', name: 'P' }), people: Object.fromEntries(people.map((p: any) => [p.id, p])) });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof ApiError) return `${e.status} ${e.code}`; throw e; } return 'allowed'; };

let dir: string, store: Store, gov: Governance;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-people-contracts-')); store = new Store(dir); gov = new Governance(store); });
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('people: the scope of a grant', () => {
  it('is "names" unless the owner sets "full"; any other value is refused', () => {
    expect(GrantInput.parse({ name: 'g', mode: 'edit' }).people).toBe('names');
    expect(GrantInput.parse({ name: 'g', mode: 'observe', people: 'full' }).people).toBe('full');
    expect(GrantInput.safeParse({ name: 'g', mode: 'edit', people: 'birthdays' }).success).toBe(false);
    const names = gov.createGrant({ name: 'n', mode: 'edit' }, OWNER), full = gov.createGrant({ name: 'f', mode: 'edit', people: 'full' }, OWNER);
    expect([names.grant.people, full.grant.people]).toEqual(['names', 'full']);
    expect(peopleAccess(gov.principalForToken(names.token)!)).toBe('names');
    expect(peopleAccess(gov.principalForToken(full.token)!)).toBe('full');
    expect(code(() => gov.createGrant({ name: 'x', mode: 'edit', people: 'full' }, AGENT))).toBe('403 owner_required');
  });
  it('a grant stored before the scope existed reads as "names"', () => {
    const { grant } = gov.createGrant({ name: 'old', mode: 'edit' }, OWNER);
    const row = store.db.prepare('SELECT constraints FROM grants WHERE id = ?').get(grant.id) as { constraints: string };
    const { people: _p, ...old } = JSON.parse(row.constraints);
    store.db.prepare('UPDATE grants SET constraints = ? WHERE id = ?').run(JSON.stringify(old), grant.id);
    expect(gov.getGrant(grant.id).people).toBe('names');
  });
  it('the owner\'s session reads everything; an agent without a grant (the built-in tokens) reads names', () => {
    expect(peopleAccess(OWNER)).toBe('full');
    expect(peopleAccess(AGENT)).toBe('names');
    expect(peopleAccess({ ...AGENT, scopes: ['observe'] })).toBe('names');
  });
});

describe('people: the redaction helpers', () => {
  it('namesOnly keeps id and name, sets the birth date to null and drops the word choice; the same object when there is nothing to take out; never changes its input', () => {
    const doc = withPeople([NOA, { id: 'per_itai', name: 'איתי', birthDate: null }]);
    const before = structuredClone(doc);
    const out = namesOnly(doc);
    expect(out.people).toEqual({ per_noa: { id: 'per_noa', name: 'נועה', birthDate: null }, per_itai: { id: 'per_itai', name: 'איתי', birthDate: null } });
    expect(doc).toEqual(before);
    expect(namesOnly(doc)).toBe(out); // kept per document
    expect(namesOnly(out)).toBe(out);
    const plain = createProject({ id: 'p', name: 'P' });
    expect(namesOnly(plain)).toBe(plain);
    expect(docForPrincipal(doc, OWNER)).toBe(doc);
    expect(docForPrincipal(doc, AGENT)).toBe(out);
  });
  it('the reader of a request is set once and holds for everything it awaits; outside a request it is the whole document', async () => {
    expect(readerAccess()).toBe('full');
    await readingAs(AGENT, async () => { await new Promise((r) => setTimeout(r, 1)); expect(readerAccess()).toBe('names'); });
    expect(readingAs(OWNER, () => readerAccess())).toBe('full');
    const pid = store.importProject(withPeople([NOA])).doc.id;
    expect(readingAs(AGENT, () => store.getProject(pid).doc.people)).toEqual({ per_noa: { id: 'per_noa', name: 'נועה', birthDate: null } });
    expect(readingAs(AGENT, () => store.replay(pid).doc.people!.per_noa!.birthDate)).toBeNull();
    expect(readingAs(AGENT, () => store.wholeProject(pid).doc.people!.per_noa!.birthDate)).toBe('2014-11-04'); // writes read the whole document
    expect(store.getProject(pid).doc.people!.per_noa!.birthDate).toBe('2014-11-04');
  });
  it('scrubPeople takes birth dates and word choices out of any JSON value (entity states, nested operation lists) and leaves everything else as it is', () => {
    const v = {
      changes: [{ id: 'per_noa', before: { kind: 'person', person: NOA }, after: null }],
      ops: [{ op: 'add_person', args: { name: 'איתי', birthDate: '2014-11-04', form: 'm' } }, { op: 'update_text', args: { clipId: 'c', text: 'birthDate form' } }],
      nested: { transaction: { ops: [{ op: 'update_person', args: { personId: 'per_noa', form: null } }] } },
      other: { form: 'f', note: 'a form field that is not a person keeps its value' },
    };
    const before = structuredClone(v);
    const out = scrubPeople(v);
    expect(v).toEqual(before);
    expect(out.changes[0]!.before!.person).toEqual({ id: 'per_noa', name: 'נועה', birthDate: null });
    expect(out.ops[0]!.args).toEqual({ name: 'איתי' });
    expect(out.ops[1]).toBe(v.ops[1]);
    expect(out.nested.transaction.ops[0]!.args).toEqual({ personId: 'per_noa' });
    expect(out.other).toBe(v.other);
    const clean = { a: [1, 'x', { b: null }] };
    expect(scrubPeople(clean)).toBe(clean);
    expect(forPrincipal(v, OWNER)).toBe(v);
    expect(forPrincipal(v, AGENT)).toEqual(out);
    expect(mayHoldPeople(JSON.stringify(v))).toBe(true);
    expect(mayHoldPeople(JSON.stringify({ ...out, other: null }))).toBe(false); // (a bare form field makes the net look, and it leaves it as it is)
    expect(mayHoldPeople(JSON.stringify({ people: { per_noa: { id: 'per_noa', name: 'n', birthDate: null } } }))).toBe(false);
  });
  it('a credential without the scope may name, rename and remove people, never give a birth date or a word choice, also nested; the refusal names the arguments only', () => {
    const ok = [{ op: 'add_person', args: { name: 'נועה' } }, { op: 'update_person', args: { personId: 'per_noa', name: 'נועי' } }, { op: 'remove_person', args: { personId: 'per_noa' } }];
    expect(code(() => assertMayWritePeople(AGENT, ok))).toBe('allowed');
    for (const ops of [[{ op: 'add_person', args: { name: 'x', birthDate: null } }], [{ op: 'update_person', args: { personId: 'per_noa', form: 'f' } }], { wrap: [{ op: 'update_person', args: { personId: 'p', birthDate: '2014-11-04' } }] }]) {
      let err: ApiError | undefined;
      try { assertMayWritePeople(AGENT, ops); } catch (e) { err = e as ApiError; }
      expect(`${err?.status} ${err?.code}`).toBe(`403 ${PEOPLE_SCOPE_REQUIRED}`);
      expect(JSON.stringify(err)).not.toMatch(/2014|"f"/);
    }
    expect(code(() => assertMayWritePeople(OWNER, [{ op: 'update_person', args: { personId: 'p', birthDate: '2014-11-04' } }]))).toBe('allowed');
    expect(code(() => assertMayWritePeople({ ...AGENT, grant: { people: 'full' } as never }, [{ op: 'update_person', args: { personId: 'p', form: 'm' } }]))).toBe('allowed');
  });
  it('a film is refused to a credential without the scope while a title with live fields shows an age, by the field and not by whether a birth date is recorded', () => {
    const titled = (text: string, fields: boolean, birthDate: string | null): ProjectDocument => {
      const doc = withPeople([{ ...NOA, birthDate }]);
      const seq = Object.values(doc.sequences)[0]!;
      seq.tracks.push({ id: 'trk_t', kind: 'video', name: 'T', clips: [{ id: 'clp_t', type: 'text', text, start: { value: '0', timescale: 30 }, duration: { value: '30', timescale: 30 }, ...(fields ? { fields: true } : {}) }] } as never);
      return doc;
    };
    for (const birthDate of ['2014-11-04', null]) expect(code(() => assertMayTakeRendered(AGENT, titled('{age:per_noa}', true, birthDate), 'export'))).toBe(`403 ${PEOPLE_SCOPE_REQUIRED}`);
    expect(code(() => assertMayTakeRendered(AGENT, titled('{name:per_noa}', true, '2014-11-04'), 'export'))).toBe('allowed');
    expect(code(() => assertMayTakeRendered(AGENT, titled('בת 8', true, '2014-11-04'), 'export'))).toBe('allowed'); // plain text the owner wrote
    expect(code(() => assertMayTakeRendered(OWNER, titled('{age:per_noa}', true, '2014-11-04'), 'export'))).toBe('allowed');
  });
});
