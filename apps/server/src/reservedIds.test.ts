/**
 * Requests that name "__proto__", "constructor" or "toString" where an id belongs. Before the own-property lookup
 * (packages/core/src/own.ts) one such transaction, even as a dry run or a proposal, renamed Object.prototype for the
 * whole server process, after which unrelated requests were refused; read routes answered 500 or with an inherited value.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { startServer, type RunningServer } from './index.ts';

const HOSTILE = ['__proto__', 'constructor', 'toString'] as const;
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const video = {
  kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1),
  video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' },
  provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' },
};
const membersOfObject = () => Reflect.ownKeys(Object.prototype).map(String).sort();
const PRISTINE = membersOfObject();

describe('ids that name an inherited member, over HTTP', () => {
  let server: RunningServer;
  let dir: string;
  let projectId: string, assetId: string, variantId: string, runId: string;
  const call = async (method: 'GET' | 'POST', url: string, body?: unknown) => {
    const res = await fetch(`${server.url}/api/v1${url}`, { method, headers: { authorization: `Bearer ${server.auth.tokens.agent}`, connection: 'close', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    let code: string | null = null;
    try { code = JSON.parse(text).error?.code ?? null; } catch { /* not JSON: a file or a caption document */ }
    return { status: res.status, code, text };
  };
  const tx = (ops: unknown[], sub = 'transactions') => call('POST', `/projects/${projectId}/${sub}`, { ops });

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-reserved-'));
    server = await startServer({ port: 20000 + Math.floor(Math.random() * 20000), dataDir: dir });
    const created = await call('POST', '/projects', { name: 'reserved ids' });
    projectId = JSON.parse(created.text).project.id;
    // The library entry is attached the way the ingest job does it; no media bytes are needed for what is asked here.
    const imported = server.store.commit({ projectId, actor: 'test', label: 'fixture', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: video } }] });
    assetId = imported.results[0]!.output!.assetId as string;
    const made = server.store.commit({ projectId, actor: 'test', label: 'fixture', allowInternal: true, ops: [
      { op: 'add_clip', args: { assetId, start: f(0), duration: f(120) } },
      { op: 'add_variant', args: { width: 1080, height: 1080 } },
      { op: 'set_transcript', args: { assetId, language: 'en', segments: [{ start: f(0), duration: f(60), text: 'um one two', words: [{ text: 'um', start: f(0), duration: f(20) }, { text: 'one', start: f(20), duration: f(20) }, { text: 'two', start: f(40), duration: f(20) }] }] } },
      { op: 'edit_analysis', args: { assetId, kind: 'scenes', replace: [T.rt(2, 1)] } },
      { op: 'apply_recipe', args: { recipeId: 'social-pack', params: {}, steps: ['fixture'], ops: [{ op: 'add_marker', args: { time: f(90) } }] } },
    ] });
    variantId = made.results[1]!.output!.variantId as string;
    runId = made.results[4]!.output!.runId as string;
  });
  afterAll(async () => {
    await server?.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a transaction, a dry run and a proposal that rename asset "__proto__" are each refused with 404 not_found, and nothing is written to Object.prototype', async () => {
    for (const id of HOSTILE) {
      for (const sub of ['transactions', 'operations', 'operations/validate', 'proposals']) {
        const r = await tx([{ op: 'rename_asset', args: { assetId: id, name: 'polluted' } }], sub);
        expect([sub, id, r.status, r.code]).toEqual([sub, id, 404, 'not_found']);
        expect(({} as { name?: string }).name).toBeUndefined();
      }
      for (const op of [
        { op: 'add_clip', args: { assetId: id, start: f(300) } },
        { op: 'remove_asset', args: { assetId: id } },
        { op: 'update_variant', args: { variantId: id, name: 'polluted' } },
        { op: 'update_marker', args: { markerId: id, label: 'polluted' } },
        { op: 'edit_analysis', args: { assetId: id, kind: 'scenes' } },
        { op: 'correct_transcript', args: { assetId: id, segmentId: 'seg_x', text: 'x' } },
        { op: 'add_track', args: { sequenceId: id, kind: 'video' } },
      ]) {
        const r = await tx([op]);
        expect([op.op, id, r.status, r.code]).toEqual([op.op, id, 404, 'not_found']);
      }
    }
    expect(membersOfObject()).toEqual(PRISTINE);
    // What used to follow: strict argument checks refusing unrelated requests because every object had a "name".
    const unknown = await tx([{ op: 'remove_asset', args: { assetId: 'ast_nope' } }]);
    expect([unknown.status, unknown.code]).toEqual([404, 'not_found']);
    expect((await tx([{ op: 'rename_asset', args: { assetId, name: 'b.mp4' } }])).status).toBe(200);
    expect(server.store.getProject(projectId).doc.assets[assetId]!.name).toBe('b.mp4');
  }, 30_000);

  it('read routes answer 404 for such an asset, format or recipe run, and still answer for the real ones', async () => {
    const P = `/projects/${projectId}`;
    for (const id of HOSTILE) {
      const asked: [string, Awaited<ReturnType<typeof call>>][] = [
        ['asset content', await call('GET', `${P}/assets/${id}/content`)],
        ['derivatives', await call('GET', `${P}/assets/${id}/derivatives`)],
        ['one derivative', await call('GET', `${P}/assets/${id}/derivatives/thumbnails`)],
        ['analysis', await call('GET', `${P}/assets/${id}/analysis`)],
        ['transcript', await call('GET', `${P}/transcripts/${id}`)],
        ['analyze', await call('POST', `${P}/assets/${id}/analyze`, { kind: 'scenes' })],
        ['silences', await call('POST', `${P}/analysis/silences`, { assetId: id })],
        ['silences as a job', await call('POST', `${P}/analysis/silences`, { assetId: id, background: true })],
        ['fillers', await call('POST', `${P}/analysis/fillers`, { assetId: id })],
        ['captions of a format', await call('GET', `${P}/captions?variant=${id}`)],
        ['preflight of a format', await call('GET', `${P}/preflight?variant=${id}`)],
        ['frame of a format', await call('GET', `${P}/frame?variant=${id}`)],
        ['export plan of a format', await call('POST', `${P}/exports/plan`, { variantId: id })],
        ['regenerate a recipe run', await call('POST', `${P}/recipe-runs/${id}/regenerate`, {})],
        ['plan a recipe for an asset', await call('POST', `${P}/recipes/tidy-speech/plan`, { params: { assetId: id } })],
      ];
      for (const [what, r] of asked) expect([what, id, r.status]).toEqual([what, id, 404]);
    }
    expect((await call('GET', `${P}/assets/${assetId}/analysis`)).status).toBe(200);
    expect((await call('GET', `${P}/transcripts/${assetId}`)).status).toBe(200);
    expect((await call('GET', `${P}/assets/${assetId}/derivatives`)).status).toBe(200);
    expect((await call('POST', `${P}/analysis/fillers`, { assetId })).status).toBe(200);
    expect((await call('GET', `${P}/preflight?variant=${variantId}`)).status).toBe(200);
    expect((await call('POST', `${P}/recipe-runs/run_nope/regenerate`, {})).status).toBe(404);
    expect(runId).toMatch(/^run_/);
    expect(membersOfObject()).toEqual(PRISTINE);
  }, 30_000);
});
