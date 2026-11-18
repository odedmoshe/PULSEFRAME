/**
 * The entry to the family film (ADR-0026): a button or card that opens the dialog on an event's files or the library selection
 * (editor.openFilm(source)). Variants: 'event-card' (life-line's event card), 'start-hub' (the start hub, next to «מתחילים
 * מרגע»), 'palette' (the command palette row). FILM_TESTIDS.open with data-variant. Accessible name begins with the visible word.
 *
 * CONTRACT FILE (lead pre-pass): the export and its props are fixed; W3 builds the body; the lead mounts it with one line in each
 * place. Until then nothing is drawn (no entry to a feature that is not built).
 */
import type { ReactElement } from 'react';
import type { FilmSource } from './store.ts';

export interface FamilyFilmEntryProps {
  variant: 'event-card' | 'start-hub' | 'palette';
  /** What the dialog opens with; null = the editor's current selection of library files. */
  source: FilmSource | null;
  lang: 'he' | 'en';
}
export function FamilyFilmEntry(_props: FamilyFilmEntryProps): ReactElement | null {
  return null;
}
