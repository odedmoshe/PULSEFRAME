import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { Governance, type Principal } from './governance.ts';
import { ApiError, Store } from './store.ts';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const f = (n: number) => T.frameTime(n, { num: 30, den: 1 });
const user: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof ApiError ? `${e.status}:${e.code}` : `non-api:${e}`; } return 'ok'; };
function setup(clock?: () => number) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-gov-'));
  dirs.push(d);
  const store = new Store(d);
  const gov = new Governance(store, clock);
  const pid = store.createProject({ name: 'p' }).doc.id;
  const agent = (input: Record<string, unknown>) => gov.principalForToken(gov.createGrant({ name: 'a', mode: 'edit', ...input }, user).token)!;
  const text = (frame: number, trackId?: string) => ({ op: 'add_text', args: { text: `t${frame}`, start: f(frame), duration: f(30), ...(trackId ? { trackId } : {}) } });
  return { store, gov, pid, agent, text };
}

describe('grants', () => {
  it('tokens are shown once, stored hashed, and resolve to a principal with the grant mode', () => {
    const { store, gov } = setup();
    const { grant, token } = gov.createGrant({ name: 'cutter', mode: 'propose' }, user);
    expect(JSON.stringify(store.db.prepare('SELECT * FROM grants').all())).not.toContain(token);
    expect(gov.principalForToken(token)).toMatchObject({ actor: 'agent:cutter', kind: 'agent', mode: 'propose', scopes: ['observe'] });
    expect(gov.principalForToken('pfa_bootstrap')).toBeNull(); // not a grant token: falls through to bootstrap tokens
    expect(code(() => gov.principalForToken('pfg_unknown'))).toBe('401:invalid_token');
    gov.revokeGrant(grant.id, user);
    expect(code(() => gov.principalForToken(token))).toBe('401:grant_revoked');
  });
  it('expire, and only the owner can create or revoke them', () => {
    let now = 1_000_000;
    const { gov, agent } = setup(() => now);
    const { token } = gov.createGrant({ name: 'short', mode: 'edit', expiresInSeconds: 60 }, user);
    expect(gov.principalForToken(token)!.mode).toBe('edit');
    now += 61_000;
    expect(code(() => gov.principalForToken(token))).toBe('401:grant_expired');
    const a = agent({});
    expect(code(() => gov.createGrant({ name: 'x', mode: 'autopilot' }, a))).toBe('403:owner_required');
    expect(code(() => gov.revokeGrant('grt_x', a))).toBe('403:owner_required');
    expect(code(() => gov.createGrant({ name: 'x', mode: 'root' }, user))).toBe('400:invalid_request');
  });
});

describe('scoped editing', () => {
  it('project scope: a grant for one project cannot read or write another', () => {
    const { store, gov, pid, agent, text } = setup();
    const other = store.createProject({ name: 'other' }).doc.id;
    const a = agent({ projectIds: [pid] });
    expect(gov.commitAs(a, { projectId: pid, ops: [text(0)] })).toMatchObject({ committed: true });
    expect(code(() => gov.commitAs(a, { projectId: other, ops: [text(0)] }))).toBe('403:out_of_scope');
    expect(code(() => gov.assertMayAct(a, other, 'observe'))).toBe('403:out_of_scope');
  });
  it('track scope: changes on other tracks are refused from the real diff, including moves across tracks, deletes and undo', () => {
    const { store, gov, pid, agent, text } = setup();
    store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'add_track', args: { kind: 'text', name: 'T2' } }] });
    const t2 = store.getProject(pid).doc.sequences.seq_main!.tracks.find((t) => t.name === 'T2')!.id;
    const onT1 = (store.commit({ projectId: pid, actor: 'user:local', ops: [text(0, 'trk_text')] }).results[0]!.output!.clipId) as string;
    const a = agent({ trackIds: [t2] });
    const mine = gov.commitAs(a, { projectId: pid, ops: [text(0, t2)] }) as any;
    expect(mine.committed).toBe(true);
    expect(code(() => gov.commitAs(a, { projectId: pid, ops: [text(60, 'trk_text')] }))).toBe('403:out_of_scope');
    expect(code(() => gov.commitAs(a, { projectId: pid, ops: [{ op: 'update_text', args: { clipId: onT1, text: 'x' } }] }))).toBe('403:out_of_scope');
    expect(code(() => gov.commitAs(a, { projectId: pid, ops: [{ op: 'delete_clip', args: { clipId: onT1 } }] }))).toBe('403:out_of_scope');
    expect(code(() => gov.commitAs(a, { projectId: pid, ops: [{ op: 'move_clip', args: { clipId: mine.results[0].output.clipId, start: f(90), trackId: 'trk_text' } }] }))).toBe('403:out_of_scope');
    expect(code(() => gov.commitAs(a, { projectId: pid, ops: [{ op: 'rename_project', args: { name: 'hijack' } }] }))).toBe('403:out_of_scope');
    // all-or-nothing: an in-scope op bundled with an out-of-scope one changes nothing
    const rev = store.getProject(pid).revision;
    expect(code(() => gov.commitAs(a, { projectId: pid, ops: [text(120, t2), text(120, 'trk_text')] }))).toBe('403:out_of_scope');
    expect(store.getProject(pid).revision).toBe(rev);
    expect(gov.undoAs(a, pid, 'undo').committed).toBe(true); // its own in-scope edit
  });
  it('time-range scope: clips must lie fully inside the range before and after the change', () => {
    const { gov, pid, agent, text } = setup();
    const a = agent({ range: { start: f(60), end: f(180) } });
    const ok = gov.commitAs(a, { projectId: pid, ops: [text(90)] }) as any;
    expect(ok.committed).toBe(true);
    expect(code(() => gov.commitAs(a, { projectId: pid, ops: [text(0)] }))).toBe('403:out_of_scope');
    expect(code(() => gov.commitAs(a, { projectId: pid, ops: [text(170)] }))).toBe('403:out_of_scope'); // ends at 200
    expect(code(() => gov.commitAs(a, { projectId: pid, ops: [{ op: 'move_clip', args: { clipId: ok.results[0].output.clipId, start: f(0) } }] }))).toBe('403:out_of_scope');
  });
  it('observe mode cannot edit or propose', () => {
    const { gov, pid, text } = setup();
    const o = gov.principalForToken(gov.createGrant({ name: 'o', mode: 'observe' }, user).token)!;
    expect(code(() => gov.commitAs(o, { projectId: pid, ops: [text(0)] }))).toBe('403:insufficient_scope');
    expect(code(() => gov.propose(o, pid, [text(0)]))).toBe('403:insufficient_scope');
    expect(code(() => gov.assertMayAct(o, pid, 'observe'))).toBe('ok');
  });
});

describe('pause agent', () => {
  it('suspends agent mutations server-side with a typed error; reading continues; resume is deliberate and owner-only', () => {
    const { store, gov, pid, agent, text } = setup();
    const a = agent({});
    expect(code(() => gov.setPaused(pid, true, a))).toBe('403:owner_required');
    const r = gov.setPaused(pid, true, user);
    expect(r.agentsPaused).toBe(true);
    expect(code(() => gov.commitAs(a, { projectId: pid, ops: [text(0)] }))).toBe('423:agent_paused');
    expect(code(() => gov.propose(a, pid, [text(0)]))).toBe('423:agent_paused');
    expect(code(() => gov.undoAs(a, pid, 'undo'))).toBe('423:agent_paused');
    expect(code(() => gov.assertMayAct(a, pid, 'job'))).toBe('423:agent_paused');
    expect(code(() => gov.assertMayAct(a, pid, 'observe'))).toBe('ok');
    expect((gov.commitAs(user, { projectId: pid, ops: [text(0)] }) as any).committed).toBe(true); // the human is never paused
    gov.setPaused(pid, false, user);
    expect((gov.commitAs(a, { projectId: pid, ops: [text(60)] }) as any).committed).toBe(true);
    expect(store.getProject(pid).revision).toBe(2);
  });
});

describe('proposals', () => {
  it('propose mode turns every edit into a proposal; accept commits it on the owner\'s undo stack; reject leaves no trace in the document', () => {
    const { store, gov, pid, text } = setup();
    const p = gov.principalForToken(gov.createGrant({ name: 'ideas', mode: 'propose' }, user).token)!;
    const pr = gov.commitAs(p, { projectId: pid, ops: [text(0)], label: 'Add opener' }) as any;
    expect(pr).toMatchObject({ proposed: true, committed: false, status: 'open', baseRevision: 0 });
    expect(store.getProject(pid).revision).toBe(0);
    expect(gov.proposalDocs(pr.proposalId).after.sequences.seq_main!.tracks.find((t) => t.kind === 'text')!.clips.length).toBe(1);
    expect(code(() => gov.decide(pr.proposalId, 'accept', p))).toBe('403:owner_required');
    const d = gov.decide(pr.proposalId, 'accept', user);
    expect(d.proposal).toMatchObject({ status: 'accepted', resultRevision: 1, decidedBy: 'user:local' });
    expect(d.commit).toMatchObject({ committed: true, revision: 1 });
    expect(code(() => gov.decide(pr.proposalId, 'accept', user))).toBe('409:proposal_closed'); // cannot be applied twice
    expect(store.undo(pid, 'user:local', 'undo').committed).toBe(true); // the accepting user can undo it
    const pr2 = gov.propose(p, pid, [text(60)]);
    expect(gov.decide(pr2.proposalId, 'reject', user).proposal.status).toBe('rejected');
    expect(store.getProject(pid).doc.sequences.seq_main!.tracks.find((t) => t.kind === 'text')!.clips.length).toBe(0);
  });
  it('a proposal goes stale instead of overwriting newer work', () => {
    const { store, gov, pid, text } = setup();
    const p = gov.principalForToken(gov.createGrant({ name: 'ideas', mode: 'propose' }, user).token)!;
    const clipId = store.commit({ projectId: pid, actor: 'user:local', ops: [text(0)] }).results[0]!.output!.clipId as string;
    const pr = gov.propose(p, pid, [{ op: 'update_text', args: { clipId, text: 'agent wording' } }]);
    store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'update_text', args: { clipId, text: 'human wording' } }] });
    expect(code(() => gov.decide(pr.proposalId, 'accept', user))).toBe('409:proposal_stale');
    const after = gov.getProposal(pr.proposalId);
    expect(after.status).toBe('stale');
    expect(after.conflicts[0]).toMatchObject({ entityId: clipId, changedAtRevision: 2 });
    expect((store.getProject(pid).doc.sequences.seq_main!.tracks.find((t) => t.kind === 'text')!.clips[0] as any).text).toBe('human wording');
    // an unrelated later edit does not make a proposal stale
    const pr2 = gov.propose(p, pid, [text(120)]);
    store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'update_text', args: { clipId, text: 'again' } }] });
    expect(gov.decide(pr2.proposalId, 'accept', user).proposal.status).toBe('accepted');
  });
  it('proposals are validated and scope-checked when made', () => {
    const { gov, pid, text } = setup();
    const p = gov.principalForToken(gov.createGrant({ name: 'ideas', mode: 'propose', trackIds: ['trk_none'] }, user).token)!;
    expect(code(() => gov.propose(p, pid, [text(0)]))).toBe('403:out_of_scope');
    expect(code(() => gov.propose(p, pid, [{ op: 'delete_clip', args: { clipId: 'nope' } }]))).toBe('404:not_found');
  });
});

describe('approvals', () => {
  it('are bound to one exact action, usable once, only by the owner, and expire', () => {
    let now = 5_000_000;
    const { gov, pid, agent } = setup(() => now);
    const action = { capabilityId: 'c', bytes: 444, models: [{ path: 'm', sha256: 'x' }] };
    const a = gov.requestApproval({ projectId: pid, kind: 'model-download', action, requestedBy: 'agent:a' });
    expect(a.status).toBe('pending');
    expect(code(() => gov.consumeApproval(a.id, 'model-download', action))).toBe('409:approval_not_usable'); // not approved yet
    expect(code(() => gov.decideApproval(a.id, 'approve', agent({})))).toBe('403:owner_required'); // an agent cannot approve
    gov.decideApproval(a.id, 'approve', user);
    expect(code(() => gov.consumeApproval(a.id, 'model-download', { ...action, bytes: 999 }))).toBe('409:approval_mismatch'); // changed action
    expect(code(() => gov.consumeApproval(a.id, 'other-kind', action))).toBe('409:approval_mismatch');
    // key order does not matter; content does
    expect(gov.consumeApproval(a.id, 'model-download', { models: [{ sha256: 'x', path: 'm' }], bytes: 444, capabilityId: 'c' }).status).toBe('consumed');
    expect(code(() => gov.consumeApproval(a.id, 'model-download', action))).toBe('409:approval_not_usable'); // single use
    const b = gov.requestApproval({ projectId: pid, kind: 'k', action, requestedBy: 'agent:a', ttlSeconds: 10 });
    now += 11_000;
    expect(gov.getApproval(b.id).status).toBe('expired');
    expect(code(() => gov.decideApproval(b.id, 'approve', user))).toBe('409:approval_closed');
    const c = gov.requestApproval({ projectId: pid, kind: 'k', action, requestedBy: 'agent:a', ttlSeconds: 10 });
    gov.decideApproval(c.id, 'approve', user);
    now += 11_000;
    expect(code(() => gov.consumeApproval(c.id, 'k', action))).toBe('409:approval_expired'); // approved but used too late
  });
});

describe('budget ledger', () => {
  it('reserves atomically, counts unknown outcomes conservatively, and releases or settles', () => {
    const { gov, agent } = setup();
    const a = gov.principalForToken(gov.createGrant({ name: 'auto', mode: 'autopilot', budgetCents: 100 }, user).token)!;
    gov.reserve(a, 'job1', 60);
    expect(code(() => gov.reserve(a, 'job2', 50))).toBe('402:budget_exceeded'); // 60 reserved + 50 > 100
    gov.reserve(a, 'job2', 40);
    expect(gov.spend(a.grant!.id)).toEqual({ spentCents: 0, reservedCents: 100 });
    gov.resolve('job1', 'settled', 35); // cheaper than reserved: the difference is free again
    gov.resolve('job2', 'unknown'); // submission outcome unknown: stays counted
    expect(gov.spend(a.grant!.id)).toEqual({ spentCents: 35, reservedCents: 40 });
    expect(code(() => gov.reserve(a, 'job3', 30))).toBe('402:budget_exceeded');
    gov.resolve('job2', 'released');
    gov.reserve(a, 'job3', 65);
    expect(gov.spend(a.grant!.id)).toEqual({ spentCents: 35, reservedCents: 65 });
    expect(code(() => gov.reserve(agent({}), 'job4', 1))).toBe('403:insufficient_scope'); // Edit mode may not spend
    expect(code(() => gov.reserve(a, 'free', 0))).toBe('ok'); // zero-cost work needs no budget
    expect(gov.listGrants().find((g) => g.name === 'auto')).toMatchObject({ budgetCents: 100, spentCents: 35, reservedCents: 65 });
  });
});
