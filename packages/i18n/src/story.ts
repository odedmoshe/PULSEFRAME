/**
 * Strings of «ספרו מה היה» (wave 7 story track; .artifacts/wave7/story-decisions.md). Spread into `he` and `en` (index.ts); Hebrew
 * first, the English dictionary covers the same keys. Namespaces: `story.*` (fixed lines every surface shares: the recipe's name,
 * the draft label, the level-measurement note, the speech-recognition row), `cmd.openStory`, `error.code.*` of the story routes.
 * The dialog's, tap view's and bar's own strings are apps/web/src/editor/story/story.strings.ts (W3).
 * Also here: HE_STORY, the Hebrew of every refusal of the planner (core storyContract.ts STORY_REFUSALS, STORY_BLOCKING_TEXT) and of
 * the server (apps/server/src/story.ts STORY_API_ERRORS), each with the next step; packages/evals/src/story-wording.test.ts keeps
 * them in step. No string says synced, perfect, best, score or calls the story AI: it is a heuristic draft from the owner's taps.
 * No new op: the story is applied through the internal apply_template, whose activity wording already exists.
 */
export const STORY_HE = {
  'story.name': 'ספרו מה היה',
  'story.draft': 'טיוטה שנבנתה מההקשות וממדידות (היוריסטיקה), לא בינה מלאכותית',
  'story.voiceMeasure': 'מדידת עוצמה, לא זיהוי דיבור',
  'story.transcriptRow': 'תמלול: לא מותקן — הסרט נבנה בלי תמלול',
  'story.notBuilt': 'יצירת סיפור עדיין לא נבנתה בגרסה הזו',
  'story.voiceTrack': 'קריינות',
  'cmd.openStory': 'ספרו מה היה',
  'error.code.story_not_built': 'יצירת סיפור עדיין לא נבנתה', 'error.code.story_blocked': 'הסיפור אינו יכול להיווצר כך',
  'error.code.story_retap_not_built': 'הקשה מחדש על סיפור שכבר נבנה עוד לא קיימת',
} as const;
export const STORY_EN: Record<keyof typeof STORY_HE, string> = {
  'story.name': 'Tell what happened',
  'story.draft': 'A draft built from your taps and measurements (heuristic), not an AI model',
  'story.voiceMeasure': 'A level measurement, not speech recognition',
  'story.transcriptRow': 'Transcription: not installed — the film is built without it',
  'story.notBuilt': 'Telling a story is not built in this version yet',
  'story.voiceTrack': 'Narration',
  'cmd.openStory': 'Tell what happened',
  'error.code.story_not_built': 'Telling a story is not built yet', 'error.code.story_blocked': 'The story cannot be made like this',
  'error.code.story_retap_not_built': 'Tapping again on a story that was already made is not available yet',
};

type Say = [RegExp, (m: RegExpExecArray) => string][];
/** The Hebrew of every story refusal, each with the next step. */
export const HE_STORY: Say = [
  // core STORY_REFUSALS
  [/^the narration file is not in this project$/, () => 'קובץ הקריינות לא נמצא בפרויקט. בחרו קובץ קול מהספרייה או הקליטו מחדש'],
  [/^the narration must be a sound file$/, () => 'הקריינות צריכה להיות קובץ קול. בחרו הקלטה או קובץ קול'],
  [/^the narration is longer than 20 minutes$/, () => 'הקריינות ארוכה מ־20 דקות. קצרו אותה או ספרו את הסיפור בשני חלקים'],
  [/^none of the chosen files can be shown$/, () => 'אף אחד מהקבצים שנבחרו לא יכול להופיע. בחרו תמונות או סרטונים'],
  [/^the story parameters are not valid: (.+)$/, () => 'הפרטים של הסיפור אינם בצורה הנכונה. פתחו את החלון מחדש ונסו שוב'],
  // core STORY_REFUSALS.notBuilt and the server's notBuilt (one sentence)
  [/^telling a story is not built in this version yet$/, () => 'יצירת סיפור עדיין לא נבנתה בגרסה הזו. שום דבר לא השתנה; הסרט המשפחתי, המתכונים והתבניות עובדים כרגיל'],
  // core STORY_BLOCKING_TEXT
  [/^the narration was deleted by hand; restore it to build again$/, () => 'הקריינות נמחקה ביד; החזירו אותה (ביטול) כדי לבנות מחדש'],
  [/^the narration kept by hand plays backwards or at another speed, so the pictures cannot follow it$/, () => 'הקריינות שנערכה ביד מתנגנת לאחור או במהירות אחרת, והתמונות לא יכולות לעקוב אחריה. החזירו אותה למהירות רגילה'],
  // server STORY_API_ERRORS
  [/^this credential may only propose edits, and a story cannot be proposed: it is applied through an internal step that a proposal does not carry$/, () => 'ההרשאה הזו מאפשרת רק להציע עריכות, ואת הסיפור אי אפשר להציע: הוא נוצר בצעד פנימי שהצעה אינה נושאת. אפשר לבקש מבעל/ת הפרויקט ליצור אותו'],
  [/^this credential may not make a story whose title shows an age: an age is computed from a birth date$/, () => 'ההרשאה הזו אינה מאפשרת סיפור שהכותרת שלו מציגה גיל, כי גיל מחושב מתאריך לידה. אפשר להשמיט את שדה הגיל (שם מותר), או לבקש מבעל/ת הפרויקט'],
  [/^the story cannot be made like this: (.+)$/, () => 'הסיפור אינו יכול להיווצר כך. ראו בתוכנית: החזירו את הקריינות או בחרו תמונות אחרות'],
  [/^story run \S+ not found$/, () => 'הסיפור הזה כבר אינו בפרויקט. אפשר ליצור סיפור חדש'],
  [/^params must be an object of story parameters to change$/, () => 'השינויים לסיפור אינם בצורה הנכונה. פתחו את החלון מחדש ונסו שוב'],
  [/^the story plan gave a new slot the key \S+, which a clip kept by hand holds$/, () => 'תקלה בגרסה הזו: התוכנית החדשה התנגשה בקליפ שנערך ידנית. שום דבר לא השתנה'],
  [/^tapping again on a story that was already made is not in this version$/, () => 'הקשה מחדש על סיפור שכבר נבנה עוד לא קיימת בגרסה הזו. בטלו את הסיפור (Ctrl+Z) והקישו שוב, או בנו מחדש עם אותן הקשות'],
];
