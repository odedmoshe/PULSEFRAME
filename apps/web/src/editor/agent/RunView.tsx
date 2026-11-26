/**
 * The live run: status with WHY on the same line, step counter, cost or tokens, the plan, the steps with their expandable calls,
 * «עצירה», «להמשיך עוד 100 צעדים», and «ביטול הכול» with «לא בוטל: …» under the button every time (verifier C7). Rows are keyed by
 * step number and expand with native <details>, so a refresh never remounts a row and focus stays where it was.
 */
import { useEffect, useRef, useState } from 'react';
import type { AgentRun, AgentStep, UndoAllAnswer, UndoActorConflict } from '@pulseframe/core';
import { ApiFailure, api } from '../../api.ts';
import { Button } from '../../ds/index.ts';
import { AGENT_TESTIDS as ID } from './agent.testids.ts';
import { CONTINUE_STEPS, canContinue, canUndo, conflictText, conflictsOf, costLines, counterLine, failureText, framesOf, isActive, notUndoneTexts, prettyInput, statusWords, tr, type Lang } from './agentState.ts';

export function RunView({ lang, projectId, revision, run, steps, onChanged }: { lang: Lang; projectId: string; /** the project's current revision: a looked-at picture is drawn only while it is still the one the agent saw */ revision: number; run: AgentRun; steps: AgentStep[]; onChanged: () => void }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<{ code: string; text: string } | null>(null);
  const words = statusWords(lang, run, steps);
  const act = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what); setError(null);
    try { await fn(); onChanged(); } catch (e) { const f = e instanceof ApiFailure ? e : null; setError({ code: f?.code ?? 'error', text: failureText(lang, { status: f?.status, code: f?.code, message: f?.message ?? String(e) }) }); } finally { setBusy(''); }
  };
  return (
    <section className="pf-agent-run" aria-label={tr(lang, 'agent.steps')} data-testid={ID.run} data-run={run.id}>
      <p className="pf-agent-goal-shown" dir="auto"><span className="pf-agent-dim">{tr(lang, 'agent.goalShown')}: </span>{run.goal}</p>
      <p className="pf-agent-status" role="status" data-testid={ID.status} data-status={run.status}>
        <b>{words.status}</b>{words.why ? <span> · {words.why}</span> : null}
      </p>
      <p className="pf-agent-meta">
        <span data-testid={ID.counter}>{counterLine(lang, run)}</span>
        {costLines(lang, run, steps).map((l, i) => <span key={i} data-testid={i === 0 ? ID.cost : undefined}> · {l}</span>)}
      </p>
      <div className="pf-agent-actions">
        {isActive(run.status) ? <Button variant="danger-quiet" size="sm" busy={busy === 'cancel'} onClick={() => void act('cancel', () => api.cancelAgentRun(projectId, run.id))} data-testid={ID.cancel}>{tr(lang, 'agent.cancel')}</Button> : null}
        {canContinue(run.status) ? <Button variant="primary" size="sm" busy={busy === 'continue'} onClick={() => void act('continue', () => api.continueAgentRun(projectId, run.id, CONTINUE_STEPS))} data-testid={ID.continue}>{run.stopReason === 'step_limit' || run.stopReason === 'spend_limit' || run.stopReason === 'budget_reached' ? tr(lang, 'agent.continue', { n: CONTINUE_STEPS }) : tr(lang, 'agent.continueAfter')}</Button> : null}
      </div>
      {error ? <p className="pf-agent-warn" role="alert" data-testid={ID.error} data-code={error.code}>{error.text}</p> : null}
      <Plan lang={lang} plan={run.plan} />
      {run.summary ? <p className="pf-agent-summary" dir="auto"><b>{tr(lang, 'agent.summary')}: </b>{run.summary}</p> : null}
      <Steps lang={lang} projectId={projectId} revision={revision} steps={steps} />
      <UndoAll lang={lang} projectId={projectId} run={run} stepsKey={`${steps.length}:${steps.at(-1)?.status ?? ''}`} onChanged={onChanged} />
    </section>
  );
}

function Plan({ lang, plan }: { lang: Lang; plan: AgentRun['plan'] }) {
  return (
    <section className="pf-agent-plan" aria-label={tr(lang, 'agent.plan')} data-testid={ID.plan}>
      <h4>{tr(lang, 'agent.plan')}</h4>
      {plan.length === 0 ? <p className="pf-agent-dim">{tr(lang, 'agent.planEmpty')}</p> : (
        <ol>{plan.map((it, i) => <li key={i} data-testid={ID.planItem} data-status={it.status} dir="auto"><span className="pf-agent-chip" data-status={it.status}>{tr(lang, `agent.plan.${it.status}`)}</span> {it.title}</li>)}</ol>
      )}
    </section>
  );
}

function stepTitle(lang: Lang, s: AgentStep): string {
  if (s.kind === 'tool' && s.tool) return s.tool.tool;
  if (s.kind === 'model' && s.model) return s.model.text ? s.model.text.slice(0, 120) : tr(lang, 'agent.kind.model');
  return s.note?.text ?? tr(lang, 'agent.kind.note');
}

function Steps({ lang, projectId, revision, steps }: { lang: Lang; projectId: string; revision: number; steps: AgentStep[] }) {
  if (steps.length === 0) return <p className="pf-agent-dim">{tr(lang, 'agent.stepsEmpty')}</p>;
  return (
    <ol className="pf-agent-steps" aria-label={tr(lang, 'agent.steps')}>
      {steps.map((s) => (
        <li key={s.n} className="pf-agent-step" data-testid={ID.step} data-n={s.n} data-kind={s.kind} data-status={s.status}>
          <details data-testid={ID.stepCall}>
            <summary>
              <span className="num">{tr(lang, 'agent.stepN', { n: s.n })}</span> · <span>{tr(lang, `agent.kind.${s.kind}`)}</span> · <bdi dir="auto">{stepTitle(lang, s)}</bdi>
              <span className="pf-agent-chip" data-status={s.status}>{tr(lang, `agent.step.${s.status}`)}</span>
            </summary>
            <StepBody lang={lang} projectId={projectId} revision={revision} s={s} />
          </details>
        </li>
      ))}
    </ol>
  );
}

function StepBody({ lang, projectId, revision, s }: { lang: Lang; projectId: string; revision: number; s: AgentStep }) {
  if (s.kind === 'tool' && s.tool) {
    const frames = framesOf(s.tool.tool, s.tool.resultSummary);
    return (
      <div className="pf-agent-call">
        <h5>{tr(lang, 'agent.args')}</h5><pre dir="ltr">{prettyInput(s.tool.input)}</pre>
        <h5>{tr(lang, 'agent.result')}</h5>
        {s.tool.isError ? <p className="pf-agent-warn">{tr(lang, 'agent.errorCode', { code: s.tool.errorCode ?? '' })}</p> : null}
        <pre dir="auto">{s.tool.resultSummary ?? ''}</pre>
        {frames.length ? <div><h5>{tr(lang, 'agent.looked')}</h5><ul className="pf-agent-frames">{frames.map((f, i) => (
          <li key={i} data-testid={ID.stepImage} data-frame={f.frame} data-revision={f.revision} data-shown={f.revision === revision ? 'true' : 'false'}>
            {/* the frame is drawn now by the editor's compositor: shown only while the project is at the revision the agent saw */}
            {f.revision === revision ? <img src={api.agentFrameUrl(projectId, f)} alt={tr(lang, 'agent.frame', { frame: f.frame, revision: f.revision })} loading="lazy" width={96} /> : null}
            <span>{tr(lang, 'agent.frame', { frame: f.frame, revision: f.revision })}</span>
            {f.revision !== revision ? <span className="pf-agent-dim"> · {tr(lang, 'agent.frameChanged')}</span> : null}
          </li>))}</ul></div> : null}
      </div>
    );
  }
  if (s.kind === 'model' && s.model) return <div className="pf-agent-call"><h5>{tr(lang, 'agent.said')}</h5><pre dir="auto">{s.model.text ?? ''}</pre>{s.model.toolCalls.length ? <p className="pf-agent-dim" dir="ltr">{s.model.toolCalls.map((c) => c.tool).join(', ')}</p> : null}</div>;
  return <div className="pf-agent-call"><pre dir="auto">{s.note?.text ?? ''}</pre></div>;
}

/** «ביטול הכול»: the dry run shows what cannot be undone (under the button, every time) and what changed meanwhile; then the undo. */
function UndoAll({ lang, projectId, run, stepsKey, onChanged }: { lang: Lang; projectId: string; run: AgentRun; stepsKey: string; onChanged: () => void }) {
  const [preview, setPreview] = useState<UndoAllAnswer | null>(null);
  const [checking, setChecking] = useState(false);
  const [conflicts, setConflicts] = useState<UndoActorConflict[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const seq = useRef(0);
  const undoable = canUndo(run);
  useEffect(() => {
    if (!undoable) { setPreview(null); return; }
    const mine = ++seq.current; setChecking(true);
    api.undoAgentRun(projectId, run.id, { dryRun: true })
      .then((a) => { if (seq.current === mine) { setPreview(a); setConflicts(a.conflicts); setError(null); } })
      .catch((e) => { if (seq.current === mine) { const f = e instanceof ApiFailure ? e : null; if (f?.code === 'undo_conflict') setConflicts(conflictsOf(f.details)); else setError(failureText(lang, { status: f?.status, code: f?.code, message: f?.message ?? String(e) })); } })
      .finally(() => { if (seq.current === mine) setChecking(false); });
  }, [projectId, run.id, undoable, stepsKey, lang]);
  const doUndo = async (partial: boolean) => {
    setBusy(true); setError(null);
    try { await api.undoAgentRun(projectId, run.id, partial ? { partial: true } : {}); setDone(true); setConflicts([]); onChanged(); }
    catch (e) {
      const f = e instanceof ApiFailure ? e : null;
      if (f?.code === 'undo_conflict') setConflicts(conflictsOf(f.details));
      else setError(failureText(lang, { status: f?.status, code: f?.code, message: f?.message ?? String(e) }));
    } finally { setBusy(false); }
  };
  if (run.undoneBy || done) return <p className="pf-agent-ok" role="status">{tr(lang, 'agent.undone')}</p>;
  if (!undoable) return null;
  const items = notUndoneTexts(lang, preview?.notUndone ?? []);
  return (
    <section className="pf-agent-undo" aria-label={tr(lang, 'agent.undoAll')}>
      <div className="pf-agent-actions">
        <Button variant="secondary" size="sm" busy={busy} onClick={() => void doUndo(false)} data-testid={ID.undoAll}>{tr(lang, 'agent.undoAll')}</Button>
        {conflicts.length ? <Button variant="secondary" size="sm" busy={busy} onClick={() => void doUndo(true)} data-testid={ID.undoPartial}>{tr(lang, 'agent.undoPartial')}</Button> : null}
      </div>
      <p className="pf-agent-dim">{tr(lang, 'agent.undoAllWhat')}{preview && preview.entities > 0 ? ` · ${tr(lang, 'agent.undoCounts', { entities: preview.entities })}` : ''}</p>
      {preview && preview.undoes.length === 0 && preview.entities === 0 ? <p className="pf-agent-dim">{tr(lang, 'agent.undoNothing')}</p> : null}
      {conflicts.length ? (
        <div data-testid={ID.undoConflicts}>
          <p className="pf-agent-warn">{tr(lang, 'agent.undoConflict', { count: conflicts.length })}</p>
          <ul>{conflicts.map((c) => <li key={c.entityId} dir="auto">{conflictText(lang, c)}</li>)}</ul>
        </div>
      ) : null}
      <div data-testid={ID.notUndone} aria-live="polite">
        {checking && !preview ? <p className="pf-agent-dim">{tr(lang, 'agent.undoChecking')}</p> : items.length ? (
          <><p><b>{tr(lang, 'agent.notUndone')}</b></p>
            <ul>{items.map((it, i) => <li key={`${it.kind}${i}`} data-testid={ID.notUndoneItem} data-kind={it.kind} dir="auto">{it.text}</li>)}</ul></>
        ) : preview ? <p className="pf-agent-dim">{tr(lang, 'agent.notUndoneNone')}</p> : null}
      </div>
      {error ? <p className="pf-agent-warn" role="alert" data-testid={ID.error}>{error}</p> : null}
    </section>
  );
}
