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
  // ---- added by W3 (the interface) ----
  // dialog
  stripLabel: string; stripEmpty: string; earlier: string; later: string; libraryPicker: string; noMorePictures: string; add: string;
  narrationLabel: string; narrationNone: string; narrationChosen(seconds: number): string; checking: string; phoneHint: string; recordingsLabel: string;
  musicLabel: string; musicNoSound: string; musicLength(seconds: number): string; musicNote: string; ownSoundNote: string;
  titleField: string; titleHint: string;
  needNarration: string; needPictures: string; planning: string; building: string; planFailed: string; staleProject: string;
  // recorder
  recorderLabel: string; recordHint: string; levelLine(dbfs: number | null, clipped: number): string; deviceLine(name: string): string;
  stoppedLine(seconds: number): string; limitLine(seconds: number): string; savedLine(name: string): string; saveFailed: string; listenLabel: string;
  // tap view
  tapIntro: string; tapHintIdle: string; tapHintTapping: string; tapLaneLabel: string; pauseTick: string; reviewTitle: string;
  stopTapping: string; notBuilt: string; predictedLine(cuts: number, seconds: number): string;
  chipKept(index: number, seconds: number): string; chipHeld(index: number, seconds: number, reason: string): string; chipsLabel: string;
  accepting: string; accepted: string; ghostLabel: string; liveLabel: string; tapped(n: number): string; stoppedAt(seconds: number): string; noTaps: string; calibrateHint: string;
  // bar
  made: string; working: string; noOtherOption: string; retapNote: string; optionMusic(name: string): string; optionOwnSound(muted: boolean): string;
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
    limit: 'ההקלטה נעצרה בגבול האורך. אפשר לשמור או להקליט מחדש',
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
  stripLabel: 'התמונות והקליפים לפי סדר ההצגה', stripEmpty: 'אין תמונות או קליפים בסיפור. הוסיפו מהספרייה', earlier: 'הקדימו', later: 'אחרו',
  libraryPicker: 'תמונות וקליפים מהספרייה', noMorePictures: 'כל התמונות והקליפים של הספרייה כבר בסיפור', add: 'הוספה',
  narrationLabel: 'קובץ קול מהספרייה', narrationNone: 'בחרו קובץ קול…', narrationChosen: (s) => `הקריינות: ${clock(s)}`, checking: 'בודק שהקובץ מתנגן…',
  phoneHint: 'מהטלפון: פתחו את דף ההעלאה בטלפון והוסיפו שם הקלטת קול. היא תופיע ברשימת קובצי הקול',
  recordingsLabel: 'הקלטה, או קובץ קול שכבר בפרויקט',
  musicLabel: 'מוזיקה', musicNoSound: 'אין עדיין קובצי קול נוספים בפרויקט', musicLength: (s) => `${clock(s)}`,
  musicNote: 'המוזיקה נשארת חלשה (12 דציבל) מתחת לקריינות לכל אורכה', ownSoundNote: 'הקול של הקליפים תמיד נמוך מתחת לקריינות, וכאן אפשר להשתיק אותו',
  titleField: 'טקסט הכותרת', titleHint: 'אם משאירים ריק, הכותרת נבנית משם האירוע',
  needNarration: 'בחרו או הקליטו קריינות קודם', needPictures: 'אין תמונות או קליפים בסיפור', planning: 'מכין את התוכנית…', building: 'בונה את הסיפור…',
  planFailed: 'התוכנית לא נבנתה', staleProject: 'הפרויקט השתנה — בדקו שוב',
  recorderLabel: 'הקלטת קריינות', recordHint: 'לוחצים הקלטה, מספרים, ועוצרים. ההקלטה נשמרת בספרייה רק אחרי «שמירה»',
  levelLine: (db, n) => `עוצמה ${db === null ? 'אין' : `⁦${db.toFixed(1)} dBFS⁩`} · נחתכו ${n} דגימות`, deviceLine: (name) => `מיקרופון: ${name}`,
  stoppedLine: (s) => `נעצרה אחרי ${clock(s)}`, limitLine: (s) => `ההקלטה נעצרה אחרי ${clock(s)}, גבול האורך. אפשר לשמור או להקליט מחדש`, savedLine: (name) => `נשמר בספרייה: ${name}`, saveFailed: 'השמירה בספרייה לא הצליחה. נסו שוב', listenLabel: 'האזנה להקלטה',
  tapIntro: 'שמעו את הקריינות והקישו בכל מעבר לתמונה הבאה', tapHintIdle: '«התחילו» מנגן את הקריינות מההתחלה. אפשר גם ללחוץ R',
  tapHintTapping: 'הקישו Enter, מספר או «התמונה הבאה» בכל מעבר. רווח עוצר', tapLaneLabel: 'ציר ההקשות', pauseTick: 'הפסקה בקול', reviewTitle: 'התוכנית לפי ההקשות',
  stopTapping: 'עצירה (רווח)', notBuilt: 'יצירת סיפור עדיין לא נבנתה בגרסה הזו', predictedLine: (c, s) => `${c} מעברים · ${clock(s)}`,
  chipKept: (i, s) => `הקשה ${i}, ${clock(s)}: נשמרה`, chipHeld: (i, s, r) => `הקשה ${i}, ${clock(s)}: לא נשמרה — ${r}`, chipsLabel: 'מה קרה לכל הקשה',
  accepting: 'בונה…', accepted: 'הסיפור נבנה', ghostLabel: 'תצוגה מקדימה, עוד לא נשמרה', liveLabel: 'התמונה בזמן ההקשה', tapped: (n) => `הקשה ${n}`, stoppedAt: (s) => `נעצר ב־${clock(s)}`,
  noTaps: 'לא הוקשה אף הקשה. אפשר להתחיל שוב, או לבנות בלי הקשות', calibrateHint: 'ההקשות נמדדות בלי כיול זמן תגובה; אפשר לכייל בלשונית הכפתורים',
  made: 'הסיפור נבנה', working: 'בונה…', noOtherOption: 'אין אפשרות אחרת לבחור', retapNote: 'כדי להקיש מחדש: בטלו את הסיפור (Ctrl+Z) והקישו שוב', optionMusic: (n) => `מוזיקה: ${n}`,
  optionOwnSound: (m) => (m ? 'הקול של הקליפים: מושתק' : 'הקול של הקליפים: חלש מתחת לקריינות'),
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
    limit: 'Recording stopped at the length limit. You can save it or record again',
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
  stripLabel: 'The pictures and clips in show order', stripEmpty: 'There are no pictures or clips in the story. Add some from the library', earlier: 'Move earlier', later: 'Move later',
  libraryPicker: 'Pictures and clips of the library', noMorePictures: 'Every picture and clip of the library is already in the story', add: 'Add',
  narrationLabel: 'A sound file of the library', narrationNone: 'Choose a sound file…', narrationChosen: (s) => `The narration: ${clock(s)}`, checking: 'Checking that the file plays…',
  phoneHint: 'From the phone: open the upload page on the phone and add a voice recording there. It will appear in the list of sound files',
  recordingsLabel: 'A recording, or a sound file already in the project',
  musicLabel: 'Music', musicNoSound: 'There are no other sound files in the project yet', musicLength: (s) => `${clock(s)}`,
  musicNote: 'The music stays low (12 decibels) under the narration for its whole length', ownSoundNote: 'The clips\' own sound is always lowered under the narration; here you can mute it',
  titleField: 'Title text', titleHint: 'Left empty, the title is made from the event\'s name',
  needNarration: 'Choose or record the narration first', needPictures: 'There are no pictures or clips in the story', planning: 'Preparing the plan…', building: 'Building the story…',
  planFailed: 'The plan could not be made', staleProject: 'The project changed — check again',
  recorderLabel: 'Record the narration', recordHint: 'Press Record, tell the story, then stop. The recording reaches the library only after Save',
  levelLine: (db, n) => `Level ${db === null ? 'none' : `${db.toFixed(1)} dBFS`} · ${n} samples clipped`, deviceLine: (name) => `Microphone: ${name}`,
  stoppedLine: (s) => `Stopped after ${clock(s)}`, limitLine: (s) => `Recording stopped after ${clock(s)}, the length limit. You can save it or record again`, savedLine: (name) => `Saved to the library: ${name}`, saveFailed: 'Saving to the library did not work. Try again', listenLabel: 'Listen to the recording',
  tapIntro: 'Listen to the narration and tap at every change to the next picture', tapHintIdle: '«Start» plays the narration from the beginning. R works too',
  tapHintTapping: 'Press Enter, a number or «Next picture» at every change. Space stops', tapLaneLabel: 'The taps', pauseTick: 'A pause in the voice', reviewTitle: 'The plan from your taps',
  stopTapping: 'Stop (Space)', notBuilt: 'Telling a story is not built in this version yet', predictedLine: (c, s) => `${c} changes · ${clock(s)}`,
  chipKept: (i, s) => `Tap ${i}, ${clock(s)}: kept`, chipHeld: (i, s, r) => `Tap ${i}, ${clock(s)}: not kept — ${r}`, chipsLabel: 'What became of each tap',
  accepting: 'Building…', accepted: 'The story was built', ghostLabel: 'Preview, not saved yet', liveLabel: 'The picture while tapping', tapped: (n) => `Tap ${n}`, stoppedAt: (s) => `Stopped at ${clock(s)}`,
  noTaps: 'No taps were made. You can start again, or build without taps', calibrateHint: 'The taps are measured without a reaction-time calibration; you can calibrate in the pads tab',
  made: 'The story was built', working: 'Building…', noOtherOption: 'There is no other option to choose', retapNote: 'To tap again: undo the story (Ctrl+Z) and tap again', optionMusic: (n) => `Music: ${n}`,
  optionOwnSound: (m) => (m ? 'The clips\' own sound: muted' : 'The clips\' own sound: low under the narration'),
};
function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/** m:ss of whole seconds (exported for the components' unit tests). */
export const clockOf = clock;
export function storyStrings(lang: 'he' | 'en'): StoryStrings { return lang === 'en' ? en : he; }
