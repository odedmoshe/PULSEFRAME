/**
 * Strings and fixed data-testids of the voice cleanup block «ניקוי קול» (ADR-0013), mounted at the top of AudioFxBlock (W2).
 * Hebrew first; English covers the same keys (cleanup.strings.test.ts). The data-testids are fixed by the lead's contracts pass:
 * the proofs and the accessibility audit find the block by them. W2 owns this file and may add keys; it may not rename these.
 */
export const VOICE_CLEAN_TESTIDS = {
  block: 'voice-clean', run: 'voice-clean-run', status: 'voice-clean-status', strength: 'voice-clean-strength', remove: 'voice-clean-remove',
  before: 'voice-clean-before', after: 'voice-clean-after', scopeAsset: 'voice-clean-scope-asset', unlistened: 'voice-clean-unlistened',
  sourceWarning: 'voice-clean-source-warning', disabled: 'voice-clean-disabled',
} as const;
export const VOICE_CLEAN_STRINGS = {
  he: {
    title: 'ניקוי קול', run: 'נקה את הקול', measuring: 'מודד…', remove: 'הסר ניקוי', strength: 'עוצמת הניקוי',
    before: 'לפני', after: 'אחרי', scopeAsset: 'החל על כל הקטעים מאותה הקלטה', unlistened: 'טרם נבדק בהאזנה', undoLabel: 'ניקוי קול',
  },
  en: {
    title: 'Voice cleanup', run: 'Clean up the voice', measuring: 'Measuring…', remove: 'Remove cleanup', strength: 'Cleanup strength',
    before: 'Before', after: 'After', scopeAsset: 'Apply to every clip of the same recording', unlistened: 'Not yet checked by listening', undoLabel: 'Voice cleanup',
  },
} as const;
