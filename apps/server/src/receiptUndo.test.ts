import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { Governance, type Principal } from './governance.ts';
import { ApiError, Store } from './store.ts';

/** The Copilot receipt's "undo" must reverse THAT agent edit, not the owner's newest (the web client now names the transaction). */
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const f = (n: number) => T.frameTime(n, { num: 30, den: 1 });
const user: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const texts = (store: Store, pid: string) => Object.values(store.getProject(pid).doc.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).flatMap((c) => (c.type === 'text' ? [c.text] : []));

describe('undoing a named agent transaction', () => {
  it('reverses the agent edit and keeps the owner edit that came before it; the unnamed call reverses the owner newest edit', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-rcpt-'));
    dirs.push(d);
    const store = new Store(d);
    const gov = new Governance(store);
    const pid = store.createProject({ name: 'p' }).doc.id;
    const agent = gov.principalForToken(gov.createGrant({ name: 'a', mode: 'edit' }, user).token)!;
    const add = (text: string, at: number) => ({ op: 'add_text', args: { text, start: f(at), duration: f(30) } });
    gov.commitAs(user, { projectId: pid, ops: [add('OWNER-1', 0)] });
    const a = gov.commitAs(agent, { projectId: pid, ops: [add('AGENT', 60)] }) as { transactionId: string };
    gov.commitAs(user, { projectId: pid, ops: [add('OWNER-2', 120)] });
    // the receipt names the agent's transaction
    gov.undoAs(user, pid, 'undo', a.transactionId);
    expect(texts(store, pid).sort()).toEqual(['OWNER-1', 'OWNER-2']);
    // asking again for the same one says it is already reversed (the web client shows that, and never touches the owner's work)
    let code = 'ok';
    try { gov.undoAs(user, pid, 'undo', a.transactionId); } catch (e) { code = e instanceof ApiError ? e.code : 'other'; }
    expect(code).toBe('already_undone');
    // the unnamed call is the owner's own newest edit: the very thing the receipt button used to reverse by mistake
    gov.undoAs(user, pid, 'undo');
    expect(texts(store, pid)).toEqual(['OWNER-1']);
  });
});
