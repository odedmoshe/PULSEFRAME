# הפעלה ראשונה במחשב Windows

> **מצב המדריך:** חלק א' (התקנה, בנייה, הפעלה ופתיחת העורך ב-Chrome) הושלם פעם אחת על Windows 11 עם Node 22.17, אחרי שני תיקונים שנמצאים עכשיו במאגר. חלקים ב' ו-ג' (זיהוי דיבור וקריינות) עדיין לא נוסו על Windows. אם שלב נכשל, העתיקו את הודעת השגיאה כמו שהיא.
>
> הפקודות נכתבו ל-PowerShell. בחלון **cmd** רגיל הן עובדות גם כן, חוץ משורות שמתחילות ב-`$env:` (בחלקים ב' ו-ג'); ב-cmd כותבים במקומן `set PF_SPEECH_PYTHON=...` בשורה נפרדת לפני `pnpm start`.

המדריך מחולק לשלושה חלקים. חלק א' מספיק כדי לראות את העורך. חלקים ב' ו-ג' מוסיפים זיהוי דיבור וקריינות, ואפשר לדלג עליהם.

## חלק א' — העורך (כ-15 דקות)

### 1. התקנות חד-פעמיות
פותחים **PowerShell** ומריצים שורה אחרי שורה:

```powershell
winget install OpenJS.NodeJS.LTS
```
```powershell
winget install Git.Git
```
```powershell
winget install Gyan.FFmpeg
```
```powershell
winget install Python.Python.3.12
```

סוגרים את PowerShell ופותחים מחדש (כדי שהתוכנות החדשות יזוהו), ואז:

```powershell
npm install -g pnpm@10.28.0
```

בדיקה שהכול מותקן — כל שורה צריכה להדפיס מספר גרסה:

```powershell
node --version; pnpm --version; ffmpeg -version | Select-Object -First 1; python --version
```

נדרש Node בגרסה 22.12 ומעלה.

### 2. הורדת הפרויקט

```powershell
git clone https://github.com/odedmoshe/pulseframe.git
```
```powershell
cd pulseframe
```
```powershell
git checkout claude/confident-planck-677xq5
```

### 3. התקנה ובנייה

```powershell
pnpm install
```
```powershell
pnpm exec playwright install chromium
```
```powershell
pnpm build
```

### 4. הפעלה

```powershell
pnpm start
```

בחלון יודפסו כמה שורות. מחפשים את השורה **Editor (owner)** ופותחים את הקישור שלצידה ב-Chrome. הקישור כולל מפתח גישה, ולכן הוא עובד רק מהמחשב הזה.

לעצירה: `Ctrl+C` בחלון PowerShell.

### 5. בדיקת כרטיס המסך (חשוב — זה מה שפותח את עבודת כרטיס המסך)
כשהעורך פועל (`pnpm start`), פותחים **ב-Chrome הרגיל** את הכתובת:

```
http://127.0.0.1:8787/gpu.html
```

הדף בודק מה הדפדפן מזהה (כרטיס מסך, קידוד בחומרה) ומריץ מדידת זמן קצרה אחת. לוחצים **העתקת התוצאה** ושולחים את הטקסט. שום דבר לא נשלח מהדף לשום מקום.

**אם בתוצאה כתוב `"vendor": "intel"`**, Chrome משתמש בכרטיס המובנה ולא ב-NVIDIA. כדי להעביר אותו: הגדרות Windows ← מערכת ← תצוגה ← גרפיקה ← בוחרים את Google Chrome ← אפשרויות ← **ביצועים גבוהים** ← שמירה, ואז סוגרים את כל חלונות Chrome ופותחים מחדש. (ההוראה הזאת לא נוסתה.)

### 6. בדיקת הדפדפן שמייצא
הייצוא רץ בדפדפן נפרד ונסתר. הפקודה הבאה בודקת אם גם הוא יכול להשתמש בכרטיס המסך (כדקה; ייתכן שיהבהב חלון לרגע):

```powershell
pnpm probe:gpu
```

שולחים את הטבלה שמודפסת.

הפקודה `pnpm probe` בודקת דפדפן נסתר שרץ בלי כרטיס מסך, ולכן היא לא מראה את הכרטיס האמיתי; היא נשארת שימושית רק לבדיקת הסביבה שבה רץ הייצוא.

## חלק ב' — זיהוי דיבור אוטומטי (כ-10 דקות, הורדה של 1.6GB)

מתוך תיקיית הפרויקט:

```powershell
python -m venv .artifacts\speech\venv
```
```powershell
.artifacts\speech\venv\Scripts\pip install faster-whisper==1.2.1
```

מפעילים את העורך עם המנוע:

```powershell
$env:PF_SPEECH_PYTHON = ".artifacts\speech\venv\Scripts\python.exe"; pnpm start
```

בעורך: בוחרים קליפ עם דיבור ← לשונית **דיבור**. בפעם הראשונה יופיע כפתור **הורדת המודל (1.62 GB)**; אחרי ההורדה יופיע **זיהוי דיבור אוטומטי**.

בלי הגדרה נוספת הזיהוי רץ על המעבד. הרצה על כרטיס המסך דורשת ספריות נוספות ולא נוסתה; ההוראות המשוערות נמצאות ב-`docs/INTEGRATIONS.md`.

## חלק ג' — קריינות מטקסט (כ-20 דקות, כ-6GB של תוכנה ועוד 3.5GB של מודל)

```powershell
python -m venv .artifacts\speech\tts-venv
```
```powershell
.artifacts\speech\tts-venv\Scripts\pip install chatterbox-tts==0.1.7 phonikud-onnx==1.0.6 setuptools==80.9.0
```

מפעילים עם שני המנועים:

```powershell
$env:PF_SPEECH_PYTHON = ".artifacts\speech\venv\Scripts\python.exe"; $env:PF_VOICE_PYTHON = ".artifacts\speech\tts-venv\Scripts\python.exe"; pnpm start
```

בעורך: לשונית **סאונד** ← **קריינות מטקסט**. בפעם הראשונה יופיע כפתור הורדה (3.51 GB). אחר כך מקלידים משפט או תסריט ולוחצים **יצירת קריינות במיקום הסמן**.

על מעבד בלבד משפט לוקח עשרות שניות. מודל הקול צריך כ-3–4GB של זיכרון מסך, כך שייתכן שלא ייכנס לכרטיס של 4GB; במקרה כזה הוא ימשיך לרוץ על המעבד.

## אם משהו לא עובד

| מה רואים | מה לבדוק |
|---|---|
| `pnpm` לא מזוהה | לסגור ולפתוח את PowerShell אחרי ההתקנה |
| `Cannot find module ...\pnpm\.tools\pnpm\10.28.0_tmp_...\pnpm.cjs` | pnpm ניסה להחליף את עצמו לגרסה אחרת ונכשל. להריץ `git pull`, אחר כך `npm install -g pnpm@10.28.0`, ואז שוב `pnpm install` |
| `pnpm install` נכשל ב-`better-sqlite3 ... node-gyp rebuild` | גרסה ישנה של המאגר ניסתה לקמפל רכיב שמגיע כבר מוכן. להריץ `git pull` ואז שוב `pnpm install` |
| `'vite' is not recognized` או `'tsx' is not recognized` | `pnpm install` לא הסתיים בהצלחה; לתקן אותו קודם ואז להריץ שוב |
| שגיאה על `ffmpeg` | `ffmpeg -version` צריך לעבוד בחלון חדש; אם לא, ההתקנה לא נוספה ל-PATH |
| הקישור לא נפתח | להשתמש בקישור המלא מהשורה **Editor (owner)**, כולל החלק שאחרי `?key=` |
| בלשונית דיבור כתוב שהזיהוי אינו מותקן | המשתנה `PF_SPEECH_PYTHON` לא הוגדר באותו חלון שממנו הופעל `pnpm start` |
| הורדת מודל נכשלת | להריץ שוב: ההורדה ממשיכה מהמקום שבו נעצרה |

בכל מקרה אחר: להעתיק את כל מה שהודפס בחלון ולשלוח.
