/**
 * The perform view (ADR-0025; the workspace `perform`, «הופעה»), mounted by Transport.tsx while that workspace is chosen.
 * PLACEHOLDER of the lead's contracts pass: it says honestly that the part is not built and does nothing else (no pads, no
 * capture, nothing committed). W3 replaces the body with the pad row, the take lane, the calibration and the camera, against
 * perform/contract.ts (PerformHost on the editor, PerformPlayerPort on the player) and the fixed test ids
 * (perform.testids.ts); the signature `PerformView(): JSX.Element` stays.
 */
import { useEditorState } from '../store.ts';
import { PERFORM_TESTIDS as ID } from './perform.testids.ts';

export function PerformView() {
  const { t } = useEditorState();
  return (
    <section className="pf-ds pf-perform" data-testid={ID.view} aria-label={t('perform.title')}>
      <p role="status" data-testid={ID.notBuilt}>{t('perform.notBuilt')}</p>
    </section>
  );
}
