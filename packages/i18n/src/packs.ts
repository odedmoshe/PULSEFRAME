/**
 * Interface strings of the content packs, the Hebrew title fonts and the built-in music (ADR-0022). Spread into `he` and
 * `en` (index.ts); Hebrew first, and the English dictionary must cover the same keys.
 * Namespaces of this track: `pack.*` (the pack fields a dialog asks for, where a pack's content comes from), `music.*` (the
 * label every unheard style carries, the tempo line of a built-in track, the section names, the moods), `font.*` (the font
 * picker's categories and tags), `template.notice.*` (what a plan decided by itself: core templateContract.ts
 * TEMPLATE_NOTICE_CODES), the operation name (`op.add_builtin_music`, op-wording.test.ts) and the error codes of the music
 * routes and the analyse guard (`error.code.*`).
 * The panels' own strings live next to them (apps/web/src/editor/packs.strings.ts, music.strings.ts, font.strings.ts).
 * Also here: the Hebrew wording of every refusal of add_builtin_music, of the planner's built-in-music refusals and of the
 * music routes (HE_PACKS), which refusals.ts adds to translateRefusal; packages/evals/src/packs-wording.test.ts keeps it in step
 * with core packOps.ts PACK_REFUSALS and provokes each refusal for real.
 */
export const PACKS_HE = {
  'op.add_builtin_music': 'הוספת מוזיקה מובנית',
  'error.code.known_by_construction': 'הקצב ידוע מהמתכון', 'error.code.music_not_built': 'מוזיקה מובנית עדיין לא נבנתה', 'error.code.synthesis_busy': 'יצירת צלילים עסוקה כרגע', 'error.code.music_invalid': 'המוזיקה שנוצרה לא עברה בדיקה',
  'error.code.music_timeout': 'יצירת המוזיקה ארכה יותר מדי', 'error.code.music_cancelled': 'יצירת המוזיקה בוטלה', 'error.code.invalid_option': 'הבחירה אינה אפשרית',
  // what a template plan decided by itself (TEMPLATE_NOTICE_CODES); nothing here needs an answer before applying
  'template.notice.field_missing': 'לשדה בכותרת אין ערך, ולכן נכתב הנוסח החלופי שלה',
  'template.notice.field_no_date': 'לתמונה שמתחת לכותרת אין תאריך צילום, ולכן נכתב הנוסח החלופי שלה',
  'template.notice.builtin_music_faded': 'המוזיקה המובנית ארוכה מהתמונות: היא נחתכת בתמונה האחרונה ונעלמת בהדרגה',
  'template.notice.element_dropped': 'אלמנט גרפי הושמט, כי היה מונח באותו מקום כמו אלמנט אחר של התבנית',
  'template.notice.removed_by_hand': 'פריטים שמחקתם ידנית מאז ההחלה הקודמת לא נוצרו שוב; אפשר להחזיר אותם ב«החזרת החלקים שנמחקו»',
  'template.notice.moved_back': 'פריטים שרק זזו ממקומם מאז ההחלה הקודמת, בלי שום שינוי אחר, נוצרו שוב במקומם בתבנית',
  // the pack fields of a title (templateContract.ts PACK_FIELD_KEYS): the labels of the dialog's fieldset «פרטים»
  'pack.fields': 'פרטים', 'pack.field.name': 'שם', 'pack.field.name2': 'שם נוסף', 'pack.field.age': 'גיל', 'pack.field.night': 'נר', 'pack.field.place': 'מקום', 'pack.field.when': 'מתי',
  'pack.field.date': 'תאריך הצילום', 'pack.field.atLighting': 'צולם בהדלקת הנרות של אותו ערב',
  'pack.source': 'נוצר בתוכנה הזו: צויר או הולחן בנוסחה, בלי תוכן של אחרים',
  // built-in music
  'music.unheard': 'מוזיקה מובנית — עוד לא הושמעה לאף אחד', 'music.approved': 'מוזיקה מובנית', 'music.knownFromRecipe': 'קצב ידוע מהמתכון',
  'music.source.none': 'בלי מוזיקה', 'music.source.library': 'שיר מהספרייה', 'music.source.builtin': 'מוזיקה מובנית',
  'music.fitNote': 'המוזיקה נבנית באורך התבנית ומסתיימת עם התמונה האחרונה',
  'music.section.intro': 'פתיחה', 'music.section.build': 'עלייה', 'music.section.peak': 'שיא', 'music.section.break': 'הפוגה', 'music.section.ending': 'סיום',
  'music.mood.festive': 'חגיגי', 'music.mood.happy': 'שמח', 'music.mood.calm': 'רגוע', 'music.mood.energetic': 'אנרגטי', 'music.mood.mellow': 'נינוח', 'music.mood.moving': 'מרגש',
  // font picker (fonts.ts FontCategory, FontTag)
  'font.category.sans': 'סנס', 'font.category.serif': 'סריף', 'font.category.display': 'כותרת', 'font.category.handwriting': 'כתב יד',
  'font.tag.rounded': 'מעוגל', 'font.tag.classic': 'קלאסי', 'font.tag.condensed': 'צר', 'font.tag.playful': 'שובב', 'font.tag.cursive': 'כתב רהוט', 'font.tag.bold': 'עבה',
  'font.nikudChecked': 'ניקוד נבדק', 'font.pairsWith': 'מתאים עם',
} as const;
export const PACKS_EN: Record<keyof typeof PACKS_HE, string> = {
  'op.add_builtin_music': 'Added built-in music',
  'error.code.known_by_construction': 'The beat is known from the recipe', 'error.code.music_not_built': 'Built-in music is not built yet', 'error.code.synthesis_busy': 'Sound making is busy right now', 'error.code.music_invalid': 'The music made did not pass its check',
  'error.code.music_timeout': 'Making the music took too long', 'error.code.music_cancelled': 'Making the music was cancelled', 'error.code.invalid_option': 'That choice is not possible',
  'template.notice.field_missing': 'A field of a title has no value, so its fallback words were used',
  'template.notice.field_no_date': 'A picture under a title has no capture date, so its fallback words were used',
  'template.notice.builtin_music_faded': 'The built-in music is longer than the pictures: it is cut at the last picture and fades out',
  'template.notice.element_dropped': 'A graphic element was left out because it would lie where another element of the template lies',
  'template.notice.removed_by_hand': 'Items you deleted by hand since the last run were not made again; "Restore deleted parts" brings them back',
  'template.notice.moved_back': 'Items that had only been moved since the last run, with nothing else changed, were made again on their places in the template',
  'pack.fields': 'Details', 'pack.field.name': 'Name', 'pack.field.name2': 'Second name', 'pack.field.age': 'Age', 'pack.field.night': 'Candle', 'pack.field.place': 'Place', 'pack.field.when': 'When',
  'pack.field.date': 'Date filmed', 'pack.field.atLighting': 'Filmed at that evening\'s candle lighting',
  'pack.source': 'Made in this build: drawn or composed by formula, no third-party content',
  'music.unheard': 'Built-in music — nobody has listened to it yet', 'music.approved': 'Built-in music', 'music.knownFromRecipe': 'Tempo known from the recipe',
  'music.source.none': 'No music', 'music.source.library': 'A song from the library', 'music.source.builtin': 'Built-in music',
  'music.fitNote': 'The music is made to the length of the template and ends with the last picture',
  'music.section.intro': 'Intro', 'music.section.build': 'Build', 'music.section.peak': 'Peak', 'music.section.break': 'Break', 'music.section.ending': 'Ending',
  'music.mood.festive': 'Festive', 'music.mood.happy': 'Happy', 'music.mood.calm': 'Calm', 'music.mood.energetic': 'Energetic', 'music.mood.mellow': 'Mellow', 'music.mood.moving': 'Moving',
  'font.category.sans': 'Sans', 'font.category.serif': 'Serif', 'font.category.display': 'Display', 'font.category.handwriting': 'Handwriting',
  'font.tag.rounded': 'Rounded', 'font.tag.classic': 'Classic', 'font.tag.condensed': 'Condensed', 'font.tag.playful': 'Playful', 'font.tag.cursive': 'Cursive', 'font.tag.bold': 'Bold',
  'font.nikudChecked': 'Vowel points checked', 'font.pairsWith': 'Pairs with',
};

/**
 * Hebrew wording of the refusals of this track, recognised by their shape like the other tables in refusals.ts:
 * add_builtin_music and attaching a known grid (core packOps.ts PACK_REFUSALS, in its order; its "asset … not found" is the
 * common sentence and is worded by the common table), the planner's built-in-music refusals (templatePlan.ts) and the server's
 * music refusals (apps/server/src/music.ts, http.ts).
 */
export const HE_PACKS: [RegExp, (m: RegExpExecArray) => string][] = [
  // packOps.ts PACK_REFUSALS
  [/^this file is not built-in music: it must be a sound-only file made by a music formula of this build$/, () => 'הקובץ הזה אינו מוזיקה מובנית: מוזיקה מובנית היא קובץ של קול בלבד שנוצר בנוסחה של התוכנה הזו'],
  [/^the beats of a known grid must be strictly ascending$/, () => 'הפעימות של מוזיקה מובנית חייבות להיות בסדר עולה'],
  [/^every bar start of a known grid must be one of its beats$/, () => 'כל תחילת תיבה של מוזיקה מובנית חייבת להיות אחת הפעימות שלה'],
  [/^every time of a known grid must lie inside the track, from 0 and before its end$/, () => 'כל זמן במוזיקה מובנית חייב להיות בתוך הקטע, מתחילתו ולפני סופו'],
  [/^the sections of a known grid must start at 0 and be strictly ascending$/, () => 'החלקים של מוזיקה מובנית חייבים להתחיל בתחילת הקטע ולבוא בסדר עולה'],
  // the planner (templatePlan.ts)
  [/^choose a music file or built-in music, not both$/, () => 'אפשר לבחור קובץ מוזיקה או מוזיקה מובנית, לא את שניהם'],
  [/^there is no built-in music style "[^"]*"$/, () => 'סגנון המוזיקה המובנית הזה אינו קיים בגרסה הזו'],
  [/^built-in music for this template would be (\d+) s long \((\d+) bars\); a built-in track is at most (\d+) s$/, (m) => `המוזיקה המובנית לתבנית הזו הייתה נמשכת ${m[1]} שניות (${m[2]} תיבות), ומוזיקה מובנית נמשכת לכל היותר ${m[3]} שניות. אפשר לבחור קצב כפול, פחות קבצים, או קובץ מוזיקה`],
  // the server
  [/^built-in music is not built in this version yet$/, () => 'מוזיקה מובנית עדיין לא נבנתה בגרסה הזו. אפשר לבחור קובץ מוזיקה מהספרייה, או תבנית בלי מוזיקה'],
  [/^the beats of this built-in music are known from its recipe; measuring them would replace exact beats, bars and sections with an estimate$/, () => 'הקצב של המוזיקה המובנית הזו ידוע מהמתכון שלה; מדידה הייתה מחליפה פעימות, תיבות וחלקים מדויקים בהערכה. אין צורך למדוד'],
  // the music routes (apps/server/src/music.ts; musicLayout's RangeErrors pass through as 400 invalid_option)
  [/^give exactly one of bars and fitSeconds$/, () => 'יש לבחור אורך אחד למוזיקה: מספר תיבות או משך בשניות'],
  [/^a seed is a whole number from 0 to (\d+)$/, (m) => `מספר הגרסה של המוזיקה הוא מספר שלם בין 0 ל־${m[1]}`],
  [/^fitSeconds is a positive number of seconds written "n" or "n\/d"$/, () => 'משך המוזיקה צריך להיות מספר חיובי של שניות'],
  [/^a preview is 1 to (\d+) whole bars$/, (m) => `השמעה לפני הוספה היא באורך של 1 עד ${m[1]} תיבות שלמות`],
  [/^music\.[a-z0-9-]+ is made in whole bars, at least (\d+); got (\S+)$/, (m) => `המוזיקה הזו נבנית בתיבות שלמות, לפחות ${m[1]} (התבקשו ${m[2]})`],
  [/^(\d+) bars of music\.[a-z0-9-]+ last (\d+) s; a built-in track is at most (\d+) s \((\d+) bars\)$/, (m) => `${m[1]} תיבות של המוזיקה הזו נמשכות ${m[2]} שניות, ומוזיקה מובנית נמשכת לכל היותר ${m[3]} שניות (${m[4]} תיבות)`],
  [/^too many pieces of built-in music are being made at the moment; this one was not started$/, () => 'יותר מדי קטעי מוזיקה מובנית נוצרים כרגע, ולכן הקטע הזה לא התחיל להיווצר. אפשר לנסות שוב בעוד רגע'],
  [/^making the built-in music took too long and was stopped$/, () => 'יצירת המוזיקה המובנית ארכה יותר מדי והופסקה. אפשר לנסות שוב בעוד רגע, או לבקש פחות תיבות'],
  [/^the built-in music was not made: the request was cancelled$/, () => 'המוזיקה המובנית לא נוצרה, כי הבקשה בוטלה'],
  [/^the built-in music that was made did not pass its check: /, () => 'המוזיקה המובנית שנוצרה לא עברה את הבדיקה שלה, ולכן לא נשמר דבר. זו תקלה בגרסה הזו, לא בבקשה'],
  [/^this credential may only propose edits, and built-in music cannot be proposed: it is added through an internal step that a proposal does not carry$/, () => 'ההרשאה הזו מאפשרת רק להציע עריכות, ואי אפשר להציע מוזיקה מובנית: היא נוספת בצעד פנימי שהצעה אינה נושאת'],
  // the day of GET /packs/suggest (and of GET /on-this-day, which says the same)
  [/^date must be a real day written YYYY-MM-DD \(the day on the viewer's own clock\)$/, () => 'התאריך אינו יום קיים בלוח השנה'],
];
