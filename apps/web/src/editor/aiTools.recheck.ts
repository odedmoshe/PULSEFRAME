/**
 * "Check again" in the AI tools panel, kept apart from the panel so it can be tested without a browser.
 * A check that fails (the server is still restarting, the session is no longer known) says nothing about the provider, so
 * it must not change what the panel shows: the setup steps, the failure and the button to try again all stay.
 */
import { ApiFailure, type JobEvent } from '../api.ts';

export interface ProviderShape { provider: { configured: boolean; readiness?: { reachable: boolean } | null } }
export type RecheckResult<P> = { ok: true; provider: P; connected: boolean } | { ok: false; error: unknown };

export async function recheckProvider<P extends ProviderShape>(fetchCapabilities: () => Promise<P>): Promise<RecheckResult<P>> {
  try {
    const provider = await fetchCapabilities();
    return { ok: true, provider, connected: provider.provider.configured && !!provider.provider.readiness?.reachable };
  } catch (error) {
    return { ok: false, error };
  }
}

/** The provider state the panel shows after a check: the fresh answer, or exactly what it showed before when the check failed. */
export const providerAfter = <P>(shown: P, r: RecheckResult<P>): P => (r.ok ? r.provider : shown);

/** Why a request for the provider state failed, as the panel says it: the server's refusal code, or none when it did not answer. */
export interface ProviderFailure { code: string | null; message: string }
export function failureOf(e: unknown): ProviderFailure {
  if (e instanceof ApiFailure) return { code: e.code, message: e.message };
  return { code: null, message: e instanceof Error ? e.message : String(e) };
}

/**
 * The latest event of each recent capability job, by id: the event just received replaces that job's earlier one and becomes
 * the newest; only the newest `keep` jobs are kept. Events of several jobs that arrive together are all kept, so a panel
 * that started one of them still sees how it ended.
 */
export function rememberJob(all: Readonly<Record<string, JobEvent>>, j: JobEvent, keep = 30): Record<string, JobEvent> {
  const next: Record<string, JobEvent> = { ...all };
  delete next[j.id];
  next[j.id] = j;
  const ids = Object.keys(next);
  for (const id of ids.slice(0, Math.max(0, ids.length - keep))) delete next[id];
  return next;
}

/**
 * The job a tool card shows: the one this panel started for that tool, as its latest event says, or none. A capability job
 * started by anyone else (an agent, another tool, another tab) is not shown on a card: the job events do not say which tool
 * they belong to, and the card speaks only of what its own button did.
 */
export const cardJob = (capabilityId: string, started: Readonly<Record<string, string>>, jobs: Readonly<Record<string, JobEvent>>): JobEvent | null => {
  const id = started[capabilityId];
  return id ? jobs[id] ?? null : null;
};
