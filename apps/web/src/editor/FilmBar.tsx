/**
 * The bar after a film was made (ADR-0026): «הסרט נוצר · ביטול · רגעים אחרים · אורך אחר · למה הקליפים האלה?» — undo through the
 * editor, api.regenerateFilm with changed parameters, and the list of picks with their reasons. Works from state.filmRun, or
 * from the document's run (recipeId template:tpl.family-film) after a reload. FILM_TESTIDS.bar*.
 *
 * CONTRACT FILE (lead pre-pass): the export and its props are fixed; W3 builds the body; the lead mounts it. Until then nothing is drawn.
 */
import type { ReactElement } from 'react';

export interface FilmBarProps { lang: 'he' | 'en'; /** a film run of the document, when filmRun of this tab is null (after a reload) */ runId?: string | null }
export function FilmBar(_props: FilmBarProps): ReactElement | null {
  return null;
}
