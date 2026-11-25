/**
 * Shared interface strings of the Hebrew command bar (ADR-0027; «שורת פקודות») and its language assistant: the fixed product
 * wording the lead decided (.artifacts/wave5-decisions.md, "Hebrew command bar"), the words of the contract's codes (core
 * commandBarContract.ts BAR_REFUSAL_CODES; assistantContract.ts ASSISTANT_SETUP_CODES, ASSISTANT_ERROR_CODES,
 * ASSISTANT_NEVER_SENT, ASSISTANT_STAGES) and the error headlines of the assistant's routes. Spread into `he` and `en`
 * (index.ts); Hebrew first, and the English dictionary covers the same keys. The bar's own phrases (headings, footers, the
 * detail sentence of each step, the Settings fields) are W3's, in apps/web/src/editor/commandBar/commandBar.strings.ts.
 * No string here says the assistant is connected or that a model answered: wave 1 has no network adapter
 * (command-bar-wording.test.ts).
 */
const ltr = (s: string) => `⁦${s}⁩`;

export const COMMAND_BAR_HE = {
  // the decided wording
  'bar.title': 'שורת פקודות',
  'assistant.notConnected': 'עוזר השפה לא מחובר', 'assistant.howToConnect': 'איך מחברים', 'assistant.title': 'עוזר השפה',
  'bar.projectChanged': 'הפרויקט השתנה — בדקו שוב',
  'assistant.toggle.titlesAndMarkers': 'לשלוח נוסח כותרות וסמנים', 'assistant.toggle.peopleNames': 'לשלוח שמות אנשים',
  'assistant.proposeOnly': 'העוזר רק מציע. שום דבר לא משתנה עד שתאשרו',
  // why the bar runs nothing (core BAR_REFUSAL_CODES)
  'bar.refusal.nothing_selected': 'לא נבחר קליפ; בחרו קליפ בציר הזמן, או אחד מהקליפים שבסמן',
  'bar.refusal.no_clip_here': 'אין קליפ במקום הזה; הזיזו את הסמן אל תוך קליפ',
  'bar.refusal.no_title': 'אין כותרת שאפשר לבחור; בחרו כותרת בציר הזמן',
  'bar.refusal.no_music_track': 'אין רצועת מוזיקה מזוהה: למוזיקה אין ניתוח פעימות; נתחו את הפעימות של המוזיקה, או בחרו רצועה מהרשימה',
  'bar.refusal.locked': 'הרצועה נעולה; יש לבטל את הנעילה כדי לערוך בה',
  'bar.refusal.out_of_range': 'המספר מחוץ לטווח; בקשו מספר או זמן קטנים יותר, בתוך הפרויקט',
  'bar.refusal.too_many_ops': `יותר מדי שינויים לבקשה אחת (עד ${ltr('200')}); צמצמו את הבקשה, למשל לקליפים הנבחרים`,
  'bar.refusal.op_refused': 'הפעולה נדחתה; הסיבה כתובה כאן — תקנו אותה ונסו שוב',
  'bar.refusal.recording': 'אי אפשר בזמן הקלטה של הופעה; עצרו את ההקלטה ונסו שוב',
  'bar.refusal.nothing_to_undo': 'אין מה לבטל; אחרי שינוי בפרויקט אפשר יהיה לבטל אותו',
  'bar.refusal.nothing_to_redo': 'אין מה לבצע שוב; אפשר לבצע שוב רק פעולה שבוטלה',
  'bar.refusal.gain_ceiling': `העוצמה המבוקשת גבוהה מהמקסימום (פי ${ltr('4')} לרצועה, פי ${ltr('8')} לקליפ); בקשו הגברה קטנה יותר`,
  'bar.refusal.half_frame': 'פריים הוא היחידה הקטנה ביותר; בקשו מספר שלם של פריימים',
  'bar.refusal.nothing_to_do': 'אין מה לשנות, זה כבר כך; נסחו בקשה אחרת',
  'bar.refusal.unknown_name': 'לא מצאתי את השם הזה; בחרו שם מהרשימה בחלונית האפקטים, המראות או המעברים',
  // the assistant's setup state (core ASSISTANT_SETUP_CODES)
  'assistant.setup.ready': 'עוזר השפה מוגדר',
  'assistant.setup.provider_not_configured': 'עוזר השפה לא מחובר',
  'assistant.setup.prices_missing': 'חסרים מחירים: הקלידו את המחיר למיליון אסימונים של הקלט ושל הפלט',
  'assistant.setup.limit_missing': 'חסרה מגבלת הוצאה: קבעו מגבלה חודשית ותקרה לבקשה אחת',
  'assistant.setup.host_not_allowed': 'כתובת השירות אינה ברשימת הכתובות המותרות',
  'assistant.setup.prompt_digest_mismatch': 'ההנחיות לעוזר השתנו מאז שנבדקו',
  // the job's stage, in words (never a percentage)
  'assistant.stage.sending': 'שולח', 'assistant.stage.awaiting-provider': 'ממתין לתשובה', 'assistant.stage.checking': 'בודק את ההצעה',
  // never sent, whatever the switches (core ASSISTANT_NEVER_SENT)
  'assistant.never.media': 'תמונות, סרטונים וקול', 'assistant.never.file_names': 'שמות קבצים', 'assistant.never.capture': 'תאריכי צילום, פרטי מכשיר ומקומות',
  'assistant.never.events': 'אירועים', 'assistant.never.transcripts': 'תמלולים וכתוביות', 'assistant.never.analyses': 'ניתוחים, מלבד מספר הפעימות והקצב',
  'assistant.never.provenance': 'מאיפה הגיע כל קובץ', 'assistant.never.recipe_params': 'ההגדרות של מתכונים', 'assistant.never.birth_dates': 'תאריכי לידה ופרטי משפחה',
  // error headlines of the assistant's routes (core ASSISTANT_ERROR_CODES; owner_required is shared)
  'error.code.assistant_not_connected': 'עוזר השפה לא מחובר', 'error.code.budget_exceeded': 'הבקשה הייתה עוברת את מגבלת ההוצאה, ולא נשלחה',
  'error.code.invalid_model_output': 'התשובה של העוזר לא תקינה, ושום דבר לא שונה', 'error.code.provider_error': 'שירות העוזר החזיר שגיאה',
  'error.code.submission_unknown': 'לא ידוע אם הבקשה הגיעה לשירות, וייתכן שחויבה. היא לא תישלח שוב לבד',
  // headlines of the other codes the assistant's routes and job answer with (ASSISTANT_EXTRA_ERROR_CODES)
  'error.code.summary_too_large': 'התיאור של הפרויקט ארוך מדי לשליחה', 'error.code.agent_paused': 'הסוכנים מושהים בפרויקט הזה',
  'error.code.budget_error': 'לא הצלחנו לשמור סכום לבקשה, ולכן היא לא נשלחה', 'error.code.nothing_to_release': 'אין סכום שמור לשחרר',
  // the bar and Settings: a server sentence that has no Hebrew wording is shown as sent, marked
  'refusal.untranslated': 'בלשון השרת, לא תורגם',
};
export const COMMAND_BAR_EN: Record<keyof typeof COMMAND_BAR_HE, string> = {
  'bar.title': 'Command bar',
  'assistant.notConnected': 'Language assistant not connected', 'assistant.howToConnect': 'How to connect', 'assistant.title': 'Language assistant',
  'bar.projectChanged': 'The project changed — check again',
  'assistant.toggle.titlesAndMarkers': 'Send the wording of titles and markers', 'assistant.toggle.peopleNames': 'Send people\'s names',
  'assistant.proposeOnly': 'The assistant only proposes. Nothing changes until you accept',
  'bar.refusal.nothing_selected': 'No clip is selected; select a clip on the timeline, or one of the clips at the playhead',
  'bar.refusal.no_clip_here': 'There is no clip here; move the playhead into a clip',
  'bar.refusal.no_title': 'There is no title to choose; select a title on the timeline',
  'bar.refusal.no_music_track': 'No music track found: no music has a beat analysis; analyse the music\'s beats, or pick a track from the list',
  'bar.refusal.locked': 'The track is locked; unlock it to edit it',
  'bar.refusal.out_of_range': 'The number is out of range; ask for a smaller number or a time inside the project',
  'bar.refusal.too_many_ops': 'Too many changes for one request (up to 200); narrow the request, for example to the selected clips',
  'bar.refusal.op_refused': 'The action was refused; the reason is written here — fix it and try again',
  'bar.refusal.recording': 'Not while a performance take is being recorded; stop the take and try again',
  'bar.refusal.nothing_to_undo': 'Nothing to undo; once the project changes, you can undo it',
  'bar.refusal.nothing_to_redo': 'Nothing to redo; only an action that was undone can be redone',
  'bar.refusal.gain_ceiling': 'That volume is above the maximum (4× for a track, 8× for a clip); ask for a smaller boost',
  'bar.refusal.half_frame': 'A frame is the smallest unit; ask for a whole number of frames',
  'bar.refusal.nothing_to_do': 'Nothing to change, it is already so; ask for something else',
  'bar.refusal.unknown_name': 'I did not find that name; pick a name from the effects, looks or transitions panel',
  'assistant.setup.ready': 'The language assistant is set up',
  'assistant.setup.provider_not_configured': 'Language assistant not connected',
  'assistant.setup.prices_missing': 'Prices are missing: type the price per million input and output tokens',
  'assistant.setup.limit_missing': 'No spending limit: set a monthly limit and a cap per request',
  'assistant.setup.host_not_allowed': 'The service address is not on the list of allowed addresses',
  'assistant.setup.prompt_digest_mismatch': 'The assistant\'s instructions changed since they were reviewed',
  'assistant.stage.sending': 'Sending', 'assistant.stage.awaiting-provider': 'Waiting for the answer', 'assistant.stage.checking': 'Checking the proposal',
  'assistant.never.media': 'Pictures, videos and sound', 'assistant.never.file_names': 'File names', 'assistant.never.capture': 'Capture dates, device details and places',
  'assistant.never.events': 'Events', 'assistant.never.transcripts': 'Transcripts and captions', 'assistant.never.analyses': 'Analyses, except the beat count and tempo',
  'assistant.never.provenance': 'Where each file came from', 'assistant.never.recipe_params': 'Recipe settings', 'assistant.never.birth_dates': 'Birth dates and family details',
  'error.code.assistant_not_connected': 'Language assistant not connected', 'error.code.budget_exceeded': 'The request would pass the spending limit and was not sent',
  'error.code.invalid_model_output': 'The assistant\'s answer was not valid; nothing was changed', 'error.code.provider_error': 'The assistant\'s service returned an error',
  'error.code.submission_unknown': 'It is not known whether the request reached the service, and it may have been charged. It will not be sent again by itself',
  'error.code.summary_too_large': 'The project description is too long to send', 'error.code.agent_paused': 'Agents are paused on this project',
  'error.code.budget_error': 'No amount could be reserved for the request, so it was not sent', 'error.code.nothing_to_release': 'There is no reserved amount to release',
  'refusal.untranslated': 'in the server\'s words, not translated',
};
/** Codes the assistant's routes and job answer with besides core ASSISTANT_ERROR_CODES (host_not_allowed's headline is index.ts's, worded for any site). */
export const ASSISTANT_EXTRA_ERROR_CODES = ['summary_too_large', 'host_not_allowed', 'agent_paused', 'budget_error', 'nothing_to_release', 'invalid_request', 'not_found', 'internal_error'] as const;

/**
 * The Hebrew wording of the assistant's server refusals (apps/server/src/assistant/*.ts, governance.ts reserveAssistant, the
 * summary route in http.ts and the job errors), which refusals.ts adds to translateRefusal. Each sentence is the reason, then
 * «; » and the next step, so the Hebrew owner never needs the server's English hint (lead decision: a refusal in the bar or in
 * Settings gives a Hebrew next step). command-bar-wording.test.ts provokes each message from the server's own code and checks
 * it is worded here.
 */
const SETUP_HE: Record<string, string> = {
  provider_not_configured: 'עוזר השפה לא מחובר: בגרסה הזו אין מתאם רשת, ולכן עוד אי אפשר לחבר אותו; שורת הפקודות עובדת גם בלעדיו',
  prices_missing: 'חסרים מחירים לעוזר השפה; הקלידו בהגדרות, בחלק «עוזר השפה», את המחיר למיליון אסימונים של הקלט ושל הפלט',
  limit_missing: 'חסרה מגבלת הוצאה לעוזר השפה; קבעו בהגדרות, בחלק «עוזר השפה», גם מגבלה חודשית וגם תקרה לבקשה אחת',
  host_not_allowed: `כתובת השירות של עוזר השפה אינה ברשימת הכתובות המותרות; הוסיפו אותה ל־${ltr('PF_ASSISTANT_HOSTS')} והפעילו את השרת מחדש, או בחרו כתובת מהרשימה`,
  prompt_digest_mismatch: 'ההנחיות לעוזר השפה השתנו מאז שנבדקו; שום דבר לא יישלח עד שההנחיות החדשות ייבדקו',
  ready: 'עוזר השפה מוגדר; אפשר לבקש שוב',
};
const BILLING_HE = 'בדקו את החיובים אצל השירות, ואם לא חויבתם, שחררו את הסכום השמור של הבקשה הזו';
export const HE_ASSISTANT: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^the language assistant is set up and used from the owner's own session only$/, () => 'את עוזר השפה מגדירים ומפעילים רק מהחיבור של בעלי הפרויקט; פתחו את העורך מהקישור של הבעלים והגדירו אותו בהגדרות'],
  // cancelling a request (routes.ts assistantCancelRefusal; POST /jobs/:jobId/cancel and MCP cancel_job answer an agent credential with it)
  [/^a language-assistant request belongs to the owner's own session, so an agent credential cannot cancel it$/, () => 'בקשה לעוזר השפה שייכת לחיבור של בעלי הפרויקט, ולכן סוכן אינו יכול לבטל אותה; בקשו מבעלי הפרויקט לבטל אותה בשורת הפקודות שבעורך («ביטול הבקשה»), או המתינו: היא מסתיימת כשהשירות עונה, ויוצרת רק הצעה שהבעלים מאשרים או דוחים'],
  // releasing a held amount (visibility.ts budgetReleaseRefusal: what POST /jobs/:jobId/budget/release answers an agent credential; governance.ts releaseUnknown)
  [/^a reserved amount is released from the owner's own session only, so an agent credential cannot release it$/, () => 'סכום שמור משחררים רק מהחיבור של בעלי הפרויקט, ולכן סוכן אינו יכול לשחרר אותו; בקשו מבעלי הפרויקט לבדוק את החיובים אצל השירות ולשחרר את הסכום בעורך («שחרור הסכום השמור»)'],
  [/^this job has no unresolved reservation$/, () => 'לבקשה הזו כבר אין סכום שמור: הוא שוחרר, נסגר לפי העלות, או שהבקשה לא נשלחה; פתחו את ההגדרות, בחלק «עוזר השפה», כדי לראות את הסכומים המעודכנים של החודש'],
  [/^the language assistant is reached over https only$/, () => `הפנייה לעוזר השפה נעשית רק ב־${ltr('https')}; כתבו רק את שם השרת, למשל ${ltr('api.example.com')}`],
  [/^the host (\S+) is not listed in PF_ASSISTANT_HOSTS$/, (m) => `הכתובת ${ltr(m[1]!)} אינה ברשימה ${ltr('PF_ASSISTANT_HOSTS')}; הוסיפו בדיוק את הכתובת הזאת לרשימה, הפעילו את השרת מחדש ושמרו שוב`],
  [/^this request (?:is estimated to|could) cost more than the per-request cap$/, () => 'הבקשה עלולה לעלות יותר מהתקרה לבקשה אחת, ולכן לא נשלחה; קצרו את הבקשה, או הגדילו בהגדרות את התקרה לבקשה אחת'],
  [/^this would exceed the monthly limit of the language assistant$/, () => 'הבקשה הייתה עוברת את המגבלה החודשית של עוזר השפה, ולכן לא נשלחה; חכו לחודש הבא, או הגדילו בהגדרות את המגבלה החודשית'],
  [/^the owner has not set both the monthly limit and the per-request cap$/, () => SETUP_HE.limit_missing!],
  [/^the language assistant is not set up \((\w+)\): /, (m) => SETUP_HE[m[1]!] ?? 'עוזר השפה לא מוגדר; פתחו את ההגדרות, בחלק «עוזר השפה», והשלימו את מה שחסר'],
  [/^the selection and the tracks alone take more than (\d+) bytes to describe$/, (m) => `הקליפים הנבחרים והרצועות לבדם ארוכים מדי לתיאור (יותר מ־${ltr(m[1]!)} בתים); בחרו פחות קליפים ובקשו שוב`],
  [/a price is more than 0 cents per million tokens/, () => `מחיר חייב להיות יותר מ־${ltr('0')} סנט למיליון אסימונים; הקלידו את המחיר מרשימת המחירים של השירות (למשל ${ltr('300')} עבור ${ltr('$3')} למיליון אסימונים)`],
  [/^playheadFrame is a whole, non-negative frame index$/, () => `מיקום הסמן צריך להיות מספר פריים שלם, לא שלילי; שלחו את הסמן כמספר פריים, למשל ${ltr('playheadFrame=90')}`],
  // the job's own errors (job.ts), shown when a request ends without a proposal
  [/^the server stopped before the request was sent; nothing was sent and the reservation was released$/, () => 'השרת נעצר לפני שהבקשה נשלחה, ושום דבר לא נשלח; הסכום השמור שוחרר, ואפשר לבקש שוב'],
  [/^the server stopped after the service answered and before its answer was checked; the cost is recorded as spent and nothing is left to release; no proposal was made$/, () => 'השרת נעצר אחרי שהשירות ענה ולפני שהתשובה נבדקה: העלות נרשמה כהוצאה ואין סכום לשחרר, ולא נוצרה הצעה; אפשר לבקש שוב אם עדיין רוצים את השינוי'],
  [/^the server stopped while the request was with the service; it may have been charged/, () => `השרת נעצר בזמן שהבקשה הייתה אצל השירות, ייתכן שחויבה, והיא לא תישלח שוב לבד; ${BILLING_HE}`],
  [/^it is not known whether the service received the request; it may have been charged and it is not sent again/, () => `לא ידוע אם השירות קיבל את הבקשה, ייתכן שחויבה, והיא לא תישלח שוב לבד; ${BILLING_HE}`],
  [/^the service could not be reached; nothing was sent/, () => 'לא הצלחנו להגיע לשירות, ושום דבר לא נשלח; בדקו את החיבור לרשת ואת כתובת השירות בהגדרות, ובקשו שוב'],
  [/^the service refused the request \((\w+)\)/, (m) => `השירות סירב לבקשה (${ltr(m[1]!)}); בדקו בהגדרות את המפתח, את הכתובת ואת שם המודל, ובקשו שוב`],
  [/^the project owner has paused agents on this project$/, () => 'הסוכנים מושהים בפרויקט הזה, ולכן הבקשה לעוזר השפה לא נשלחה; חדשו את פעולת הסוכנים ובקשו שוב'],
  [/^the owner paused agents on this project/, () => 'הסוכנים מושהים בפרויקט הזה, ולכן לא נוצרה הצעה; חדשו את פעולת הסוכנים ובקשו שוב'],
  [/^the adapter or the key went away before the request was sent; nothing was sent$/, () => 'המתאם או המפתח הוסרו לפני שהבקשה נשלחה, ושום דבר לא נשלח; בדקו את ההגדרות של עוזר השפה ובקשו שוב'],
  [/^canceled by \S+ before anything was sent$/, () => 'הבקשה בוטלה לפני שנשלח משהו, ושום דבר לא חויב; אפשר לבקש שוב'],
  [/^canceled; the service was not reached, nothing was sent$/, () => 'הבקשה בוטלה, השירות לא הושג ושום דבר לא נשלח; אפשר לבקש שוב'],
  [/^canceled while the request was with the service; it may have been charged$/, () => `הבקשה בוטלה בזמן שהייתה אצל השירות, וייתכן שחויבה; ${BILLING_HE}`],
  [/^canceled; the answer that arrived was discarded$/, () => 'הבקשה בוטלה, והתשובה שהגיעה נזרקה; אפשר לבקש שוב'],
];
