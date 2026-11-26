/**
 * REST routes of the in-editor agent (wave 8 autonomy Part 2; core AGENT_ROUTES). LEAD PRE-PASS: every route registered with its
 * checks in order (scope, the project may be read, the body parses, the owner floor where it applies) and then the service, which
 * answers 501 agent_not_built until W1 (runs) and W2 (providers, keys, models) build it. W1 owns the run handlers, W2 the
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
import { agentNotBuilt, type AgentRunService } from './loop.ts';

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
  // providers, keys, models (W2): 501 after the checks
  app.get('/api/v1/agent/providers', (c) => { need(c, 'observe'); throw agentNotBuilt(); });
  app.put('/api/v1/agent/providers/:providerId', (c) => { agentOwnerFloor(need(c, 'observe')); providerOf(c.req.param('providerId')); throw agentNotBuilt(); });
  app.put('/api/v1/agent/providers/:providerId/key', (c) => { agentOwnerFloor(need(c, 'observe')); providerOf(c.req.param('providerId')); throw agentNotBuilt(); });
  app.delete('/api/v1/agent/providers/:providerId/key', (c) => { agentOwnerFloor(need(c, 'observe')); providerOf(c.req.param('providerId')); throw agentNotBuilt(); });
  app.post('/api/v1/agent/providers/:providerId/probe', (c) => { agentOwnerFloor(need(c, 'observe')); providerOf(c.req.param('providerId')); throw agentNotBuilt(); });
  app.get('/api/v1/agent/models', (c) => { need(c, 'observe'); throw agentNotBuilt(); });
  app.put('/api/v1/agent/models', async (c) => { agentOwnerFloor(need(c, 'observe')); await parse(c, z.object({ rows: AgentModelTableSchema }).strict()); throw agentNotBuilt(); });
}
