/**
 * Strings of the mounts of the content packs, the built-in music and the fonts in the browser drawer (ADR-0022): the tabs of the
 * audio drawer, the fonts section of the text drawer, and the states the mounts show. Hebrew first; English covers the same keys.
 * (The components themselves, PacksShelf, PackPage, MusicBrowser and FontPicker, keep their own strings.)
 */
export const PACKS_MOUNT_STRINGS = {
  he: {
    audioTabs: 'מקורות סאונד', tabEffects: 'אפקטי קול', tabMusic: 'מוזיקה מובנית',
    fontsTitle: 'גופנים', fontsLead: 'הגופן של הכותרת שנבחרה בציר הזמן. כל גופן מוצג באותיות שלו', fontsNeedTitle: 'בחרו כותרת בציר הזמן כדי להחליף את הגופן שלה',
    musicNeedProject: 'מוזיקה מובנית נוספת לפרויקט פתוח בלבד', packsNeedProject: 'חבילות נוספות לפרויקט פתוח בלבד',
    templatesLoading: 'טוען תבניות…', templatesFailed: 'לא ניתן לטעון את התבניות: {why}', templateMissing: 'התבנית של החבילה הזאת אינה זמינה בבנייה הזאת', retry: 'ניסיון חוזר',
  },
  en: {
    audioTabs: 'Sound sources', tabEffects: 'Sound effects', tabMusic: 'Built-in music',
    fontsTitle: 'Fonts', fontsLead: 'The font of the title selected on the timeline. Every font is drawn in its own letters', fontsNeedTitle: 'Select a title on the timeline to change its font',
    musicNeedProject: 'Built-in music is added to an open project only', packsNeedProject: 'Packs are added to an open project only',
    templatesLoading: 'Loading templates…', templatesFailed: 'The templates could not be loaded: {why}', templateMissing: 'The template of this pack is not available in this build', retry: 'Try again',
  },
} as const satisfies Record<'he' | 'en', Record<string, string>>;
export type PacksMountKey = keyof typeof PACKS_MOUNT_STRINGS.he;
