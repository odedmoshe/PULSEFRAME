/**
 * «שמור כפנינה» on the selected transcript words (wave 7 pearls track): a button beside «מחק» in the transcript panel, enabled with a
 * selection; the span is the first word's start to the last word's end on the transcript's own asset (exact, no rounding), the name
 * is the words joined by spaces (cut to MAX_RANGE_LABEL); one add_source_range = one undo. A refusal (a name from a credential
 * that may not give one, the file gone) is said next to the button in words. TranscriptPanel.tsx mounts it while PEARLS_UI_BUILT.
 */
import { useState, type ReactElement } from 'react';
import type { Word } from '@pulseframe/core';
import { isolate } from '../../ds/util.tsx';
import { useEditorState } from '../store.ts';
import { commitWords } from './pearls.commit.ts';
import { addPearlOp, pearlOfWords } from './pearls.logic.ts';
import { pearlsT } from './pearls.strings.ts';
import { PEARLS_TESTIDS as ID } from './pearls.testids.ts';

export function SavePearlFromWords({ assetId, words }: { assetId: string | null; words: readonly Word[] }): ReactElement | null {
  const { editor, state } = useEditorState();
  const P = pearlsT(state.lang);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: 'saved' | 'problem'; text: string } | null>(null);
  const pearl = assetId ? pearlOfWords(assetId, words) : null;
  const save = async () => {
    if (!assetId || !pearl) return;
    setBusy(true); setNote(null);
    const c = await commitWords(editor, [addPearlOp(assetId, pearl.span, pearl.label, [])], 'Mark pearl from words', P('notBuilt'));
    setBusy(false);
    if (!c.ok) { setNote({ kind: 'problem', text: c.message }); return; }
    setNote({ kind: 'saved', text: P('saved') });
    if (c.result.transactionId) editor.notify({ kind: 'undo', title: P('saved'), undoes: c.result.transactionId });
  };
  return (
    <>
      <button type="button" className="ghost" disabled={!pearl || busy} aria-busy={busy || undefined} onClick={() => void save()} data-testid={ID.fromWords}>{P('save')}</button>
      {note && <span role={note.kind === 'problem' ? 'alert' : 'status'} className={note.kind === 'problem' ? 'muted danger' : 'muted'} data-testid="pearl-from-words-note">{isolate(note.text)}</span>}
    </>
  );
}
