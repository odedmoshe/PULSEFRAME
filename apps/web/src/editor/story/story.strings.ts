/**
 * «ספרו מה היה» — the story's own strings (wave 7 story track), Hebrew first and right to left. LEAD seed of the pre-pass: the
 * names of the feature and its main controls, the recorder's states, the held-tap reasons and every warning code. W3 owns this file
 * after the pre-pass and may add keys (both languages; story.strings.test.ts keeps them in step). The shared fixed lines are i18n
 * `story.*` (packages/i18n/src/story.ts). Nothing here says synced, perfect, «מסונכרן», «מושלם», best or score, or calls the story AI
 * except the fixed disclaimer that says it is NOT (core STORY_FORBIDDEN_WORDS / _HE). Numbers are plain digits drawn in <bdi> by the
 * components; dBFS numbers are isolated LTR.
 */
import type { StoryBlockingCode, StoryHeldReason, StoryWarningCode } from '@pulseframe/core';

export interface StoryStrings {
  name: string; close: string; cancel: string;
  // sections
  pictures: string; voice: string; options: string;
  addFromLibrary: string; removePicture: string; moveHint: string;
  // the recorder
  record: string; stop: string; listen: string; save: string; recordAgain: string; fromLibrary: string; fromPhone: string;
  recState: { unsupported: string; denied: string; noDevice: string; asking: string; limit: string; saving: string };
  recording(seconds: number, maxSeconds: number): string;
  tooQuiet(dbfs: number): string; clipped(samples: number): string;
  unplayable(codec: string): string;
  // options
  music: string; musicNone: string; musicAddBuiltin: string; musicShort(musicSeconds: number, narrationSeconds: number): string;
  ownSound: string; ownSoundUnder: string; ownSoundMute: string; openingTitle: string;
  // building
  tapAlong: string; buildNoTaps: string;
  // the tap view
  tab: string; start: string; next: string; resume: string; restart: string; accept: string; retap: string; discard: string;
  count(n: number, of: number): string; notCalibrated: string; ownSoundSilent: string; differs: string; changedSince: string;
  held: Record<StoryHeldReason, string>;
  // notes
  warning: Record<StoryWarningCode | StoryBlockingCode, string>;
  autoSplit: string;
  // the bar
  rebuild: string; restoreRemoved: string; undo: string;
}

const he: StoryStrings = {
  name: 'ספרו מה היה', close: 'סגירה', cancel: 'ביטול',
  pictures: 'תמונות וקליפים', voice: 'הקול', options: 'אפשרויות',
  addFromLibrary: 'הוספה מהספרייה', removePicture: 'הסרה', moveHint: 'Alt+חצים כדי לשנות את הסדר',
  record: 'הקלטה', stop: 'עצירה', listen: 'האזנה', save: 'שמירה', recordAgain: 'הקלטה מחדש', fromLibrary: 'בחירה מהספרייה', fromPhone: 'מהטלפון',
  recState: {
    unsupported: 'הדפדפן הזה לא מאפשר הקלטה. אפשר לבחור הקלטה מהספרייה או מהטלפון',
    denied: 'אין הרשאה למיקרופון — אפשרו אותה בהגדרות האתר',
    noDevice: 'לא נמצא מיקרופון. חברו מיקרופון או בחרו הקלטה מהטלפון',
    asking: 'מבקש גישה למיקרופון…',
    limit: 'ההקלטה נעצרה אחרי 10 דקות. אפשר לשמור או להקליט מחדש',
    saving: 'שומר בספרייה…',
  },
  recording: (s, max) => `מקליט… ${clock(s)} מתוך ${clock(max)}`,
  tooQuiet: (db) => `שקט מדי (⁦${db.toFixed(0)} dBFS⁩)`,
  clipped: (n) => `חזק מדי: ${n} דגימות נחתכו`,
  unplayable: (codec) => `הקובץ לא מתנגן בעורך (קודק ⁦${codec}⁩). הקליטו כאן או המירו אותו`,
  music: 'מוזיקה', musicNone: 'בלי מוזיקה', musicAddBuiltin: 'הוסיפו מוזיקה מובנית',
  musicShort: (m, n) => `המוזיקה (${m.toFixed(0)} שנ׳) קצרה מהקריינות (${n.toFixed(0)} שנ׳) ותיגמר לפניה`,
  ownSound: 'הקול של הקליפים', ownSoundUnder: 'חלש מתחת לקריינות', ownSoundMute: 'מושתק', openingTitle: 'כותרת פתיחה',
  tapAlong: 'הקישו את המעברים', buildNoTaps: 'בנו בלי הקשות',
  tab: 'סיפור', start: 'התחילו', next: 'התמונה הבאה', resume: 'המשיכו מכאן', restart: 'מההתחלה', accept: 'אישור', retap: 'הקשה מחדש', discard: 'ביטול',
  count: (n, of) => `${n} מתוך ${of}`, notCalibrated: 'לא כויל', ownSoundSilent: 'בזמן ההקשה לא שומעים את הקול של הקליפים',
  differs: 'התוכנית בשרת יצאה שונה — בדקו שוב', changedSince: 'הפרויקט השתנה — בדקו שוב',
  held: { too_close: 'קרוב מדי למעבר הקודם (בטיחות הבזקים)', no_picture_left: 'לא נשארה תמונה', outside_narration: 'מחוץ לקריינות', kept_by_hand: 'בתוך קליפ שנערך ביד' },
  warning: {
    auto_cuts: 'חלק מהמעברים לא הוקשו וחולקו אוטומטית', voice_flat: 'לא נמצאו הפסקות בקול: המעברים שלא הוקשו חולקו באופן שווה',
    voice_pending: 'מדידת הקול עוד לא מוכנה: המעברים שלא הוקשו חולקו באופן שווה', voice_no_sound: 'לקריינות אין קול למדוד',
    clip_ended_early: 'קליפ קצר מהמקום שלו התנגן עד הסוף, והתמונה הבאה באה מוקדם', pictures_end_before_voice: 'התמונות נגמרות לפני הקריינות',
    music_short: 'המוזיקה קצרה מהקריינות ותיגמר לפניה', kept_by_hand: 'קליפים שנערכו ביד נשארו כמו שהם', removed_by_hand: 'קליפים שנמחקו ביד לא נוספו שוב',
    moved_back: 'קליפים שרק הוזזו חזרו למקום של ההקשה שלהם', filled_next_to_kept: 'תמונה ליד קליפ שנערך ביד הוארכה או קוצרה כדי שלא יישאר חור',
    not_measured: 'חלק מהסרטונים לא נמדדו, ולכן מוצג האמצע שלהם', title_resolved_static: 'הכותרת נכתבה כטקסט קבוע', mixed_orientation: 'יש בסיפור תמונות עומדות ושוכבות',
    narration_removed: 'הקריינות נמחקה ביד; החזירו אותה (ביטול) כדי לבנות מחדש', kept_narration_not_followable: 'הקריינות שנערכה ביד מתנגנת לאחור או במהירות אחרת, והתמונות לא יכולות לעקוב אחריה',
  },
  autoSplit: 'חולק אוטומטית',
  rebuild: 'בנייה מחדש', restoreRemoved: 'החזרת החלקים שנמחקו', undo: 'ביטול',
};
const en: StoryStrings = {
  name: 'Tell what happened', close: 'Close', cancel: 'Cancel',
  pictures: 'Pictures and clips', voice: 'The voice', options: 'Options',
  addFromLibrary: 'Add from the library', removePicture: 'Remove', moveHint: 'Alt+arrows to change the order',
  record: 'Record', stop: 'Stop', listen: 'Listen', save: 'Save', recordAgain: 'Record again', fromLibrary: 'Choose from the library', fromPhone: 'From the phone',
  recState: {
    unsupported: 'This browser cannot record. Choose a recording from the library or the phone',
    denied: 'No permission for the microphone — allow it in the site settings',
    noDevice: 'No microphone found. Connect one or choose a recording from the phone',
    asking: 'Asking for the microphone…',
    limit: 'Recording stopped after 10 minutes. You can save it or record again',
    saving: 'Saving to the library…',
  },
  recording: (s, max) => `Recording… ${clock(s)} of ${clock(max)}`,
  tooQuiet: (db) => `Too quiet (${db.toFixed(0)} dBFS)`,
  clipped: (n) => `Too loud: ${n} samples clipped`,
  unplayable: (codec) => `This file cannot be played in the editor (codec ${codec}). Record here or convert it`,
  music: 'Music', musicNone: 'No music', musicAddBuiltin: 'Add built-in music',
  musicShort: (m, n) => `The music (${m.toFixed(0)} s) is shorter than the narration (${n.toFixed(0)} s) and ends before it`,
  ownSound: 'The clips\' own sound', ownSoundUnder: 'Low under the narration', ownSoundMute: 'Muted', openingTitle: 'Opening title',
  tapAlong: 'Tap the changes', buildNoTaps: 'Build without tapping',
  tab: 'Story', start: 'Start', next: 'Next picture', resume: 'Go on from here', restart: 'From the start', accept: 'Accept', retap: 'Tap again', discard: 'Discard',
  count: (n, of) => `${n} of ${of}`, notCalibrated: 'Not calibrated', ownSoundSilent: 'While tapping, the clips\' own sound is not heard',
  differs: 'The server\'s plan came out different — check again', changedSince: 'The project changed — check again',
  held: { too_close: 'Too close to the previous change (flash safety)', no_picture_left: 'No picture left', outside_narration: 'Outside the narration', kept_by_hand: 'Inside a clip edited by hand' },
  warning: {
    auto_cuts: 'Some changes were not tapped and were placed automatically', voice_flat: 'No pauses were found in the voice: untapped changes are spread evenly',
    voice_pending: 'The voice measurement is not ready yet: untapped changes are spread evenly', voice_no_sound: 'The narration has no sound to measure',
    clip_ended_early: 'A clip shorter than its place played to its end, and the next picture came early', pictures_end_before_voice: 'The pictures end before the narration',
    music_short: 'The music is shorter than the narration and ends before it', kept_by_hand: 'Clips edited by hand were kept as they are', removed_by_hand: 'Clips deleted by hand were not added again',
    moved_back: 'Clips that were only moved went back to the place of their tap', filled_next_to_kept: 'A picture next to a clip edited by hand was made longer or shorter so no gap is left',
    not_measured: 'Some videos were not measured, so their middle is shown', title_resolved_static: 'The title was written as fixed text', mixed_orientation: 'The story mixes upright and wide pictures',
    narration_removed: 'The narration was deleted by hand; restore it (undo) to build again', kept_narration_not_followable: 'The narration edited by hand plays backwards or at another speed, so the pictures cannot follow it',
  },
  autoSplit: 'Placed automatically',
  rebuild: 'Rebuild', restoreRemoved: 'Bring back what was deleted', undo: 'Undo',
};
function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function storyStrings(lang: 'he' | 'en'): StoryStrings { return lang === 'en' ? en : he; }
