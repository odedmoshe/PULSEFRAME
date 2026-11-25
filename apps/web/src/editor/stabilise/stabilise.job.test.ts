/** The block follows a stabilise run through the store's event stream: a job event reaches the block's state with no api.job read; the slow read is only for a stream that is down. */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FALLBACK_POLL_MS, dependsOnOf, needsFallbackRead, settledOf } from './stabilise.logic.ts';

let Editor: typeof import('../store.ts').Editor;
beforeAll(async () => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  ({ Editor } = await import('../store.ts'));
});
const ev = (status: string, extra: Record<string, unknown> = {}) => ({ id: 'job_s1', type: 'stabilise', status, stage: null, output: null, error: null, ...extra });

describe('stabilise jobs in the store', () => {
  it('a stabilise job event is kept by id, and the block reads its end from it, with no poll', () => {
    const fetchSpy = vi.fn(async () => new Response('{}'));
    (globalThis as { fetch?: unknown }).fetch = fetchSpy;
    const e = new Editor();
    e.onJobEvent(ev('running', { stage: 'measure' }));
    expect(e.getState().stabiliseJobs.job_s1!.status).toBe('running');
    expect(settledOf(e.getState().stabiliseJobs.job_s1!).kind).toBe('open');
    e.onJobEvent(ev('succeeded', { output: { strengthLowered: true } }));
    expect(settledOf(e.getState().stabiliseJobs.job_s1!)).toEqual({ kind: 'done', strengthLowered: true });
    e.onJobEvent(ev('failed', { error: { code: 'cancelled_by_x', message: 'm' } }));
    expect(settledOf(e.getState().stabiliseJobs.job_s1!)).toEqual({ kind: 'failed', code: 'cancelled_by_x', message: 'm' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('other job types do not land in stabiliseJobs', () => {
    const e = new Editor();
    e.onJobEvent({ ...ev('running'), type: 'export' });
    expect(e.getState().stabiliseJobs).toEqual({});
  });
  it('the fallback read is slow and only for a stream that is down (or has said nothing of the run)', () => {
    expect(FALLBACK_POLL_MS).toBeGreaterThanOrEqual(2000);
    expect(needsFallbackRead(true, { status: 'running' })).toBe(false);
    expect(needsFallbackRead(false, { status: 'running' })).toBe(true);
    expect(needsFallbackRead(true, undefined)).toBe(true);
  });
});

describe('the commit carries what it depends on', () => {
  it('Editor.commit passes dependsOn to the transaction body unchanged, and omits it when none is given', async () => {
    const bodies: Record<string, unknown>[] = [];
    const doc = { id: 'prj_d', mainSequenceId: 'seq', sequences: { seq: { id: 'seq', tracks: [] } }, assets: {}, settings: { frameRate: { num: 30, den: 1 } } };
    (globalThis as { fetch?: unknown }).fetch = async (url: string, init?: { body?: string }) => {
      if (String(url).endsWith('/transactions')) { bodies.push(JSON.parse(init!.body!)); return new Response(JSON.stringify({ revision: 1, committed: true, results: [] }), { status: 200, headers: { 'content-type': 'application/json' } }); }
      return new Response(JSON.stringify({ project: doc, revision: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const e = new Editor();
    await e.load('prj_d').catch(() => undefined);
    (e as unknown as { state: { doc: unknown; revision: number } }).state.doc = doc;
    const op = { op: 'set_clip_stabilise', args: { clipId: 'c', stabilise: null } };
    await e.commit([op], 'Stabilise', { dependsOn: dependsOnOf('ast_1') });
    await e.commit([op], 'Stabilise');
    expect(bodies[0]!.dependsOn).toEqual(['analysis:ast_1']);
    expect('dependsOn' in bodies[1]!).toBe(false);
  });
});
