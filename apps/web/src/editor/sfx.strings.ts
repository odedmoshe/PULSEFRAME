/** Strings of the sound-effects browser (kept here so the shared dictionaries stay untouched). */
export const SFX_STRINGS = {
  he: {
    title: 'אפקטים קוליים', search: 'חיפוש אפקט קולי לפי שם', searchPlaceholder: 'חיפוש…', categories: 'קטגוריות', all: 'הכול',
    play: 'השמעה', stop: 'עצירה', add: 'הוספה', seconds: 'שנ׳', empty: 'אין תוצאות', loading: 'טוען…', loadFailed: 'טעינת האפקטים נכשלה',
    playFailed: 'ההשמעה נכשלה', added: 'נוסף', at: 'ב־', adding: 'מוסיף…', list: 'רשימת אפקטים קוליים',
    cat: { ui: 'ממשק', whoosh: 'שוש', impact: 'מכה', riser: 'עלייה', glitch: 'גליץ׳', notify: 'התראה', cartoon: 'קריקטורה', ambience: 'אווירה', drum: 'תופים', tone: 'צליל' },
  },
  en: {
    title: 'Sound effects', search: 'Search sound effects by name', searchPlaceholder: 'Search…', categories: 'Categories', all: 'All',
    play: 'Play', stop: 'Stop', add: 'Add', seconds: 's', empty: 'No results', loading: 'Loading…', loadFailed: 'Could not load the sound effects',
    playFailed: 'Playback failed', added: 'Added', at: 'at', adding: 'Adding…', list: 'Sound effects',
    cat: { ui: 'UI', whoosh: 'Whoosh', impact: 'Impact', riser: 'Riser', glitch: 'Glitch', notify: 'Notify', cartoon: 'Cartoon', ambience: 'Ambience', drum: 'Drums', tone: 'Tones' },
  },
} as const;
export const SFX_CATEGORIES = ['ui', 'whoosh', 'impact', 'riser', 'glitch', 'notify', 'cartoon', 'ambience', 'drum', 'tone'] as const;
