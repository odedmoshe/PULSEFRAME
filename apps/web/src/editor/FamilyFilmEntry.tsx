/**
 * The entry to the family film (ADR-0026): a button or card that opens the dialog on an event's files or the editor's current
 * selection (editor.openFilm(source)). Variants: 'event-card', 'start-hub', 'palette'. FILM_TESTIDS.open with data-variant.
 * Its accessible name is its visible text. The lead mounts it with one line in each place.
 */
import type { ReactElement } from 'react';
import { Film } from 'lucide-react';
import { useEditorState, type FilmSource } from './store.ts';
import { FILM_TESTIDS as TID } from './familyFilm.testids.ts';
import { familyFilmStrings } from './familyFilm.strings.ts';
import { sourceFromSelection } from './familyFilm.logic.ts';
import './familyFilm.css';

export interface FamilyFilmEntryProps {
  variant: 'event-card' | 'start-hub' | 'palette';
  /** What the dialog opens with; null = the editor's current selection (its clips' files, else the library's pictures and videos). */
  source: FilmSource | null;
  lang: 'he' | 'en';
}
export function FamilyFilmEntry({ variant, source, lang }: FamilyFilmEntryProps): ReactElement | null {
  const { editor, state } = useEditorState();
  const S = familyFilmStrings(lang);
  const doc = state.doc;
  if (!doc) return null;
  const open = () => { if (!empty) editor.openFilm(source ?? sourceFromSelection(doc, state.selection)); };
  const empty = !source && sourceFromSelection(doc, state.selection).assetIds.length === 0;
  return (
    <button type="button" className={`pf-film-entry is-${variant}`} data-testid={TID.open} data-variant={variant} onClick={open} aria-disabled={empty || undefined} title={empty ? S.emptySource : undefined}>
      <Film size={variant === 'start-hub' ? 20 : 16} aria-hidden="true" />
      <span className="pf-film-entry-text"><b>{S.entry[variant]}</b>{variant === 'start-hub' && <span>{S.entryHint}</span>}</span>
    </button>
  );
}
