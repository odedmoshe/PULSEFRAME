/**
 * Fixed data-testids of «שמירת הסרט כתבנית» (wave 8 owntemplate pre-pass; plan 3.8), shared by the interface (W3) and the proofs
 * (editor-interactions-proof.ts rows, the a11y states own-template-dialog, own-template-section, toast-in-own-template-dialog).
 * Lead contract: the builders put exactly these on the elements named here and do not rename them. Own cards reuse the gallery's
 * `template-card` (templates.testids.ts) with data-own="true".
 */
export const OWN_TEMPLATE_TESTIDS = {
  /** the drawer button «שמירת הסרט כתבנית» above the genre chips (disabled with its reason when the main sequence has no shots) */
  save: 'own-template-save',
  /** the section «התבניות שלכם» before the built-in cards; the badge «נעשתה מהסרט שלכם» inside an own card; delete after the card (not nested in it) */
  section: 'own-template-section', badge: 'own-template-badge', del: 'own-template-delete',
  /** the save dialog and its fields */
  dialog: 'own-template-dialog', name: 'own-template-name', genre: 'own-template-genre', keepWords: 'own-template-keep-words',
  /** the drawn strip (role=img with the counts in its label; also inside an own card) */
  schematic: 'own-template-schematic',
  /** «מה נשמר» and «מה לא נשמר»: lists whose items carry data-code (kept kind or not-kept code) */
  carried: 'own-template-carried', notCarried: 'own-template-not-carried',
  /** the privacy line, the name warning, «שמירה» */
  privacy: 'own-template-privacy', nameWarning: 'own-template-name-warning', confirm: 'own-template-confirm',
} as const;
