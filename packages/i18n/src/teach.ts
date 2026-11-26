/**
 * Strings of «למדו אותי פעם אחת» — teach once (wave 8 teach track; core lessonContract.ts). Spread into `he` and `en` (index.ts);
 * Hebrew first, plural address («החילו», «בחרו»), no gendered forms; the English dictionary covers the same keys.
 * Namespaces: `op.apply_lesson`, `cmd.teachApply`, `error.code.*` of the route and the governance refusal, `teach.*` (the shared
 * lines: the Inspector line, the window's heuristic, the honest state that a look is not previewed, the part kinds, the not-learned
 * reasons, the window stops, the per-clip skip). The dialog's own strings are apps/web/src/editor/teach/teach.strings.ts (W3).
 * Also here: HE_TEACH, the Hebrew of every refusal of apply_lesson (core LESSON_REFUSALS) and of the route and governance
 * (LESSON_API_REFUSALS), each with the next step; packages/evals/src/teach-wording.test.ts keeps them in step.
 * Nothing is called right, matched or verified: a lesson repeats edits; how the result looks is unknown until the owner looks.
 */
export const TEACH_HE = {
  'op.apply_lesson': 'החלת עריכות שנלמדו', 'cmd.teachApply': 'החילו את העריכות האחרונות על קליפים אחרים…',
  'error.code.teach_not_built': 'הלמידה מקליפ עוד לא נבנתה בגרסה הזו של העורך', 'error.code.lesson_owner_only': 'רק בעלי הפרויקט מחילים עריכות שנלמדו, מהעורך במחשב הזה',
  'teach.name': 'למדו אותי פעם אחת',
  /** the Inspector line (its count is filled by teach.strings.ts: one / many) */
  'teach.chipOne': 'למדתי שלב אחד מהקליפ הזה · החילו גם על…', 'teach.chipMany': 'למדתי {n} שלבים מהקליפ הזה · החילו גם על…',
  'teach.dialogTitle': 'החילו גם על…', 'teach.fromClip': 'מה שעשיתם ב־"{name}"', 'teach.targets': 'על אילו קליפים', 'teach.allOnTrack': 'כל הקליפים במסלול',
  'teach.applyMany': 'החלה על {n} קליפים', 'teach.applyOne': 'החלה על קליפ אחד',
  /** the heuristic, labelled (C14) */
  'teach.window': 'מתוך העריכות האחרונות שלכם בקליפ הזה (עד 40). אפשר לבטל את הסימון של כל שלב',
  /** C13 / the cut stills: the honest state that a look is not previewed here */
  'teach.lookNoPreview': 'המראה לא מוצג כאן מראש. אחרי ההחלה הוא מופיע בתצוגה, ו־Ctrl+Z מבטל הכול בבת אחת',
  'teach.lookNoAdapter': 'אין כאן מתאם גרפי להצגת המראה: הוא נשמר בקליפים, אבל לא יוצג ולא ייוצא במחשב הזה',
  'teach.sameStepsNotSameLook': 'אותם שלבים, לא בהכרח אותו מראה: לקליפ שיש לו צבע או אפקטים משלו התוצאה תהיה שונה. רוצים את כל המראה? הדבקת מאפיינים (Ctrl+Alt+V)',
  'teach.absolute': 'ערכים נלמדים כמו שהם (למשל עוצמה 70%), לא כשינוי יחסי',
  'teach.lightWarning': 'בשלבים האלה יש הבזקי אור: הכלל המשותף של עד 3 הבזקים בשנייה חל על כל הסרט',
  'teach.nothing': 'עוד לא נלמד מהקליפ הזה שלב שאפשר להחיל על קליפים אחרים',
  'teach.notBuilt': 'הלמידה מקליפ עוד לא נבנתה בגרסה הזו של העורך',
  'teach.notInFormat': 'כשמוצג פורמט אחר אפשר להחיל עריכות רק בגרסה הראשית',
  'teach.proposal': 'הצעה שאישרתם',
  // the part kinds (LESSON_PART_ORDER)
  'teach.part.speed': 'מהירות', 'teach.part.trim': 'קיצור', 'teach.part.transform': 'מיקום וגודל', 'teach.part.motion': 'תנועה', 'teach.part.look': 'מראה צבע',
  'teach.part.effect': 'אפקט', 'teach.part.title': 'כותרת', 'teach.part.gain': 'עוצמה', 'teach.part.fades': 'עמעום', 'teach.part.soundFx': 'אפקט קול',
  'teach.part.transition': 'מעבר', 'teach.part.stabilise': 'ייצוב',
  // why an edit is not learned (NOT_LEARNED_WHY + DERIVE_LEFT_OUT)
  'teach.why.placement': 'הזזה על ציר הזמן — המקום של קליפ שייך לו', 'teach.why.structure': 'שינוי במסלולים או בסמנים — לא של קליפ אחד',
  'teach.why.hand_drawn': 'נקודות מפתח וקווים שציירתם — שייכים לתמונה הזו', 'teach.why.clip_content': 'התוכן של הקליפ עצמו (איזה קובץ, איזה רגע)',
  'teach.why.words': 'מילים — לא עוברות לקליפים אחרים', 'teach.why.other_entities': 'עריכה של כמה קליפים יחד', 'teach.why.project': 'הגדרה של הפרויקט או של הספרייה',
  'teach.why.analysis': 'נתוני ניתוח של קובץ', 'teach.why.people': 'אנשים וקטעים מסומנים', 'teach.why.privacy': 'אזור פרטיות — לא מועבר ולא מוסר',
  'teach.why.family_data': 'תאריכים ופרטי משפחה', 'teach.why.formats': 'פורמטים וגרסאות', 'teach.why.multicam': 'צילום מכמה מצלמות',
  'teach.why.internal': 'פעולה של המערכת', 'teach.why.replaces': 'החליפה את העריכות שלפניה', 'teach.why.not_v1': 'עוד לא בגרסה הזו',
  'teach.why.made_before': 'שינוי של משהו שהיה בקליפ עוד לפני העריכות האלה', 'teach.why.cancelled': 'נוסף ואחר כך הוסר', 'teach.why.empty': 'לא נשאר בשלב מה להחיל',
  'teach.why.other_clip': 'נעשה בקליפ אחר', 'teach.why.param_words': 'טקסט שהקלדתם באפקט — לא עובר', 'teach.why.param_asset': 'טבלת צבע מהספרייה — עוד לא בגרסה הזו',
  'teach.why.param_measured': 'מדידה של הקול בקליפ הזה — לא מתאימה לקליפ אחר', 'teach.why.font_not_in_catalogue': 'גופן שאינו ברשימת הגופנים', 'teach.why.cap': 'מעבר למספר השלבים שנלמדים בבת אחת',
  // where the window stopped (WINDOW_STOPS)
  'teach.stop.created': 'מאז שהקליפ נוצר', 'teach.stop.restored': 'מאז ששחזרתם גרסה', 'teach.stop.pasted': 'מאז הדבקת המאפיינים', 'teach.stop.lesson': 'מאז ההחלה הקודמת',
  'teach.stop.template': 'מאז שתבנית או סרט אוטומטי בנו את הקליפ', 'teach.stop.proposal': 'מאז שאישרתם הצעה של סוכן', 'teach.stop.cap': 'העריכות האחרונות בלבד',
  'teach.stop.scan_limit': 'העריכות האחרונות בפרויקט בלבד', 'teach.stop.history_start': 'מתחילת ההיסטוריה של הפרויקט',
  // per-clip skip beside the op refusals (translateRefusal)
  'teach.skip.no_sound': 'לקליפ הזה אין קול מקושר, ולכן שלבי הקול דולגו', 'teach.rowApplied': '{n} שלבים', 'teach.rowSkipped': 'דולג: {part} — {why}',
} as const;
export const TEACH_EN: Record<keyof typeof TEACH_HE, string> = {
  'op.apply_lesson': 'Applied learned edits', 'cmd.teachApply': 'Apply the recent edits to other clips…',
  'error.code.teach_not_built': 'Learning from a clip is not built in this build yet', 'error.code.lesson_owner_only': 'Only the project owner applies learned edits, from the editor on this computer',
  'teach.name': 'Teach once',
  'teach.chipOne': 'Learned 1 step from this clip · Apply to…', 'teach.chipMany': 'Learned {n} steps from this clip · Apply to…',
  'teach.dialogTitle': 'Apply to…', 'teach.fromClip': 'What you did in "{name}"', 'teach.targets': 'Which clips', 'teach.allOnTrack': 'All clips on the track',
  'teach.applyMany': 'Apply to {n} clips', 'teach.applyOne': 'Apply to 1 clip',
  'teach.window': 'From your latest edits of this clip (up to 40). Any step can be unticked',
  'teach.lookNoPreview': 'The look is not previewed here. After applying it shows in the viewer, and Ctrl+Z undoes it all at once',
  'teach.lookNoAdapter': 'There is no graphics adapter here to show the look: it is saved on the clips but will not be shown or exported on this computer',
  'teach.sameStepsNotSameLook': 'The same steps, not necessarily the same look: a clip with its own colour or effects ends differently. Want the whole look? Paste attributes (Ctrl+Alt+V)',
  'teach.absolute': 'Values are learned as they are (for example volume 70%), not as a relative change',
  'teach.lightWarning': 'These steps have flashes of light: the shared limit of 3 flashes a second applies to the whole film',
  'teach.nothing': 'Nothing learned from this clip yet that could be applied to other clips',
  'teach.notBuilt': 'Learning from a clip is not built in this build yet',
  'teach.notInFormat': 'While another format is shown, edits can only be applied in the main version',
  'teach.proposal': 'A proposal you accepted',
  'teach.part.speed': 'Speed', 'teach.part.trim': 'Trim', 'teach.part.transform': 'Position and size', 'teach.part.motion': 'Motion', 'teach.part.look': 'Colour look',
  'teach.part.effect': 'Effect', 'teach.part.title': 'Title', 'teach.part.gain': 'Volume', 'teach.part.fades': 'Fades', 'teach.part.soundFx': 'Sound effect',
  'teach.part.transition': 'Transition', 'teach.part.stabilise': 'Stabilise',
  'teach.why.placement': 'A move on the timeline — a clip\'s place is its own', 'teach.why.structure': 'A change of tracks or markers — not of one clip',
  'teach.why.hand_drawn': 'Keyframes and lines you drew — they belong to this picture', 'teach.why.clip_content': 'The clip\'s own content (which file, which moment)',
  'teach.why.words': 'Words — they do not go to other clips', 'teach.why.other_entities': 'An edit of several clips together', 'teach.why.project': 'A project or library setting',
  'teach.why.analysis': 'Analysis data of a file', 'teach.why.people': 'People and marked ranges', 'teach.why.privacy': 'A privacy region — never moved or removed',
  'teach.why.family_data': 'Dates and family details', 'teach.why.formats': 'Formats and versions', 'teach.why.multicam': 'Multi-camera footage',
  'teach.why.internal': 'An action of the system', 'teach.why.replaces': 'It replaced the edits before it', 'teach.why.not_v1': 'Not in this version yet',
  'teach.why.made_before': 'A change of something the clip had before these edits', 'teach.why.cancelled': 'Added and later removed', 'teach.why.empty': 'Nothing left in the step to apply',
  'teach.why.other_clip': 'Done on another clip', 'teach.why.param_words': 'Text you typed in an effect — it does not go along', 'teach.why.param_asset': 'A colour table from the library — not in this version yet',
  'teach.why.param_measured': 'A measurement of this clip\'s sound — it does not fit another clip', 'teach.why.font_not_in_catalogue': 'A font that is not in the font list', 'teach.why.cap': 'Beyond the number of steps learned at once',
  'teach.stop.created': 'Since the clip was made', 'teach.stop.restored': 'Since you restored a version', 'teach.stop.pasted': 'Since attributes were pasted', 'teach.stop.lesson': 'Since the last time edits were applied',
  'teach.stop.template': 'Since a template or an automatic film built the clip', 'teach.stop.proposal': 'Since you accepted an agent\'s proposal', 'teach.stop.cap': 'The latest edits only',
  'teach.stop.scan_limit': 'The latest edits of the project only', 'teach.stop.history_start': 'From the start of the project\'s history',
  'teach.skip.no_sound': 'This clip has no linked sound, so the sound steps were skipped', 'teach.rowApplied': '{n} steps', 'teach.rowSkipped': 'Skipped: {part} — {why}',
};

type Say = [RegExp, (m: RegExpExecArray) => string][];
/** The Hebrew of every teach refusal, each with the next step. */
export const HE_TEACH: Say = [
  // core LESSON_REFUSALS
  [/^apply_lesson: lessons are not built in this build yet$/, () => 'הלמידה מקליפ עוד לא נבנתה בגרסה הזו. שום דבר לא השתנה; אפשר לערוך כל קליפ ביד או להדביק מאפיינים'],
  [/^the lesson would run (\d+) operations; at most (\d+) \(targets × steps\)$/, (m) => `ההחלה הייתה מריצה ${m[1]} פעולות, ואפשר עד ${m[2]}. בחרו פחות קליפים או בטלו את הסימון של חלק מהשלבים`],
  [/^the lesson has (\d+) steps; at most (\d+)$/, (m) => `יש ${m[1]} שלבים, ואפשר עד ${m[2]}. בטלו את הסימון של חלק מהשלבים`],
  [/^part (\S+) is named twice$/, () => 'אותו שלב מופיע פעמיים. פתחו את החלון מחדש ונסו שוב'],
  [/^the clip the lesson was learned from \((\S+)\) already has these steps$/, () => 'לקליפ שממנו למדנו כבר יש את השלבים האלה. הוציאו אותו מרשימת הקליפים'],
  [/^clip (\S+) to apply the lesson to is not in the project$/, () => 'אחד הקליפים שנבחרו כבר לא בפרויקט. בחרו שוב את הקליפים'],
  [/^(\S+) cannot be a step of a lesson$/, () => 'העריכה הזו לא נלמדת. עשו אותה ביד בכל קליפ'],
  [/^(\S+) does not belong in a part of kind (\S+)$/, () => 'שלב הופיע בקבוצה שאינה שלו. פתחו את החלון מחדש ונסו שוב'],
  [/^(\S+): a step names its clip only as .+$/, () => 'שלב שנלמד צריך לפנות לקליפ שעליו מחילים, לא לקליפ מסוים. פתחו את החלון מחדש ונסו שוב'],
  [/^(\S+): argument (\S+) is not carried in a lesson$/, () => 'בשלב יש הגדרה שלא עוברת בין קליפים. פתחו את החלון מחדש ונסו שוב'],
  [/^(\S+): (\S+) is never carried in a lesson \(words, positions, measurements, project files\)$/, () => 'בשלב יש מילים, מיקום ברשימה, מדידה או קובץ של הפרויקט, ואלה לא עוברים בין קליפים. הסירו אותם מהשלב'],
  [/^(\S+): "(\S+)" is not a binding a lesson accepts here$/, () => 'בשלב יש הפניה שלא מתאימה למקום שלה. פתחו את החלון מחדש ונסו שוב'],
  [/^(\S+): (\S+) must be (.+)$/, () => 'בשלב יש ערך בצורה לא נכונה. פתחו את החלון מחדש ונסו שוב'],
  [/^(\S+): "\$ref": "(\S+)" names no earlier step of this part$/, () => 'שלב של אפקט מפנה לאפקט שלא נוסף באותה קבוצה. פתחו את החלון מחדש ונסו שוב'],
  [/^font (.+) is not in the font catalogue$/, () => 'הגופן אינו ברשימת הגופנים, ולכן הוא לא עובר בין קליפים. בחרו גופן מהרשימה'],
  [/^none of the steps fit the chosen clips; the rows say why each clip was skipped$/, () => 'אף שלב לא מתאים לקליפים שנבחרו. בדקו בשורות למה כל קליפ דולג, ובחרו קליפים אחרים'],
  // the route and governance (LESSON_API_REFUSALS)
  [/^learning a lesson from a clip is not built in this build yet$/, () => 'הלמידה מקליפ עוד לא נבנתה בגרסה הזו. שום דבר לא נקרא ולא השתנה; בינתיים הדבקת מאפיינים מעתיקה מראה של קליפ'],
  [/^a lesson is learned only from the owner's own edits, in the owner's own session$/, () => 'לומדים רק מהעריכות של בעלי הפרויקט, בחיבור שלהם. פתחו את הקליפ בעורך במחשב הזה'],
  [/^only the owner applies a lesson, from the editor on this computer$/, () => 'רק בעלי הפרויקט מחילים עריכות שנלמדו, מהעורך במחשב הזה. סוכן יכול לשלוח את העריכות עצמן כפעולות רגילות'],
];
