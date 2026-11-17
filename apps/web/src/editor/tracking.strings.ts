/**
 * Interface strings of motion tracking (ADR-0015): the tracking panel, the picker on the monitor, follow and privacy regions.
 * Hebrew first; English covers the same keys. Namespaces: `mtrack.*` (tracks and the picker; `track.*` names timeline track
 * kinds), `follow.*` and `redact.*`. Operation names and the job's refusal headlines live in the shared dictionaries
 * (packages/i18n index.ts), the job's stage words in effectParams.ts STAGE_WORDS.
 */
import type { Lang } from '@pulseframe/i18n';
import type { FollowStateName, TrackStateName } from '@pulseframe/core';

type S = string;
const he = {
  'mtrack.title': 'מעקב תנועה',
  'mtrack.note': 'מעקב אחרי נקודה או אזור בתמונה בלי מודל בינה מלאכותית (זרימה אופטית והתאמת תבנית). פריימים שבהם המעקב חלש או אבד מסומנים, ולעולם אינם מנוחשים.',
  'mtrack.noVideo': 'לקובץ הזה אין תמונה נעה, ולכן אין בו מה לעקוב.',
  'mtrack.notOnVideo': 'מעקב תנועה נעשה על קליפ וידאו ברצועת וידאו.',
  'mtrack.none': 'אין עדיין מסלולי מעקב לקובץ הזה.',
  'mtrack.list': 'מסלולי המעקב של הקובץ',
  'mtrack.newPoint': 'נקודה חדשה למעקב', 'mtrack.newRegion': 'אזור חדש למעקב',
  'mtrack.kind.point': 'נקודה', 'mtrack.kind.region': 'אזור',
  'mtrack.name.point': 'נקודה', 'mtrack.name.region': 'אזור',
  'mtrack.frames': 'פריימים', 'mtrack.sourceFrames': 'פריימי מקור',
  'mtrack.counts': 'מצב הפריימים',
  'mtrack.method': 'שיטה', 'mtrack.edited': 'תוקן ביד', 'mtrack.notTracked': 'עדיין לא נעקב: יש בו רק הנקודה שסומנה.',
  'mtrack.problems': 'קטעים לבדיקה', 'mtrack.problems.none': 'אין קטעים חלשים, אבודים או לא בדוקים.',
  'mtrack.jump': 'מעבר לקטע', 'mtrack.jump.none': 'הקטע הזה אינו מוצג בציר הזמן',
  'mtrack.track': 'מעקב', 'mtrack.retrack': 'מעקב מחדש',
  'mtrack.overwrite': 'המסלול תוקן ביד. מעקב מחדש יחליף את התוצאות האוטומטיות; נקודות שסומנו ביד נשמרות.', 'mtrack.overwriteGo': 'מעקב מחדש בכל זאת',
  'mtrack.stop': 'עצירת המעקב', 'mtrack.progress': 'התקדמות המעקב', 'mtrack.queued': 'ממתין בתור…',
  'mtrack.done': 'המעקב הסתיים והתוצאה נשמרה.', 'mtrack.canceled': 'המעקב נעצר. דבר לא נשמר.', 'mtrack.failed': 'המעקב נכשל',
  'mtrack.rename': 'שינוי שם המסלול', 'mtrack.delete': 'מחיקת המסלול', 'mtrack.deleteUnbind': 'מחיקה וניתוק הקליפים',
  'mtrack.usedBy': 'קליפים שמשתמשים במסלול',
  'mtrack.followTitle': 'הוספת כותרת שעוקבת', 'mtrack.followTitle.text': 'כותרת',
  'mtrack.atPlayhead': 'בסמן',
  'mtrack.pick.point': 'בחירת נקודה למעקב', 'mtrack.pick.region': 'בחירת אזור למעקב',
  'mtrack.pick.help': 'לחיצה על התמונה בוחרת נקודה, גרירה בוחרת אזור. החצים מזיזים בפיקסל אחד (עם Shift: עשרה), Alt עם החצים משנה את גודל האזור, Enter מאשר ו־Escape מבטל.',
  'mtrack.pick.confirm': 'אישור', 'mtrack.pick.cancel': 'ביטול',
  'mtrack.pick.outside': 'הנקודה מחוץ לתמונה של הקליפ. בחרו נקודה על התמונה עצמה.',
  'mtrack.pick.noPicture': 'הקליפ אינו מוצג בסמן. העבירו את הסמן לפריים שבו הוא נראה.',
  'mtrack.pick.noSize': 'לנקודה אין גודל. גרירה בוחרת אזור.',
  'mtrack.pick.created': 'נוצר מסלול מעקב. אפשר להתחיל במעקב.',
} satisfies Record<string, S>;
const en: Record<keyof typeof he, S> = {
  'mtrack.title': 'Motion tracking',
  'mtrack.note': 'Follows a point or an area of the picture without an AI model (optical flow and template matching). Frames where tracking is weak or lost are marked and never guessed.',
  'mtrack.noVideo': 'This file has no moving picture, so there is nothing to track.',
  'mtrack.notOnVideo': 'Motion tracking works on a video clip on a video track.',
  'mtrack.none': 'No motion tracks for this file yet.',
  'mtrack.list': 'Motion tracks of this file',
  'mtrack.newPoint': 'New point to track', 'mtrack.newRegion': 'New area to track',
  'mtrack.kind.point': 'point', 'mtrack.kind.region': 'area',
  'mtrack.name.point': 'Point', 'mtrack.name.region': 'Area',
  'mtrack.frames': 'frames', 'mtrack.sourceFrames': 'source frames',
  'mtrack.counts': 'Frame states',
  'mtrack.method': 'Method', 'mtrack.edited': 'corrected by hand', 'mtrack.notTracked': 'Not tracked yet: it holds only the point you marked.',
  'mtrack.problems': 'Stretches to check', 'mtrack.problems.none': 'No weak, lost or unchecked stretches.',
  'mtrack.jump': 'Go there', 'mtrack.jump.none': 'This stretch is not on the timeline',
  'mtrack.track': 'Track', 'mtrack.retrack': 'Track again',
  'mtrack.overwrite': 'This track was corrected by hand. Tracking again replaces the automatic results; points marked by hand are kept.', 'mtrack.overwriteGo': 'Track again anyway',
  'mtrack.stop': 'Stop tracking', 'mtrack.progress': 'Tracking progress', 'mtrack.queued': 'Waiting in the queue…',
  'mtrack.done': 'Tracking finished and the result was saved.', 'mtrack.canceled': 'Tracking stopped. Nothing was saved.', 'mtrack.failed': 'Tracking failed',
  'mtrack.rename': 'Rename track', 'mtrack.delete': 'Delete track', 'mtrack.deleteUnbind': 'Delete and detach the clips',
  'mtrack.usedBy': 'Clips using this track',
  'mtrack.followTitle': 'Add a title that follows', 'mtrack.followTitle.text': 'Title',
  'mtrack.atPlayhead': 'At the playhead',
  'mtrack.pick.point': 'Pick a point to track', 'mtrack.pick.region': 'Pick an area to track',
  'mtrack.pick.help': 'Click the picture to pick a point, drag to pick an area. Arrow keys move one pixel (with Shift: ten), Alt with the arrows resizes the area, Enter confirms and Escape cancels.',
  'mtrack.pick.confirm': 'Confirm', 'mtrack.pick.cancel': 'Cancel',
  'mtrack.pick.outside': 'That point is outside the clip\'s picture. Pick a point on the picture itself.',
  'mtrack.pick.noPicture': 'The clip is not shown at the playhead. Move the playhead to a frame where it is visible.',
  'mtrack.pick.noSize': 'A point has no size. Drag to pick an area.',
  'mtrack.pick.created': 'Motion track created. You can start tracking.',
};

const heFollow = {
  'follow.title': 'עקיבה אחרי תנועה',
  'follow.track': 'מסלול מעקב לעקיבה', 'follow.pick': 'בחירת מסלול…',
  'follow.none': 'אין מסלולי מעקב לקליפי וידאו ברצועות אחרות בזמן של הקליפ הזה. יוצרים מסלול בחלונית "מעקב תנועה" של קליפ הווידאו.',
  'follow.attach': 'חיבור בלי קפיצה', 'follow.detach': 'ניתוק', 'follow.attached': 'עוקב אחרי',
  'follow.scale': 'שינוי גודל יחד עם האזור הנעקב', 'follow.smooth': 'החלקה (פריימי מקור לכל צד)',
  'follow.offsetNote': 'מיקום הקליפ נשמר כהיסט מהנקודה הנעקבת. גרירה על המסך משנה את ההיסט.',
  'follow.timeEffect': 'לקליפ עם אפקט זמן אי אפשר עדיין לחבר מעקב.',
  'follow.keyframed': 'למיקום של הקליפ הזה יש נקודות מפתח, ולכן החיבור עלול להזיז אותו. אפשר לנקות את נקודות המפתח של המיקום קודם.',
  'follow.missingTrack': 'מסלול המעקב שהקליפ חובר אליו כבר לא קיים.',
  'follow.state': 'מצב בסמן',
} satisfies Record<string, S>;
const enFollow: Record<keyof typeof heFollow, S> = {
  'follow.title': 'Follow motion',
  'follow.track': 'Motion track to follow', 'follow.pick': 'Choose a track…',
  'follow.none': 'No motion tracks for video clips on other tracks during this clip. Create one in the "Motion tracking" panel of the video clip.',
  'follow.attach': 'Attach without a jump', 'follow.detach': 'Detach', 'follow.attached': 'Follows',
  'follow.scale': 'Scale with the tracked area', 'follow.smooth': 'Smoothing (source frames each side)',
  'follow.offsetNote': 'The clip\'s position is kept as an offset from the tracked point. Dragging it on the monitor changes the offset.',
  'follow.timeEffect': 'A clip with a time effect cannot follow a motion track yet.',
  'follow.keyframed': 'This clip\'s position has keyframes, so attaching may move it. You can clear the position keyframes first.',
  'follow.missingTrack': 'The motion track this clip followed no longer exists.',
  'follow.state': 'At the playhead',
};

const heRedact = {
  'redact.title': 'אזורי פרטיות',
  'redact.note': 'האזור מטושטש בכל תמונה של הקליפ לפני האפקטים, כך שגם הדים ושובלים מטושטשים.',
  'redact.add': 'הוספת אזור', 'redact.source': 'מיקום האזור', 'redact.fixed': 'אזור קבוע (לא זז)',
  'redact.region': 'אזור', 'redact.follows': 'עוקב אחרי',
  'redact.shape': 'צורה', 'redact.shape.ellipse': 'אליפסה', 'redact.shape.rect': 'מלבן',
  'redact.style': 'סגנון', 'redact.style.blur': 'טשטוש', 'redact.style.pixelate': 'פיקסלים', 'redact.style.fill': 'כיסוי מלא',
  'redact.strength': 'עוצמה', 'redact.pad': 'שוליים סביב האזור', 'redact.feather': 'ריכוך הקצוות', 'redact.color': 'צבע הכיסוי',
  'redact.x': 'מיקום אופקי', 'redact.y': 'מיקום אנכי', 'redact.width': 'רוחב', 'redact.height': 'גובה',
  'redact.onLoss': 'כשהמעקב אבד', 'redact.onLoss.frame': 'טשטוש כל התמונה', 'redact.onLoss.hold': 'השארת האזור במקומו האחרון',
  'redact.weakIsLost': 'פריים שהמעקב בו חלש נחשב אבוד',
  'redact.remove': 'הסרת האזור',
  'redact.none': 'אין אזורי פרטיות בקליפ הזה.',
} satisfies Record<string, S>;
const enRedact: Record<keyof typeof heRedact, S> = {
  'redact.title': 'Privacy regions',
  'redact.note': 'The area is blurred in every picture of the clip before its effects, so echoes and trails are blurred too.',
  'redact.add': 'Add a region', 'redact.source': 'Region position', 'redact.fixed': 'Fixed region (does not move)',
  'redact.region': 'Region', 'redact.follows': 'Follows',
  'redact.shape': 'Shape', 'redact.shape.ellipse': 'Ellipse', 'redact.shape.rect': 'Rectangle',
  'redact.style': 'Style', 'redact.style.blur': 'Blur', 'redact.style.pixelate': 'Pixelate', 'redact.style.fill': 'Full cover',
  'redact.strength': 'Strength', 'redact.pad': 'Margin around the area', 'redact.feather': 'Soft edges', 'redact.color': 'Cover colour',
  'redact.x': 'Horizontal position', 'redact.y': 'Vertical position', 'redact.width': 'Width', 'redact.height': 'Height',
  'redact.onLoss': 'When tracking is lost', 'redact.onLoss.frame': 'Blur the whole picture', 'redact.onLoss.hold': 'Keep the area where it last was',
  'redact.weakIsLost': 'Count a frame with weak tracking as lost',
  'redact.remove': 'Remove region',
  'redact.none': 'This clip has no privacy regions.',
};

const STATE_HE: Record<TrackStateName, S> = { unknown: 'לא נבדק', tracked: 'במעקב', weak: 'חלש', lost: 'אבד', manual: 'סומן ביד', interpolated: 'הושלם בין נקודות', reacquired: 'נמצא מחדש' };
const STATE_EN: Record<TrackStateName, S> = { unknown: 'unchecked', tracked: 'tracked', weak: 'weak', lost: 'lost', manual: 'marked by hand', interpolated: 'filled in', reacquired: 'found again' };
const FOLLOW_STATE_HE: Record<Exclude<FollowStateName, TrackStateName>, S> = { outside: 'מחוץ למסלול: המיקום מוחזק בקצה המסלול', 'target-absent': 'הקליפ הנעקב אינו מוצג עכשיו: המיקום נלקח מהפריים הקרוב שלו', 'target-missing': 'אין קליפ של הקובץ ברצועה הנעקבת: הקליפ נשאר במקומו' };
const FOLLOW_STATE_EN: Record<Exclude<FollowStateName, TrackStateName>, S> = { outside: 'outside the track: the position is held at its end', 'target-absent': 'the followed clip is not shown now: the position comes from its nearest frame', 'target-missing': 'no clip of the file on the followed track: the clip stays where it is' };

const ALL = { he: { ...he, ...heFollow, ...heRedact }, en: { ...en, ...enFollow, ...enRedact } } as const;
export type TrackingKey = keyof typeof ALL.he;
export const TRACKING_STRINGS: Readonly<Record<Lang, Record<TrackingKey, S>>> = ALL;

/** A translator for the tracking strings, like createT. */
export const trackingT = (lang: Lang) => (key: TrackingKey): S => ALL[lang][key];
/** A frame state as shown to a person. */
export const stateName = (lang: Lang, s: TrackStateName): S => (lang === 'he' ? STATE_HE : STATE_EN)[s];
/** A follow state as shown to a person (a track state, or a state of the follow itself). */
export const followStateName = (lang: Lang, s: FollowStateName): S => (s in STATE_HE ? stateName(lang, s as TrackStateName) : (lang === 'he' ? FOLLOW_STATE_HE : FOLLOW_STATE_EN)[s as Exclude<FollowStateName, TrackStateName>]);

/** The privacy warning: shown for as long as the clip has a region that follows a track (it never blocks anything). */
export const redactWarning = (lang: Lang, frames: number): S => lang === 'he'
  ? `טשטוש אוטומטי אינו הסתרה מובטחת. ${frames} פריימים במעקב חלש או אבוד — בדקו לפני פרסום`
  : `Automatic blur is not guaranteed redaction. ${frames} frames have weak or lost tracking — check them before publishing`;
/** Where the picked point or area is, for the picker's live announcement (percent of the picture). */
export const pickAnnouncement = (lang: Lang, p: { x: number; y: number; w?: number; h?: number; frame: number }): S => {
  const pc = (v: number) => Math.round(v * 100);
  if (lang === 'he') return p.w === undefined ? `נקודה ב־${pc(p.x)}% מהרוחב וב־${pc(p.y)}% מהגובה, פריים מקור ${p.frame}` : `אזור שמרכזו ב־${pc(p.x)}% מהרוחב וב־${pc(p.y)}% מהגובה, בגודל ${pc(p.w)}% על ${pc(p.h ?? 0)}%, פריים מקור ${p.frame}`;
  return p.w === undefined ? `Point at ${pc(p.x)}% across and ${pc(p.y)}% down, source frame ${p.frame}` : `Area centred at ${pc(p.x)}% across and ${pc(p.y)}% down, ${pc(p.w)}% by ${pc(p.h ?? 0)}%, source frame ${p.frame}`;
};
/** A stretch of source frames, to be read as a range ("120–149"); `to` is one past the last frame. */
export const stretch = (from: number, to: number): S => (to - 1 > from ? `${from}–${to - 1}` : String(from));

/**
 * Fixed data-testids of the motion tracking UI, shared by the components and the proofs (editor-interactions-proof.ts,
 * a11y-audit.ts, tracking-proof.ts). A list item repeats its id and carries data-* attributes (data-motion-track-id, …).
 */
export const TRACKING_TESTIDS = {
  // the picker on the monitor (TrackPicker.tsx)
  picker: 'track-picker', pickerMark: 'track-picker-mark', pickerConfirm: 'track-picker-confirm', pickerCancel: 'track-picker-cancel', pickerLive: 'track-picker-live', pickerError: 'track-picker-error', pickerBar: 'track-picker-bar',
  // the tracking panel (TrackingPanel.tsx), in the clip tab of a video clip
  panel: 'tracking-panel', newPoint: 'mtrack-new-point', newRegion: 'mtrack-new-region', status: 'mtrack-status',
  item: 'mtrack-item', counts: 'mtrack-counts', problem: 'mtrack-problem', jump: 'mtrack-jump', run: 'mtrack-run', overwrite: 'mtrack-overwrite',
  progress: 'mtrack-progress', stop: 'mtrack-stop', jobStatus: 'mtrack-job-status', rename: 'mtrack-rename', remove: 'mtrack-delete', removeUnbind: 'mtrack-delete-unbind', followTitle: 'mtrack-follow-title', error: 'mtrack-error',
  // follow (FollowControls.tsx), for a title or a picture on a video track
  follow: 'follow-controls', followTrack: 'follow-track', followAttach: 'follow-attach', followDetach: 'follow-detach', followScale: 'follow-scale', followSmooth: 'follow-smooth', followState: 'follow-state', followError: 'follow-error',
  // privacy regions (RedactControls.tsx), on a video clip
  redact: 'redact-controls', redactSource: 'redact-source', redactRegionSource: 'redact-region-source', redactAdd: 'redact-add', redactRegion: 'redact-region', redactShape: 'redact-shape', redactStyle: 'redact-style', redactStrength: 'redact-strength',
  redactPad: 'redact-pad', redactFeather: 'redact-feather', redactColor: 'redact-color', redactOnLoss: 'redact-on-loss', redactWeak: 'redact-weak', redactRemove: 'redact-remove',
  redactX: 'redact-x', redactY: 'redact-y', redactWidth: 'redact-width', redactHeight: 'redact-height', redactWarning: 'redact-warning', redactError: 'redact-error',
} as const;
