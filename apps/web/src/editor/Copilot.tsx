/**
 * Copilot (UX_REDESIGN §4.11, wave A): a text surface for the editing assistant. There is no language model connected yet
 * (BLOCKERS B-9), so the chat tab says so honestly and offers nothing that would pretend otherwise; the plan area is the place the
 * assistant's step list will appear, and says that. The receipts tab is real: every revision an agent committed, from the project's
 * history, with a jump to the moment it touched and an undo that is offered only when it is the newest edit.
 * Nothing here edits the project except that undo, which is the ordinary undo.
 */
import { useMemo, useState } from 'react';
import { Bot, Send } from 'lucide-react';
import { findClip } from '@pulseframe/core';
import * as T from '@pulseframe/time';
import { dictionaries, type Key } from '@pulseframe/i18n';
import { Badge, Button, Seg, Tabs } from '../ds/index.ts';
import type { RevisionEvent } from '../api.ts';
import { useEditorState, type Editor } from './store.ts';
import { HUB_STRINGS } from './aiHub.strings.ts';
import './copilot.css';

type CopTab = 'chat' | 'receipts';
type Mode = 'guide' | 'run';
export const isAgentEvent = (e: Pick<RevisionEvent, 'actor'>) => e.actor.startsWith('agent');

export function Copilot() {
  const { editor, state } = useEditorState();
  const H = HUB_STRINGS[state.lang].cop;
  const [tab, setTab] = useState<CopTab>('chat');
  const [mode, setMode] = useState<Mode>('guide');
  const receipts = useMemo(() => state.activity.filter(isAgentEvent), [state.activity]);
  return (
    <aside className="pf-ds pf-cop" aria-label={H.title} data-testid="copilot">
      <header className="pf-cop-head">
        <span className="pf-cop-ico" aria-hidden="true"><Bot size={20} strokeWidth={1.75} /></span>
        <div className="pf-cop-titles"><h2>{H.title}</h2><span>{H.subtitle}</span></div>
        <Badge tone="hollow">{H.off}</Badge>
        <Seg label={H.mode} size="sm" value={mode} onChange={(v) => setMode(v)} options={[{ value: 'guide', label: H.guide }, { value: 'run', label: H.run }]} />
      </header>
      <Tabs label={H.title} value={tab} onChange={(id) => setTab(id as CopTab)} panelPrefix="pf-cop-panel" tabs={[{ id: 'chat', label: H.chat, testId: 'copilot-tab-chat' }, { id: 'receipts', label: H.receipts, count: receipts.length, testId: 'copilot-tab-receipts' }]} />
      {tab === 'chat' ? <Chat /> : <Receipts editor={editor} receipts={receipts} />}
    </aside>
  );
}

function Chat() {
  const { state } = useEditorState();
  const H = HUB_STRINGS[state.lang].cop;
  return (
    <div role="tabpanel" id="pf-cop-panel-chat" aria-labelledby="pf-cop-panel-tab-chat" className="pf-cop-body">
      <div className="pf-cop-off" data-testid="copilot-not-connected" role="status">
        <b>{H.off}</b>
        <p>{H.offWhy}</p>
        <details className="pf-cop-how">
          <summary>{H.offHow}</summary>
          <ol>{H.offSteps.map((x) => <li key={x}>{x}</li>)}</ol>
        </details>
      </div>
      <section className="pf-cop-plan" aria-label={H.plan} data-testid="copilot-plan">
        <h3>{H.plan}</h3>
        <p>{H.planEmpty}</p>
      </section>
      <form className="pf-cop-composer" onSubmit={(e) => e.preventDefault()}>
        <input type="text" placeholder={H.composer} aria-label={H.composer} disabled title={H.composerOff} data-testid="copilot-input" />
        <Button variant="primary" size="md" disabledReason={H.composerOff} icon={<Send size={16} aria-hidden="true" />} aria-label={H.composer} />
      </form>
    </div>
  );
}

function Receipts({ editor, receipts }: { editor: Editor; receipts: RevisionEvent[] }) {
  const { state } = useEditorState();
  const H = HUB_STRINGS[state.lang].cop;
  const doc = state.doc;
  const now = Date.now();
  const what = (e: RevisionEvent) => (e.ops?.length ? e.ops.map((o) => (dictionaries[state.lang][`op.${o}` as Key] as string | undefined) ?? o).join(' · ') : e.label ?? e.summary);
  /** the moment a receipt touched: the start of the first clip it names, as a frame to jump to */
  const momentOf = (e: RevisionEvent): { frame: number; clock: string } | null => {
    if (!doc) return null;
    for (const id of e.affectedIds) {
      const f = findClip(doc, id);
      if (f) {
        const rate = doc.settings.frameRate;
        const s = T.toSeconds(f.clip.start);
        return { frame: T.frameIndexAt(f.clip.start, rate), clock: `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}` };
      }
    }
    return null;
  };
  return (
    <div role="tabpanel" id="pf-cop-panel-receipts" aria-labelledby="pf-cop-panel-tab-receipts" className="pf-cop-body" data-testid="copilot-receipts">
      {receipts.length === 0 && <p className="pf-cop-empty">{H.receiptsEmpty}</p>}
      <ul className="pf-cop-list">
        {receipts.map((e) => {
          const m = momentOf(e);
          const latest = e.revision === state.revision;
          return (
            <li key={e.revision} className="pf-cop-receipt" data-testid="copilot-receipt" data-revision={e.revision}>
              <b dir="auto">{what(e)}</b>
              <span className="pf-cop-meta">{H.by} <bdi dir="auto">{H.agent}</bdi> · {H.ago(Math.max(0, Math.round((now - Date.parse(e.at)) / 1000)))}</span>
              <span className="pf-cop-chips">
                {m && <button type="button" className="pf-cop-chip" onClick={() => editor.seek(m.frame)} aria-label={`${H.jump} ${m.clock}`}><span className="num">{m.clock}</span></button>}
                <Button size="sm" variant="secondary" disabledReason={latest ? undefined : H.undoWhy} onClick={() => void editor.history('undo')} data-testid="copilot-undo">{H.undo}</Button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
