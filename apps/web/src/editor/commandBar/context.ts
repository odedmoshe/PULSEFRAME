/**
 * buildBarContext(editor): the grammar's context from the editor's state (ADR-0027; core BarContext): doc and rawDoc, the
 * active sequence, revision, selection, playhead frame, chosen cut, workspace, recording, viewed format, language, the exact
 * undo and redo targets from activity (undoneBy), and inject = injectSequenceId. W3 builds it.
 * PLACEHOLDER of the lead's pre-pass: refuses (nothing calls it yet).
 */
import type { BarContext } from '@pulseframe/core';
import type { Editor } from '../store.ts';

export function buildBarContext(_editor: Editor): BarContext | null {
  throw new Error('buildBarContext: not built yet (ADR-0027 W3)');
}
