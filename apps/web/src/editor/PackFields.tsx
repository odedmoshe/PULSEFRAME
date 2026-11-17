/**
 * The template dialog's fieldset «פרטים» (ADR-0022; plan §8 with the verifier's corrections): one field per pack field the
 * template's titles hold (TemplateSummary.fields; labels i18n pack.field.*): שם and שם נוסף (dir=auto), גיל (number, LTR), נר
 * (radio group 1–8, always shown and editable), מקום, מתי; for a candle template also the date (the live Hebrew date in <bdi>,
 * aria-live polite, from the life line's calendar) and the switch «צולם בהדלקת הנרות של אותו ערב» (on by default). The value
 * is PackFieldsInput exactly as TemplateInput.fields takes it; nothing reads a clock. Test ids: PACK_TESTIDS.fields, field(k),
 * date, hebrewDate, atLighting.
 *
 * CONTRACT FILE (lead pre-pass): the export and its props are fixed; W2 builds the body. Until then nothing is drawn.
 */
import type { ReactElement } from 'react';
import type { PackFieldKey, PackFieldsInput } from '@pulseframe/core';
export function PackFields(_props: { fields: readonly PackFieldKey[]; candle: boolean; value: PackFieldsInput; onChange: (next: PackFieldsInput) => void; lang: 'he' | 'en' }): ReactElement | null {
  return null;
}
