/** Words of the multicam panel, sync dialog, library entry and inspector block that the shared dictionary (i18n multicam.*) does not hold. Hebrew first; English beside it. */
export interface MulticamStrings {
  region: string; viewerLabel: string; noProgram: string; noProgramHint: string; group: string;
  tile: (n: number, label: string) => string; tilesLabel: string; liveTiles: string; thumbnailNote: string;
  meter: (db: string) => string; noMeter: string; level: string;
  reaction: string; reactionHint: string; frames: (n: number) => string; recordHint: string; recordingNow: string;
  announceStart: string; announceStop: string; announceDiscard: string; saved: (n: number) => string; skippedSome: (n: number, why: string) => string; commitFailed: string; partsNote: (n: number) => string;
  cutAtPlayhead: string; cutAt: (n: number) => string; wideCmd: string; angleCmd: (n: number) => string; recordCmd: string; discardCmd: string;
  speakersEmpty: string; speakerName: string; speakerMic: string; speakerChannel: string; speakerShot: string; channelMix: string; channelN: (n: number) => string; shotWide: string; addSpeaker: string; removeSpeaker: string; saveSpeakers: string; speakersNote: string;
  autoIntro: string; autoBasis: string; autoPlan: string; autoApply: string; autoRegenerate: string; autoStepsTitle: string; autoNeedSpeakers: string; autoDone: string; autoFailed: string; autoUnsure: string; autoNotBuilt: string;
  diarisationSetup: string;
  syncTitle: string; syncOpen: string; syncColumns: { file: string; verdict: string; offset: string; drift: string; peak: string; residual: string }; ppm: (v: string) => string; seconds: (v: string) => string;
  nudgeFrame: string; nudgeMs: string; nudgeValue: (kind: 'frame' | 'ms', v: number) => string; nudgeLater: string; nudgeEarlier: string;
  candidates: string; candidateLine: (offset: string, score: string) => string; capturePriorLine: (offset: string, plus: string) => string;
  resyncAsk: string; resyncDiscard: string; resyncKeep: string; resyncOverwrite: string; syncRunning: string; syncFailed: string; syncDone: string; close: string; loading: string; refresh: string;
  reference: string; whyNoAudio: string; whyTooShort: string; unsyncedNote: string;
  libSelect: (name: string) => string; libCount: (n: number) => string; libHint: string; libNeed: string; libTooMany: string; libClear: string;
  stepCreate: string; stepSync: string; stepReview: string; stepPlace: string; stepDone: string; stepFailed: (why: string) => string; reviewIntro: string; reviewContinue: string; reviewCancel: string; reviewSyncDialog: string; syncAgain: string;
  clipBlockTitle: string; angleList: string; appliedLook: (n: number) => string; droppedLine: (what: string, n: number) => string;
  badge: (n: number, label: string) => string; dualMonoDone: string;
  groupsLabel: string;
}
const ARROW = (v: number) => (v > 0 ? `+${v}` : `${v}`);
export const MULTICAM_STRINGS: Record<'he' | 'en', MulticamStrings> = {
  he: {
    region: 'מולטיקאם', viewerLabel: 'צפייה בכל הזוויות', noProgram: 'אין תוכנית מולטיקאם על רצועת הווידאו שנבחרה', noProgramHint: 'יש לבחור את רצועת הווידאו של התוכנית (הכפתור ◎ של הרצועה) כדי להחליף זוויות במקשי המספרים', group: 'קבוצה',
    tile: (n, label) => `זווית ${n}: ${label}`, tilesLabel: 'בחירת זווית', liveTiles: 'תצוגה חיה', thumbnailNote: 'תמונה ממוזערת, לא חי',
    meter: (db) => `עוצמה ${db} דציבל`, noMeter: 'אין מדידת עוצמה', level: 'עוצמה',
    reaction: 'זמן תגובה', reactionHint: 'כמה פריימים אחורה נרשם כל חתך, כדי לפצות על זמן התגובה', frames: (n) => `${n} פריימים`, recordHint: 'בזמן ההקלטה מקשי המספרים רושמים חתך בפריים שמוצג. העצירה או ההשהיה שומרות הכול בצעד אחד', recordingNow: 'מקליט',
    announceStart: 'הקלטת ההחלפות התחילה', announceStop: 'הקלטת ההחלפות נעצרה', announceDiscard: 'ההקלטה בוטלה, שום דבר לא נשמר', saved: (n) => `${n} חתכים נשמרו`, skippedSome: (n, why) => `${n} חתכים לא נשמרו: ${why}`, commitFailed: 'החתכים לא נשמרו', partsNote: (n) => `ההקלטה ארוכה, ולכן נשמרת ב־${n} חלקים`,
    cutAtPlayhead: 'חיתוך במיקום הנוכחי', cutAt: (n) => `חיתוך לזווית ${n} במיקום הנוכחי`, wideCmd: 'מעבר לזווית הרחבה', angleCmd: (n) => `מעבר לזווית ${n}`, recordCmd: 'הקלטת החלפות', discardCmd: 'ביטול הקלטת ההחלפות',
    speakersEmpty: 'עוד לא הוגדרו דוברים', speakerName: 'שם', speakerMic: 'מיקרופון', speakerChannel: 'ערוץ', speakerShot: 'זווית צילום', channelMix: 'כל הערוצים', channelN: (n) => `ערוץ ${n}`, shotWide: 'הרחבה', addSpeaker: 'הוספת דובר', removeSpeaker: 'הסרה', saveSpeakers: 'שמירת הדוברים', speakersNote: 'הדוברים משמשים רק להחלפה האוטומטית',
    autoIntro: 'מציע חיתוכים לפי המיקרופון שנשמע חזק בבירור. אפשר לראות את התוכנית לפני שמחילים אותה', autoBasis: 'על מה זה מבוסס', autoPlan: 'תוכנית', autoApply: 'החלה', autoRegenerate: 'יצירה מחדש', autoStepsTitle: 'מה ייעשה', autoNeedSpeakers: 'כדי להחליף אוטומטית צריך לפחות שני דוברים עם מיקרופונים', autoDone: 'ההחלפה האוטומטית הוחלה', autoFailed: 'ההחלפה האוטומטית לא הצליחה', autoUnsure: 'חתכים לא בטוחים', autoNotBuilt: 'ההחלפה האוטומטית עוד לא זמינה בגרסה הזו',
    diarisationSetup: 'זיהוי דוברים אינו מותקן. ההחלפה האוטומטית משתמשת בעוצמת המיקרופונים בלבד',
    syncTitle: 'סנכרון זוויות', syncOpen: 'בדיקת הסנכרון', syncColumns: { file: 'קובץ', verdict: 'מצב', offset: 'היסט', drift: 'סחיפה', peak: 'יחס השיאים', residual: 'שארית' }, ppm: (v) => `${v} חלקים למיליון`, seconds: (v) => `${v} שניות`,
    nudgeFrame: 'הזזה בפריים', nudgeMs: 'הזזה באלפית שנייה', nudgeValue: (k, v) => (v === 0 ? 'ללא הזזה' : `${Math.abs(v)} ${k === 'frame' ? 'פריימים' : 'אלפיות שנייה'} ${v > 0 ? 'מאוחר יותר' : 'מוקדם יותר'}`), nudgeLater: 'מאוחר יותר', nudgeEarlier: 'מוקדם יותר',
    candidates: 'התאמות אפשריות', candidateLine: (o, s) => `היסט ${o}, ציון ${s}`, capturePriorLine: (o, p) => `היסט ${o} שניות, בטווח של ${p} שניות`,
    resyncAsk: 'הקובץ הזה סונכרן ביד. סנכרון מחדש ימחק את התיקון הידני', resyncDiscard: 'מחיקת התיקון וסנכרון מחדש', resyncKeep: 'השארת התיקון', resyncOverwrite: 'סנכרון מחדש', syncRunning: 'מסנכרן לפי הקול', syncFailed: 'הסנכרון לא הצליח', syncDone: 'הסנכרון הסתיים', close: 'סגירה', loading: 'טוען', refresh: 'רענון',
    reference: 'קובע את זמן הקבוצה', whyNoAudio: 'אין בקובץ קול', whyTooShort: 'הקובץ קצר מדי לסנכרון', unsyncedNote: 'אפשר להזיז ביד, או לבחור אחת מההתאמות האפשריות',
    libSelect: (name) => `בחירת ${name} לסנכרון וחיתוך`, libCount: (n) => `${n} קבצים נבחרו`, libHint: 'בוחרים 2 עד 9 קבצים של אותו אירוע', libNeed: 'צריך לפחות שני קבצים', libTooMany: 'אפשר עד תשעה קבצים', libClear: 'ניקוי הבחירה',
    stepCreate: 'יוצר קבוצה', stepSync: 'מסנכרן לפי הקול', stepReview: 'בדיקה', stepPlace: 'מניח על ציר הזמן', stepDone: 'התוכנית מוכנה', stepFailed: (w) => `נעצר: ${w}`, reviewIntro: 'הסנכרון של חלק מהקבצים אינו ודאי. אפשר לבדוק אותם ולתקן, או להמשיך כמו שהוא', reviewContinue: 'המשך לחיתוך', reviewCancel: 'עצירה כאן', reviewSyncDialog: 'פתיחת בדיקת הסנכרון', syncAgain: 'סנכרון מחדש',
    clipBlockTitle: 'זווית בתוכנית', angleList: 'זווית', appliedLook: (n) => `המראה הוחל על ${n} קטעים`, droppedLine: (w, n) => `${w}: הוסר ב־${n} קטעים`,
    badge: (n, l) => `${n} · ${l}`, dualMonoDone: 'הקול מורכז', groupsLabel: 'קבוצות מולטיקאם',
  },
  en: {
    region: 'Multicam', viewerLabel: 'Angle viewer', noProgram: 'No multicam program on the chosen video track', noProgramHint: 'Choose the program\'s video track (the ◎ button of the track) to switch angles with the number keys', group: 'Group',
    tile: (n, label) => `Angle ${n}: ${label}`, tilesLabel: 'Choose an angle', liveTiles: 'Live view', thumbnailNote: 'Thumbnail, not live',
    meter: (db) => `Level ${db} dB`, noMeter: 'No level measured', level: 'Level',
    reaction: 'Reaction time', reactionHint: 'How many frames back each cut is recorded, to make up for your reaction time', frames: (n) => `${n} frames`, recordHint: 'While recording, the number keys record a cut at the frame on screen. Stop or pause saves everything in one step', recordingNow: 'Recording',
    announceStart: 'Recording switches started', announceStop: 'Recording switches stopped', announceDiscard: 'Recording discarded, nothing was saved', saved: (n) => `${n} cuts saved`, skippedSome: (n, why) => `${n} cuts not saved: ${why}`, commitFailed: 'The cuts were not saved', partsNote: (n) => `A long recording is saved in ${n} parts`,
    cutAtPlayhead: 'Cut at the playhead', cutAt: (n) => `Cut to angle ${n} at the playhead`, wideCmd: 'Switch to the wide angle', angleCmd: (n) => `Switch to angle ${n}`, recordCmd: 'Record switches', discardCmd: 'Discard the recording of switches',
    speakersEmpty: 'No speakers defined yet', speakerName: 'Name', speakerMic: 'Microphone', speakerChannel: 'Channel', speakerShot: 'Shot angle', channelMix: 'All channels', channelN: (n) => `Channel ${n}`, shotWide: 'Wide', addSpeaker: 'Add speaker', removeSpeaker: 'Remove', saveSpeakers: 'Save speakers', speakersNote: 'Speakers are used only by auto-switch',
    autoIntro: 'Proposes cuts from the mic that is clearly loudest. You can see the plan before applying it', autoBasis: 'What it is based on', autoPlan: 'Plan', autoApply: 'Apply', autoRegenerate: 'Regenerate', autoStepsTitle: 'What it will do', autoNeedSpeakers: 'Auto-switch needs at least two speakers with microphones', autoDone: 'Auto-switch applied', autoFailed: 'Auto-switch did not work', autoUnsure: 'Unsure cuts', autoNotBuilt: 'Auto-switch is not available in this version yet',
    diarisationSetup: 'Speaker identification is not installed. Auto-switch uses mic levels only',
    syncTitle: 'Angle sync', syncOpen: 'Check sync', syncColumns: { file: 'File', verdict: 'State', offset: 'Offset', drift: 'Drift', peak: 'Peak ratio', residual: 'Residual' }, ppm: (v) => `${v} parts per million`, seconds: (v) => `${v} seconds`,
    nudgeFrame: 'Nudge by frames', nudgeMs: 'Nudge by milliseconds', nudgeValue: (k, v) => (v === 0 ? 'no nudge' : `${Math.abs(v)} ${k === 'frame' ? 'frames' : 'milliseconds'} ${v > 0 ? 'later' : 'earlier'}`), nudgeLater: 'later', nudgeEarlier: 'earlier',
    candidates: 'Possible matches', candidateLine: (o, s) => `Offset ${o}, score ${s}`, capturePriorLine: (o, p) => `Offset ${o} s, within ${p} s`,
    resyncAsk: 'This file was synced by hand. Syncing again discards the hand correction', resyncDiscard: 'Discard the correction and sync again', resyncKeep: 'Keep the correction', resyncOverwrite: 'Sync again', syncRunning: 'Syncing by sound', syncFailed: 'Sync did not work', syncDone: 'Sync finished', close: 'Close', loading: 'Loading', refresh: 'Refresh',
    reference: 'Sets group time', whyNoAudio: 'The file has no sound', whyTooShort: 'The file is too short to sync', unsyncedNote: 'Nudge by hand, or choose one of the possible matches',
    libSelect: (name) => `Select ${name} for Sync and cut`, libCount: (n) => `${n} files selected`, libHint: 'Choose 2 to 9 files of the same event', libNeed: 'At least two files are needed', libTooMany: 'Up to nine files', libClear: 'Clear the selection',
    stepCreate: 'Creating the group', stepSync: 'Syncing by sound', stepReview: 'Review', stepPlace: 'Placing on the timeline', stepDone: 'The program is ready', stepFailed: (w) => `Stopped: ${w}`, reviewIntro: 'Some files are not surely in sync. Check and fix them, or go on as it is', reviewContinue: 'Go on to cutting', reviewCancel: 'Stop here', reviewSyncDialog: 'Open the sync check', syncAgain: 'Sync again',
    clipBlockTitle: 'Angle in the program', angleList: 'Angle', appliedLook: (n) => `Look applied to ${n} segments`, droppedLine: (w, n) => `${w}: removed on ${n} segments`,
    badge: (n, l) => `${n} · ${l}`, dualMonoDone: 'Sound centred', groupsLabel: 'Multicam groups',
  },
};
export const signed = ARROW;
