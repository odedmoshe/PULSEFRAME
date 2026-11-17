/**
 * Strings and fixed data-testids of the colour match panel «התאמת צבע» (ADR-0014), mounted in LookPanel (W3). Hebrew first;
 * English covers the same keys (cleanup.strings.test.ts). `{n}` is replaced by a number. The data-testids are fixed by the lead's
 * contracts pass: the proofs and the accessibility audit find the panel by them. W3 owns this file and may add keys; it may not
 * rename these.
 */
export const COLOUR_MATCH_TESTIDS = {
  panel: 'colour-match', setReference: 'colour-match-set-reference', scope: 'colour-match-scope', method: 'colour-match-method',
  amount: 'colour-match-amount', measure: 'colour-match-measure', progress: 'colour-match-progress', results: 'colour-match-results',
  apply: 'colour-match-apply', unavailable: 'colour-match-unavailable',
} as const;
export const COLOUR_MATCH_STRINGS = {
  he: {
    title: 'התאמת צבע', setReference: 'קבע כייחוס', scope: 'היקף', scopeClip: 'הקטע הנבחר', scopeTrack: 'כל הקטעים במסלול', scopeAll: 'כל קטעי התמונה',
    method: 'שיטה', methodMatch: 'התאמה לקטע ייחוס', methodBalance: 'איזון צבע אוטומטי', amount: 'עוצמה', measure: 'מדוד', applyN: 'החל על {n} קטעים',
  },
  en: {
    title: 'Colour match', setReference: 'Set as reference', scope: 'Scope', scopeClip: 'The selected clip', scopeTrack: 'Every clip on the track', scopeAll: 'Every picture clip',
    method: 'Method', methodMatch: 'Match to a reference clip', methodBalance: 'Automatic colour balance', amount: 'Amount', measure: 'Measure', applyN: 'Apply to {n} clips',
  },
} as const;
