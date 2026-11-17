/**
 * Strings and fixed data-testids of the voice cleanup block «ניקוי קול» (ADR-0013), mounted at the top of AudioFxBlock (W2).
 * Hebrew first; English covers the same keys (cleanup.strings.test.ts). The data-testids are fixed by the lead's contracts pass:
 * the proofs and the accessibility audit find the block by them. W2 owns this file and may add keys; it may not rename these.
 * Nobody has listened to the cleanup yet: nothing here says how it sounds.
 */
export const VOICE_CLEAN_TESTIDS = {
  block: 'voice-clean', run: 'voice-clean-run', status: 'voice-clean-status', strength: 'voice-clean-strength', remove: 'voice-clean-remove',
  before: 'voice-clean-before', after: 'voice-clean-after', scopeAsset: 'voice-clean-scope-asset', unlistened: 'voice-clean-unlistened',
  sourceWarning: 'voice-clean-source-warning', disabled: 'voice-clean-disabled',
} as const;
export const VOICE_CLEAN_STRINGS = {
  he: {
    title: 'ניקוי קול', run: 'נקה את הקול', measuring: 'מודד…', remove: 'הסר ניקוי', strength: 'עוצמת הניקוי',
    before: 'לפני', after: 'אחרי', scopeAsset: 'החל על כל הקטעים מאותה הקלטה', unlistened: 'טרם נבדק בהאזנה', undoLabel: 'ניקוי קול',
    what: 'מודד את ההקלטה ומוסיף הסרת זמזום חשמל (אם נמצא), הפחתת רעש רקע קבוע ושיפור דיבור. עיבוד קול רגיל, בלי בינה מלאכותית.',
    measured: 'נמדד:', noise: 'רעש רקע', hum: 'זמזום חשמל', humNone: 'לא נמצא זמזום חשמל', hz: 'הרץ', speech: 'דיבור', snr: 'יחס אות לרעש',
    confidence: 'ביטחון במדידת הרעש', unknown: 'לא ידוע', db: 'דציבל', dbfs: 'דציבל ביחס לשיא',
    noPause: 'לא נמצאה הפסקה שקטה: פרופיל הרעש נלקח מהקטעים השקטים ביותר, וייתכן שיש בהם דיבור, ולכן הניקוי עלול להחליש גם את הקול.',
    rangesShort: 'קטעי הרעש שסומנו קצרים מ־0.3 שניות בסך הכול, ולכן נמדדו הקטעים השקטים ביותר.',
    applied: 'הניקוי הוחל על {n} קטעים. אפשר לבטל ב־Ctrl+Z.', appliedOne: 'הניקוי הוחל על הקטע. אפשר לבטל ב־Ctrl+Z.',
    nothingApplied: 'לא נוסף ניקוי: הקטעים מההקלטה הזו נעולים או שאינם יכולים לשאת אפקטי קול.', removed: 'הניקוי הוסר.',
    failed: 'המדידה נכשלה:',
    sourceOther: 'פרופיל הרעש של הקטע הזה נמדד בהקלטה אחרת:', sourceGeneric: 'פרופיל הרעש של הקטע הזה כללי ולא נמדד בהקלטה שלו. «נקה את הקול» ימדוד אותו.',
    disabledLocked: 'הרצועה נעולה; יש לבטל את הנעילה כדי לנקות את הקול.',
    disabledTimeMap: 'ניקוי קול עדיין לא פועל על קול ששומר על גובה הצליל במהירות אחרת, או שהמהירות שלו משתנה בהדרגה. יש לתת לקטע מהירות אחת ולתת לגובה הצליל ללכת אחריה, ואז לנקות.',
    noCleanup: 'עוד אין ניקוי בקטע הזה: עוצמה, השוואה והסרה יפעלו אחרי «נקה את הקול».',
    noPlayer: 'ההשמעה אינה זמינה כאן, ולכן אין השוואה לפני ואחרי.',
    listenBefore: 'השמעה לדוגמה בלי הניקוי (לא נשמר)', listenAfter: 'השמעה לדוגמה עם הניקוי (לא נשמר)',
    ai: 'ניקוי חזק יותר, במודל בינה מלאכותית, הוא כלי נפרד בכלי ה־AI («ניקוי קול בבינה מלאכותית»): הוא יוצר קובץ קול חדש, כשהוא מותקן.',
  },
  en: {
    title: 'Voice cleanup', run: 'Clean up the voice', measuring: 'Measuring…', remove: 'Remove cleanup', strength: 'Cleanup strength',
    before: 'Before', after: 'After', scopeAsset: 'Apply to every clip of the same recording', unlistened: 'Not yet checked by listening', undoLabel: 'Voice cleanup',
    what: 'Measures the recording and adds mains hum removal (when hum is found), steady background noise reduction and speech enhancement. Ordinary sound processing, no AI model.',
    measured: 'Measured:', noise: 'background noise', hum: 'mains hum', humNone: 'no mains hum found', hz: 'Hz', speech: 'speech', snr: 'signal to noise',
    confidence: 'confidence in the noise measurement', unknown: 'unknown', db: 'dB', dbfs: 'dBFS',
    noPause: 'No quiet pause was found: the noise profile comes from the quietest stretches, which may hold speech, so the cleanup may also weaken the voice.',
    rangesShort: 'The noise stretches marked add up to less than 0.3 s, so the quietest stretches were measured instead.',
    applied: 'Cleanup applied to {n} clips. Ctrl+Z undoes it.', appliedOne: 'Cleanup applied to the clip. Ctrl+Z undoes it.',
    nothingApplied: 'No cleanup was added: the clips of this recording are locked or cannot carry sound effects.', removed: 'The cleanup was removed.',
    failed: 'Measuring failed:',
    sourceOther: 'The noise profile of this clip was measured on another recording:', sourceGeneric: 'The noise profile of this clip is generic, not measured on its recording. «Clean up the voice» measures it.',
    disabledLocked: 'The track is locked; unlock it to clean up the voice.',
    disabledTimeMap: 'Voice cleanup does not work yet on a sound that keeps its pitch at another speed, or whose speed changes gradually. Give the clip one speed and let its pitch follow it, then clean up.',
    noCleanup: 'This clip has no cleanup yet: strength, comparing and removing work after «Clean up the voice».',
    noPlayer: 'Playback is not available here, so there is no before and after.',
    listenBefore: 'Listen without the cleanup (not saved)', listenAfter: 'Listen with the cleanup (not saved)',
    ai: 'A stronger cleanup with an AI model is a separate AI tool («Voice cleanup with AI»): it makes a new sound file, when it is set up.',
  },
} as const;
export type VoiceCleanLang = keyof typeof VOICE_CLEAN_STRINGS;
export type VoiceCleanKey = keyof (typeof VOICE_CLEAN_STRINGS)['he'];
