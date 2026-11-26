/**
 * Drawn clips (wave 8 carrier, core drawn.ts): the words of the carrier itself. Each drawn kind (ink, map) brings its own name
 * through its core registration (DrawnKindDef.name) and its own strings in its own file. Hebrew addresses the owner in the plural.
 * HE_DRAWN words the carrier's refusals in Hebrew (refusals.ts translateRefusal), each with the next step.
 */
export const DRAWN_HE = {
  'error.code.drawn_not_text': 'זה ציור, לא כותרת',
  'error.code.drawn_track': 'ציור נמצא רק ברצועת כותרות',
} as const;
export const DRAWN_EN: Record<keyof typeof DRAWN_HE, string> = {
  'error.code.drawn_not_text': 'This is a drawing, not a title',
  'error.code.drawn_track': 'A drawing goes on a titles track only',
};
export const HE_DRAWN: [RegExp, (m: RegExpExecArray) => string][] = [
  // core DRAWN_NOT_TEXT (every text operation aimed at a drawn clip); the kind's English name is not repeated in Hebrew
  [/^clip is a (.+), not a title: it has no words or text style to change$/, () => 'הקליפ הזה הוא ציור ולא כותרת: אין בו מילים או סגנון טקסט לשנות. כדי לשנות מילים בחרו כותרת; את הציור משנים בחלונית שלו'],
  // core placeDrawnClip
  [/^a drawing cannot go on (\w+) track$/, () => 'אפשר לשים ציור רק ברצועת כותרות. בחרו רצועת כותרות, או השאירו את הבחירה למערכת'],
  [/^drawn payload refused: (.+)$/, (m) => `נתוני הציור לא התקבלו: ${m[1]}`],
  // validate.ts drawn_track (inside "transaction would produce an invalid project: …")
  [/^transaction would produce an invalid project: drawn clip \S+ on (\w+) track: a drawing goes on a titles track$/, () => 'ציור יכול להיות רק ברצועת כותרות. העבירו אותו לרצועת כותרות'],
];
