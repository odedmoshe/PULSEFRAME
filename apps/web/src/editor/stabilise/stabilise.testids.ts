/**
 * Fixed data-testids of the stabilisation block in the inspector (wave 7 stabilise track; .artifacts/wave7/stabilise-decisions.md),
 * shared by the block (W3) and the proofs (stabilise-proof.ts, a11y-stabilise.ts). Lead contract: W3 puts exactly these on the
 * elements named here and does not rename them. The section itself is `section-stabilise` (Section.tsx).
 */
export const STABILISE_TESTIDS = {
  /** the block's body; data-state = not-measured | measuring | on | off | limited | refused | not-offered */
  panel: 'stab-panel',
  /** «ייצבו את הקליפ» and «עצירה» while the job runs */
  run: 'stab-run', stop: 'stab-stop',
  /** the switch «ייצוב פועל» (role switch, aria-checked) and the strength slider «עוצמה» (1–100) */
  toggle: 'stab-toggle', strength: 'stab-strength',
  /** the crop line «חיתוך שוליים: N% מהתמונה (הגדלה ×Z)», «חשבו מחדש את חיתוך השוליים», the report with its jump links, the status line */
  crop: 'stab-crop', recalc: 'stab-recalc', report: 'stab-report', status: 'stab-status',
  /** «הסרת המדידה» */
  remove: 'stab-remove',
} as const;
