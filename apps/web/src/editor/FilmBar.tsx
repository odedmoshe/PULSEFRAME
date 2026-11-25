/**
 * The bar after a film was made (ADR-0026): «הסרט נוצר · ביטול · רגעים אחרים · אורך אחר · למה הקליפים האלה?» — undo through the
 * editor (exactly the transaction that applied the film, found in the activity list), api.regenerateFilm with changed
 * parameters (the run's picks or its target length), and the list of picks with the reason of each, computed from the clip as it
 * plays now. Works from state.filmRun or, after a reload, from the document's run (recipeId template:tpl.family-film).
 * It shows only while that run is in the document: an undone film takes its bar with it. FILM_TESTIDS.bar*.
 */
import { useState, type ReactElement } from 'react';
import { FAMILY_FILM_DRAFT_LABEL, removedByHand, type FamilyFilmParams } from '@pulseframe/core';
import { AnchoredError, Button, Menu } from '../ds/index.ts';
import { isolate } from '../ds/util.tsx';
import { api } from '../api.ts';
import { useEditorState } from './store.ts';
import { FILM_TESTIDS as TID } from './familyFilm.testids.ts';
import { familyFilmStrings } from './familyFilm.strings.ts';
import { clipWhy, currentFilmRun, filmFailure, findFilmTransaction, otherLengths, otherMomentsParams, reasonLine } from './familyFilm.logic.ts';
import './familyFilm.css';

export interface FilmBarProps { lang: 'he' | 'en'; /** a film run of the document, when filmRun of this tab is null (after a reload) */ runId?: string | null }
export function FilmBar({ lang, runId }: FilmBarProps): ReactElement | null {
  const { editor, state } = useEditorState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const S = familyFilmStrings(lang);
  const doc = state.doc;
  const view = doc ? currentFilmRun(doc, runId ?? state.filmRun?.runId) : null;
  if (!doc || !view || !view.params) return null;
  const params = view.params;
  const others = otherMomentsParams(params, view.picked, doc);

  const filmTxn = findFilmTransaction(state.activity, view.run.createdIds);
  const undo = async () => {
    setError(null);
    if (!filmTxn) return;
    await editor.undoTransaction(filmTxn);
    editor.setFilmRun(null);
  };
  // clips of the film deleted by hand: a regeneration leaves them out; bringing them back is an explicit choice
  const removed = removedByHand(doc, view.run.slots ?? []).length;
  const regenerate = async (change: Partial<FamilyFilmParams>, restoreRemoved = false) => {
    setBusy(true); setError(null);
    try {
      const r = await api.regenerateFilm(doc.id, view.run.id, change, restoreRemoved);
      // clips that had only been moved are not kept where they were moved to; the film says so once, when it happened
      const moved = r.warnings.find((w) => w.code === 'moved_back');
      setNote(moved ? S.warning(moved) : null);
      editor.setFilmRun({ runId: r.runId, params: { ...params, ...change }, picks: r.picks, excluded: r.excluded, alternatives: [] });
      await editor.load(doc.id);
    } catch (e) { setError(filmFailure(lang, e).message); } finally { setBusy(false); }
  };
  const slots = (view.run.slots ?? []).filter((s) => s.kind === 'picture');

  return (
    <div className="pf-film-bar" data-testid={TID.bar} role="region" aria-label={S.made}>
      <b className="pf-film-bar-title">{S.made}</b>
      <Button size="sm" data-testid={TID.barUndo} disabled={busy} disabledReason={filmTxn ? undefined : S.undoUnavailable} onClick={() => void undo()}>{S.undo}</Button>
      <Button size="sm" data-testid={TID.barMoments} busy={busy} disabledReason={others ? undefined : S.noOtherMoments} onClick={() => { if (others) void regenerate({ picks: others.picks ?? {} }); }}>{S.otherMoments}</Button>
      <Menu label={S.otherLength} onSelect={(id) => void regenerate({ targetSeconds: Number(id) as 30 | 60 | 90 })}
        items={otherLengths(params.targetSeconds).map((s) => ({ id: String(s), label: S.lengthMenu(s) }))}
        trigger={(p) => <Button {...p} size="sm" data-testid={TID.barLength} disabled={busy}>{S.otherLength}</Button>} />
      {removed > 0 && <Button size="sm" data-testid={TID.barRestore} disabled={busy} onClick={() => void regenerate({}, true)}>{S.restoreRemoved}</Button>}
      <Button size="sm" variant="ghost" data-testid={TID.barWhy} aria-expanded={showWhy} onClick={() => setShowWhy((v) => !v)}>{S.whyClips}</Button>
      {busy && <span role="status" className="pf-film-muted">{S.working}</span>}
      {note && !busy && <span role="status" className="pf-film-muted" data-testid={TID.barNote}>{note}</span>}
      {error && <AnchoredError onDismiss={() => setError(null)} dismissLabel={S.close}>{error}</AnchoredError>}
      {showWhy && <p className="pf-film-muted pf-film-whynote">{FAMILY_FILM_DRAFT_LABEL[lang]}</p>}
      {showWhy && (
        <ol className="pf-film-whylist" data-testid={TID.barWhyList} aria-label={S.whyList}>
          {slots.map((slot) => {
            const w = clipWhy(doc, view, slot);
            if (!w) return null;
            const text = w.edited ? S.editedShort : reasonLine(w.reasons, lang) || S.noReason;
            return <li key={slot.key}>{isolate(S.whyListItem(w.asset.name, text))}</li>;
          })}
        </ol>
      )}
    </div>
  );
}
