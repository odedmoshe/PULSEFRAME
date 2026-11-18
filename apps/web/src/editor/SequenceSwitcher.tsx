/**
 * The sequence switcher (ADR-0018, W3), mounted above the timeline: role=tablist with arrow keys and Home/End, aria-selected,
 * labels «ראשי» and «<name> · m:ss» (numbers in <bdi dir="ltr">), and a delete button for the shown short that opens a
 * confirmation dialog (aria-modal) committing remove_sequence { withContents: true }. Hidden while the project has one
 * sequence. Choosing a tab calls the editor's setActiveSequence (store.ts), which shows the projection core projectOutput
 * makes of the stored document. Test ids: shorts.testids.ts SHORTS_TESTIDS.switcher, tab, tabMain, tabDelete, deleteDialog,
 * deleteConfirm, deleteCancel.
 */
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { sequenceList, type SequenceSummary } from '@pulseframe/core';
import { dictionaries } from '@pulseframe/i18n';
import { Button, Dialog } from '../ds/index.ts';
import { useEditorState } from './store.ts';
import { SHORTS_TESTIDS as ID } from './shorts.testids.ts';
import { clock } from './shorts.view.ts';
import './shorts.css';

/**
 * Moves the keyboard focus to the tab of a sequence (main or a short) once it is on screen and focusable (a new short: the Shorts
 * panel calls this after its dialog closed). It retries until the tab really holds the focus (an inert page behind a dialog
 * refuses it); when the switcher is gone (only the main sequence is left) the focus goes to the main landmark.
 */
export function focusSequenceTab(id: string, tries = 20): void {
  const el = document.querySelector<HTMLElement>(`[data-testid="${ID.switcher}"] [role="tab"][data-sequence-id="${CSS.escape(id)}"]`);
  if (el) { el.focus(); if (document.activeElement === el) return; }
  if (tries > 0) { requestAnimationFrame(() => focusSequenceTab(id, tries - 1)); return; }
  const main = document.querySelector<HTMLElement>('main, [role="main"]');
  if (main && (!document.activeElement || document.activeElement === document.body)) { if (!main.hasAttribute('tabindex')) main.tabIndex = -1; main.focus(); }
}

/** The confirmation before a short is removed with everything in it (also used by the built-shorts list). */
export function ConfirmRemoveSequence({ sequence, onClose, onRemoved }: { sequence: SequenceSummary | null; onClose: () => void; onRemoved?: () => void }) {
  const { editor, state } = useEditorState();
  const t = dictionaries[state.lang];
  const [busy, setBusy] = useState(false);
  if (!sequence) return null;
  const run = async () => {
    setBusy(true);
    try {
      const r = await editor.commit([{ op: 'remove_sequence', args: { sequenceId: sequence.id, withContents: true } }], 'Remove short');
      onClose();
      if (r) onRemoved?.();
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title={`${t['sequence.delete']}: ${sequence.name}`} size="sm" dismissOnBackdrop={false} closeLabel={state.lang === 'he' ? 'סגירה' : 'Close'} testId={ID.deleteDialog}
      footer={<>
        <Button variant="ghost" onClick={onClose} data-testid={ID.deleteCancel}>{state.lang === 'he' ? 'ביטול' : 'Cancel'}</Button>
        <Button variant="danger" busy={busy} onClick={() => void run()} data-testid={ID.deleteConfirm}>{t['sequence.delete']}</Button>
      </>}>
      <p>{t['sequence.delete.confirm']}</p>
    </Dialog>
  );
}

export function SequenceSwitcher() {
  const { editor, state } = useEditorState();
  const [removing, setRemoving] = useState<SequenceSummary | null>(null);
  const raw = state.rawDoc;
  if (!raw) return null;
  const list = sequenceList(raw);
  if (list.length < 2) return null; // hidden while the project has one sequence
  const t = dictionaries[state.lang];
  const rtl = state.lang === 'he';
  const active = state.activeSequenceId;
  const activeRow = list.find((s) => s.id === active);
  const go = (id: string) => { editor.setActiveSequence(id); requestAnimationFrame(() => focusSequenceTab(id)); };
  const onKey = (e: React.KeyboardEvent) => {
    const i = Math.max(0, list.findIndex((s) => s.id === active));
    let n = i;
    if (e.key === 'ArrowRight') n = rtl ? i - 1 : i + 1;
    else if (e.key === 'ArrowLeft') n = rtl ? i + 1 : i - 1;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = list.length - 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    go(list[(n + list.length) % list.length]!.id);
  };
  return (
    <div className="seq-switch pf-ds" data-testid={ID.switcher}>
      <div role="tablist" aria-label={t['sequence.switcher']} onKeyDown={onKey} className="seq-tabs">
        {list.map((s) => (
          <button key={s.id} type="button" role="tab" id={`sequence-tab-${s.id}`} aria-selected={s.id === active} tabIndex={s.id === active ? 0 : -1}
            className={`seq-tab${s.id === active ? ' is-active' : ''}`} data-testid={s.main ? ID.tabMain : ID.tab} data-sequence-id={s.id} onClick={() => go(s.id)}>
            {s.main ? t['sequence.main'] : <><span className="seq-name" dir="auto">{s.name}</span> · <bdi dir="ltr">{clock(s.durationSeconds)}</bdi></>}
          </button>
        ))}
      </div>
      {activeRow && !activeRow.main && (
        <button type="button" className="seq-delete" data-testid={ID.tabDelete} data-sequence-id={activeRow.id} onClick={() => setRemoving(activeRow)}
          aria-label={`${t['sequence.delete']}: ${activeRow.name}`} title={t['sequence.delete']}>
          <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
      <ConfirmRemoveSequence sequence={removing} onClose={() => setRemoving(null)} onRemoved={() => requestAnimationFrame(() => focusSequenceTab(raw.mainSequenceId))} />
    </div>
  );
}
