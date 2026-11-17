/**
 * AI tools panel: what the optional ComfyUI provider offers, the state of each tool and why, running a tool on a library picture,
 * and plain setup steps when the provider is not connected. Nothing here fakes a result: every result is a job the server ran and
 * validated; the server imports its primary output into the library as a derived asset.
 */
import { useState } from 'react';
import { dictionaries } from '@pulseframe/i18n';
import { api, ApiFailure } from '../api.ts';
import { useEditorState } from './store.ts';
import { AI_STRINGS } from './aiTools.strings.ts';
import { cardJob, failureOf, providerAfter, recheckProvider } from './aiTools.recheck.ts';
import './aiTools.css';

interface ModelInfo { path: string; status?: { state: string; missingBytes: number; expectedBytes: number | null } }
interface Cap {
  id: string; runnable: boolean; title: { he: string; en: string }; description?: { he: string; en: string };
  inputs?: { name: string; type: string; required: boolean }[];
  models?: ModelInfo[]; blockers?: { code: string; message: string }[]; experimental?: boolean;
}
/** Blockers a run does not wait for (they are earned by running); they become badges, not reasons. */
const EARNED = new Set(['not_executed', 'not_hardwareQualified', 'not_qualityReviewed', 'not_hebrewQualified']);

/** Decimal MB/GB, as a download size. This is disk transfer, not memory use. */
function size(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

export function AiTools() {
  const { editor, state, t } = useEditorState();
  const { provider, capJob: job, doc, lang, approvals } = state;
  const S = AI_STRINGS[lang];
  const [msg, setMsg] = useState<{ text: string; failed: boolean }>({ text: '', failed: false });
  const [checking, setChecking] = useState(false);
  const [pick, setPick] = useState<Record<string, string>>({});
  /** Tool id -> the job this panel last started for it. A card shows that job only (aiTools.recheck.ts cardJob). */
  const [mine, setMine] = useState<Record<string, string>>({});
  const [runError, setRunError] = useState<{ capId: string; message: string } | null>(null);
  const why = (f: { code: string | null; message: string }) => (f.code ? (dictionaries[lang] as Record<string, string>)[`error.code.${f.code}`] ?? f.message : f.message);

  if (!provider) {
    // The first request for the provider state failed: say so, and what came back, with a way to ask again. Nothing about
    // the provider is assumed from a failed request (it may be connected or not).
    const failed = state.providerError;
    if (failed) {
      const retry = async () => {
        setChecking(true); setMsg({ text: S.rechecking, failed: false });
        const r = await recheckProvider(api.capabilities);
        if (r.ok) { editor.set({ provider: r.provider, providerError: null }); setMsg({ text: '', failed: false }); }
        else { editor.set({ providerError: failureOf(r.error) }); setMsg({ text: S.loadStillFailing, failed: true }); }
        setChecking(false);
      };
      return (
        <section className="pf-ai" data-testid="ai-tools" aria-label={S.tools}>
          <div className="pf-ai-failed" role="alert" data-testid="ai-load-failed" data-code={failed.code ?? undefined}>
            <p>{S.loadFailed}</p>
            <p className="muted">{failed.code ? <>{S.loadAnswered} <bdi dir="auto" data-testid="ai-load-reason">{why(failed)}</bdi></> : <>{S.loadNoAnswer} <bdi dir="auto" data-testid="ai-load-reason">{failed.message}</bdi></>}</p>
          </div>
          <div className="pf-ai-row">
            <button type="button" className="ghost" disabled={checking} onClick={() => void retry()} data-testid="ai-load-retry">{S.loadRetry}</button>
          </div>
          <div role="status" className={`muted${msg.failed ? ' danger' : ''}`} data-testid="ai-load-status">{msg.text}</div>
          <p className="muted">{S.works}</p>
        </section>
      );
    }
    if (state.providerAsking) return <section className="pf-ai" data-testid="ai-tools" aria-label={S.tools}><p className="muted" role="status" data-testid="ai-loading">{S.loading}</p></section>;
    return null; // not asked yet (no project loaded)
  }
  const pr = provider.provider;
  const connected = pr.configured && !!pr.readiness?.reachable;

  const recheck = async () => {
    setChecking(true); setMsg({ text: S.rechecking, failed: false });
    const r = await recheckProvider(api.capabilities);
    // A failed check keeps the panel as it is (setup steps, this message, the button): it says nothing about the provider.
    editor.set({ provider: providerAfter(editor.getState().provider, r) });
    if (r.ok) setMsg({ text: r.connected ? S.recheckedOk : S.rechecked, failed: false });
    else if (r.error instanceof ApiFailure) setMsg({ text: S.recheckRefused(why(failureOf(r.error))), failed: true });
    else setMsg({ text: S.recheckFailed, failed: true });
    setChecking(false);
  };

  const status = !pr.configured
    ? <p className="muted" data-testid="provider-status" data-state="not-configured">{t('providers.notConfigured')}</p>
    : !pr.readiness?.reachable
      ? <p className="muted" data-testid="provider-status" data-state="unreachable">{t('providers.unreachable')}</p>
      : <p className="muted" data-testid="provider-status" data-state="ready">{t('providers.ready')} · <bdi>{pr.readiness.runtimeVersion} · {pr.readiness.device?.type}</bdi></p>;

  if (!connected) {
    return (
      <section className="pf-ai" data-testid="ai-tools" aria-label={S.tools}>
        {status}
        <div className="pf-ai-how" data-testid="ai-setup">
          <h3>{S.howTitle}</h3>
          {pr.configured && <p className="muted">{S.unreachableWhy}</p>}
          <ol>
            <li>{S.steps[0]}</li>
            <li>{S.steps[1]}</li>
            <li>{S.steps[2]} <code dir="ltr">{S.example}</code>
              <div className="muted">{S.modelsDirNote.split('PF_COMFYUI_MODELS_DIR')[0]}<code dir="ltr">PF_COMFYUI_MODELS_DIR</code>{S.modelsDirNote.split('PF_COMFYUI_MODELS_DIR')[1]}</div>
            </li>
            <li>{S.steps[3]}</li>
          </ol>
        </div>
        <div className="pf-ai-row">
          <button className="ghost" disabled={checking} onClick={() => void recheck()} data-testid="ai-recheck">{S.recheck}</button>
        </div>
        <div role="status" className={`muted${msg.failed ? ' danger' : ''}`} data-testid="ai-recheck-status" data-failed={msg.failed ? 'true' : undefined}>{msg.text}</div>
        <p className="muted">{S.works}</p>
      </section>
    );
  }

  const caps = provider.capabilities as unknown as Cap[];
  const device = pr.readiness?.device;
  const deviceText = device ? `${device.name} (${device.type})` : S.unknownDevice;
  const images = doc ? Object.values(doc.assets).filter((a) => a.kind === 'image') : [];
  // The picture of the selected timeline clip, when it is one.
  let selAsset = '';
  if (doc && state.selection.length === 1) {
    for (const tr of doc.sequences[doc.mainSequenceId]?.tracks ?? []) {
      const c = tr.clips.find((x) => x.id === state.selection[0]);
      if (c && c.type === 'media' && doc.assets[c.assetId]?.kind === 'image') selAsset = c.assetId;
    }
  }
  const busy = !!job && ['queued', 'running', 'cancel-requested'].includes(job.status);

  const run = async (cap: Cap, assetId: string | null) => {
    if (!doc) return;
    setRunError(null);
    try {
      const jobId = await editor.runCapability(cap.id, assetId ? { image: assetId } : {});
      if (jobId) setMine((m) => ({ ...m, [cap.id]: jobId }));
    } catch (e) {
      setRunError({ capId: cap.id, message: e instanceof Error ? e.message : String(e) });
    }
  };

  const reasons = (c: Cap): string[] => {
    const out: string[] = [];
    for (const m of c.models ?? []) {
      const st = m.status;
      if (!st || st.state === 'ready') continue;
      if (st.state === 'missing') out.push(S.modelMissing(m.path, size(st.missingBytes)));
      else if (st.state === 'partial-download') out.push(S.modelPartial(m.path, size(st.missingBytes)));
      else if (st.state === 'corrupt') out.push(S.modelCorrupt(m.path));
      else if (st.state === 'unverifiable') out.push(S.modelUnverifiable(m.path));
      else out.push(S.modelUnresolved(m.path));
    }
    for (const b of c.blockers ?? []) {
      if (EARNED.has(b.code)) continue;
      out.push(S.blockers[b.code] ?? `${S.unknownBlocker}: ${b.message}`);
    }
    return [...new Set(out)];
  };

  return (
    <section className="pf-ai" data-testid="ai-tools" aria-label={S.tools}>
      {status}
      {/* the run buttons wait for any running tool job; when it is not one this panel started, say so (otherwise they are disabled with no reason) */}
      {busy && !Object.values(mine).includes(job!.id) && <p className="muted" role="status" data-testid="ai-other-job">{S.otherJob}</p>}
      {caps.map((c) => {
        const takesImage = !!c.inputs?.some((i) => i.type === 'image');
        const codes = new Set((c.blockers ?? []).map((b) => b.code));
        const why = c.runnable ? [] : reasons(c);
        const needsDownload = (c.models ?? []).some((m) => m.status && ['missing', 'partial-download', 'corrupt'].includes(m.status.state));
        const pending = approvals.some((a) => a.action?.capabilityId === c.id);
        const value = pick[c.id] ?? selAsset;
        const chosen = images.some((a) => a.id === value) ? value : '';
        const smoke = !takesImage;
        // only the job this card's own button started, never another tool's (or an agent's) job
        const active = cardJob(c.id, mine, state.capJobs);
        const runBusy = !!active && ['queued', 'running', 'cancel-requested'].includes(active.status);
        return (
          <article className="pf-ai-card" key={c.id} data-testid="ai-tool" data-id={c.id} data-runnable={c.runnable ? 'true' : 'false'}>
            <h3>{c.title[lang]}</h3>
            {c.description && <p className="muted">{c.description[lang]}</p>}
            <div className="pf-ai-badges">
              {c.experimental && <span className="pf-ai-badge" title={S.experimentalHint} data-testid="ai-badge-experimental">{S.experimental}</span>}
              {codes.has('not_executed') && <span className="pf-ai-badge" data-testid="ai-badge-notrun">{S.notRun}</span>}
              {(codes.has('model_license_unknown') || codes.has('not_licenseReviewed')) && <span className="pf-ai-badge" data-testid="ai-badge-licence">{S.licence}</span>}
            </div>
            <p className="muted">{S.device}: <bdi>{deviceText}</bdi></p>
            {c.runnable
              ? <p className="pf-ai-state pf-ai-ok" data-testid="ai-state">{S.runnable}</p>
              : (
                <div className="pf-ai-state" data-testid="ai-state">
                  <p>{S.notRunnable}</p>
                  <ul className="pf-ai-why">{why.map((w) => <li key={w}>{w}</li>)}</ul>
                  {needsDownload && <p className="muted">{pending ? S.approvalPending : S.approvalWhere(t('approvals'))}</p>}
                </div>
              )}
            {takesImage && (
              images.length === 0
                ? <p className="muted">{S.noPictures}</p>
                : (
                  <label className="muted">{S.source}
                    <select value={chosen} onChange={(e) => setPick({ ...pick, [c.id]: e.target.value })} data-testid="ai-input">
                      <option value="">{S.choose}</option>
                      {images.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </label>
                )
            )}
            <div className="pf-ai-row">
              {takesImage
                ? <button className="primary" disabled={!c.runnable || !chosen || busy} onClick={() => void run(c, chosen)} data-testid="ai-run">{runBusy ? S.running : S.run}</button>
                : <button className="ghost" disabled={!c.runnable || busy} onClick={() => void run(c, null)} data-testid={c.id === 'comfy.smoke.solid-image' ? 'provider-smoke' : 'ai-run'}>{runBusy ? `${t('providers.running')} ${active?.stage ?? ''}` : c.id === 'comfy.smoke.solid-image' ? t('providers.smoke') : S.run}</button>}
              {runBusy && active && <button className="ghost" onClick={() => void api.cancelJob(active.id).catch(() => {})} data-testid="ai-cancel">{S.cancel}</button>}
            </div>
            <div role="status" className="muted" data-testid="ai-job-status" data-job={active?.id}>
              {runBusy && active ? <>{S.running}: <bdi>{active.stage ?? active.status}</bdi></> : active?.status === 'canceled' ? S.cancelled : ''}
            </div>
            {active?.status === 'succeeded' && (
              <p className="pf-ai-result muted" data-testid={smoke ? 'provider-result' : 'ai-result'} data-job={active.id}>
                <img src={`/api/v1/jobs/${active.id}/outputs/0`} alt={S.resultAlt} width={48} height={48} />
                <span>{smoke ? t('providers.ok') : S.done}{active.output?.bundle?.[0]?.width ? <> · <bdi>{active.output.bundle[0].width}×{active.output.bundle[0].height}</bdi></> : null}</span>
              </p>
            )}
            {active?.status === 'failed' && <p className="muted danger" role="alert" data-testid={smoke ? 'provider-result' : 'ai-result'}>{smoke ? t('providers.failed') : S.failed}: {active.error?.message}</p>}
            {runError?.capId === c.id && <p className="muted danger" role="alert">{S.failed}: {runError.message}</p>}
          </article>
        );
      })}
    </section>
  );
}
