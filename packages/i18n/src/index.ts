/** Bilingual UI strings (SPEC §3, §29). Hebrew is the default. Keys are stable ids. */
export type Lang = 'he' | 'en';
export const he = {
  'app.loading': 'טוען…', 'lang.toggle': 'EN', 'lang.label': 'שפת ממשק',
  'save.saved': 'נשמר', 'save.saving': 'שומר…', 'save.offline': 'לא מקוון', 'save.conflict': 'התנגשות — נטען מחדש',
  'revision': 'גרסה', 'export': 'ייצוא', 'export.running': 'מייצא…', 'export.done': 'הורדת הסרטון', 'export.failed': 'הייצוא נכשל',
  'media': 'מדיה', 'media.import': 'ייבוא קובץ', 'media.uploading': 'מעלה…', 'media.empty': 'אין עדיין מדיה. ייבאו קובץ וידאו או אודיו.', 'media.add': 'הוספה לציר הזמן', 'media.unsupported': 'הקובץ אינו נתמך',
  'text': 'טקסט', 'text.add': 'הוספת טקסט', 'text.default': 'טקסט חדש', 'text.content': 'תוכן', 'text.size': 'גודל', 'text.y': 'מיקום אנכי',
  'inspector': 'מאפיינים', 'inspector.none': 'בחרו קליפ בציר הזמן', 'clip.start': 'התחלה', 'clip.duration': 'משך',
  'split': 'פיצול', 'delete': 'מחיקה', 'trim.start': 'חיתוך התחלה לסמן', 'trim.end': 'חיתוך סוף לסמן',
  'play': 'ניגון', 'pause': 'השהיה', 'frame.prev': 'פריים קודם', 'frame.next': 'פריים הבא', 'preview': 'תצוגה מקדימה',
  'timeline': 'ציר זמן', 'activity': 'פעילות', 'activity.empty': 'אין פעילות עדיין', 'actor.user': 'את/ה', 'actor.agent': 'סוכן',
  'error.generic': 'הפעולה נכשלה', 'track.video': 'וידאו', 'track.audio': 'אודיו', 'track.text': 'טקסט',
  'phase0.badge': 'שלב 0 — הוכחת היתכנות',
  'undo': 'ביטול', 'redo': 'ביצוע מחדש', 'undo.conflict': 'לא ניתן לבטל: הפריטים שונו מאז',
  'providers': 'ספקי AI (אופציונלי)', 'providers.notConfigured': 'ComfyUI לא מוגדר. העורך פועל במלואו גם בלעדיו.', 'providers.unreachable': 'ComfyUI מוגדר אך אינו זמין', 'providers.ready': 'ComfyUI מחובר', 'providers.smoke': 'בדיקת חיבור (ללא מודלים)', 'providers.running': 'מריץ…', 'providers.ok': 'הפלט אומת', 'providers.failed': 'הבדיקה נכשלה',
};
export const en: Record<keyof typeof he, string> = {
  'app.loading': 'Loading…', 'lang.toggle': 'עברית', 'lang.label': 'Interface language',
  'save.saved': 'Saved', 'save.saving': 'Saving…', 'save.offline': 'Offline', 'save.conflict': 'Conflict — reloaded',
  'revision': 'Revision', 'export': 'Export', 'export.running': 'Exporting…', 'export.done': 'Download video', 'export.failed': 'Export failed',
  'media': 'Media', 'media.import': 'Import file', 'media.uploading': 'Uploading…', 'media.empty': 'No media yet. Import a video or audio file.', 'media.add': 'Add to timeline', 'media.unsupported': 'Unsupported file',
  'text': 'Text', 'text.add': 'Add text', 'text.default': 'New text', 'text.content': 'Content', 'text.size': 'Size', 'text.y': 'Vertical position',
  'inspector': 'Inspector', 'inspector.none': 'Select a clip on the timeline', 'clip.start': 'Start', 'clip.duration': 'Duration',
  'split': 'Split', 'delete': 'Delete', 'trim.start': 'Trim start to playhead', 'trim.end': 'Trim end to playhead',
  'play': 'Play', 'pause': 'Pause', 'frame.prev': 'Previous frame', 'frame.next': 'Next frame', 'preview': 'Preview',
  'timeline': 'Timeline', 'activity': 'Activity', 'activity.empty': 'No activity yet', 'actor.user': 'You', 'actor.agent': 'Agent',
  'error.generic': 'The action failed', 'track.video': 'Video', 'track.audio': 'Audio', 'track.text': 'Text',
  'phase0.badge': 'Phase 0 — feasibility proof',
  'undo': 'Undo', 'redo': 'Redo', 'undo.conflict': 'Cannot undo: those items were changed since',
  'providers': 'AI providers (optional)', 'providers.notConfigured': 'ComfyUI is not configured. The editor works fully without it.', 'providers.unreachable': 'ComfyUI is configured but unreachable', 'providers.ready': 'ComfyUI connected', 'providers.smoke': 'Connection test (model-free)', 'providers.running': 'Running…', 'providers.ok': 'Output validated', 'providers.failed': 'Test failed',
};
export type Key = keyof typeof he;
export const dictionaries = { he, en };
export const createT = (lang: Lang) => (key: Key) => dictionaries[lang][key];
export const dirOf = (lang: Lang) => (lang === 'he' ? 'rtl' : 'ltr');
