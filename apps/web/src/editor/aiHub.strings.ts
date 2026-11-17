/**
 * Owner-language strings of the AI hub and Copilot (UX_REDESIGN §4.11). The cards say what a tool does and what state it is in;
 * how to set one up sits behind a "how to set up" disclosure and never names an environment variable or a file path.
 */
export const HUB_STRINGS = {
  he: {
    title: 'כלי AI',
    counts: (ready: number, setup: number, off: number) => [`${ready} מוכנים`, `${setup} דורשים הגדרה`, ...(off ? [`${off} לא זמינים`] : [])].join(' · '),
    privacy: 'הכול רץ במחשב שלך; הסרטון לא נשלח החוצה',
    jobs: 'עבודות שרצות', jobsNone: '',
    pill: {
      ready: 'מוכן במחשב הזה', running: (pct: string) => `רץ ${pct}`, runningNoPct: 'רץ',
      prep: (gb: string) => `הכנה חד־פעמית · ${gb} · רק באישורכם`,
      setup: 'דורש הגדרה', off: 'לא זמין כאן',
    },
    why: 'למה?', howTo: 'איך מגדירים', whyOff: 'למה לא זמין', technical: 'פרטים למי שמתקין', recheck: 'בדיקה חוזרת',
    needGpu: 'דורש כרטיס מסך',
    steps: {
      provider_not_configured: ['כלי התמונה והווידאו האלה רצים דרך תוכנה חינמית בשם ComfyUI. מתקינים אותה במחשב הזה ומפעילים אותה.', 'את החיבור שלה לעורך מגדיר מי שמתקין את העורך במחשב.', 'אחרי שהיא פועלת, לוחצים "בדיקה חוזרת".'],
      provider_unreachable: ['התוכנה ComfyUI מוגדרת אבל לא עונה. בודקים שהיא פועלת.', 'אם היא פועלת ועדיין אין חיבור, צריך לבדוק את החיבור שהוגדר לה.', 'לוחצים "בדיקה חוזרת".'],
      engine_not_configured: ['הכלי הזה צריך תוכנה נלווית שעדיין לא מותקנת במחשב. העורך לא מתקין תוכנות בעצמו.', 'מי שמתקין את העורך מוסיף אותה ומפעיל את העורך מחדש.', 'אחרי זה לוחצים "בדיקה חוזרת".'],
      engine_not_working: ['התוכנה הנלווית מותקנת אבל לא עובדת. פרטי התקלה מופיעים בפרטים למי שמתקין.', 'צריך לתקן את ההתקנה שלה.', 'אחרי זה לוחצים "בדיקה חוזרת".'],
      engine_unverified: ['התוכנה הנלווית שמותקנת אינה הגרסה שנבדקה, ולכן העורך לא מריץ אותה.', 'צריך להתקין את הגרסה שנבדקה, בלי שינוי.', 'אחרי זה לוחצים "בדיקה חוזרת".'],
      model_missing: ['הכלי צריך להוריד קבצי מודל פעם אחת. זה קורה רק אחרי שאתם מאשרים.', 'לוחצים "בקשת הורדה", ואז מאשרים בלשונית הסקירה.'],
      licence_blocked: ['הרישיון של המודל לא מתיר שימוש בגרסה הזאת של העורך, ולכן הוא לא יורד ולא רץ.', 'אפשר להשתמש בכלי אחר.'],
      host_not_allowed: ['האתר שממנו מורידים את המודל לא ברשימת האתרים המותרים.', 'מי שמתקין את העורך יכול להוסיף אותו, או להניח את הקבצים ידנית.', 'אחרי זה לוחצים "בדיקה חוזרת".'],
      disk_insufficient: ['אין מספיק מקום פנוי בדיסק להורדת המודל.', 'צריך לפנות מקום ואז ללחוץ "בדיקה חוזרת".'],
    } as Record<string, string[]>,
    comfyHow: 'חיבור כלי התמונה והווידאו', connectTest: 'בדיקת חיבור',
    // copilot
    cop: { title: 'עוזר', subtitle: 'עוזר העריכה', chat: 'שיחה', receipts: 'קבלות', guide: 'הדרכה', run: 'ביצוע', mode: 'מצב העוזר',
      off: 'העוזר לא מחובר', offWhy: 'העוזר צריך חיבור למודל שפה, והוא עדיין לא הוגדר. עד אז אפשר לערוך ביד, לחפש פקודות ב־Ctrl K ולהשתמש בכלי ה־AI. שום דבר לא נשלח החוצה.', offHow: 'איך מחברים',
      offSteps: ['מי שמתקין את העורך מחבר אליו מודל שפה (מפתח אישי של ספק לבחירתכם).', 'אחרי החיבור, העוזר יציע תוכנית של שינויים שאפשר לאשר אחד אחד, ולא יעשה דבר לפני שתאשרו.'],
      plan: 'תוכנית', planEmpty: 'כשהעוזר יתחבר, התוכנית שלו תופיע כאן: צעדים שאפשר לסמן ולאשר יחד כעסקה אחת.',
      composer: 'בקשו מהעוזר…', composerOff: 'העוזר לא מחובר',
      receiptsEmpty: 'עוד אין קבלות. כשעוזר או סוכן יערכו את הפרויקט, כל שינוי יירשם כאן, עם קפיצה לרגע בציר ואפשרות לבטל.',
      by: 'בוצע על ידי', agent: 'סוכן', undo: 'החזרה', undoWhy: 'יש עריכות מאוחרות יותר, אז אי אפשר לבטל רק את זה', jump: 'מעבר לרגע',
      refused: 'סורב', ago: (s: number) => (s < 60 ? 'ברגע זה' : s < 3600 ? `לפני ${Math.floor(s / 60)} דק׳` : `לפני ${Math.floor(s / 3600)} שע׳`) },
  },
  en: {
    title: 'AI tools',
    counts: (ready: number, setup: number, off: number) => [`${ready} ready`, `${setup} need setup`, ...(off ? [`${off} unavailable`] : [])].join(' · '),
    privacy: 'Everything runs on your computer; the video is not sent out',
    jobs: 'Running jobs', jobsNone: '',
    pill: {
      ready: 'Ready on this computer', running: (pct: string) => `Running ${pct}`, runningNoPct: 'Running',
      prep: (gb: string) => `One-time setup · ${gb} · only with your approval`,
      setup: 'Needs setup', off: 'Not available here',
    },
    why: 'Why?', howTo: 'How to set up', whyOff: 'Why not available', technical: 'Details for whoever installs', recheck: 'Check again',
    needGpu: 'Needs a graphics card',
    steps: {
      provider_not_configured: ['These picture and video tools run through a free program called ComfyUI. Install it on this computer and start it.', 'Whoever installs the editor on this computer connects it to the editor.', 'Once it is running, press "Check again".'],
      provider_unreachable: ['ComfyUI is set up but does not answer. Check that it is running.', 'If it is running and there is still no connection, the connection set for it needs checking.', 'Press "Check again".'],
      engine_not_configured: ['This tool needs a companion program that is not installed on this computer yet. The editor does not install programs by itself.', 'Whoever installs the editor adds it and starts the editor again.', 'Then press "Check again".'],
      engine_not_working: ['The companion program is installed but does not work. The fault is shown under details for whoever installs.', 'Its installation needs repairing.', 'Then press "Check again".'],
      engine_unverified: ['The installed companion program is not the reviewed build, so the editor does not run it.', 'Install the reviewed build, unchanged.', 'Then press "Check again".'],
      model_missing: ['The tool needs to download model files once. That happens only after you approve it.', 'Press "Ask for the download", then approve it in the Review tab.'],
      licence_blocked: ["The model's licence does not allow use in this version of the editor, so it is neither downloaded nor run.", 'You can use another tool.'],
      host_not_allowed: ['The site the model is downloaded from is not on the allowed list.', 'Whoever installs the editor can add it, or place the files by hand.', 'Then press "Check again".'],
      disk_insufficient: ['There is not enough free disk space for the model download.', 'Free some space, then press "Check again".'],
    } as Record<string, string[]>,
    comfyHow: 'Connecting the picture and video tools', connectTest: 'Connection test',
    cop: { title: 'Assistant', subtitle: 'Editing assistant', chat: 'Chat', receipts: 'Receipts', guide: 'Guide', run: 'Do it', mode: 'Assistant mode',
      off: 'The assistant is not connected', offWhy: 'The assistant needs a connection to a language model, which has not been set up yet. Until then you can edit by hand, search commands with Ctrl K and use the AI tools. Nothing is sent out.', offHow: 'How to connect',
      offSteps: ['Whoever installs the editor connects a language model to it (a personal key from a provider of your choice).', 'Once connected, the assistant proposes a plan of changes you can approve one by one, and does nothing before you approve.'],
      plan: 'Plan', planEmpty: 'When the assistant is connected, its plan shows here: steps you can tick and approve together as one transaction.',
      composer: 'Ask the assistant…', composerOff: 'The assistant is not connected',
      receiptsEmpty: 'No receipts yet. When an assistant or agent edits the project, each change is recorded here, with a jump to the moment on the timeline and a way to undo.',
      by: 'Done by', agent: 'an agent', undo: 'Undo', undoWhy: 'There are later edits, so this one cannot be undone alone', jump: 'Go to the moment',
      refused: 'Refused', ago: (s: number) => (s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`) },
  },
} as const;
export type HubStrings = (typeof HUB_STRINGS)['he'] | (typeof HUB_STRINGS)['en'];

export type PillKind = 'ready' | 'running' | 'prep' | 'setup' | 'off';
/** The status pill of a tool card, from the setup state the server reports. Pure. */
export function pillKind(setupCode: string, runnable: boolean, running: boolean, missingBytes: number): PillKind {
  if (running) return 'running';
  if (setupCode === 'ready') return runnable ? 'ready' : 'off';
  if ((setupCode === 'model_missing' || setupCode === 'disk_insufficient' || setupCode === 'host_not_allowed') && missingBytes > 0) return setupCode === 'model_missing' ? 'prep' : 'setup';
  if (setupCode === 'licence_blocked' || setupCode === 'engine_not_working' || setupCode === 'engine_unverified') return 'off';
  return 'setup';
}
