/**
 * REST routes of the in-editor agent (wave 8 autonomy Part 2; core AGENT_ROUTES). LEAD PRE-PASS: every route registered with its
 * checks in order (scope, the project may be read, the body parses, the owner floor where it applies) and then the service. The run
 * routes answer 501 agent_not_built until W1's service is bound; the provider, key and model routes are built (W2, agent/providers.ts). W1 owns the run handlers, W2 the
 * provider/model handlers; the first lines of each handler (the checks) stay.
 *
 * Who: run routes need the scope named in AGENT_ROUTES and nothing else: the owner's session and any agent credential with that
 * scope start, read, cancel, continue and undo runs, in whatever mode the server is in (Part 1 decides what an agent may do; this
 * file adds no gate). The provider routes that store a key or a base URL, probe with the key, or edit the model table are the
 * OWNER FLOOR (verifier C1: the base URL decides where the key goes; a readable key lets someone else spend the owner's money):
 * `agentOwnerFloor` below, which Part 1's `isOwnerFloor` replaces at integration (one line). GET providers answers keySet only.
 */
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { AGENT_PROVIDER_PRESETS, AgentModelTableSchema } from '@pulseframe/providers';
import { AGENT_REFUSAL_CODES, AgentContinueBodySchema, AgentStartBodySchema, UndoActorBodySchema } from '@pulseframe/core';
import { isOwnerSession } from '../assistant/contract.ts';
import type { Scope } from '../auth.ts';
import type { Governance, Principal } from '../governance.ts';
import { ApiError, type Store } from '../store.ts';
import { AGENT_KEY_MAX_CHARS } from './keys.ts';
import type { AgentRunService } from './loop.ts';
import { createAgentProviders } from './providers.ts';

/** PUT /api/v1/agent/providers/:providerId: an omitted field keeps its stored value; model null forgets the choice. */
export const ProviderSettingsBodySchema = z.object({ baseUrl: z.string().min(1).max(2048).optional(), model: z.string().max(128).nullable().optional() }).strict();

export type AgentEnv = { Variables: { principal: Principal } };
export interface AgentRouteDeps { store: Store; gov: Governance; need: (c: Context<AgentEnv>, scope: Scope) => Principal; /** read per request: mcp.ts agentService() (W1's service once index.ts binds it, else the not-built one) */ service: () => AgentRunService }

/** The owner floor of the provider routes (Part 1: replaced by isOwnerFloor). */
export function agentOwnerFloor(p: Principal): Principal {
  if (!isOwnerSession(p)) throw new ApiError(AGENT_REFUSAL_CODES.ownerRequired.status, AGENT_REFUSAL_CODES.ownerRequired.code, 'a model provider\'s key and address are set from the owner\'s own editor window', {}, 'Open the editor as the owner and connect the provider in the «סוכן» tab.');
  return p;
}
const parse = async <S extends z.ZodType>(c: Context<AgentEnv>, schema: S): Promise<z.infer<S>> => {
  let raw: unknown = {};
  try { const t = await c.req.text(); raw = t ? JSON.parse(t) : {}; } catch { throw new ApiError(400, 'invalid_request', 'the body is not JSON'); }
  const r = schema.safeParse(raw);
  if (!r.success) throw new ApiError(400, 'invalid_request', z.prettifyError(r.error), { issues: r.error.issues });
  return r.data;
};
const providerOf = (id: string) => {
  if (!AGENT_PROVIDER_PRESETS.some((p) => p.id === id)) throw new ApiError(AGENT_REFUSAL_CODES.providerUnknown.status, AGENT_REFUSAL_CODES.providerUnknown.code, `no provider preset ${id}`, { providerId: id }, 'GET /api/v1/agent/providers lists them.');
  return id;
};

export function registerAgentRoutes(app: Hono<AgentEnv>, deps: AgentRouteDeps): void {
  const { gov, need } = deps;
  const svc = () => deps.service();
  const P = '/api/v1/projects/:id';
  const project = (c: Context<AgentEnv>, scope: Scope) => { const p = need(c, scope); gov.assertMayAct(p, c.req.param('id')!, 'observe'); return p; };
  app.post(`${P}/agent/runs`, async (c) => { const p = project(c, 'edit'); const b = await parse(c, AgentStartBodySchema); return c.json(svc().start(p, c.req.param('id'), b), 202); });
  app.get(`${P}/agent/runs`, (c) => { const p = project(c, 'observe'); return c.json(svc().list(p, c.req.param('id'))); });
  app.get(`${P}/agent/runs/:runId`, (c) => { const p = project(c, 'observe'); return c.json(svc().get(p, c.req.param('id'), c.req.param('runId'))); });
  app.post(`${P}/agent/runs/:runId/cancel`, (c) => { const p = project(c, 'edit'); return c.json(svc().cancel(p, c.req.param('id'), c.req.param('runId'))); });
  app.post(`${P}/agent/runs/:runId/continue`, async (c) => { const p = project(c, 'edit'); const b = await parse(c, AgentContinueBodySchema); return c.json(svc().continue(p, c.req.param('id'), c.req.param('runId'), b)); });
  app.post(`${P}/agent/runs/:runId/undo-all`, async (c) => { const p = project(c, 'edit'); const b = await parse(c, z.object({ dryRun: z.boolean().optional(), partial: z.boolean().optional() }).strict()); return c.json(svc().undoAll(p, c.req.param('id'), c.req.param('runId'), b)); });
  app.post(`${P}/undo-actor`, async (c) => { const p = project(c, 'edit'); const b = await parse(c, UndoActorBodySchema); return c.json(svc().undoActor(p, c.req.param('id'), b)); });
  // providers, keys, models (W2). Files are read per request (createAgentProviders keeps no state); the key never leaves the server.
  const prov = () => createAgentProviders(deps.store.dataDir);
  app.get('/api/v1/agent/providers', (c) => { need(c, 'observe'); return c.json(prov().view()); });
  app.put('/api/v1/agent/providers/:providerId', async (c) => {
    agentOwnerFloor(need(c, 'observe')); const id = providerOf(c.req.param('providerId'));
    const b = await parse(c, ProviderSettingsBodySchema);
    const p = prov(); const cur = p.keys.settingsOf(id);
    p.keys.writeSettings({ providerId: id, baseUrl: b.baseUrl ?? cur.baseUrl, model: b.model === undefined ? cur.model : b.model });
    return c.json(p.view());
  });
  app.put('/api/v1/agent/providers/:providerId/key', async (c) => {
    agentOwnerFloor(need(c, 'observe')); const id = providerOf(c.req.param('providerId'));
    const b = await parse(c, z.object({ key: z.string().max(AGENT_KEY_MAX_CHARS * 2) }).strict());
    return c.json(prov().keys.writeKey(id, b.key));
  });
  app.delete('/api/v1/agent/providers/:providerId/key', (c) => { agentOwnerFloor(need(c, 'observe')); const id = providerOf(c.req.param('providerId')); return c.json(prov().keys.deleteKey(id)); });
  app.post('/api/v1/agent/providers/:providerId/probe', async (c) => {
    agentOwnerFloor(need(c, 'observe')); const id = providerOf(c.req.param('providerId'));
    await parse(c, z.object({}).strict());
    return c.json(await prov().probe(id, c.req.raw.signal));
  });
  app.get('/api/v1/agent/models', (c) => { need(c, 'observe'); return c.json(prov().models()); });
  app.put('/api/v1/agent/models', async (c) => {
    agentOwnerFloor(need(c, 'observe')); const b = await parse(c, z.object({ rows: AgentModelTableSchema }).strict());
    const p = prov(); p.keys.writeOwnerModels(b.rows); return c.json(p.models());
  });
}
