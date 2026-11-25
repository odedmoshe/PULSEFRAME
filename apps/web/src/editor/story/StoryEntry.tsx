/**
 * The entry to «ספרו מה היה» (W3): a menu item in the event card's ⋯ menu (variant 'event-menu', role=menuitem; C14: never a second
 * button in the row), a button in the start hub ('start-hub'); the palette uses the command view.openStory. Opens the dialog with
 * editor.openStory(source). STORY_TESTIDS.open with data-variant. LEAD PRE-PASS stub: renders nothing until W3 builds it.
 */
import type { StorySource } from '../store.ts';

export interface StoryEntryProps { variant: 'event-menu' | 'start-hub'; lang: 'he' | 'en'; source: StorySource | null; /** The menu closes after a choice. */ onChosen?: () => void }
export function StoryEntry(_props: StoryEntryProps) { return null; }
