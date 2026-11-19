/**
 * AI tools panel (ADR-0017). The tools come from the server's reviewed registry: ComfyUI workflows and PULSEFRAME's own local
 * tools, grouped in four tabs (picture, video, sound, captions). Each card says whether it can run here and, if not, why and what to
 * do (its setup state, in Hebrew and English), with «בדוק שוב»; missing model files are asked for through Approvals, never
 * downloaded from here; badges say what is experimental, unreviewed or CPU-bound; the model card gives the licence, the attribution
 * and what was not tested. A run is a durable job the server admits, runs and validates; this panel shows its measured progress,
 * lets it be cancelled (and says what that did), compares before and after, and places a kept proposal on request. Undo is the
 * ordinary undo. Nothing here fakes a result.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { cutoutsOf } from '@pulseframe/core';
import { dictionaries, translateRefusal } from '@pulseframe/i18n';
import { api, ApiFailure, type JobEvent } from '../api.ts';
import { useEditorState, type Editor } from './store.ts';
import { AI_STRINGS } from './aiTools.strings.ts';
import { AI_TABS, cancelMeaning, cardJob, clipFor, compareTimes, failureOf, placeAnywayOps, progressOf, providerAfter, recheckProvider, runsOnCpu, samplesToSeconds, setupOf, tabOf, type AiTab } from './aiTools.recheck.ts';
import { aiApi, type Attachment, type CapInfo, type SetupState } from './api.ts';
import { AiRunSheet } from './AiRunSheet.tsx';
import { AiCompare } from './AiCompare.tsx';
import { Badge, Button, JobRow, Ring } from '../ds/index.ts';
import { HUB_STRINGS, pillKind, type HubStrings } from './aiHub.strings.ts';
import { capIcon } from './aiHubIcons.tsx';
import './aiTools.css';
import './aiHub.css';

type S = (typeof AI_STRINGS)['he' | 'en'];
/** Blockers a run does not wait for (they are earned by running); they become badges, not reasons. */
const EARNED = new Set(['not_executed', 'not_hardwareQualified', 'not_qualityReviewed', 'not_hebrewQualified']);
const OPEN = ['queued', 'running', 'cancel-requested'];
const TAB_KEY = 'pf.ai.tab.v1';
const readTab = (): AiTab | null => { try { const v = localStorage.getItem(TAB_KEY); return (AI_TABS as readonly string[]).includes(v ?? '') ? (v as AiTab) : null; } catch { return null; } };
const writeTab = (t: AiTab) => { try { localStorage.setItem(TAB_KEY, t); } catch { /* storage unavailable */ } };

/** Decimal MB/GB, as a download size. This is disk transfer, not memory use. */
function size(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}
/** The server's refusal as the panel says it: the coded headline in the interface language, then the detail (in Hebrew when known). */
function sayFailure(lang: 'he' | 'en', f: { code?: string | null; message?: string | null } | null | undefined): string {
  if (!f) return '';
  const head = f.code ? (dictionaries[lang] as Record<string, string>)[`error.code.${f.code}`] : undefined;
  const detail = f.message ? translateRefusal(lang, f.message) ?? f.message : '';
  return head ? (detail ? `${head}: ${detail}` : head) : detail;
}
/**
 * A detail the server or the engine reported, as it may be shown under "details for whoever installs": never an environment
 * variable name, an address or a file path (owner rule: no developer language on the cards). Null when nothing is left to say.
 */
export function installerDetail(detail: string | undefined | null, lang: 'he' | 'en'): string | null {
  if (!detail) return null;
  const setting = lang === 'he' ? 'הגדרת החיבור' : 'the connection setting';
  if (lang === 'he') {
    // "<SETTING> is not set: <reason>" is the server's English sentence; in Hebrew it is said whole, never half-and-half
    const unset = /^(?:PF_[A-Z0-9_]+|the engine setting) is not set(?:: (.*))?$/i.exec(detail.trim());
    if (unset) {
      const why = unset[1] ?? '';
      if (!why) return null;
      if (/^no tools environment/i.test(why)) return 'הגדרת החיבור חסרה: לא הוגדרה סביבת כלים לעיבוד';
      if (/^no engine is installed/i.test(why)) return 'הגדרת החיבור חסרה: לא הותקן מנוע לכלי הזה (ההתקנה היא של מי שמתקין, לא של התוכנה)';
      return 'הגדרת החיבור חסרה';
    }
  }
  const out = detail
    .replace(/\bhttps?:\/\/\S+/gi, lang === 'he' ? 'כתובת' : 'an address')
    .replace(/\bPF_[A-Z0-9_]+\b/g, setting)
    .replace(/(?:^|\s)(?:[A-Za-z]:)?(?:[\\/][^\s\\/:]+){2,}/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return out && out !== setting && !/^(the connection setting|הגדרת החיבור) is not set$/i.test(out) ? out : null;
}
/** The name of a model file without its folders (the card says which file, not where it lives). */
const fileName = (p: string) => p.split(/[\\/]/).pop() || p;

/** The connection check (a graph with no model): shown to whoever installs, under a disclosure, not as a tool among the owner's tools. */
export const isConnectionCheck = (c: { id: string }) => /\.smoke\./.test(c.id);

export function AiTools() {
  const { editor, state, t } = useEditorState();
  const { provider, lang } = state;
  const S = AI_STRINGS[lang];
  const [msg, setMsg] = useState<{ text: string; failed: boolean }>({ text: '', failed: false });
  const [checking, setChecking] = useState(false);
  /** Tool id -> the job this panel last started for it. A card shows that job only (aiTools.recheck.ts cardJob). */
  const [mine, setMine] = useState<Record<string, string>>({});
  /** Job id -> what it read (for the compare view). */
  const [runs, setRuns] = useState<Record<string, { sourceAssetId: string | null; clipId: string | null }>>({});
  const [tab, setTab] = useState<AiTab | null>(readTab);
  const uid = useId();
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

  // the owner's words: no product or version names; the state is in data-state for the tests
  const E = HUB_STRINGS[lang].engine;
  const status = !pr.configured
    ? <p className="muted" data-testid="provider-status" data-state="not-configured">{E.notConfigured}</p>
    : !pr.readiness?.reachable
      ? <p className="muted" data-testid="provider-status" data-state="unreachable">{E.unreachable}</p>
      : <p className="muted" data-testid="provider-status" data-state="ready">{E.ready}</p>;

  const caps = provider.capabilities as unknown as CapInfo[];
  const byTab = Object.fromEntries(AI_TABS.map((x) => [x, caps.filter((c) => tabOf(c) === x)])) as Record<AiTab, CapInfo[]>;
  const current: AiTab = tab ?? AI_TABS.find((x) => byTab[x].length > 0) ?? 'image';
  const choose = (x: AiTab, focus = false) => { setTab(x); writeTab(x); if (focus) setTimeout(() => document.getElementById(`${uid}-tab-${x}`)?.focus(), 0); };
  const onTabKey = (e: React.KeyboardEvent) => {
    const i = AI_TABS.indexOf(current);
    const rtl = lang === 'he';
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? AI_TABS.length - 1 : e.key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? (i + 1) % AI_TABS.length : e.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? (i + AI_TABS.length - 1) % AI_TABS.length : -1;
    if (next < 0) return;
    e.preventDefault();
    choose(AI_TABS[next]!, true);
  };
  const otherRunning = Object.values(state.capJobs).some((j) => OPEN.includes(j.status) && !Object.values(mine).includes(j.id));

  const H = HUB_STRINGS[lang];
  const isSmoke = (c: CapInfo) => !c.inputs?.length && (c.provider ?? 'comfyui') === 'comfyui';
  const kinds = caps.filter((c) => !isSmoke(c) && !isConnectionCheck(c)).map((c) => { const st = setupOf(c, pr); const j = cardJob(c.id, mine, state.capJobs); return pillKind(st.code, c.runnable, !!j && OPEN.includes(j.status), st.missingBytes ?? c.missingDownloadBytes ?? 0); });
  const nReady = kinds.filter((k) => k === 'ready' || k === 'running').length, nOff = kinds.filter((k) => k === 'off').length, nSetup = kinds.length - nReady - nOff;
  const running = Object.values(state.capJobs).filter((j) => OPEN.includes(j.status));
  const capTitle = (id: string | undefined) => caps.find((c) => c.id === id)?.title[lang] ?? id ?? '';
  return (
    <section className="pf-ai pf-ds pf-hub" data-testid="ai-tools" aria-label={S.tools}>
      <header className="pf-hub-head">
        <h2 className="pf-hub-title">{H.title}</h2>
        <p className="pf-hub-counts" data-testid="ai-counts"><span>{H.counts(nReady, nSetup, nOff)}</span><span className="pf-hub-privacy">{H.privacy}</span></p>
      </header>
      {running.length > 0 && (
        <div className="pf-hub-jobs" role="group" aria-label={H.jobs} data-testid="ai-jobs-strip">
          {running.map((j) => { const pr_ = progressOf(j.output); const pct = pr_ ? Math.round((100 * pr_.done) / pr_.total) : null; return (
            <JobRow key={j.id} title={capTitle((j as { capabilityId?: string }).capabilityId ?? (j.output as { capabilityId?: string } | null)?.capabilityId)} detail={pr_ ? undefined : S.waiting} state="running" progress={pct} stateLabel={pct == null ? H.pill.runningNoPct : H.pill.running(`${pct}%`)} cancelLabel={S.cancel} onCancel={() => void api.cancelJob(j.id).catch(() => undefined)} />
          ); })}
        </div>
      )}
      {!connected && (
        <details className="pf-hub-how" data-testid="ai-setup" open={caps.every((c) => (c.provider ?? 'comfyui') === 'comfyui') || undefined}>
          <summary>{H.comfyHow}: {H.howTo}</summary>
          <ol>{H.steps[pr.configured ? 'provider_unreachable' : 'provider_not_configured']!.map((x) => <li key={x}>{x}</li>)}</ol>
          <div className="pf-ai-row">
            <Button size="sm" variant="secondary" busy={checking} onClick={() => void recheck()} data-testid="ai-recheck">{S.recheck}</Button>
          </div>
          <div role="status" className={`muted${msg.failed ? ' danger' : ''}`} data-testid="ai-recheck-status" data-failed={msg.failed ? 'true' : undefined}>{msg.text}</div>
        </details>
      )}
      <div className="pf-hub-status">{status}</div>
      {otherRunning && <p className="muted" role="status" data-testid="ai-other-job">{S.otherJob}</p>}
      <div role="tablist" aria-label={S.tabsLabel} className="pf-ai-tabs" onKeyDown={onTabKey}>
        {AI_TABS.map((x) => (
          <button key={x} type="button" role="tab" id={`${uid}-tab-${x}`} aria-selected={x === current} aria-controls={`${uid}-panel-${x}`} tabIndex={x === current ? 0 : -1}
            onClick={() => choose(x)} data-testid="ai-tab" data-tab={x}>
            {S.tabs[x]} <bdi className="muted">({byTab[x].filter((c) => !isConnectionCheck(c)).length + (x === 'image' ? 1 : 0)})</bdi>
          </button>
        ))}
      </div>
      {AI_TABS.map((x) => (
        <div key={x} role="tabpanel" id={`${uid}-panel-${x}`} aria-labelledby={`${uid}-tab-${x}`} hidden={x !== current} className="pf-ai-panel" data-testid="ai-tabpanel" data-tab={x}>
          {x === current && (
            <>
              {byTab[x].filter((c) => !isConnectionCheck(c)).length === 0 && x !== 'image' && <p className="muted">{S.emptyTab}</p>}
              {byTab[x].filter((c) => !isConnectionCheck(c)).map((c) => (
                <ToolCard key={c.id} cap={c} tab={x} S={S} editor={editor} job={cardJob(c.id, mine, state.capJobs)} run={runs[mine[c.id] ?? ''] ?? null}
                  onStarted={(jobId, info) => { setMine((m) => ({ ...m, [c.id]: jobId })); setRuns((r) => ({ ...r, [jobId]: info })); }} />
              ))}
              {x === 'image' && <PortraitCard S={S} editor={editor} />}
              {byTab[x].some(isConnectionCheck) && (
                <details className="pf-hub-how pf-hub-installer" data-testid="ai-installer-check">
                  <summary>{H.installerCheck}</summary>
                  <p className="muted">{H.installerCheckHint}</p>
                  {byTab[x].filter(isConnectionCheck).map((c) => (
                    <ToolCard key={c.id} cap={c} tab={x} S={S} editor={editor} job={cardJob(c.id, mine, state.capJobs)} run={runs[mine[c.id] ?? ''] ?? null}
                      onStarted={(jobId, info) => { setMine((m) => ({ ...m, [c.id]: jobId })); setRuns((r) => ({ ...r, [jobId]: info })); }} />
                  ))}
                </details>
              )}
            </>
          )}
        </div>
      ))}
    </section>
  );
}

function ToolCard({ cap: c, tab, S, editor, job, run, onStarted }: { cap: CapInfo; tab: AiTab; S: S; editor: Editor; job: JobEvent | null; run: { sourceAssetId: string | null; clipId: string | null } | null; onStarted: (jobId: string, info: { sourceAssetId: string | null; clipId: string | null }) => void }) {
  const { state, t } = useEditorState();
  const { lang, doc, approvals } = state;
  const pr = state.provider!.provider;
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [check, setCheck] = useState<{ text: string; failed: boolean } | null>(null);
  const [ask, setAsk] = useState<{ state: 'idle' | 'sending' | 'sent' | 'failed'; text?: string }>({ state: 'idle' });
  const [cancel, setCancel] = useState<{ sending: boolean; text: string | null }>({ sending: false, text: null });
  const [placed, setPlaced] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const seen = useRef<{ id: string | null; status: string | null }>({ id: null, status: null });
  const title = c.title[lang];
  // aria-live announcements on start, end and failure of this card's own job
  useEffect(() => {
    if (!job) return;
    const prev = seen.current;
    if (prev.id === job.id && prev.status === job.status) return;
    seen.current = { id: job.id, status: job.status };
    if (prev.id !== job.id && OPEN.includes(job.status)) setAnnounce(S.announceStarted(title));
    else if (job.status === 'succeeded') setAnnounce(S.announceDone(title));
    else if (job.status === 'failed') setAnnounce(S.announceFailed(title, sayFailure(lang, job.error)));
    else if (job.status === 'canceled') setAnnounce(S.announceCanceled(title));
  }, [job?.id, job?.status]);

  const setup: SetupState = setupOf(c, pr);
  const codes = new Set((c.blockers ?? []).map((b) => b.code));
  const open_ = (c.openReviews ?? []);
  const cpu = runsOnCpu(c, setup, pr.readiness?.device?.type);
  const smoke = !c.inputs?.length && (c.provider ?? 'comfyui') === 'comfyui';
  const pending = approvals.some((a) => a.action?.capabilityId === c.id);
  const missingBytes = setup.missingBytes ?? c.missingDownloadBytes ?? 0;
  const canAsk = (setup.code === 'model_missing' || setup.code === 'disk_insufficient' || setup.code === 'host_not_allowed') && missingBytes > 0;
  const runBusy = !!job && OPEN.includes(job.status);
  const blockedBy = (c.blockers ?? []).filter((b) => !EARNED.has(b.code)).map((b) => S.blockers[b.code] ?? `${S.unknownBlocker}: ${b.message}`);
  // each model file that is not ready, as the model store reports it (size still to download, damaged, cannot be verified)
  const modelLines = (c.models ?? []).flatMap((m) => {
    const st = m.status;
    if (!st || st.state === 'ready') return [];
    if (st.state === 'missing') return [S.modelMissing(fileName(m.path), size(st.missingBytes))];
    if (st.state === 'partial-download') return [S.modelPartial(fileName(m.path), size(st.missingBytes))];
    if (st.state === 'corrupt') return [S.modelCorrupt(fileName(m.path))];
    if (st.state === 'unverifiable') return [S.modelUnverifiable(fileName(m.path))];
    return [S.modelUnresolved(fileName(m.path))];
  });

  const recheck = async () => {
    setCheck({ text: S.checking, failed: false });
    try { await editor.refreshCapabilities(); setCheck({ text: S.checked, failed: false }); } catch (e) { setCheck({ text: `${S.checkFailed} ${e instanceof ApiFailure ? sayFailure(lang, e) : ''}`, failed: true }); }
  };
  const requestDownload = async () => {
    if (!doc) return;
    setAsk({ state: 'sending' });
    try { await aiApi.requestModels(doc.id, c.id); setAsk({ state: 'sent' }); }
    catch (e) { setAsk({ state: 'failed', text: e instanceof ApiFailure ? sayFailure(lang, e) : String(e) }); }
  };
  const goApprovals = () => {
    document.getElementById('inspector-tab-review')?.click();
    setTimeout(() => { const el = document.querySelector<HTMLElement>('[data-testid=approvals] [data-testid=approval-approve]'); el?.scrollIntoView({ block: 'nearest' }); el?.focus(); }, 50);
  };
  const doCancel = async () => {
    if (!job || !runBusy) { setCancel({ sending: false, text: S.cancelNothing }); return; }
    if (cancel.sending) return;
    setCancel({ sending: true, text: S.cancelSending });
    try {
      const r = await api.cancelJob(job.id);
      const m = cancelMeaning(r.outcome);
      setCancel({ sending: false, text: m === 'other' ? `${S.cancelMeaning.other} ${r.outcome}` : S.cancelMeaning[m]! });
    } catch (e) { setCancel({ sending: false, text: e instanceof ApiFailure ? sayFailure(lang, e) : String(e) }); }
  };
  const runSmoke = async () => {
    setRefused(null);
    try { const jobId = await editor.runCapability(c.id, {}); if (jobId) onStarted(jobId, { sourceAssetId: null, clipId: null }); }
    catch (e) { setRefused(e instanceof ApiFailure ? sayFailure(lang, e) : e instanceof Error ? e.message : String(e)); }
  };

  const H = HUB_STRINGS[lang];
  const kind = pillKind(setup.code, c.runnable, runBusy, missingBytes);
  const prog = job && runBusy ? progressOf(job.output) : null;
  const pct = prog ? Math.round((100 * prog.done) / prog.total) : null;
  const Icon = capIcon(c.id, c.task);
  const gb = missingBytes ? size(missingBytes) : '';
  const kindLabel = kind === 'ready' ? H.pill.ready : kind === 'running' ? (pct == null ? H.pill.runningNoPct : H.pill.running(`${pct}%`)) : kind === 'prep' ? H.pill.prep(gb) : kind === 'off' ? H.pill.off : H.pill.setup;
  const gpuNote = (c.blockers ?? []).some((b) => /gpu|cuda|graphics/i.test(b.code + b.message)) || /gpu|cuda/i.test(setup.detail ?? '');
  // the connection steps already say what is missing; an engine's own error text is kept for whoever installs, without variable names or addresses
  const techDetail = setup.code === 'provider_not_configured' || setup.code === 'provider_unreachable' ? null : installerDetail(setup.detail, lang);
  return (
    <article className={`pf-ai-card pf-hub-card is-${kind}`} data-testid="ai-tool" data-id={c.id} data-runnable={c.runnable ? 'true' : 'false'} data-setup={setup.code} data-tab={tab} aria-labelledby={`${uid}-h`}>
      <div className="pf-hub-card-top">
        <span className="pf-hub-ico" aria-hidden="true"><Icon size={20} strokeWidth={1.75} /></span>
        <h3 id={`${uid}-h`}>{isConnectionCheck(c) ? H.connectTest : title}</h3>
        {kind === 'running' && <Ring value={pct} label={title} size={28} />}
      </div>
      {c.description && !isConnectionCheck(c) && <p className="pf-hub-purpose">{c.description[lang]}</p>}
      <div className="pf-ai-badges">
        {c.experimental && <span className="pf-ai-badge" title={S.experimentalHint} data-testid="ai-badge-experimental">{S.experimental}</span>}
        {open_.includes('qualityReviewed') && <span className="pf-ai-badge" title={S.badgeQualityHint} data-testid="ai-badge-quality">{S.badgeQuality}</span>}
        {open_.includes('hebrewQualified') && <span className="pf-ai-badge" title={S.badgeHebrewHint} data-testid="ai-badge-hebrew">{S.badgeHebrew}</span>}
        {cpu && <span className="pf-ai-badge" title={S.badgeCpuHint} data-testid="ai-badge-cpu">{S.badgeCpu}</span>}
        {codes.has('not_executed') && <span className="pf-ai-badge" data-testid="ai-badge-notrun">{S.notRun}</span>}
        {(codes.has('model_license_unknown') || codes.has('not_licenseReviewed')) && <span className="pf-ai-badge" data-testid="ai-badge-licence">{S.licence}</span>}
      </div>
      <div className="pf-ai-state pf-hub-state" data-testid="ai-state" data-code={setup.code}>
        <span className={`pf-hub-pill is-${kind}`} data-testid={setup.code === 'ready' && c.runnable ? undefined : 'ai-state-headline'}>{kindLabel}{gpuNote && kind !== 'ready' ? ` · ${H.needGpu}` : ''}</span>
        {setup.code === 'disk_insufficient' && setup.freeBytes !== undefined && <span className="muted">{S.freeNow(size(setup.freeBytes))}</span>}
      </div>
      {setup.code !== 'ready' && (
        <details className="pf-hub-how" data-testid="ai-setup-how">
          <summary>{kind === 'off' ? H.whyOff : H.howTo}</summary>
          {(H.steps[setup.code]?.length ?? 0) > 0 && <ol className="pf-ai-steps" data-testid="ai-setup-steps">{H.steps[setup.code]!.map((x) => <li key={x}>{x}</li>)}</ol>}
          {(blockedBy.length > 0 || modelLines.length > 0) && <ul className="pf-ai-why" data-testid="ai-why">{[...new Set([...modelLines, ...blockedBy])].map((w) => <li key={w}>{w}</li>)}</ul>}
          {canAsk && (
            <div className="pf-ai-row">
              {pending || ask.state === 'sent'
                ? <p className="muted" role="status" data-testid="ai-download-requested">{pending ? S.approvalPending : S.requested}</p>
                : <Button size="sm" variant="primary" busy={ask.state === 'sending'} onClick={() => void requestDownload()} data-testid="ai-request-download">{ask.state === 'sending' ? S.requesting : S.requestDownload(size(missingBytes))}</Button>}
              {(pending || ask.state === 'sent') && <Button size="sm" variant="secondary" onClick={goApprovals} data-testid="ai-go-approvals">{S.goApprovals}</Button>}
            </div>
          )}
          {ask.state === 'failed' && <p className="danger" role="alert">{S.requestFailed}: <bdi>{ask.text}</bdi></p>}
          <div className="pf-ai-row">
            <Button size="sm" variant="secondary" onClick={() => void recheck()} data-testid="ai-tool-recheck">{S.checkAgain}</Button>
            <span role="status" className={`muted${check?.failed ? ' danger' : ''}`} data-testid="ai-tool-recheck-status">{check?.text ?? ''}</span>
          </div>
          {techDetail && (
            <details className="pf-hub-tech"><summary>{H.technical}</summary><p className="muted">{S.stateDetail} <bdi dir="auto" data-testid="ai-state-detail">{techDetail}</bdi></p></details>
          )}
        </details>
      )}
      {setup.code === 'ready' && !c.runnable && <p className="muted" data-testid="ai-state-headline">{S.notRunnable}</p>}
      <ModelCard cap={c} S={S} />
      {smoke ? (
        <div className="pf-ai-row">
          <Button size="sm" variant="secondary" disabled={!c.runnable || runBusy} onClick={() => void runSmoke()} data-testid={c.id === 'comfy.smoke.solid-image' ? 'provider-smoke' : 'ai-run'} title={S.smokeHint}>{runBusy ? `${t('providers.running')} ${job?.stage ?? ''}` : c.id === 'comfy.smoke.solid-image' ? t('providers.smoke') : S.run}</Button>
        </div>
      ) : (
        <>
          <div className="pf-ai-row">
            <Button size="md" variant={c.runnable && setup.code === 'ready' ? 'primary' : 'secondary'} aria-expanded={open} aria-controls={`${uid}-sheet`} disabled={!c.runnable || setup.code !== 'ready'} onClick={() => setOpen((o) => !o)} data-testid="ai-open-run">{open ? S.closeRun : S.openRun}</Button>
          </div>
          <div id={`${uid}-sheet`} hidden={!open}>
            {open && <AiRunSheet cap={c} tab={tab} S={S} onRefused={(m) => setRefused(m)} onStarted={(jobId, info) => { setRefused(null); setCancel({ sending: false, text: null }); setPlaced(null); onStarted(jobId, info); }} />}
          </div>
        </>
      )}
      {refused && <p className="muted danger" role="alert" data-testid="ai-run-refused"><bdi>{refused}</bdi></p>}
      {job && <JobView cap={c} job={job} run={run} S={S} editor={editor} smoke={smoke} onCancel={() => void doCancel()} cancel={cancel} placed={placed} setPlaced={setPlaced} />}
      <p className="sr-only" role="status" aria-live="polite" data-testid="ai-announce">{announce}</p>
    </article>
  );
}

function JobView({ cap: c, job, run, S, editor, smoke, onCancel, cancel, placed, setPlaced }: { cap: CapInfo; job: JobEvent; run: { sourceAssetId: string | null; clipId: string | null } | null; S: S; editor: Editor; smoke: boolean; onCancel: () => void; cancel: { sending: boolean; text: string | null }; placed: string | null; setPlaced: (s: string | null) => void }) {
  const { state, t } = useEditorState();
  const { lang, doc } = state;
  const busy = OPEN.includes(job.status);
  const p = progressOf(job.output);
  const eta = job.output?.eta as { seconds: number | null; basis: string } | undefined;
  const fill = (tpl: string, done: string, total: string) => tpl.split(/(\{done\}|\{total\})/).map((part, i) => (part === '{done}' ? <bdi key={i} data-testid="ai-progress-done">{done}</bdi> : part === '{total}' ? <bdi key={i} data-testid="ai-progress-total">{total}</bdi> : part));
  const shown = p ? (p.unit === 'samples' ? [String(samplesToSeconds(p.done)), String(samplesToSeconds(p.total))] : [String(p.done), String(p.total)]) : null;
  const text = p && shown ? S.progress[p.unit].replace('{done}', shown[0]!).replace('{total}', shown[1]!) : S.waiting;
  const att = (job.output?.attachment ?? null) as Attachment | null;
  const ops = placeAnywayOps(att);
  const pid = doc?.id ?? '';
  const outKind = c.outputs?.find((o) => o.role === 'primary')?.mediaType ?? 'image';
  const after = att?.assetId ? aiApi.assetUrl(pid, att.assetId) : job.status === 'succeeded' && !c.task ? `/api/v1/jobs/${job.id}/outputs/0` : null;
  const beforeId = att?.previousAssetId ?? run?.sourceAssetId ?? null;
  const before = beforeId ? aiApi.assetUrl(pid, beforeId) : null;
  const clipId = att?.clipId ?? run?.clipId ?? null;
  const times = doc && clipId && att?.status === 'attached' && att.mode !== 'new-track' ? compareTimes(doc, clipId, editor.playhead) : null;
  const placeAnyway = async () => {
    if (!ops) return;
    const r = await editor.commit(ops, 'Place result');
    if (r) setPlaced(S.placed);
  };
  return (
    <div className="pf-ai-job" data-testid="ai-job" data-job={job.id} data-status={job.status}>
      {(busy || (job.status === 'succeeded' && p)) && !smoke && (
        <div className="pf-ai-progress">
          <div role="progressbar" aria-label={S.progressLabel} aria-valuemin={0} {...(p ? { 'aria-valuemax': p.total, 'aria-valuenow': p.done } : {})} aria-valuetext={text} data-testid="ai-progress" data-unit={p?.unit}>
            <div className="pf-ai-bar" style={{ inlineSize: p ? `${(100 * p.done) / p.total}%` : '0%' }} />
          </div>
          <p className="muted">{p ? fill(S.progress[p.unit], shown![0]!, shown![1]!) : S.waiting}{job.stage && busy ? <> · <bdi dir="auto">{job.stage}</bdi></> : null}</p>
          {busy && eta?.seconds !== null && eta?.seconds !== undefined && eta.basis !== 'none' && <p className="muted" data-testid="ai-eta">{eta.basis === 'this-run' ? S.etaRun(S.seconds(eta.seconds)) : S.etaProfile(S.seconds(eta.seconds))}</p>}
        </div>
      )}
      <div role="status" className="muted" data-testid="ai-job-status" data-job={job.id}>
        {busy ? <>{S.running}: <bdi>{job.stage ?? job.status}</bdi></> : job.status === 'canceled' ? S.cancelled : ''}
      </div>
      {busy && <button type="button" className="ghost" aria-disabled={cancel.sending ? 'true' : undefined} onClick={onCancel} data-testid="ai-cancel">{S.cancel}</button>}
      {cancel.text && <p className="muted" role="status" data-testid="ai-cancel-result">{cancel.text}</p>}
      {job.status === 'succeeded' && smoke && (
        <p className="pf-ai-result muted" data-testid="provider-result" data-job={job.id}>
          <img src={`/api/v1/jobs/${job.id}/outputs/0`} alt={S.resultAlt} width={48} height={48} />
          <span>{t('providers.ok')}{job.output?.bundle?.[0]?.width ? <> · <bdi>{job.output.bundle[0].width}×{job.output.bundle[0].height}</bdi></> : null}</span>
        </p>
      )}
      {job.status === 'succeeded' && !smoke && (
        <div className="pf-ai-result-block" data-testid="ai-result" data-job={job.id} data-attachment={att?.status ?? 'none'}>
          {c.task === 'translate' ? (
            <>
              <p>{S.translationMade}</p>
              {att?.variantId && <button type="button" className="ghost" onClick={() => { editor.set({ viewVariantId: att.variantId! }); document.getElementById('inspector-tab-speech')?.click(); }} data-testid="ai-show-translation">{S.showTranslation}</button>}
            </>
          ) : att?.status === 'proposed' ? (
            <>
              <p>{S.resultProposed} <bdi dir="auto" data-testid="ai-proposal-reason">{att.reason ?? ''}</bdi></p>
              {ops && !placed && <button type="button" className="ghost" onClick={() => void placeAnyway()} data-testid="ai-place-anyway">{S.placeAnyway}</button>}
              {placed && <p role="status" data-testid="ai-placed">{placed}</p>}
            </>
          ) : (
            <p data-testid="ai-result-text">{att?.status === 'attached' ? (att.mode === 'new-track' ? S.resultNewTrack : S.resultReplaced) : att?.status === 'imported' || !att ? (outKind === 'image' && !att ? S.done : S.resultLibrary) : S.resultLibrary}</p>
          )}
          {(att?.status === 'attached' || placed) && <button type="button" className="ghost" onClick={() => void editor.history('undo')} data-testid="ai-undo">{S.undo}</button>}
          {after && before && (outKind === 'image' || outKind === 'video' || outKind === 'audio') && (
            <AiCompare kind={outKind} before={before} after={after} times={times} frame={times ? editor.frame : null} S={S} rtl={lang === 'he'} />
          )}
          {after && !before && outKind === 'image' && <img className="pf-ai-thumb" src={after} alt={S.resultAlt} width={96} height={96} />}
        </div>
      )}
      {job.status === 'failed' && <p className="muted danger" role="alert" data-testid={smoke ? 'provider-result' : 'ai-result'} data-job={job.id}>{smoke ? t('providers.failed') : S.failed}: <bdi dir="auto">{sayFailure(lang, job.error)}</bdi></p>}
    </div>
  );
}

function ModelCard({ cap: c, S }: { cap: CapInfo; S: S }) {
  const notTested = Object.entries(c.qualification ?? {}).filter(([, e]) => e?.status !== 'pass').map(([dim]) => S.dims[dim] ?? dim);
  return (
    <details className="pf-ai-model" data-testid="ai-model-card">
      <summary>{S.modelCard}</summary>
      {(c.models ?? []).length === 0 ? <p className="muted">{S.noModels}</p> : (
        <ul className="pf-ai-models">
          {(c.models ?? []).map((m) => (
            <li key={m.path} data-testid="ai-model">
              <dl>
                
                {m.bytes ? <><dt>{S.modelSize}</dt><dd><bdi dir="ltr">{size(m.bytes)}</bdi></dd></> : null}
                <dt>{S.modelLicence}</dt><dd><bdi dir="ltr" data-testid="ai-model-licence">{m.license ?? '—'}</bdi>{m.commercialUse ? <> · {S.modelCommercial}: <bdi dir="ltr">{m.commercialUse}</bdi></> : null}</dd>
                {m.publisher ? <><dt>{S.modelPublisher}</dt><dd><bdi dir="ltr">{m.publisher}</bdi></dd></> : null}
                {m.attribution ? <><dt>{S.modelAttribution}</dt><dd><bdi dir="ltr" data-testid="ai-model-attribution">{m.attribution}</bdi></dd></> : null}
                {m.source ? <><dt>{S.modelSource}</dt><dd><bdi dir="ltr">{(() => { try { return new URL(m.source).host; } catch { return m.source; } })()}</bdi></dd></> : null}
              </dl>
            </li>
          ))}
        </ul>
      )}
      <h4>{S.notTested}</h4>
      {notTested.length === 0 ? <p className="muted">{S.notTestedNone}</p> : <ul data-testid="ai-not-tested">{notTested.map((x) => <li key={x}>{x}</li>)}</ul>}
      {(c.limitations ?? []).length > 0 && (
        <>
          <h4>{S.limitations}</h4>
          <ul lang="en" dir="ltr" className="pf-ai-limits">{c.limitations!.map((x) => <li key={x}>{x}</li>)}</ul>
        </>
      )}
    </details>
  );
}

/** Portrait blur (the portrait-blur recipe, one undoable step): a still picture clip over a blurred copy, from a cut-out already made. */
function PortraitCard({ S, editor }: { S: S; editor: Editor }) {
  const { state } = useEditorState();
  const { doc, lang } = state;
  const uid = useId();
  const [radius, setRadius] = useState('2');
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const clip = doc ? clipFor(doc, state.selection[0], 'image') : null;
  const cutouts = doc && clip ? cutoutsOf(doc, clip.assetId) : [];
  useEffect(() => { setRes(null); }, [clip?.id]);
  const apply = async () => {
    if (!doc || !clip) return;
    setBusy(true); setRes(null);
    try { await api.applyRecipe(doc.id, 'portrait-blur', { clipId: clip.id, radius: Number(radius) / 100 }); setRes({ ok: true, text: S.portraitDone }); }
    catch (e) { setRes({ ok: false, text: e instanceof ApiFailure ? sayFailure(lang, e) : String(e) }); }
    finally { setBusy(false); }
  };
  return (
    <article className="pf-ai-card" data-testid="ai-portrait" data-ready={clip && cutouts.length ? 'true' : 'false'} aria-labelledby={`${uid}-h`}>
      <h3 id={`${uid}-h`}>{S.portraitTitle}</h3>
      <p className="muted">{S.portraitDesc}</p>
      {!clip ? <p className="muted" data-testid="ai-portrait-state">{S.portraitNeedClip}</p>
        : cutouts.length === 0 ? <p className="muted" data-testid="ai-portrait-state">{S.portraitNeedCutout}</p>
          : (
            <>
              <p className="muted">{S.portraitCutout} <bdi>{cutouts[0]!.name}</bdi></p>
              <label>{S.portraitRadius}
                <select value={radius} onChange={(e) => setRadius(e.target.value)} data-testid="ai-portrait-radius">
                  {['1', '2', '4', '8'].map((v) => <option key={v} value={v}>{v}%</option>)}
                </select>
              </label>
              <div className="pf-ai-row">
                <button type="button" className="primary" disabled={busy} onClick={() => void apply()} data-testid="ai-portrait-apply">{S.portraitApply}</button>
                {res?.ok && <button type="button" className="ghost" onClick={() => void editor.history('undo')} data-testid="ai-portrait-undo">{S.undo}</button>}
              </div>
            </>
          )}
      {res && <p className={res.ok ? 'muted' : 'danger'} role={res.ok ? 'status' : 'alert'} data-testid="ai-portrait-result"><bdi dir="auto">{res.text}</bdi></p>}
    </article>
  );
}
