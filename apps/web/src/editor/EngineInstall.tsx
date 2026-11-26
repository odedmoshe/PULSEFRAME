import { useEffect, useState } from 'react';
import { api, ApiFailure, type SpeechEngineInstall } from '../api.ts';
import { downloadMb, failureWords, refusalWords, stageWords, stepWords } from './engineInstall.logic.ts';
import { ENGINE_STRINGS } from './engineInstall.strings.ts';
import { useEditorState } from './store.ts';

type Outcome = { kind: 'done' } | { kind: 'canceled' } | { kind: 'failed'; error: { code?: string; details?: Record<string, unknown> } } | { kind: 'refused'; code?: string };

/**
 * «התקנת מנוע הדיבור» inside the speech panel's setup state: what will happen (bytes from pypi.org, into the data folder), one
 * confirming press, the job's step and numbers with a cancel button, and each failure with its next step. The panel's manual way
 * («איך מגדירים») stays beside it. Only the owner's own session gets the plan (403 otherwise): then this shows nothing.
 * `broken`: the engine installed from here does not answer, so the button installs it again (replace).
 */
export function EngineInstall({ onChanged, broken = false }: { onChanged: () => void; broken?: boolean }) {
  const { state } = useEditorState();
  const lang = state.lang === 'en' ? 'en' : 'he';
  const E = ENGINE_STRINGS[lang];
  const [view, setView] = useState<SpeechEngineInstall | 'denied' | null>(null);
  const [asking, setAsking] = useState(false);
  const [job, setJob] = useState<{ id: string; stage: string | null } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const load = () => api.speechEngine().then((v) => { setView(v); if (v.job) setJob({ id: v.job.id, stage: v.job.stage }); else if (v.lastFailure && !outcome) setOutcome({ kind: 'failed', error: { code: v.lastFailure.code, details: v.lastFailure.details } }); })
    .catch((e) => setView(e instanceof ApiFailure && e.status === 403 ? 'denied' : null));
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!job) return;
    let live = true;
    let timer = 0;
    const tick = async () => {
      try {
        const j = (await api.job(job.id)) as { status: string; stage?: string | null; error?: { code?: string; details?: Record<string, unknown> } };
        if (!live) return;
        if (['succeeded', 'failed', 'canceled'].includes(j.status)) {
          setJob(null);
          setOutcome(j.status === 'succeeded' ? { kind: 'done' } : j.status === 'canceled' ? { kind: 'canceled' } : { kind: 'failed', error: j.error ?? {} });
          void load();
          onChanged();
          return;
        }
        setJob((cur) => (cur && cur.id === job.id ? { ...cur, stage: j.stage ?? null } : cur));
      } catch { /* the next tick tries again */ }
      if (live) timer = window.setTimeout(tick, 1000);
    };
    timer = window.setTimeout(tick, 500);
    return () => { live = false; window.clearTimeout(timer); };
  }, [job?.id]);

  // another credential than the owner's own session (403), or the plan could not be read: the panel's manual way stays, alone
  if (view === 'denied' || view === null) return null;
  if (view.state === 'environment') return null;
  const plan = view.plan;
  const pid = state.doc?.id;
  const start = () => {
    if (!pid || !plan.downloadBytes) return;
    setAsking(false); setOutcome(null);
    api.installSpeechEngine(pid, plan.downloadBytes, broken).then((r) => setJob({ id: r.jobId, stage: null }))
      .catch((e) => setOutcome({ kind: 'refused', code: e instanceof ApiFailure ? e.code : undefined }));
  };
  const words = outcome?.kind === 'failed' ? failureWords(outcome.error, lang) : null;
  const st = job ? stageWords(job.stage, lang) : null;
  return (
    <div className="pf-engine" data-testid="engine-install" data-state={job ? 'installing' : outcome?.kind ?? view.state}>
      {broken && !job && <p>{E.brokenInstalled}</p>}
      {job && st ? (
        <p role="status" data-testid="engine-progress">
          {st.step !== null && <span className="muted">{stepWords(st.step, lang)} · </span>}
          <bdi>{st.text}</bdi>
          {st.total ? <> <progress max={st.total} value={st.done ?? 0} /></> : null}{' '}
          <button className="ghost" onClick={() => void api.cancelJob(job.id).catch(() => {})} data-testid="engine-cancel">{E.cancel}</button>
        </p>
      ) : !plan.supported ? (
        <p className="muted">{E.unsupported}</p>
      ) : (
        <>
          {!broken && <p>{E.intro}</p>}
          <p className="muted" data-testid="engine-what">{plan.downloadBytes ? (plan.python.found && plan.python.fits
            ? E.what({ mb: downloadMb(plan.downloadBytes), files: String(plan.files ?? ''), python: plan.python.version })
            : E.whatNoPython({ mb: downloadMb(plan.downloadBytes), files: String(plan.files ?? '') })) : null}</p>
          <p className="muted">{E.model} {E.noPromise}</p>
          {asking ? (
            <p data-testid="engine-confirm"><b>{E.confirm}</b>{' '}
              <button onClick={start} data-testid="engine-yes">{E.yes}</button>{' '}
              <button className="ghost" onClick={() => setAsking(false)}>{E.no}</button>
            </p>
          ) : (
            <p><button onClick={() => setAsking(true)} data-testid="engine-start">{broken ? E.reinstall : E.install}</button></p>
          )}
        </>
      )}
      {outcome && (
        <div role="status" data-testid="engine-note" data-kind={outcome.kind} data-code={outcome.kind === 'failed' ? outcome.error.code : outcome.kind === 'refused' ? outcome.code : undefined}>
          {outcome.kind === 'done' ? <p>{E.done}</p> : outcome.kind === 'canceled' ? <p>{E.canceled}</p> : outcome.kind === 'refused' ? <p>{refusalWords(outcome.code, lang)}</p> : words && (
            <>
              <p>{words.what}</p>
              <p>{words.next}</p>
              {words.lines && <details><summary>{E.pipLines}</summary><pre dir="ltr"><bdi>{words.lines}</bdi></pre></details>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
