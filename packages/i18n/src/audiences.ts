/**
 * Strings of «גרסה לכל קהל» — a version for every audience (wave 8 audiences track; core audienceContract.ts). Spread into `he` and
 * `en` (index.ts); Hebrew first, plural address, no gendered forms; the English dictionary covers the same keys. Levels are always
 * said relative to the rest of the mix («ביחס לשאר הקול»); no string calls a version safe, suitable or checked, and every sound row is
 * «לא נשמע» (packages/evals/src/audiences-wording.test.ts). The calm version says what it does NOT do (audience.notHandled.*).
 * Namespaces: `op.*`, `error.code.*`, `audience.*` (the interface; W3 reads them through editor/audience/audience.strings.ts).
 * Also here: HE_AUDIENCES, the Hebrew of every refusal of the three operations (core AUDIENCE_REFUSALS) and of the route
 * (AUDIENCE_API_REFUSALS), each with the next step.
 */
const AUDIENCES_HE_BASE = {
  'op.add_audience_version': 'הוספת גרסה לקהל', 'op.update_audience_version': 'שינוי גרסה לקהל', 'op.set_audience_keep': 'השארה כמו במקור בגרסה לקהל',
  'error.code.audience_not_built': 'גרסה לקהל עוד לא נבנתה בגרסה הזו של העורך', 'error.code.not_audience_version': 'זה פורמט, לא גרסה לקהל',
} as const;
const AUDIENCES_EN_BASE: Record<keyof typeof AUDIENCES_HE_BASE, string> = {
  'op.add_audience_version': 'Added a version for an audience', 'op.update_audience_version': 'Changed a version for an audience', 'op.set_audience_keep': 'Kept as in the original in a version',
  'error.code.audience_not_built': 'Versions for an audience are not built in this build yet', 'error.code.not_audience_version': 'This is a format, not a version for an audience',
};
/** `audience.<key>`; {placeholders} are filled by audience.strings.ts. Numbers and times are drawn in <bdi dir="ltr"> by the components. */
export const AUDIENCES_EXTRA = {
  he: {
    'group': 'גרסה לקהל', 'calm': 'גרסה רגועה', 'grandparents': 'לסבא וסבתא',
    'calm.desc': 'בלי הבזקים ורעידות, מעברים רכים, מוזיקה שקטה יותר', 'grandparents.desc': 'כותרות וכתוביות גדולות יותר, מוזיקה שקטה יותר',
    'panel': 'מה שונה בגרסה הזו', 'changes': 'שינויים', 'fastCuts': 'חיתוכים מהירים — לא שונו', 'sound': 'קול', 'notHandledTitle': 'מה הגרסה לא עושה',
    'none': 'אין בגרסה הזו מה לשנות בסרט כפי שהוא עכשיו', 'keep': 'להשאיר כמו במקור', 'giveBack': 'להחזיר את השינוי', 'kept': 'נשאר כמו במקור',
    'jump': 'מעבר לרגע {time}', 'wholeFilm': 'כל הסרט', 'unheard': 'לא נשמע', 'unseen': 'לא נצפה', 'send': 'לשליחה', 'working': 'מחשבים…',
    'notBuilt': 'גרסה לקהל עוד לא נבנתה בגרסה הזו של העורך',
    'stage': '{name} · {n} שינויים · לא נצפתה',
    'rule.effect': '{name} כובה', 'rule.modulator': 'הקפיצות לפי הקצב ב{name} הוסרו', 'rule.transition': '{name} ← מעבר רך',
    'rule.text_loop': 'הרעד של הכותרת הוסר', 'rule.title_size': 'הכותרת גדולה יותר', 'rule.caption_look': 'הכתוביות גדולות יותר, עם רקע',
    'rule.music_level': 'המוזיקה נמוכה ב־{db} dB ביחס לשאר הקול', 'rule.ducking': 'המוזיקה יורדת מתחת לדיבור עוד {db} dB',
    'fastCut': '{cuts} חיתוכים בתוך {seconds} שניות (סף: {limit}; הערכה לפי חלון זמן)',
    'musicDb': 'עוצמת המוזיקה (dB, ביחס לשאר הקול)', 'musicDefault': 'ברירת המחדל של הגרסה',
    'role.music': 'מוזיקה', 'role.speech': 'דיבור', 'role.other': 'אחר', 'role.auto': 'לפי הכלל',
    'why.owner': 'כפי שבחרתם', 'why.music_files': 'כל הקליפים בערוץ הם מוזיקה מהספרייה, מוזיקה מובנית או מוזיקה שהותאמה',
    'why.duck_source': 'ערוץ אחר יורד מתחתיו', 'why.narration': 'קריינות', 'why.mixed': 'יש בערוץ גם קליפים שאינם מוזיקה, ולכן הוא לא שונה',
    'why.empty': 'אין קליפים בערוץ', 'why.unknown': 'לא ידוע מה נשמע בערוץ (למשל קול המצלמה), ולכן הוא לא שונה',
    'notHandled.pace': 'הגרסה לא משנה את קצב החיתוכים: חיתוכים מהירים מופיעים ברשימה ונשארים כמו שהם.',
    'notHandled.keys': 'תנועות ושינויי בהירות שנעשו בנקודות מפתח לא מזוהים ונשארים כמו שהם.',
    'notHandled.not_medical': 'זו לא הבטחה רפואית: אף אחד לא בדק שהגרסה מתאימה לרגישות לאור.',
    'notHandled.flash_check': 'בדיקת ההבזקים של הייצוא היא מדידה, לא אישור.',
    'notHandled.sound_unheard': 'אף אחד כאן לא שמע את הקול; כל שינוי בקול מסומן «לא נשמע».',
  },
  en: {
    'group': 'Version for an audience', 'calm': 'Calm version', 'grandparents': 'For grandparents',
    'calm.desc': 'No flashes or shaking, soft transitions, quieter music', 'grandparents.desc': 'Larger titles and captions, quieter music',
    'panel': 'What is different in this version', 'changes': 'Changes', 'fastCuts': 'Fast cuts — not changed', 'sound': 'Sound', 'notHandledTitle': 'What this version does not do',
    'none': 'Nothing in the film as it is now is changed in this version', 'keep': 'Keep as in the original', 'giveBack': 'Apply the change again', 'kept': 'Kept as in the original',
    'jump': 'Go to {time}', 'wholeFilm': 'The whole film', 'unheard': 'Not listened to', 'unseen': 'Not watched', 'send': 'To send', 'working': 'Working…',
    'notBuilt': 'Versions for an audience are not built in this build yet',
    'stage': '{name} · {n} changes · not watched',
    'rule.effect': '{name} turned off', 'rule.modulator': 'Beat kicks on {name} removed', 'rule.transition': '{name} → soft dissolve',
    'rule.text_loop': 'The title\'s jitter removed', 'rule.title_size': 'The title is larger', 'rule.caption_look': 'Captions larger, with a box',
    'rule.music_level': 'Music {db} dB lower relative to the rest of the sound', 'rule.ducking': 'Music dips {db} dB further under speech',
    'fastCut': '{cuts} cuts within {seconds} s (limit {limit}; an estimate over a time window)',
    'musicDb': 'Music level (dB, relative to the rest of the sound)', 'musicDefault': 'The version\'s default',
    'role.music': 'Music', 'role.speech': 'Speech', 'role.other': 'Other', 'role.auto': 'By the rule',
    'why.owner': 'As you chose', 'why.music_files': 'Every clip on the track is library music, built-in music or fitted music',
    'why.duck_source': 'Another track dips under it', 'why.narration': 'Narration', 'why.mixed': 'The track also holds clips that are not music, so it is not changed',
    'why.empty': 'The track has no clips', 'why.unknown': 'What the track holds is not known (camera sound, say), so it is not changed',
    'notHandled.pace': 'The version does not change the pace of the cutting: fast cuts are listed and stay as they are.',
    'notHandled.keys': 'Movements and brightness changes made with keyframes are not recognised and stay as they are.',
    'notHandled.not_medical': 'This is not a medical promise: nobody has checked that the version suits light sensitivity.',
    'notHandled.flash_check': 'The export\'s flash check is a measurement, not an approval.',
    'notHandled.sound_unheard': 'Nobody here has listened to the sound; every sound change is marked «not listened to».',
  },
} as const;
type Prefixed<O> = { readonly [K in keyof O & string as `audience.${K}`]: O[K] };
const prefixed = <O extends Record<string, string>>(o: O): Prefixed<O> => Object.fromEntries(Object.entries(o).map(([k, v]) => [`audience.${k}`, v])) as Prefixed<O>;
export const AUDIENCES_HE = { ...AUDIENCES_HE_BASE, ...prefixed(AUDIENCES_EXTRA.he) };
export const AUDIENCES_EN: Record<keyof typeof AUDIENCES_HE, string> = { ...AUDIENCES_EN_BASE, ...prefixed(AUDIENCES_EXTRA.en) };

/** The Hebrew of every audiences refusal, each with the next step. */
export const HE_AUDIENCES: [RegExp, (m: RegExpExecArray) => string][] = [
  // core AUDIENCE_REFUSALS
  [/^(\w+): versions for an audience are not built in this build yet$/, () => 'גרסה לקהל עוד לא נבנתה בגרסה הזו של העורך. שום דבר לא השתנה; אפשר לעדכן את העורך ולנסות שוב'],
  [/^version (\S+) is not in the project$/, () => 'הגרסה לא נמצאה. בחרו גרסה מרשימת הפורמטים'],
  [/^format (\S+) is a format, not a version for an audience$/, () => 'זה פורמט, לא גרסה לקהל. בחרו גרסה שנוצרה מהתפריט «גרסה לקהל»'],
  [/^track (\S+) is not in the project$/, () => 'הערוץ לא נמצא. בחרו ערוץ קול מציר הזמן'],
  [/^track (\S+) is not a sound track; only sound tracks have a role$/, () => 'רק לערוץ קול יש תפקיד. בחרו ערוץ קול'],
  [/^clip (\S+) is not in the project$/, () => 'הקליפ לא נמצא. בחרו קליפ מציר הזמן'],
  [/^clip (\S+) is a sound clip; the kept rules are about pictures and titles$/, () => 'זה קליפ קול, וההשארה כמו במקור היא לתמונות ולכותרות. את עוצמת המוזיקה משנים בתפקיד של הערוץ'],
  [/^rule (\w+) cannot be kept in a (\w+) version$/, () => 'את השינוי הזה אי אפשר להשאיר כמו במקור בגרסה הזו. ברשימת השינויים מופיעים אלה שאפשר'],
  [/^rule (\w+) does not apply to clip (\S+)$/, () => 'השינוי הזה לא חל על הקליפ הזה. גודל ורעד חלים על כותרות, ומעבר על קליפ תמונה'],
  // the route (AUDIENCE_API_REFUSALS)
  [/^the change list of a version for an audience is not built in this build yet$/, () => 'רשימת השינויים של גרסה לקהל עוד לא נבנתה בגרסה הזו של העורך. שום דבר לא השתנה'],
];
