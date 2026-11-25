# שני מודלים שדורשים הסכמה בחשבון Hugging Face

מסמך זה נכתב ב-25.11.2026. הוא מיועד לבעלי הפרויקט, בעברית פשוטה. המטרה: להוריד בעצמכם, בדפדפן שלכם, שני מודלים שהאתר נועל עד שמסכימים לתנאים, ולשמור אותם בתיקיית הספרייה.

- **מודל 1 – pyannote (הפרדת דוברים).** עוזר לעורך להבין "מי מדבר מתי" בתוך סרטון אחד.
- **מודל 2 – Stable Audio Open Small (יצירת צלילים).** יוצר אפקטי קול וצלילי רקע קצרים (עד 11 שניות) לפי תיאור באנגלית.

כלל ברזל: סוכני הפרויקט לא פותחים חשבונות, לא רואים סיסמה או מפתח (token), ולא מבקשים אותם. את הכול עושים בעלי הפרויקט בעצמם. ההורדה בדפדפן לא צריכה מפתח.

---

## חלק א – פותחים חשבון (פעם אחת)

1. פתחו בדפדפן את `https://huggingface.co/join`.
2. הזינו כתובת דוא"ל שלכם וסיסמה שאתם בוחרים. את הסיסמה לא שולחים לאף אחד ולא כותבים בשום שיחה.
3. בחרו שם משתמש (אפשר שם שלא חושף את שמכם).
4. פתחו את הדוא"ל שהגיע מ-Hugging Face ולחץ על קישור האימות.
5. שימו לב: כשמסכימים לתנאי מודל, **שם המשתמש והדוא"ל שלכם נמסרים לחברה שפרסמה אותו**. האתר כותב זאת בעצמו: "You need to agree to share your Hugging Face information to access this model". אם אינכם רוצים, אל תמשיכו.

---

## חלק ב – מודל 1: pyannote

### ב.1 הדף והכפתור

1. היכנסו לחשבון, ופתחו: `https://huggingface.co/pyannote/speaker-diarization-community-1`
2. תראו מסגרת עם הכותרת "You need to agree to share your Hugging Face information to access this model" ומתחתיה: "This repository is publicly accessible, but you have to accept the conditions to access its files and content."
3. קראו את הטקסט במסגרת, ולחצו על הכפתור שמתחתיו. בדרך כלל הכתוב עליו: **"Agree and access repository"** (הכפתור מופיע רק למי שנכנס לחשבון, ולכן אי אפשר היה לראות את הנוסח המדויק מראש. אם הנוסח שונה, זה הכפתור היחיד מתחת לתנאים). ייתכן שהטופס ישאל פרטים; מלאו רק את מה שאתם מוכנים למסור.
4. אל תלחצו על שום דבר שמדבר על "Pro", תשלום, או "access token".

### ב.2 מה התנאים אומרים (שני משפטים)

- הרישיון הוא **CC BY 4.0**: מותר להשתמש (גם מסחרית), ובלבד שנותנים קרדיט למחברים. אין כאן הגבלת הכנסה ואין "לא מסחרי". המשפט בדף: "This pipeline is released under the CC-BY-4.0 license and will always remain freely accessible."
- במסגרת הטופס אתם מסכימים שיישלחו אליכם הודעות: "By providing your details, you agree that we may email you occasionally with important news about pyannote models, invitations to try premium pipelines, and information about specific services designed for researchers and professionals like you." כלומר: ייתכנו מיילים פרסומיים ממפתחי המודל, וזה כל המחיר.

הערה: המודל מורכב מכמה חלקים (זיהוי קטעי דיבור, "טביעת קול" לכל דובר, ואשכול). לפי תיקיות המאגר, כולם **באותו מאגר ובאותה הסכמה** (אין מאגר נוסף לחתום עליו). הרישיון של כל חלק בנפרד לא נקרא (קבצי ה-README של התיקיות חסומים בלי חשבון). הדף כולו מצהיר על CC BY 4.0.

### ב.3 הערה על פרטיות (כלל מוצר שכבר הוחלט)

מודל כזה מחשב מאפייני קול. העורך ישתמש בהפרדת דוברים **רק כדי להפריד בין דוברים בתוך קליפ אחד, ולא ישמור טביעות קול**.

### ב.4 הקבצים להורדה

שמרו לתיקייה `E:\PULSEFRAME-Library\models\gated\speaker-diarization-community-1\` (צרו אותה אם אין). חשוב: **שני הקבצים בשם `pytorch_model.bin` שונים זה מזה** ויושבים בתת-תיקיות שונות. הדפדפן ייתן לשני "pytorch_model (1).bin" ויבלבל; לכן הורידו אחד, העבירו אותו לתיקייה הנכונה, ורק אז הורידו את השני.

גרסה מקובעת (commit): `3533c8cf8e369892e6b79ff1bf80f7b0286a54ee`

| # | קובץ | גודל בבייטים | תיקיית יעד (בתוך התיקייה למעלה) | קישור |
|---|---|---|---|---|
| 1 | config.yaml | 444 | (ישירות) | https://huggingface.co/pyannote/speaker-diarization-community-1/resolve/3533c8cf8e369892e6b79ff1bf80f7b0286a54ee/config.yaml?download=true |
| 2 | segmentation/pytorch_model.bin | 5,906,507 | segmentation\ | https://huggingface.co/pyannote/speaker-diarization-community-1/resolve/3533c8cf8e369892e6b79ff1bf80f7b0286a54ee/segmentation/pytorch_model.bin?download=true |
| 3 | embedding/pytorch_model.bin | 26,646,242 | embedding\ | https://huggingface.co/pyannote/speaker-diarization-community-1/resolve/3533c8cf8e369892e6b79ff1bf80f7b0286a54ee/embedding/pytorch_model.bin?download=true |
| 4 | plda/plda.npz | 133,852 | plda\ | https://huggingface.co/pyannote/speaker-diarization-community-1/resolve/3533c8cf8e369892e6b79ff1bf80f7b0286a54ee/plda/plda.npz?download=true |
| 5 | plda/xvec_transform.npz | 134,376 | plda\ | https://huggingface.co/pyannote/speaker-diarization-community-1/resolve/3533c8cf8e369892e6b79ff1bf80f7b0286a54ee/plda/xvec_transform.npz?download=true |

סך הכול: 32,821,421 בייטים (כ-31.3 MiB), חמישה קבצים. את קובצי ה-README ואת `diarization.gif` לא מורידים.

**אזהרה ישרה:** שני קובצי `pytorch_model.bin` הם בפורמט "pickle" של PyTorch. זה פורמט שמסוגל להכיל קוד, ולכן מורידים אותו רק ממקור שאתם סומכים עליו, מהקישור המקובע שלמעלה. במאגר אין גרסת safetensors, ולכן אין ברירה אחרת. העורך יטען אותם בצורה מוגבלת, והקבצים לא יורצו בשום מקום אחר.

תוכן `config.yaml` לא נקרא מראש (חסום בלי חשבון). לפי מבנה המאגר הוא מצביע על התיקיות segmentation, embedding ו-plda שבאותו מאגר. אם אחרי ההורדה יתברר שהוא מפנה למאגר נוסף, נדווח ונוסיף אותו כאן.

### ב.5 בדיקה: פקודת PowerShell אחת

פתחו PowerShell (לא כמנהלים) והדביקו:

```
$root='E:\PULSEFRAME-Library\models\gated\speaker-diarization-community-1'; Get-ChildItem -Recurse -File -LiteralPath $root | ForEach-Object { '{0}  {1,12}  {2}' -f (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLower(), $_.Length, $_.FullName.Substring($root.Length+1) }
```

הפקודה מדפיסה שורה לכל קובץ: חתימה (SHA-256), גודל ושם. הערכים להשוואה:

| קובץ | גודל צפוי | SHA-256 צפוי |
|---|---|---|
| config.yaml | 444 | יירשם מההורדה הראשונה שלכם |
| segmentation\pytorch_model.bin | 5906507 | יירשם מההורדה הראשונה שלכם |
| embedding\pytorch_model.bin | 26646242 | יירשם מההורדה הראשונה שלכם |
| plda\plda.npz | 133852 | יירשם מההורדה הראשונה שלכם |
| plda\xvec_transform.npz | 134376 | יירשם מההורדה הראשונה שלכם |

למה אין חתימות כאן: האתר מסתיר את חתימות הקבצים ממי שלא נכנס לחשבון, ולא ממציאים ערכים. מה שכן אפשר לבדוק כבר עכשיו: **הגדלים חייבים להיות זהים בדיוק**. אם גודל שונה, ההורדה נקטעה; מחקו והורידו מחדש. את שורות החתימה שהודפסו אפשר להעתיק לסוכן (הן לא סודיות); הוא ירשום אותן בקובץ הבדיקה כערכי ייחוס. בדיקה נוספת, אם תרצו: בדף הקובץ באתר (כשאתם מחוברים) מופיע לקבצים הגדולים שדה SHA256; הוא צריך להיות זהה לשורה שהודפסה.

---

## חלק ג – מודל 2: Stable Audio Open Small

### ג.1 איזו גרסה, ולמה

בחרנו ב-**Small** (`stabilityai/stable-audio-open-small`) ולא בגרסה 1.0:

- ב-Small קובץ המודל 1.68 GB (כחצי מיליארד פרמטרים), הוא נבנה להרצה על מעבד רגיל, וייצור קטע לוקח 8 צעדים. זה ריאלי על כרטיס 4 GB וגם על המעבד בלבד.
- ב-1.0 הרכיב הראשי לבדו 4.2 GB, והקובץ המלא 4.85 GB, לכן בדיוק מלא לא נכנס ל-4 GB זיכרון וידאו. בחצי דיוק אולי כן ייכנס בקושי, אבל לא נמדד, ויידרשו 100 צעדים ויותר: איטי מאוד. לכן לא ממליצים עליו כברירת מחדל.
- המחיר של Small: עד 11 שניות לקטע, בעיקר אפקטים וצלילי סביבה (לא מוזיקה טובה ולא שירה), ותיאורים באנגלית. הכול נאמר בדף המודל. לא נמדד שום דבר על המחשב שלכם.

### ג.2 הדף והכפתור

1. פתחו (כשאתם מחוברים): `https://huggingface.co/stabilityai/stable-audio-open-small`
2. תופיע אותה מסגרת: "You need to agree to share your Hugging Face information to access this model", ומתחתיה: "By clicking "Agree", you agree to the License Agreement and acknowledge Stability AI's Privacy Policy."
3. לחצו על הכפתור מתחת (בדרך כלל "Agree and access repository"; הוא נראה רק אחרי כניסה לחשבון ולא אומת מראש). אל תלחצו על שום דבר אחר.

### ג.3 מה התנאים אומרים (הרישיון נקרא במלואו; לא רכּכנו כלום)

הרישיון: **Stability AI Community License** (עדכון 5.7.2024). שלושה כללים שחשובים לכם:

1. **מותר לשימוש אישי, לא מסחרי, בלי תשלום:** "This Agreement is intended to allow research, non-commercial, and limited commercial uses of the Models free of charge." ובהגדרה: "“Non-Commercial Purpose” means any purpose other than a Research Purpose that is not primarily intended for commercial advantage or monetary compensation to You or others, such as personal use (i.e., hobbyist) or evaluation and testing." משמעות: סרטונים משפחתיים פרטיים, בלי כוונה להרוויח, נכללים. סרטון שנועד בעיקר להכנסה (למשל ערוץ מוניטיזציה או עבודה בתשלום) הוא שימוש מסחרי ויש לעצור ולברר לפני כן.
2. **תקרת הכנסה:** "If at any time You or Your Affiliate(s), either individually or in aggregate, generate more than USD $1,000,000 in annual revenue (or the equivalent thereof in Your local currency) ..., any licenses granted to You under this Agreement shall terminate as of such date." משמעות: מי שהכנסתו השנתית (כולל גופים קשורים) עוברת מיליון דולר, הרישיון נפסק. שימוש מסחרי, גם מתחת לתקרה, מחייב גם רישום אצל Stability AI. אצלכם, שימוש פרטי, זה לא רלוונטי, אבל זו הסיבה שהקובץ מסומן "אישי בלבד".
3. **קרדיט וחלוקה:** אם מעבירים את המודל, או מוצר שמשתמש בו, לאדם אחר, חייבים לצרף את הרישיון, את הכיתוב "This Stability AI Model is licensed under the Stability AI Community License, Copyright © Stability AI Ltd. All Rights Reserved" ולהציג "Powered by Stability AI" בצורה בולטת. הקבצים שלכם נשארים על הדיסק שלכם ולא משותפים הלאה. בנוסף: חל "Acceptable Use Policy" של החברה, ואסור להשתמש במודל או בתוצריו כדי לאמן או לשפר מודל בינה מלאכותית יסודי אחר. התוצרים (הצלילים) שייכים לכם, "to the extent permitted by applicable law".

דף המודל מוסיף: "Please note: For commercial use, please refer to https://stability.ai/license".

### ג.4 הקבצים להורדה

שמרו ל-`E:\PULSEFRAME-Library\models\gated\stable-audio-open-small\`

גרסה מקובעת (commit): `ea2772170fc06f80dfd02bea6e57a44d9d4bc9d3`

| # | קובץ | גודל בבייטים | קישור |
|---|---|---|---|
| 1 | model.safetensors | 1,676,829,212 | https://huggingface.co/stabilityai/stable-audio-open-small/resolve/ea2772170fc06f80dfd02bea6e57a44d9d4bc9d3/model.safetensors?download=true |
| 2 | model_config.json | 5,622 | https://huggingface.co/stabilityai/stable-audio-open-small/resolve/ea2772170fc06f80dfd02bea6e57a44d9d4bc9d3/model_config.json?download=true |
| 3 | LICENSE | 11,852 | https://huggingface.co/stabilityai/stable-audio-open-small/resolve/ea2772170fc06f80dfd02bea6e57a44d9d4bc9d3/LICENSE?download=true |

סך הכול: 1,676,846,686 בייטים (כ-1.56 GiB). אין צורך בתת-תיקיות. קובץ המודל הוא safetensors (בטוח, לא pickle).

מה **לא** מורידים: `model.ckpt` ו-`base_model.ckpt` (אותו דבר בפורמט pickle, כפילות), `base_model_config.json`, ותיקיית `tflite-arm-path` (לטלפונים).

**רכיב נלווה בלי חשבון (לא צריך שתעשו כלום):** המודל משתמש במודל טקסט פתוח, `t5-base` (רישיון Apache-2.0, לא נעול), שלא כלול בקבצים לעיל. לפי הוראות הספרייה, הוא נטען בזמן ההרצה. כדי שהכול יעבוד בלי רשת, הסוכן יוסיף אותו להורדה האוטומטית, מארבעה קבצים של כ-894 MB מאגר `google-t5/t5-base` (commit `a9723ea7f1b39c1eae772870f3b547bf6ef7e6c1`). לא נבדק בפועל שהספרייה אכן מוצאת אותו שם; נבדוק בהרצה הראשונה.

### ג.5 בדיקה: פקודת PowerShell אחת

```
$root='E:\PULSEFRAME-Library\models\gated\stable-audio-open-small'; Get-ChildItem -Recurse -File -LiteralPath $root | ForEach-Object { '{0}  {1,12}  {2}' -f (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLower(), $_.Length, $_.FullName.Substring($root.Length+1) }
```

(חישוב החתימה של הקובץ הגדול לוקח כמה שניות.)

| קובץ | גודל צפוי | SHA-256 צפוי |
|---|---|---|
| model.safetensors | 1676829212 | יירשם מההורדה הראשונה שלכם |
| model_config.json | 5622 | יירשם מההורדה הראשונה שלכם |
| LICENSE | 11852 | יירשם מההורדה הראשונה שלכם |

אותו הסבר כמו בחלק ב: חתימות הקבצים מוסתרות מציבור, הגדלים מאומתים. אחרי שהחתימות יירשמו אצל הסוכן, הן ישמשו לבדיקה בכל פעם.

## דרך קצרה יותר: פקודה אחת במקום שמונה הורדות (נוסף ב-25.11.2026)

במקום להוריד קובץ-קובץ בדפדפן (חלקים ב.4 ו-ג.4), אפשר להריץ פקודה אחת במחשב שלכם. היא מורידה את שמונת הקבצים לתיקיות הנכונות, בודקת גדלים ומדפיסה את החתימות. לשם כך צריך מפתח גישה זמני, כי האתר פותח את הקבצים רק למי שמזדהה.

**למה הסוכן לא עושה את זה לבד:** הקבצים נפתחים רק לחשבון שלכם. כדי להזדהות בשמכם הסוכן היה צריך לקבל את הסיסמה או את המפתח, וכל מה שנכתב בשיחה נשמר בה. לכן המפתח מוקלד רק בחלון במחשב שלכם, ולא עובר דרך הסוכן או דרך השיחה.

1. לפני כן: אשרו את התנאים בשני דפי המודלים (חלקים ב.1 ו-ג.2).
2. צרו מפתח: פתחו `https://huggingface.co/settings/tokens`, לחצו על הכפתור ליצירת מפתח חדש (New token / Create new token), בחרו בסוג **Read**, תנו לו שם כלשהו, וצרו אותו. העתיקו את המפתח (מתחיל ב-`hf_`). (שמות הכפתורים לא אומתו מראש; אם הדף נראה אחרת, שלחו צילום מסך בלי המפתח עצמו.)
3. פתחו PowerShell והריצו את שתי הפקודות, אחת אחרי השנייה:

```
git -C E:\PULSEFRAME-Library\_tools\repo pull --depth 1 --ff-only origin claude/confident-planck-677xq5
```

```
node E:\PULSEFRAME-Library\_tools\repo\tools\library\fetch-gated.mjs
```

4. כשמופיעה השורה `key:` הדביקו את המפתח (לחיצה ימנית בחלון, או Ctrl+V) ולחצו Enter. **שום דבר לא יוצג בזמן ההדבקה, וזה תקין.**
5. בסוף מודפסת טבלת חתימות ושורת `SUMMARY`. העתיקו את הפלט לסוכן (אין בו שום דבר סודי).
6. מחקו את המפתח באותו דף הגדרות (Delete / Revoke). אין בו עוד צורך.

מה הסקריפט עושה עם המפתח: מחזיק אותו בזיכרון לזמן הריצה בלבד, שולח אותו רק לאתר huggingface.co, ולא כותב אותו לקובץ, למסך או ליומן. אם מופיעה השגיאה `HTTP 403`, עוד לא אושרו התנאים בדף של אותו מודל; אם `HTTP 401`, המפתח לא הועתק במלואו.

---

## חלק ד – מה לא עושים

1. **לא מדביקים סיסמה או מפתח (token) בשום שיחה**, לא בצ'אט עם הסוכן ולא בשום מקום אחר. גם אם מישהו מבקש, התשובה היא לא.
2. **מפתח גישה (Access Token) יוצרים רק אם בחרתם בדרך הקצרה שלמעלה**, מדביקים אותו רק בשורת `key:` של הסקריפט במחשב שלכם, ומוחקים אותו בסוף. בהורדה בדפדפן אין בו צורך. (דפי המודלים מזכירים מפתח בדוגמאות קוד; מתעלמים מהן.)
3. לא מורידים קבצים מאתר אחר או מ"מראה" לא רשמית, ולא קבצים מעבר לרשימה.
4. לא משתפים את הקבצים שהורדתם עם אחרים (תנאי הרישיון), ולא מעלים אותם לשירות ענן משותף.
5. לא משתמשים בצלילים של Stable Audio בסרטון שמטרתו הכנסה, בלי לבדוק קודם את הרישיון.
6. לא לוחצים על הצעות תשלום או "Pro" באתר.

אם משהו נראה אחרת ממה שכתוב כאן (כפתור, גודל קובץ), עצרו ושלחו לסוכן תיאור או צילום מסך של הדף, **בלי** פרטי חשבון.
