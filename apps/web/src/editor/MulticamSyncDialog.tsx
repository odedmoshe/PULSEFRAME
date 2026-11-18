/**
 * The sync dialog of a multicam group (ADR-0020, W3; modal is fine here): one row per file with its verdict chip IN WORDS
 * (never colour alone), offset in <bdi dir="ltr">, drift ppm, peak ratio and residual; ±1 frame and ±1 ms spinbuttons with
 * aria-valuetext (set_multicam_sync nudge); the candidates with «בחירה» (set_multicam_sync offset); the capture-time hand
 * choice «לפי שעת הצילום (משוער)» with its uncertainty (core multicamPrior.ts; never applied by itself); re-sync with the
 * would_discard_edits prompt. Data from GET /projects/:id/multicam/:groupId (core MulticamView).
 * LEAD PLACEHOLDER: a dialog that says the sync review is not built yet and closes; it shows no verdict.
 */
import { dictionaries } from '@pulseframe/i18n';
import { Button, Dialog } from '../ds/index.ts';
import { MULTICAM_TESTIDS as ID } from './multicam.testids.ts';

export interface MulticamSyncDialogProps { groupId: string; lang: 'he' | 'en'; onClose: () => void }
export function MulticamSyncDialog({ lang, onClose }: MulticamSyncDialogProps) {
  const t = dictionaries[lang];
  return (
    <Dialog open title={t['multicam.sync']} onClose={onClose} testId={ID.syncDialog} closeLabel={lang === 'he' ? 'סגירה' : 'Close'} footer={<Button onClick={onClose}>{lang === 'he' ? 'סגירה' : 'Close'}</Button>}>
      <p data-testid={ID.notBuilt}>{t['multicam.notBuilt']}</p>
    </Dialog>
  );
}
