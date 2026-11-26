/**
 * Strings of the content library on disk (wave 7 library track; .artifacts/wave7/library-decisions.md). Spread into `he` and `en`
 * (index.ts); Hebrew first, the English dictionary covers the same keys.
 * Namespaces: `op.*` (the two operations, op-wording.test.ts), `error.code.*` (the server's codes, apps/server/src/library/contract.ts
 * LIBRARY_SERVER_REFUSALS), `library.*` (states, kinds, badges and reasons shared by the editor, the export sheet and the archive).
 * The panels' own strings are apps/web/src/editor/library/library.strings.ts.
 * Also here: HE_LIBRARY, the Hebrew of every refusal of the library operations (core libraryOps.ts LIBRARY_REFUSALS) and of the
 * library routes (LIBRARY_SERVER_REFUSALS), each with the next step; packages/evals/src/library-wording.test.ts keeps it in step.
 */
export const LIBRARY_HE = {
  'op.use_library_item': 'הוספה מהספרייה', 'op.add_credits_card': 'כרטיס קרדיטים',
  'error.code.library_not_built': 'הספרייה עוד לא נבנתה בגרסה הזו', 'error.code.library_not_configured': 'הספרייה לא מוגדרת',
  'error.code.library_root_invalid': 'אי אפשר להשתמש בתיקייה הזו כספרייה', 'error.code.library_item_missing': 'הפריט לא נמצא בספרייה',
  'error.code.library_item_unusable': 'אי אפשר להשתמש בפריט הזה', 'error.code.library_hash_mismatch': 'הקובץ בספרייה השתנה מאז ההורדה',
  'error.code.library_changed_since_index': 'הקובץ השתנה מאז סריקת הספרייה', 'error.code.library_path_escape': 'הפריט מצביע אל מחוץ לתיקייה שלו',
  'error.code.library_audio_unsupported': 'אין האזנה מקדימה לקובץ מסוג זה', 'error.code.svg_unsafe': 'קובץ ה־SVG לא עבר בדיקת בטיחות',
  'error.code.archive_needs_library_choice': 'צריך לבחור איזה ארכיון ליצור',
  // states (core libraryContract.ts LIBRARY_STATES)
  'library.state.not_configured': 'הספרייה לא מוגדרת', 'library.state.root_missing': 'תיקיית הספרייה לא נמצאה', 'library.state.ledger_missing': 'בתיקייה אין יומן ספרייה',
  'library.state.ledger_invalid': 'יומן הספרייה לא תקין', 'library.state.indexing': 'סורקים את הספרייה…', 'library.state.ready': 'הספרייה מוכנה',
  'library.notVerified': 'לא אומת מאז ההורדה', 'library.notRead': 'לא נקרא', 'library.needsSvgRasteriser': 'דורש ממיר SVG',
  // kinds (LIBRARY_KINDS)
  'library.kind.music': 'מוזיקה', 'library.kind.sound': 'צלילים', 'library.kind.loop': 'לופים', 'library.kind.sticker': 'מדבקות', 'library.kind.icon': 'אייקונים',
  'library.kind.illustration': 'איורים', 'library.kind.texture': 'מרקמים', 'library.kind.backdrop': 'רקעים', 'library.kind.video': 'וידאו',
  // badges and duties
  'library.badge.nonCommercial': 'לשימוש לא מסחרי בלבד', 'library.badge.credit': 'דורש קרדיט', 'library.badge.people': 'אנשים בקליפ',
  'library.badge.aiGenerated': 'נוצר בבינה מלאכותית', 'library.badge.trademark': 'סימן מסחרי', 'library.badge.diskOnly': 'למחשב הזה בלבד',
  'library.publisherFigures': 'לפי המקור', 'library.noTempo': 'אין נתון קצב',
  // why a row cannot be used (LIBRARY_UNUSABLE)
  'library.unusable.licence_unknown': 'הרישיון לא מוכר לעורך', 'library.unusable.licence_share_alike': 'הרישיון מחייב לשתף את כל הסרטון באותו רישיון',
  'library.unusable.licence_no_derivatives': 'הרישיון אוסר לשנות את היצירה', 'library.unusable.credit_missing': 'הרישיון דורש קרדיט, ולפריט אין טקסט קרדיט',
  'library.unusable.credit_unresolved': 'אי אפשר להשלים את טקסט הקרדיט של הפריט', 'library.unusable.animated': 'מונפש — עוד לא נתמך',
  'library.unusable.needs_svg_rasteriser': 'דורש ממיר SVG, שאין במחשב הזה',
  // export and archive
  'library.export.nonCommercial': 'בסרטון יש חומר לשימוש לא מסחרי בלבד', 'library.export.creditsForDescription': 'יש קרדיטים שצריך להדביק בתיאור הסרטון',
  'library.export.creditNotOnScreen': 'קרדיט שחייב להופיע בסרטון לא מופיע בו', 'library.export.stockPeople': 'בסרטון יש צילומי מלאי שמופיעים בהם אנשים',
  'library.archive.strip': 'ארכיון לשיתוף', 'library.archive.keep': 'ארכיון לעצמי', 'library.archive.keepNote': 'למחשבים שלכם בלבד — כולל קבצים שאסור להעביר לאחרים',
  'library.archive.omittedNote': 'קבצים מהספרייה לא נכללו בארכיון, כי אסור להעביר אותם. אפשר להוסיף אותם מחדש מהספרייה במחשב שבו היא נמצאת',
} as const;
export const LIBRARY_EN: Record<keyof typeof LIBRARY_HE, string> = {
  'op.use_library_item': 'Added from the library', 'op.add_credits_card': 'Credits card',
  'error.code.library_not_built': 'The library is not built in this version yet', 'error.code.library_not_configured': 'The library is not set up',
  'error.code.library_root_invalid': 'This folder cannot be used as the library', 'error.code.library_item_missing': 'The item is not in the library',
  'error.code.library_item_unusable': 'This item cannot be used', 'error.code.library_hash_mismatch': 'The file in the library changed since it was downloaded',
  'error.code.library_changed_since_index': 'The file changed since the library was scanned', 'error.code.library_path_escape': 'The item points outside its own folder',
  'error.code.library_audio_unsupported': 'No preview for this kind of file', 'error.code.svg_unsafe': 'The SVG file did not pass the safety check',
  'error.code.archive_needs_library_choice': 'Choose which archive to make',
  'library.state.not_configured': 'The library is not set up', 'library.state.root_missing': 'The library folder was not found', 'library.state.ledger_missing': 'The folder holds no library ledger',
  'library.state.ledger_invalid': 'The library ledger is not valid', 'library.state.indexing': 'Scanning the library…', 'library.state.ready': 'The library is ready',
  'library.notVerified': 'Not verified since download', 'library.notRead': 'Not read', 'library.needsSvgRasteriser': 'Needs an SVG converter',
  'library.kind.music': 'Music', 'library.kind.sound': 'Sounds', 'library.kind.loop': 'Loops', 'library.kind.sticker': 'Stickers', 'library.kind.icon': 'Icons',
  'library.kind.illustration': 'Illustrations', 'library.kind.texture': 'Textures', 'library.kind.backdrop': 'Backdrops', 'library.kind.video': 'Video',
  'library.badge.nonCommercial': 'Non-commercial use only', 'library.badge.credit': 'Credit required', 'library.badge.people': 'People in the clip',
  'library.badge.aiGenerated': 'AI-generated', 'library.badge.trademark': 'Trademark', 'library.badge.diskOnly': 'This computer only',
  'library.publisherFigures': 'As stated by the source', 'library.noTempo': 'No tempo given',
  'library.unusable.licence_unknown': 'The editor does not know this licence', 'library.unusable.licence_share_alike': 'The licence would require sharing the whole video under the same licence',
  'library.unusable.licence_no_derivatives': 'The licence forbids changing the work', 'library.unusable.credit_missing': 'The licence requires a credit and the item has no credit text',
  'library.unusable.credit_unresolved': 'The item\'s credit text cannot be completed', 'library.unusable.animated': 'Animated — not supported yet',
  'library.unusable.needs_svg_rasteriser': 'Needs an SVG converter this computer does not have',
  'library.export.nonCommercial': 'The video holds material for non-commercial use only', 'library.export.creditsForDescription': 'Some credits must be pasted into the video description',
  'library.export.creditNotOnScreen': 'A credit that must appear in the video does not', 'library.export.stockPeople': 'The video holds stock footage that shows people',
  'library.archive.strip': 'Archive to share', 'library.archive.keep': 'Archive for yourself', 'library.archive.keepNote': 'For your own computers only — holds files that may not be passed on',
  'library.archive.omittedNote': 'Library files were left out of the archive because they may not be passed on. Add them again from the library on the computer that has it',
};

const ltr = (s: string) => `⁦${s}⁩`;
const ROOT_WHY: Record<string, string> = {
  'it is not an absolute path': 'זו לא כתובת מלאה של תיקייה',
  'it does not exist': 'התיקייה לא קיימת',
  'it holds no _manifests/ledger.json': 'אין בה יומן ספרייה (_manifests/ledger.json)',
  'it lies inside the data directory': 'היא נמצאת בתוך תיקיית הנתונים של העורך',
  'it lies inside the repository': 'היא נמצאת בתוך תיקיית התוכנה',
};
const UNUSABLE_HE: Record<string, string> = {
  licence_unknown: 'הרישיון שלו לא מוכר לעורך', licence_share_alike: 'הרישיון מחייב לשתף את כל הסרטון באותו רישיון', licence_no_derivatives: 'הרישיון אוסר לשנות את היצירה',
  credit_missing: 'הרישיון דורש קרדיט ולפריט אין טקסט קרדיט', credit_unresolved: 'אי אפשר להשלים את טקסט הקרדיט שלו', animated: 'הוא מונפש, ועוד אין תמיכה בזה', needs_svg_rasteriser: 'הוא דורש ממיר SVG שאין במחשב הזה',
};
/**
 * Hebrew of the library refusals, by shape: the operations (core libraryOps.ts LIBRARY_REFUSALS, in its order) and the routes
 * (apps/server/src/library/contract.ts LIBRARY_SERVER_REFUSALS, in its order). Each sentence says what to do next.
 */
export const HE_LIBRARY: [RegExp, (m: RegExpExecArray) => string][] = [
  // LIBRARY_REFUSALS
  [/^(\w+) is not built in this build yet$/, () => 'הפעולה הזו עוד לא נבנתה בגרסה הזו. אפשר לעדכן את התוכנה ולנסות שוב'],
  [/^this file has no library record$/, () => 'לקובץ אין רישום ספרייה. מוסיפים פריטים מהספרייה בכפתור «שימוש בפרויקט»'],
  [/^the licence of this library item is not one the editor knows, so it cannot be used$/, () => 'הרישיון של הפריט לא מוכר לעורך, ולכן אי אפשר להשתמש בו. אפשר לבחור פריט אחר'],
  [/^this licence forbids changing the work, and putting it in a video changes it$/, () => 'הרישיון אוסר לשנות את היצירה, ושילוב בסרטון הוא שינוי. אפשר לבחור פריט אחר'],
  [/^this licence would require sharing the whole video under the same licence$/, () => 'הרישיון מחייב לשתף את כל הסרטון באותו רישיון. אפשר לבחור פריט אחר'],
  [/^the licence of this library item requires a credit, and the item has no credit text$/, () => 'הרישיון דורש קרדיט, ולפריט אין טקסט קרדיט — אי אפשר להשתמש בו. אפשר לבחור פריט אחר'],
  [/^the library record is weaker than its licence: it must be marked (.+)$/, (m) => `הרישום של הקובץ מקל יותר מהרישיון עצמו (חסר בו הסימון ${ltr(m[1]!)}). מוסיפים את הפריט מחדש מהספרייה, והעורך כותב את הרישום`],
  [/^nothing in this sequence needs a credit$/, () => 'אין בסרטון חומר מהספרייה שדורש קרדיט, ולכן אין מה לשים בכרטיס. קרדיטים משלכם אפשר להוסיף ככותרת רגילה'],
  [/^the credits are (\d+) characters long; one card holds at most (\d+)$/, (m) => `הקרדיטים ארוכים מדי לכרטיס אחד (${m[1]} תווים, ועד ${m[2]}). אפשר להעתיק אותם לתיאור הסרטון`],
  // LIBRARY_SERVER_REFUSALS
  [/^the content library is not built in this build yet$/, () => 'הספרייה עוד לא נבנתה בגרסה הזו. אפשר לעדכן את התוכנה ולנסות שוב'],
  [/^no library folder is set; the owner sets it in Settings$/, () => 'לא נבחרה תיקיית ספרייה. בוחרים אותה ב«הגדרות» ← «תיקיית הספרייה»'],
  [/^the library folder cannot be used: (.+)$/, (m) => `אי אפשר להשתמש בתיקייה הזו כספרייה: ${ROOT_WHY[m[1]!] ?? 'היא לא עברה בדיקה'}. אפשר לבחור את התיקייה שבה הורדו הקבצים (זו שיש בה _manifests)`],
  [/^this library item is not in the index$/, () => 'הפריט לא נמצא בספרייה, אולי כי היא השתנתה. אפשר לחפש אותו שוב או לסרוק את הספרייה מחדש'],
  [/^this library item cannot be used: (\w+)$/, (m) => `אי אפשר להשתמש בפריט הזה, כי ${UNUSABLE_HE[m[1]!] ?? 'הוא לא עבר בדיקה'}. אפשר לבחור פריט אחר`],
  [/^the file in the library changed since it was downloaded; nothing was copied$/, () => 'הקובץ בספרייה השתנה מאז ההורדה — לא הועתק דבר. אפשר להוריד אותו שוב בכלי ההורדה'],
  [/^the file changed since the library was indexed; nothing was copied$/, () => 'הקובץ השתנה מאז סריקת הספרייה — לא הועתק דבר. אפשר לסרוק את הספרייה מחדש, או לאמת אותה בכלי ההורדה'],
  [/^this library item points outside its own folder; nothing was read$/, () => 'הפריט מצביע אל מחוץ לתיקייה שלו, ולכן לא נקרא דבר. אפשר לבדוק את תיקיית הספרייה בכלי ההורדה'],
  [/^there is no preview for this kind of file$/, () => 'אין האזנה מקדימה לקובץ מסוג זה. אפשר להוסיף אותו לפרויקט ולהאזין שם'],
  [/^this SVG cannot be used safely: .+$/, () => 'קובץ ה־SVG הזה לא עבר את בדיקת הבטיחות, ולכן לא הומר. אפשר לבחור פריט אחר'],
  [/^this project holds (\d+) library files that may not be passed on; choose library=strip \(to share\) or library=keep \(for yourself\)$/, (m) => `בפרויקט יש ${m[1]} קבצים מהספרייה שאסור להעביר לאחרים. בוחרים «ארכיון לשיתוף» (בלעדיהם) או «ארכיון לעצמי» (איתם, למחשבים שלך בלבד)`],
  [/^the library folder is set from the owner's own session$/, () => 'את תיקיית הספרייה בוחרים רק מהחלון של בעל הפרויקט. אפשר לבקש ממנו לבחור אותה ב«הגדרות»'],
];
