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
  'bar.refusal.nothing_selected': 'לא נבחר קליפ',
  'bar.refusal.no_clip_here': 'אין קליפ במקום הזה',
  'bar.refusal.no_title': 'אין כותרת שאפשר לבחור',
  'bar.refusal.no_music_track': 'אין רצועת מוזיקה מזוהה: למוזיקה אין ניתוח פעימות',
  'bar.refusal.locked': 'הרצועה נעולה',
  'bar.refusal.out_of_range': 'המספר מחוץ לטווח',
  'bar.refusal.too_many_ops': `יותר מדי שינויים לבקשה אחת (עד ${ltr('200')})`,
  'bar.refusal.op_refused': 'הפעולה נדחתה',
  'bar.refusal.recording': 'אי אפשר בזמן הקלטה של הופעה',
  'bar.refusal.nothing_to_undo': 'אין מה לבטל',
  'bar.refusal.nothing_to_redo': 'אין מה לבצע שוב',
  'bar.refusal.gain_ceiling': 'העוצמה המבוקשת גבוהה מהמקסימום',
  'bar.refusal.half_frame': 'פריים הוא היחידה הקטנה ביותר',
  'bar.refusal.nothing_to_do': 'אין מה לשנות',
  'bar.refusal.unknown_name': 'לא מצאתי את השם הזה',
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
};
export const COMMAND_BAR_EN: Record<keyof typeof COMMAND_BAR_HE, string> = {
  'bar.title': 'Command bar',
  'assistant.notConnected': 'Language assistant not connected', 'assistant.howToConnect': 'How to connect', 'assistant.title': 'Language assistant',
  'bar.projectChanged': 'The project changed — check again',
  'assistant.toggle.titlesAndMarkers': 'Send the wording of titles and markers', 'assistant.toggle.peopleNames': 'Send people\'s names',
  'assistant.proposeOnly': 'The assistant only proposes. Nothing changes until you accept',
  'bar.refusal.nothing_selected': 'No clip is selected',
  'bar.refusal.no_clip_here': 'There is no clip here',
  'bar.refusal.no_title': 'There is no title to choose',
  'bar.refusal.no_music_track': 'No music track found: no music has a beat analysis',
  'bar.refusal.locked': 'The track is locked',
  'bar.refusal.out_of_range': 'The number is out of range',
  'bar.refusal.too_many_ops': 'Too many changes for one request (up to 200)',
  'bar.refusal.op_refused': 'The action was refused',
  'bar.refusal.recording': 'Not while a performance take is being recorded',
  'bar.refusal.nothing_to_undo': 'Nothing to undo',
  'bar.refusal.nothing_to_redo': 'Nothing to redo',
  'bar.refusal.gain_ceiling': 'That volume is above the maximum',
  'bar.refusal.half_frame': 'A frame is the smallest unit',
  'bar.refusal.nothing_to_do': 'Nothing to change',
  'bar.refusal.unknown_name': 'I did not find that name',
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
};
