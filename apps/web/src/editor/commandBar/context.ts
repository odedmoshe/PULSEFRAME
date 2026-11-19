/**
 * buildBarContext(editor): the grammar's context from the editor's state (ADR-0027; core BarContext): doc and rawDoc, the
 * active sequence, revision, selection, playhead frame, chosen cut, workspace, recording, viewed format, language, the exact
 * undo and redo targets from activity (undoneBy), and inject = injectSequenceId.
 */
import type { BarContext, OpCall } from '@pulseframe/core';
import type { RevisionEvent } from '../../api.ts';
import type { Editor, EditorState } from '../store.ts';
import { injectSequenceId } from '../shorts.view.ts';

type Target = { transactionId: string; ops: string[] };
const kindOf = (e: RevisionEvent): string => e.kind ?? 'edit';
const target = (e: RevisionEvent): Target => ({ transactionId: e.transactionId, ops: [...(e.ops ?? [])] });

/**
 * The server's own rule (apps/server/src/store.ts undo): the owner's newest 'edit' or 'redo' not yet undone. `activity` is
 * newest first and holds the last 50 events, so an owner whose newest edit is older than that reads as "nothing to undo".
 */
export function undoTargetOf(activity: readonly RevisionEvent[], actor: string | null): Target | null {
  if (!actor) return null;
  const e = [...activity].sort((a, b) => b.revision - a.revision).find((x) => x.actor === actor && (kindOf(x) === 'edit' || kindOf(x) === 'redo') && !x.undoneBy);
  return e ? target(e) : null;
}
/** The owner's newest 'undo' not itself undone, unless the owner edited after it (that abandons the redo branch). */
export function redoTargetOf(activity: readonly RevisionEvent[], actor: string | null): Target | null {
  if (!actor) return null;
  const e = [...activity].sort((a, b) => b.revision - a.revision).find((x) => x.actor === actor && kindOf(x) === 'undo' && !x.undoneBy);
  if (!e) return null;
  return activity.some((x) => x.actor === actor && kindOf(x) === 'edit' && x.revision > e.revision) ? null : target(e);
}

/** The context from a state and a playhead frame (pure; buildBarContext adds the editor's frame). */
export function contextFrom(s: EditorState, playheadFrame: number): BarContext | null {
  if (!s.doc || !s.rawDoc) return null;
  const raw = s.rawDoc;
  const seq = s.activeSequenceId;
  return {
    doc: s.doc, rawDoc: raw, activeSequenceId: seq, revision: s.revision, selection: s.selection, playheadFrame,
    cutClipId: s.cutClipId, workspace: s.workspace, performRecording: !!s.performRecording, viewVariantId: s.viewVariantId, lang: s.lang,
    undoTarget: undoTargetOf(s.activity, s.actor), redoTarget: redoTargetOf(s.activity, s.actor),
    inject: (call: OpCall) => injectSequenceId(call, seq, raw.mainSequenceId),
  };
}

export function buildBarContext(editor: Editor): BarContext | null {
  return contextFrom(editor.getState(), editor.frame);
}
