import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { describeOps } from '@pulseframe/core';
import { Presence } from './presence.ts';
import { createApp } from './http.ts';
import { loadConfig } from './config.ts';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { createMcp } from './mcp.ts';
import { Store } from './store.ts';
import { RenderHost } from '@pulseframe/renderer';
import { startServer, type RunningServer } from './index.ts';
import { buildOpenApi } from './openapi.ts';
import { createImportQueue } from './importQueue.ts';
import { createDropDoor } from './drop.ts';
import { loadDropPage } from './drop-page/index.ts';
import { dropLimitsFrom } from './importContracts.ts';
import { FifoComputeLane } from './lane.ts';
import { SegmentStore } from './segmentStore.ts';
import { createRenderCacheService } from './renderCacheRoutes.ts';

const doc = buildOpenApi() as any;
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const entries: { path: string; method: string; op: any }[] = Object.entries<any>(doc.paths).flatMap(([p, item]) => Object.entries<any>(item).filter(([m]) => METHODS.includes(m)).map(([method, op]) => ({ path: p, method, op })));

describe('openapi structure', () => {
  it('is OpenAPI 3.1.0 with required metadata', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('PULSEFRAME Studio API');
    expect(Object.keys(doc.components.securitySchemes)).toEqual(['bearerAuth', 'cookieSession']);
    expect(doc['x-internal-routes']).toHaveLength(3);
    expect(Object.keys(doc.paths).some((p) => p.includes('/render/'))).toBe(false);
  });
  it('every operation has id, scope and responses', () => {
    const ids = new Set<string>();
    for (const { path: p, method, op } of entries) {
      expect(op.operationId, `${method} ${p}`).toBeTruthy();
      expect(ids.has(op.operationId), `dup ${op.operationId}`).toBe(false);
      ids.add(op.operationId);
      expect(op['x-required-scope'], `${method} ${p}`).toBeTruthy();
      expect(Object.keys(op.responses).length).toBeGreaterThan(0);
    }
  });
  it('every response object has a description (required by OpenAPI 3.1; a status missing from the error table used to come out without one)', () => {
    const served = JSON.parse(JSON.stringify(doc)); // as GET /api/v1/openapi.json sends it: an undefined description is dropped
    const missing: string[] = [];
    let count = 0;
    for (const [p, item] of Object.entries<any>(served.paths))
      for (const [method, op] of Object.entries<any>(item).filter(([m]) => METHODS.includes(m)))
        for (const [status, r] of Object.entries<any>(op.responses)) { count++; if (typeof r.description !== 'string' || !r.description.trim()) missing.push(`${method} ${p} -> ${status}`); }
    expect(count).toBeGreaterThan(400);
    expect(missing).toEqual([]);
  });
  it('is deterministic', () => expect(JSON.stringify(buildOpenApi())).toBe(JSON.stringify(buildOpenApi())));
  it('contains known routes', () => {
    for (const p of ['/api/v1/projects', '/api/v1/ops', '/api/v1/capabilities', '/api/v1/projects/{id}/undo']) expect(doc.paths[p], p).toBeTruthy();
  });
  it('lists the AI-model wave routes (ADR-0017): the run estimate and the owner-only translation review, and the run body\'s source, apply and confirmLongRun', () => {
    const est = doc.paths['/api/v1/projects/{id}/capabilities/{capabilityId}/estimate']?.get;
    expect(est?.operationId).toBe('estimateCapability');
    expect(est['x-required-scope']).toBe('observe');
    expect(est.parameters.map((p: any) => p.name)).toEqual(['id', 'capabilityId', 'source', 'params']);
    expect(est.responses['200'].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/CapabilityEstimate' });
    const rev = doc.paths['/api/v1/projects/{id}/variants/{variantId}/translation/review']?.post;
    expect(rev?.operationId).toBe('reviewTranslation');
    expect(rev['x-owner-session-only']).toBe(true);
    expect(rev.responses['403']).toBeTruthy();
    expect(Object.keys(doc.components.schemas.RunRequest.properties)).toEqual(expect.arrayContaining(['source', 'apply', 'confirmLongRun']));
    expect(doc.components.schemas.SetupState.properties.code.enum).toHaveLength(10);
  });
  it('transaction ops oneOf covers the registry exactly once', () => {
    const items = doc.components.schemas.TransactionRequest.properties.ops.items.oneOf as any[];
    const names = items.map((i) => i.properties.op.const);
    expect([...names].sort()).toEqual(describeOps().map((o) => o.name).sort());
    expect(new Set(names).size).toBe(names.length);
    for (const internal of ['import_asset', 'restore_entities']) expect(names).not.toContain(internal);
  });
});

describe('openapi against the real server', () => {
  let server: RunningServer;
  let dir: string;
  let h: Record<string, string>;
  const f = (p: string, init: RequestInit = {}) => fetch(server.url + p, { ...init, headers: { ...h, ...(init.headers as any) } });

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-openapi-'));
    server = await startServer({ port: 20000 + Math.floor(Math.random() * 20000), dataDir: dir });
    h = { authorization: `Bearer ${server.auth.tokens.agent}`, connection: 'close' };
  });
  afterAll(async () => {
    await server?.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('every documented route exists (not the catch-all 404)', async () => {
    for (const { path: p, method } of entries) {
      const url = p.replace(/\{[^}]+\}/g, 'dummy');
      const init: RequestInit = method === 'post' ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' } : method === 'delete' ? { method: 'DELETE' } : { method: 'GET' };
      const res = await f(url, init);
      const text = await res.text().catch(() => '');
      const isCatchAll = res.status === 404 && (() => { try { const e = JSON.parse(text).error; return e.code === 'not_found' && e.message === 'no such API route'; } catch { return false; } })();
      expect(isCatchAll, `${method} ${p} -> ${res.status}`).toBe(false);
    }
  }, 60_000);

  it('transaction body: documented payload accepted, unknown property rejected', async () => {
    const created = await f('/api/v1/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'openapi' }) });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as any).project.id;
    const post = (body: unknown, sub = 'transactions') => f(`/api/v1/projects/${id}/${sub}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const base = { requestId: 'r1', label: 'x', idempotencyKey: 'k1', dependsOn: [], ops: [{ op: 'not_an_op', args: {} }] };
    expect((await post(base, 'operations/validate')).status).not.toBe(400);
    expect((await post({ ...base, extra: 1 })).status).toBe(400);
    expect((await post({ ops: [{ op: 'x', args: {}, extra: 1 }] })).status).toBe(400);
    expect((await post({ ops: [] })).status).toBe(400);
    // other small bodies
    const p2 = (url: string, body: unknown) => f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await p2('/api/v1/projects', { name: 'n', width: 640, height: 360, frameRate: { num: 30, den: 1 } })).status).toBe(201);
    expect((await p2('/api/v1/projects', { name: 'n', extra: 1 })).status).toBe(400);
    expect((await p2(`/api/v1/projects/${id}/capabilities/some.cap/runs`, { params: {}, idempotencyKey: 'k' })).status).not.toBe(400);
    expect((await p2(`/api/v1/projects/${id}/capabilities/some.cap/runs`, { extra: 1 })).status).toBe(400);
    expect((await p2('/api/v1/capabilities/import', { id: 'a.b', title: 't', graph: {}, extra: 1 })).status).toBe(400);
    expect((await p2('/api/v1/capabilities/import', { id: 'a.b', title: 't', graph: {} })).status).not.toBe(400);
    expect((await p2(`/api/v1/projects/${id}/undo`, { transactionId: 'tx_none' })).status).not.toBe(400);
  }, 30_000);
});

describe('openapi vs the registered route table', () => {
  it('documented and registered routes match both ways', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-openapi-routes-'));
    const cfg = { ...loadConfig(), dataDir: dir, port: 0 };
    const store = new Store(dir);
    const auth = new Auth(cfg);
    const host = new RenderHost();
    const exporter = new Exporter(store, host, () => 'http://127.0.0.1/render.html', cfg.webDist);
    const capabilities = new Capabilities(store, cfg);
    const derivatives = new Derivatives(store);
    const presence = new Presence();
    let segments: SegmentStore | null = null;
    try {
      // the services index.ts wires (ADR-0023, ADR-0024): their routes are registered only when they are given
      const imports = createImportQueue({ store, lane: new FifoComputeLane(), derivatives, maxUploadBytes: cfg.maxUploadBytes, reserveBytes: cfg.importReserveBytes, homeZone: cfg.homeZone, freeBytes: () => null });
      const door = createDropDoor({ queue: imports, projectExists: () => true, page: loadDropPage, port: 0, limits: dropLimitsFrom(cfg), admitAddresses: [], interfaces: () => ({}), preferredAddress: () => null });
      segments = new SegmentStore({ dir: path.join(dir, 'render-cache'), capBytes: 1 << 20, autoClear: false, minFreeBytes: 0, quota: () => ({ quotaBytes: 0, otherBytes: 0 }) });
      const renderCache = createRenderCacheService({ store, exporter, segments, envSource: { host, webDist: cfg.webDist, threads: 1, fontHash: () => null } });
      const app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, createMcp(store, auth, exporter, capabilities, presence), undefined, undefined, undefined, { imports, door, renderCache });
      const toDoc = (p: string) => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      const registered = new Set<string>();
      for (const r of app.routes) {
        const m = r.method.toLowerCase();
        if (m === 'all' || !r.path.startsWith('/api/v1/') || r.path.includes('*')) continue;
        registered.add(`${m} ${toDoc(r.path)}`);
      }
      registered.add('post /mcp'); // app.all('/mcp'): documented as post
      const internal = new Set<string>(doc['x-internal-routes'].map((s: string) => { const [m, p] = s.split(' '); return `${m!.toLowerCase()} ${p}`; }));
      const documented = new Set(entries.map((e) => `${e.method} ${e.path}`));
      const isInternal = (k: string) => k.split(' ')[1]!.startsWith('/api/v1/render/');
      const missingDocs = [...registered].filter((k) => !isInternal(k) && !documented.has(k));
      const missingInternal = [...registered].filter((k) => isInternal(k) && !internal.has(k));
      const stale = [...documented].filter((k) => !registered.has(k));
      const staleInternal = [...internal].filter((k) => !registered.has(k));
      expect({ missingDocs, missingInternal, stale, staleInternal }).toEqual({ missingDocs: [], missingInternal: [], stale: [], staleInternal: [] });
    } finally {
      await capabilities.stop();
      await derivatives.stop();
      await host.close();
      segments?.close();
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
