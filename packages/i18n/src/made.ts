/**
 * Strings of «קליפ מקוד» — a clip made by a page of code, drawn once into a transparent video (wave 8 motioncode; core
 * madeContract.ts). Spread into `he` and `en` (index.ts); Hebrew first, plural address, no gendered forms; the English dictionary
 * covers the same keys. Nobody has looked at a made clip: the result says so (made.unseen). The flash line is a measurement with its
 * numbers, never «בטוח». packages/evals/src/made-wording.test.ts keeps it in step.
 * Namespaces: `op.*`, `made.*` (the dialog and the Inspector line, W3), `made.check.*` (report lines), `made.fail.*` / `made.warn.*`
 * (job failures and warnings by `why`, W1 and W3).
 * Also here: HE_MADE, the Hebrew of every refusal of apply_made_clip (MADE_OP_REFUSALS) and of the made routes (MADE_API), each with
 * the next step.
 */
const ltr = (s: string) => `⁦${s}⁩`;

export const MADE_HE = {
  'op.apply_made_clip': 'קליפ מקוד',
  // entry and dialog (W3)
  'made.entry': 'קליפ מקוד', 'made.dialog.title': 'קליפ מקוד',
  'made.intro': 'קליפ קצר שדף קוד מצייר פעם אחת, והופך לקובץ וידאו שקוף בספרייה',
  'made.tiles': 'דפים מוכנים', 'made.length': 'אורך', 'made.seconds': '{n} שניות',
  'made.render': 'יצירה', 'made.place': 'הוספה לציר', 'made.library': 'לספרייה בלבד', 'made.replace': 'עדכון בכל המקומות ({n})',
  'made.edit': 'עריכה ויצירה מחדש', 'made.cancel': 'ביטול', 'made.stopAsk': 'לעצור את הציור?',
  'made.paste': 'הדבקת דף (מתקדם)', 'made.pasteHint': 'הדביקו דף HTML אחד. הדף מקבל את window.PF ומצייר פריים לפי מספרו',
  'made.progress': 'מצייר פריים {k} מתוך {n}', 'made.stage.encoding': 'מקודד את הקובץ', 'made.stage.checking': 'בודק את הקובץ', 'made.stage.fetching': 'מוריד קבצים שהדף ביקש',
  'made.result': 'התוצאה', 'made.play': 'ניגון', 'made.pause': 'השהיה',
  'made.unseen': 'נוצר בקוד — אף אחד עוד לא צפה בו',
  'made.browserPlays': 'כך הדפדפן מנגן את הקובץ — אף אחד עוד לא צפה בו',
  'made.inspector': 'קליפ שנוצר בקוד',
  'made.assistantOff': 'כתיבת דף בעזרת עוזר השפה — לא מחובר',
  // report lines (numbers in ltr)
  'made.check.determinism': 'נבדק: אותם פריימים בשני ציורים ({frames})',
  'made.check.flash': 'הבהובים: {black} בשנייה על שחור, {white} על לבן (נמדד על רקע שחור ולבן)',
  'made.check.alpha.yes': 'שקיפות: יש', 'made.check.alpha.no': 'שקיפות: אין (כל הפריים אטום)',
  'made.check.time': 'נמשך {s} שניות במחשב הזה (מדידה אחת)',
  'made.check.sandbox.none': 'הדפדפן רץ בלי ארגז החול של כרום',
  // job failures (MADE_JOB_FAILURES, by why)
  'made.fail.made_frame_timeout': 'הדף לא סיים לצייר את פריים {frame} בתוך {s} שניות. חפשו בדף לולאה שלא נגמרת',
  'made.fail.made_crashed': 'הדף קרס או זרק שגיאה בזמן הציור (הפירוט אומר מה). תקנו את השגיאה, או ציירו עם פחות זיכרון, ונסו שוב',
  'made.fail.made_job_timeout': 'הציור נמשך יותר מ־{m} דקות ונעצר. קצרו או פשטו את הקליפ ונסו שוב',
  'made.fail.made_empty': 'הקליפ ריק — לא צויר כלום. בדקו שהדף מצייר ושהצבעים לא שקופים לגמרי',
  'made.fail.made_decode_back': 'הקובץ לא שומר את מה שצויר (פריים {frame}). צרו שוב; אם זה חוזר, דווחו על הדף',
  'made.fail.made_frame_count': 'בקובץ יש {got} פריימים במקום {want}. צרו שוב; אם זה חוזר, דווחו על הדף',
  'made.fail.made_not_deterministic': 'הדף נותן ציור אחר לאותו פריים ({frame}) — כנראה הוא זוכר משהו בין פריימים. ציירו כל פריים רק לפי המספר שלו',
  'made.fail.made_navigated': 'הדף ניסה לעבור לכתובת אחרת בזמן הציור. הסירו מהדף ניווט, קישורים וטפסים',
  'made.fail.made_fetch_failed': 'לא הצלחנו להוריד את הקובץ {url} לפני הציור. בדקו את הכתובת, או הוסיפו את התמונה לפרויקט',
  'made.fail.made_restarted': 'הופסק בהפעלה מחדש — לחצו «יצירה» שוב',
  'made.fail.made_canceled': 'הציור נעצר. לחצו «יצירה» כשתרצו את הקליפ',
  // warnings (MADE_WARNINGS, by why)
  'made.warn.made_flash': 'הקליפ מהבהב {rate} פעמים בשנייה (נמדד על {on}) — מעל 3. האטו את שינויי האור, או השאירו אם זו הכוונה',
  'made.warn.made_no_sandbox': 'הדפדפן רץ בלי ארגז החול של כרום',
  'made.warn.made_clock': 'הדף קרא את השעון או מספר אקראי ({api}) בפריים {frame}. ציירו רק לפי מספר הפריים',
  'made.warn.made_static': 'הדף משתמש ב־{what} (בתו {at})',
  'made.warn.made_font_missing': 'הגופן {family} לא בקטלוג, ולכן צויר בגופן חלופי. בחרו גופן מהקטלוג',
  'made.warn.made_webgl_differs': 'דף ה־WebGL צייר {pixels} פיקסלים אחרת בפעם השנייה (פריים {frame}). הקליפ נשמר; במחשב או בכרטיס מסך אחר הוא עשוי להיראות מעט אחרת',
  'made.on.black': 'שחור', 'made.on.white': 'לבן',
  // what the page check refuses (facts) and the field check (W2: madeCheck.ts)
  'made.problem.too_large': 'הדף גדול מדי ({bytes} בתים לכל היותר). קצרו את הדף ושלחו שוב',
  'made.problem.nul': 'בדף יש תו NUL (בתו {at}). הסירו אותו ושלחו שוב',
  'made.problem.not_utf8': 'הדף לא נשמר כ־UTF-8 (בתו {at}). שמרו אותו כ־UTF-8 ושלחו שוב',
  'made.field.unknown': 'הערך {key} לא שייך לאף שדה של הדף. הסירו אותו',
  'made.field.colour': 'הצבע ב־{key} צריך להיות בצורה #rrggbb. תקנו את הצבע',
  'made.field.number': 'ב־{key} צריך להיות מספר. תקנו את הערך',
  'made.field.range': 'המספר ב־{key} מחוץ לטווח של השדה. בחרו מספר בתוך הטווח',
  'made.field.length': 'הטקסט ב־{key} ארוך מדי. קצרו אותו',
  'made.autoApply.refused': 'הקליפ נוצר אבל לא הוכנס לציר: {reason}. הוסיפו אותו מהתוצאה',
} as const;

export const MADE_EN: Record<keyof typeof MADE_HE, string> = {
  'op.apply_made_clip': 'Clip from code',
  'made.entry': 'Clip from code', 'made.dialog.title': 'Clip from code',
  'made.intro': 'A short clip a page of code draws once; it becomes a transparent video file in the library',
  'made.tiles': 'Ready pages', 'made.length': 'Length', 'made.seconds': '{n} seconds',
  'made.render': 'Render', 'made.place': 'Add to timeline', 'made.library': 'Library only', 'made.replace': 'Update everywhere ({n})',
  'made.edit': 'Edit and render again', 'made.cancel': 'Cancel', 'made.stopAsk': 'Stop drawing?',
  'made.paste': 'Paste a page (advanced)', 'made.pasteHint': 'Paste one HTML page. It receives window.PF and draws a frame from its number',
  'made.progress': 'Drawing frame {k} of {n}', 'made.stage.encoding': 'Encoding the file', 'made.stage.checking': 'Checking the file', 'made.stage.fetching': 'Fetching files the page asked for',
  'made.result': 'Result', 'made.play': 'Play', 'made.pause': 'Pause',
  'made.unseen': 'Made by code — nobody has watched it yet',
  'made.browserPlays': 'How the browser plays the file — nobody has watched it yet',
  'made.inspector': 'Clip made by code',
  'made.assistantOff': 'Writing a page with the language assistant — not connected',
  'made.check.determinism': 'Checked: the same frames in two drawings ({frames})',
  'made.check.flash': 'Flashes: {black} a second on black, {white} on white (measured on black and white)',
  'made.check.alpha.yes': 'Transparency: yes', 'made.check.alpha.no': 'Transparency: none (the whole frame is opaque)',
  'made.check.time': 'Took {s} seconds on this computer (one sample)',
  'made.check.sandbox.none': 'The browser ran without Chromium\'s sandbox',
  'made.fail.made_frame_timeout': 'The page did not finish drawing frame {frame} within {s} seconds. Look for a loop that never ends',
  'made.fail.made_crashed': 'The page crashed or threw an error while drawing (the detail says which). Fix the error, or draw with less memory, and try again',
  'made.fail.made_job_timeout': 'Drawing took longer than {m} minutes and was stopped. Make the clip shorter or simpler and try again',
  'made.fail.made_empty': 'The clip is empty: nothing was drawn. Check that the page draws and that the colours are not fully transparent',
  'made.fail.made_decode_back': 'The file does not keep what was drawn (frame {frame}). Render again; if it repeats, report the page',
  'made.fail.made_frame_count': 'The file has {got} frames instead of {want}. Render again; if it repeats, report the page',
  'made.fail.made_not_deterministic': 'The page draws frame {frame} differently the second time (it probably keeps something between frames). Draw each frame from its number only',
  'made.fail.made_navigated': 'The page navigated away while drawing. Remove navigation, links and forms from it',
  'made.fail.made_fetch_failed': 'The file {url} could not be fetched before drawing. Check the address, or add the picture to the project',
  'made.fail.made_restarted': 'Stopped by a restart — press Render again',
  'made.fail.made_canceled': 'Drawing was stopped. Press Render when you want the clip',
  'made.warn.made_flash': 'The clip flashes {rate} times a second (measured on {on}), above 3. Slow the changes of light, or keep it if you meant it',
  'made.warn.made_no_sandbox': 'The browser ran without Chromium\'s sandbox',
  'made.warn.made_clock': 'The page read the clock or a random number ({api}) at frame {frame}. Draw from the frame number only',
  'made.warn.made_static': 'The page uses {what} (at character {at})',
  'made.warn.made_font_missing': 'The font {family} is not in the catalogue, so a fallback face was used. Choose a catalogue font',
  'made.warn.made_webgl_differs': 'The WebGL page drew {pixels} pixels differently the second time (frame {frame}). It was kept; on another computer or graphics card it may look slightly different',
  'made.on.black': 'black', 'made.on.white': 'white',
  'made.problem.too_large': 'The page is too large (at most {bytes} bytes). Shorten it and send it again',
  'made.problem.nul': 'The page has a NUL character (at character {at}). Remove it and send it again',
  'made.problem.not_utf8': 'The page was not saved as UTF-8 (at character {at}). Save it as UTF-8 and send it again',
  'made.field.unknown': 'The value {key} belongs to no field of the page. Remove it',
  'made.field.colour': 'The colour in {key} must be written #rrggbb. Correct it',
  'made.field.number': '{key} must be a number. Correct the value',
  'made.field.range': 'The number in {key} is outside the field\'s range. Choose one within it',
  'made.field.length': 'The text in {key} is too long. Shorten it',
  'made.autoApply.refused': 'The clip was made but not placed: {reason}. Add it from the result',
};

/** Hebrew of the refusals of apply_made_clip (core MADE_OP_REFUSALS) and of the made routes (MADE_API), each with the next step. */
export const HE_MADE: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^apply_made_clip: clips made by a page are not built in this build yet$/, () => 'קליפ מקוד עוד לא נבנה בגרסה הזו של העורך. שום דבר לא השתנה; עדכנו את העורך ונסו שוב'],
  [/^this file was not made from a page \(it has no made record\)$/, () => 'הקובץ הזה לא נוצר מדף. צרו אותו קודם («יצירה»), ואז הוסיפו את התוצאה'],
  [/^a clip made by a page is a video file$/, () => 'קליפ מקוד הוא קובץ וידאו. הוסיפו את הקובץ שהציור יצר'],
  [/^place or replace, not both$/, () => 'אפשר להוסיף או להחליף, לא את שניהם. בחרו אחד מהשניים, או «לספרייה בלבד»'],
  [/^no clip shows the file (\S+)$/, () => 'הקליפ הזה לא נמצא בציר. בחרו קובץ שנמצא בציר, או הוסיפו את הקליפ החדש'],
  [/^the new file is shorter than clip (\S+) that uses the old one \(it needs (\d+) frames\)$/, (m) => `הקובץ החדש קצר מהקליפ שבציר (צריך ${ltr(m[2]!)} פריימים). צרו אותו שוב באותו אורך, או קצרו קודם את הקליפ`],
  [/^clips made by a page are not built in this version yet$/, () => 'קליפ מקוד עוד לא נבנה בגרסה הזו של העורך. שום דבר לא השתנה; עדכנו את העורך ונסו שוב'],
  [/^the machine is already drawing as many clips as it can$/, () => 'המחשב כבר מצייר כמה קליפים שהוא יכול. חכו שציור יסתיים ונסו שוב'],
  [/^agents are paused in this project$/, () => 'הסוכנים מושהים בפרויקט הזה. חדשו את הסוכנים ונסו שוב'],
  [/^no such render job in this project$/, () => 'אין ציור כזה בפרויקט. בחרו ציור מרשימת העבודות'],
  [/^the render job has not finished successfully$/, () => 'הציור עוד לא הסתיים בהצלחה. חכו שיסתיים ונסו שוב'],
  [/^this render was already brought into the project$/, () => 'התוצאה של הציור הזה כבר נמצאת בפרויקט. השתמשו בקובץ שנוצר'],
  [/^the page cannot be drawn as sent$/, () => 'אי אפשר לצייר את הדף כמו שנשלח. תקנו את מה שמופיע ברשימה ושלחו שוב'],
  [/^this file was not made from a page$/, () => 'הקובץ הזה לא נוצר מדף, ולכן אי אפשר לערוך אותו ולצייר מחדש. בחרו קליפ שנוצר בקוד'],
  // the made routes' own refusals (apps/server/src/made/routes.ts MADE_ROUTE_REFUSALS)
  [/^this render was started by another credential$/, () => 'את הציור הזה התחיל מישהו אחר. השתמשו בציורים שלכם; בעורך עצמו רואים את כולם'],
  [/^no built-in page is named (\S+)$/, (m) => `אין דף מוכן בשם ${ltr(m[1]!)}. בחרו דף מהרשימה, או הדביקו דף משלכם`],
  [/^the values do not fit the fields of the page$/, () => 'הערכים לא מתאימים לשדות של הדף. תקנו את מה שמופיע ברשימה: צבע כ־#rrggbb, מספר בתוך הטווח, טקסט באורך המותר'],
  [/^the page names files that are not in this project$/, () => 'הדף משתמש בקבצים שאינם בפרויקט הזה. בחרו קבצים מהספרייה של הפרויקט'],
];
