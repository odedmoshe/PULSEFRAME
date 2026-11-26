/** Words of the projects dialog's storage section that the server reports in English (apps/server/src/storage.ts `rule`). */
export const PROJECTS_STRINGS = {
  he: {
    // the server's rule sentence, in Hebrew: a file counts as unused only when nothing mentions it and it is not new
    rule: 'קובץ נחשב בלתי בשימוש רק אם אף פרויקט שנשאר (כולל ההיסטוריה שלו), משימה או הצעה לא מפנים אליו, והוא ישן מעשר דקות. ייבוא שנכשל או בוטל מפסיק להיספר אחרי שסוגרים אותו או אחרי שבעה ימים.',
  },
  en: {
    rule: 'A file is unused only if no remaining project (including its history), job or proposal refers to it, and it is older than ten minutes. A failed or canceled import stops counting once it is dismissed or seven days old.',
  },
} as const;
