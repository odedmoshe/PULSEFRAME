/**
 * Strings of the phone drop dialog (ADR-0023), Hebrew first; the English set has the same keys (the type says so). Placeholders
 * in braces are filled by the dialog: {time} m:ss, {count} a number, {size} a size in MB/GB.
 * Lead pre-pass: the keys and the owner-facing sentences of the plan (§7, with the verifier's corrections); W3 may add keys and
 * refine the wording, keeping both languages complete. The phone's own page carries its strings inside page.js.
 */
export type PhoneDropLang = 'he' | 'en';
const he = {
  title: 'ייבוא מהטלפון',
  step1: 'הטלפון והמחשב באותה רשת Wi-Fi', step2: 'סורקים את הקוד במצלמה של הטלפון', step3: 'בוחרים סרטונים ותמונות',
  chooseAddress: 'הכתובת של המחשב ברשת הביתית', start: 'פתיחת קוד לטלפון',
  qrLabel: 'קוד QR שפותח בטלפון את דף ההעלאה', cantScan: 'אי אפשר לסרוק? הקלידו בדפדפן של הטלפון', codeLabel: 'קוד:',
  waiting: 'ממתין לטלפון · הקוד בתוקף עוד {time}', connected: 'הטלפון מחובר', received: 'התקבלו {count} קבצים · {size}',
  used: 'הקוד נוצל — הוא לא יעבוד במכשיר נוסף', oneMinute: 'נשארה דקה אחת לקוד',
  closeCode: 'סגירת הקוד', closeAsk: 'קבצים עדיין עולים מהטלפון. לסגור את הקוד בכל זאת?', newCode: 'קוד חדש',
  disclosureTitle: 'מה נפתח לרשת?',
  disclosureBody: 'רק דף ההעלאה הזה: להעלאה בלבד, לפרויקט הזה בלבד, עד שהקוד נסגר. דרכו אי אפשר לראות או לערוך שום דבר. החיבור בתוך הרשת הביתית אינו מוצפן.',
  'problem.no_private_network': 'המחשב אינו מחובר לרשת ביתית. חברו אותו ל־Wi-Fi של הבית ונסו שוב.',
  'problem.drop_listen_failed': 'לא הצלחנו לפתוח את הפתח לטלפון. ייתכן שתוכנה אחרת משתמשת בו.',
  'problem.locked': 'הקוד נסגר אחרי כמה ניסיונות שגויים. אפשר לפתוח קוד חדש.',
  'problem.expired': 'הקוד פג. אפשר לפתוח קוד חדש.',
  'problem.restarted': 'התוכנה הופעלה מחדש והקוד נסגר. קבצים שכבר התקבלו ממשיכים להיכנס לספרייה.',
  hintWindows: 'אם Windows שואל, אשרו גישה ברשתות פרטיות בלבד. רשת שמסומנת "ציבורית" חוסמת את הטלפון.',
  hintVpn: 'אם VPN פעיל במחשב, בחרו כתובת אחרת מהרשימה.',
  chip: 'קוד לטלפון פתוח · {time}', chipClose: 'סגירת הקוד לטלפון',
  notAvailable: 'ייבוא מהטלפון עוד לא זמין בגרסה הזו.',
} as const;
const en: Record<keyof typeof he, string> = {
  title: 'Import from a phone',
  step1: 'The phone and this computer on the same Wi-Fi', step2: 'Scan the code with the phone\'s camera', step3: 'Choose videos and pictures',
  chooseAddress: 'This computer\'s address on the home network', start: 'Open a code for the phone',
  qrLabel: 'QR code that opens the upload page on the phone', cantScan: 'Can\'t scan? Type this into the phone\'s browser', codeLabel: 'Code:',
  waiting: 'Waiting for the phone · the code is valid for {time}', connected: 'The phone is connected', received: 'Received {count} files · {size}',
  used: 'The code was used — it will not work on another device', oneMinute: 'One minute left on the code',
  closeCode: 'Close the code', closeAsk: 'Files are still uploading from the phone. Close the code anyway?', newCode: 'New code',
  disclosureTitle: 'What is opened to the network?',
  disclosureBody: 'Only this upload page: upload only, this project only, until the code closes. Nothing can be viewed or edited through it. The connection inside the home network is not encrypted.',
  'problem.no_private_network': 'This computer is not connected to a home network. Connect it to the home Wi-Fi and try again.',
  'problem.drop_listen_failed': 'The door for the phone could not be opened. Another program may be using it.',
  'problem.locked': 'The code was closed after several wrong attempts. You can open a new code.',
  'problem.expired': 'The code expired. You can open a new code.',
  'problem.restarted': 'The program restarted and the code was closed. Files already received keep coming into the library.',
  hintWindows: 'If Windows asks, allow access on private networks only. A network marked "public" blocks the phone.',
  hintVpn: 'If a VPN is on, choose another address from the list.',
  chip: 'Phone code open · {time}', chipClose: 'Close the phone code',
  notAvailable: 'Importing from a phone is not available in this build yet.',
};
export const PHONE_DROP_STRINGS: { he: typeof he; en: Record<keyof typeof he, string> } = { he, en };
/** The honest states the dialog shows instead of a code. */
export type PhoneDropProblem = 'no_private_network' | 'drop_listen_failed' | 'locked' | 'expired' | 'restarted';
