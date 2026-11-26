/**
 * The bar after «צרו» (wave 8 growing, W3): «גדלים מול העיניים נוצר · עוד לא נצפה · ביטול · בנו מחדש · החזרת החלקים שנמחקו · למה?»,
 * beside the film and story bars (Timeline.tsx). It reads the document's run (recipeId GROWING_RUN_RECIPE_ID). Rebuild = api.regenerateGrowing
 * with no eyes (the server works them out from untouched clips); the restore button opens the dialog on the deleted pictures.
 */
import { useState, useSyncExternalStore, type ReactElement } from 'react';
import { Button } from '../../ds/index.ts';
import { isolate } from '../../ds/util.tsx';
import { api } from '../../api.ts';
import { useEditorState } from '../store.ts';
import { currentGrowingRun, dateWords, failureWords, whyRows } from './growing.logic.ts';
import { getGrowingLast, setGrowingIntent, setGrowingLast, subscribeGrowingLast } from './growing.link.ts';
import { growingStrings } from './growing.strings.ts';
import { GROWING_TESTIDS as ID } from './growing.testids.ts';
import './growing.css';

export function GrowingBar({ lang }: { lang: 'he' | 'en' }): ReactElement | null {
  const { editor, state } = useEditorState();
  const S = growingStrings(lang);
  const [busy, setBusy] = useState<null | 'rebuild'>(null);
  const [error, setError] = useState<string | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const last = useSyncExternalStore(subscribeGrowingLast, getGrowingLast);
  const doc = state.doc;
  const view = doc ? currentGrowingRun(doc) : null;
  if (!doc || !view) return null;
  const mine = last && last.runId === view.run.id ? last : null;
  const txn = findTransaction(state.activity, view.run.createdIds);

  const undo = async () => { setError(null); if (txn) { await editor.undoTransaction(txn); setGrowingLast(null); } };
  const rebuild = async () => {
    setBusy('rebuild'); setError(null);
    try {
      const r = await api.regenerateGrowing(doc.id, view.run.id, { expectedRevision: state.revision });
      setGrowingLast({ runId: r.runId, picks: r.picks, excluded: r.excluded });
      await editor.load(doc.id);
    } catch (e) { setError(failureWords(lang, e, S.notBuilt)); } finally { setBusy(null); }
  };
  const restore = () => { setGrowingIntent({ restore: { runId: view.run.id } }); editor.openGrowing(); };
  const needs = mine?.excluded.filter((x) => x.code === 'needs_marks') ?? [];
  const nameOf = (id: string) => doc.assets[id]?.name ?? id;
  const rows = mine ? whyRows(mine.picks) : [];

  return (
    <div className="pf-growing-bar" data-testid={ID.bar} role="region" aria-label={S.made}>
      <b>{S.made}</b>
      <span className="pf-growing-muted">{S.notWatched}</span>
      <Button size="sm" data-testid={ID.barUndo} disabled={busy !== null} disabledReason={txn ? undefined : S.undo} onClick={() => void undo()}>{S.undo}</Button>
      <Button size="sm" data-testid={ID.barRebuild} busy={busy === 'rebuild'} onClick={() => void rebuild()}>{S.rebuild}</Button>
      {view.deleted.length > 0 && <Button size="sm" data-testid={ID.barRestore} onClick={restore}>{S.restoreRemoved}</Button>}
      <Button size="sm" data-testid={ID.barWhy} aria-expanded={whyOpen} onClick={() => setWhyOpen((v) => !v)}>{S.why}</Button>
      {busy && <span role="status" className="pf-growing-muted">{S.rebuilding}</span>}
      {needs.length > 0 && <span className="pf-growing-muted" data-testid={ID.needsMarks}>{S.deletedNeedsMarks} ({S.needsMarksList(needs.length)})</span>}
      {error && <span role="alert" className="pf-growing-error">{error}</span>}
      {whyOpen && (
        <div className="pf-growing-why" data-testid={ID.why}>
          <h3>{S.whyTitle}</h3>
          {mine ? (
            <ul>
              {rows.map((r) => (
                <li key={`${r.assetId}:${r.frame}`} data-testid={ID.whyRow} data-asset-id={r.assetId} data-frame={r.frame ?? ''}>
                  {S.whyRow(nameOf(r.assetId), dateWords(r.date, S.undated), String(r.magnification), String(r.uncoveredPercent))}
                </li>
              ))}
              {mine.excluded.map((x) => <li key={`x${x.key}`} data-testid={ID.whyRow} data-asset-id={x.assetId} data-frame={x.frame ?? ''} data-code={x.code}>{isolate(nameOf(x.assetId))}: {S.excluded[x.code]}</li>)}
              {mine.excluded.length === 0 && <li className="pf-growing-muted">{S.noExclusions}</li>}
            </ul>
          ) : (
            <ul>
              {view.picked.map((p) => <li key={p.key} data-testid={ID.whyRow} data-asset-id={p.assetId} data-frame={p.frame ?? ''}>{isolate(nameOf(p.assetId))}</li>)}
              <li className="pf-growing-muted">{S.whyAfterReload}</li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** The transaction that applied the run (found through the clips it created), for the bar's undo. */
function findTransaction(activity: readonly unknown[], createdIds: readonly string[]): string | null {
  if (!createdIds.length) return null;
  const ids = new Set(createdIds);
  for (const ev of activity) {
    const e = ev as { transactionId?: string; undoneBy?: string | null; createdIds?: string[]; summary?: { createdIds?: string[] } };
    const made = e.createdIds ?? e.summary?.createdIds ?? [];
    if (e.transactionId && !e.undoneBy && made.some((c) => ids.has(c))) return e.transactionId;
  }
  return null;
}
