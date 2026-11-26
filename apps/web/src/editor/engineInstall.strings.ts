/**
 * Words of «התקנת מנוע הדיבור» (the speech panel's setup state; server: apps/server/src/speechEngine.ts). Plural address, no
 * gendered forms; nothing says the transcription will be accurate. Every failure pairs what happened with the next step.
 */
type Vars = Record<string, string>;
const PY_HE = (v: string) => `התקינו את Python ${v} מהאתר הרשמי python.org: בעמוד ההורדות ל-Windows בחרו «Windows installer (64-bit)» (קובץ בשם python-${v}.<מספר>-amd64.exe), ובמסך הראשון של ההתקנה סמנו «Add python.exe to PATH». אחר כך סגרו את העורך, הפעילו אותו שוב ולחצו כאן שוב.`;
const PY_EN = (v: string) => `Install Python ${v} from the official site python.org: on the Windows downloads page choose "Windows installer (64-bit)" (a file named python-${v}.<number>-amd64.exe), and on the installer's first screen tick "Add python.exe to PATH". Then close the editor, start it again and press here again.`;
/** The Python version the instructions name: the one the pinned set ran with here. */
export const RECOMMENDED_PYTHON = '3.13';

export const ENGINE_STRINGS = {
  he: {
    title: 'התקנת מנוע הדיבור',
    intro: 'אפשר להתקין את מנוע הדיבור מכאן, בלי שורת פקודה.',
    what: (v: { mb: string; files: string; python: string }) => `יוריד כ-${v.mb} MB (${v.files} קבצים) מ-pypi.org ויתקין בתיקיית הנתונים של העורך; לא מותקן דבר מחוץ לתיקייה הזו. ההתקנה משתמשת ב-Python ${v.python} שכבר נמצא במחשב.`,
    whatNoPython: (v: { mb: string; files: string }) => `יוריד כ-${v.mb} MB (${v.files} קבצים) מ-pypi.org ויתקין בתיקיית הנתונים של העורך; לא מותקן דבר מחוץ לתיקייה הזו.`,
    model: 'מודל הזיהוי (כ-1.62 GB) הוא שלב נפרד: אחרי ההתקנה יופיע כאן הכפתור להורדתו.',
    noPromise: 'ההתקנה לא מבטיחה שהתמלול יהיה מדויק: בדקו את הטקסט לפני שמשתמשים בו.',
    install: 'התקנת מנוע הדיבור', reinstall: 'התקנה מחדש',
    confirm: 'להתקין עכשיו?', yes: 'כן, להתקין', no: 'לא עכשיו',
    cancel: 'ביטול ההתקנה',
    done: 'מנוע הדיבור הותקן.',
    canceled: 'ההתקנה בוטלה; מה שהותקן בחלקו נמחק.',
    brokenInstalled: 'מנוע הדיבור שהותקן מכאן לא עונה. אפשר להתקין אותו מחדש:',
    environment: 'העורך משתמש במנוע דיבור שהוגדר בהפעלה (PF_SPEECH_PYTHON), ולכן ההתקנה מכאן לא מוצעת.',
    unsupported: 'במחשב הזה אי אפשר להתקין מכאן: ההתקנה מכאן קיימת רק ל-Windows ול-Linux על מעבד 64 ביט של Intel או AMD.',
    pipLines: 'השורות האחרונות של תוכנת ההתקנה (שמות תיקיות והמשתמש הוסרו)',
    step: (v: { n: string; of: string }) => `שלב ${v.n} מתוך ${v.of}`,
    stages: {
      python: 'מחפשים את Python במחשב', venv: 'יוצרים סביבה נפרדת בתיקיית הנתונים', download: (v: { done: string; total: string }) => `מורידים ובודקים קובץ ${v.done} מתוך ${v.total}`,
      install: 'מתקינים', check: 'בודקים שהמנוע נטען', removing: 'מוחקים את מה שהותקן בחלקו', queued: 'ממתינים שעבודה אחרת תסתיים', other: 'עובדים',
    },
    failures: {
      python_not_found: { what: () => 'לא נמצא Python במחשב.', next: () => PY_HE(RECOMMENDED_PYTHON) },
      python_unsupported: { what: (v: Vars) => `ה-Python שבמחשב הוא ${v.found}, ${v.direction === 'too_old' ? 'ישן' : 'חדש'} מדי לחבילות המנוע (הן קיימות ל-Python ${v.min} עד ${v.max}).`, next: () => `אפשר להתקין גרסה מתאימה לצד הקיימת. ${PY_HE(RECOMMENDED_PYTHON)}` },
      python_not_64bit: { what: () => 'ה-Python שנמצא הוא גרסת 32 ביט; המנוע צריך גרסת 64 ביט.', next: () => PY_HE(RECOMMENDED_PYTHON) },
      python_no_venv: { what: () => 'ה-Python שנמצא לא יכול ליצור סביבה נפרדת (חסר בו הרכיב venv).', next: () => `${PY_HE(RECOMMENDED_PYTHON)} ב-Linux: התקינו את החבילה python3-venv.` },
      not_enough_disk: { what: (v: Vars) => `אין מספיק מקום פנוי בכונן של תיקיית הנתונים${v.need ? `: צריך כ-${v.need}${v.free ? ` ויש ${v.free}` : ''}` : ''}.`, next: () => 'פנו מקום בכונן (למשל ניקוי האחסון במנהל הפרויקטים) ולחצו שוב.' },
      network_unavailable: { what: () => 'לא הצלחנו להגיע ל-pypi.org.', next: () => 'בדקו שיש חיבור לאינטרנט ולחצו שוב. ברשת של מקום עבודה או של בית ספר ייתכן שהגישה חסומה; אפשר לנסות מרשת אחרת.' },
      proxy_refused: { what: () => 'שרת Proxy ברשת הזו חסם את החיבור ל-pypi.org.', next: () => 'נסו מרשת אחרת (למשל בבית), או בקשו ממי שמנהל את הרשת לאפשר את pypi.org ואת files.pythonhosted.org.' },
      pip_failed: { what: (v: Vars) => (v.hashMismatch === 'true' ? 'קובץ שהורד לא תאם את החתימה הרשומה, ולכן לא הותקן דבר.' : 'תוכנת ההתקנה (pip) נעצרה.'), next: () => 'אפשר ללחוץ שוב. אם זה חוזר, העתיקו את השורות שלמטה ושלחו אותן למי שעוזר לכם.' },
      probe_failed: { what: () => 'המנוע הותקן אבל לא נטען, ולכן הוסר.', next: () => 'ב-Windows ייתכן שחסרה התוכנה Microsoft Visual C++ Redistributable (x64); אפשר להתקין אותה מאתר Microsoft וללחוץ שוב. אם זה חוזר, העתיקו את השורות שלמטה ושלחו אותן למי שעוזר לכם.' },
      interrupted: { what: () => 'העורך נסגר באמצע ההתקנה; מה שהותקן בחלקו נמחק.', next: () => 'לחצו שוב כדי להתחיל מההתחלה.' },
      internal_error: { what: () => 'ההתקנה נכשלה מסיבה לא צפויה; מה שהותקן בחלקו נמחק.', next: () => 'אפשר ללחוץ שוב.' },
    },
    refusals: {
      owner_required: 'ההתקנה אפשרית רק מחלון העורך של בעלי המחשב (הקישור שהקובץ start-pulseframe.cmd מדפיס).',
      engine_configured_elsewhere: 'מנוע דיבור אחר כבר הוגדר בהפעלה (PF_SPEECH_PYTHON), והוא זה שבשימוש.',
      engine_already_installed: 'מנוע הדיבור כבר מותקן.',
      engine_install_running: 'ההתקנה כבר רצה.',
      speech_busy: 'תמלול או קריינות ממתינים או רצים עכשיו; ההתקנה תתאפשר כשיסתיימו או יבוטלו.',
      platform_unsupported: 'במחשב הזה אי אפשר להתקין מכאן; אפשר להגדיר ביד.',
      download_size_mismatch: 'הפרטים השתנו מאז שהוצגו; טענו את החלון מחדש ולחצו שוב.',
      storage_quota_exceeded: 'מגבלת האחסון של העורך הושגה; פנו מקום במנהל הפרויקטים ולחצו שוב.',
      other: 'ההתקנה לא התחילה.',
    },
  },
  en: {
    title: 'Install the speech engine',
    intro: 'The speech engine can be installed from here, without a command line.',
    what: (v: { mb: string; files: string; python: string }) => `Downloads about ${v.mb} MB (${v.files} files) from pypi.org and installs into the editor's data folder; nothing is installed outside that folder. It uses Python ${v.python}, already on this computer.`,
    whatNoPython: (v: { mb: string; files: string }) => `Downloads about ${v.mb} MB (${v.files} files) from pypi.org and installs into the editor's data folder; nothing is installed outside that folder.`,
    model: 'The recognition model (about 1.62 GB) is a separate step: after the install, its download button appears here.',
    noPromise: 'Installing does not make the transcription accurate: check the text before you use it.',
    install: 'Install the speech engine', reinstall: 'Install again',
    confirm: 'Install now?', yes: 'Yes, install', no: 'Not now',
    cancel: 'Cancel the install',
    done: 'The speech engine is installed.',
    canceled: 'The install was canceled; what was partly installed was removed.',
    brokenInstalled: 'The speech engine installed from here does not answer. It can be installed again:',
    environment: 'The editor uses a speech engine set when it was started (PF_SPEECH_PYTHON), so installing from here is not offered.',
    unsupported: 'This computer cannot install from here: installing from here exists for Windows and Linux on 64-bit Intel or AMD processors only.',
    pipLines: 'The installer\'s last lines (folder names and the user name removed)',
    step: (v: { n: string; of: string }) => `Step ${v.n} of ${v.of}`,
    stages: {
      python: 'Looking for Python on this computer', venv: 'Creating a separate environment in the data folder', download: (v: { done: string; total: string }) => `Downloading and checking file ${v.done} of ${v.total}`,
      install: 'Installing', check: 'Checking that the engine loads', removing: 'Removing what was partly installed', queued: 'Waiting for other work to finish', other: 'Working',
    },
    failures: {
      python_not_found: { what: () => 'No Python was found on this computer.', next: () => PY_EN(RECOMMENDED_PYTHON) },
      python_unsupported: { what: (v: Vars) => `The Python on this computer is ${v.found}, too ${v.direction === 'too_old' ? 'old' : 'new'} for the engine's packages (they exist for Python ${v.min} to ${v.max}).`, next: () => `A fitting version can be installed beside the existing one. ${PY_EN(RECOMMENDED_PYTHON)}` },
      python_not_64bit: { what: () => 'The Python found is a 32-bit build; the engine needs a 64-bit one.', next: () => PY_EN(RECOMMENDED_PYTHON) },
      python_no_venv: { what: () => 'The Python found cannot create a separate environment (its venv part is missing).', next: () => `${PY_EN(RECOMMENDED_PYTHON)} On Linux: install the python3-venv package.` },
      not_enough_disk: { what: (v: Vars) => `There is not enough free space on the data folder's drive${v.need ? `: about ${v.need} is needed${v.free ? ` and ${v.free} is free` : ''}` : ''}.`, next: () => 'Free some space on the drive (for example the storage clean-up in the project manager) and press again.' },
      network_unavailable: { what: () => 'pypi.org could not be reached.', next: () => 'Check that the internet connection works and press again. A work or school network may block it; another network may work.' },
      proxy_refused: { what: () => 'A proxy on this network blocked the connection to pypi.org.', next: () => 'Try another network (for example at home), or ask whoever runs the network to allow pypi.org and files.pythonhosted.org.' },
      pip_failed: { what: (v: Vars) => (v.hashMismatch === 'true' ? 'A downloaded file did not match its recorded digest, so nothing was installed.' : 'The installer (pip) stopped.'), next: () => 'Press again. If it happens again, copy the lines below and send them to whoever helps you.' },
      probe_failed: { what: () => 'The engine was installed but did not load, so it was removed.', next: () => 'On Windows the Microsoft Visual C++ Redistributable (x64) may be missing; it can be installed from Microsoft\'s site, then press again. If it happens again, copy the lines below and send them to whoever helps you.' },
      interrupted: { what: () => 'The editor stopped during the install; what was partly installed was removed.', next: () => 'Press again to start from the beginning.' },
      internal_error: { what: () => 'The install failed unexpectedly; what was partly installed was removed.', next: () => 'Press again.' },
    },
    refusals: {
      owner_required: 'Installing is possible only from the computer owner\'s editor window (the link start-pulseframe.cmd prints).',
      engine_configured_elsewhere: 'Another speech engine was set when the editor started (PF_SPEECH_PYTHON), and that one is used.',
      engine_already_installed: 'The speech engine is installed already.',
      engine_install_running: 'The install is running already.',
      speech_busy: 'A transcription or narration is waiting or running; installing is possible once it finishes or is canceled.',
      platform_unsupported: 'This computer cannot install from here; it can be set up by hand.',
      download_size_mismatch: 'The details changed since they were shown; reload the window and press again.',
      storage_quota_exceeded: 'The editor\'s storage limit is reached; free space in the project manager and press again.',
      other: 'The install did not start.',
    },
  },
} as const;
