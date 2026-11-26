/**
 * The «סוכן» tab of the Copilot (wave 8 autonomy Part 2, builder W3). Not connected: the connect card «חיבור מודל» first. Connected:
 * the goal box, the live run (RunView), the list of earlier runs, and the card below. Live progress: the job event of the run's
 * job (type agent.run, stage step:<n>:<status>) on the project's event stream, then GET the run; a slow poll covers a stream that is
 * down. Everything the tab shows comes from the server's answers; a 501 agent_not_built is shown as what it is.
 * Strings: packages/i18n/src/agent.ts. Test ids: agent.testids.ts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentProvidersAnswer, AgentRun, AgentStep } from '@pulseframe/core';
import { AGENT_LIMITS } from '@pulseframe/core';
import { Send } from 'lucide-react';
import { ApiFailure, api, type JobEvent } from '../../api.ts';
import { Button } from '../../ds/index.ts';
import { useEditorState } from '../store.ts';
import { AGENT_TESTIDS as ID } from './agent.testids.ts';
import { ConnectCard } from './ConnectCard.tsx';
import { RunView } from './RunView.tsx';
import { failureText, isActive, modelRows, pickRun, tr, type Lang, type ModelRow } from './agentState.ts';
import './agent.css';

/** Copilot.tsx shows this panel instead of its honest «not connected» chat panel only while this is true. */
export const AGENT_TAB_BUILT: boolean = true;

const POLL_MS = 4000;

export function AgentTab() {
  const { state } = useEditorState();
  const lang: Lang = state.lang;
  const projectId = state.doc?.id ?? null;
  const [providers, setProviders] = useState<AgentProvidersAnswer | null>(null);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [loadError, setLoadError] = useState<{ code: string; text: string } | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [current, setCurrent] = useState<{ run: AgentRun; steps: AgentStep[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [goal, setGoal] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<{ code: string; text: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const errOf = useCallback((e: unknown) => { const f = e instanceof ApiFailure ? e : null; return { code: f?.code ?? 'error', text: failureText(lang, { status: f?.status, code: f?.code, message: f?.message ?? String(e) }) }; }, [lang]);

  const loadProviders = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([api.agentProviders(), api.agentModels().catch(() => ({ rows: [] as unknown[] }))]);
      if (!alive.current) return;
      setProviders(p); setModels(modelRows(m.rows)); setLoadError(null);
    } catch (e) { if (alive.current) setLoadError(errOf(e)); }
  }, [errOf]);

  const loadRuns = useCallback(async () => {
    if (!projectId) return;
    try {
      const { runs: list } = await api.listAgentRuns(projectId);
      if (!alive.current) return;
      setRuns(list);
      return list;
    } catch { return undefined; }
  }, [projectId]);

  /** Read one run with its steps; requests that come back out of order are dropped. Coalesced while one is in flight. */
  const seq = useRef(0);
  const inflight = useRef(false); const again = useRef(false);
  const refresh = useCallback(async (runId: string) => {
    if (!projectId) return;
    if (inflight.current) { again.current = true; return; }
    inflight.current = true;
    try {
      do {
        again.current = false;
        const mine = ++seq.current;
        const a = await api.getAgentRun(projectId, runId).catch(() => null);
        if (a && alive.current && mine === seq.current) setCurrent({ run: a.run, steps: a.steps });
      } while (again.current && alive.current);
    } finally { inflight.current = false; }
    void loadRuns();
  }, [projectId, loadRuns]);

  useEffect(() => { void loadProviders(); }, [loadProviders]);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void loadRuns().then((list) => { const r = list ? pickRun(list) : null; if (!cancelled && r) void refresh(r.id); });
    return () => { cancelled = true; };
  }, [projectId, loadRuns, refresh]);

  // live: the job event of the run's job, plus a slow poll while the run is active (the stream may be down)
  const runId = current?.run.id ?? null;
  const jobId = current?.run.jobId ?? null;
  const active = current ? isActive(current.run.status) : false;
  const revisionRef = useRef(state.revision); revisionRef.current = state.revision;
  useEffect(() => {
    if (!projectId || !runId || !active) return;
    const es = api.events(projectId, revisionRef.current);
    es.addEventListener('job', (m) => { try { const j = JSON.parse((m as MessageEvent).data) as JobEvent; if (j.type === 'agent.run' && j.id === jobId) void refresh(runId); } catch { /* a malformed event is skipped */ } });
    const timer = window.setInterval(() => void refresh(runId), POLL_MS);
    return () => { es.close(); window.clearInterval(timer); };
  }, [projectId, runId, jobId, active, refresh]);

  const providerId = selected ?? providers?.defaultProviderId ?? null;
  const connected = !!providers?.defaultProviderId;
  const busy = !!current && active;
  const reason = !connected ? tr(lang, 'agent.connectFirst') : busy ? tr(lang, 'agent.runBusy') : !goal.trim() ? tr(lang, 'agent.goalNeeded') : undefined;

  const start = async () => {
    if (!projectId || reason) return;
    setStarting(true); setStartError(null);
    try {
      const a = await api.startAgentRun(projectId, { goal: goal.trim(), ...(providerId ? { providerId } : {}), stepLimit: AGENT_LIMITS.defaultStepLimit });
      setGoal('');
      await refresh(a.runId);
    } catch (e) { setStartError(errOf(e)); } finally { setStarting(false); }
  };
  const open = (id: string) => void refresh(id);

  const card = providers ? <ConnectCard lang={lang} providers={providers.providers} models={models} selected={providerId} onSelect={setSelected} onChanged={() => void loadProviders()} /> : null;
  const earlier = runs.filter((r) => r.id !== runId);

  return (
    <div role="tabpanel" id="pf-cop-panel-chat" aria-labelledby="pf-cop-panel-tab-chat" className="pf-cop-body pf-agent" data-testid={ID.tab}>
      {loadError ? <p className="pf-agent-warn" role="alert" data-testid={ID.error} data-code={loadError.code}>{loadError.text}</p> : null}
      {!providers && !loadError ? <p className="pf-agent-dim" role="status">{tr(lang, 'agent.connect.loading')}</p> : null}
      {providers && !connected ? <p className="pf-agent-dim" role="status">{tr(lang, 'agent.notConnected')}</p> : null}
      {providers && !connected ? card : null}
      {providers ? (
        <form className="pf-agent-goal" onSubmit={(e) => { e.preventDefault(); void start(); }}>
          <label htmlFor="pf-agent-goal">{tr(lang, 'agent.goalLabel')}</label>
          <textarea id="pf-agent-goal" rows={3} dir="auto" maxLength={AGENT_LIMITS.goalChars} value={goal} placeholder={tr(lang, 'agent.goalPlaceholder')} onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void start(); } }} data-testid={ID.goal} />
          <Button type="submit" variant="primary" size="md" busy={starting} disabledReason={reason} icon={<Send size={16} aria-hidden="true" />} data-testid={ID.start}>{tr(lang, 'agent.start')}</Button>
          {startError ? <p className="pf-agent-warn" role="alert" data-testid={ID.error} data-code={startError.code}>{startError.text}</p> : null}
        </form>
      ) : null}
      {current && projectId ? <RunView lang={lang} projectId={projectId} run={current.run} steps={current.steps} onChanged={() => void refresh(current.run.id)} /> : null}
      {providers ? (
        <section className="pf-agent-runs" aria-label={tr(lang, 'agent.runs')} data-testid={ID.runs}>
          <h4>{tr(lang, 'agent.runs')}</h4>
          {runs.length === 0 ? <p className="pf-agent-dim">{tr(lang, 'agent.runs.empty')}</p> : earlier.length === 0 ? null : (
            <ul>{earlier.map((r) => (
              <li key={r.id} data-status={r.status}>
                <span className="pf-agent-chip" data-status={r.status}>{tr(lang, `agent.status.${r.status}`)}</span> <bdi dir="auto" className="pf-agent-runs-goal">{r.goal}</bdi>
                <Button variant="ghost" size="sm" onClick={() => open(r.id)} aria-label={tr(lang, 'agent.runs.goal', { goal: r.goal.slice(0, 60) })}>{tr(lang, 'agent.runs.open')}</Button>
              </li>))}
            </ul>)}
        </section>
      ) : null}
      {providers && connected ? card : null}
    </div>
  );
}
