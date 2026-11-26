/**
 * Strings of «תמונה חיה» — a still photo that moves slowly in depth (wave 8 living track; core livingContract.ts). Spread into `he`
 * and `en` (index.ts); Hebrew first, plural address, no gendered forms; the English dictionary covers the same keys. The depth is
 * the owner's own drawing and nobody has looked at the result: the block says so (living.drawnNote, living.unseen). The two limits
 * are rules of thumb, never "safe" or "comfortable" (living.ruleOfThumb). packages/evals/src/living-wording.test.ts keeps it in step.
 * Namespaces: `op.*`, `cmd.*`, `living.*` (the inspector block, W3), `depth.*` (the depth dialog, W3), `living.preflight.*` (W1).
 * Also here: HE_LIVING, the Hebrew of every refusal of the two operations (core LIVING_REFUSALS) and of add_effect / update_effect /
 * adjustment / replace_clip_media on a living picture, each with the next step.
 */
export const LIVING_HE = {
  'op.set_living_picture': 'תמונה חיה', 'op.set_clip_depth': 'ציור עומק',
  // the inspector block («תנועה» tab)
  'living.title': 'תמונה חיה', 'living.apply': 'הפכו לתמונה חיה', 'living.remove': 'הסירו תמונה חיה',
  'living.move': 'תנועה', 'living.move.push': 'התקרבות', 'living.move.slide': 'גלישה הצידה',
  'living.amount': 'עוצמה', 'living.amountCapped': 'העוצמה הוגבלה ל־{max} כי הקליפ קצר',
  'living.ruleOfThumb': 'המגבלה היא כלל אצבע: עד 3% מגובה התמונה, ולא יותר מ־2% בשנייה. זו לא בדיקה רפואית',
  'living.depth.estimated': 'עוד לא צויר עומק', 'living.depth.drawn': 'עומק מצויר · {n} משיכות', 'living.depth.open': 'ציירו עומק',
  'living.drawnNote': 'העומק הוא הציור שלכם, לא חישוב. אף אחד עוד לא הסתכל על התוצאה',
  'living.unseen': 'עוד לא נבדק בעין', 'living.gpu': 'דורש כרטיס מסך',
  'living.replaced': 'התנועה הקודמת הוחלפה בתמונה חיה',
  'living.refit': 'התנועה נגמרת לפני סוף הקליפ — התאימו לאורך',
  'living.removeKeepsDepth': 'הסרת התמונה החיה משאירה את העומק שציירתם',
  'living.notOffered.video': 'תמונה חיה עובדת על תמונות בלבד, לא על וידאו', 'living.notOffered.rotated': 'תמונה חיה עובדת על תמונה שאינה מסובבת',
  'living.unavailable.no_depth': 'לתמונה החיה אין עומק מצויר, ולכן היא לא מוצגת. ציירו עומק',
  'living.unavailable.rotated': 'התמונה מסובבת, ולכן התמונה החיה לא מוצגת. החזירו את הסיבוב ל־0',
  'living.unavailable.no_provider': 'אין כרטיס מסך זמין, ולכן התמונה החיה לא מוצגת. פתחו את העורך בדפדפן שתומך ב־WebGPU',
  'living.unavailable.depth_failed': 'לא הצלחנו להכין את העומק שצויר, ולכן התמונה החיה לא מוצגת. ציירו את העומק שוב («ציירו עומק»)',
  'living.pasteLeftOut': 'התמונה החיה לא הועתקה: היא נעשית בלשונית התנועה',
  'living.refused': 'לא נשמר', 'living.amountValue': 'עוצמה {n}', 'living.moveGroup': 'סוג התנועה',
  // the gated line of the picture-model runtime (another track): a string and a mount point that reads nothing yet
  'living.compute': 'חישוב עומק', 'living.compute.notReady': 'חישוב עומק: עוד לא זמין בגרסה הזו',
  // the depth dialog
  'depth.title': 'ציור עומק', 'depth.horizon': 'קו אופק', 'depth.near': 'קרוב', 'depth.far': 'רחוק', 'depth.brushSize': 'גודל מכחול',
  'depth.undoStroke': 'בטלו משיכה אחרונה', 'depth.clear': 'מחקו את כל המשיכות', 'depth.flat': 'בלי קו אופק (הכול רחוק)',
  'depth.save': 'שמירה', 'depth.cancel': 'ביטול',
  'depth.legend': 'בהיר = קרוב, כהה = רחוק', 'depth.start': 'התחלנו מקו אופק משוער. גררו אותו, וצבעו את מה שקרוב',
  'depth.pointerNote': 'כדי לצייר צריך עכבר או מגע; את קו האופק אפשר להזיז במקשי החצים',
  'depth.limit': 'הגעתם למספר המשיכות המרבי ({max}). בטלו משיכה כדי להוסיף אחרת',
  'depth.tools': 'כלים', 'depth.canvasLabel': 'התמונה עם העומק שצויר עליה', 'depth.horizonValue': 'קו אופק ב־{n} מתוך 1000 מהגובה',
  'depth.strokes': '{n} משיכות', 'depth.photoMissing': 'התמונה לא נטענה, אבל אפשר לראות את העומק ולשמור אותו',
  'depth.gridMissing': 'לא הצלחנו להציג את העומק שצויר, ולכן אי אפשר לשמור. בטלו את המשיכה האחרונה, או סגרו ופתחו שוב',
  'depth.keys': 'מקשים: 1 קרוב · 2 רחוק · Ctrl+Z מבטל משיכה',
  // preflight (apps/server/src/preflight.ts, W1)
  'living.preflight.tooFast': 'תמונה חיה: התנועה מהירה מכלל האצבע לאורך הקליפ. הנמיכו את העוצמה או האריכו את הקליפ',
  'living.preflight.noDepth': 'תמונה חיה בלי עומק מצויר: היא לא תוצג. ציירו עומק או הסירו את התמונה החיה',
  'living.preflight.rotated': 'תמונה חיה על תמונה מסובבת: היא לא תוצג. החזירו את הסיבוב ל־0',
  'cmd.livingOpen': 'תמונה חיה: פתיחת לשונית התנועה',
} as const;
export const LIVING_EN: Record<keyof typeof LIVING_HE, string> = {
  'op.set_living_picture': 'Living picture', 'op.set_clip_depth': 'Drew the depth',
  'living.title': 'Living picture', 'living.apply': 'Make it a living picture', 'living.remove': 'Remove the living picture',
  'living.move': 'Move', 'living.move.push': 'Push in', 'living.move.slide': 'Slide sideways',
  'living.amount': 'Amount', 'living.amountCapped': 'The amount is limited to {max} because the clip is short',
  'living.ruleOfThumb': 'The limit is a rule of thumb: at most 3% of the frame height, and no more than 2% a second. It is not a medical check',
  'living.depth.estimated': 'No depth drawn yet', 'living.depth.drawn': 'Drawn depth · {n} strokes', 'living.depth.open': 'Draw the depth',
  'living.drawnNote': 'The depth is your own drawing, not a calculation. Nobody has looked at the result yet',
  'living.unseen': 'Not looked at yet', 'living.gpu': 'Needs a graphics adapter',
  'living.replaced': 'The previous move was replaced by the living picture',
  'living.refit': 'The move ends before the clip does — fit it to the length',
  'living.removeKeepsDepth': 'Removing the living picture keeps the depth you drew',
  'living.notOffered.video': 'A living picture works on photos only, not on video', 'living.notOffered.rotated': 'A living picture works on a picture that is not rotated',
  'living.unavailable.no_depth': 'The living picture has no drawn depth, so it is not shown. Draw the depth',
  'living.unavailable.rotated': 'The picture is rotated, so the living picture is not shown. Set the rotation back to 0',
  'living.unavailable.no_provider': 'No graphics adapter is available, so the living picture is not shown. Open the editor in a browser that supports WebGPU',
  'living.unavailable.depth_failed': 'The drawn depth could not be made, so the living picture is not shown. Draw the depth again («Draw the depth»)',
  'living.pasteLeftOut': 'The living picture was not copied: it is made in the Motion tab',
  'living.refused': 'Not saved', 'living.amountValue': 'Amount {n}', 'living.moveGroup': 'Kind of move',
  'living.compute': 'Depth calculation', 'living.compute.notReady': 'Depth calculation: not available in this version yet',
  'depth.title': 'Draw the depth', 'depth.horizon': 'Horizon line', 'depth.near': 'Near', 'depth.far': 'Far', 'depth.brushSize': 'Brush size',
  'depth.undoStroke': 'Undo the last stroke', 'depth.clear': 'Clear all strokes', 'depth.flat': 'No horizon (everything far)',
  'depth.save': 'Save', 'depth.cancel': 'Cancel',
  'depth.legend': 'Light = near, dark = far', 'depth.start': 'We started from an estimated horizon. Drag it, and paint what is near',
  'depth.pointerNote': 'Painting needs a mouse or touch; the horizon line moves with the arrow keys',
  'depth.limit': 'You reached the most strokes ({max}). Undo a stroke to add another',
  'depth.tools': 'Tools', 'depth.canvasLabel': 'The photo with the drawn depth over it', 'depth.horizonValue': 'Horizon line at {n} of 1000 of the height',
  'depth.strokes': '{n} strokes', 'depth.photoMissing': 'The photo did not load, but the depth can be seen and saved',
  'depth.gridMissing': 'The drawn depth could not be shown, so it cannot be saved. Undo the last stroke, or close and open again',
  'depth.keys': 'Keys: 1 near · 2 far · Ctrl+Z undoes a stroke',
  'living.preflight.tooFast': 'Living picture: the move is faster than the rule of thumb for the clip\'s length. Lower the amount or lengthen the clip',
  'living.preflight.noDepth': 'Living picture without a drawn depth: it will not be shown. Draw the depth or remove the living picture',
  'living.preflight.rotated': 'Living picture on a rotated picture: it will not be shown. Set the rotation back to 0',
  'cmd.livingOpen': 'Living picture: open the Motion tab',
};

/** The Hebrew of the refusals (core LIVING_REFUSALS, validate.ts adjustmentRefusal), each with the next step. */
export const HE_LIVING: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^set_living_picture: the living picture is not built in this build yet$/, () => 'תמונה חיה עוד לא נבנתה בגרסה הזו של העורך. שום דבר לא השתנה; עדכנו את העורך ונסו שוב'],
  [/^a living picture works on photos only, not on video or titles$/, () => 'תמונה חיה עובדת על תמונות בלבד, לא על וידאו או כותרות. בחרו קליפ של תמונה ברצועת תמונה'],
  [/^the clip is shorter than one second, so the picture is not moved$/, () => 'הקליפ קצר משנייה, ולכן התמונה לא זזה. האריכו את הקליפ לשנייה לפחות'],
  [/^this clip is too short for that amount; the highest amount that fits it: ([\d.]+)$/, (m) => `הקליפ קצר מדי לתנועה בעוצמה הזאת. העוצמה הגבוהה שמתאימה לו: ⁦${m[1]}⁩. הנמיכו את העוצמה, בחרו «התקרבות» או האריכו את הקליפ`],
  [/^a living picture needs a depth drawn on the photo$/, () => 'לתמונה חיה צריך עומק מצויר על התמונה. ציירו עומק בלשונית התנועה («ציירו עומק»)'],
  [/^remove the living picture first, then its depth$/, () => 'קודם הסירו את התמונה החיה, ואז את העומק'],
  [/^a living picture is added with set_living_picture \(the Motion tab\), not with add_effect$/, () => 'מוסיפים תמונה חיה מלשונית התנועה: בחרו את התמונה, ואז «הפכו לתמונה חיה»'],
  [/^a living picture works on a picture that is not rotated$/, () => 'תמונה חיה עובדת על תמונה שאינה מסובבת. החזירו את הסיבוב ל־0 ונסו שוב'],
  [/^the painted depth is not valid: (.+)$/, () => 'העומק שצויר לא תקין. ציירו אותו שוב («ציירו עומק»)'],
  [/^the depth of this clip was drawn on its current photo$/, () => 'העומק של הקליפ צויר על התמונה הנוכחית שלו. הסירו קודם את התמונה החיה ואת העומק, או השאירו את התמונה'],
];
