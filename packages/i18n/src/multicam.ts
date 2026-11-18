/**
 * Shared interface strings of multicam (ADR-0020, «סנכרון וחיתוך»): the names of the operations (`op.*`, op-wording.test.ts),
 * the fixed product wording the lead decided (wave4-decisions.md) and the labels of the contract's codes (core
 * multicamContract.ts: verdicts, skip reasons, dropped kinds, warnings). Spread into `he` and `en` (index.ts); Hebrew first,
 * and the English dictionary covers the same keys. Lines that carry numbers («12 חתכים נשמרו», offsets, ppm) are formatted by
 * the editor (apps/web/src/editor/multicam.strings.ts, W3) with the numbers and timecodes in <bdi dir="ltr">.
 * The auto-switch is a heuristic and says so: it never claims to know who is speaking (packages/evals/src/multicam-wording.test.ts).
 * Also here: the Hebrew wording of every multicam refusal (HE_MULTICAM; core multicamRefusals.ts), which refusals.ts adds to
 * translateRefusal. The not-built refusal (`<op> is not built yet`) is worded by the shared pattern in shorts.ts.
 */
export const MULTICAM_HE = {
  // operation names (activity feed, history)
  'op.create_multicam': 'יצירת קבוצת מולטיקאם', 'op.attach_multicam_sync': 'שמירת סנכרון מדוד', 'op.set_multicam_sync': 'תיקון סנכרון זווית',
  'op.update_multicam': 'עדכון קבוצת מולטיקאם', 'op.set_angle_look': 'מראה לזווית', 'op.place_multicam': 'הצבת תוכנית מולטיקאם',
  'op.switch_angles': 'החלפת זוויות', 'op.detach_from_multicam': 'ניתוק ממולטיקאם', 'op.remove_multicam': 'הסרת קבוצת מולטיקאם',
  // the panel, the entry and the decided wording
  'multicam.title': 'מולטיקאם', 'multicam.syncAndCut': 'סנכרון וחיתוך', 'multicam.angles': 'זוויות',
  'multicam.angle.camera': 'מצלמה', 'multicam.angle.mic': 'מיקרופון', 'multicam.wide': 'רחב', 'multicam.onAir': 'בשידור',
  'multicam.thumbnail': 'תמונה ממוזערת, לא חי', 'multicam.record': 'הקלטת החלפות', 'multicam.recordStop': 'עצירת ההקלטה',
  'multicam.applyLookToAngle': 'החל מראה זה על כל הזווית', 'multicam.speakers': 'דוברים', 'multicam.sync': 'סנכרון',
  'multicam.resync': 'סנכרון מחדש', 'multicam.choose': 'בחירה', 'multicam.offset': 'היסט', 'multicam.drift': 'סחיפה',
  'multicam.peakRatio': 'יחס השיאים', 'multicam.residual': 'שארית', 'multicam.notBuilt': 'החלק הזה של המולטיקאם עוד לא נבנה בגרסה הזו',
  'multicam.reviewStop': 'יש זוויות שהסנכרון שלהן אינו ודאי. כדאי לבדוק אותן לפני החיתוך',
  'multicam.soundChunks': 'הקול של מקליט נוסף מחולק לחלקים קצרים כדי להישאר מסונכרן; החיבורים עוד לא נבדקו בהאזנה',
  'multicam.capturePrior': 'לפי שעת הצילום (משוער)', 'multicam.capturePriorNote': 'שעון כל טלפון שונה מעט, ולכן זה רק קירוב של כמה שניות. כדאי לבדוק בעין ובאוזן',
  'multicam.dualMono': 'נראה שכל ערוץ במקליט הזה קולט דובר אחר. למרכז את הקול?', 'multicam.dualMonoApply': 'מרכוז הקול',
  'multicam.auto': 'החלפה אוטומטית', 'multicam.auto.heuristic': 'היוריסטיקה: הזווית של המיקרופון החזק בבירור. זה לא זיהוי של מי שמדבר',
  'multicam.diarisation.notInstalled': 'זיהוי דוברים אינו מותקן; ההחלפה האוטומטית לפי עוצמת המיקרופונים בלבד',
  'multicam.outOfSync': 'התמונה אינה מסונכרנת עם הקול', 'multicam.droppedPunchIn': 'קירוב שהיה רק בקטע הזה הוסר עם החלפת הזווית',
  // sync verdicts (core SYNC_VERDICTS): words, never colour alone
  'multicam.verdict.reference': 'קובע את זמן הקבוצה', 'multicam.verdict.confident': 'מסונכרן בביטחון', 'multicam.verdict.check': 'מסונכרן — כדאי לבדוק',
  'multicam.verdict.ambiguous': 'כמה התאמות אפשריות', 'multicam.verdict.no-shared-sound': 'אין קול משותף', 'multicam.verdict.inconsistent': 'הסנכרון אינו עקבי',
  'multicam.verdict.manual': 'סונכרן ביד', 'multicam.verdict.unsynced': 'לא מסונכרן',
  // why a cut or segment was skipped (core SKIP_REASONS)
  'multicam.skip.not_tagged': 'אינו קטע מולטיקאם', 'multicam.skip.other_group': 'שייך לקבוצה אחרת', 'multicam.skip.gap': 'אין שם קטע',
  'multicam.skip.reversed': 'הקטע מתנגן אחורה', 'multicam.skip.ramped': 'מהירות הקטע משתנה', 'multicam.skip.linked': 'הקטע מקושר לקליפ אחר',
  'multicam.skip.not_covered': 'לזווית אין תמונה שם', 'multicam.skip.group_time_not_on_track': 'הרגע הזה כבר נחתך מהתוכנית',
  'multicam.skip.same_frame': 'חתך נוסף באותו פריים', 'multicam.skip.already_on_angle': 'כבר בזווית הזו',
  // what a switch dropped (core DROPPED_KINDS) and its warnings (MULTICAM_WARNINGS)
  'multicam.dropped.keyframes': 'תנועה של הקטע', 'multicam.dropped.effect_keyframes': 'שינויי אפקט לאורך הקטע', 'multicam.dropped.follow': 'מעקב אחרי תנועה',
  'multicam.dropped.variant_transform': 'מסגור לפורמט אחר', 'multicam.warn.redaction_missing': 'לזווית החדשה אין אזורי פרטיות — כדאי לבדוק',
  'multicam.warn.speed_not_following_sound': 'מהירות הקטע אינה 1, והקול הראשי ממשיך במהירות רגילה',
} as const;
export const MULTICAM_EN: Record<keyof typeof MULTICAM_HE, string> = {
  'op.create_multicam': 'Create multicam group', 'op.attach_multicam_sync': 'Store measured sync', 'op.set_multicam_sync': 'Correct angle sync',
  'op.update_multicam': 'Update multicam group', 'op.set_angle_look': 'Angle look', 'op.place_multicam': 'Place multicam program',
  'op.switch_angles': 'Switch angles', 'op.detach_from_multicam': 'Detach from multicam', 'op.remove_multicam': 'Remove multicam group',
  'multicam.title': 'Multicam', 'multicam.syncAndCut': 'Sync and cut', 'multicam.angles': 'Angles',
  'multicam.angle.camera': 'Camera', 'multicam.angle.mic': 'Mic', 'multicam.wide': 'Wide', 'multicam.onAir': 'On air',
  'multicam.thumbnail': 'Thumbnail, not live', 'multicam.record': 'Record switches', 'multicam.recordStop': 'Stop recording',
  'multicam.applyLookToAngle': 'Apply this look to the whole angle', 'multicam.speakers': 'Speakers', 'multicam.sync': 'Sync',
  'multicam.resync': 'Sync again', 'multicam.choose': 'Choose', 'multicam.offset': 'Offset', 'multicam.drift': 'Drift',
  'multicam.peakRatio': 'Peak ratio', 'multicam.residual': 'Residual', 'multicam.notBuilt': 'This part of multicam is not built yet in this version',
  'multicam.reviewStop': 'Some angles are not surely in sync. Check them before cutting',
  'multicam.soundChunks': 'The sound of a second recorder is laid as short parts to stay in sync; nobody has listened to the joins yet',
  'multicam.capturePrior': 'By capture time (estimate)', 'multicam.capturePriorNote': 'Every phone\'s clock is a little different, so this is only within a few seconds. Check it by eye and ear',
  'multicam.dualMono': 'Each channel of this recorder seems to pick up a different speaker. Centre the sound?', 'multicam.dualMonoApply': 'Centre the sound',
  'multicam.auto': 'Auto-switch', 'multicam.auto.heuristic': 'Heuristic: the angle of the clearly loudest mic. This does not identify who is speaking',
  'multicam.diarisation.notInstalled': 'Speaker identification is not installed; auto-switch uses mic levels only',
  'multicam.outOfSync': 'The picture is out of sync with the sound', 'multicam.droppedPunchIn': 'A punch-in that only this segment had was removed with the angle switch',
  'multicam.verdict.reference': 'Sets group time', 'multicam.verdict.confident': 'In sync, confident', 'multicam.verdict.check': 'In sync — check it',
  'multicam.verdict.ambiguous': 'Several possible matches', 'multicam.verdict.no-shared-sound': 'No shared sound', 'multicam.verdict.inconsistent': 'Sync is not consistent',
  'multicam.verdict.manual': 'Synced by hand', 'multicam.verdict.unsynced': 'Not synced',
  'multicam.skip.not_tagged': 'Not a multicam segment', 'multicam.skip.other_group': 'Belongs to another group', 'multicam.skip.gap': 'No segment there',
  'multicam.skip.reversed': 'The segment plays backwards', 'multicam.skip.ramped': 'The segment changes speed', 'multicam.skip.linked': 'The segment is linked to another clip',
  'multicam.skip.not_covered': 'The angle has no picture there', 'multicam.skip.group_time_not_on_track': 'That moment was already cut out of the program',
  'multicam.skip.same_frame': 'Another cut on the same frame', 'multicam.skip.already_on_angle': 'Already on that angle',
  'multicam.dropped.keyframes': 'The segment\'s own motion', 'multicam.dropped.effect_keyframes': 'Effect changes along the segment', 'multicam.dropped.follow': 'Motion follow',
  'multicam.dropped.variant_transform': 'Framing for another format', 'multicam.warn.redaction_missing': 'The new angle has no privacy regions — check it',
  'multicam.warn.speed_not_following_sound': 'The segment\'s speed is not 1, and the main sound plays on at normal speed',
};

/** A left-to-right run (ids, labels typed in another script) isolated inside the Hebrew sentence. */
const ltr = (s: string) => `⁦${s}⁩`;
/** Hebrew wording of the multicam refusals (core multicamRefusals.ts MULTICAM_REFUSALS), recognised by their shape; one row each. */
export const HE_MULTICAM: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^multicam group \S+ not found$/, () => 'קבוצת המולטיקאם לא נמצאה; ייתכן שכבר הוסרה. אפשר לבחור קבוצה מרשימת הקבוצות של הפרויקט'],
  [/^angle \S+ is not an angle of multicam group \S+$/, () => 'הזווית אינה שייכת לקבוצת המולטיקאם הזו. אפשר לבחור אחת מהזוויות של הקבוצה'],
  [/^angle \S+ has no file (\d+)$/, (m) => `אין לזווית הזו קובץ מספר ${m[1]}. הקבצים שלה ממוספרים מ־0 לפי הסדר שבו ניתנו; אפשר לבחור אחד מהם`],
  [/^a project holds at most (\d+) multicam groups$/, (m) => `בפרויקט יכולות להיות עד ${m[1]} קבוצות מולטיקאם. אפשר להסיר קודם קבוצה שאינה נחוצה`],
  [/^file \S+ has no (picture|sound), so it cannot be a (?:picture|sound) angle$/, (m) => (m[1] === 'picture' ? 'בקובץ אין תמונה, ולכן אינו יכול להיות זווית מצלמה. אפשר לבחור קובץ וידאו, או להוסיף אותו כזווית מיקרופון' : 'בקובץ אין קול, ולכן אינו יכול להיות זווית מיקרופון. אפשר לבחור קובץ שיש בו קול')],
  [/^file \S+ is named twice in this group$/, () => 'אותו קובץ נבחר פעמיים בקבוצה. כל קובץ שייך לזווית אחת בלבד, ולכן יש להשאיר אותו רק באחת'],
  [/^the first file of the reference angle sets group time, so its sync cannot be changed$/, () => 'הקובץ הראשון של זווית הייחוס קובע את זמן הקבוצה, ולכן אי אפשר לשנות את הסנכרון שלו. אפשר לתקן את שאר הקבצים מולו'],
  [/^give exactly one of nudge, offset, anchors or clear$/, () => 'יש לבחור דרך אחת לתיקון הסנכרון: הזזה, היסט, נקודות סנכרון או ניקוי'],
  [/^sync anchors must increase in both group time and source time$/, () => 'נקודות הסנכרון חייבות לעלות גם בזמן הקבוצה וגם בזמן הקובץ. אפשר למיין אותן לפי זמן הקבוצה ולהסיר נקודה שחוזרת אחורה בקובץ'],
  [/^sync anchors must fall on whole samples at (\d+) Hz$/, (m) => `נקודות הסנכרון חייבות ליפול על דגימות שלמות (${m[1]} הרץ). אפשר לעגל כל נקודה לדגימה הקרובה`],
  [/^a sync map may not run more than 1000 ppm \(0\.1%\) faster or slower than the reference$/, () => 'מפת סנכרון אינה יכולה לרוץ מהר או לאט יותר מהייחוס ביותר מ־0.1%; זו מהירות אחרת ולא סחיפת שעון. כדאי לבדוק אם הקובץ הואט או הואץ'],
  [/^a project holds at most (\d+) sync anchors$/, (m) => `בפרויקט יכולות להיות עד ${m[1]} נקודות סנכרון. אפשר להסתפק בפחות נקודות לכל קובץ; לקו ישר מספיקות שתיים`],
  [/^a file of angle "(.+)" was synced by hand; measuring again would discard that correction$/, (m) => `קובץ של הזווית ${ltr(m[1]!)} סונכרן ביד. מדידה חוזרת תמחק את התיקון; אפשר לאשר החלפה`],
  [/^angle "(.+)" is not synced yet$/, (m) => `הזווית ${ltr(m[1]!)} עוד לא סונכרנה. אפשר לסנכרן לפי הקול או ביד`],
  [/^angle "(.+)" has no picture from ([\d.]+)s to ([\d.]+)s of group time$/, (m) => `לזווית ${ltr(m[1]!)} אין תמונה מ־${m[2]} עד ${m[3]} שניות. אפשר לדלג על מה שאינו מכוסה, או לחתוך שם לזווית אחרת`],
  [/^this step would change (\d+) items; one multicam step changes at most (\d+)$/, (m) => `הצעד הזה היה משנה ${m[1]} פריטים, ובצעד אחד של מולטיקאם אפשר לשנות עד ${m[2]}. אפשר להחליף קטע קצר יותר`],
  [/^one step takes at most (\d+) cuts$/, (m) => `בצעד אחד נכנסים עד ${m[1]} חתכים. אפשר לשלוח את החתכים בכמה צעדים`],
  [/^(\d+) video tracks hold segments of this group$/, (m) => `ב־${m[1]} רצועות וידאו יש קטעים של הקבוצה הזו; יש לבחור רצועה`],
  [/^no video track holds segments of this group$/, () => 'אין עדיין תוכנית של הקבוצה הזו על ציר הזמן. אפשר להציב אותה קודם'],
  [/^each cut gives exactly one of at or groupTime$/, () => 'יש לתת לכל חתך נקודה אחת: זמן בציר הזמן או זמן בקבוצה, לא את שניהם'],
  [/^track \S+ already holds clips$/, () => 'ברצועה שנבחרה כבר יש קליפים. אפשר להציב את התוכנית ברצועות חדשות'],
  [/^track \S+ is not a (video|audio) track$/, (m) => (m[1] === 'video' ? 'הרצועה שנבחרה אינה רצועת וידאו. אפשר לבחור רצועת וידאו, או לא לבחור רצועה כלל' : 'הרצועה שנבחרה אינה רצועת קול. אפשר לבחור רצועת קול, או לא לבחור רצועה כלל')],
  [/^a program laid in a new sequence takes new tracks: give newSequence without sequenceId or trackId$/, () => 'תוכנית ברצף חדש מקבלת רצועות חדשות, ולכן אין לבחור גם רצף או רצועה קיימים. אפשר לוותר על הבחירה הזו, או להציב את התוכנית ברצף קיים'],
  [/^this clip is an angle of a multicam group; its file is set by the group$/, () => 'הקליפ הזה הוא זווית בקבוצת מולטיקאם, והקובץ שלו נקבע בקבוצה. אפשר לנתק אותו קודם, או להחליף זווית'],
  [/^(\d+) multicam group\(s\) use this file$/, (m) => `${m[1]} קבוצות מולטיקאם משתמשות בקובץ הזה. אפשר להסיר את הקבוצה קודם`],
  [/^(\d+) multicam file\(s\) hide a region with this motion track or follow it$/, (m) => `${m[1]} קבצים בקבוצת מולטיקאם משתמשים במסלול המעקב הזה. אפשר לנקות קודם את המראה של הזווית`],
  [/^(\d+) clip\(s\) on the timeline are segments of this group$/, (m) => `${m[1]} קליפים בציר הזמן הם קטעים של הקבוצה. אפשר להסיר אותה ולהפוך אותם לקליפים רגילים באותו צעד`],
  [/^clip \S+ is not a multicam segment$/, () => 'הקליפ אינו קטע של מולטיקאם. יש לבחור קטע מתוך תוכנית מולטיקאם'],
  [/^clip \S+ does not show angle "(.+)"$/, (m) => `הקליפ אינו מציג את הזווית ${ltr(m[1]!)}. אפשר לבחור קטע של הזווית הזו, או להחליף אותו אליה קודם`],
  [/^give exactly one of fromClipId or clear$/, () => 'יש לבחור אם לקחת את המראה מקטע או לנקות אותו'],
  [/^"(.+)" is a sound angle, which has no picture and so no look$/, (m) => `${ltr(m[1]!)} היא זווית קול, אין לה תמונה ולכן אין לה מראה. אפשר לבחור זווית מצלמה`],
  [/^nothing to change: give name, wideAngleId, angles or speakers$/, () => 'לא צוין מה לשנות בקבוצת המולטיקאם. אפשר לשנות את השם, את הזווית הרחבה, את שמות הזוויות או את הדוברים'],
  [/^the wide angle must be a picture angle; "(.+)" is a sound angle$/, (m) => `הזווית הרחבה חייבת להיות זווית מצלמה; ${ltr(m[1]!)} היא זווית קול. אפשר לבחור זווית מצלמה, או לוותר על זווית רחבה`],
  [/^the mic of speaker "(.+)" must be an angle of this group with sound$/, (m) => `המיקרופון של ${ltr(m[1]!)} חייב להיות זווית של הקבוצה שיש בה קול. אפשר לבחור מקליט של הקבוצה, או מצלמה שלה שהקליטה קול`],
];
