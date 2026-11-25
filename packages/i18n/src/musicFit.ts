/**
 * Strings of «מוזיקה שמתאימה לסרט» — music that ends with the film (wave 7 musicfit track, .artifacts/wave7/musicfit-decisions.md).
 * Spread into `he` and `en` (index.ts); Hebrew first, the English dictionary covers the same keys. No string praises a join or an
 * ending, and «מסונכרן» is never used (screen and speaker delays are not calibrated): core MUSICFIT_FORBIDDEN_WORDS, checked by
 * packages/evals/src/musicfit-wording.test.ts.
 * Namespaces: `op.*`, `cmd.*`, `error.code.*`, `musicfit.*` (the interface; builder C reads them through musicfit/musicFit.strings.ts).
 * Also here: HE_MUSICFIT, the Hebrew of every refusal of the four operations (core MUSICFIT_REFUSALS) and of the routes
 * (apps/server/src/musicfit/routes.ts MUSICFIT_SERVER_REFUSALS), each with the next step.
 */
export const MUSICFIT_HE = {
  'op.set_clip_impact': 'סימון הרגע', 'op.sync_impact': 'הרגע אל הפעימה', 'op.add_fitted_music': 'הוספת שיר מקוצר', 'op.mark_join_heard': 'סימון שהחיבור נשמע',
  'cmd.markImpact': 'סימון הרגע בקליפ', 'cmd.impactToBeat': 'הרגע אל הפעימה', 'cmd.impactToBar': 'הרגע אל תחילת התיבה',
  'error.code.musicfit_not_built': 'התאמת מוזיקה לסרט עוד לא נבנתה בגרסה הזו', 'error.code.needs_bars': 'אין למוזיקה תחילות תיבה מדודות', 'error.code.no_join': 'לא נמצא מקום חיבור',
  'error.code.fit_stale': 'הפעימות של השיר השתנו מאז התכנון', 'error.code.fit_unstable': 'התכנון השני יצא שונה', 'error.code.flash_gap': 'חיתוך קרוב מדי לחיתוך אחר',
  'error.code.too_short': 'קצר מדי', 'error.code.too_long': 'ארוך מדי', 'error.code.not_from_start': 'הקליפ אינו מתחיל בתחילת הקובץ',
  'musicfit.fit': 'התאמה לאורך', 'musicfit.swap': 'מוזיקה אחרת', 'musicfit.recut': 'חיתוך מחדש לפי המוזיקה', 'musicfit.alsoLength': 'להתאים גם את האורך',
  'musicfit.apply': 'בצעו', 'musicfit.cancel': 'ביטול', 'musicfit.working': 'מתכננים…', 'musicfit.notBuilt': 'התאמת מוזיקה לסרט עוד לא נבנתה בגרסה הזו',
  'musicfit.endsWithFilm': 'המוזיקה מסתיימת עם הסרט; האקורד האחרון מתחיל {seconds} שניות לפני הסוף',
  'musicfit.endsEarly': 'מסתיימת {seconds} שניות לפני הסוף, בסיום שלה', 'musicfit.endsCut': 'הסיום נחתך ב־{seconds} שניות ומונמך', 'musicfit.otherEnding': 'סיום אחר',
  'musicfit.composedAgain': 'המוזיקה נבנית מחדש באותו סגנון לאורך הזה; אלה לא אותם צלילים',
  'musicfit.playJoin': 'השמעת החיבור', 'musicfit.otherJoin': 'חיבור אחר', 'musicfit.heard': 'שמעתי — החיבור בסדר', 'musicfit.unheard': 'חיבור אוטומטי — עוד לא הושמע',
  'musicfit.heardBy': 'החיבור נשמע ({at})', 'musicfit.measured': 'נמדד, לא נשמע', 'musicfit.joinAt': 'החיבור ב־{seconds} שניות',
  'musicfit.what': 'מה ישתנה', 'musicfit.cutsBefore': 'חיתוכים לפני', 'musicfit.cutsAfter': 'חיתוכים אחרי', 'musicfit.minGap': 'הרווח הקצר ביותר: {frames} פריימים',
  'musicfit.thinned': 'חיתוכים שהושמטו בגלל כלל ההבהובים: {n}', 'musicfit.kept': 'קליפים שנשמרו כפי שערכתם: {n}', 'musicfit.movedBack': 'קליפים שסודרו מחדש אחרי מחיקה: {n}',
  'musicfit.blocked': 'קטעים שנערכו ביד ולא ניתן לחתוך מחדש: {names}', 'musicfit.offBeat': 'רגעים מסומנים שיזוזו מהפעימה: {n}', 'musicfit.keysDropped': 'נקודות עוצמה שיימחקו: {n}',
  'musicfit.markImpact': 'סימון הרגע', 'musicfit.toBeat': 'אל הפעימה', 'musicfit.toBar': 'אל תחילת התיבה', 'musicfit.earlier': 'מוקדם יותר', 'musicfit.later': 'מאוחר יותר', 'musicfit.clearImpact': 'מחיקת הסימון',
  'musicfit.impactAfter': 'הרגע {frames} פריימים אחרי הפעימה', 'musicfit.impactBefore': 'הרגע {frames} פריימים לפני הפעימה',
  'musicfit.impactOnBeat': 'עכשיו על הפריים של הפעימה; שארית {ms} אלפיות שנייה לפי החישוב', 'musicfit.impactKept': 'קליפ עם רגע מסומן נשמר כפי שהוא ביצירה מחדש',
  'musicfit.realign': 'ליישר שוב {n} רגעים', 'musicfit.uncalibrated': 'השהיית המסך והרמקולים לא כוילה',
} as const;
export const MUSICFIT_EN: Record<keyof typeof MUSICFIT_HE, string> = {
  'op.set_clip_impact': 'Marked the moment', 'op.sync_impact': 'Moment to the beat', 'op.add_fitted_music': 'Added a shortened song', 'op.mark_join_heard': 'Marked the join as heard',
  'cmd.markImpact': 'Mark the moment in the clip', 'cmd.impactToBeat': 'Moment to the beat', 'cmd.impactToBar': 'Moment to the bar start',
  'error.code.musicfit_not_built': 'Music that fits the film is not built in this build yet', 'error.code.needs_bars': 'The music has no measured bar starts', 'error.code.no_join': 'No place to join was found',
  'error.code.fit_stale': 'The song\'s beats changed since the plan', 'error.code.fit_unstable': 'The second plan came out different', 'error.code.flash_gap': 'A cut too close to another cut',
  'error.code.too_short': 'Too short', 'error.code.too_long': 'Too long', 'error.code.not_from_start': 'The clip does not start at the start of its file',
  'musicfit.fit': 'Fit to length', 'musicfit.swap': 'Other music', 'musicfit.recut': 'Cut again to the music', 'musicfit.alsoLength': 'Also fit the length',
  'musicfit.apply': 'Do it', 'musicfit.cancel': 'Cancel', 'musicfit.working': 'Planning…', 'musicfit.notBuilt': 'Music that fits the film is not built in this build yet',
  'musicfit.endsWithFilm': 'The music ends with the film; the last chord starts {seconds} s before the end',
  'musicfit.endsEarly': 'Ends {seconds} s before the end, with its own ending', 'musicfit.endsCut': 'The ending is cut by {seconds} s and faded', 'musicfit.otherEnding': 'Other ending',
  'musicfit.composedAgain': 'The music is composed again in the same style for this length; these are not the same notes',
  'musicfit.playJoin': 'Play the join', 'musicfit.otherJoin': 'Another join', 'musicfit.heard': 'I listened — the join is fine', 'musicfit.unheard': 'Automatic join — not heard yet',
  'musicfit.heardBy': 'The join was heard ({at})', 'musicfit.measured': 'Measured, not heard', 'musicfit.joinAt': 'The join at {seconds} s',
  'musicfit.what': 'What changes', 'musicfit.cutsBefore': 'Cuts before', 'musicfit.cutsAfter': 'Cuts after', 'musicfit.minGap': 'Shortest gap: {frames} frames',
  'musicfit.thinned': 'Cuts left out for the flash rule: {n}', 'musicfit.kept': 'Clips kept as you edited them: {n}', 'musicfit.movedBack': 'Clips laid out again after a delete: {n}',
  'musicfit.blocked': 'Parts edited by hand that cannot be cut again: {names}', 'musicfit.offBeat': 'Marked moments that will move off the beat: {n}', 'musicfit.keysDropped': 'Volume keys that will be removed: {n}',
  'musicfit.markImpact': 'Mark the moment', 'musicfit.toBeat': 'To the beat', 'musicfit.toBar': 'To the bar start', 'musicfit.earlier': 'Earlier', 'musicfit.later': 'Later', 'musicfit.clearImpact': 'Clear the mark',
  'musicfit.impactAfter': 'The moment is {frames} frames after the beat', 'musicfit.impactBefore': 'The moment is {frames} frames before the beat',
  'musicfit.impactOnBeat': 'Now on the beat\'s frame; residual {ms} ms by calculation', 'musicfit.impactKept': 'A clip with a marked moment is kept as it is when made again',
  'musicfit.realign': 'Align {n} moments again', 'musicfit.uncalibrated': 'Screen and speaker delay are not calibrated',
};

/** The Hebrew of every musicfit refusal, each with the next step. */
export const HE_MUSICFIT: [RegExp, (m: RegExpExecArray) => string][] = [
  // core MUSICFIT_REFUSALS
  [/^(\w+): music that fits the film is not built in this build yet$/, () => 'התאמת מוזיקה לסרט עוד לא נבנתה בגרסה הזו. שום דבר לא השתנה; אפשר לעדכן את העורך ולנסות שוב'],
  [/^a still, a freeze frame or a title has no moment to mark$/, () => 'בתמונה, בפריים קפוא או בכותרת אין רגע לסמן. בחרו קליפ וידאו או קול'],
  [/^the moment is outside the file$/, () => 'הרגע מחוץ לקובץ. הזיזו את הסמן לתוך הקליפ ונסו שוב'],
  [/^mark the moment first$/, () => 'סמנו קודם את הרגע. אחר כך קרבו אותו לפעימה'],
  [/^the marked moment is not in the part this clip shows$/, () => 'הרגע המסומן אינו בחלק שהקליפ מציג. סמנו רגע מחדש בתוך הקליפ'],
  [/^no music with measured beats plays under this moment$/, () => 'אין מתחת לרגע הזה מוזיקה עם פעימות מדודות. הוסיפו מוזיקה או מדדו את הפעימות שלה'],
  [/^the file has no material to bring the moment to that beat$/, () => 'אין בקובץ מספיק חומר כדי להביא את הרגע לפעימה. נסו פעימה מוקדמת או מאוחרת יותר'],
  [/^the moment is already on that beat's frame$/, () => 'הרגע כבר על הפריים של הפעימה. אין מה להזיז'],
  [/^music that plays backwards or at another speed cannot be fitted or swapped$/, () => 'אי אפשר להתאים או להחליף מוזיקה שמתנגנת לאחור או במהירות אחרת. החזירו אותה למהירות רגילה ונסו שוב'],
  [/^a fitted track is a sound file shortened from a file of this library$/, () => 'קובץ מקוצר הוא קובץ קול שנעשה מקובץ בספרייה. בחרו את השיר המקורי ונסו שוב'],
  [/^the song (\S+) it was shortened from is not in this project$/, () => 'השיר המקורי אינו בפרויקט. החזירו אותו (ביטול) ונסו שוב'],
  [/^the licence of this music \((.*)\) forbids changing it, so it cannot be shortened$/, (m) => `הרישיון של המוזיקה הזו (${m[1]}) אוסר לשנות אותה, ולכן אי אפשר לקצר אותה. בחרו מוזיקה אחרת`],
  [/^the licence of this music \((.*)\) would put the whole video under the same licence, so it is not shortened$/, (m) => `הרישיון של המוזיקה הזו (${m[1]}) היה מחייב לשתף את כל הסרטון באותו רישיון, ולכן היא לא מקוצרת. בחרו מוזיקה אחרת`],
  [/^the licence of this music \((.*)\) is not one the editor knows, so it is not shortened$/, (m) => `העורך אינו מכיר את הרישיון של המוזיקה הזו (${m[1]}), ולכן היא לא מקוצרת. בחרו מוזיקה אחרת`],
  [/^this music was made from more than one library file, so shortening it is not offered$/, () => 'המוזיקה הזו נעשתה מכמה קבצים בספרייה, ולכן אין הצעה לקצר אותה. קצרו את הקובץ המקורי'],
  [/^this music is already a shortened copy$/, () => 'המוזיקה הזו כבר עותק מקוצר. קצרו את השיר המקורי'],
  [/^the beats of the shortened track are not ascending or lie outside the file$/, () => 'הפעימות של הקובץ המקוצר אינן בסדר עולה או מחוץ לקובץ. תכננו את ההתאמה מחדש'],
  [/^the removed stretch must start and end on bar starts of the song's measured beats$/, () => 'הקטע שמוסר חייב להתחיל ולהיגמר בתחילת תיבה מדודה. תכננו את ההתאמה מחדש'],
  [/^file (\S+) is not a shortened song$/, () => 'הקובץ הזה אינו שיר מקוצר. בחרו את הקליפ עם החיבור'],
  // apps/server/src/musicfit/routes.ts MUSICFIT_SERVER_REFUSALS (and the same 501 sentence in apps/server/src/music.ts)
  [/^music that fits the film is not built in this build yet$/, () => 'התאמת מוזיקה לסרט עוד לא נבנתה בגרסה הזו. אפשר לעדכן את העורך ולנסות שוב'],
  [/^this credential may only propose edits, and fitting music adds a file to the library, which a proposal does not carry$/, () => 'ההרשאה הזו יכולה רק להציע עריכות, והתאמת מוזיקה מוסיפה קובץ לספרייה, מה שהצעה לא נושאת. בקשו מבעל הפרויקט לבצע זאת'],
  [/^only the project owner can mark a join as heard, from their own session$/, () => 'רק בעל הפרויקט יכול לסמן שהחיבור נשמע, מהחלון שלו. השמיעו את החיבור בעורך וסמנו'],
  [/^the song has no measured bar starts, so no whole bars can be removed$/, () => 'אין למוזיקה תחילות תיבה מדודות, ולכן אי אפשר להסיר תיבות שלמות. מדדו את הפעימות או בחרו סיום בדעיכה'],
  [/^no place to join was found on the bar starts of this song$/, () => 'לא נמצא מקום חיבור על תחילות התיבות של השיר הזה. בחרו סיום בדעיכה או מוזיקה אחרת'],
  [/^the film is too short for this music: it needs at least ([\d.]+) s$/, (m) => `הסרט קצר מדי למוזיקה הזאת: לפחות ${m[1]} שניות. בחרו סגנון אחר או הוסיפו תמונות`],
  [/^built-in music is at most five minutes$/, () => 'מוזיקה מובנית היא עד חמש דקות. קצרו את הסרט או בחרו שיר מהספרייה'],
  [/^a song longer than ten minutes is not shortened$/, () => 'שיר ארוך מעשר דקות לא מקוצר. בחרו שיר קצר יותר או סיום בדעיכה'],
  [/^built-in music is composed again from its start, and this clip does not start at the start of its file$/, () => 'המוזיקה המובנית נבנית מחדש מתחילתה, והקליפ הזה אינו מתחיל בתחילת הקובץ. גררו את תחילת הקליפ לתחילת הקובץ ונסו שוב'],
  [/^the beats of the song changed since the plan$/, () => 'הפעימות של השיר השתנו מאז התכנון. תכננו שוב'],
  [/^the second plan ended on another frame than the first, so nothing was changed$/, () => 'התכנון השני הסתיים בפריים אחר מהראשון, ולכן שום דבר לא השתנה. נסו שוב'],
  [/^a cut this plan makes would come closer to another cut than the flash rule allows$/, () => 'חיתוך שהתוכנית יוצרת היה קרוב לחיתוך אחר יותר ממה שכלל ההבהובים מרשה. בחרו מוזיקה איטית יותר או קצב חיתוך רגוע'],
];
