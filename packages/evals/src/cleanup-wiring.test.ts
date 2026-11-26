/**
 * Wiring of voice cleanup (ADR-0013) and colour match (ADR-0014): the two read-only measurement routes validate their bodies and
 * refuse an unknown clip before any job exists, and the MCP tools measure_voice and match_colour are listed as read-only with the
 * documented inputs. Only the wiring is checked here: what the measurements return is tested with their modules (W2, W3) and in
 * proof:voiceclean / proof:colourmatch.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '@pulseframe/server';

let s: RunningServer;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-cleanup-wiring-'));
let client: Client | null = null;
let pid = '';
const post = async (p: string, body: unknown) => {
  const r = await fetch(`${s.url}/api/v1${p}`, { method: 'POST', headers: { authorization: `Bearer ${s.auth.tokens.agent}`, 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any };
};

beforeAll(async () => {
  s = await startServer({ port: 0, dataDir: dir });
  pid = (await post('/projects', { name: 'cleanup wiring' })).body.project.id;
});
afterAll(async () => {
  await client?.close().catch(() => {});
  await s?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('voice and colour-match routes', () => {
  it('POST analysis/voice: a body that does not match is 400; an unknown clip is 404 before any job is made', async () => {
    expect((await post(`/projects/${pid}/analysis/voice`, {})).status).toBe(400);
    expect((await post(`/projects/${pid}/analysis/voice`, { clipId: 'clp_x', strength: 2 })).status).toBe(400);
    expect((await post(`/projects/${pid}/analysis/voice`, { clipId: 'clp_x', scope: 'everything' })).status).toBe(400);
    expect((await post(`/projects/${pid}/analysis/voice`, { clipId: 'clp_x', extra: 1 })).status).toBe(400);
    const missing = await post(`/projects/${pid}/analysis/voice`, { clipId: 'clp_x', background: true });
    expect([missing.status, missing.body.error.code]).toEqual([404, 'not_found']);
    expect(s.store.openJobs('analysis')).toEqual([]);
  });
  it('POST analysis/colour-match: targets are required (1–200 ids or "all"), samples 1 or 3, amount 0..1', async () => {
    for (const bad of [{}, { targetClipIds: [] }, { targetClipIds: 'some' }, { targetClipIds: ['a'], samples: 2 }, { targetClipIds: ['a'], amount: 1.5 }, { targetClipIds: ['a'], method: 'copy' }, { targetClipIds: ['a'], extra: 1 }])
      expect((await post(`/projects/${pid}/analysis/colour-match`, bad)).status, JSON.stringify(bad)).toBe(400);
  });
});

describe('MCP tools', () => {
  it('measure_voice and match_colour are listed, read-only, with their documented inputs', async () => {
    client = new Client({ name: 'cleanup-wiring-test', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${s.auth.tokens.agent}` } } }));
    const { tools } = await client.listTools();
    const voice = tools.find((t) => t.name === 'measure_voice'), colour = tools.find((t) => t.name === 'match_colour');
    expect(voice?.annotations?.readOnlyHint).toBe(true);
    expect(colour?.annotations?.readOnlyHint).toBe(true);
    expect(Object.keys((voice!.inputSchema as { properties: object }).properties).sort()).toEqual(['background', 'clipId', 'noiseRanges', 'projectId', 'scope', 'strength']);
    expect(Object.keys((colour!.inputSchema as { properties: object }).properties).sort()).toEqual(['amount', 'background', 'method', 'projectId', 'referenceClipId', 'samples', 'targetClipIds']);
    expect(voice!.description).toMatch(/clean_voice/);
    expect(colour!.description).toMatch(/set_colour_grade/);
  });
});
