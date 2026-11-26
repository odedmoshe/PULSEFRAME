/**
 * index.ts wiring of the made runner (wave 8 motioncode, W1): a render cut off by a restart ends failed (made_restarted), and the
 * generic cancel (REST /jobs/:id/cancel, the same handler MCP cancel_job ends in) reaches a made render. Port 0; no browser starts
 * (the job rows are written directly as a labelled stand-in for a render in progress).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MADE_JOB_TYPE } from '@pulseframe/core';
import { startServer } from '../index.ts';

describe('made runner wiring', () => {
  it('fails a render the restart cut off, and the generic cancel (REST and MCP) reaches a made render; list_catalog names the built-in pages', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-made-wire-'));
    let s = await startServer({ port: 0, dataDir: dir });
    try {
      const projectId = s.store.createProject({ name: 'wire' }).doc.id;
      const running = s.store.createJob(projectId, MADE_JOB_TYPE, 'agent:local', { pageSha256: 'sha256:' + '0'.repeat(64) });
      s.store.updateJob(running.id, { status: 'running', stage: 'drawing' });
      await s.close();
      s = await startServer({ port: 0, dataDir: dir });
      expect(s.store.getJob(running.id)).toMatchObject({ status: 'failed', error: { code: 'made_restarted', why: 'restarted' } });
      expect(Object.keys(s.store.getProject(projectId).doc.assets)).toEqual([]); // nothing imported
      const queued = s.store.createJob(projectId, MADE_JOB_TYPE, 'agent:local', { pageSha256: 'sha256:' + '0'.repeat(64) }); // a stand-in: queued, not running here
      const r = await fetch(`${s.url}/api/v1/jobs/${queued.id}/cancel`, { method: 'POST', headers: { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' } });
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ jobId: queued.id, status: 'canceled', outcome: 'removed-from-queue' });
      expect(s.store.getJob(queued.id)).toMatchObject({ status: 'canceled', error: { code: 'made_canceled', why: 'canceled' } });
      // MCP cancel_job takes the same dispatch (mcp.ts bindMade; the stand-in that patched capabilities.cancel is gone)
      const mcp = async (name: string, args: Record<string, unknown>) => {
        const m = await fetch(`${s.url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${s.auth.tokens.agent}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', connection: 'close' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
        const raw = await m.text();
        const msg = JSON.parse((m.headers.get('content-type') ?? '').includes('text/event-stream') ? raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : raw);
        return JSON.parse(msg.result.content[0].text);
      };
      const queued2 = s.store.createJob(projectId, MADE_JOB_TYPE, 'agent:local', { pageSha256: 'sha256:' + '0'.repeat(64) }); // a stand-in, as above
      expect(await mcp('cancel_job', { jobId: queued2.id })).toMatchObject({ jobId: queued2.id, status: 'canceled', outcome: 'removed-from-queue' });
      expect(s.store.getJob(queued2.id)).toMatchObject({ status: 'canceled', error: { code: 'made_canceled' } });
      // list_catalog names the built-in pages (madeTemplates)
      const cat = await mcp('list_catalog', {});
      expect(cat.madeTemplates.map((t: { id: string }) => t.id)).toEqual(expect.arrayContaining(['rising-title', 'lower-third', 'counter', 'intro-plate', 'end-card']));
    } finally {
      await s.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
