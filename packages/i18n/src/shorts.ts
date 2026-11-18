/**
 * Shared interface strings of shorts (ADR-0018, «קטעים קצרים»): the names of the sequence operations (`op.*`,
 * op-wording.test.ts), the error codes of the shorts routes, and the FIXED product wording the lead decided
 * (wave4-decisions.md): the score label «ציון יחסי בתוך הסרטון הזה (היוריסטיקה)», «לא אומת» for every unverified platform
 * field, the honest states (no transcript, no scene analysis, no tracking), the labels of the reason codes, score components
 * and warnings (core shortsContract.ts). Spread into `he` and `en` (index.ts); Hebrew first, and the English dictionary must
 * cover the same keys. Lines that carry numbers («צור 3 קטעים», «ציון יחסי 74», ranges) are formatted by the editor
 * (apps/web/src/editor/shorts.strings.ts, W3) with the numbers in <bdi dir="ltr">.
 * NO string here calls a moment "viral" or predicts views or retention (SPEC.md:624); packages/evals/src/shorts-wording.test.ts
 * forbids those words in every language.
 * Also here: the Hebrew wording of every refusal of the sequence operations and the shorts routes (HE_SHORTS; core
 * SEQUENCE_REFUSALS and SHORTS_REFUSALS), which refusals.ts adds to translateRefusal.
 */
export const SHORTS_HE = {
  // operation names (activity feed, history)
  'op.add_sequence': 'רצף חדש', 'op.update_sequence': 'עדכון רצף', 'op.remove_sequence': 'הסרת רצף',
  'op.replace_clip_keyframes': 'החלפת נקודות מפתח', 'op.apply_sequence_plan': 'יצירת קטעים קצרים',
  // the workspace and the sequence switcher
  'shorts.title': 'קטעים קצרים', 'sequence.switcher': 'רצפים בפרויקט', 'sequence.main': 'ראשי',
  'sequence.delete': 'מחיקת הקטע', 'sequence.delete.confirm': 'הקטע יימחק עם כל הקליפים והסמנים שבו. הסרט הראשי לא ישתנה. אפשר לבטל את הפעולה.',
  'shorts.variantProjectWide': 'פורמטים מקושרים חלים על כל הפרויקט',
  // the score (decided wording) and what it is
  'shorts.score.label': 'ציון יחסי בתוך הסרטון הזה (היוריסטיקה)',
  'shorts.score.method': 'הציון משווה רגעים בתוך הסרטון הזה בלבד, לפי מדידות של הקול, הקצב, המשפטים והחיתוכים. זו הערכה לפי כללים, לא תחזית של צפיות.',
  'shorts.rank': 'מקום', 'shorts.reasons': 'למה הרגע הזה', 'shorts.components': 'פירוט המדידות',
  // platform presets: every field null until a dated source is recorded
  'shorts.platform.unverified': 'לא אומת',
  // honest states
  'shorts.noTranscript': 'אין תמליל — הגבולות לפי הפסקות וסצנות', 'shorts.transcribe': 'תמלל',
  'shorts.noScenes': 'אין עדיין ניתוח חיתוכים לקובץ הזה', 'shorts.findCuts': 'מצא חיתוכים',
  'shorts.trackingUnavailable': 'אין מסלול מעקב לקובץ הזה; אפשר למרכז או להשתמש ברקע מטושטש',
  'shorts.notBuilt': 'החלק הזה של הקטעים הקצרים עוד לא נבנה בגרסה הזו',
  'shorts.upscaled': 'התמונה תוגדל מעבר לגודל המקור, ולכן עשויה להיראות רכה יותר',
  // reframe sources
  'reframe.auto': 'אוטומטי', 'reframe.track': 'לפי מסלול מעקב', 'reframe.centre': 'מרכז', 'reframe.backdrop': 'רקע מטושטש',
  // why a moment ranks where it does (core SHORT_REASON_CODES)
  'shorts.reason.complete_statements': 'משפטים שלמים', 'shorts.reason.ends_on_sentence': 'מסתיים בסוף משפט',
  'shorts.reason.starts_with_reference': 'מתחיל בהפניה למשהו שנאמר קודם', 'shorts.reason.context_added': 'נוסף הקשר מלפני',
  'shorts.reason.opens_with_question': 'נפתח בשאלה', 'shorts.reason.hook_word': 'מילה שמושכת תשומת לב בפתיחה',
  'shorts.reason.number_in_opening': 'מספר בפתיחה', 'shorts.reason.speaks_to_viewer': 'פונה אל הצופה',
  'shorts.reason.quick_start': 'הדיבור מתחיל מיד', 'shorts.reason.dead_air_start': 'שקט בהתחלה',
  'shorts.reason.louder_than_usual': 'חזק מהרגיל בסרטון הזה', 'shorts.reason.lively_dynamics': 'עוצמה משתנה וחיה',
  'shorts.reason.pace': 'קצב הדיבור', 'shorts.reason.fillers': 'מילות מילוי', 'shorts.reason.long_pauses': 'הפסקות ארוכות',
  'shorts.reason.reaction_burst_heuristic': 'פרץ קולות תגובה (הערכה)', 'shorts.reason.shot_changes': 'החלפות שוט',
  'shorts.reason.topic_word': 'מילת נושא שביקשת', 'shorts.reason.low_confidence_words': 'מילים שזוהו בביטחון נמוך',
  'shorts.reason.segment_timing': 'תזמון לפי משפט בלבד', 'shorts.reason.approximate_timing': 'תזמון משוער',
  'shorts.reason.no_transcript': 'אין תמליל', 'shorts.reason.missing_input': 'חסרה מדידה',
  // score components (core SCORE_COMPONENTS)
  'shorts.component.complete': 'שלמות', 'shorts.component.opening': 'פתיחה', 'shorts.component.voice': 'קול', 'shorts.component.pace': 'קצב',
  'shorts.component.moments': 'רגעים (הערכה)', 'shorts.component.picture': 'תמונה', 'shorts.component.clean': 'ניקיון',
  // candidate warnings (core CANDIDATE_WARNINGS)
  'shorts.warn.ends_mid_sentence': 'מסתיים באמצע משפט', 'shorts.warn.starts_with_reference': 'מתחיל בהפניה למשהו שנאמר קודם',
  'shorts.warn.approximate_timing': 'תזמון המילים משוער', 'shorts.warn.segment_timing': 'יש תזמון למשפטים בלבד',
  'shorts.warn.no_transcript': 'אין תמליל', 'shorts.warn.no_scene_cuts': 'אין ניתוח חיתוכים',
  'shorts.warn.overlaps_existing_short': 'חופף לקטע קצר שכבר קיים', 'shorts.warn.partial_analysis': 'נותחו רק ארבע השעות הראשונות של הקובץ',
  // plan warnings (core PLAN_WARNING_CODES)
  'shorts.plan.snapped_to_words': 'הגבולות הורחבו עד קצות המילים', 'shorts.plan.snapped_to_phrase': 'הגבולות הורחבו עד קצות המשפט (תזמון משוער)',
  'shorts.plan.removal_skipped_flash_gap': 'הסרה לא בוצעה, כדי ששני חיתוכים לא יהיו צפופים מדי', 'shorts.plan.removal_skipped_too_tight': 'הסרה לא בוצעה: אין מספיק מקום סביבה',
  'shorts.plan.no_scene_cuts': 'אין ניתוח חיתוכים, ולכן הקטע לא חולק לפי שוטים', 'shorts.plan.track_mostly_lost': 'המעקב אבד ברוב הקטע',
  'shorts.plan.upscaled': 'התמונה תוגדל מעבר לגודל המקור', 'shorts.plan.title_agent_text': 'את הכותרת כתב סוכן — כדאי לבדוק אותה',
  'shorts.plan.look_needs_word_timing': 'מראה הכתוביות שנבחר צריך תזמון מילים', 'shorts.plan.no_audio': 'אין קול בקטע',
  'shorts.plan.variant_over_sequence_format': 'פורמט מקושר מחליף את הפריים של הקטע',
  // error codes of the shorts routes (core SHORTS_ERROR_CODES)
  'error.code.needs_video': 'צריך קובץ עם תמונה', 'error.code.needs_measurement': 'צריך למדוד קודם את הקול של הקובץ',
  'error.code.not_verbatim': 'הציטוט אינו מילה במילה מהתמליל', 'error.code.off_word_boundary': 'הגבול אינו בקצה של מילה',
  'error.code.plan_too_large': 'התוכנית גדולה מדי לצעד אחד', 'error.code.tracking_not_available': 'אי אפשר לעקוב כאן אחרי מסלול מעקב',
  'error.code.not_built': 'החלק הזה עוד לא נבנה', 'error.code.undo_conflict': 'אי אפשר לבטל: פריטים השתנו אחר כך',
} as const;
export const SHORTS_EN: Record<keyof typeof SHORTS_HE, string> = {
  'op.add_sequence': 'Added a sequence', 'op.update_sequence': 'Updated a sequence', 'op.remove_sequence': 'Removed a sequence',
  'op.replace_clip_keyframes': 'Replaced keyframes', 'op.apply_sequence_plan': 'Made shorts',
  'shorts.title': 'Shorts', 'sequence.switcher': 'Sequences in the project', 'sequence.main': 'Main',
  'sequence.delete': 'Delete the short', 'sequence.delete.confirm': 'The short is deleted with all its clips and markers. The main edit does not change. You can undo this.',
  'shorts.variantProjectWide': 'Linked formats apply to the whole project',
  'shorts.score.label': 'Relative score within this video (heuristic)',
  'shorts.score.method': 'The score compares moments within this video only, by measurements of the voice, the pace, the sentences and the cuts. It is a rule-based estimate, not a forecast of views.',
  'shorts.rank': 'Rank', 'shorts.reasons': 'Why this moment', 'shorts.components': 'The measurements',
  'shorts.platform.unverified': 'Not verified',
  'shorts.noTranscript': 'No transcript — edges follow pauses and scenes', 'shorts.transcribe': 'Transcribe',
  'shorts.noScenes': 'This file has no scene analysis yet', 'shorts.findCuts': 'Find cuts',
  'shorts.trackingUnavailable': 'This file has no motion track; centre it or use the blurred backdrop',
  'shorts.notBuilt': 'This part of shorts is not built yet in this version',
  'shorts.upscaled': 'The picture is enlarged beyond its source size, so it may look softer',
  'reframe.auto': 'Automatic', 'reframe.track': 'Follow a motion track', 'reframe.centre': 'Centre', 'reframe.backdrop': 'Blurred backdrop',
  'shorts.reason.complete_statements': 'Complete statements', 'shorts.reason.ends_on_sentence': 'Ends at the end of a sentence',
  'shorts.reason.starts_with_reference': 'Starts by referring to something said earlier', 'shorts.reason.context_added': 'Earlier context added',
  'shorts.reason.opens_with_question': 'Opens with a question', 'shorts.reason.hook_word': 'An attention word in the opening',
  'shorts.reason.number_in_opening': 'A number in the opening', 'shorts.reason.speaks_to_viewer': 'Speaks to the viewer',
  'shorts.reason.quick_start': 'Speech starts at once', 'shorts.reason.dead_air_start': 'Silence at the start',
  'shorts.reason.louder_than_usual': 'Louder than usual in this video', 'shorts.reason.lively_dynamics': 'Lively changes of level',
  'shorts.reason.pace': 'Speaking pace', 'shorts.reason.fillers': 'Filler words', 'shorts.reason.long_pauses': 'Long pauses',
  'shorts.reason.reaction_burst_heuristic': 'Burst of reaction sounds (heuristic)', 'shorts.reason.shot_changes': 'Shot changes',
  'shorts.reason.topic_word': 'A topic word you asked for', 'shorts.reason.low_confidence_words': 'Words recognised with low confidence',
  'shorts.reason.segment_timing': 'Phrase timing only', 'shorts.reason.approximate_timing': 'Approximate timing',
  'shorts.reason.no_transcript': 'No transcript', 'shorts.reason.missing_input': 'A measurement is missing',
  'shorts.component.complete': 'Completeness', 'shorts.component.opening': 'Opening', 'shorts.component.voice': 'Voice', 'shorts.component.pace': 'Pace',
  'shorts.component.moments': 'Moments (heuristic)', 'shorts.component.picture': 'Picture', 'shorts.component.clean': 'Cleanness',
  'shorts.warn.ends_mid_sentence': 'Ends in the middle of a sentence', 'shorts.warn.starts_with_reference': 'Starts by referring to something said earlier',
  'shorts.warn.approximate_timing': 'The word timing is approximate', 'shorts.warn.segment_timing': 'Only the phrases are timed',
  'shorts.warn.no_transcript': 'No transcript', 'shorts.warn.no_scene_cuts': 'No scene analysis',
  'shorts.warn.overlaps_existing_short': 'Overlaps a short that already exists', 'shorts.warn.partial_analysis': 'Only the first four hours of the file were analysed',
  'shorts.plan.snapped_to_words': 'The edges were widened to the word edges', 'shorts.plan.snapped_to_phrase': 'The edges were widened to the phrase edges (approximate timing)',
  'shorts.plan.removal_skipped_flash_gap': 'A removal was skipped so that two cuts do not come too close', 'shorts.plan.removal_skipped_too_tight': 'A removal was skipped: not enough room around it',
  'shorts.plan.no_scene_cuts': 'No scene analysis, so the short was not divided by shots', 'shorts.plan.track_mostly_lost': 'The tracking was lost for most of the short',
  'shorts.plan.upscaled': 'The picture is enlarged beyond its source size', 'shorts.plan.title_agent_text': 'An agent wrote the title — check it',
  'shorts.plan.look_needs_word_timing': 'The chosen caption look needs word timing', 'shorts.plan.no_audio': 'The short has no sound',
  'shorts.plan.variant_over_sequence_format': 'A linked format replaces the frame of the short',
  'error.code.needs_video': 'A file with a picture is needed', 'error.code.needs_measurement': 'The sound of the file needs measuring first',
  'error.code.not_verbatim': 'The quote is not word for word from the transcript', 'error.code.off_word_boundary': 'The edge is not at the edge of a word',
  'error.code.plan_too_large': 'The plan is too large for one step', 'error.code.tracking_not_available': 'A motion track cannot be followed here',
  'error.code.not_built': 'This part is not built yet', 'error.code.undo_conflict': 'Cannot undo: items were changed afterwards',
};

/** A left-to-right run (ids, names typed in another script) isolated inside the Hebrew sentence. */
const ltr = (s: string) => `⁦${s}⁩`;
/**
 * Hebrew wording of the refusals of the sequence operations (core shortsContract.ts SEQUENCE_REFUSALS) and of the shorts
 * routes (SHORTS_REFUSALS), recognised by their shape like the other tables in refusals.ts; plus the propose-mode refusal
 * (SHORTS_PROPOSE_REFUSED) and the browser export's refusal of a subtitle file (BROWSER_EXPORT_SIDECAR_REFUSED). A refusal
 * both tables share (sequenceNotFound, notPlanMade) has one row; one that reuses another table's words (a missing motion
 * track: the tracking table) has none here.
 */
export const HE_SHORTS: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^[\s\S]+ is not built yet$/, () => 'החלק הזה עוד לא נבנה בגרסה הזו, ולכן לא נעשה דבר'],
  [/^sequence \S+ not found$/, () => 'הרצף לא נמצא; ייתכן שכבר נמחק'],
  [/^the main sequence cannot be removed$/, () => 'אי אפשר להסיר את הרצף הראשי'],
  [/^the main sequence takes its frame from the project settings$/, () => 'הפריים של הרצף הראשי נקבע בהגדרות הפרויקט. אפשר לשנות אותו שם, או להוסיף פורמט מקושר'],
  [/^a project holds at most (\d+) sequences$/, (m) => `בפרויקט יכולים להיות עד ${m[1]} רצפים. אפשר להסיר קודם רצף שכבר אינו נחוץ`],
  [/^this sequence still has (\d+) clip\(s\)$/, (m) => `ברצף הזה יש עוד ${m[1]} קליפים. אפשר להסיר אותו יחד עם כל התוכן שלו`],
  [/^nothing to change: give name or format$/, () => 'לא צוין מה לשנות ברצף'],
  [/^a sequence frame needs an even width and height \(video encoders require it\)$/, () => 'הרוחב והגובה של פריים הרצף חייבים להיות זוגיים (מקודדי וידאו דורשים זאת)'],
  [/^keyframe times must be strictly increasing$/, () => 'זמני נקודות המפתח חייבים לעלות, בלי שתי נקודות באותו זמן'],
  [/^a keyframe cannot sit before the clip start$/, () => 'נקודת מפתח אינה יכולה להיות לפני תחילת הקליפ'],
  [/^a caption cue has no keyframes$/, () => 'לכתובית אין נקודות מפתח; אפשר לשנות את סגנון רצועת הכתוביות'],
  [/^sequence \S+ was not made by a shorts plan, so a rebuild cannot replace it$/, () => 'הרצף הזה לא נוצר מתוכנית של קטעים קצרים, ולכן בנייה מחדש אינה יכולה להחליף אותו'],
  [/^plan step \d+ uses ".*", which is not a public operation$/, () => 'התוכנית ביקשה פעולה שאינה מותרת לה, ולכן הקטעים לא נוצרו. זו תקלה בשרת ולא במה שבחרת'],
  [/^plan step \d+ \(\S+\): [\s\S]+$/, () => 'אחד השלבים של התוכנית אינו תקין, ולכן הקטעים לא נוצרו. זו תקלה בשרת ולא במה שבחרת'],
  [/^origin \d+ names a sequence this plan did not create$/, () => 'התוכנית ניסתה לרשום מקור מדוד לרצף שלא היא יצרה, ולכן הקטעים לא נוצרו'],
  [/^file \S+ is not in the library of this project$/, () => 'הקובץ אינו בספרייה של הפרויקט'],
  [/^shorts are made from a file with a picture$/, () => 'קטעים קצרים נעשים מקובץ שיש בו תמונה'],
  [/^pick (\d+) is shorter than ([\d.]+) seconds$/, (m) => `קטע ${m[1]} קצר מ־${m[2]} שניות`],
  [/^pick (\d+) is longer than ([\d.]+) seconds$/, (m) => `קטע ${m[1]} ארוך מ־${m[2]} שניות`],
  [/^pick (\d+) lies outside the file$/, (m) => `קטע ${m[1]} נמצא מחוץ לקובץ`],
  [/^format profile "(.+)" is not one of the format profiles$/, (m) => `אין פורמט בשם ${ltr(m[1]!)}`],
  [/^caption look "(.+)" is not one of the caption looks$/, (m) => `אין מראה כתוביות בשם ${ltr(m[1]!)}`],
  [/^tightening pauses without word timing needs the sound of this file measured first$/, () => 'כדי לקצר הפסקות בלי תזמון מילים צריך למדוד קודם את הקול של הקובץ. חיפוש הרגעים מודד אותו'],
  [/^the quote title of pick (\d+) is not a run of words spoken in its excerpt$/, (m) => `כותרת הציטוט של קטע ${m[1]} אינה מילים שנאמרו בו, מילה במילה. אפשר להעתיק אותן מהתמליל, או לסמן שהכותרת היא ניסוח שלך`],
  [/^the (start|end) of pick (\d+) does not fall on a word edge$/, (m) => `${m[1] === 'start' ? 'תחילת' : 'סוף'} קטע ${m[2]} אינו בקצה של מילה`],
  [/^the plan needs (\d+) operations; at most (\d+) fit in one step$/, (m) => `התוכנית צריכה ${m[1]} פעולות, ובצעד אחד נכנסות עד ${m[2]}. אפשר ליצור פחות קטעים בבת אחת, או לוותר על הקיצור`],
  [/^motion track \S+ follows a subject in another file$/, () => 'מסלול המעקב שנבחר עוקב אחרי משהו בקובץ אחר'],
  [/^a turned picture \(rotation\) cannot follow a motion track in a short$/, () => 'תמונה מסובבת אינה יכולה לעקוב אחרי מסלול מעקב בקטע קצר; אפשר למרכז או להשתמש ברקע מטושטש'],
  [/^the browser export route cannot write a subtitle file, so the captions would be lost$/, () => 'הייצוא בדפדפן אינו יכול לכתוב קובץ כתוביות נפרד, ולכן הכתוביות היו הולכות לאיבוד. אפשר לייצא בשרת, או לבחור כתוביות בתוך הסרטון או בלי כתוביות'],
  [/^making shorts is committed by the server as one step, which a proposal cannot carry; ask the owner to make them, or switch this credential to edit mode$/, () => 'יצירת קטעים קצרים נשמרת בשרת כצעד אחד, והצעה אינה יכולה לשאת אותו. אפשר לבקש מבעל/ת הפרויקט ליצור אותם'],
];
