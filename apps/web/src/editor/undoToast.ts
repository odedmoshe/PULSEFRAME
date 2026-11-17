/**
 * The toast queue's view of an editor notice (App.tsx ToastBridge). An undo toast's button reverses exactly the transaction it
 * reports (editor.undoTransaction): a toast lives for seconds and more edits can land meanwhile (the owner's own, another
 * tab's, an agent's), so "undo the newest" would undo something else. A notice that names no transaction gets no button.
 */
import type { ToastInput } from '../ds/index.ts';
import type { Editor, Notice } from './store.ts';

export function toastOf(notice: Notice, undoLabel: string, editor: Pick<Editor, 'undoTransaction'>): ToastInput {
  const id = notice.kind === 'undo' ? notice.undoes : undefined;
  return {
    kind: id ? 'undo' : 'info', title: notice.title, ...(notice.body ? { body: notice.body } : {}),
    ...(id ? { action: undoLabel, onAction: () => void editor.undoTransaction(id) } : {}),
  };
}
