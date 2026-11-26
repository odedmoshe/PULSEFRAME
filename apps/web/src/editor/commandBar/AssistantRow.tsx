/**
 * The assistant's row in the palette (ADR-0027; plan §6 "Assistant row"): «עוזר השפה לא מחובר» with «איך מחברים» until the
 * server's status says 'ready'; then the send line, the job's stage in words (never a percentage), the proposal's steps with
 * accept and reject (editor.decideProposal: the owner accepts, as one owner transaction). The assistant only proposes.
 * While a request is pending the owner can cancel it («ביטול הבקשה»: POST /jobs/:jobId/cancel, the owner's own session); the row
 * then says what the cancel did, from the job itself: nothing was sent, or it had been sent and may have been charged. A request
 * that ended after it was sent (canceled, failed, not known) keeps its reservation counted; when the owner's status lists that
 * amount as held, the row offers «שחרור הסכום השמור» (ReleaseHeld.tsx: a confirmation that says what a release is and is not).
 * The status is whole only for the owner's session; any other session reads connected or not, and the row shows no amount.
 * Nothing here pretends a model answered: a failed or missing status reads as not connected.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { Bot } from 'lucide-react';
import { ASSISTANT_STAGES, isLocalOutput, isOwnerStatus, type AssistantStatus, type AssistantStatusAnswer, type BarResultKind, type OpCall } from '@pulseframe/core';
import type { Lang } from '@pulseframe/i18n';
import { api, ApiFailure } from '../../api.ts';
import { CHROME_STRINGS } from '../chrome.strings.ts';
import { setSettingsOpen } from '../chromeState.ts';
import { getBarBridge, putInBar, subscribeBarBridge, useBarEditor } from './useBarResult.ts';
import { isLocalAdapter, localRowState, localText, type LocalRowState } from './localAssistant.logic.ts';
import { COMMAND_BAR_TESTIDS as TID } from './commandBar.testids.ts';
import { auto, barText, dict, ltr } from './commandBar.strings.ts';
import type { AssistantRowProps } from './contract.ts';
import { describeCall, refusalWords, type RefusalWords } from './describe.ts';
import { Rich, WithReason } from './BarPreview.tsx';
import { heldAmount, ReleaseHeld, releasedWords, withoutHeld } from './ReleaseHeld.tsx';
import './commandBar.css';

export const OWNER_ACTOR = 'user:local';
/**
 * null = unknown (not fetched, or the route answered 501 or failed): the honest state is "not connected". The owner's session
 * gets the whole status; any other session gets connected or not (core AssistantPublicStatus) and nothing of the money.
 */
export type StatusState = AssistantStatusAnswer | null;
export const isReady = (s: StatusState): boolean => s?.setup === 'ready';
/**
 * The words for a setup state; a missing status and 'provider_not_configured' both read «עוזר השפה לא מחובר», and so does the
 * not-connected state of a session that is not the owner's (which is not told what is missing).
 */
export const setupWords = (lang: Lang, s: StatusState): string => dict(lang, isOwnerStatus(s) ? `assistant.setup.${s.setup}` : s?.setup === 'ready' ? 'assistant.setup.ready' : 'assistant.notConnected');
export const stageWords = (lang: Lang, stage: string | null): string => (ASSISTANT_STAGES as readonly string[]).includes(stage ?? '') ? dict(lang, `assistant.stage.${stage}`) : barText(lang, 'assistant.row.checking');
export const sendLine = (lang: Lang, s: AssistantStatus): string => barText(lang, 'assistant.row.sendLine', { cap: ltr(`${s.perRequestCapCents}¢`) }) + (s.toggles.titlesAndMarkers ? ` · ${barText(lang, 'assistant.row.sendTitles')}` : '') + (s.toggles.peopleNames ? ` · ${barText(lang, 'assistant.row.sendPeople')}` : '');

let cache: { at: number; p: Promise<StatusState> } | null = null;
/** The status, fetched at most once every 5 s (the row mounts and unmounts as the query empties). A failure is "unknown". */
export function loadStatus(now = Date.now(), fetcher: () => Promise<AssistantStatusAnswer> = api.assistantStatus): Promise<StatusState> {
  if (cache && now - cache.at < 5000) return cache.p;
  const p = fetcher().then((s) => s, () => null);
  cache = { at: now, p };
  return p;
}
export const resetStatusCache = (): void => { cache = null; };

/** What a canceled job says: `sent` when the request had been handed to the service before the cancel (the job's attempt count), so it may have been charged. */
export const canceledWords = (lang: Lang, sent: boolean): string => barText(lang, sent ? 'assistant.row.canceledSent' : 'assistant.row.canceledUnsent');
/** The end of a canceled job as the row shows it (attempt 0 = canceled before anything was sent). */
export const canceledPhase = (j: { attempt?: number | null }): { phase: 'canceled'; sent: boolean } => ({ phase: 'canceled', sent: (j.attempt ?? 0) > 0 });

/** The words after a release: what was taken off the editor's count (a charge, if there was one, stands), or that nothing was held any more. */
export const releasedLine = (lang: Lang, r: { cents: number; gone: boolean }): string => (r.gone ? barText(lang, 'release.gone') : releasedWords(lang, r.cents));

type Job = { phase: 'idle' } | { phase: 'running'; jobId: string; stage: string | null; canceling: boolean } | { phase: 'canceled'; sent: boolean; jobId?: string } | { phase: 'failed'; words: RefusalWords; jobId?: string }
  | { phase: 'released'; cents: number; gone: boolean } | { phase: 'proposal'; proposalId: string; ops: OpCall[] | null; explanation: string | null; count: number };

type LocalJob = { id: string; status: string; stage: string | null; output: unknown; error: unknown; attempt?: number | null };
const POLL_MS = 700;

/**
 * The LOCAL assistant's part of the row (wave 7; decisions §4/§5): «לשאול את העוזר המקומי» under an unknown result only; while it works
 * the stage in words and «ביטול הבקשה»; then the suggested phrase (one dir=auto span) with «הכנס לשורה» (the palette's input gets the
 * phrase; the bar's grammar reads it and shows its preview; Enter commits one transaction, one undo; this row never commits) and
 * «התעלם»; both call `taken`, so the typed text is erased on the server. Every failure is a sentence with its next step; «not
 * understood» shows no phrase and no button. No money word anywhere: a local request costs nothing and holds nothing.
 */
function LocalPart({ q, lang, owner, rowRef }: { q: string; lang: Lang; owner: boolean; rowRef: React.RefObject<HTMLDivElement | null> }): ReactElement {
  const { editor, state } = useBarEditor();
  const bar = useSyncExternalStore(subscribeBarBridge, getBarBridge, getBarBridge);
  const [job, setJob] = useState<LocalJob | null>(null);
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<RefusalWords | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [note, setNote] = useState<'ignored' | 'takenFailed' | null>(null);
  const [inserted, setInserted] = useState<string | null>(null);
  const alive = useRef(true);
  const asked = useRef<string | null>(null); // the text the request was made for
  const untaken = useRef<string | null>(null); // a succeeded job whose phrase the server still holds
  const running = useRef<string | null>(null);
  const canceled = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; const id = untaken.current; if (id) void api.assistantTaken(id).catch(() => {}); }; }, []);
  const take = async (jobId: string): Promise<boolean> => { if (untaken.current === jobId) untaken.current = null; try { await api.assistantTaken(jobId); return true; } catch { return false; } };

  const kind = bar.query.trim() === q ? bar.kind : null; // the grammar's answer for THIS text (it lags a large project by its debounce)
  const base = localRowState(kind, job);
  const rs = asking && !job ? ({ kind: 'pending', stage: 'sending' } as const) : failure ? ({ kind: 'failed', code: '', message: '' } as const) : base;

  // the owner edited the text after the answer arrived: that answer was for other words; erase it and offer again
  useEffect(() => {
    if (job && rs.kind === 'suggested' && asked.current !== null && asked.current !== q) { void take(job.id); setJob(null); }
    if (inserted !== null && q !== inserted) setInserted(null);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  // keyboard: the button that went away hands the focus to the next one, unless the owner moved it elsewhere
  const focusIn = (id: string) => { const el = rowRef.current?.querySelector<HTMLElement>(`[data-testid="${id}"]`); el?.focus(); };
  useEffect(() => {
    const a = document.activeElement;
    if (a && a !== document.body && !rowRef.current?.contains(a)) return;
    if (rs.kind === 'pending') focusIn(TID.assistantCancel);
    else if (rs.kind === 'suggested') focusIn(TID.assistantLocalInsert);
    else if (rs.kind === 'failed' || rs.kind === 'none' || rs.kind === 'canceled') focusIn(TID.assistantLocalAsk);
  }, [rs.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const ask = async () => {
    const doc = state.doc;
    if (!doc || !q || !owner) return;
    setFailure(null); setNote(null); setInserted(null); setJob(null); setCanceling(false); canceled.current = false;
    asked.current = q; setAsking(true);
    try {
      const { jobId } = await api.askAssistant(doc.id, { text: q, selection: [...state.selection], playheadFrame: editor.frame, lang, ...(state.activeSequenceId ? { sequenceId: state.activeSequenceId } : {}) });
      running.current = jobId;
      for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!alive.current) return;
        const j = await api.job(jobId) as LocalJob;
        if (!alive.current) return;
        if (j.status === 'succeeded') { if (isLocalOutput(j.output) && j.output.phrase) untaken.current = j.id; setAsking(false); setJob(j); running.current = null; return; }
        if (['canceled', 'failed', 'submission-unknown'].includes(j.status)) { setAsking(false); setJob(j); running.current = null; return; }
        setAsking(false); setJob(j);
      }
    } catch (e) {
      running.current = null;
      if (alive.current) { setAsking(false); setFailure(refusalWords(lang, e instanceof ApiFailure ? { code: e.code, message: e.message, hint: e.hint ?? null } : { message: e instanceof Error ? e.message : String(e) })); }
    }
  };
  const cancel = async (from: HTMLElement) => {
    const id = running.current ?? job?.id;
    if (!id) return;
    canceled.current = true; setCanceling(true);
    (from.closest('[role=dialog]')?.querySelector('.pf-pal-input') as HTMLElement | null)?.focus(); // the button leaves with the request: the keyboard returns to the input
    try { await api.cancelJob(id); } catch (e) { canceled.current = false; if (alive.current) setCanceling(false); editor.fail(e); }
  };
  const insert = async (s: Extract<typeof rs, { kind: 'suggested' }>) => {
    // the bar's own scopes: the preview lives in «הכול»; from «עוזר» the owner is taken there
    (rowRef.current?.closest('[role=dialog]')?.querySelector('[data-testid=palette-scope-assistant][aria-pressed=true]') ? rowRef.current.closest('[role=dialog]')!.querySelector<HTMLElement>('[data-testid=palette-scope-all]') : null)?.click();
    if (!putInBar(s.phrase)) { editor.fail(new Error('the palette is not open')); return; }
    setInserted(s.phrase); setJob(null); setNote(null);
    if (!(await take(s.jobId)) && alive.current) setNote('takenFailed');
  };
  const ignore = async (s: Extract<typeof rs, { kind: 'suggested' | 'none' }>) => {
    setJob(null); setNote('ignored');
    (rowRef.current?.closest('[role=dialog]')?.querySelector('.pf-pal-input') as HTMLElement | null)?.focus();
    if (!(await take(s.jobId)) && alive.current) setNote('takenFailed');
  };
  const failedWords = failure ?? (rs.kind === 'failed' ? refusalWords(lang, { code: rs.code, message: rs.message }) : null);
  return <LocalRowView lang={lang} owner={owner} q={q} rs={rs} kind={kind} asking={asking} canceling={canceling} inserted={inserted} note={note} failedWords={failedWords} on={{ ask: () => void ask(), cancel: (el) => void cancel(el), insert: (x) => void insert(x), ignore: (x) => void ignore(x) }} />;
}

export interface LocalRowViewProps {
  lang: Lang; owner: boolean; q: string; rs: LocalRowState; kind: BarResultKind | null; asking: boolean; canceling: boolean; inserted: string | null;
  note: 'ignored' | 'takenFailed' | null; failedWords: RefusalWords | null;
  on: { ask(): void; cancel(el: HTMLElement): void; insert(s: Extract<LocalRowState, { kind: 'suggested' }>): void; ignore(s: Extract<LocalRowState, { kind: 'suggested' | 'none' }>): void };
}
/** What the local row shows for a state (pure: rendered to markup in tests). */
export function LocalRowView({ lang, owner, q, rs, kind, asking, canceling, inserted, note, failedWords, on }: LocalRowViewProps): ReactElement {
  const askButton = owner && (rs.kind === 'offer' || (kind === 'unknown' && (rs.kind === 'failed' || rs.kind === 'none' || rs.kind === 'canceled')));
  return (
    <>
      {rs.kind === 'offer' && <span className="pf-bar-asst-line">{dict(lang, 'assistant.local.nothingLeaves')}</span>}
      {rs.kind === 'hidden' && inserted === null && kind !== null && <span className="pf-bar-asst-line">{localText(lang, 'row.local.understoodByBar')}</span>}
      {rs.kind === 'pending' && <span className="pf-bar-asst-stage" role="status" data-testid={TID.assistantStage} data-stage={rs.stage ?? undefined} data-canceling={canceling || undefined}>{canceling ? localText(lang, 'row.local.canceling') : barText(lang, 'assistant.row.stage', { stage: stageWords(lang, rs.stage) })}</span>}
      {rs.kind === 'pending' && owner && !canceling && <span className="pf-bar-asst-actions"><button type="button" className="pf-bar-link" data-testid={TID.assistantCancel} onClick={(e) => on.cancel(e.currentTarget)}>{barText(lang, 'assistant.row.cancel')}</button></span>}
      {rs.kind === 'suggested' && (
        <span className="pf-bar-asst-proposal">
          <span className="pf-bar-asst-line" role="status" data-testid={TID.assistantLocalSuggestion} data-intent={rs.intent}>
            <span className="pf-bar-origin">{dict(lang, 'assistant.local.title')}</span> {dict(lang, 'assistant.local.suggested')} <span dir="auto" className="pf-bar-phrase">{rs.phrase}</span>
          </span>
          {rs.dropped && <span className="pf-bar-asst-line">{dict(lang, 'assistant.local.dropped')}</span>}
          {owner && (
            <span className="pf-bar-asst-actions">
              <button type="button" className="pf-pal-btn" data-testid={TID.assistantLocalInsert} onClick={() => on.insert(rs)}>{dict(lang, 'assistant.local.insert')}</button>
              <button type="button" className="pf-pal-btn" data-testid={TID.assistantLocalIgnore} onClick={() => on.ignore(rs)}>{dict(lang, 'assistant.local.ignore')}</button>
            </span>
          )}
        </span>
      )}
      {rs.kind === 'none' && <span className="pf-bar-asst-line" role="status" data-local-state="none">{dict(lang, 'assistant.local.none')}</span>}
      {rs.kind === 'canceled' && <span className="pf-bar-asst-stage" role="status" data-testid={TID.assistantCanceled} data-sent={rs.sent ? 'true' : 'false'}>{localText(lang, rs.sent ? 'row.local.canceledSent' : 'row.local.canceledUnsent')}</span>}
      {failedWords && <span className="pf-asst-bad" role="status" data-local-state="failed"><WithReason lang={lang} k="assistant.row.failed" words={failedWords} /></span>}
      {inserted !== null && q === inserted && <span className="pf-bar-badge" role="status" data-testid={TID.assistantLocalBadge}>{dict(lang, 'assistant.local.badge')}</span>}
      {inserted !== null && q === inserted && <span className="pf-bar-asst-line">{localText(lang, 'row.local.inserted')}</span>}
      {note === 'ignored' && <span className="pf-bar-asst-line" role="status">{localText(lang, 'row.local.ignored')}</span>}
      {note === 'takenFailed' && <span className="pf-asst-bad" role="status">{localText(lang, 'row.local.takenFailed')}</span>}
      {askButton && <span className="pf-bar-asst-actions"><button type="button" className="pf-pal-btn" data-testid={TID.assistantLocalAsk} disabled={!q || asking} onClick={() => on.ask()}>{dict(lang, 'assistant.local.ask')}</button></span>}
    </>
  );
}

export function AssistantRow({ query, lang, optionDomId }: AssistantRowProps): ReactElement {
  const { editor, state } = useBarEditor();
  const C = CHROME_STRINGS[lang];
  const [status, setStatus] = useState<StatusState>(null);
  const [job, setJob] = useState<Job>({ phase: 'idle' });
  const alive = useRef(true);
  const canceling = useRef(false); // the owner pressed «ביטול הבקשה» for the running request
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => { alive.current = true; void loadStatus().then((s) => { if (alive.current) setStatus(s); }); return () => { alive.current = false; }; }, []);
  /** The status again, now: after a request ended, the owner's status says whether its amount is still held. */
  const refreshStatus = async () => { resetStatusCache(); const s = await loadStatus(); if (alive.current && s) setStatus(s); }; // a failed read keeps what the row knew
  // the release button went away with the held amount: the keyboard goes back to the palette's input, not to nowhere
  const releasedNow = job.phase === 'released';
  useEffect(() => { if (releasedNow) (rowRef.current?.closest('[role=dialog]')?.querySelector('.pf-pal-input') as HTMLElement | null)?.focus(); }, [releasedNow]);
  const owner = state.actor === OWNER_ACTOR;
  const ready = isReady(status);
  const q = query.trim();

  const ask = async () => {
    const doc = state.doc;
    if (!doc || !q || !owner) return;
    try {
      const { jobId } = await api.askAssistant(doc.id, { text: q, selection: [...state.selection], playheadFrame: editor.frame, ...(state.activeSequenceId ? { sequenceId: state.activeSequenceId } : {}) });
      canceling.current = false;
      setJob({ phase: 'running', jobId, stage: 'sending', canceling: false });
      for (;;) {
        await new Promise((r) => setTimeout(r, 700));
        if (!alive.current) return;
        const j = await api.job(jobId);
        if (j.status === 'succeeded') {
          const out = j.output as { proposalId?: string; explanation?: string | null; opsCount?: number } | null;
          if (!out?.proposalId) { setJob({ phase: 'failed', words: refusalWords(lang, { code: 'invalid_model_output' }) }); return; }
          const list = await api.proposals(doc.id).catch(() => ({ proposals: [] }));
          const found = list.proposals.find((p) => p.id === out.proposalId) as ({ ops?: OpCall[] } | undefined);
          setJob({ phase: 'proposal', proposalId: out.proposalId, ops: found?.ops ?? null, explanation: out.explanation ?? null, count: out.opsCount ?? found?.ops?.length ?? 0 });
          return;
        }
        if (j.status === 'canceled') { const c = canceledPhase(j as { attempt?: number }); setJob({ ...c, jobId }); if (c.sent) void refreshStatus(); return; }
        if (j.status === 'failed' || j.status === 'submission-unknown') { setJob({ phase: 'failed', jobId, words: refusalWords(lang, j.error as { code?: string; message?: string; hint?: string } | null) }); void refreshStatus(); return; }
        setJob({ phase: 'running', jobId, stage: j.stage, canceling: canceling.current || j.status === 'cancel-requested' });
      }
    } catch (e) { if (alive.current) setJob({ phase: 'failed', words: refusalWords(lang, e instanceof ApiFailure ? { code: e.code, message: e.message, hint: e.hint ?? null } : { message: e instanceof Error ? e.message : String(e) }) }); }
  };
  /** Cancel the pending request (the owner's session; the same route as every job cancel). The poll above shows how it ended. */
  const cancel = async (jobId: string, from: HTMLElement) => {
    canceling.current = true;
    setJob((cur) => (cur.phase === 'running' ? { ...cur, canceling: true } : cur));
    // the button goes away with the request: the keyboard goes back to the palette's input, not to nowhere
    (from.closest('[role=dialog]')?.querySelector('.pf-pal-input') as HTMLElement | null)?.focus();
    try { await api.cancelJob(jobId); }
    catch (e) { canceling.current = false; if (alive.current) setJob((cur) => (cur.phase === 'running' ? { ...cur, canceling: false } : cur)); editor.fail(e); }
  };
  /** The held amount of the request that just ended, if the owner's status lists one (never for another session). */
  const held = owner && (job.phase === 'canceled' || job.phase === 'failed') ? heldAmount(status, job.jobId) : null;
  const onReleased = (r: { jobId: string; cents: number; gone: boolean }) => {
    resetStatusCache();
    setStatus((s) => (isOwnerStatus(s) ? withoutHeld(s, r.jobId) : s));
    setJob({ phase: 'released', cents: r.cents, gone: r.gone });
  };
  const decide = async (id: string, d: 'accept' | 'reject') => { await editor.decideProposal(id, d); if (alive.current) { setJob({ phase: 'idle' }); if (d === 'accept') editor.set({ paletteOpen: false }); } };

  return (
    <div
      ref={rowRef} className={`pf-pal-option is-assistant${ready ? ' is-live' : ''}`}
      id={optionDomId('assistant')} data-testid={TID.assistantRow} data-ready={ready || undefined} data-connected={ready ? 'true' : 'false'}
    >
      <span className="pf-pal-names"><Bot size={14} strokeWidth={1.75} aria-hidden="true" className="pf-pal-ic is-agent" /><span className="pf-pal-label"><bdi dir="auto">{C.palAssistantRow(q)}</bdi></span>
        {!ready && <span className="pf-pal-unavail">{setupWords(lang, status)}</span>}</span>
      {!ready && (
        <span className="pf-bar-asst-actions">
          {owner ? <button type="button" className="pf-bar-link" data-testid={TID.assistantConnect} onClick={() => { editor.set({ paletteOpen: false }); setSettingsOpen(true); }}>{dict(lang, 'assistant.howToConnect')}</button>
            : <span className="pf-bar-asst-line">{barText(lang, 'assistant.ownerOnly')}</span>}
        </span>
      )}
      {ready && status && !isOwnerStatus(status) && <span className="pf-bar-asst-line">{barText(lang, 'assistant.row.ownerUses')}</span>}
      {ready && isOwnerStatus(status) && isLocalAdapter(status.adapter) && <LocalPart q={q} lang={lang} owner={owner} rowRef={rowRef} />}
      {ready && isOwnerStatus(status) && !isLocalAdapter(status.adapter) && (
        <>
          <span className="pf-bar-asst-line"><Rich text={sendLine(lang, status)} /> · {dict(lang, 'assistant.proposeOnly')}</span>
          {job.phase === 'idle' && owner && <span className="pf-bar-asst-actions"><button type="button" className="pf-bar-link" disabled={!q} onClick={() => void ask()}>{barText(lang, 'assistant.row.send')}</button></span>}
          {job.phase === 'running' && <span className="pf-bar-asst-stage" role="status" data-testid={TID.assistantStage} data-stage={job.stage ?? undefined} data-canceling={job.canceling || undefined}>{job.canceling ? barText(lang, 'assistant.row.canceling') : barText(lang, 'assistant.row.stage', { stage: stageWords(lang, job.stage) })}</span>}
          {job.phase === 'running' && owner && !job.canceling && <span className="pf-bar-asst-actions"><button type="button" className="pf-bar-link" data-testid={TID.assistantCancel} onClick={(e) => void cancel(job.jobId, e.currentTarget)}>{barText(lang, 'assistant.row.cancel')}</button></span>}
          {job.phase === 'canceled' && <span className="pf-bar-asst-stage" role="status" data-testid={TID.assistantCanceled} data-sent={job.sent ? 'true' : 'false'}>{canceledWords(lang, job.sent)}</span>}
          {job.phase === 'failed' && <span className="pf-asst-bad" role="status"><WithReason lang={lang} k="assistant.row.failed" words={job.words} /></span>}
          {job.phase === 'released' && <span className="pf-bar-asst-stage" role="status" data-testid={TID.released}><Rich text={releasedLine(lang, job)} /></span>}
          {(job.phase === 'canceled' || job.phase === 'released' || held) && owner && (
            <span className="pf-bar-asst-actions">
              {held && <ReleaseHeld lang={lang} held={held} look="link" onDone={onReleased} />}
              {job.phase !== 'failed' && <button type="button" className="pf-bar-link" disabled={!q} onClick={() => void ask()}>{barText(lang, 'assistant.row.send')}</button>}
            </span>
          )}
          {job.phase === 'proposal' && (
            <span className="pf-bar-asst-proposal" data-testid={TID.assistantProposal}>
              <strong>{barText(lang, 'assistant.proposal.heading')}</strong>
              {job.explanation && <span className="pf-bar-asst-line"><bdi dir="auto">{barText(lang, 'assistant.proposal.explanation', { text: job.explanation })}</bdi></span>}
              {job.ops && state.rawDoc ? (
                <ol className="pf-bar-steps">{job.ops.map((c, i) => { const w = describeCall(state.rawDoc!, c, lang); return <li key={i} data-op={c.op}><span className="pf-bar-op">{w.op}</span>{w.detail && <>: <Rich text={w.detail} /></>}</li>; })}</ol>
              ) : <span className="pf-bar-asst-line">{barText(lang, 'assistant.proposal.missing')}</span>}
              <span className="pf-bar-asst-line">{barText(lang, 'assistant.proposal.count', { n: job.count })}</span>
              {owner && (
                <span className="pf-bar-asst-actions">
                  <button type="button" className="pf-pal-btn" data-testid={TID.assistantAccept} aria-label={barText(lang, 'assistant.proposal.acceptLabel')} onClick={() => void decide(job.proposalId, 'accept')}>{barText(lang, 'assistant.proposal.accept')}</button>
                  <button type="button" className="pf-pal-btn" data-testid={TID.assistantReject} aria-label={barText(lang, 'assistant.proposal.rejectLabel')} onClick={() => void decide(job.proposalId, 'reject')}>{barText(lang, 'assistant.proposal.reject')}</button>
                </span>
              )}
            </span>
          )}
        </>
      )}
    </div>
  );
}
export { auto };
