/**
 * The entry to «ספרו מה היה» (W3): a menu item in the event card's ⋯ menu (variant 'event-menu', role=menuitem; C14: never a second
 * button in the row), a button in the start hub ('start-hub'); the palette uses the command view.openStory. Opens the dialog with
 * editor.openStory(source). STORY_TESTIDS.open with data-variant.
 */
import type { ReactElement } from 'react';
import { BookOpenText } from 'lucide-react';
import { useEditorState, type StorySource } from '../store.ts';
import { sourceFromSelection } from '../familyFilm.logic.ts';
import { storyStrings } from './story.strings.ts';
import { STORY_TESTIDS as ID } from './story.testids.ts';
import './story.css';

export interface StoryEntryProps { variant: 'event-menu' | 'start-hub'; lang: 'he' | 'en'; source: StorySource | null; /** The menu closes after a choice. */ onChosen?: () => void }
export function StoryEntry({ variant, lang, source, onChosen }: StoryEntryProps): ReactElement | null {
  const { editor, state } = useEditorState();
  const S = storyStrings(lang);
  const doc = state.doc;
  if (!doc) return null;
  const from = source ?? sourceFromSelection(doc, state.selection);
  const empty = from.assetIds.length === 0;
  const open = () => { if (empty) return; onChosen?.(); editor.openStory({ assetIds: [...from.assetIds], event: from.event ?? null }); };
  if (variant === 'event-menu') {
    return <button type="button" role="menuitem" className="pf-mc-item" data-testid={ID.open} data-variant={variant} onClick={open}>{S.name}</button>;
  }
  return (
    <button type="button" className="pf-story-entry is-start-hub" data-testid={ID.open} data-variant={variant} aria-disabled={empty || undefined} onClick={open}>
      <BookOpenText size={20} aria-hidden="true" />
      <span className="pf-story-entry-text"><b>{S.name}</b><span>{S.tapIntro}</span></span>
    </button>
  );
}
