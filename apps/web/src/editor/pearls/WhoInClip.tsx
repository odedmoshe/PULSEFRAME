/**
 * «מי בקליפ?» in a library card's ⋯ menu (wave 7 pearls track): a menu item (role menuitem, id PEARLS_TESTIDS.whoInClip) opening a
 * dialog with a box per person; saving commits ONE add_source_range {assetId, kind: 'presence', people} or update_source_range of
 * the file's presence range (nobody chosen removes it with remove_source_range). The owner's session only: for any other credential
 * the server refuses (403 human_tag_required) and the dialog says so in words, next to the save button; nothing is guessed.
 * MediaLibrary.tsx mounts the item while PEARLS_UI_BUILT; `close` closes the card menu.
 *
 * The card menu unmounts the item the moment it closes, so the dialog cannot live in it: choosing the item opens the dialog in a root
 * of its own (the editor passed through EditorContext) and the focus returns to the card's ⋯ button on close.
 */
import { useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Users } from 'lucide-react';
import type { Asset } from '@pulseframe/core';
import { AnchoredError, Button, Dialog } from '../../ds/index.ts';
import { isolate } from '../../ds/util.tsx';
import { EditorContext, useEditorState, type Editor } from '../store.ts';
import { openPeople } from '../lifeline/lifeUi.ts';
import { commitWords } from './pearls.commit.ts';
import { presenceOf, presenceOp } from './pearls.logic.ts';
import { pearlsT } from './pearls.strings.ts';
import { PEARLS_TESTIDS as ID } from './pearls.testids.ts';
import './pearls.css';
import { focusNow } from '../../ds/focus.ts';

export function WhoDialog({ assetId, onClose }: { assetId: string; onClose: () => void }): ReactElement | null {
  const { editor, state } = useEditorState();
  const P = pearlsT(state.lang);
  const raw = state.rawDoc;
  const have = raw ? presenceOf(raw, assetId) : null;
  const [chosen, setChosen] = useState<string[]>(() => [...(have?.people ?? [])]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!raw || !Object.hasOwn(raw.assets, assetId)) return null;
  const asset = raw.assets[assetId]!;
  const people = Object.entries(raw.people ?? {}).map(([id, p]) => ({ id, name: p.name })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
  const op = presenceOp(raw, assetId, chosen);
  const save = async () => {
    if (!op) { onClose(); return; }
    setBusy(true); setProblem(null);
    const c = await commitWords(editor, [op], 'Who is in the clip', P('whoOwnerOnly'));
    setBusy(false);
    if (!c.ok) { setProblem(c.message); return; }
    onClose();
    if (c.result.transactionId) editor.notify({ kind: 'undo', title: chosen.length ? P('whoSaved') : P('whoCleared'), undoes: c.result.transactionId });
  };
  return (
    <Dialog open onClose={onClose} title={P('whoInClip')} size="sm" closeLabel={state.lang === 'he' ? 'סגירה' : 'Close'} testId={ID.whoDialog}
      footer={<>
        <Button variant="secondary" onClick={onClose}>{P('cancel')}</Button>
        <Button variant="primary" onClick={() => void save()} busy={busy} disabled={people.length === 0} data-testid="pearl-who-save">{P('formSave')}</Button>
      </>}>
      <div className="pf-pearl-who">
        <p className="pf-film-muted" dir="auto">{isolate(asset.name)}</p>
        <p className="pf-film-muted">{P('whoHint')}</p>
        {people.length === 0 ? (
          <>
            <p role="status">{P('whoNoPeople')}</p>
            <Button size="sm" onClick={() => { onClose(); openPeople(); }}>{P('whoOpenPeople')}</Button>
          </>
        ) : (
          <div role="group" aria-label={P('whoInClip')}>
            {people.map((p, i) => (
              <label key={p.id}>
                <input type="checkbox" checked={chosen.includes(p.id)} data-autofocus={i === 0 ? '' : undefined} data-testid={ID.whoPerson} data-person-id={p.id}
                  onChange={(e) => setChosen((l) => (e.target.checked ? [...l, p.id] : l.filter((x) => x !== p.id)))} />
                <bdi dir="auto">{p.name}</bdi>
              </label>
            ))}
          </div>
        )}
        {problem && <AnchoredError onDismiss={() => setProblem(null)} dismissLabel={P('cancel')}>{problem}</AnchoredError>}
      </div>
    </Dialog>
  );
}

/** Opens the dialog in its own root; resolves when it is closed. The focus goes back to the card's ⋯ button. */
export function openWhoDialog(editor: Editor, assetId: string): void {
  const host = document.createElement('div');
  host.setAttribute('data-pearls-host', 'who');
  document.body.appendChild(host);
  const root = createRoot(host);
  const trigger = document.querySelector<HTMLElement>(`[data-testid="more-${CSS.escape(assetId)}"]`);
  // The trigger is behind the open dialog (the page is inert while it is open), so it can take the focus only once the dialog is gone: unmount
  // (React 19 runs the dialog's cleanup, which lifts the inert, before unmount() returns), then focus, all in this task.
  const done = () => { root.unmount(); host.remove(); focusNow(trigger); };
  root.render(<EditorContext.Provider value={editor}><WhoDialog assetId={assetId} onClose={done} /></EditorContext.Provider>);
}

export function WhoInClipItem({ asset, close }: { asset: Asset; close: () => void }): ReactElement {
  const { editor, state } = useEditorState();
  const P = pearlsT(state.lang);
  const tagged = !!state.rawDoc && !!presenceOf(state.rawDoc, asset.id);
  return (
    <button type="button" role="menuitem" className="pf-mc-item" data-testid={ID.whoInClip} data-tagged={tagged ? 'yes' : 'no'}
      onClick={() => { openWhoDialog(editor, asset.id); close(); }}>
      <Users size={16} strokeWidth={1.75} aria-hidden="true" />{P('whoInClip')}
    </button>
  );
}
