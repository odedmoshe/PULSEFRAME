/**
 * "Check again" in the AI tools panel, kept apart from the panel so it can be tested without a browser.
 * A check that fails (the server is still restarting, the session is no longer known) says nothing about the provider, so
 * it must not change what the panel shows: the setup steps, the failure and the button to try again all stay.
 */
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
