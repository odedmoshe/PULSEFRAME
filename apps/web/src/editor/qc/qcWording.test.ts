/**
 * Wording of «בדיקה לפני ייצוא» (wave 8 qc): every preflight code the sheet shows has a Hebrew row (verifier C12), and no
 * user-visible string of the section says the film is fine (C7: Q11 is checked on the strings the owner reads, not on the API's
 * `ok`/`verdict` fields). The rows marked todo are B2's: they fail today, by the verifier's count.
 */
import { describe, expect, it } from 'vitest';
import { PREFLIGHT_CODES_WITH_HEBREW_BEFORE_QC, PREFLIGHT_SHOWN_CODES, QC_CODES } from '@pulseframe/core';
import { dictionaries } from '@pulseframe/i18n';
import { EXPORT_STRINGS } from '../exportSheet.strings.ts';

const JUDGES_EN = /\b(fine|ok|okay|pass|passed|clean|all clear|no problems|safe|verified)\b/i;
const JUDGES_HE = /(^|[^֐-׿])(תקין|תקינה|עבר|בטוח|מאומת|אין בעיות|לא נמצאו בעיות)([^֐-׿]|$)/;
const judges = (s: string) => JUDGES_EN.test(s) || JUDGES_HE.test(s);

describe('qc wording (wave 8)', () => {
  it('the five new codes and the ten older ones have a Hebrew and an English row in the sheet\'s table', () => {
    for (const code of [...QC_CODES, ...PREFLIGHT_CODES_WITH_HEBREW_BEFORE_QC]) {
      expect(EXPORT_STRINGS.he.issue[code]?.[0], code).toBeTruthy();
      expect(EXPORT_STRINGS.en.issue[code]?.[0], code).toBeTruthy();
    }
  });
  it('no qc string, and no row of the new codes, judges the film (C7, Q11)', () => {
    const qc = (['he', 'en'] as const).flatMap((l) => Object.entries(dictionaries[l]).filter(([k]) => k.startsWith('qc.')).map(([, v]) => v));
    const rows = (['he', 'en'] as const).flatMap((l) => QC_CODES.flatMap((c) => EXPORT_STRINGS[l].issue[c] ?? []));
    expect([...qc, ...rows].filter(judges)).toEqual([]);
  });
  // B2 (qc-b2.md): C12 and C7 on the strings that exist today
  it.todo('every code of PREFLIGHT_SHOWN_CODES has a Hebrew row (the 28 of C12; the four of lifeline.ts preflight.* are read or reused)');
  it.todo('no user-visible string of the sheet\'s check section or the file card judges the film: allClear, flashPass «בדיקת ההבהובים: עבר», loudOk «מתאים לרשתות» are reworded, and the ShieldCheck/Check icons there are gone (C7)');
  void PREFLIGHT_SHOWN_CODES;
});
