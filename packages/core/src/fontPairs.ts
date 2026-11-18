/**
 * Pairings of the bundled fonts for the font picker («מתאים עם…», ADR-0022): a heading family and a body family that suit
 * each other, with a short note in Hebrew and English.
 *
 * Every family and weight of a row is in FONT_CATALOG (fontPairs.test.ts). A heading is never paired with itself, and a pair
 * never puts two display or two handwriting faces together: the heading is the loud one, the body the quiet one.
 */
import type { FontPair } from './fonts.ts';

export const FONT_PAIRS: readonly FontPair[] = [
  { heading: 'Suez One', headingWeight: 400, body: 'Heebo', bodyWeight: 400, note: { he: 'כותרת עבה ובולטת, ומתחתיה טקסט נקי וקריא', en: 'A heavy, confident headline over clean running text' } },
  { heading: 'Secular One', headingWeight: 400, body: 'Assistant', bodyWeight: 400, note: { he: 'כותרת עגלגלה וחמה עם גוף עדין', en: 'A warm, round headline with a gentle body' } },
  { heading: 'David Libre', headingWeight: 700, body: 'Frank Ruhl Libre', bodyWeight: 400, note: { he: 'שני סריפים קלאסיים, מתאים לטקסט רציני ולטקסט של זיכרון', en: 'Two classic serifs, for something serious or remembered' } },
  { heading: 'Frank Ruhl Libre', headingWeight: 700, body: 'Assistant', bodyWeight: 400, note: { he: 'כותרת מסורתית עם גוף ישר שקל לקרוא על מסך', en: 'A traditional headline with a straight body that reads easily on screen' } },
  { heading: 'Karantina', headingWeight: 700, body: 'Heebo', bodyWeight: 400, note: { he: 'כותרת צרה וגבוהה לפוסטרים, וטקסט רגיל לפרטים', en: 'A tall, narrow poster headline with plain text for the details' } },
  { heading: 'Amatic SC', headingWeight: 700, body: 'Rubik', bodyWeight: 400, note: { he: 'כתב יד קליל לכותרת, וטקסט מעוגל ונעים', en: 'Light hand lettering for the headline and soft, rounded text' } },
  { heading: 'Fredoka', headingWeight: 700, body: 'Assistant', bodyWeight: 400, note: { he: 'כותרת עגולה ושמחה ליום הולדת ולילדים', en: 'A round, cheerful headline for birthdays and children' } },
  { heading: 'Gveret Levin', headingWeight: 400, body: 'Heebo', bodyWeight: 400, note: { he: 'כתב יד אישי לברכה, עם טקסט פשוט לידו', en: 'Personal handwriting for a greeting, with simple text beside it' } },
];
