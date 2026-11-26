/** Words of the Captions mode panel (UX_REDESIGN §4.9): the speech engine's honest state and the transcript header. No file paths. */
export const CAP_STRINGS = {
  he: {
    title: 'תמלול', phrases: (n: number) => `${n} משפטים`, search: 'חיפוש מילה בתמלול', searchLabel: 'חיפוש מילה בתמלול',
    engine: 'מנוע דיבור', ready: 'מוכן', prep: (gb: string) => `הכנה חד־פעמית · ${gb} · רק באישורכם`, off: 'לא זמין כאן', why: 'למה?', howTo: 'איך מגדירים',
    cpu: 'ירוץ על המעבד, לאט יותר', gpu: 'ירוץ על כרטיס המסך',
    prepNote: 'מודל הזיהוי יורד פעם אחת למחשב הזה. אחרי זה הכול רץ במחשב הזה, בלי חיבור לרשת.',
    notConfigured: 'זיהוי הדיבור האוטומטי דורש תוכנה נלווית שעדיין לא מותקנת במחשב הזה. אפשר לייבא קובץ כתוביות (SRT או VTT) או להקליד תמלול ביד.',
    notConfiguredHow: ['בעלי המחשב יכולים ללחוץ על «התקנת מנוע הדיבור» כאן, בחלון העורך שלהם.', 'מעדיפים ביד: ההוראות בקובץ docs/QUICKSTART.he.md, חלק ב (סביבת Python ומשתנה PF_SPEECH_PYTHON), ואחר כך מפעילים את העורך מחדש.', 'אחרי זה הכפתור "זיהוי דיבור" יהיה זמין כאן.'],
    broken: 'מנוע זיהוי הדיבור מותקן אבל לא עובד.', brokenDetail: 'פרטים למי שמתקין',
    empty: 'עוד אין תמלול. ייבאו קובץ כתוביות או זהו את הדיבור אוטומטית.',
    makeCaptions: 'יצירת כתוביות', clickToSeek: 'לחיצה על מילה קופצת אליה בציר הזמן',
    wordsHint: 'לחיצה על מילה מעבירה את הסמן אליה; Shift מרחיב בחירה',
  },
  en: {
    title: 'Transcript', phrases: (n: number) => `${n} phrases`, search: 'Find a word in the transcript', searchLabel: 'Find a word in the transcript',
    engine: 'Speech engine', ready: 'Ready', prep: (gb: string) => `One-time setup · ${gb} · only with your approval`, off: 'Not available here', why: 'Why?', howTo: 'How to set up',
    cpu: 'Runs on the processor, slower', gpu: 'Runs on the graphics card',
    prepNote: 'The recognition model downloads once to this computer. After that everything runs here, with no network.',
    notConfigured: 'Automatic speech recognition needs a companion program that is not installed on this computer yet. You can import a subtitle file (SRT or VTT) or type a transcript by hand.',
    notConfiguredHow: ['The computer\'s owner can press "Install the speech engine" here, in their own editor window.', 'By hand instead: the steps are in docs/QUICKSTART.he.md, part B (a Python environment and the PF_SPEECH_PYTHON variable); then start the editor again.', 'After that the "Recognise speech" button is available here.'],
    broken: 'The speech engine is installed but does not work.', brokenDetail: 'Details for whoever installs',
    empty: 'No transcript yet. Import a subtitle file or recognise the speech automatically.',
    makeCaptions: 'Make captions', clickToSeek: 'Clicking a word jumps to it on the timeline',
    wordsHint: 'Clicking a word moves the playhead to it; Shift extends the selection',
  },
} as const;
