/**
 * Strings of the built-in music browser (ADR-0022; the audio drawer's second tab), Hebrew first. The label every unheard style
 * carries and the tempo line come from the shared tables (core MUSIC_UNHEARD_LABEL, i18n music.knownFromRecipe and
 * music.section.*): music.logic.test.ts keeps these equal to them. Every style is 'unheard' until the owner listens, and the
 * strings say so; nothing here calls a style good.
 */
const he = {
  tab: 'מוזיקה מובנית', title: 'מוזיקה מובנית',
  intro: 'מוזיקה מקורית שהתוכנה מחברת ומנגנת בעצמה, באורך של תיבות שלמות ועם סיום אמיתי. בלי שירים של אחרים. הצליל הרגיל מסונתז; כשהם זמינים אפשר לבחור גם כלים מוקלטים מהספרייה.',
  unheard: 'מוזיקה מובנית — עוד לא הושמעה לאף אחד', unheardShort: 'עוד לא הושמעה לאף אחד',
  knownFromRecipe: 'קצב ידוע מהמתכון', bpm: 'BPM',
  length: 'אורך', bars: 'תיבות', fit: 'כאורך הסרטון', fitEmpty: 'הסרטון עוד ריק', fitUnknown: 'לא ידוע מה אורך הסרטון', fitTooLong: 'הסרטון ארוך מ־5 דקות, האורך המרבי של מוזיקה מובנית',
  barsTooShort: 'הסגנון הזה לא נוצר באורך קצר כל כך', barsTooLong: 'ארוך מ־5 דקות, האורך המרבי של מוזיקה מובנית',
  seed: 'גרסה', seedDown: 'גרסה קודמת', seedUp: 'גרסה הבאה',
  seconds: 'שנ׳', megabytes: 'MB', sizeLabel: 'מה יתווסף',
  play: 'השמעה', stop: 'עצירה', loadingPreview: 'מכין השמעה…', previewFirst: 'מושמעות 32 התיבות הראשונות',
  add: 'הוספה לציר הזמן', addHint: 'נכנס מתחילת הסרט, ברצועת קול', adding: 'יוצר את המוזיקה…', added: 'נוסף לציר הזמן', addedLibrary: 'נוסף לספרייה',
  sections: 'מבנה הקטע', list: 'סגנונות מוזיקה מובנית',
  busy: 'נוצרת עכשיו מוזיקה אחרת. אפשר לנסות שוב בעוד רגע', failed: 'יצירת המוזיקה נכשלה', playFailed: 'ההשמעה נכשלה',
  section: { intro: 'פתיחה', build: 'עלייה', peak: 'שיא', break: 'הפוגה', ending: 'סיום' },
};
export type MusicStrings = typeof he;
const en: MusicStrings = {
  tab: 'Built-in music', title: 'Built-in music',
  intro: 'Original music this program composes and plays by itself, in whole bars and with a real ending. No other people\'s songs. The usual sound is synthesised; when available you can also choose recorded instruments from the library.',
  unheard: 'Built-in music — nobody has listened to it yet', unheardShort: 'Nobody has listened to it yet',
  knownFromRecipe: 'Tempo known from the recipe', bpm: 'BPM',
  length: 'Length', bars: 'bars', fit: 'Length of the film', fitEmpty: 'The film is still empty', fitUnknown: 'The length of the film is not known', fitTooLong: 'The film is longer than 5 minutes, the longest built-in music can be',
  barsTooShort: 'This style is not made this short', barsTooLong: 'Longer than 5 minutes, the longest built-in music can be',
  seed: 'Version', seedDown: 'Previous version', seedUp: 'Next version',
  seconds: 's', megabytes: 'MB', sizeLabel: 'What will be added',
  play: 'Play', stop: 'Stop', loadingPreview: 'Preparing to play…', previewFirst: 'Playing the first 32 bars',
  add: 'Add to the timeline', addHint: 'Starts at the beginning of the film, on a sound track', adding: 'Making the music…', added: 'Added to the timeline', addedLibrary: 'Added to the library',
  sections: 'Shape of the piece', list: 'Built-in music styles',
  busy: 'Other music is being made right now. Try again in a moment', failed: 'Making the music failed', playFailed: 'Playback failed',
  section: { intro: 'Intro', build: 'Build', peak: 'Peak', break: 'Break', ending: 'Ending' },
};
export const MUSIC_STRINGS: Readonly<Record<'he' | 'en', MusicStrings>> = { he, en };
