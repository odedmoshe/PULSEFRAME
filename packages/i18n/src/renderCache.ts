/**
 * Interface strings of the segmented export and render cache (ADR-0024, «ייצוא מהיר»). Spread into `he` and `en` (index.ts);
 * Hebrew first, and the English dictionary must cover the same keys. Only fixed strings live here — the switch and its hint,
 * the honest notes, the progress stages, the lane's tooltips, the storage row and its clear action, the uncacheable reasons
 * (core UNCACHEABLE_CODES) and the error codes. Lines that carry numbers («נעשה שימוש חוזר ב-284 מתוך 300 מקטעים», the done line,
 * the ETA) are formatted by apps/web/src/editor/renderCache.strings.ts (W3), with the numbers in <bdi dir="ltr">.
 * No string says the cache was "verified" as a whole or promises a speed: the self-check proves the frames it checked.
 * Also here: the Hebrew wording of the fast export's blockers and job failures (HE_RENDER_CACHE, core renderCache.ts
 * RENDER_CACHE_BLOCKERS / RENDER_CACHE_JOB_ERRORS), which refusals.ts adds to translateRefusal;
 * packages/evals/src/render-cache-wording.test.ts keeps the two in step.
 */
export const RENDER_CACHE_HE = {
  // the export sheet's switch (a per-viewer preference, localStorage 'pf.fastExport')
  'cache.fast.label': 'ייצוא מהיר — מרנדר רק מה שהשתנה',
  'cache.fast.hint': 'הקובץ עשוי להיות גדול במעט מייצוא רגיל באותה איכות',
  'cache.fast.mp4Only': 'ייצוא מהיר זמין כרגע רק ל־MP4',
  'cache.fast.off': 'מטמון הרינדור כבוי במחשב הזה',
  'cache.fast.unavailable': 'ייצוא מהיר אינו זמין במחשב הזה',
  // the plan line's fixed variants and the honest notes (limits a, b of the ADR)
  'cache.plan.checking': 'בודק מה השתנה…',
  'cache.plan.nothing': 'שום דבר בתמונה לא השתנה — רק חיבור וקידוד שמע',
  'cache.plan.ripple': 'שינוי שמזיז את ההמשך (מחיקה או הוספה באמצע) מרנדר מחדש את כל מה שאחריו',
  'cache.plan.music': 'שינוי במיקום המוזיקה מרנדר מחדש את הקטעים שמתחתיה',
  'cache.plan.etaBasis': 'נמדד בייצואים קודמים במחשב הזה',
  // progress stages of the incremental route (core SEGMENTED_STAGES)
  'cache.stage.keying': 'בדיקה מה השתנה', 'cache.stage.selfCheck': 'בדיקה עצמית של המטמון', 'cache.stage.rendering': 'רינדור מקטעים שהשתנו',
  'cache.stage.joining': 'חיבור המקטעים', 'cache.stage.validating': 'בדיקת הקובץ והבהובים',
  // the job failed its self-check (render_cache_self_check_failed)
  'cache.failed.selfCheck': 'הבדיקה העצמית מצאה מקטע שמור שאינו תואם לרינדור הנוכחי. המקטעים השמורים של הייצוא הזה נמחקו. «ניסיון חוזר» ירנדר הכול מחדש.',
  // the job could not join a segment exactly (segment_join_mismatch); the way out, as core RENDER_CACHE_JOB_ERRORS.joinMismatch.hint
  'cache.failed.join': 'מקטע לא התחבר בדיוק לשאר הסרטון, ולכן לא נשמר קובץ. אפשר לנסות שוב; אם זה חוזר, אפשר לכבות את הייצוא המהיר — הייצוא הרגיל לא השתנה.',
  // the timeline lane (one focusable summary; pattern plus tooltip, never colour alone)
  'cache.lane.label': 'מטמון רינדור', 'cache.lane.cached': 'שמור במטמון — לא ירונדר שוב', 'cache.lane.render': 'השתנה — ירונדר בייצוא הבא',
  'cache.lane.uncacheable': 'לא נשמר במטמון — ירונדר בכל ייצוא', 'cache.lane.jump': 'קפיצה', 'cache.lane.refresh': 'רענון', 'cache.lane.stale': 'קטעים שירונדרו בייצוא הבא',
  // storage (status-bar popover row, project manager → storage)
  'cache.storage.label': 'מטמון רינדור', 'cache.storage.clear': 'ניקוי מטמון הרינדור',
  'cache.storage.clearConfirm': 'הסרטונים והפרויקטים לא ייפגעו; הייצוא הבא ירנדר הכול מחדש',
  'cache.storage.keptPinned': 'מקטעים של ייצוא שרץ עכשיו לא נמחקו', 'cache.storage.off': 'מטמון הרינדור כבוי',
  'cache.storage.note': 'המטמון נספר בתקרת האחסון, אינו נכלל בגיבוי ובארכיון, ונמחק עם הפרויקט שלו',
  // why a stretch is rendered every time (core UNCACHEABLE_CODES)
  'cache.uncacheable.unkeyable_value': 'יש בקטע ערך שאי אפשר לזהות בבטחה', 'cache.uncacheable.unknown_layer_kind': 'יש בקטע סוג שכבה שהמטמון עוד לא מכיר',
  'cache.uncacheable.gpu_not_reproducible': 'אפקט שרץ על כרטיס המסך, ועוד לא נבדק שהוא יוצא זהה בכל פעם', 'cache.uncacheable.asset_unhashed': 'קובץ או גופן בקטע אינם זמינים לזיהוי',
  // error codes of the fast export (blockers and job failures)
  'error.code.incremental_format_unsupported': 'ייצוא מהיר זמין רק ל־MP4', 'error.code.render_cache_disabled': 'מטמון הרינדור כבוי',
  'error.code.incremental_unavailable': 'ייצוא מהיר אינו זמין', 'error.code.render_cache_self_check_failed': 'הבדיקה העצמית של המטמון מצאה מקטע שאינו תואם',
  'error.code.segment_join_mismatch': 'מקטע לא התחבר בדיוק לשאר הסרטון',
} as const;
export const RENDER_CACHE_EN: Record<keyof typeof RENDER_CACHE_HE, string> = {
  'cache.fast.label': 'Fast export — renders only what changed',
  'cache.fast.hint': 'The file may be slightly larger than an ordinary export at the same quality',
  'cache.fast.mp4Only': 'Fast export is available for MP4 only for now',
  'cache.fast.off': 'The render cache is turned off on this computer',
  'cache.fast.unavailable': 'Fast export is not available on this computer',
  'cache.plan.checking': 'Checking what changed…',
  'cache.plan.nothing': 'Nothing in the picture changed — only joining and encoding the sound',
  'cache.plan.ripple': 'A change that moves what follows (deleting or inserting in the middle) renders everything after it again',
  'cache.plan.music': 'Moving the music renders the stretches under it again',
  'cache.plan.etaBasis': 'measured in earlier exports on this computer',
  'cache.stage.keying': 'Checking what changed', 'cache.stage.selfCheck': 'Self-check of the cache', 'cache.stage.rendering': 'Rendering the changed segments',
  'cache.stage.joining': 'Joining the segments', 'cache.stage.validating': 'Checking the file and flashes',
  'cache.failed.selfCheck': 'The self-check found a stored segment that does not match the current render. The stored segments of this export were deleted. "Try again" renders everything again.',
  'cache.failed.join': 'A segment did not join the rest of the video exactly, so no file was saved. Try again; if it happens again, turn the fast export off — the ordinary export is unchanged.',
  'cache.lane.label': 'Render cache', 'cache.lane.cached': 'Stored in the cache — will not be rendered again', 'cache.lane.render': 'Changed — will be rendered in the next export',
  'cache.lane.uncacheable': 'Not stored — rendered in every export', 'cache.lane.jump': 'Go', 'cache.lane.refresh': 'Refresh', 'cache.lane.stale': 'Stretches the next export renders',
  'cache.storage.label': 'Render cache', 'cache.storage.clear': 'Clear the render cache',
  'cache.storage.clearConfirm': 'Videos and projects are not affected; the next export renders everything again',
  'cache.storage.keptPinned': 'Segments of an export running now were kept', 'cache.storage.off': 'The render cache is off',
  'cache.storage.note': 'The cache counts toward the storage ceiling, is left out of backups and archives, and is deleted with its project',
  'cache.uncacheable.unkeyable_value': 'The stretch holds a value that cannot be identified safely', 'cache.uncacheable.unknown_layer_kind': 'The stretch has a kind of layer the cache does not know yet',
  'cache.uncacheable.gpu_not_reproducible': 'An effect runs on the graphics card, and it is not yet shown to come out the same every time', 'cache.uncacheable.asset_unhashed': 'A file or font in the stretch cannot be identified',
  'error.code.incremental_format_unsupported': 'Fast export is for MP4 only', 'error.code.render_cache_disabled': 'The render cache is off',
  'error.code.incremental_unavailable': 'Fast export is not available', 'error.code.render_cache_self_check_failed': 'The cache self-check found a segment that does not match',
  'error.code.segment_join_mismatch': 'A segment did not join the rest of the video exactly',
};

/** A left-to-right run (a format id, an English reason) isolated inside the Hebrew sentence. */
const ltr = (s: string) => `⁦${s}⁩`;
const FORMAT_WORD: Record<string, string> = { 'webm-vp9-opus': 'WebM', gif: 'GIF', wav: 'WAV', png: 'PNG' };
/** Reasons the server gives for incremental_unavailable that have Hebrew words; any other reason is kept as the server wrote it. */
const UNAVAILABLE_REASON: [RegExp, string][] = [
  [/^the segmented export route is not built yet$/, 'מסלול הייצוא המהיר עוד לא הושלם בגרסה הזו'],
  [/^the check of the segment join has not finished yet; try again in a moment$/, 'הבדיקה של חיבור המקטעים עוד לא הסתיימה; אפשר לנסות שוב בעוד רגע'],
];
/**
 * Hebrew wording of the fast export's blockers and job failures, one row per entry of core RENDER_CACHE_BLOCKERS and
 * RENDER_CACHE_JOB_ERRORS, in their order.
 */
export const HE_RENDER_CACHE: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^the fast export renders only MP4 for now; (\S+) is exported in one pass$/, (m) => `ייצוא מהיר זמין כרגע רק ל־MP4; ${ltr(FORMAT_WORD[m[1]!] ?? m[1]!)} מיוצא במעבר אחד`],
  [/^the render cache is turned off on this machine \(its size limit is 0\)$/, () => 'מטמון הרינדור כבוי במחשב הזה (מגבלת הגודל שלו היא 0)'],
  [/^the fast export is not available on this machine: (.+)$/, (m) => `ייצוא מהיר אינו זמין במחשב הזה: ${UNAVAILABLE_REASON.find(([re]) => re.test(m[1]!))?.[1] ?? ltr(m[1]!)}`],
  [/^the self-check found a stored segment \(frames (\d+)–(\d+)\) that does not match the current render at frame (\d+); the (\d+) stored segments this export reused were removed and nothing was published$/,
    (m) => `הבדיקה העצמית מצאה מקטע שמור (פריימים ${ltr(`${m[1]}–${m[2]}`)}) שאינו תואם לרינדור הנוכחי בפריים ${m[3]}. ${m[4]} המקטעים השמורים שהייצוא הזה השתמש בהם נמחקו, ולא נשמר קובץ`],
  [/^the segment starting at frame (\d+) was encoded with a different packet timing from the others, so it cannot be joined exactly$/, (m) => `המקטע שמתחיל בפריים ${m[1]} קודד בתזמון שונה משאר המקטעים, ולכן אי אפשר לחבר אותו בדיוק`],
];
