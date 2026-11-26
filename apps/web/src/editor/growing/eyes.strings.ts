/**
 * «הציעו עיניים» — the eyes interface's own strings in the marking view of «גדלים מול העיניים» (wave 8 picmodels; picmodels-verify.md
 * C9, C11, C12, C16 win over the plan). Hebrew first, plural and ungendered (verify C16: «הרצויות», never «שאתם רוצים»). LEAD seed of
 * the pre-pass in a NEW file, so the growing integration's growing.strings.ts is never edited by this track (C13); W3 owns it after the
 * merge and may add keys (both languages; eyes.strings.test.ts keeps them in step). The setup words per code come from i18n
 * picmodels.ts (`picmodels.setup.*`). Nothing here calls a suggestion right or sharp, or says the model knows who is in a picture:
 * it finds where eyes are, the owner checks every suggestion, and nobody has looked at its answers on real pictures yet.
 * CUT (decisions): pointer-drag of a point and the point-select keys, so no string mentions dragging.
 */
import { PICMODELS_EN, PICMODELS_HE } from '@pulseframe/i18n';
import type { PictureModelSetupCode } from '@pulseframe/core';

export interface EyesStrings {
  suggest: string; running: string; stop: string; accept: string;
  /** one face found */
  one: string;
  /** several faces found: «נמצאו {n} פנים…» */
  many(n: number): string;
  none: string; tooMany: string; closer: string; failed: string; notInstalled: string; dropped: string;
  /** the letter of face i, for this session only (reading order of the UI language; the stage stays ltr) */
  faceLetter(i: number): string;
  /** verify C11, consistent with growing's privacy sentence */
  privacy: string;
  method: string;
  /** a face was chosen (by a click or [ ]): `i` is its place in reading order */
  chosenFace(i: number): string;
  /** the setup of eye suggestions could not be read at all */
  setupUnknown: string;
  /** the setup words of a code, with `{module}` / `{bytes}` filled */
  setup(code: PictureModelSetupCode, fill?: { module?: string; bytes?: number }): string;
}

const HE_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
const EN_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const setupOf = (d: typeof PICMODELS_HE | typeof PICMODELS_EN) => (code: PictureModelSetupCode, fill: { module?: string; bytes?: number } = {}) =>
  d[`picmodels.setup.${code}`].replace('{module}', fill.module ?? '?').replace('{bytes}', fill.bytes === undefined ? '?' : String(fill.bytes));

const HE: EyesStrings = {
  suggest: 'הציעו עיניים', running: 'מחפשים עיניים…', stop: 'עצרו', accept: 'אשרו את ההצעה',
  one: 'הצעה של מודל: בדקו אותה, ולחצו Enter לאישור',
  many: (n) => `נמצאו ${n} פנים: לחצו ליד הפנים הרצויות, או בחרו ב־[ ו־] ולחצו Enter`,
  none: 'לא נמצאו פנים בתמונה הזאת. סמנו את העיניים ביד.',
  tooMany: 'יש בתמונה יותר מדי פנים: סמנו את העיניים ביד',
  closer: 'לחצו קרוב יותר לפנים הרצויות',
  failed: 'הצעת העיניים נכשלה. סמנו את העיניים ביד',
  notInstalled: 'הצעת עיניים לא מותקנת',
  dropped: 'ההצעה בוטלה. אפשר לסמן ביד',
  faceLetter: (i) => HE_LETTERS[i] ?? String(i + 1),
  privacy: 'ההצעה מחושבת רק במחשב הזה ואינה נשמרת. אחרי שתאשרו ותבנו, אפשר לחשב את מקום העיניים ממיקום התמונות בסרט, כמו בסימון ביד. המודל מוצא מקום של עיניים ולא מזהה מי בתמונה.',
  method: 'הצעה של מודל במחשב הזה, מקום העיניים בלבד',
  chosenFace: (i) => `הפנים ${HE_LETTERS[i] ?? i + 1} נבחרו: לחצו Enter לאישור`,
  setupUnknown: 'לא ניתן לבדוק אם הצעת עיניים זמינה. סמנו את העיניים ביד',
  setup: setupOf(PICMODELS_HE),
};
const EN: EyesStrings = {
  suggest: 'Suggest eyes', running: 'Looking for eyes…', stop: 'Stop', accept: 'Accept the suggestion',
  one: 'A model\'s suggestion: check it, and press Enter to accept',
  many: (n) => `${n} faces found: click near the face you want, or choose with [ and ] and press Enter`,
  none: 'No face was found in this picture. Mark the eyes by hand.',
  tooMany: 'There are too many faces in this picture: mark the eyes by hand',
  closer: 'Click closer to the face you want',
  failed: 'The eye suggestion failed. Mark the eyes by hand',
  notInstalled: 'Eye suggestions are not installed',
  dropped: 'The suggestion was dropped. You can mark by hand',
  faceLetter: (i) => EN_LETTERS[i] ?? String(i + 1),
  privacy: 'The suggestion is worked out only on this computer and is not saved. After you accept and build, the eye positions can be worked out from where the pictures sit in the film, as with marking by hand. The model finds where eyes are; it does not identify who is in the picture.',
  method: 'A model\'s suggestion on this computer, eye positions only',
  chosenFace: (i) => `Face ${EN_LETTERS[i] ?? i + 1} chosen: press Enter to accept`,
  setupUnknown: 'Could not check whether eye suggestions are available. Mark the eyes by hand',
  setup: setupOf(PICMODELS_EN),
};
export const eyesStrings = (lang: 'he' | 'en'): EyesStrings => (lang === 'he' ? HE : EN);
