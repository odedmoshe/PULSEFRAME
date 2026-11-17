/**
 * Live fields of a title (life line, ADR-0021; plan §7), under the text box of the title inspector: the menu «הוסף שדה»
 * (תאריך צילום ▸, תאריך עברי ▸, שנה, שנה עברית, שם האירוע), each item with its value at the playhead or «אין נתון»; the
 * `aria-live=polite` line «מוצג כעת: …», or an anchored error with the fix («אין תאריך לקליפ שמתחת לכותרת · קביעת תאריך»,
 * «התאריך העברי תלוי בשקיעה · בחירה באירוע»); and «קבע כטקסט רגיל» with an undo toast.
 * Inserting at the caret is ONE transaction: update_text (existing braces doubled: core escapeFieldText; the token added) +
 * set_text_fields enabled:true. «קבע כטקסט רגיל» commits the operations core freezeOps returns. The text box shows the readable
 * form (core fieldsToDisplay / fieldsFromDisplay).
 * Test ids: LIFE_TESTIDS.fieldAdd, fieldItem(token), fieldLive, fieldFreeze.
 *
 * CONTRACT FILE (lead pre-pass): the exports and their props are fixed; W3 builds the bodies. Until then nothing is drawn.
 */
import type { ReactElement } from 'react';
/** The «הוסף שדה» menu and «קבע כטקסט רגיל» for the title `clipId`; `caret` is where the token goes in the text box (null = the end). */
export function FieldMenu(_props: { clipId: string; caret: number | null }): ReactElement | null {
  return null;
}
/** The line that says what the title shows at the playhead, or why a field has no words and how to fix it. */
export function FieldLiveLine(_props: { clipId: string }): ReactElement | null {
  return null;
}
