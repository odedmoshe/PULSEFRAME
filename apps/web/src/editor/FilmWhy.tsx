/**
 * The inspector section of a clip that belongs to a film run (ADR-0026; found through the run's slots): its reason computed NOW
 * with core filmReasonsFor from the clip's current file and sourceIn (sourceFrameOfTime), «נערך ידנית» when its fingerprint
 * differs from the run's, an offer to measure when the file has no moments record, «רגע אחר» and «קליפ אחר», each ONE
 * editor.commit of replace_clip_media. Works from the document's run after a reload. FILM_TESTIDS.why*. The lead mounts it in
 * Inspector.tsx; it draws nothing for a clip that is not in a film.
 */
import { useState, type ReactElement } from 'react';
import { FAMILY_FILM_DRAFT_LABEL } from '@pulseframe/core';
import { AnchoredError, Button, Menu } from '../ds/index.ts';
import { isolate } from '../ds/util.tsx';
import { api } from '../api.ts';
import { useEditorState } from './store.ts';
import { FILM_TESTIDS as TID } from './familyFilm.testids.ts';
import { familyFilmStrings } from './familyFilm.strings.ts';
import { clipWhy, filmFailure, pearlLabelOf, reasonLine, replacementCandidates, runMeasurement, slotOfClip, swapClipOp, swapWindowOp } from './familyFilm.logic.ts';
import './familyFilm.css';

export interface FilmWhyProps { clipId: string; lang: 'he' | 'en' }
export function FilmWhy({ clipId, lang }: FilmWhyProps): ReactElement | null {
  const { editor, state } = useEditorState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const S = familyFilmStrings(lang);
  const doc = state.doc;
  const found = doc ? slotOfClip(doc, clipId) : null;
  const why = doc && found ? clipWhy(doc, found.view, found.slot) : null;
  if (!doc || !found || !why) return null;
  const used = found.view.picked.map((p) => p.assetId);
  const candidates = replacementCandidates(doc, clipId, used);
  const swapWindow = swapWindowOp(doc, clipId);

  const commit = async (op: ReturnType<typeof swapWindowOp>) => {
    if (!op) return;
    setBusy(true); setError(null);
    try { await editor.commit([op], S.swapDone); } finally { setBusy(false); }
  };
  const measure = async () => {
    setBusy(true); setError(null);
    try {
      const r = await runMeasurement({ start: (b) => api.measureMoments(doc.id, b), job: (id) => api.job(id), sleep: (ms) => new Promise((ok) => setTimeout(ok, ms)) }, [why.assetId]);
      if (r === 'succeeded') await editor.load(doc.id);
      if (r === 'failed') setError(S.notMeasured);
    } catch (e) { setError(filmFailure(lang, e).message); } finally { setBusy(false); }
  };

  return (
    <section className="pf-film-why" data-testid={TID.why} aria-label={S.whyHeading}>
      <h4>{S.whyHeading}</h4>
      <p className="pf-film-reason" data-testid={TID.whyReason}>{isolate(reasonLine(why.reasons, lang, pearlLabelOf(doc)) || S.noReason)}</p>
      {why.edited && <p className="pf-film-muted" data-testid={TID.whyEdited}>{S.edited}</p>}
      <p className="pf-film-muted">{FAMILY_FILM_DRAFT_LABEL[lang]}</p>
      {!why.measured && <Button size="sm" data-testid={TID.whyMeasure} busy={busy} onClick={() => void measure()}>{busy ? S.measuringOne : S.measure}</Button>}
      <div className="pf-film-why-actions">
          {!why.still && <Button size="sm" data-testid={TID.whyWindow} disabled={busy} disabledReason={swapWindow ? undefined : S.noOtherWindow} onClick={() => void commit(swapWindow)}>{S.swapWindow}</Button>}
          <Menu label={S.swapClip} onSelect={(id) => void commit(swapClipOp(doc, clipId, id))}
            items={candidates.map((a) => ({ id: a.id, label: a.name }))}
            trigger={(p) => <Button {...p} size="sm" data-testid={TID.whyClip} disabled={busy || candidates.length === 0} title={candidates.length ? undefined : S.noOtherClip}>{S.swapClip}</Button>} />
      </div>
      {error && <AnchoredError onDismiss={() => setError(null)} dismissLabel={S.close}>{error}</AnchoredError>}
    </section>
  );
}
