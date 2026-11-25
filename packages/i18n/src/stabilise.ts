/**
 * Strings of stabilisation («ייצוב תמונה»; wave 7 stabilise track, .artifacts/wave7/stabilise-decisions.md). Spread into `he` and `en`
 * (index.ts); Hebrew first, the English dictionary covers the same keys. Vocabulary: a frame is «פריים», a multicam segment
 * «מקטע מולטיקאם», the crop «חיתוך שוליים», a detected cut «מעבר בין צילומים».
 * Namespaces: `op.*` (the three operations), `error.code.*` (apps/server/src/stabilise.ts STABILISE_SERVER_REFUSALS), `cmd.*`,
 * `stab.*` (the inspector block, the preflight lines and the read view; W3's stabilise.strings.ts reads them).
 * Also here: HE_STABILISE, the Hebrew of every refusal of the operations (core steadyContract.ts STEADY_REFUSALS) and of the routes,
 * each with the next step; packages/evals/src/stabilise-wording.test.ts keeps it in step.
 */
export const STABILISE_HE = {
  'op.attach_camera_motion': 'שמירת מדידת תנועת המצלמה', 'op.set_clip_stabilise': 'ייצוב תמונה', 'op.remove_camera_motion': 'הסרת מדידת תנועת המצלמה',
  'error.code.stabilise_not_built': 'ייצוב התמונה עוד לא נבנה בגרסה הזו', 'error.code.stabilise_in_progress': 'המדידה כבר רצה', 'error.code.clip_changed': 'הקליפ השתנה בזמן המדידה',
  'cmd.stabiliseToggle': 'ייצוב תמונה: הפעלה או כיבוי',
  // the inspector block
  'stab.title': 'ייצוב תמונה', 'stab.run': 'ייצבו את הקליפ', 'stab.stop': 'עצירה', 'stab.toggle': 'ייצוב פועל', 'stab.strength': 'עוצמה',
  'stab.crop': 'חיתוך שוליים: {percent}% מהתמונה (הגדלה ×{zoom})', 'stab.recalc': 'חשבו מחדש את חיתוך השוליים', 'stab.remove': 'הסרת המדידה',
  'stab.lowered': 'העוצמה הונמכה ל־{strength} כדי שחיתוך השוליים לא יעבור {maxCrop}%',
  'stab.notMeasured': '{n} פריימים לא נמדדו', 'stab.weak': '{n} פריימים נמדדו בביטחון נמוך — כדאי לבדוק', 'stab.cut': 'נמצא מעבר בין צילומים בפריים {frame}',
  'stab.limitedClip': 'הקליפ השתנה מאז חישוב חיתוך השוליים — בחלק מהפריימים הייצוב מוגבל', 'stab.limitedReach': 'בחלק מהפריימים שהאטה או מעבר מגיעים אליהם הייצוב מוגבל',
  'stab.edges': 'ליד תחילת הקובץ, סופו או מעבר בין צילומים הייצוב חלש יותר',
  'stab.noModel': 'בלי מודל: מתוקנות הזזה, סיבוב והתקרבות של המצלמה', 'stab.notCorrected': 'עיוות "ג׳לי" של חיישן הטלפון ושינויי פרספקטיבה אינם מתוקנים',
  'stab.synthetic': 'הייצוב נבדק על סרטונים מלאכותיים בלבד', 'stab.notOffered.still': 'תמונה סטטית אינה רועדת, ולכן אין מה לייצב', 'stab.notOffered.multicam': 'מקטע מולטיקאם מקבל את המראה שלו מהקבוצה; נתקו אותו כדי לייצב',
  'stab.speedHint': 'בקליפ מואץ התנודות האיטיות נראות מהר יותר; אפשר להעלות את העוצמה',
  // preflight (apps/server/src/preflight.ts, W2)
  'stab.preflight.unmeasured': 'ייצוב: פריימים בלי מדידה — מדדו שוב', 'stab.preflight.limited': 'ייצוב: פריימים שבהם הייצוב מוגבל כדי שלא ייראו שוליים ריקים',
  // states of a camera sample (core STEADY_STATES)
  'stab.state.ok': 'נמדד', 'stab.state.weak': 'נמדד בביטחון נמוך', 'stab.state.unknown': 'לא נמדד', 'stab.state.start': 'תחילת צילום', 'stab.state.outside': 'מחוץ למדידה',
} as const;
export const STABILISE_EN: Record<keyof typeof STABILISE_HE, string> = {
  'op.attach_camera_motion': 'Saved a camera motion measurement', 'op.set_clip_stabilise': 'Stabilisation', 'op.remove_camera_motion': 'Removed a camera motion measurement',
  'error.code.stabilise_not_built': 'Stabilisation is not built in this version yet', 'error.code.stabilise_in_progress': 'The measurement is already running', 'error.code.clip_changed': 'The clip changed while it was measured',
  'cmd.stabiliseToggle': 'Stabilisation: on or off',
  'stab.title': 'Stabilisation', 'stab.run': 'Stabilise the clip', 'stab.stop': 'Stop', 'stab.toggle': 'Stabilisation on', 'stab.strength': 'Strength',
  'stab.crop': 'Edge crop: {percent}% of the picture (zoom ×{zoom})', 'stab.recalc': 'Recalculate the edge crop', 'stab.remove': 'Remove the measurement',
  'stab.lowered': 'The strength was lowered to {strength} so the edge crop stays within {maxCrop}%',
  'stab.notMeasured': '{n} frames were not measured', 'stab.weak': '{n} frames were measured with low confidence — check them', 'stab.cut': 'A change of shot was found at frame {frame}',
  'stab.limitedClip': 'The clip changed since the edge crop was calculated — stabilisation is limited on some frames', 'stab.limitedReach': 'Stabilisation is limited on some frames a slow-down or a transition reaches',
  'stab.edges': 'Near the start or end of the file, or a change of shot, the stabilisation is weaker',
  'stab.noModel': 'No model: the camera\'s movement, rotation and zoom are corrected', 'stab.notCorrected': 'Phone-sensor "jelly" distortion and changes of perspective are not corrected',
  'stab.synthetic': 'Stabilisation was tested on synthetic videos only', 'stab.notOffered.still': 'A still picture does not shake, so there is nothing to stabilise', 'stab.notOffered.multicam': 'A multicam segment takes its look from its group; detach it to stabilise it',
  'stab.speedHint': 'On a sped-up clip slow sway looks faster; raise the strength',
  'stab.preflight.unmeasured': 'Stabilisation: frames without a measurement — measure again', 'stab.preflight.limited': 'Stabilisation: frames where it is limited so no empty edge shows',
  'stab.state.ok': 'measured', 'stab.state.weak': 'low confidence', 'stab.state.unknown': 'not measured', 'stab.state.start': 'start of a shot', 'stab.state.outside': 'outside the measurement',
};

/** The Hebrew of every stabilise refusal (STEADY_REFUSALS and STABILISE_SERVER_REFUSALS), each with the next step. */
export const HE_STABILISE: [RegExp, (m: RegExpExecArray) => string][] = [
  // core STEADY_REFUSALS (the shared-budget sentence is in refusals.ts HE_TRACKING, beside the motion-track caps)
  [/^(\w+): stabilisation is not built in this build yet$/, () => 'ייצוב התמונה עוד לא נבנה בגרסה הזו. אפשר לעדכן את התוכנה ולנסות שוב'],
  [/^only a video clip on a video track can be stabilised$/, () => 'אפשר לייצב רק קליפ וידאו במסלול וידאו. בחרו קליפ וידאו'],
  [/^a multicam segment cannot be stabilised yet$/, () => 'אי אפשר עדיין לייצב מקטע מולטיקאם. נתקו אותו מהקבוצה קודם'],
  [/^the camera motion has not been measured for the part of the file this clip shows$/, () => 'תנועת המצלמה עוד לא נמדדה בחלק שהקליפ מציג. לחצו «ייצבו את הקליפ» כדי למדוד'],
  [/^only (\d+)% of this clip's frames could be measured: the picture has too little detail or moves too fast$/, (m) => `נמדדו רק ${m[1]}% מהפריימים של הקליפ: אין מספיק פרטים בתמונה או שהתנועה מהירה מדי. אפשר לייצב קטע רגוע ומפורט יותר`],
  [/^this clip shows (\d+) frames with its margins; at most (\d+) can be measured at once$/, (m) => `הקליפ מציג ${m[1]} פריימים עם השוליים; אפשר למדוד עד ${m[2]} בבת אחת. פצלו את הקליפ וייצבו כל חלק`],
  [/^the measurements of this file would hold (\d+) frames; at most (\d+)$/, (m) => `המדידות של הקובץ הזה יחזיקו ${m[1]} פריימים; אפשר עד ${m[2]}. אפשר להסיר מדידות שאף קליפ מיוצב לא משתמש בהן`],
  [/^this file would have more than (\d+) separate measured stretches$/, (m) => `בקובץ היו יותר מ־${m[1]} קטעים מדודים נפרדים. אפשר להסיר מדידות שאף קליפ מיוצב לא משתמש בהן`],
  [/^(\d+) clip\(s\) are stabilised with this measurement$/, (m) => `${m[1]} קליפים מיוצבים בעזרת המדידה הזאת. אפשר לכבות גם אותם, או להסיר רק את מה שלא בשימוש`],
  [/^this clip is stabilised with a measurement of its current file; switch stabilisation off before giving it another file$/, () => 'הקליפ מיוצב לפי הקובץ הנוכחי שלו. כבו את הייצוב לפני החלפת הקובץ'],
  [/^this file has no camera measurement$/, () => 'לקובץ הזה אין מדידת תנועת מצלמה. אין מה להסיר'],
  [/^the file of this camera measurement is not in the library$/, () => 'הקובץ של המדידה הזאת אינו בספריית המדיה. אפשר למדוד שוב'],
  [/^only a moving picture has camera motion$/, () => 'רק לווידאו יש תנועת מצלמה. בחרו קובץ וידאו'],
  [/^the camera measurement is malformed: (.+)$/, (m) => `מדידת תנועת המצלמה פגומה: ${m[1] === 'the columns differ in length' ? 'העמודות באורכים שונים' : 'יש בה ערך מחוץ לטווח'}. אפשר למדוד שוב`],
  [/^the camera measurement ends at frame (\d+), but the file has (\d+) frames$/, (m) => `המדידה מסתיימת בפריים ${m[1]}, אבל בקובץ יש ${m[2]} פריימים. אפשר למדוד שוב`],
  [/^the first sample of a camera measurement must be a start sample$/, () => 'הדגימה הראשונה של מדידה חייבת לסמן התחלה. אפשר למדוד שוב'],
  // apps/server/src/stabilise.ts STABILISE_SERVER_REFUSALS
  [/^stabilisation of video clips is not built in this build yet$/, () => 'ייצוב התמונה עוד לא נבנה בגרסה הזו. אפשר לעדכן את התוכנה'],
  [/^the camera motion of this file is already being measured$/, () => 'תנועת המצלמה של הקובץ כבר נמדדת. אפשר לחכות לסיום או לעצור את המדידה'],
  [/^too many camera measurements and motion tracks are already running or waiting; try again shortly$/, () => 'יותר מדי מדידות ומסלולי מעקב כבר רצים או ממתינים. אפשר לנסות שוב בעוד חצי דקה'],
  [/^the clip changed while its camera motion was measured; nothing was saved$/, () => 'הקליפ השתנה בזמן המדידה; דבר לא נשמר. אפשר לייצב שוב'],
];
