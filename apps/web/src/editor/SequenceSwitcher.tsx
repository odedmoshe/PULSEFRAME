/**
 * The sequence switcher (ADR-0018, W3), mounted above the timeline: role=tablist with arrow keys and Home/End, aria-selected,
 * labels «ראשי» and «<name> · m:ss» (numbers in <bdi dir="ltr">), a delete button per short that opens a confirmation dialog
 * (aria-modal) committing remove_sequence { withContents: true }; hidden while the project has one sequence. Choosing a tab
 * calls the editor's setActiveSequence (store.ts, W3), which shows the projection core projectOutput(rawDoc, { sequenceId }).
 * Test ids: shorts.testids.ts SHORTS_TESTIDS.switcher, tab, tabMain, tabDelete, deleteDialog, deleteConfirm, deleteCancel.
 *
 * PLACEHOLDER of the lead's contracts commit: it draws nothing, so the editor stays as it is (no sequence can be added before
 * W1 builds add_sequence). Not mounted yet.
 */
import type { ReactElement } from 'react';

export function SequenceSwitcher(): ReactElement | null {
  return null;
}
