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
  /** What a click does while there is nothing to film (the start hub: choose files first); without it the entry is disabled then. */
  onEmpty?: () => void;
}
export function FamilyFilmEntry({ variant, source, lang, onEmpty }: FamilyFilmEntryProps): ReactElement | null {
  const { editor, state } = useEditorState();
  const S = familyFilmStrings(lang);
  const doc = state.doc;
  if (!doc) return null;
  const empty = !source && sourceFromSelection(doc, state.selection).assetIds.length === 0;
  const open = () => { if (!empty) editor.openFilm(source ?? sourceFromSelection(doc, state.selection)); else onEmpty?.(); };
  const disabled = empty && !onEmpty;
  return (
    <button type="button" className={`pf-film-entry is-${variant}`} data-testid={TID.open} data-variant={variant} onClick={open} aria-disabled={disabled || undefined} title={disabled ? S.emptySource : undefined}>
      <Film size={variant === 'start-hub' ? 20 : 16} aria-hidden="true" />
      <span className="pf-film-entry-text"><b>{S.entry[variant]}</b>{variant === 'start-hub' && <span>{empty && onEmpty ? S.entryHintEmpty : S.entryHint}</span>}</span>
    </button>
  );
}
