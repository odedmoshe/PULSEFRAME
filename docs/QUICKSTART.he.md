# הפעלה ראשונה במחשב Windows

> **המדריך הזה עדיין לא הושלם בהצלחה על Windows.** כל הבדיקות עד היום רצו על Linux בלי כרטיס מסך. ניסיון ראשון על Windows נעצר ב-`pnpm install` (ראו בטבלה למטה); התיקון נמצא במאגר אבל לא אומת. אם שלב נכשל, העתיקו את הודעת השגיאה כמו שהיא.
>
> הפקודות נכתבו ל-PowerShell. בחלון **cmd** רגיל הן עובדות גם כן, חוץ משורות שמתחילות ב-`$env:` (בחלקים ב' ו-ג').

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

### 5. דוח על המחשב (חשוב — זה מה שפותח את עבודת כרטיס המסך)
בחלון PowerShell נוסף, מתוך תיקיית הפרויקט:

```powershell
pnpm probe > probe.txt
```

שולחים את הקובץ `probe.txt`. הוא מתאר מה הדפדפן מזהה במחשב (כרטיס מסך, מקודדים), בלי מידע אישי.

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
| שגיאה על `ffmpeg` | `ffmpeg -version` צריך לעבוד בחלון חדש; אם לא, ההתקנה לא נוספה ל-PATH |
| הקישור לא נפתח | להשתמש בקישור המלא מהשורה **Editor (owner)**, כולל החלק שאחרי `?key=` |
| בלשונית דיבור כתוב שהזיהוי אינו מותקן | המשתנה `PF_SPEECH_PYTHON` לא הוגדר באותו חלון שממנו הופעל `pnpm start` |
| הורדת מודל נכשלת | להריץ שוב: ההורדה ממשיכה מהמקום שבו נעצרה |

בכל מקרה אחר: להעתיק את כל מה שהודפס בחלון ולשלוח.
