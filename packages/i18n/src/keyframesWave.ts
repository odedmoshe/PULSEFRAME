/**
 * Interface strings of keyframe curves and motion paths (ADR-0019; namespaces `curve.*` and `keys.*`, wave4-decisions.md):
 * the names of the keyframe operations (`op.*`, op-wording.test.ts), the curve library's names (`curve.name.<easing>`, one per
 * core keyframe.ts EASINGS), the curve picker, the keyframe strip (`keys.*`), the motion path (`keys.path.*`) and the command
 * labels. Spread into `he` and `en` (index.ts); Hebrew first, and the English dictionary covers the same keys.
 * The Hebrew names are starting points that nobody has reviewed yet (wave4-decisions.md). No string here says "velocity" or
 * «מהירות»: those words belong to the transition speed ramp (ADR-0012) and the clip speed (packages/evals
 * keyframes-wording.test.ts forbids them here).
 * Also here: the Hebrew wording of the refusals of the curve rules and the keyframe operations (HE_KEYFRAMES; core
 * keyframe.ts KEYFRAME_REFUSALS), which refusals.ts adds to translateRefusal. Numbers and channel names in them are kept as
 * the server wrote them, isolated left to right.
 */
const ltr = (s: string) => `⁦${s}⁩`;

export const KEYFRAMES_WAVE_HE = {
  // operation names (activity feed, history); replace_clip_keyframes is worded by shorts.ts
  'op.replace_effect_keyframes': 'החלפת קיפריימים של אפקט', 'op.set_keyframe_curve': 'שינוי עקומה',
  // the curve library (core keyframe.ts CURVES, plus the custom curve)
  'curve.name.linear': 'ישר', 'curve.name.smooth': 'רך', 'curve.name.ease-in': 'התחלה רכה', 'curve.name.ease-out': 'סיום רך',
  'curve.name.ease-in-out': 'רך בשני הקצוות', 'curve.name.gentle': 'עדין', 'curve.name.sharp': 'חד', 'curve.name.overshoot': 'חריגה וחזרה',
  'curve.name.anticipate': 'נסיגה לפני תנועה', 'curve.name.bounce': 'הקפצה', 'curve.name.spring': 'קפיץ', 'curve.name.hold': 'החזקה',
  'curve.name.bezier': 'עקומה מותאמת',
  // the curve picker (a dialog) and the curve chip beside a keyframe diamond in the inspector
  'curve.picker': 'בוחר עקומה', 'curve.chip': 'עקומה', 'curve.smooth': 'רך', 'curve.straight': 'ישר',
  'curve.scope': 'על מה להחיל', 'curve.scope.all': 'כל הערוצים בזמן הזה', 'curve.scope.one': 'הערוץ הזה בלבד',
  'curve.side.after': 'אחרי הנקודה', 'curve.side.before': 'לפני הנקודה', 'curve.side.both': 'משני הצדדים',
  'curve.custom': 'עקומה מותאמת', 'curve.handle.first': 'ידית ראשונה', 'curve.handle.second': 'ידית שנייה',
  'curve.handle.time': 'זמן', 'curve.handle.value': 'ערך',
  'curve.turnsBack': 'חוזרת אחורה', 'curve.flashDisabled': 'עקומה שחוזרת אחורה אינה מותרת על שקיפות, בהירות או צבע: שינוי בהירות הלוך ושוב הוא הבהוב',
  'curve.beatNote': 'הפרמטר הזה זז גם עם הפעימות; העקומה קובעת את ערך הבסיס שלו',
  'curve.stepped': 'הפרמטר הזה מקבל מספרים שלמים בלבד, ולכן העקומה מוצגת במדרגות',
  'curve.approximate': 'הנקודה החדשה נוספה בקירוב לעקומה; הסטייה הגדולה ביותר:',
  'curve.notBuilt': 'העקומות עוד לא נבנו בגרסה הזו, ולכן אפשר לבחור כרגע רק את העקומות הקודמות',
  // the keyframe strip on the timeline
  'keys.strip': 'פס קיפריימים', 'keys.key': 'קיפריים', 'keys.outside': 'קיפריימים מחוץ לקליפ',
  'keys.readOnlyFormat': 'בתצוגת פורמט הקיפריימים לקריאה בלבד; עורכים אותם במקור',
  'keys.menu': 'פעולות על קיפריימים', 'keys.menu.curve': 'עקומה…', 'keys.menu.copy': 'העתקה', 'keys.menu.paste': 'הדבקה', 'keys.menu.delete': 'מחיקה',
  'keys.crosses': 'אי אפשר להזיז נקודה מעבר לנקודה אחרת באותו ערוץ', 'keys.copied': 'הקיפריימים הועתקו', 'keys.pasteSkipped': 'ערוצים שלא הודבקו בקליפ הזה:',
  'keys.notBuilt': 'פס הקיפריימים עוד לא נבנה בגרסה הזו',
  // the motion path on the stage
  'keys.path': 'מסלול תנועה', 'keys.path.point': 'נקודה במסלול', 'keys.path.bend': 'כיפוף המסלול',
  'keys.path.readOnlyFormat': 'בתצוגת פורמט המסלול לקריאה בלבד; עורכים אותו במקור',
  'keys.path.follower': 'הקליפ הזה עוקב אחרי מסלול מעקב. המסלול שלו על המסך יוצג בגרסה הבאה, יחד עם מסלול המעקב',
  'keys.path.approximate': 'הכיפוף נוסף בקירוב; הסטייה הגדולה ביותר בפיקסלים:',
  'keys.path.notBuilt': 'מסלול התנועה עוד לא נבנה בגרסה הזו',
  // commands (commands.ts, W2)
  'cmd.keyframeFocus': 'מעבר לפס הקיפריימים', 'cmd.keyframeSmooth': 'עקומה רכה בקיפריים הנבחר', 'cmd.keyframeLinear': 'עקומה ישרה בקיפריים הנבחר',
  'cmd.keyframeCurve': 'בחירת עקומה…', 'cmd.keyframeCopy': 'העתקת קיפריימים', 'cmd.keyframePaste': 'הדבקת קיפריימים בסמן', 'cmd.motionPath': 'הצגת מסלול התנועה',
} as const;

export const KEYFRAMES_WAVE_EN: Record<keyof typeof KEYFRAMES_WAVE_HE, string> = {
  'op.replace_effect_keyframes': 'Replaced effect keyframes', 'op.set_keyframe_curve': 'Changed curve',
  'curve.name.linear': 'Straight', 'curve.name.smooth': 'Smooth', 'curve.name.ease-in': 'Ease in', 'curve.name.ease-out': 'Ease out',
  'curve.name.ease-in-out': 'Ease in and out', 'curve.name.gentle': 'Gentle', 'curve.name.sharp': 'Sharp', 'curve.name.overshoot': 'Overshoot',
  'curve.name.anticipate': 'Anticipate', 'curve.name.bounce': 'Bounce', 'curve.name.spring': 'Spring', 'curve.name.hold': 'Hold',
  'curve.name.bezier': 'Custom curve',
  'curve.picker': 'Curve picker', 'curve.chip': 'Curve', 'curve.smooth': 'Smooth', 'curve.straight': 'Straight',
  'curve.scope': 'Apply to', 'curve.scope.all': 'Every channel at this time', 'curve.scope.one': 'This channel only',
  'curve.side.after': 'After the key', 'curve.side.before': 'Before the key', 'curve.side.both': 'Both sides',
  'curve.custom': 'Custom curve', 'curve.handle.first': 'First handle', 'curve.handle.second': 'Second handle',
  'curve.handle.time': 'Time', 'curve.handle.value': 'Value',
  'curve.turnsBack': 'Turns back', 'curve.flashDisabled': 'A curve that turns back is not allowed on opacity, brightness or colour: a change of brightness back and forth is a flash',
  'curve.beatNote': 'This parameter also follows the beat; the curve sets its base value',
  'curve.stepped': 'This parameter takes whole numbers only, so the curve is drawn in steps',
  'curve.approximate': 'The new key was added as an approximation of the curve; largest deviation:',
  'curve.notBuilt': 'Curves are not built in this version yet, so only the earlier curves can be chosen for now',
  'keys.strip': 'Keyframe strip', 'keys.key': 'Keyframe', 'keys.outside': 'Keyframes outside the clip',
  'keys.readOnlyFormat': 'In a format view keyframes are read-only; edit them in the master',
  'keys.menu': 'Keyframe actions', 'keys.menu.curve': 'Curve…', 'keys.menu.copy': 'Copy', 'keys.menu.paste': 'Paste', 'keys.menu.delete': 'Delete',
  'keys.crosses': 'A key cannot be moved past another key of the same channel', 'keys.copied': 'Keyframes copied', 'keys.pasteSkipped': 'Channels not pasted on this clip:',
  'keys.notBuilt': 'The keyframe strip is not built in this version yet',
  'keys.path': 'Motion path', 'keys.path.point': 'Path point', 'keys.path.bend': 'Bend the path',
  'keys.path.readOnlyFormat': 'In a format view the path is read-only; edit it in the master',
  'keys.path.follower': 'This clip follows a motion track. Its path on the screen is shown in a later version, together with the tracked path',
  'keys.path.approximate': 'The bend was added as an approximation; largest deviation in pixels:',
  'keys.path.notBuilt': 'The motion path is not built in this version yet',
  'cmd.keyframeFocus': 'Go to the keyframe strip', 'cmd.keyframeSmooth': 'Smooth curve at the selected keyframe', 'cmd.keyframeLinear': 'Straight curve at the selected keyframe',
  'cmd.keyframeCurve': 'Choose curve…', 'cmd.keyframeCopy': 'Copy keyframes', 'cmd.keyframePaste': 'Paste keyframes at playhead', 'cmd.motionPath': 'Show motion path',
};

/**
 * The Hebrew wording of the refusals of the curve rules and keyframe operations (core keyframe.ts KEYFRAME_REFUSALS; `notBuilt`
 * is worded by shorts.ts HE_SHORTS on purpose), and of three refusals the keyframe operations share with older edits
 * (set_keyframe's out-of-range value, set_effect_keyframe's parameter that cannot be animated, a missing effect).
 */
export const HE_KEYFRAMES: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^a custom curve \(easing "bezier"\) needs its four handles$/, () => 'לעקומה מותאמת צריך ארבע ידיות (שתי ידיות, זמן וערך לכל אחת)'],
  [/^handles are given only with easing "bezier", not with "(\S+)"$/, (m) => `ידיות ניתנות רק לעקומה מותאמת, לא לעקומה ${ltr(m[1]!)}`],
  [/^the curve "(\S+)" goes back and forth past its end value, which is not allowed on (\S+): a change of brightness that turns back is a flash$/, (m) => `העקומה ${ltr(m[1]!)} חוזרת אחורה מעבר לערך הסיום, וזה אסור על ${ltr(m[2]!)}: שינוי בהירות הלוך ושוב הוא הבהוב. אפשר לבחור עקומה שאינה חוזרת אחורה`],
  [/^this clip has no keyframe channel (\S+)$/, (m) => `לקליפ הזה אין ערוץ קיפריימים ${ltr(m[1]!)}`],
  [/^give both from and to, or neither$/, () => 'יש לתת גם התחלה וגם סוף לטווח, או אף אחד מהם'],
  [/^from must not be after to$/, () => 'תחילת הטווח אינה יכולה להיות אחרי סופו'],
  [/^new keyframe (\d+) lies outside from…to$/, (m) => `נקודת המפתח החדשה מספר ${ltr(m[1]!)} נמצאת מחוץ לטווח`],
  [/^a channel holds at most (\d+) keyframes$/, (m) => `בערוץ אחד יכולות להיות עד ${ltr(m[1]!)} נקודות מפתח`],
  [/^none of these times is a keyframe of these channels$/, () => 'באף אחד מהזמנים האלה אין נקודת מפתח בערוצים האלה'],
  // shared with set_keyframe / set_effect_keyframe (ops.ts) and the effect operations
  [/^value (\S+) is out of range for (\S+)$/, (m) => `הערך ${ltr(m[1]!)} מחוץ לטווח של ${ltr(m[2]!)}`],
  [/^"(.+)" is not a numeric parameter of (\S+)$/, (m) => `${ltr(`"${m[1]!}"`)} אינו פרמטר מספרי של האפקט ${ltr(m[2]!)}, ולכן אי אפשר להנפיש אותו`],
  [/^effect \S+ not found on clip \S+$/, () => 'האפקט לא נמצא בקליפ הזה; ייתכן שכבר הוסר'],
];
