/**
 * Fixed data-testids of the phone's upload page (ADR-0023), for the proof's phone contexts (phone-drop-proof.ts) and the
 * page's own test (dropPage.test.ts). Lead contract: W3's page.html / page.js put exactly these on the elements named here
 * (the page cannot import this file: it has no build step, so the test checks the page's text holds each id).
 */
export const DROP_PAGE_TESTIDS = {
  /** The two pickers: «בחירת סרטונים ותמונות» (accept="image/*,video/*") and the one for videos in original quality (no accept). */
  pickMedia: 'drop-pick-media', pickOriginal: 'drop-pick-original',
  /** The typed fallback: the 6-digit code field and its button (shown when the page was opened without a token in the fragment). */
  pin: 'drop-pin', pinSubmit: 'drop-pin-submit',
  /** One row per chosen file (i from 0 in the order chosen), its state text and its progress bar. */
  file: (i: number) => `drop-file-${i}`, fileState: 'drop-file-state', fileProgress: 'drop-file-progress',
  /** «3 מתוך 7», the live status line (role=status), «סיימתי», the language toggle. */
  total: 'drop-total', status: 'drop-status', done: 'drop-done', lang: 'drop-lang',
} as const;
