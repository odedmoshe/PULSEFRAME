/**
 * Strings of the server mode «מצב פתוח / מצב מוגן» (autonomy track, Part 1; apps/server/src/autonomy.ts). Spread into `he` and
 * `en` (index.ts) and returned by GET /api/v1/autonomy so a page or an agent reads the same words. Hebrew first, plural address,
 * no gendered forms. Nothing here asks the owner for anything: open mode does the thing and says what it did.
 */
export const AUTONOMY_HE = {
  'autonomy.title': 'גישה ובטיחות',
  'autonomy.mode.open': 'מצב פתוח',
  'autonomy.mode.guarded': 'מצב מוגן',
  'autonomy.open.line': 'מצב פתוח · סוכנים עורכים ישירות',
  'autonomy.open.means': 'סוכן עם מפתח עריכה עושה כל מה שחלון העורך שלכם עושה: עורך, רואה את כל הפרויקט (גם תאריכי לידה ותמלולים), מייצא, שומר תמונות, מוריד מודלים ומתקין את מנוע הדיבור. כל עריכה נשמרת כצעד שאפשר לבטל.',
  'autonomy.guarded.line': 'מצב מוגן · סוכנים פועלים בתוך ההרשאות שנתתם',
  'autonomy.guarded.means': 'סוכנים רואים שמות בלבד, וחלק מהפעולות (הורדות, ייצוא תמונה בגודל מלא, גרסאות שמורות ועוד) נשארות לחלון העורך שלכם.',
  'autonomy.keeps': 'בשני המצבים: רק אתם יוצרים מפתחות לסוכנים, מחליפים מצב, מגדירים מפתח של ספק ופותחים קוד לטלפון. דף אינטרנט או מכשיר אחר לא יכולים להפעיל את העורך.',
  'autonomy.source.env': 'נקבע בהפעלה (PF_MODE)',
  'autonomy.source.stored': 'נקבע בהגדרות',
  'autonomy.source.default': 'ברירת המחדל',
  'autonomy.switched': 'המצב שונה. סוכנים שמחוברים יתחברו מחדש במצב החדש',
  'autonomy.budget.none': 'ללא תקרת הוצאה לסוכנים',
  'error.code.owner_required.autonomy': 'רק אתם מחליפים מצב, מחלון העורך במחשב הזה. אפשר לעשות את זה בהגדרות › גישה',
} as const;

export const AUTONOMY_EN: Record<keyof typeof AUTONOMY_HE, string> = {
  'autonomy.title': 'Access and safety',
  'autonomy.mode.open': 'Open mode',
  'autonomy.mode.guarded': 'Guarded mode',
  'autonomy.open.line': 'Open mode · agents edit directly',
  'autonomy.open.means': 'An agent with an editing key does everything your editor window does: edits, reads the whole project (birth dates and transcripts too), exports, saves stills, downloads models and installs the speech engine. Every edit is a step you can undo.',
  'autonomy.guarded.line': 'Guarded mode · agents act within the grants you gave',
  'autonomy.guarded.means': 'Agents read names only, and some actions (downloads, full-size stills, saved versions and more) stay in your own editor window.',
  'autonomy.keeps': 'In both modes only you create agent keys, switch the mode, set a provider key and open a phone code. A web page or another device cannot drive the editor.',
  'autonomy.source.env': 'Set at start-up (PF_MODE)',
  'autonomy.source.stored': 'Set in Settings',
  'autonomy.source.default': 'The default',
  'autonomy.switched': 'The mode changed. Connected agents reconnect under the new mode',
  'autonomy.budget.none': 'No spending ceiling for agents',
  'error.code.owner_required.autonomy': 'Only you switch the mode, from the editor window on this computer. Do it in Settings › Access',
};
