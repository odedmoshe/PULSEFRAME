/** Strings of the media library cards (kept here so the shared dictionaries stay untouched). */
export type MediaLang = 'he' | 'en';
export const MEDIA_STRINGS = {
  he: { inUse: 'בשימוש בציר הזמן', video: 'וידאו', sound: 'סאונד', image: 'תמונה', grid: 'קבצי מדיה', dropHere: 'גררו קבצים לכאן', notes: 'הערות על הקובץ', lut: 'טבלת צבע (LUT)', lutSize: 'מספר הערכים בכל ציר של הטבלה', lutInUse: 'בשימוש באפקט טבלת צבע', lutRemoveUsed: 'טבלת הצבע בשימוש באפקט של קליפ. הסירו קודם את האפקט או בחרו בו טבלה אחרת.', lutHint: 'טבלת צבע מוחלת על קליפ: לשונית מראה ← הוספת אפקט ← טבלת צבע (LUT)' },
  en: { inUse: 'Used on the timeline', video: 'Video', sound: 'Sound', image: 'Picture', grid: 'Media files', dropHere: 'Drop files here', notes: 'Notes about this file', lut: 'Colour table (LUT)', lutSize: 'Entries per axis of the table', lutInUse: 'Used by a colour table effect', lutRemoveUsed: 'This colour table is used by an effect on a clip. Remove that effect, or choose another table in it, first.', lutHint: 'A colour table is applied to a clip: Look tab → add effect → Colour table (LUT)' },
} as const;
