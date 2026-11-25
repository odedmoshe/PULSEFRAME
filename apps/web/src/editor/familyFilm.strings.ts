/**
 * The family film's own strings (ADR-0026), Hebrew first and right to left; the shared fixed lines are i18n `film.*` and
 * `moments.*` (packages/i18n/src/familyFilm.ts). Every core FILM_REASON_CODES, FILM_EXCLUSION_CODES and FILM_WARNING_CODES value
 * has Hebrew and English wording below (familyFilm.strings.test.ts keeps it so). No string says «ציון», «הכי טוב», best, score,
 * quality or viral (core FILM_FORBIDDEN_WORDS, FILM_FORBIDDEN_WORDS_HE), and none calls the film «בינה מלאכותית» / AI except the
 * fixed disclaimer that says it is NOT (a heuristic made of measurements and rules). Numbers are formatted here as plain digits
 * and drawn in <bdi class="num"> by the components (ds `isolate`). Every choice the film makes is explained in plain words and
 * labelled heuristic.
 */
import type { FilmExclusion, FilmReason, FilmWarning } from '@pulseframe/core';

export interface FamilyFilmStrings {
  // ----- the dialog -----
  title: string; close: string; back: string; next: string; apply: string; applying: string; stepsLabel: string;
  steps: { what: string; length: string; plan: string };
  // step 1
  fromEvent(name: string): string; fromSelection: string; noName: string; clipsLabel: string; countLine(clips: number, seconds: number): string;
  selectAll: string; selectNone: string; emptySource: string; kindVideo: string; kindImage: string; unavailableFile: string;
  /** «יותר מ־60 קבצים: אפשר לבחור עד 60» */
  tooMany(max: number): string;
  nothingChosen: string;
  // step 2
  lengthLabel: string; lengthOption(seconds: number): string;
  musicLabel: string; musicNone: string; musicNoSound: string; musicBeats(count: number, bpm: number | null): string; musicNoBeats: string; measureBeats: string; measuringBeats: string; musicNote: string;
  soundLabel: string; sound: { under: string; lead: string; mute: string }; soundNote: { under: string; lead: string; mute: string };
  /** the 'under' option without music: «הקול המקורי בעוצמה מלאה» */
  underWithoutMusic: string;
  orderLabel: string; order: { capture: string; given: string; arc: string }; orderNote: { capture: string; given: string; arc: string };
  titleLabel: string; titleHint: string; titlePlaceholder(eventName: string | null): string;
  // step 3
  planning: string; planNote: string; notPlanned: string; retry: string; undoUnavailable: string;
  /** «מודד רגעים 12/31 · היוריסטיקה, בלי בינה מלאכותית» */
  measuring(done: number, total: number): string;
  measureState: string; measureCancel: string; measureCanceled: string;
  rowsLabel: string; rowFacts(capture: string | null, span: string | null, seconds: number): string; noCapture: string;
  spanBeats(count: number): string; spanBars(count: number): string; stillRow: string;
  swapWindow: string; swapClip: string; remove: string; include: string; noOtherWindow: string; noOtherClip: string; chooseClip: string; thumbNote: string;
  /** «לא נכנסו (7)» */
  excludedCount(n: number): string;
  excludedNone: string; emptyPlan: string; blockedTitle: string; warningsLabel: string; facesNote: string; onBeat: string;
  /** «28 קליפים · 58.4 שנ׳» */
  footer(clips: number, seconds: number): string;
  // after apply
  made: string; undo: string; otherMoments: string; otherLength: string; lengthMenu(seconds: number): string; whyClips: string; restoreRemoved: string; noOtherMoments: string; working: string; whyList: string; whyListItem(name: string, reasons: string): string; undoFailed: string; notInProject: string;
  // the inspector section
  whyHeading: string; edited: string; editedShort: string; notMeasured: string; measure: string; measuringOne: string; noReason: string; swapDone: string;
  // the entry
  entry: { 'event-card': string; 'start-hub': string; palette: string }; entryHint: string; entryHintEmpty: string;
  reason(r: FilmReason): string;
  exclusion(e: FilmExclusion): string;
  warning(w: FilmWarning): string;
}

/** One decimal, no trailing zero: 4 → «4», 5.25 → «5.3» (round half up), -0 → «0». */
export const num1 = (x: number): string => { const r = Math.round(x * 10) / 10; return String(Object.is(r, -0) ? 0 : r); };
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const range = (r: FilmReason): string => {
  const a = r.fromSecond, b = r.toSecond;
  return a !== undefined && b !== undefined ? `${num1(a)}–${num1(b)}` : a !== undefined ? num1(a) : '';
};
const sign = (v: number) => (v >= 0 ? '+' : '−') + num1(Math.abs(v));
/** What a film regeneration left out because it was deleted by hand (core familyFilm.ts, warning removed_by_hand details.items). */
type LeftOut = { kind: 'file' | 'window' | 'title' | 'closing' | 'music'; name?: string; windowIndex?: number; fromSecond?: number; toSecond?: number };
const leftOut = (v: unknown): LeftOut[] => (Array.isArray(v) ? v.filter((x): x is LeftOut => !!x && typeof x === 'object' && typeof (x as LeftOut).kind === 'string') : []);
/** A file name isolated inside the sentence (it may be written left to right). */
const fname = (x: LeftOut) => `\u2068${x.name ?? ''}\u2069`;
const leftOutHe = (x: LeftOut) => x.kind === 'file' ? `«${fname(x)}» (כל הקובץ)` : x.kind === 'window' ? `«${fname(x)}» (${n(x.fromSecond) !== null && n(x.toSecond) !== null ? `הרגע ב־${num1(x.fromSecond!)}–${num1(x.toSecond!)} שנ׳` : `רגע ${(x.windowIndex ?? 0) + 1}`}; רגעים אחרים שלו יכולים להישאר)` : x.kind === 'title' ? 'כותרת הפתיחה' : x.kind === 'closing' ? 'כרטיס הסיום' : x.name ? `המוזיקה «${fname(x)}»` : 'המוזיקה';
const leftOutEn = (x: LeftOut) => x.kind === 'file' ? `“${fname(x)}” (the whole file)` : x.kind === 'window' ? `“${fname(x)}” (${n(x.fromSecond) !== null && n(x.toSecond) !== null ? `its moment at ${num1(x.fromSecond!)}–${num1(x.toSecond!)} s` : `moment ${(x.windowIndex ?? 0) + 1}`}; its other moments may stay)` : x.kind === 'title' ? 'the opening title' : x.kind === 'closing' ? 'the closing card' : x.name ? `the music “${fname(x)}”` : 'the music';

const he: FamilyFilmStrings = {
  title: 'סרט משפחתי בלחיצה', close: 'סגירה', back: 'הקודם', next: 'הבא', apply: 'יצירת הסרט', applying: 'יוצר את הסרט…', stepsLabel: 'שלבי היצירה',
  steps: { what: 'מה בסרט', length: 'אורך ומוזיקה', plan: 'התוכנית' },
  fromEvent: (name) => `האירוע: ${name}`, fromSelection: 'הקבצים שבחרתם', noName: 'ללא שם', clipsLabel: 'הקבצים של הסרט',
  countLine: (c, s) => `${c} קבצים · אורך הסרטונים ${fmtDur(s)}`,
  selectAll: 'בחירת הכול', selectNone: 'ניקוי הבחירה', emptySource: 'אין כאן תמונות או סרטונים שאפשר לעשות מהם סרט.', kindVideo: 'סרטון', kindImage: 'תמונה', unavailableFile: 'הקובץ אינו בפרויקט',
  tooMany: (max) => `יותר מ־${max} קבצים: אפשר לבחור עד ${max}`,
  nothingChosen: 'בחרו לפחות קובץ אחד',
  lengthLabel: 'אורך הסרט', lengthOption: (s) => `${s} שניות`,
  musicLabel: 'מוזיקה', musicNone: 'בלי מוזיקה', musicNoSound: 'אין עדיין קובצי קול בפרויקט. אפשר לייבא מוזיקה בספרייה, או ליצור סרט בלי מוזיקה.',
  musicBeats: (count, bpm) => `${count} פעימות${bpm !== null ? ` · ${Math.round(bpm)} BPM` : ''}`, musicNoBeats: 'הקצב עוד לא נמדד', measureBeats: 'מדידת קצב', measuringBeats: 'מודד קצב…',
  musicNote: 'עם מוזיקה החיתוכים נופלים על הפעימות והתיבות שנמדדו בה. בלי מוזיקה הם נופלים בקצב קבוע.',
  soundLabel: 'הקול המקורי של הקליפים',
  sound: { under: 'מתחת למוזיקה', lead: 'הקולות מובילים', mute: 'בלי קול מקורי' },
  soundNote: { under: 'הקול המקורי נשמע חלש מתחת למוזיקה.', lead: 'המוזיקה מורדת ב־9 dB בזמן שיש קול בקליפ, ולכן היא עולה מעל תמונות וקליפים שקטים.', mute: 'רק המוזיקה נשמעת.' },
  underWithoutMusic: 'הקול המקורי בעוצמה מלאה',
  orderLabel: 'סדר הקליפים', order: { capture: 'לפי זמן הצילום', given: 'לפי סדר הבחירה', arc: 'קשת אנרגיה' },
  orderNote: { capture: 'לפי מועד הצילום שנקרא מהקובץ. קובץ בלי זמן צילום יושב בסוף.', given: 'כמו בסדר שבו הקבצים מופיעים כאן.', arc: 'רגוע בהתחלה, התוסס ביותר אחרי שני שלישים מהסרט. הדירוג לפי תנועה וקול שנמדדו, לא לפי תוכן.' },
  titleLabel: 'כותרת פתיחה', titleHint: 'השאירו ריק לכותרת אוטומטית עם שם האירוע והתאריך. טקסט שתקלידו יוצג בדיוק כפי שהוא.',
  titlePlaceholder: (name) => (name ? `ברירת מחדל: ${name}` : 'ברירת מחדל: כותרת לפי תאריך הצילום'),
  notPlanned: 'אין עדיין תוכנית. אפשר לנסות שוב.', retry: 'ניסיון חוזר', undoUnavailable: 'אי אפשר לבטל את הסרט מכאן: יצירתו כבר רחוקה ברשימת העריכות.',
  planning: 'מתכנן את הסרט…', planNote: 'התוכנית היא טיוטה שאפשר לשנות כאן, ואחרי היצירה אפשר לערוך אותה כמו כל עריכה.',
  measuring: (d, t) => `מודד רגעים ${d}/${t} · היוריסטיקה, בלי בינה מלאכותית`,
  measureState: 'בעבודה', measureCancel: 'ביטול המדידה', measureCanceled: 'המדידה בוטלה. קליפים שלא נמדדו נכנסים מאמצע הקליפ.',
  rowsLabel: 'הקליפים בסרט, לפי סדר הסרט',
  rowFacts: (capture, span, seconds) => [capture ?? 'אין זמן צילום', span, `${num1(seconds)} שנ׳`].filter(Boolean).join(' · '),
  noCapture: 'אין זמן צילום',
  spanBeats: (c) => (c === 1 ? 'פעימה אחת' : `${c} פעימות`), spanBars: (c) => (c === 1 ? 'תיבה אחת' : `${c} תיבות`), stillRow: 'תמונה',
  swapWindow: 'רגע אחר', swapClip: 'קליפ אחר', remove: 'הוצאה מהסרט', include: 'הכנסה', noOtherWindow: 'לא נמדד בקובץ הזה רגע נוסף', noOtherClip: 'אין קליפים אחרים להחלפה', chooseClip: 'בחירת קליפ במקום הזה',
  thumbNote: 'התמונה הממוזערת היא הקרובה ביותר לרגע שנבחר, ויכולה להיות מעט שונה ממנו.',
  excludedCount: (c) => `לא נכנסו (${c})`, excludedNone: 'כל הקבצים שבחרתם נכנסו לסרט.', emptyPlan: 'אין בתוכנית אף קליפ.',
  blockedTitle: 'אי אפשר ליצור את הסרט כך', warningsLabel: 'שימו לב',
  facesNote: 'פנים לא נבדקות: אין מודל פנים מאושר', onBeat: 'כל החיתוכים על הפעימה',
  footer: (c, s) => `${c === 1 ? 'קליפ אחד' : `${c} קליפים`} · ${num1(s)} שנ׳`,
  made: 'הסרט נוצר', undo: 'ביטול', otherMoments: 'רגעים אחרים', otherLength: 'אורך אחר', lengthMenu: (s) => `${s} שניות`, whyClips: 'למה הקליפים האלה?', restoreRemoved: 'החזרת החלקים שנמחקו',
  noOtherMoments: 'אין בקבצים רגעים אחרים שנמדדו', working: 'מעדכן את הסרט…', whyList: 'הקליפים והסיבה לכל אחד', whyListItem: (name, reasons) => `${name}: ${reasons}`,
  undoFailed: 'אי אפשר לבטל את הסרט, כי נערכו בו פריטים מאז שנוצר', notInProject: 'הסרט כבר אינו בציר הזמן',
  whyHeading: 'למה הקליפ הזה', editedShort: 'נערך ידנית', edited: 'נערך ידנית: הקליפ שונה ממה שהתוכנית יצרה, והסיבה נבדקת לפי מה שמנגן בו עכשיו', notMeasured: 'הקובץ עוד לא נמדד', measure: 'מדידת רגעים', measuringOne: 'מודד רגעים…', noReason: 'הקליפ הזה לא מנגן אף רגע שנמדד', swapDone: 'הקליפ הוחלף',
  entry: { 'event-card': 'סרט מהאירוע', 'start-hub': 'סרט משפחתי בלחיצה', palette: 'סרט משפחתי בלחיצה' }, entryHint: 'טיוטה ראשונה שאפשר לערוך', entryHintEmpty: 'קודם בוחרים תמונות וסרטונים, ואז נפתח הסרט',
  reason(r) {
    switch (r.code) {
      case 'inner_motion': return `תנועה בתוך התמונה בשניות ${range(r)}`;
      case 'measured_moment': return `רגע שנמדד בשניות ${range(r)}`;
      case 'loud_sound': return `קול חזק מהרגיל בקליפ (${sign(r.value ?? 0)} dB)`;
      case 'sound_burst': return `פרץ קול בשנייה ${num1(r.fromSecond ?? 0)}`;
      case 'sharp': return `חדות גבוהה מהרגיל בקובץ (פי ${num1(r.value ?? 1)})`;
      case 'active_throughout': return `תנועה לאורך כל הקליפ (${num1(r.value ?? 0)}‰)`;
      case 'second_moment': return 'רגע שני מאותו קובץ';
      case 'chosen_by_you': return 'בחרתם את הרגע הזה';
      case 'past_clean_stretch': return 'הקטע יוצא מהקטע הנקי שנמדד';
      case 'not_measured': return 'לא נמדד';
      case 'no_clear_moment': return 'לא נמצא בקליפ רגע בולט';
      case 'default_middle': return 'נבחר אמצע הקליפ';
      case 'whole_clip': return 'כל הקליפ';
      case 'still': return 'תמונה';
    }
  },
  exclusion(e) {
    const s = n(e.details.seconds);
    switch (e.code) {
      case 'no_room': return 'אין מקום בסרט באורך הזה';
      case 'too_short': return s !== null ? `הקליפ קצר מדי (${num1(s)} שנ׳)` : 'הקליפ קצר מדי';
      case 'excluded_by_you': return 'הוצא על ידכם';
      case 'no_picture': return 'אין תמונה בקובץ';
      case 'kept_by_hand': return 'נערך ידנית ונשאר במקומו';
      case 'removed_by_hand': return 'נמחק ידנית ולא נוסף שוב';
    }
  },
  warning(w) {
    const s = n(w.details.seconds);
    switch (w.code) {
      case 'shorter_than_target': return s !== null ? `הסרט קצר מהאורך שביקשתם (${num1(s)} שנ׳)` : 'הסרט קצר מהאורך שביקשתם';
      case 'longer_than_target': return s !== null ? `הסרט ארוך מהאורך שביקשתם (${num1(s)} שנ׳), כי קליפים שנשארו במקומם או שהוכנסו ידנית תופסים מקום` : 'הסרט ארוך מהאורך שביקשתם, כי קליפים שנשארו במקומם או שהוכנסו ידנית תופסים מקום';
      case 'music_short': return 'המוזיקה קצרה מהסרט';
      case 'low_beat_confidence': return 'מדידת הקצב לא בטוחה במיוחד, ולכן חיתוכים עשויים לא ליפול בדיוק על הפעימה';
      case 'not_measured': return 'חלק מהקליפים לא נמדדו, ובהם נבחר אמצע הקליפ';
      case 'no_capture_time': return 'לחלק מהקבצים אין זמן צילום, ולכן סדרם בסרט עלול להיות שונה מסדר האירועים';
      case 'mixed_orientation': return 'יש יחד קליפים לרוחב וקליפים לאורך';
      case 'cuts_merged': return 'חלק מהחיתוכים אוחדו כדי שלא יהיו חיתוכים צפופים מדי (בטיחות להבהובים)';
      case 'kept_by_hand': return 'קליפים שערכתם ידנית נשארו במקומם';
      case 'cut_off_grid_next_to_kept': return 'ליד קליפ שנערך ידנית החיתוך אינו נופל על הפעימה';
      case 'moved_back': return 'קליפים שרק זזו ממקומם לא נשארו במקום שאליו זזו: הסרט סודר מחדש יחד איתם';
      case 'title_resolved_static': return 'הכותרת קבועה, ולא תתעדכן לפי תאריך הצילום';
      case 'kept_music_not_followable': return 'המוזיקה שכבר בפרויקט נשארה, והחיתוכים אינם עוקבים אחרי הפעימות שלה';
      case 'lead_music_rises': return 'במצב «הקולות מובילים» המוזיקה מורדת ב־9 dB בזמן שיש קול בקליפ, ולכן היא עולה מעל תמונות וקליפים שקטים';
      case 'removed_by_hand': { const items = leftOut(w.details.items); return `${items.length ? `לא נוספו שוב כי מחקתם אותם ידנית: ${items.map(leftOutHe).join(', ')}` : 'חלקים שמחקתם ידנית לא נוספו שוב'}. אפשר להחזיר אותם ב«החזרת החלקים שנמחקו»`; }
      case 'music_removed': return w.details.cutOn === 'steady'
        ? 'המוזיקה נמחקה ידנית וביקשתם אורך או סדר אחר: הקליפים נחתכים על קצב קבוע, בלי מוזיקה. הקול של הקליפים לא מונמך ושום דבר לא מונמך מתחתיו'
        : 'המוזיקה נמחקה ידנית: הקליפים נשארים חתוכים על התיבות שלה, במקום שבו הם, בלי מוזיקה מתחתם. הקול של הקליפים לא מונמך ושום דבר לא מונמך מתחתיו. אורך או סדר אחר יחתכו אותם על קצב קבוע';
      case 'pictures_missing': return s !== null ? `ב־${num1(s)} שנ׳ של הסרט אין תמונה: הקליפים שנבחרו לא ממלאים את המקום עד הקליפים שנשארו במקומם` : 'בחלק מהסרט אין תמונה: הקליפים שנבחרו לא ממלאים את המקום עד הקליפים שנשארו במקומם';
    }
  },
};

const en: FamilyFilmStrings = {
  title: 'Family film in one click', close: 'Close', back: 'Back', next: 'Next', apply: 'Make the film', applying: 'Making the film…', stepsLabel: 'Steps',
  steps: { what: 'What is in it', length: 'Length and music', plan: 'The plan' },
  fromEvent: (name) => `Event: ${name}`, fromSelection: 'The files you chose', noName: 'Untitled', clipsLabel: 'Files of the film',
  countLine: (c, s) => `${c} files · videos run ${fmtDur(s)}`,
  selectAll: 'Select all', selectNone: 'Clear selection', emptySource: 'There are no pictures or videos here to make a film from.', kindVideo: 'Video', kindImage: 'Picture', unavailableFile: 'The file is not in the project',
  tooMany: (max) => `More than ${max} files: you can choose up to ${max}`,
  nothingChosen: 'Choose at least one file',
  lengthLabel: 'Length of the film', lengthOption: (s) => `${s} seconds`,
  musicLabel: 'Music', musicNone: 'No music', musicNoSound: 'The project has no sound files yet. Import music in the library, or make the film without music.',
  musicBeats: (count, bpm) => `${count} beats${bpm !== null ? ` · ${Math.round(bpm)} BPM` : ''}`, musicNoBeats: 'The beat is not measured yet', measureBeats: 'Measure the beat', measuringBeats: 'Measuring the beat…',
  musicNote: 'With music the cuts fall on its measured beats and bars. Without music they fall at a steady tempo.',
  soundLabel: 'The clips\' own sound',
  sound: { under: 'Under the music', lead: 'Voices lead', mute: 'No original sound' },
  soundNote: { under: 'The clips\' own sound plays quietly under the music.', lead: 'The music is lowered 9 dB while a clip has sound, so it rises over pictures and silent clips.', mute: 'Only the music plays.' },
  underWithoutMusic: 'Original sound at full level',
  orderLabel: 'Order of the clips', order: { capture: 'By capture time', given: 'In the order chosen', arc: 'Energy arc' },
  orderNote: { capture: 'By the time each file was captured, read from the file. A file with no capture time goes last.', given: 'In the order the files are listed here.', arc: 'Calm at first, the liveliest at two thirds of the film, ranked by measured motion and sound, not by content.' },
  titleLabel: 'Opening title', titleHint: 'Leave empty for an automatic title with the event name and date. Text you type is shown exactly as typed.',
  titlePlaceholder: (name) => (name ? `Default: ${name}` : 'Default: a title from the capture date'),
  notPlanned: 'There is no plan yet. You can try again.', retry: 'Try again', undoUnavailable: 'The film cannot be undone from here: its creation is too far back in the edit list.',
  planning: 'Planning the film…', planNote: 'The plan is a draft you can change here; once made, edit it like any other edit.',
  measuring: (d, t) => `Measuring moments ${d}/${t} · heuristic, no AI`,
  measureState: 'Working', measureCancel: 'Cancel measuring', measureCanceled: 'Measuring was canceled. Files not measured enter from the middle of the clip.',
  rowsLabel: 'The clips of the film, in film order',
  rowFacts: (capture, span, seconds) => [capture ?? 'No capture time', span, `${num1(seconds)} s`].filter(Boolean).join(' · '),
  noCapture: 'No capture time',
  spanBeats: (c) => (c === 1 ? '1 beat' : `${c} beats`), spanBars: (c) => (c === 1 ? '1 bar' : `${c} bars`), stillRow: 'Picture',
  swapWindow: 'Another moment', swapClip: 'Another clip', remove: 'Take out of the film', include: 'Put in', noOtherWindow: 'No other moment was measured in this file', noOtherClip: 'There are no other clips to swap in', chooseClip: 'Choose a clip for this place',
  thumbNote: 'The thumbnail is the nearest one to the chosen moment and can differ slightly from it.',
  excludedCount: (c) => `Left out (${c})`, excludedNone: 'Every file you chose is in the film.', emptyPlan: 'The plan has no clips.',
  blockedTitle: 'The film cannot be made like this', warningsLabel: 'Note',
  facesNote: 'Faces are not checked: no face model is approved', onBeat: 'Every cut is on the beat',
  footer: (c, s) => `${c === 1 ? '1 clip' : `${c} clips`} · ${num1(s)} s`,
  made: 'The film was made', undo: 'Undo', otherMoments: 'Other moments', otherLength: 'Another length', lengthMenu: (s) => `${s} seconds`, whyClips: 'Why these clips?', restoreRemoved: 'Restore deleted parts',
  noOtherMoments: 'The files have no other measured moments', working: 'Updating the film…', whyList: 'The clips and the reason for each', whyListItem: (name, reasons) => `${name}: ${reasons}`,
  undoFailed: 'The film cannot be undone because items of it were edited since it was made', notInProject: 'The film is no longer on the timeline',
  whyHeading: 'Why this clip', editedShort: 'Edited by hand', edited: 'Edited by hand: the clip differs from what the plan made, and the reason is checked against what it plays now', notMeasured: 'The file is not measured yet', measure: 'Measure moments', measuringOne: 'Measuring moments…', noReason: 'This clip plays none of the measured moments', swapDone: 'The clip was replaced',
  entry: { 'event-card': 'Film from this event', 'start-hub': 'Family film in one click', palette: 'Family film in one click' }, entryHint: 'A first draft you can edit', entryHintEmpty: 'Choose pictures and videos first; the film opens next',
  reason(r) {
    switch (r.code) {
      case 'inner_motion': return `Movement inside the picture at ${range(r)} s`;
      case 'measured_moment': return `A measured moment at ${range(r)} s`;
      case 'loud_sound': return `Louder than usual in the file (${sign(r.value ?? 0)} dB)`;
      case 'sound_burst': return `A burst of sound at ${num1(r.fromSecond ?? 0)} s`;
      case 'sharp': return `Sharper than usual in the file (${num1(r.value ?? 1)}x)`;
      case 'active_throughout': return `Movement throughout the clip (${num1(r.value ?? 0)}‰)`;
      case 'second_moment': return 'A second moment of the same file';
      case 'chosen_by_you': return 'You chose this moment';
      case 'past_clean_stretch': return 'The stretch runs outside the clean stretch that was measured';
      case 'not_measured': return 'Not measured';
      case 'no_clear_moment': return 'No moment stood out in the clip';
      case 'default_middle': return 'The middle of the clip was taken';
      case 'whole_clip': return 'The whole clip';
      case 'still': return 'A picture';
    }
  },
  exclusion(e) {
    const s = n(e.details.seconds);
    switch (e.code) {
      case 'no_room': return 'There is no room in a film of this length';
      case 'too_short': return s !== null ? `The clip is too short (${num1(s)} s)` : 'The clip is too short';
      case 'excluded_by_you': return 'Taken out by you';
      case 'no_picture': return 'The file has no picture';
      case 'kept_by_hand': return 'Edited by hand and kept where it is';
      case 'removed_by_hand': return 'Deleted by hand and not added again';
    }
  },
  warning(w) {
    const s = n(w.details.seconds);
    switch (w.code) {
      case 'shorter_than_target': return s !== null ? `The film is shorter than the length you asked for (${num1(s)} s)` : 'The film is shorter than the length you asked for';
      case 'longer_than_target': return s !== null ? `The film is longer than the length you asked for (${num1(s)} s), because clips kept in place or put in by hand take room` : 'The film is longer than the length you asked for, because clips kept in place or put in by hand take room';
      case 'music_short': return 'The music is shorter than the film';
      case 'low_beat_confidence': return 'The beat measurement is not very sure, so some cuts may not land exactly on the beat';
      case 'not_measured': return 'Some clips were not measured, and the middle of the clip was taken for them';
      case 'no_capture_time': return 'Some files have no capture time, so their place in the film may differ from the order of events';
      case 'mixed_orientation': return 'The film mixes wide and tall clips';
      case 'cuts_merged': return 'Some cuts were merged so none are too close together (flash safety)';
      case 'kept_by_hand': return 'Clips you edited by hand were kept where they are';
      case 'cut_off_grid_next_to_kept': return 'Next to a clip edited by hand the cut does not land on the beat';
      case 'moved_back': return 'Clips that had only been moved were not kept where they were moved to: the film was laid out again with them';
      case 'title_resolved_static': return 'The title is fixed and will not update from the capture date';
      case 'kept_music_not_followable': return 'The music already in the project was kept, and the cuts do not follow its beats';
      case 'lead_music_rises': return 'In "Voices lead" the music is lowered 9 dB while a clip has sound, so it rises over pictures and silent clips';
      case 'removed_by_hand': { const items = leftOut(w.details.items); return `${items.length ? `Not added again because you deleted them by hand: ${items.map(leftOutEn).join(', ')}` : 'Parts you deleted by hand were not added again'}. "Restore deleted parts" brings them back`; }
      case 'music_removed': return w.details.cutOn === 'steady'
        ? 'The music was deleted by hand and you asked for another length or order: the clips are cut on a steady beat, with no music. The clips\' own sound is not lowered and nothing is ducked'
        : 'The music was deleted by hand: the clips stay cut on its bars, where they are, with no music under them. The clips\' own sound is not lowered and nothing is ducked. Another length or order cuts them on a steady beat instead';
      case 'pictures_missing': return s !== null ? `${num1(s)} s of the film show no picture: the chosen clips do not fill the room up to the clips kept by hand` : 'Part of the film shows no picture: the chosen clips do not fill the room up to the clips kept by hand';
    }
  },
};

/** m:ss for a number of seconds (rounded to whole seconds, only for display). */
function fmtDur(seconds: number): string {
  const t = Math.max(0, Math.round(seconds));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export function familyFilmStrings(lang: 'he' | 'en'): FamilyFilmStrings {
  return lang === 'en' ? en : he;
}
