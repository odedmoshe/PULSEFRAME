/**
 * Strings of marked source ranges — «פנינים» (wave 7 pearls track, .artifacts/wave7/pearls-decisions.md). Spread into `he` and `en`
 * (index.ts); Hebrew first, the English dictionary covers the same keys. Vocabulary: a pearl «פנינה», the list «פנינים», a whole-file
 * tag «מי בקליפ?», the measurement «מי כמה בסרט». No string judges a cut: no «הוגן», «מאוזן», «צריך», fair, balanced, should
 * (core PEARL_FORBIDDEN_WORDS, checked by packages/evals/src/pearls-wording.test.ts).
 * Namespaces: `op.*`, `cmd.*`, `error.code.*`, `pearl.*` (the interface; builder C reads them through pearls/pearls.strings.ts).
 * Also here: HE_PEARLS, the Hebrew of every refusal of the three operations (core SOURCE_RANGE_REFUSALS) and of the server's guards
 * (apps/server/src/peoplePrivacy.ts HUMAN_TAG_REFUSALS, apps/server/src/pearls.ts), each with the next step.
 */
export const PEARLS_HE = {
  'op.add_source_range': 'סימון פנינה', 'op.update_source_range': 'שינוי פנינה', 'op.remove_source_range': 'מחיקת פנינה',
  'cmd.viewPearls': 'פנינים: פתיחת הרשימה',
  'error.code.human_tag_required': 'רק בעל הפרויקט מתייג אנשים', 'error.code.pearls_not_built': 'הפנינים עוד לא נבנו בגרסה הזו',
  'pearl.view': 'פנינים', 'pearl.one': 'פנינה', 'pearl.save': 'שמור כפנינה', 'pearl.name': 'שם הפנינה', 'pearl.who': 'מי בקטע?', 'pearl.whoInClip': 'מי בקליפ?',
  'pearl.filterAll': 'הכול', 'pearl.filterUnused': 'לא בשימוש', 'pearl.search': 'חיפוש בפנינים',
  'pearl.show': 'הצג', 'pearl.addEnd': 'הוסף בסוף', 'pearl.insertAt': 'הכנס במקום הסמן', 'pearl.short': 'שורט מהפנינה', 'pearl.delete': 'מחק',
  'pearl.used': 'בשימוש: {used} מתוך {total} שניות', 'pearl.unused': 'לא בשימוש',
  'pearl.empty': 'עוד אין פנינים. פתחו קליפ, סמנו התחלה וסוף (I, O) ולחצו P',
  'pearl.byAgent': 'סומן על ידי סוכן', 'pearl.untimedCopy': 'עותק בלי מיפוי זמן — לא נספר', 'pearl.deleted': 'פנינה שנמחקה', 'pearl.unnamed': 'פנינה בלי שם', 'pearl.wholeFile': 'כל הקובץ',
  'pearl.labelsHidden': 'שמות הפנינים מוסתרים מההרשאה הזו: הם הערות משפחתיות',
  'pearl.saved': 'הפנינה נשמרה', 'pearl.cancel': 'ביטול', 'pearl.notBuilt': 'הפנינים עוד לא נבנו בגרסה הזו',
  'pearl.screenTitle': 'מי כמה בסרט', 'pearl.screenLabel': 'לפי תיוג ידני בלבד, בלי זיהוי פנים. נספר כל קליפ מתויג שמוצג, גם כשתמונה אחרת מכסה אותו',
  'pearl.untagged': 'לא מתויג', 'pearl.mostlyUntagged': 'רוב הסרט לא מתויג — המספרים חלקיים', 'pearl.unusedOf': 'פנינים שלא בשימוש של {name}', 'pearl.share': '{percent}% מזמן התמונה',
  'pearl.filmPrefer': 'להעדיף פנינים', 'pearl.filmNone': 'בלי פנינים',
  'pearl.shortBlocked.too_short': 'הפנינה קצרה מ־3 שניות: סמנו קטע ארוך יותר', 'pearl.shortBlocked.too_long': 'הפנינה ארוכה מ־3 דקות: סמנו קטע קצר יותר', 'pearl.shortBlocked.no_picture': 'בקובץ אין תמונה: שורט נבנה מסרטון', 'pearl.shortBlocked.whole_file': 'פנינה של כל הקובץ: סמנו קטע',
  // the interface's own sentences (builder C's PEARLS_EXTRA, moved here at integration)
  'pearl.formSave': 'שמירה', 'pearl.stripLabel': 'פנינים שמורות וקטעים שכבר בשימוש', 'pearl.stripPearl': 'פנינה שמורה', 'pearl.stripUsed': 'בשימוש בסרט',
  'pearl.whoHint': 'סמנו מי מופיע בקליפ. זה תיוג ידני, בלי זיהוי פנים', 'pearl.whoNoPeople': 'עוד אין אנשים בפרויקט. אפשר להוסיף אותם ברשימת האנשים', 'pearl.whoOpenPeople': 'פתיחת רשימת האנשים',
  'pearl.whoSaved': 'התיוג נשמר', 'pearl.whoCleared': 'התיוג הוסר', 'pearl.whoOwnerOnly': 'רק בעל הפרויקט מתייג אנשים, מהחלון שלו',
  'pearl.colWho': 'מי', 'pearl.colTime': 'זמן על המסך', 'pearl.colShare': 'חלק מזמן התמונה', 'pearl.screenNone': 'עוד אין קליפים על הציר', 'pearl.screenSeconds': '{seconds} שנ׳',
  'pearl.filmPearlsNote': 'מכל קובץ נכנסת פנינה אחת: הראשונה שסימנתם בו', 'pearl.filmPearlsLegend': 'פנינים בסרט',
  // the family film's removed_by_hand warning when pearls were deleted by hand ({files}: the FILES' names, quoted; never a label)
  'pearl.removedOne': 'פנינה שסימנתם ב{files} נמחקה ידנית ולא נוספה שוב; הקובץ שלה יכול להישאר בסרט',
  'pearl.removedMany': 'פנינים שסימנתם ב{files} נמחקו ידנית ולא נוספו שוב; הקבצים שלהן יכולים להישאר בסרט',
  'pearl.removedAlsoOne': 'וגם פנינה שסימנתם ב{files} נמחקה ידנית ולא נוספה שוב; הקובץ שלה יכול להישאר בסרט',
  'pearl.removedAlsoMany': 'וגם פנינים שסימנתם ב{files} נמחקו ידנית ולא נוספו שוב; הקבצים שלהן יכולים להישאר בסרט',
  'pearl.restoreOne': 'אפשר להחזיר אותה ב«{restore}»', 'pearl.restoreMany': 'אפשר להחזיר אותן ב«{restore}»',
} as const;
export const PEARLS_EN: Record<keyof typeof PEARLS_HE, string> = {
  'op.add_source_range': 'Marked a pearl', 'op.update_source_range': 'Changed a pearl', 'op.remove_source_range': 'Removed a pearl',
  'cmd.viewPearls': 'Pearls: open the list',
  'error.code.human_tag_required': 'Only the project owner tags people', 'error.code.pearls_not_built': 'Pearls are not built in this build yet',
  'pearl.view': 'Pearls', 'pearl.one': 'Pearl', 'pearl.save': 'Save as pearl', 'pearl.name': 'Name of the pearl', 'pearl.who': 'Who is in it?', 'pearl.whoInClip': 'Who is in the clip?',
  'pearl.filterAll': 'All', 'pearl.filterUnused': 'Not used', 'pearl.search': 'Search pearls',
  'pearl.show': 'Show', 'pearl.addEnd': 'Add at the end', 'pearl.insertAt': 'Insert at the playhead', 'pearl.short': 'Short from the pearl', 'pearl.delete': 'Delete',
  'pearl.used': 'Used: {used} of {total} seconds', 'pearl.unused': 'Not used',
  'pearl.empty': 'No pearls yet. Open a clip, mark a start and an end (I, O) and press P',
  'pearl.byAgent': 'Marked by an agent', 'pearl.untimedCopy': 'A copy without a time mapping — not counted', 'pearl.deleted': 'A deleted pearl', 'pearl.unnamed': 'An unnamed pearl', 'pearl.wholeFile': 'The whole file',
  'pearl.labelsHidden': 'Pearl names are hidden from this credential: they are family notes',
  'pearl.saved': 'The pearl was saved', 'pearl.cancel': 'Cancel', 'pearl.notBuilt': 'Pearls are not built in this build yet',
  'pearl.screenTitle': 'Who is on screen, and how long', 'pearl.screenLabel': 'From manual tags only, no face recognition. Every tagged clip that is shown counts, also when another picture covers it',
  'pearl.untagged': 'Not tagged', 'pearl.mostlyUntagged': 'Most of the film is not tagged — the numbers are partial', 'pearl.unusedOf': 'Unused pearls of {name}', 'pearl.share': '{percent}% of the picture time',
  'pearl.filmPrefer': 'Prefer pearls', 'pearl.filmNone': 'No pearls',
  'pearl.shortBlocked.too_short': 'The pearl is shorter than 3 seconds: mark a longer stretch', 'pearl.shortBlocked.too_long': 'The pearl is longer than 3 minutes: mark a shorter stretch', 'pearl.shortBlocked.no_picture': 'The file has no picture: a short is made from a video', 'pearl.shortBlocked.whole_file': 'A pearl of the whole file: mark a stretch',
  'pearl.formSave': 'Save', 'pearl.stripLabel': 'Saved pearls and stretches already in use', 'pearl.stripPearl': 'Saved pearl', 'pearl.stripUsed': 'Used in the film',
  'pearl.whoHint': 'Mark who appears in the clip. This is a manual tag, no face recognition', 'pearl.whoNoPeople': 'There are no people in the project yet. Add them in the people list', 'pearl.whoOpenPeople': 'Open the people list',
  'pearl.whoSaved': 'The tag was saved', 'pearl.whoCleared': 'The tag was removed', 'pearl.whoOwnerOnly': 'Only the project owner tags people, from their own session',
  'pearl.colWho': 'Who', 'pearl.colTime': 'Time on screen', 'pearl.colShare': 'Share of the picture time', 'pearl.screenNone': 'There are no clips on the timeline yet', 'pearl.screenSeconds': '{seconds} s',
  'pearl.filmPearlsNote': 'One pearl of each file goes in: the first one you marked in it', 'pearl.filmPearlsLegend': 'Pearls in the film',
  'pearl.removedOne': 'A pearl you marked in {files} was deleted by hand and not added again; its file may stay in the film',
  'pearl.removedMany': 'Pearls you marked in {files} were deleted by hand and not added again; their files may stay in the film',
  'pearl.removedAlsoOne': 'Also, a pearl you marked in {files} was deleted by hand and not added again; its file may stay in the film',
  'pearl.removedAlsoMany': 'Also, pearls you marked in {files} were deleted by hand and not added again; their files may stay in the film',
  'pearl.restoreOne': '"{restore}" brings it back', 'pearl.restoreMany': '"{restore}" brings them back',
};

/** The Hebrew of every pearls refusal, each with the next step. */
export const HE_PEARLS: [RegExp, (m: RegExpExecArray) => string][] = [
  // core SOURCE_RANGE_REFUSALS
  [/^there is no file (\S+) to mark in the library of this project$/, () => 'הקובץ הזה אינו בספריית המדיה של הפרויקט. בחרו קובץ מהספרייה'],
  [/^(\w+): marked ranges are not built in this build yet$/, () => 'סימון פנינים עוד לא נבנה בגרסה הזו. אפשר לעדכן את העורך ולנסות שוב'],
  [/^a colour table has no time to mark$/, () => 'בטבלת צבע אין זמן לסמן. סמנו סרטון, קול או תמונה'],
  [/^give both start and end, or neither for the whole file$/, () => 'תנו גם התחלה וגם סוף, או בלי שניהם כדי לסמן את כל הקובץ. נסו שוב'],
  [/^give either whole or start and end, not both$/, () => 'סמנו את כל הקובץ או התחלה וסוף, לא את שניהם. בחרו אחד מהם'],
  [/^a photo is marked whole; give no start and end$/, () => 'תמונה מסומנת כולה, בלי התחלה וסוף. השמיטו את ההתחלה והסוף'],
  [/^a "who is in it" tag covers the whole file; give no start and end$/, () => 'תיוג «מי בקליפ?» חל על כל הקובץ, בלי התחלה וסוף. השמיטו את ההתחלה והסוף, או סמנו פנינה'],
  [/^a range starts at 0 or later, ends after it starts and ends inside the file \(([\d.]+) s\)$/, (m) => `קטע מסומן מתחיל מ־0 או אחריו, נגמר אחרי תחילתו ובתוך הקובץ (${m[1]} שניות). בדקו את ההתחלה והסוף`],
  [/^the name of a marked range is one line$/, () => 'שם של פנינה הוא שורה אחת. הסירו את מעבר השורה'],
  [/^a "who is in it" tag needs at least one person and has no name$/, () => 'בתיוג «מי בקליפ?» יש לפחות אדם אחד, ואין לו שם. בחרו מי בקליפ'],
  [/^person (\S+) is not in this project$/, () => 'האדם הזה אינו בפרויקט. אפשר להוסיף אותו ברשימת האנשים'],
  [/^this file already has the same stretch marked$/, () => 'הקטע הזה כבר מסומן בקובץ. אפשר לשנות את הסימון הקיים'],
  [/^a project holds at most (\d+) marked ranges$/, (m) => `פרויקט מחזיק עד ${m[1]} סימונים. אפשר למחוק סימונים שכבר אינם נחוצים`],
  [/^marked range (\S+) not found$/, () => 'הסימון הזה כבר לא נמצא, אולי נמחק. פתחו שוב את רשימת הפנינים'],
  [/^nothing to change: give start and end, whole, label or people$/, () => 'לא צוין מה לשנות בסימון. בחרו התחלה וסוף, שם או אנשים'],
  [/^the marked range already has these details$/, () => 'לסימון כבר יש הפרטים האלה. אין מה לשנות'],
  // apps/server/src/peoplePrivacy.ts HUMAN_TAG_REFUSALS and the label rule
  [/^only the project owner tags people on marked ranges, from their own session$/, () => 'רק בעל הפרויקט מתייג אנשים בקטעים מסומנים, מהחלון שלו. אפשר לבקש ממנו לתייג בעורך'],
  [/^this marked range has people tagged by the project owner; only the owner may change or remove it$/, () => 'בקטע הזה יש אנשים שבעל הפרויקט תייג, ורק הוא יכול לשנות או למחוק אותו. אפשר לבקש ממנו לעשות זאת בעורך'],
  [/^this person is tagged in marked ranges; only the project owner may remove them$/, () => 'האדם הזה מתויג בקטעים מסומנים, ורק בעל הפרויקט יכול להסיר אותו. אפשר לבקש ממנו לעשות זאת בעורך'],
  [/^this credential may not give the name of a marked range: pearl names are family notes$/, () => 'ההרשאה הזו לא יכולה לתת שם לפנינה: שמות הפנינים הם הערות משפחתיות. אפשר להוסיף פנינה בלי שם, ובעל הפרויקט ייתן לה שם'],
  // apps/server/src/pearls.ts
  [/^pearls are not built in this build yet$/, () => 'הפנינים עוד לא נבנו בגרסה הזו. אפשר לעדכן את העורך ולנסות שוב'],
];
