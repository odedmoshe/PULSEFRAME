/**
 * The story bar (W3), beside the film bar on the timeline: «הסיפור נבנה · ביטול · בנייה מחדש (changed options, never other taps) ·
 * החזרת החלקים שנמחקו», and the plan's notes. Uses api.regenerateStory (template-runs route, with expectedRevision). Undo is exactly
 * the transaction that applied the story. Works from state.storyRun or, after a reload, from the document's run (template:tpl.story).
 * It shows only while that run is in the document: an undone story takes its bar with it.
 */
import { useState, type ReactElement } from 'react';
import { removedByHand } from '@pulseframe/core';
import { AnchoredError, Button, Menu } from '../../ds/index.ts';
import { isolate } from '../../ds/util.tsx';
import { api } from '../../api.ts';
import { useEditorState } from '../store.ts';
import { storyStrings } from './story.strings.ts';
import { STORY_TESTIDS as ID } from './story.testids.ts';
import { currentStoryRun, findStoryTransaction, rebuildOptions, storyFailure } from './story.logic.ts';
import './story.css';

export function StoryBar({ lang }: { lang: 'he' | 'en' }): ReactElement | null {
  const { editor, state, t } = useEditorState();
  const S = storyStrings(lang);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const doc = state.doc;
  const view = doc ? currentStoryRun(doc, state.storyRun?.runId) : null;
  if (!doc || !view || !view.params) return null;
  const params = view.params;
  const txn = findStoryTransaction(state.activity, view.run.createdIds);
  const removed = removedByHand(doc, view.run.slots ?? []).length;
  const options = rebuildOptions(doc, params, lang);

  const undo = async () => {
    setError(null);
    if (!txn) return;
    await editor.undoTransaction(txn);
    editor.setStoryRun(null);
  };
  const regenerate = async (change: Partial<typeof params> | undefined, restoreRemoved = false) => {
    setBusy(true); setError(null);
    try {
      const r = await api.regenerateStory(doc.id, view.run.id, change, state.revision, restoreRemoved);
      const notes = r.warnings.filter((w) => w.code === 'moved_back' || w.code === 'filled_next_to_kept' || w.code === 'kept_by_hand' || w.code === 'music_short');
      setNote(notes.length ? notes.map((w) => S.warning[w.code]).join(' · ') : null);
      editor.setStoryRun({ runId: r.runId, params: { ...params, ...(change ?? {}) }, picks: r.picks, excluded: r.excluded, chips: r.chips });
      await editor.load(doc.id);
    } catch (e) { setError(storyFailure(lang, e, t as never).message); } finally { setBusy(false); }
  };

  return (
    <div className="pf-story-bar" data-testid={ID.bar} role="region" aria-label={S.made}>
      <b className="pf-story-bar-title">{S.made}</b>
      <Button size="sm" data-testid={ID.barUndo} disabled={busy} disabledReason={txn ? undefined : S.retapNote} onClick={() => void undo()}>{S.undo}</Button>
      <Menu label={S.rebuild} onSelect={(id) => { const o = options.find((x) => x.id === id); if (o) void regenerate(o.change); }}
        items={options.map((o) => ({ id: o.id, label: o.label }))}
        trigger={(p) => <Button {...p} size="sm" data-testid={ID.barRebuild} disabled={busy}>{S.rebuild}</Button>} />
      {removed > 0 && <Button size="sm" data-testid={ID.barRestore} disabled={busy} onClick={() => void regenerate(undefined, true)}>{S.restoreRemoved}</Button>}
      {busy && <span role="status" className="pf-story-muted">{S.working}</span>}
      {!busy && <span className="pf-story-muted" data-testid={ID.barNote}>{note ? isolate(note) : S.retapNote}</span>}
      {error && <AnchoredError onDismiss={() => setError(null)} dismissLabel={S.close}>{error}</AnchoredError>}
    </div>
  );
}
