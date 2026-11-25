/**
 * The musicfit surfaces' strings (wave 7 musicfit track). Builder C owns this file. The words that the lead's pre-pass fixed live in
 * packages/i18n/src/musicFit.ts (`musicfit.*`, Hebrew first); `musicFitT` reads them for the interface language and fills the
 * {placeholders}. The sentences the surfaces need beyond those (the notes of a plan by code, the swap dialog, the join row, the
 * impact result, the accessible names) are `EXTRA` below, same two languages, same {placeholders}; they are listed in the builder's
 * report for the owner to review and can move into i18n at integration. Numbers, frames and times are drawn in <bdi dir="ltr"> by
 * the components; the timeline stays left-to-right, so "earlier" is always left.
 * No string says that an ending or a join sounds good: nobody has listened (core MUSICFIT_FORBIDDEN_WORDS; musicFit.logic.test.ts).
 */
import { dictionaries, type Lang } from '@pulseframe/i18n';

export const EXTRA = {
  he: {
    'planning': 'מתכננים את ההתאמה…', 'replan': 'תכנון מחדש', 'close': 'סגירה',
    'makeBuiltin': 'תיווצר מוזיקה מובנית באורך המדויק של הסרט ({seconds} שניות)',
    'makeFitted': 'ייעשה עותק מקוצר של השיר ({seconds} שניות): יוסרו תיבות שלמות מהאמצע',
    'makeNone': 'לא ייעשה קובץ חדש; הקובץ הקיים משמש כמו שהוא',
    'wanted': 'אורך הסרט: {seconds} שניות',
    'joinRow': 'חיבור {n} מתוך {m}', 'joinRemoves': 'יוסר הקטע מ־{from} עד {to} שניות בשיר המקורי', 'joinOff': 'הקובץ יצא {sign}{seconds} שניות מהאורך המבוקש',
    'playingJoin': 'מנגן את החיבור… לחיצה נוספת עוצרת', 'joinPlayFailed': 'אי אפשר היה להשמיע את החיבור',
    'nextOtherJoin': 'אין חיבור נוסף להציע', 'otherEndingHint': 'לעבור בין הסיום שנבנה לסיום בדעיכה בסוף הסרט',
    'heardNeedsPlay': 'לפני הסימון: השמיעו את החיבור',
    'heardSaved': 'סומן: החיבור נשמע. אפשר לבטל בחזרה אחת',
    'heardOwnerOnly': 'סימון «נשמע» נעשה רק מחלון בעל הפרויקט',
    'unheardBuiltin': 'מוזיקה מובנית — עוד לא הושמעה לאף אחד',
    'chipHeard': 'החיבור נשמע ({at})',
    'rests': 'על מה זה מתבסס', 'basisLang': 'הפירוט באנגלית',
    'blockingLead': 'אי אפשר לבצע כך', 'warningsLead': 'כדאי לדעת',
    'applying': 'מבצעים…', 'applied': 'המוזיקה הותאמה לסרט. ביטול אחד מחזיר הכול', 'appliedNothing': 'לא היה מה לשנות',
    'staleReload': 'הפרויקט השתנה מאז התכנון; מתכננים שוב',
    'notMusic': 'הקובץ הזה אינו מוזיקה שאפשר להתאים לאורך',
    'ownerOnlyTitle': 'כל אחד יכול להשמיע; רק בעל הפרויקט יכול לסמן',
    // the notes of a plan by code (the server's English is the fallback)
    'note.join_weak': 'החיבור חלש לפי המדידה: לא נמצא מקום שבו התיבות משני הצדדים דומות (דמיון {similarity}). אף אחד עוד לא שמע אותו. אפשר לנסות «חיבור אחר» או לבחור סיום בדעיכה',
    'note.tempo_unsteady': 'הקצב של השיר משתנה בכ־{ms} אלפיות שנייה בין פעימות, ולכן חיתוכים שאחרי החיבור לא בהכרח על הפעימות',
    'note.music_keys_dropped': '{count} נקודות עוצמה של קליפ המוזיקה לא יחולו על המוזיקה החדשה',
    'note.cuts_faster': 'השנייה העמוסה ביותר תכלול {after} חיתוכים במקום {before}',
    'note.kept_cuts_close': 'יש זוגות חיתוכים שערכתם ביד וקרובים זה לזה; התוכנית לא משנה אותם',
    'note.music_short': 'המוזיקה קצרה מהסרט ונגמרת לפני הסוף. אפשר לבחור «התאמה לאורך»',
    'note.impacts_off_beat': '{n} רגעים מסומנים לא יהיו על פריים של פעימה אחרי השינוי; «ליישר שוב» יחזיר אותם',
    'note.composed_again': 'המוזיקה נבנית מחדש באותו סגנון לאורך הזה; אלה לא אותם צלילים',
    'note.flash_gap': 'חיתוך שהתוכנית יוצרת היה קרוב מדי לחיתוך אחר (כלל ההבהובים). בחרו מוזיקה איטית יותר',
    'note.template_blocked': 'קטעים שנערכו ביד לא נחתכים מחדש. בטלו את העריכה ביד או מחקו את הקליפ ונסו שוב',
    // «מוזיקה אחרת»
    'swapPick': 'בחרו מוזיקה כדי לראות מה ישתנה', 'swapBuiltin': 'מוזיקה מובנית', 'swapSongs': 'שירים בפרויקט עם פעימות מדודות',
    'swapNoSongs': 'אין בפרויקט שירים עם פעימות מדודות. אפשר לייבא שיר ולמדוד את הפעימות שלו', 'swapBpm': '{bpm} פעימות לדקה',
    'swapKnownBeats': 'הקצב ידוע מהמתכון', 'swapMeasuredBeats': 'פעימות מדודות', 'swapCurrent': 'המוזיקה שיש עכשיו',
    'swapCuts': 'חיתוכים: {before} ← {after}', 'swapWhatNothing': 'הפריטים הקיימים לא ישתנו', 'swapRecut': 'לחתוך מחדש לפי הפעימות של המוזיקה החדשה',
    'swapListLabel': 'מוזיקה לבחירה', 'swapForClip': 'מחליפים את המוזיקה של הקליפ', 'swapForFilm': 'מחליפים את המוזיקה של הסרט', 'swapForTemplate': 'מחליפים את המוזיקה של התבנית',
    'swapDone': 'המוזיקה הוחלפה. ביטול אחד מחזיר הכול', 'swapPicked': 'נבחר',
    // the impact controls
    'impactTitle': 'הרגע שחשוב בקליפ', 'impactNone': 'עוד לא סומן רגע בקליפ הזה. הזיזו את הסמן לרגע שחשוב (קפיצה, נפילה, מחיאה) וסמנו אותו',
    'impactMarkedAt': 'רגע מסומן בשנייה {seconds} של הקובץ', 'impactNeedsPlayhead': 'הזיזו את הסמן לתוך הקליפ כדי לסמן', 'impactNoHold': 'בתמונה, בפריים קפוא או בכותרת אין רגע לסמן',
    'impactBeforeAfter': 'לפני: {before}. אחרי: {after}', 'impactMoved': 'הקליפ הוזז ב־{frames} פריימים; מקומו וארכו בציר לא השתנו',
    'impactNoMusic': 'אין מתחת לרגע הזה מוזיקה עם פעימות מדודות', 'impactRealigned': 'הרגע על הפריים של הפעימה',
    'impactPreview': 'לחיצה תזיז את הקליפ ב־{frames} פריימים ({ms} אלפיות שנייה) כך שהרגע ייפול על {target}',
    'impactTargetBeat': 'הפריים של הפעימה', 'impactTargetBar': 'הפריים של תחילת התיבה', 'impactKeysHint': 'מקשים: B לפעימה, Alt+B לתחילת תיבה',
    'impactOffsetLabel': 'המרחק מהפעימה', 'impactResidual': 'שארית',
    // accessible names on the timeline
    'tickMarked': 'רגע מסומן', 'tickJoin': 'מקום החיבור של השיר המקוצר', 'clipMarked': 'רגע מסומן',
    // commands
    'cmdMarkNeedsClip': 'בחרו קליפ וידאו או קול והציבו את הסמן בתוכו', 'cmdMarked': 'הרגע סומן', 'cmdMoved': 'הרגע הועבר ב־{frames} פריימים',
    'cmdNotMarked': 'סמנו קודם את הרגע', 'cmdUndoLabel': 'סימון רגע',
  },
  en: {
    'planning': 'Planning the fit…', 'replan': 'Plan again', 'close': 'Close',
    'makeBuiltin': 'Built-in music of exactly the film\'s length will be made ({seconds} s)',
    'makeFitted': 'A shortened copy of the song will be made ({seconds} s): whole bars are removed from the middle',
    'makeNone': 'No new file; the file already there is used as it is',
    'wanted': 'The film is {seconds} s long',
    'joinRow': 'Join {n} of {m}', 'joinRemoves': 'The stretch from {from} to {to} s of the original song is removed', 'joinOff': 'The file comes out {sign}{seconds} s from the wanted length',
    'playingJoin': 'Playing the join… press again to stop', 'joinPlayFailed': 'The join could not be played',
    'nextOtherJoin': 'There is no other join to offer', 'otherEndingHint': 'Switch between the made ending and a fade at the film\'s end',
    'heardNeedsPlay': 'Before marking: play the join',
    'heardSaved': 'Marked: the join was heard. One undo reverses it',
    'heardOwnerOnly': 'Marking «heard» is done only from the project owner\'s window',
    'unheardBuiltin': 'Built-in music — nobody has listened to it yet',
    'chipHeard': 'The join was heard ({at})',
    'rests': 'What this rests on', 'basisLang': 'Details are in English',
    'blockingLead': 'This cannot be done as it is', 'warningsLead': 'Worth knowing',
    'applying': 'Applying…', 'applied': 'The music was fitted to the film. One undo reverses everything', 'appliedNothing': 'There was nothing to change',
    'staleReload': 'The project changed since the plan; planning again',
    'notMusic': 'This file is not music that can be fitted to a length',
    'ownerOnlyTitle': 'Anyone can play it; only the project owner can mark it',
    'note.join_weak': 'The join is weak by measurement: no place was found where the bars on both sides are alike (similarity {similarity}). Nobody has heard it. Try «Another join» or choose a fade ending',
    'note.tempo_unsteady': 'The song\'s tempo varies by about {ms} ms between beats, so cuts after the join are not necessarily on its beats',
    'note.music_keys_dropped': '{count} volume keys of the music clip will not apply to the new music',
    'note.cuts_faster': 'The busiest second will have {after} cuts instead of {before}',
    'note.kept_cuts_close': 'Some pairs of cuts you made by hand are close together; the plan does not change them',
    'note.music_short': 'The music is shorter than the film and ends before the end. You can choose «Fit to length»',
    'note.impacts_off_beat': '{n} marked moments will not be on a beat\'s frame after this change; «Align again» brings them back',
    'note.composed_again': 'The music is composed again in the same style for this length; these are not the same notes',
    'note.flash_gap': 'A cut this plan makes would be too close to another cut (the flash rule). Choose slower music',
    'note.template_blocked': 'Parts edited by hand are not cut again. Undo the hand edit or delete the clip and try again',
    'swapPick': 'Choose music to see what changes', 'swapBuiltin': 'Built-in music', 'swapSongs': 'Songs in the project with measured beats',
    'swapNoSongs': 'The project has no songs with measured beats. You can import a song and measure its beats', 'swapBpm': '{bpm} beats a minute',
    'swapKnownBeats': 'The tempo is known from the recipe', 'swapMeasuredBeats': 'Measured beats', 'swapCurrent': 'The music now',
    'swapCuts': 'Cuts: {before} → {after}', 'swapWhatNothing': 'The existing items will not change', 'swapRecut': 'Cut again on the new music\'s beats',
    'swapListLabel': 'Music to choose from', 'swapForClip': 'Replacing the music of the clip', 'swapForFilm': 'Replacing the music of the film', 'swapForTemplate': 'Replacing the music of the template',
    'swapDone': 'The music was replaced. One undo reverses everything', 'swapPicked': 'Chosen',
    'impactTitle': 'The moment that matters in the clip', 'impactNone': 'No moment is marked in this clip yet. Move the playhead to the moment that matters (a jump, a fall, a clap) and mark it',
    'impactMarkedAt': 'A moment is marked at {seconds} s of the file', 'impactNeedsPlayhead': 'Move the playhead into the clip to mark', 'impactNoHold': 'A still, a freeze frame or a title has no moment to mark',
    'impactBeforeAfter': 'Before: {before}. After: {after}', 'impactMoved': 'The clip was slipped by {frames} frames; its place and length on the timeline did not change',
    'impactNoMusic': 'No music with measured beats plays under this moment', 'impactRealigned': 'The moment is on the beat\'s frame',
    'impactPreview': 'Pressing slips the clip by {frames} frames ({ms} ms) so the moment falls on {target}',
    'impactTargetBeat': 'the beat\'s frame', 'impactTargetBar': 'the bar start\'s frame', 'impactKeysHint': 'Keys: B to the beat, Alt+B to the bar start',
    'impactOffsetLabel': 'Distance from the beat', 'impactResidual': 'residual',
    'tickMarked': 'Marked moment', 'tickJoin': 'Where the shortened song joins', 'clipMarked': 'marked moment',
    'cmdMarkNeedsClip': 'Select a video or sound clip and put the playhead inside it', 'cmdMarked': 'The moment was marked', 'cmdMoved': 'The moment was moved by {frames} frames',
    'cmdNotMarked': 'Mark the moment first', 'cmdUndoLabel': 'Mark a moment',
  },
} as const;
export type ExtraKey = keyof (typeof EXTRA)['he'];

export type MusicFitT = (key: string, vars?: Record<string, string | number>) => string;
/** The interface strings: `musicfit.*` of the shared dictionary, then the builder's own sentences (EXTRA). A missing key shows the key, never nothing. */
export function musicFitT(lang: Lang): MusicFitT {
  const d = dictionaries[lang] as Record<string, string>;
  const extra = EXTRA[lang] as Record<string, string>;
  return (key, vars = {}) => (d[`musicfit.${key}`] ?? extra[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
