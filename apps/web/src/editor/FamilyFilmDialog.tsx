/**
 * The family film dialog (ADR-0026; plan §7 with the verifier's corrections), on the design system's Dialog (ds/Dialog.tsx:
 * modal, focus trap, Escape closes, focus returns to the opener), Hebrew first and right to left, three steps:
 * (1) «מה בסרט» — the event or selection (state.filmSource), a clip grid with checkboxes, count and total length in <bdi class="num">;
 * (2) «אורך ומוזיקה» — Seg 30/60/90; music (sound files with beats, an inline «מדידת קצב» for one without, «בלי מוזיקה»);
 *     sound Seg «מתחת למוזיקה» / «הקולות מובילים» / «בלי קול מקורי»; order Seg «לפי זמן הצילום» / «לפי סדר הבחירה» / «קשת אנרגיה»; title;
 * (3) «התוכנית» — plan; measure what plan.needsMeasurement lists (JobRow «מודד רגעים i/n · היוריסטיקה, בלי בינה מלאכותית»,
 *     role=status, cancel), plan again; one row per pick (thumbnail, name, capture time, span and seconds, reason line,
 *     MomentsStrip, «רגע אחר», «קליפ אחר», «הוצאה מהסרט»); «לא נכנסו (n)» with «הכנסה»; warnings; the footer with the draft
 *     label; «יצירת הסרט» (api.applyFilm at the plan's revision, then editor.setFilmRun and close); refusals in Hebrew next to the
 *     control that caused them.
 * Calls only: api.measureMoments, momentsData, planFilm, applyFilm, cancelJob, the job polling helper, analyzeAssetJob, and the
 * editor's commit/undo/openFilm/closeFilm/setFilmRun. Logic in familyFilm.logic.ts, strings in familyFilm.strings.ts, ids FILM_TESTIDS.
 *
 * CONTRACT FILE (lead pre-pass): the export and its props are fixed; W3 builds the body; the lead mounts it once (App.tsx).
 * Until then nothing is drawn.
 */
import type { ReactElement } from 'react';

export interface FamilyFilmDialogProps { lang: 'he' | 'en' }
export function FamilyFilmDialog(_props: FamilyFilmDialogProps): ReactElement | null {
  return null;
}
