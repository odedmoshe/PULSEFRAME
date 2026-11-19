/**
 * Interface strings of the phone drop and the import queue (ADR-0023). Spread into `he` and `en` (index.ts); Hebrew first, and
 * the English dictionary covers the same keys.
 * Here: the activity list's name for a phone upload (`actor.phone`, core importView.ts actorKind), the headlines of the error
 * codes the import and drop routes answer with and the import jobs fail with (`error.code.*`: core IMPORT_API_ERROR_CODES and
 * IMPORT_ERROR_CODES; phoneDrop.test.ts keeps them complete), and the labels of two palette commands (`cmd.*`).
 * The dialog's and the cards' own strings live next to them (apps/web/src/editor/phoneDrop.strings.ts, imports.strings.ts);
 * the phone page carries its own (it has no build step).
 */
export const PHONE_DROP_HE = {
  'actor.phone': 'העלאה מהטלפון',
  'error.code.upload_incomplete': 'הקובץ לא הגיע בשלמותו', 'error.code.invalid_filename': 'שם הקובץ לא נקרא כראוי',
  'error.code.disk_full': 'אין מספיק מקום פנוי בדיסק', 'error.code.original_gone': 'הקובץ המקורי כבר נמחק מהמחשב',
  'error.code.conform_failed': 'לא הצלחנו להמיר את הקובץ לעריכה', 'error.code.project_gone': 'הפרויקט כבר לא קיים',
  'error.code.unsupported_media': 'הקובץ אינו סרטון, צליל או תמונה שאפשר לקרוא', 'error.code.canceled': 'הייבוא בוטל',
  'error.code.internal_error': 'תקלה במחשב; אפשר לנסות שוב',
  'error.code.not_your_job': 'סוכן יכול לטפל רק בעבודות שהוא התחיל', 'error.code.not_an_import': 'זו אינה עבודת ייבוא',
  'error.code.import_not_finished': 'הייבוא עדיין פעיל', 'error.code.no_private_network': 'המחשב אינו מחובר לרשת ביתית',
  'error.code.invalid_address': 'הכתובת שנבחרה אינה כתובת של המחשב ברשת הביתית', 'error.code.drop_listen_failed': 'לא הצלחנו לפתוח את הפתח לטלפון',
  'error.code.drop_not_found': 'אין קוד פתוח לטלפון',
  'error.code.shutting_down': 'השרת נסגר כרגע; אפשר לנסות שוב כשהוא יחזור',
  // command palette (apps/web/src/editor/commands.ts; the lead adds the commands at the mount step, their labels are these keys)
  'cmd.importFolder': 'ייבוא תיקייה', 'cmd.phoneDrop': 'ייבוא מהטלפון',
} as const;
export const PHONE_DROP_EN: Record<keyof typeof PHONE_DROP_HE, string> = {
  'actor.phone': 'Upload from a phone',
  'error.code.upload_incomplete': 'The file did not arrive complete', 'error.code.invalid_filename': 'The file name could not be read',
  'error.code.disk_full': 'Not enough free disk space', 'error.code.original_gone': 'The original file was already removed from this computer',
  'error.code.conform_failed': 'The file could not be converted for editing', 'error.code.project_gone': 'The project no longer exists',
  'error.code.unsupported_media': 'The file is not a video, sound or picture that can be read', 'error.code.canceled': 'The import was canceled',
  'error.code.internal_error': 'A fault on this computer; you can try again',
  'error.code.not_your_job': 'An agent can only handle jobs it started', 'error.code.not_an_import': 'This is not an import job',
  'error.code.import_not_finished': 'The import is still running', 'error.code.no_private_network': 'This computer is not connected to a home network',
  'error.code.invalid_address': 'The chosen address is not one of this computer\'s home-network addresses', 'error.code.drop_listen_failed': 'The door for the phone could not be opened',
  'error.code.drop_not_found': 'No code for a phone is open',
  'error.code.shutting_down': 'The server is shutting down; try again once it is back',
  'cmd.importFolder': 'Import a folder', 'cmd.phoneDrop': 'Import from a phone',
};

/**
 * Hebrew detail of the import queue's refusals that have their own sentence (apps/server/src/importQueue.ts), added to
 * translateRefusal (refusals.ts). packages/evals/src/wave5-wording.test.ts provokes each.
 */
export const HE_IMPORT_QUEUE: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^the server is stopping; send the file again once it is back$/, () => 'השרת נסגר כרגע, והקובץ לא נשמר. אפשר לשלוח אותו שוב כשהשרת יחזור'],
  [/^the server is stopping; retry once it is back$/, () => 'השרת נסגר כרגע. אפשר לנסות שוב כשהשרת יחזור'],
  [/^the server (?:is stopping|stopped); the import continues after it restarts$/, () => 'השרת נסגר. הקובץ כבר נשמר, והייבוא שלו ימשיך כשהשרת יעלה שוב'],
];
