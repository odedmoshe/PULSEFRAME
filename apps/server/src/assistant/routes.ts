/**
 * The handlers of the assistant's routes (ADR-0027; contract.ts ASSISTANT_ROUTES). http.ts parses the bodies with core's
 * schemas, checks the scope and the owner session, and calls these; every handler checks the owner again itself
 * (isOwnerSession), so a handler reached any other way still refuses an agent with 403 owner_required.
 *
 *  - status (observe): the setup state from the config file, the key file (only whether it exists and when it was written),
 *    the installed adapters (none in wave 1) and the month's ledger. Never the key, nor any part of it.
 *  - summary (owner): exactly the AssistantSummary a request would send now.
 *  - putConfig / putKey / deleteKey (owner): the files of credential.ts (0600, temp then rename; the host must be in
 *    PF_ASSISTANT_HOSTS).
 *  - request (owner): job.ts; 409 assistant_not_connected with no job row while the setup is not ready.
 *
 * Besides the contract's handlers the object carries `cancel` (for the jobs cancel route) and `done` (tests, the proof).
 */
import type { Config } from '../config.ts';
import type { Governance, Principal } from '../governance.ts';
import { ApiError, type Store } from '../store.ts';
import { isOwnerSession, type AssistantDeps, type AssistantHandlers, type AssistantStatus } from './contract.ts';
import { AssistantFiles } from './credential.ts';
import { AssistantJobs, assistantSetup, type AssistantRuntime } from './job.ts';
import { assistantSummary } from './summary.ts';

export interface AssistantRouteContext { cfg: Config; store: Store; gov: Governance; deps: AssistantDeps }
export interface AssistantJobControls {
  /** POST /api/v1/jobs/:jobId/cancel and MCP cancel_job for an assistant.propose job: the one cancel both surfaces call (http.ts hands it to createMcp's bindAssistant). */
  cancel(p: Principal, jobId: string): ReturnType<AssistantJobs['cancel']>;
  /** Resolves when a job started here has finished its run. */
  done(jobId: string): Promise<void>;
}

/**
 * Who may cancel an assistant job (ADR-0027 decisions 8 and 10 with its note of 2026-11-24; ADR-0002): the owner's own session only.
 * The request is the owner's (their words, their money), it runs as agent:assistant, a principal no token can be, and "agents
 * may only cancel their own jobs" has one exception, which is not this. The one refusal REST and MCP give an agent credential
 * (http.ts assertMayCancel, and the handler below): the reason with the next step (the row's «ביטול הבקשה» button in the
 * owner's command bar, AssistantRow.tsx), the job id it was asked about and nothing else
 * of the job (no status, no stage, nothing of the request).
 */
export const assistantCancelRefusal = (jobId: string) => new ApiError(403, 'owner_required',
  'a language-assistant request belongs to the owner\'s own session, so an agent credential cannot cancel it', { jobId },
  'Ask the owner to cancel it in the editor\'s command bar («ביטול הבקשה», Cancel the request); left alone it ends when the service answers, and it only ever makes a proposal the owner accepts or rejects.');

const owner = (p: Principal) => {
  if (!isOwnerSession(p)) throw new ApiError(403, 'owner_required', 'the language assistant is set up and used from the owner\'s own session only', undefined, 'The owner sets it up in Settings.');
};

export function createAssistantHandlers(ctx: AssistantRouteContext): AssistantHandlers & AssistantJobControls {
  const rt: AssistantRuntime = { ...ctx, files: new AssistantFiles(ctx.cfg.dataDir, ctx.cfg.assistantHosts) };
  const jobs = new AssistantJobs(rt);
  const status = (): AssistantStatus => {
    const s = assistantSetup(rt);
    const spend = ctx.gov.assistantSpend();
    const c = s.config;
    // field by field: never the key, never the config object passed through
    return {
      setup: s.setup, detail: s.detail,
      adapter: c.adapter, host: c.host, model: c.model,
      pricesCentsPerMTok: c.pricesCentsPerMTok ? { input: c.pricesCentsPerMTok.input, output: c.pricesCentsPerMTok.output } : null,
      monthlyLimitCents: c.monthlyLimitCents, perRequestCapCents: c.perRequestCapCents,
      month: spend.month, spentCents: spend.spentCents, reservedCents: spend.reservedCents,
      toggles: { titlesAndMarkers: c.toggles.titlesAndMarkers, peopleNames: c.toggles.peopleNames },
      keySet: s.keySet, keyAddedAt: s.keyAddedAt,
      adapters: [...ctx.deps.adapters.keys()],
    };
  };
  return {
    status: () => status(),
    summary: (p, projectId, sctx) => {
      owner(p);
      const { doc } = ctx.store.getProject(projectId);
      return assistantSummary(doc, sctx, rt.files.readConfig().config.toggles);
    },
    putConfig: (p, body) => { owner(p); rt.files.writeConfig(body); return status(); },
    putKey: (p, key) => { owner(p); return rt.files.writeKey(key); },
    deleteKey: (p) => { owner(p); return rt.files.deleteKey(); },
    request: (p, projectId, body) => { owner(p); return jobs.start(p, projectId, body); },
    cancel: (p, jobId) => { if (!isOwnerSession(p)) throw assistantCancelRefusal(jobId); return jobs.cancel(jobId, p.actor); },
    done: (jobId) => jobs.done(jobId),
  };
}
