/**
 * One registered operation (or a few that belong together) through the editor's commit path, the way every pearls surface
 * saves: ONE `editor.commit` = one transaction = one undo. `Editor.commit` reports a refusal as text in `state.error` (worded in
 * the interface language by the editor, with the server's own reason), so a surface that must show the refusal next to its control
 * reads it back here. Nothing is guessed: no result means the server did not apply it.
 */
import type { CommitResult } from '../../api.ts';
import type { OpCall } from '@pulseframe/core';
import type { Editor } from '../store.ts';

export type Committed = { ok: true; result: CommitResult } | { ok: false; message: string };
export async function commitWords(editor: Editor, ops: OpCall[], label: string, fallback: string): Promise<Committed> {
  const r = await editor.commit(ops, label);
  return r ? { ok: true, result: r } : { ok: false, message: editor.getState().error ?? fallback };
}
/** The id of the range an add_source_range made. */
export const newRangeId = (r: CommitResult): string | null => { const id = r.results.find((x) => x.op === 'add_source_range')?.output?.rangeId; return typeof id === 'string' ? id : null; };
