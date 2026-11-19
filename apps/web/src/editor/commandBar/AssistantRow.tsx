/**
 * The assistant's row in the palette (ADR-0027; plan §6 "Assistant row"): «עוזר השפה לא מחובר» with «איך מחברים» until the
 * server's status says 'ready'; then the send line, the job's stage in words (never a percentage), the proposal's steps with
 * accept and reject (editor.decideProposal: the owner accepts, as one owner transaction). The assistant only proposes.
 * Nothing here pretends a model answered: a failed or missing status reads as not connected.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Bot } from 'lucide-react';
import { ASSISTANT_STAGES, type AssistantStatus, type OpCall } from '@pulseframe/core';
import type { Lang } from '@pulseframe/i18n';
import { api, ApiFailure } from '../../api.ts';
import { CHROME_STRINGS } from '../chrome.strings.ts';
import { setSettingsOpen } from '../chromeState.ts';
import { useEditorState } from '../store.ts';
import { COMMAND_BAR_TESTIDS as TID } from './commandBar.testids.ts';
import { auto, barText, dict, ltr } from './commandBar.strings.ts';
import type { AssistantRowProps } from './contract.ts';
import { describeCall } from './describe.ts';
import { Rich } from './BarPreview.tsx';
import './commandBar.css';

export const OWNER_ACTOR = 'user:local';
/** null = unknown (not fetched, or the route answered 501 or failed): the honest state is "not connected". */
export type StatusState = AssistantStatus | null;
export const isReady = (s: StatusState): boolean => s?.setup === 'ready';
/** The words for a setup state; a missing status and 'provider_not_configured' both read «עוזר השפה לא מחובר». */
export const setupWords = (lang: Lang, s: StatusState): string => dict(lang, s ? `assistant.setup.${s.setup}` : 'assistant.notConnected');
export const stageWords = (lang: Lang, stage: string | null): string => (ASSISTANT_STAGES as readonly string[]).includes(stage ?? '') ? dict(lang, `assistant.stage.${stage}`) : barText(lang, 'assistant.row.checking');
export const sendLine = (lang: Lang, s: AssistantStatus): string => barText(lang, 'assistant.row.sendLine', { cap: ltr(`${s.perRequestCapCents}¢`) }) + (s.toggles.titlesAndMarkers ? ` · ${barText(lang, 'assistant.row.sendTitles')}` : '') + (s.toggles.peopleNames ? ` · ${barText(lang, 'assistant.row.sendPeople')}` : '');

let cache: { at: number; p: Promise<StatusState> } | null = null;
/** The status, fetched at most once every 5 s (the row mounts and unmounts as the query empties). A failure is "unknown". */
export function loadStatus(now = Date.now(), fetcher: () => Promise<AssistantStatus> = api.assistantStatus): Promise<StatusState> {
  if (cache && now - cache.at < 5000) return cache.p;
  const p = fetcher().then((s) => s, () => null);
  cache = { at: now, p };
  return p;
}
export const resetStatusCache = (): void => { cache = null; };

type Job = { phase: 'idle' } | { phase: 'running'; jobId: string; stage: string | null } | { phase: 'failed'; reason: string } | { phase: 'proposal'; proposalId: string; ops: OpCall[] | null; explanation: string | null; count: number };

export function AssistantRow({ query, lang, optionDomId }: AssistantRowProps): ReactElement {
  const { editor, state } = useEditorState();
  const C = CHROME_STRINGS[lang];
  const [status, setStatus] = useState<StatusState>(null);
  const [job, setJob] = useState<Job>({ phase: 'idle' });
  const alive = useRef(true);
  useEffect(() => { alive.current = true; void loadStatus().then((s) => { if (alive.current) setStatus(s); }); return () => { alive.current = false; }; }, []);
  const owner = state.actor === OWNER_ACTOR;
  const ready = isReady(status);
  const q = query.trim();

  const ask = async () => {
    const doc = state.doc;
    if (!doc || !q || !owner) return;
    try {
      const { jobId } = await api.askAssistant(doc.id, { text: q, selection: [...state.selection], playheadFrame: editor.frame, ...(state.activeSequenceId ? { sequenceId: state.activeSequenceId } : {}) });
      setJob({ phase: 'running', jobId, stage: 'sending' });
      for (;;) {
        await new Promise((r) => setTimeout(r, 700));
        if (!alive.current) return;
        const j = await api.job(jobId);
        if (j.status === 'succeeded') {
          const out = j.output as { proposalId?: string; explanation?: string | null; opsCount?: number } | null;
          if (!out?.proposalId) { setJob({ phase: 'failed', reason: dict(lang, 'error.code.invalid_model_output') }); return; }
          const list = await api.proposals(doc.id).catch(() => ({ proposals: [] }));
          const found = list.proposals.find((p) => p.id === out.proposalId) as ({ ops?: OpCall[] } | undefined);
          setJob({ phase: 'proposal', proposalId: out.proposalId, ops: found?.ops ?? null, explanation: out.explanation ?? null, count: out.opsCount ?? found?.ops?.length ?? 0 });
          return;
        }
        if (j.status === 'failed' || j.status === 'canceled') { setJob({ phase: 'failed', reason: failureWords(lang, j.error) }); return; }
        setJob({ phase: 'running', jobId, stage: j.stage });
      }
    } catch (e) { if (alive.current) setJob({ phase: 'failed', reason: failureWords(lang, e instanceof ApiFailure ? { code: e.code, message: e.message } : e) }); }
  };
  const decide = async (id: string, d: 'accept' | 'reject') => { await editor.decideProposal(id, d); if (alive.current) { setJob({ phase: 'idle' }); if (d === 'accept') editor.set({ paletteOpen: false }); } };

  return (
    <div
      className={`pf-pal-option is-assistant${ready ? ' is-live' : ''}`} role="option" aria-selected="false" aria-disabled={ready ? undefined : 'true'}
      id={optionDomId('assistant')} data-testid={TID.assistantRow} data-ready={ready || undefined}
    >
      <span className="pf-pal-names"><Bot size={14} strokeWidth={1.75} aria-hidden="true" className="pf-pal-ic is-agent" /><span className="pf-pal-label"><bdi dir="auto">{C.palAssistantRow(q)}</bdi></span>
        {!ready && <span className="pf-pal-unavail">{setupWords(lang, status)}</span>}</span>
      {!ready && (
        <span className="pf-bar-asst-actions">
          {owner ? <button type="button" className="pf-bar-link" data-testid={TID.assistantConnect} onClick={() => { editor.set({ paletteOpen: false }); setSettingsOpen(true); }}>{dict(lang, 'assistant.howToConnect')}</button>
            : <span className="pf-bar-asst-line">{barText(lang, 'assistant.ownerOnly')}</span>}
        </span>
      )}
      {ready && status && (
        <>
          <span className="pf-bar-asst-line"><Rich text={sendLine(lang, status)} /> · {dict(lang, 'assistant.proposeOnly')}</span>
          {job.phase === 'idle' && owner && <span className="pf-bar-asst-actions"><button type="button" className="pf-bar-link" disabled={!q} onClick={() => void ask()}>{barText(lang, 'assistant.row.send')}</button></span>}
          {job.phase === 'running' && <span className="pf-bar-asst-stage" role="status" data-testid={TID.assistantStage} data-stage={job.stage ?? undefined}>{barText(lang, 'assistant.row.stage', { stage: stageWords(lang, job.stage) })}</span>}
          {job.phase === 'failed' && <span className="pf-asst-bad" role="status"><bdi dir="auto">{barText(lang, 'assistant.row.failed', { reason: job.reason })}</bdi></span>}
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
function failureWords(lang: Lang, e: unknown): string {
  const code = (e as { code?: string } | null)?.code;
  const known = code ? dict(lang, `error.code.${code}`) : '';
  if (code && known !== `error.code.${code}`) return known;
  return (e as { message?: string } | null)?.message ?? dict(lang, 'error.code.provider_error');
}
export { auto };
