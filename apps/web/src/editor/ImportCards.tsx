/**
 * The import cards (ADR-0023; plan §7): a section «בייבוא (N)» at the top of the media drawer, in its OWN list outside
 * `ul.assets` (proofs wait on `.assets li` for a real asset). Per file: a kind icon (no fake thumbnail), the name, the size, a
 * source badge (phone or folder), the state chip and a progress bar that fills from the reading direction; the four states of
 * the brief from importCardState (core) — «ממתין» (with «בתור: N לפניו», «ממתין לסיום הייצוא» or «נבדק»), «ממיר 42%» (with the
 * reasons, notice.reason.*), «מוכן» (2 s, then the real asset card), «נכשל» with the reason (error.code.*) and «ניסיון חוזר»
 * only when retryable / «הסרה» — and the local «בהעלאה 42%» before them; a cancel button on waiting and converting cards.
 * Announcements only on ready and failed, never per percent. Static bars under reduced motion.
 * Props only (the lead's mount passes ImportsStore.snapshot()). Test ids: IMPORT_TESTIDS. Strings: imports.strings.ts.
 *
 * CONTRACT FILE (lead pre-pass): the export and its props are fixed; W3 builds the body. Until then nothing is drawn.
 */
import type { ReactElement } from 'react';
import type { ImportsState } from './imports.ts';
import type { ImportsLang } from './imports.strings.ts';

export interface ImportCardsProps {
  lang: ImportsLang;
  state: ImportsState;
  onRetry(jobId: string): void;
  onCancel(jobId: string): void;
  onDismiss(jobId: string): void;
  /** Stops a local upload before it has a job. */
  onCancelLocal(localId: string): void;
}
export function ImportCards(_props: ImportCardsProps): ReactElement | null {
  return null;
}
