/**
 * Search keys of the library catalogue (wave 7 library track). WORKER A builds the bodies; signatures are the lead's.
 * String operations only, so Node (the index) and Chromium (the editor's highlighting) agree.
 *
 * searchKey(text): NFKD; drop Hebrew points and cantillation (U+0591–U+05C7) and Latin combining marks; final letters to their
 *   base form (ך→כ, ם→מ, ן→נ, ף→פ, ץ→צ); lower case; every run of punctuation or space to one space; trimmed.
 * heQueryForms(token): the token, and — a HEURISTIC, labelled as one in the UI — when it has ≥ 4 letters and starts with one of
 *   ה ו ב ל מ ש כ, the token without that first letter. Deterministic, at most two forms.
 * LIBRARY_WORDS_HE: our own Hebrew words for common English tags (genre, mood, instrument, sound category); used at index time
 *   and for chip labels. Unreviewed Hebrew is listed in docs/OWNER_REVIEW.he.md by the worker.
 *
 * Worker A's additions (same file, same rules):
 * - Hebrew punctuation inside the points range (maqaf U+05BE, paseq U+05C0, sof pasuq U+05C3, nun hafukha U+05C6) separates words,
 *   it is not dropped; geresh and gershayim (׳ ״ and the ASCII ' " used for them) are dropped, so «צה"ל» is one word «צהל».
 * - heSkeleton(key): a key without the vowel letters ו and י after the first letter of each word, so pointed spelling (without
 *   vowel letters: «חֲנֻכִּיָּה» → «חנכיה») and full spelling («חנוכייה») meet at «חנכה». Also a HEURISTIC, indexed as a second
 *   column that ranks lower than the words themselves.
 */

const FINALS: Readonly<Record<string, string>> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
/** Hebrew punctuation that sits inside the range of the points: maqaf, paseq, sof pasuq, nun hafukha. They separate words. */
const HEBREW_SEPARATORS = /[־׀׃׆]/g;
/** Points and cantillation (U+0591–U+05C7, the separators above already replaced) and every combining mark after NFKD. */
const MARKS = /[֑-ׇ]|\p{M}/gu;
/** Geresh, gershayim and the ASCII quotes and apostrophes used in their place: dropped inside words. */
const QUOTES = /['"׳״‘’“”`´]/g;
const NOT_WORD = /[^\p{L}\p{N}]+/gu;

export function searchKey(text: string): string {
  return text
    .normalize('NFKD')
    .replace(HEBREW_SEPARATORS, ' ')
    .replace(MARKS, '')
    .replace(QUOTES, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c]!)
    .toLowerCase()
    .replace(NOT_WORD, ' ')
    .trim();
}

const PREFIX_LETTERS = new Set(['ה', 'ו', 'ב', 'ל', 'מ', 'ש', 'כ']);
const HEBREW_LETTER = /^[א-ת]$/;
export function heQueryForms(token: string): string[] {
  const letters = [...token];
  if (letters.length >= 4 && letters.every((c) => HEBREW_LETTER.test(c)) && PREFIX_LETTERS.has(letters[0]!)) return [token, letters.slice(1).join('')];
  return [token];
}

/** heSkeleton: each word of a search key without ו and י after its first letter (Hebrew words only; other words unchanged). */
export function heSkeleton(key: string): string {
  return key.split(' ').map((w) => (/[א-ת]/.test(w) ? w[0] + w.slice(1).replace(/[וי]/g, '') : w)).join(' ');
}

/** English tag (lower case) → Hebrew word. Our own words; unreviewed (listed for the owner's review by the worker's report). */
export const LIBRARY_WORDS_HE: Readonly<Record<string, string>> = {
  // kinds
  music: 'מוזיקה', sound: 'צליל', 'sound effect': 'אפקט קולי', loop: 'לופ', sticker: 'מדבקה', icon: 'סמל', emoji: 'אימוג׳י',
  illustration: 'איור', texture: 'טקסטורה', backdrop: 'רקע', video: 'וידאו',
  // genres
  classical: 'קלאסית', jazz: 'ג׳אז', rock: 'רוק', pop: 'פופ', electronic: 'אלקטרונית', ambient: 'אמביינט', folk: 'פולק',
  blues: 'בלוז', country: 'קאנטרי', 'hip hop': 'היפ הופ', funk: 'פאנק', soul: 'סול', reggae: 'רגאיי', latin: 'לטינית',
  world: 'מוזיקת עולם', cinematic: 'קולנועית', soundtrack: 'פסקול', orchestral: 'תזמורתית', piano: 'פסנתר', chamber: 'קאמרית',
  baroque: 'בארוק', romantic: 'רומנטית', opera: 'אופרה', march: 'מארש', waltz: 'ואלס', lullaby: 'שיר ערש', children: 'ילדים',
  holiday: 'חג', christmas: 'חג המולד', horror: 'אימה', comedy: 'קומדיה', action: 'אקשן', adventure: 'הרפתקה', drama: 'דרמה',
  disco: 'דיסקו', dance: 'ריקוד', techno: 'טכנו', house: 'האוס', 'drum and bass': 'דראם אנד בייס', dubstep: 'דאבסטפ',
  chiptune: 'צ׳יפטיון', 'video game': 'משחק מחשב', 'new age': 'ניו אייג׳', meditation: 'מדיטציה', religious: 'דתית',
  // moods
  calm: 'רגוע', relaxed: 'נינוח', peaceful: 'שליו', happy: 'שמח', joyful: 'עליז', cheerful: 'עליז', sad: 'עצוב', melancholy: 'נוגה',
  dark: 'אפל', mysterious: 'מסתורי', suspense: 'מתח', tense: 'מתוח', epic: 'אפי', heroic: 'הרואי', uplifting: 'מרומם',
  inspiring: 'מעורר השראה', energetic: 'אנרגטי', bright: 'בהיר', playful: 'שובב', funny: 'מצחיק', quirky: 'משונה', romance: 'רומנטי',
  love: 'אהבה', tender: 'רך', dreamy: 'חלומי', nostalgic: 'נוסטלגי', somber: 'קודר', angry: 'כועס', aggressive: 'תוקפני',
  driving: 'סוחף', bouncy: 'קופצני', grooving: 'גרוב', eerie: 'מצמרר', scary: 'מפחיד', serious: 'רציני', festive: 'חגיגי',
  // instruments
  guitar: 'גיטרה', 'acoustic guitar': 'גיטרה אקוסטית', 'electric guitar': 'גיטרה חשמלית', bass: 'בס', drums: 'תופים',
  percussion: 'כלי הקשה', violin: 'כינור', viola: 'ויולה', cello: 'צ׳לו', 'double bass': 'קונטרבס', strings: 'כלי מיתר',
  flute: 'חליל', clarinet: 'קלרינט', oboe: 'אבוב', bassoon: 'בסון', saxophone: 'סקסופון', trumpet: 'חצוצרה', trombone: 'טרומבון',
  horn: 'קרן', tuba: 'טובה', brass: 'כלי נשיפה ממתכת', woodwinds: 'כלי נשיפה מעץ', harp: 'נבל', organ: 'עוגב', synth: 'סינתיסייזר',
  synthesizer: 'סינתיסייזר', bells: 'פעמונים', choir: 'מקהלה', voice: 'קול', vocals: 'שירה', ukulele: 'יוקלילי', accordion: 'אקורדיון',
  harpsichord: 'צ׳מבלו', marimba: 'מרימבה', xylophone: 'קסילופון', banjo: 'בנג׳ו', mandolin: 'מנדולינה', orchestra: 'תזמורת',
  // sound categories
  whoosh: 'ווש', swoosh: 'ווש', click: 'קליק',applause: 'מחיאות כפיים', laugh: 'צחוק', crowd: 'קהל',
  nature: 'טבע', rain: 'גשם', thunder: 'רעם', wind: 'רוח', water: 'מים', sea: 'ים', waves: 'גלים', birds: 'ציפורים', bird: 'ציפור',
  dog: 'כלב', cat: 'חתול', animals: 'חיות', footsteps: 'צעדים', door: 'דלת', car: 'מכונית', engine: 'מנוע', train: 'רכבת',
  airplane: 'מטוס', city: 'עיר', street: 'רחוב', fire: 'אש', explosion: 'פיצוץ', impact: 'מכה', hit: 'חבטה', bell: 'פעמון',
  alarm: 'אזעקה', phone: 'טלפון', notification: 'התראה', beep: 'צפצוף', glass: 'זכוכית', paper: 'נייר', kitchen: 'מטבח',
  ambience: 'אווירה', transition: 'מעבר', riser: 'עולה', drone: 'רחש מתמשך', magic: 'קסם', sparkle: 'נצנוץ', cartoon: 'מצויר',
  // picture subjects (emoji groups and common icon words)
  people: 'אנשים', 'smileys & emotion': 'פרצופים ורגשות', 'animals & nature': 'חיות וטבע', 'food & drink': 'אוכל ושתייה',
  'travel & places': 'נסיעות ומקומות', activities: 'פעילויות', objects: 'חפצים', symbols: 'סמלים', flags: 'דגלים',
  arrow: 'חץ', star: 'כוכב', heart: 'לב', home: 'בית', calendar: 'לוח שנה', camera: 'מצלמה', 'music note': 'תו',
};
