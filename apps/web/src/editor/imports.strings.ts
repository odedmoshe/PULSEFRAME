/**
 * Strings of the import cards and the folder import (ADR-0023), Hebrew first; the English set has the same keys (the type says
 * so). Placeholders in braces: {count}, {percent}, {name}. The conversion reasons reuse the dictionaries' notice.reason.* and
 * the failure headlines error.code.* (packages/i18n/src/phoneDrop.ts).
 * Lead pre-pass: the keys and the sentences of the plan (§7); W3 may add keys and refine the wording, keeping both complete.
 */
export type ImportsLang = 'he' | 'en';
const he = {
  section: 'בייבוא ({count})',
  waiting: 'ממתין', waitTurn: 'בתור: {count} לפניו', waitExport: 'ממתין לסיום הייצוא', waitCompute: 'ממתין לסיום עבודה אחרת', waitCheck: 'נבדק',
  converting: 'ממיר {percent}%', ready: 'מוכן', failed: 'נכשל', canceled: 'בוטל',
  uploading: 'בהעלאה {percent}%', pendingUpload: 'ממתין להעלאה', notUploaded: 'לא הועלה',
  retry: 'ניסיון חוזר', dismiss: 'הסרה', cancel: 'ביטול',
  fromPhone: 'מהטלפון', fromFolder: 'מתיקייה',
  skippedNotMedia: 'דילגנו על {count} קבצים שאינם מדיה', skippedTooMany: 'דילגנו על {count} קבצים: אפשר לייבא עד 500 בבת אחת',
  announceReady: '{name} מוכן לעריכה', announceFailed: 'הייבוא של {name} נכשל',
  stored: 'הקובץ נשמר במחשב; ההמרה לעריכה נמשכת ברקע',
} as const;
const en: Record<keyof typeof he, string> = {
  section: 'Importing ({count})',
  waiting: 'Waiting', waitTurn: 'In line: {count} ahead', waitExport: 'Waiting for the export to finish', waitCompute: 'Waiting for another job to finish', waitCheck: 'Being checked',
  converting: 'Converting {percent}%', ready: 'Ready', failed: 'Failed', canceled: 'Canceled',
  uploading: 'Uploading {percent}%', pendingUpload: 'Waiting to upload', notUploaded: 'Not uploaded',
  retry: 'Try again', dismiss: 'Remove', cancel: 'Cancel',
  fromPhone: 'From the phone', fromFolder: 'From a folder',
  skippedNotMedia: 'Skipped {count} files that are not media', skippedTooMany: 'Skipped {count} files: up to 500 can be imported at once',
  announceReady: '{name} is ready to edit', announceFailed: 'Importing {name} failed',
  stored: 'The file is stored on this computer; converting it for editing continues in the background',
};
export const IMPORTS_STRINGS: { he: typeof he; en: Record<keyof typeof he, string> } = { he, en };
