/**
 * The command bar's lexicon (ADR-0027, plan §4.1 step 5, §4.4): data only. Every inflection is LISTED — imperative masculine,
 * feminine and plural, the future used as an imperative, and the infinitive — and nothing is derived from a stem. A request
 * is read word by word against these lists; a word that is not here (after the listed proclitics) is never guessed.
 *
 * Phrase syntax (one string per phrase, words separated by spaces):
 *   word        the word with no proclitic, or with ו and/or the article ה («והוסף», «הקליפ»)
 *   ב:word      the word after ב (or ש+ב, ו+ב); ל:, מ: likewise; after מ the article may stay («מהטלפון»)
 *   ל|ב:word    either proclitic
 *   *:word      any proclitics
 * The global filler words may stand between the words of a phrase («הוסף את הכותרת», "add a title").
 *
 * The catalogue names (effects, looks, transitions, text styles) are read from the catalogues themselves, so a new
 * catalogue row is understood by its own name. Items marked REVIEW in the comments are spelling or word choices the owner
 * has not confirmed (listed in the W1 report).
 */
import type { BarWorkspace, ExportDestinationId, IntentId } from '../commandBarContract.ts';
import { COLOR_LOOKS } from '../looks.ts';
import { EFFECTS, TRANSITIONS } from '../effects.ts';
import { TEXT_PRESETS } from '../textPresets.ts';
import { dict } from './dict.ts';

// ---------- verbs: every form listed ----------
/** Imperative m., f., pl., future as imperative (m., f., pl. where in use), infinitive; then English. */
export const VERBS = {
  cut: ['חתוך', 'חתכי', 'חתכו', 'תחתוך', 'תחתכי', 'תחתכו', 'לחתוך', 'גזור', 'גזרי', 'גזרו', 'תגזור', 'תגזרי', 'תגזרו', 'לגזור', 'cut'],
  split: ['פצל', 'פצלי', 'פצלו', 'תפצל', 'תפצלי', 'תפצלו', 'לפצל', 'split'],
  trim: ['קצץ', 'קצצי', 'קצצו', 'תקצץ', 'תקצצי', 'תקצצו', 'לקצץ', 'קצר', 'קצרי', 'קצרו', 'תקצר', 'תקצרי', 'תקצרו', 'לקצר', 'trim', 'shorten'],
  delete: ['מחק', 'מחקי', 'מחקו', 'תמחק', 'תמחקי', 'תמחקו', 'למחוק', 'delete'],
  remove: ['הסר', 'הסירי', 'הסירו', 'תסיר', 'תסירי', 'תסירו', 'להסיר', 'remove'],
  add: ['הוסף', 'הוסיפי', 'הוסיפו', 'תוסיף', 'תוסיפי', 'תוסיפו', 'להוסיף', 'שים', 'שימי', 'שימו', 'תשים', 'תשימי', 'תשימו', 'לשים', 'add', 'put', 'insert'],
  write: ['כתוב', 'כתבי', 'כתבו', 'תכתוב', 'תכתבי', 'תכתבו', 'לכתוב', 'write'],
  raise: ['הגבר', 'הגבירי', 'הגבירו', 'תגביר', 'תגבירי', 'תגבירו', 'להגביר', 'raise', 'increase', 'boost', 'turn up'],
  lower: ['הנמך', 'הנמיכי', 'הנמיכו', 'תנמיך', 'תנמיכי', 'תנמיכו', 'להנמיך', 'החלש', 'החלישי', 'החלישו', 'תחליש', 'תחלישי', 'תחלישו', 'להחליש', 'lower', 'reduce', 'decrease', 'turn down'],
  mute: ['השתק', 'השתיקי', 'השתיקו', 'תשתיק', 'תשתיקי', 'תשתיקו', 'להשתיק', 'mute'],
  cancel: ['בטל', 'בטלי', 'בטלו', 'תבטל', 'תבטלי', 'תבטלו', 'לבטל'],
  close: ['סגור', 'סגרי', 'סגרו', 'תסגור', 'תסגרי', 'תסגרו', 'לסגור', 'close'],
  freeze: ['הקפא', 'הקפיאי', 'הקפיאו', 'תקפיא', 'תקפיאי', 'תקפיאו', 'להקפיא', 'freeze'],
  slow: ['האט', 'האטי', 'האטו', 'תאט', 'תאטי', 'תאטו', 'להאט', 'slow down', 'slow'],
  hasten: ['האץ', 'האיצי', 'האיצו', 'תאיץ', 'תאיצי', 'תאיצו', 'להאיץ', 'speed up'],
  fade: ['עמעם', 'עמעמי', 'עמעמו', 'תעמעם', 'תעמעמי', 'תעמעמו', 'לעמעם', 'עמעום', 'fade'],
  finish: ['סיים', 'סיימי', 'סיימו', 'תסיים', 'תסיימי', 'תסיימו', 'לסיים', 'end', 'finish'],
  fit: ['התאם', 'התאימי', 'התאימו', 'תתאים', 'תתאימי', 'תתאימו', 'להתאים', 'fit'],
  apply: ['החל', 'החילי', 'החילו', 'תחיל', 'תחילי', 'תחילו', 'להחיל', 'apply'],
  change: ['שנה', 'שני', 'שנו', 'תשנה', 'תשני', 'תשנו', 'לשנות', 'החלף', 'החליפי', 'החליפו', 'תחליף', 'להחליף', 'change'],
  perform: ['בצע', 'בצעי', 'בצעו', 'תבצע', 'תבצעי', 'תבצעו', 'לבצע'],
  go: ['עבור', 'עברי', 'עברו', 'תעבור', 'תעברי', 'תעברו', 'לעבור', 'לך', 'לכי', 'לכו', 'תלך', 'תלכי', 'תלכו', 'ללכת', 'קפוץ', 'קפצי', 'קפצו', 'תקפוץ', 'תקפצי', 'תקפצו', 'לקפוץ', 'go', 'jump', 'switch', 'seek', 'move'],
  export: ['ייצא', 'ייצאי', 'ייצאו', 'תייצא', 'תייצאי', 'תייצאו', 'לייצא', 'יצא', 'ייצוא', 'export'],
  save: ['שמור', 'שמרי', 'שמרו', 'תשמור', 'תשמרי', 'תשמרו', 'לשמור', 'save'],
  send: ['שלח', 'שלחי', 'שלחו', 'תשלח', 'תשלחי', 'תשלחו', 'לשלוח', 'שתף', 'שתפי', 'שתפו', 'תשתף', 'לשתף', 'send', 'share'],
  play: ['נגן', 'נגני', 'נגנו', 'תנגן', 'תנגני', 'תנגנו', 'לנגן', 'play'],
  stop: ['עצור', 'עצרי', 'עצרו', 'תעצור', 'תעצרי', 'תעצרו', 'לעצור', 'השהה', 'השהי', 'השהו', 'תשהה', 'להשהות', 'pause', 'stop'],
  select: ['בחר', 'בחרי', 'בחרו', 'תבחר', 'תבחרי', 'תבחרו', 'לבחור', 'select'],
  enlarge: ['הגדל', 'הגדילי', 'הגדילו', 'תגדיל', 'תגדילי', 'תגדילו', 'להגדיל'],
  shrink: ['הקטן', 'הקטיני', 'הקטינו', 'תקטין', 'תקטיני', 'תקטינו', 'להקטין'],
  open: ['פתח', 'פתחי', 'פתחו', 'תפתח', 'תפתחי', 'תפתחו', 'לפתוח', 'הצג', 'הציגי', 'הציגו', 'תציג', 'להציג', 'open', 'show'],
  sync: ['סנכרן', 'סנכרני', 'סנכרנו', 'תסנכרן', 'תסנכרני', 'תסנכרנו', 'לסנכרן', 'sync', 'synchronize'],
  keep: ['השאר', 'השאירי', 'השאירו', 'תשאיר', 'תשאירי', 'תשאירו', 'להשאיר', 'keep', 'leave'],
  mark: ['סמן', 'סמני', 'סמנו', 'תסמן', 'תסמני', 'תסמנו', 'לסמן', 'mark'],
  clear: ['נקה', 'נקי', 'נקו', 'תנקה', 'תנקי', 'תנקו', 'לנקות', 'clear'],
  rename: ['rename'],
} as const;

/** Global filler words (plan §4.1): read, and they mean nothing. "to" is a filler too ("go to", "export to"). */
export const FILLERS = ['את', 'של', 'בבקשה', 'תודה', 'עכשיו', 'please', 'the', 'a', 'an', 'now', 'to', 'of', 'by', 'and'] as const;

const x = (verbs: readonly string[], objects: readonly string[]): string[] => verbs.flatMap((v) => objects.map((o) => `${v} ${o}`));

// ---------- nouns and target words ----------
export const CLIP_ONE = ['קליפ', 'קליפ הזה', 'נבחר', 'קליפ הנבחר', 'ל:קליפ', 'ב:קליפ', 'על קליפ', 'על קליפ הזה', 'on the clip', 'to the clip', 'clip', 'this clip', 'selected clip', 'selection', 'בחירה'];
export const CLIP_MANY = ['קליפים', 'כל הקליפים', 'קליפים הנבחרים', 'נבחרים', 'ל:קליפים', 'על קליפים', 'על כל הקליפים', 'ל:כל הקליפים', 'on all clips', 'clips', 'all clips', 'all the clips', 'selected clips'];
/** «המוזיקה»: the audio track whose trackRole is 'music'. REVIEW: שיר, פסקול. */
export const MUSIC = ['מוזיקה', 'מוסיקה', 'ל:מוזיקה', 'ל:מוסיקה', 'ב:מוזיקה', 'שיר', 'ל:שיר', 'פסקול', 'music', 'song', 'soundtrack'];
/** «הכותרת»: the selected text clip, or the only text clip (plan §4.4 target words). REVIEW: «הטקסט» is not listed (it would read «הוסף טקסט» apart). */
export const TITLE = ['כותרת', 'כותרת הזאת', 'כותרת הזו', 'ל:כותרת', 'על כותרת', 'על כותרת הזאת', 'title', 'this title', 'on the title', 'to the title', 'the title text'];
/** «הקול / הסאונד» alone: always ambiguous (clip, track or master). */
export const SOUND = ['קול', 'סאונד', 'שמע', 'עוצמה', 'ווליום', 'ל:קול', 'ל:סאונד', 'sound', 'audio', 'volume'];
export const HERE = ['כאן', 'פה', 'ב:סמן', 'עד כאן', 'עד פה', 'עד הסמן', 'מ:כאן', 'מ:פה', 'מ:סמן', 'here', 'at the playhead', 'at playhead', 'from here'];
export const AT_START = ['ב:התחלה', 'at the start', 'at the beginning'];
export const AT_END = ['ב:סוף', 'at the end'];
export const TO_START = ['ל:התחלה', 'start', 'beginning'];
export const TO_END = ['ל:סוף', 'end'];
export const DURATION_MARK = ['למשך', 'במשך', 'for'];
export const AT_MARK = ['at'];
export const AFTER_MARK = ['אחרי', 'בעוד', 'after', 'in'];
export const BEFORE_MARK = ['לפני', 'before'];
export const FORWARD = ['קדימה', 'forward', 'ahead'];
export const BACKWARD = ['אחורה', 'back', 'backward', 'backwards'];
export const FROM_HERE = ['מ:כאן', 'מ:פה', 'from here'];
export const DB_WORDS = ['דציבל', 'דציבלים', 'decibel', 'decibels'];
export const SPEED_FACTOR = ['פי', 'times'];
export const SPEED_DOUBLE = ['כפולה', 'כפול', 'double', 'פעמיים', 'twice'];
export const SPEED_HALF = ['חצי', 'half'];

// ---------- the intent families (plan §4.4 table) ----------
export interface FamilyWords { key: string; role: 'object' | 'target' | 'mode' | 'destination' | 'style' | 'filler'; phrases: readonly string[]; value?: unknown }
export type SlotName = 'here' | 'pos' | 'dur' | 'seek' | 'text' | 'db' | 'speed' | 'music' | 'clip' | 'sound' | 'edge' | 'fadeEdge' | 'workspace' | 'destination' | 'effect' | 'look' | 'transition' | 'textStyle' | 'language' | 'openTarget';
export interface FamilySpec {
  id: string;
  /** The intents the family's planner answers with; the first is the one named when it is incomplete or partial. */
  intents: readonly IntentId[];
  heads: readonly { phrases: readonly string[]; value?: string }[];
  words?: readonly FamilyWords[];
  slots?: readonly SlotName[];
  /** Slots whose match also counts as the family's head (a transition named «מעבר רך», «סרט משפחתי»). */
  headSlots?: readonly SlotName[];
}

const CLIP_WORDS = (role: 'object' | 'target' = 'object'): FamilyWords[] => [{ key: 'clip', role, phrases: CLIP_ONE, value: 'one' }, { key: 'clip', role, phrases: CLIP_MANY, value: 'many' }];
/** The clip words plus «הכותרת», for the families whose op takes a text clip (split, trim, delete, effect, look). */
const CLIP_OR_TITLE = (role: 'object' | 'target' = 'object'): FamilyWords[] => [...CLIP_WORDS(role), { key: 'clip', role, phrases: TITLE, value: 'title' }];

export const FAMILIES: readonly FamilySpec[] = [
  { id: 'split', intents: ['split_here', 'split_at'], heads: [{ phrases: [...VERBS.cut, ...VERBS.split] }], words: CLIP_OR_TITLE(), slots: ['here', 'pos'] },
  {
    id: 'trim', intents: ['trim_start_here', 'trim_end_here'], heads: [{ phrases: [...VERBS.cut, ...VERBS.trim] }],
    words: [{ key: 'edge', role: 'object', phrases: ['התחלה', 'start', 'beginning'], value: 'start' }, { key: 'edge', role: 'object', phrases: ['סוף', 'end'], value: 'end' }, ...CLIP_OR_TITLE('target')],
    slots: ['here'],
  },
  {
    id: 'delete', intents: ['delete_clip', 'delete_keep_gap'], heads: [{ phrases: [...VERBS.delete, ...VERBS.remove] }],
    words: [...CLIP_OR_TITLE(), { key: 'keepGap', role: 'mode', phrases: [...x(VERBS.keep, ['רווח', 'את הרווח', 'gap', 'the gap']), 'בלי לסגור רווח', 'בלי לסגור את הרווח', 'עם רווח', 'without closing the gap'], value: true }],
  },
  {
    id: 'add_title', intents: ['add_title'], heads: [{ phrases: [...x(VERBS.add, ['כותרת', 'טקסט', 'title', 'text', 'a title']), ...VERBS.write] }],
    slots: ['text', 'pos', 'dur', 'here', 'textStyle'],
  },
  {
    id: 'gain_change', intents: ['gain_change'], heads: [{ phrases: VERBS.raise, value: 'up' }, { phrases: VERBS.lower, value: 'down' }, { phrases: ['turn'], value: 'turn' }],
    words: [{ key: 'dir', role: 'mode', phrases: ['up', 'louder'], value: 'up' }, { key: 'dir', role: 'mode', phrases: ['down', 'quieter'], value: 'down' }],
    slots: ['db', 'music', 'clip', 'sound'],
  },
  { id: 'mute', intents: ['mute'], heads: [{ phrases: VERBS.mute }], slots: ['music', 'sound'] },
  { id: 'unmute', intents: ['unmute'], heads: [{ phrases: [...x(VERBS.cancel, ['השתקה', 'את ההשתקה']), 'unmute', 'החזר קול', 'החזירי קול', 'החזירו קול'] }], slots: ['music', 'sound'] },
  {
    id: 'transitions', intents: ['transitions_all', 'transition_here'], heads: [{ phrases: x(VERBS.add, ['מעבר', 'מעברים', 'transition', 'transitions', 'a transition']) }, { phrases: ['מעבר', 'מעברים', 'transitions'], value: 'noun' }],
    words: [{ key: 'scope', role: 'target', phrases: ['בין כל הקליפים', 'בין הקליפים', 'לכל הקליפים', 'בכל החיתוכים', 'בין כל החיתוכים', 'between all clips', 'between all the clips', 'between clips', 'between the clips', 'to all clips', 'at every cut'], value: 'all' }, ...CLIP_WORDS('target')],
    slots: ['transition', 'here'], headSlots: ['transition'],
  },
  { id: 'add_marker', intents: ['add_marker'], heads: [{ phrases: [...x(VERBS.add, ['סמן', 'marker', 'a marker']), ...VERBS.mark] }], slots: ['text', 'here', 'pos'] },
  { id: 'close_gaps', intents: ['close_gaps'], heads: [{ phrases: [...x(VERBS.close, ['רווחים', 'את הרווחים', 'gaps']), ...x(VERBS.delete, ['רווחים', 'gaps']), ...x(VERBS.remove, ['רווחים', 'gaps'])] }] },
  {
    id: 'freeze', intents: ['freeze'], heads: [{ phrases: [...x(VERBS.freeze, ['פריים', 'תמונה', 'frame', 'picture']), ...VERBS.freeze, 'freeze frame', 'פריים קפוא', 'a freeze frame'] }],
    words: CLIP_WORDS('target'), slots: ['dur', 'here', 'pos'],
  },
  {
    id: 'speed', intents: ['speed'], heads: [{ phrases: VERBS.slow, value: 'slower' }, { phrases: VERBS.hasten, value: 'faster' }, { phrases: ['מהירות', '*:מהירות', 'speed'], value: 'set' }],
    words: CLIP_WORDS('target'), slots: ['speed'],
  },
  {
    id: 'fades', intents: ['fades'], heads: [{ phrases: VERBS.fade }, { phrases: ['fade in'], value: 'in' }, { phrases: ['fade out'], value: 'out' }],
    words: [...CLIP_WORDS('target')], slots: ['fadeEdge', 'dur', 'music'],
  },
  {
    id: 'fit_music', intents: ['fit_music'], heads: [{ phrases: [...x([...VERBS.finish, ...VERBS.fit], ['מוזיקה', 'מוסיקה', 'music', 'the music'])] }],
    words: [{ key: 'with', role: 'filler', phrases: ['עם התמונה', 'עם הסרט', 'עם הסוף', 'ל:סרט', 'ל:תמונה', 'with the picture', 'with the video', 'picture', 'video'] }],
  },
  { id: 'effect', intents: ['effect'], heads: [{ phrases: x([...VERBS.add, ...VERBS.apply], ['אפקט', 'effect', 'the effect', 'an effect']) }], words: CLIP_OR_TITLE('target'), slots: ['effect'] },
  { id: 'look', intents: ['look'], heads: [{ phrases: [...x([...VERBS.apply, ...VERBS.add], ['מראה', 'look', 'the look', 'a look'])] }], words: CLIP_OR_TITLE('target'), slots: ['look'] },
  {
    id: 'rename_project', intents: ['rename_project'],
    heads: [{ phrases: [...x(VERBS.change, ['שם הפרויקט', 'project name', 'the project name', 'the name of the project']), 'rename project', 'rename the project', 'קרא לפרויקט', 'קראי לפרויקט', 'קראו לפרויקט'] }],
    slots: ['text'],
  },
  { id: 'remove_empty_tracks', intents: ['remove_empty_tracks'], heads: [{ phrases: x([...VERBS.remove, ...VERBS.delete], ['רצועות ריקות', 'את הרצועות הריקות', 'empty tracks', 'the empty tracks']) }] },
  { id: 'undo', intents: ['undo'], heads: [{ phrases: [...VERBS.cancel, 'ביטול', 'undo', ...x(VERBS.cancel, ['פעולה', 'פעולה אחרונה', 'שינוי אחרון', 'שינוי'])] }] },
  { id: 'redo', intents: ['redo'], heads: [{ phrases: [...x(VERBS.perform, ['שוב', 'מחדש']), 'redo', 'ביצוע מחדש', 'ביצוע חוזר'] }] },
  {
    id: 'workspace', intents: ['workspace'], heads: [{ phrases: [...VERBS.go, ...VERBS.open] }, { phrases: ['*:מצב', 'mode'], value: 'noun' }],
    words: [{ key: 'modeWord', role: 'filler', phrases: ['*:מצב', 'mode'] }], slots: ['workspace'],
  },
  { id: 'export_to', intents: ['export_to'], heads: [{ phrases: [...VERBS.export, ...VERBS.save, ...VERBS.send] }], slots: ['destination'] },
  { id: 'seek', intents: ['seek'], heads: [{ phrases: VERBS.go }], slots: ['seek'] },
  { id: 'play', intents: ['play'], heads: [{ phrases: VERBS.play }] },
  { id: 'pause', intents: ['pause'], heads: [{ phrases: VERBS.stop }] },
  { id: 'select_all', intents: ['select_all'], heads: [{ phrases: [...x(VERBS.select, ['הכול', 'הכל', 'את הכול', 'את הכל', 'כל הקליפים', 'all', 'everything', 'all clips']), 'select all'] }] },
  { id: 'deselect', intents: ['deselect'], heads: [{ phrases: [...x([...VERBS.cancel, ...VERBS.clear], ['בחירה', 'את הבחירה', 'selection']), 'deselect', 'unselect', 'select none'] }] },
  {
    id: 'zoom_in', intents: ['zoom_in'], heads: [{ phrases: [...VERBS.enlarge, 'זום פנימה', 'התקרב', 'zoom in'] }],
    words: [{ key: 'view', role: 'object', phrases: ['תצוגה', 'ציר הזמן', 'ציר זמן', 'timeline', 'view'] }],
  },
  {
    id: 'zoom_out', intents: ['zoom_out'], heads: [{ phrases: [...VERBS.shrink, 'זום החוצה', 'התרחק', 'zoom out'] }],
    words: [{ key: 'view', role: 'object', phrases: ['תצוגה', 'ציר הזמן', 'ציר זמן', 'timeline', 'view'] }],
  },
  {
    id: 'language', intents: ['language'], heads: [{ phrases: VERBS.go }, { phrases: [...x(VERBS.change, ['שפה', 'את השפה', 'language', 'the language']), 'שפת ממשק', 'שפה', 'language'], value: 'toggle' }],
    slots: ['language'],
  },
  { id: 'open', intents: ['open'], heads: [{ phrases: VERBS.open }], slots: ['openTarget'], headSlots: ['openTarget'] },
  {
    id: 'sync_beat', intents: ['sync_beat'], heads: [{ phrases: [...VERBS.sync, 'על הקצב', 'לפי הקצב', 'on the beat', 'to the beat'] }],
    words: [{ key: 'beat', role: 'object', phrases: ['ל:קצב', 'עם הקצב', 'לפי הקצב', 'על הקצב', 'עם המוזיקה', 'ל:מוזיקה', 'beat', 'the beat', 'to the beat', 'with the music', 'to the music'] }],
  },
];

// ---------- slot vocabularies ----------
/** Workspace names (apps/web chrome.strings.ts modes) plus synonyms. REVIEW: במה, שורטס, קול as mode names. */
export const WORKSPACE_WORDS: Readonly<Record<BarWorkspace, readonly string[]>> = {
  pro: ['*:עריכה', 'pro', 'edit', 'editing'],
  color: ['*:מראה', '*:צבע', 'color', 'colour', 'look'],
  sound: ['*:סאונד', '*:קול', '*:שמע', 'sound', 'audio'],
  captions: ['*:כתוביות', 'captions', 'subtitles'],
  deliver: ['*:מסירה', 'deliver', 'delivery'],
  shorts: ['*:קטעים קצרים', '*:שורטס', 'shorts'],
  perform: ['*:הופעה', '*:במה', 'perform', 'performance', 'stage'],
};
/** Export destinations. Doubled-vav spellings listed (plan §4.1). REVIEW: וואצאפ, רילז, אינסטגרם → reels, קובץ → computer. */
export const DESTINATION_WORDS: Readonly<Record<ExportDestinationId, readonly string[]>> = {
  whatsapp: ['*:וואטסאפ', '*:ווטסאפ', '*:ואטסאפ', '*:ווצאפ', '*:וואצאפ', '*:ווטסאפ', 'whatsapp'],
  reels: ['*:רילס', '*:ריילס', '*:רילז', '*:אינסטגרם', 'reels', 'instagram'],
  youtube: ['*:יוטיוב', '*:יו טיוב', 'youtube'],
  computer: ['*:מחשב', 'computer', 'my computer', 'file'],
};
export const LANGUAGE_WORDS: Readonly<Record<'he' | 'en', readonly string[]>> = { he: ['*:עברית', 'hebrew'], en: ['*:אנגלית', 'english'] };
/** What «פתח …» opens (core BAR_OPEN_COMMANDS). REVIEW: העלאה מהנייד, סרט המשפחה. */
export const OPEN_WORDS: Readonly<Record<string, readonly string[]>> = dict({
  'view.openTemplates': ['תבניות', 'את התבניות', 'templates'],
  'view.openFamilyFilm': ['סרט משפחתי', 'סרט המשפחה', 'family film'],
  'file.phoneDrop': ['העלאה מהטלפון', 'העלאה מהנייד', 'העלה מהטלפון', 'מ:טלפון', 'מ:נייד', 'phone upload', 'upload from phone', 'from phone'],
  'life.people': ['אנשים', 'people'],
});
/** Words for a fade's edge. */
export const FADE_EDGE: Readonly<Record<'in' | 'out', readonly string[]>> = {
  in: ['ב:התחלה', 'פנימה', 'כניסה', 'in', 'at the start'],
  out: ['ב:סוף', 'החוצה', 'יציאה', 'out', 'at the end'],
};
/** A text style is named after «בסגנון» / "in style" / "style". */
export const STYLE_MARK = ['ב:סגנון', 'סגנון', 'in style', 'style', 'in the style'];

/**
 * Look synonyms not in the catalogue (REVIEW, all of them): the plan's example «החל מראה חם» names no catalogue look, so
 * «חם» is listed here as 'warm-sun' and «קר» as 'cool-morning'. The owner decides whether they stay.
 */
export const LOOK_SYNONYMS: Readonly<Record<string, string>> = dict({ 'חם': 'warm-sun', 'חמים': 'warm-sun', 'קר': 'cool-morning', warm: 'warm-sun', cool: 'cool-morning' });

export interface CatalogName { id: string; phrase: string }
/** Every name of a catalogue, Hebrew and English. */
const names = (rows: readonly { id: string; name: { he: string; en: string } }[]): CatalogName[] => rows.flatMap((r) => [{ id: r.id, phrase: r.name.he }, { id: r.id, phrase: r.name.en }]);
let catalogs: { effect: CatalogName[]; look: CatalogName[]; transition: CatalogName[]; textStyle: CatalogName[] } | null = null;
/** The catalogue names, built on first use (the catalogues are other modules' data). */
export function catalogNames() {
  catalogs ??= {
    effect: names(EFFECTS.filter((e) => !e.id.startsWith('time.'))),
    look: [...names(COLOR_LOOKS), ...Object.entries(LOOK_SYNONYMS).map(([phrase, id]) => ({ id, phrase }))],
    transition: names(TRANSITIONS),
    textStyle: names(TEXT_PRESETS),
  };
  return catalogs;
}

/**
 * Example phrasings of every intent, Hebrew and English (plan §4.4 table; §8 coverage). The intents test reads each one with
 * the fixture context and checks its kind against the golden file.
 */
export const INTENT_EXAMPLES: Readonly<Record<IntentId, { he: readonly string[]; en: readonly string[] }>> = {
  split_here: { he: ['חתוך כאן', 'פצל כאן', 'פצלי את הקליפ פה'], en: ['split here', 'cut here'] },
  split_at: { he: ['פצל בשנייה 4', 'חתוך ב־0:04'], en: ['split at 4s'] },
  trim_start_here: { he: ['חתוך את ההתחלה עד כאן'], en: ['trim the start to here'] },
  trim_end_here: { he: ['קצץ את הסוף מכאן'], en: ['trim the end from here'] },
  delete_clip: { he: ['מחק את הקליפ', 'מחקי את הקליפים'], en: ['delete the clip'] },
  delete_keep_gap: { he: ['מחק והשאר רווח'], en: ['delete and keep the gap'] },
  add_title: { he: ['הוסף כותרת "יום הולדת 5" בשנייה 3', 'כתוב "מזל טוב" כאן למשך 4 שניות'], en: ['add title "Happy birthday" at 3s'] },
  gain_change: { he: ['הגבר את המוזיקה ב־3 דציבל', 'הנמך את הקליפ ב־6 דצ״ב'], en: ['turn the music up 3 dB'] },
  mute: { he: ['השתק את המוזיקה'], en: ['mute the music'] },
  unmute: { he: ['בטל השתקה למוזיקה'], en: ['unmute the music'] },
  transitions_all: { he: ['הוסף מעבר בין כל הקליפים', 'מעבר רך בין כל הקליפים'], en: ['add transitions between all clips'] },
  transition_here: { he: ['הוסף מעבר כאן'], en: ['add a transition here'] },
  add_marker: { he: ['הוסף סמן', 'סמן כאן "עוגה"'], en: ['add a marker'] },
  close_gaps: { he: ['סגור רווחים'], en: ['close gaps'] },
  freeze: { he: ['הקפא את הפריים לשנייה וחצי'], en: ['freeze frame for 2 seconds'] },
  speed: { he: ['האט פי 2', 'מהירות כפולה', 'מהירות 0.5'], en: ['speed 0.5'] },
  fades: { he: ['עמעום בהתחלה של חצי שנייה'], en: ['fade out 1 second'] },
  fit_music: { he: ['סיים את המוזיקה עם התמונה'], en: ['fit the music'] },
  effect: { he: ['הוסף אפקט שחור לבן'], en: ['add effect black & white'] },
  look: { he: ['החל מראה חם'], en: ['apply look vintage'] },
  rename_project: { he: ['שנה את שם הפרויקט ל"גן רימון"'], en: ['rename the project to "Rimon kindergarten"'] },
  remove_empty_tracks: { he: ['הסר רצועות ריקות'], en: ['remove empty tracks'] },
  undo: { he: ['בטל', 'ביטול'], en: ['undo'] },
  redo: { he: ['בצע שוב', 'בצע מחדש'], en: ['redo'] },
  workspace: { he: ['עבור למצב הופעה', 'מצב סאונד'], en: ['switch to perform mode'] },
  export_to: { he: ['ייצא לוואטסאפ', 'שמור למחשב', 'ייצוא לרילס'], en: ['export to whatsapp'] },
  seek: { he: ['עבור לשנייה 10', 'קפוץ להתחלה', 'לך לסוף'], en: ['go to the end'] },
  play: { he: ['נגן'], en: ['play'] },
  pause: { he: ['עצור'], en: ['pause'] },
  select_all: { he: ['בחר הכול'], en: ['select all'] },
  deselect: { he: ['בטל בחירה'], en: ['deselect'] },
  zoom_in: { he: ['הגדל'], en: ['zoom in'] },
  zoom_out: { he: ['הקטן'], en: ['zoom out'] },
  language: { he: ['עבור לאנגלית'], en: ['switch to hebrew'] },
  open: { he: ['פתח תבניות', 'סרט משפחתי', 'העלאה מהטלפון'], en: ['open templates'] },
  sync_beat: { he: ['סנכרן לקצב', 'על הקצב'], en: ['sync to the beat'] },
};

/** A short name of each intent, for a choice between two readings of the same words. */
export const INTENT_NAMES: Readonly<Record<IntentId, { he: string; en: string }>> = {
  split_here: { he: 'פיצול בסמן', en: 'Split at the playhead' }, split_at: { he: 'פיצול בזמן', en: 'Split at a time' },
  trim_start_here: { he: 'קיצור ההתחלה עד הסמן', en: 'Trim the start to the playhead' }, trim_end_here: { he: 'קיצור הסוף מהסמן', en: 'Trim the end from the playhead' },
  delete_clip: { he: 'מחיקה', en: 'Delete' }, delete_keep_gap: { he: 'מחיקה עם רווח', en: 'Delete, keep the gap' }, add_title: { he: 'הוספת כותרת', en: 'Add a title' },
  gain_change: { he: 'שינוי עוצמה', en: 'Change the volume' }, mute: { he: 'השתקה', en: 'Mute' }, unmute: { he: 'ביטול השתקה', en: 'Unmute' },
  transitions_all: { he: 'מעברים בין כל הקליפים', en: 'Transitions between all clips' }, transition_here: { he: 'מעבר בקליפ', en: 'Transition on the clip' },
  add_marker: { he: 'הוספת סמן', en: 'Add a marker' }, close_gaps: { he: 'סגירת רווחים', en: 'Close gaps' }, freeze: { he: 'הקפאת פריים', en: 'Freeze frame' },
  speed: { he: 'שינוי מהירות', en: 'Change the speed' }, fades: { he: 'עמעום', en: 'Fade' }, fit_music: { he: 'סיום המוזיקה עם התמונה', en: 'Fit the music' },
  effect: { he: 'הוספת אפקט', en: 'Add an effect' }, look: { he: 'החלת מראה', en: 'Apply a look' }, rename_project: { he: 'שינוי שם הפרויקט', en: 'Rename the project' },
  remove_empty_tracks: { he: 'הסרת רצועות ריקות', en: 'Remove empty tracks' }, undo: { he: 'ביטול', en: 'Undo' }, redo: { he: 'ביצוע מחדש', en: 'Redo' },
  workspace: { he: 'מעבר למצב עבודה', en: 'Switch the workspace' }, export_to: { he: 'פתיחת חלון הייצוא', en: 'Open the export sheet' }, seek: { he: 'מעבר לזמן', en: 'Go to a time' },
  play: { he: 'ניגון', en: 'Play' }, pause: { he: 'עצירה', en: 'Pause' }, select_all: { he: 'בחירת הכול', en: 'Select all' }, deselect: { he: 'ביטול הבחירה', en: 'Deselect' },
  zoom_in: { he: 'הגדלת התצוגה', en: 'Zoom in' }, zoom_out: { he: 'הקטנת התצוגה', en: 'Zoom out' }, language: { he: 'החלפת שפה', en: 'Change the language' },
  open: { he: 'פתיחה', en: 'Open' }, sync_beat: { he: 'סנכרון לקצב', en: 'Sync to the beat' },
};
