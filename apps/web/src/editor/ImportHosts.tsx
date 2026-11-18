/**
 * The lead's mounts of the import queue and the phone drop (ADR-0023) in the redesigned editor (docs/design/UX_REDESIGN.md §4.4:
 * the media drawer's one primary action, «ייבוא», gets its menu of other ways in):
 * - ImportMenu: the menu button beside «ייבוא» (file-input stays the button itself): «תיקייה…» and «מהטלפון…» (owner only).
 * - FolderPicker: the one hidden folder input (webkitdirectory, test id folder-input), opened by the menu and the palette
 *   command cmd.importFolder; its files go to ImportsStore.enqueueFolder (media only, natural order, at most 500).
 * - PhoneDropHost: the PhoneDrop dialog wherever the editor is (the palette command cmd.phoneDrop opens it from any drawer),
 *   fed from the editor store: this computer's addresses (asked when it opens), the live code, the SSE `drop` view, the phone's
 *   import cards, the honest problem, and a clock ticked once a second while it matters.
 * - DropChip: while a code is live and the dialog is hidden, a chip in the drawer header with the time left and a close button.
 * Every persistent edit stays the server's (the import's own commit) or an operation through Editor.commit (placement).
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ChevronDown, FolderOpen, Smartphone, X } from 'lucide-react';
import type { DropAddress } from '@pulseframe/core';
import { Menu } from '../ds/index.ts';
import { dropApi } from './imports.api.ts';
import { IMPORT_TESTIDS, PHONE_DROP_TESTIDS } from './imports.testids.ts';
import { formatClock, PhoneDrop } from './PhoneDrop.tsx';
import { PHONE_DROP_STRINGS } from './phoneDrop.strings.ts';
import { useEditorState, type Editor } from './store.ts';

const IMPORT_MENU = {
  he: { more: 'דרכים נוספות לייבוא', folder: 'תיקייה…', phone: 'מהטלפון…' },
  en: { more: 'More ways to import', folder: 'A folder…', phone: 'From a phone…' },
} as const;

/** Opens the folder picker from anywhere (the menu item and the palette command). */
export function pickFolder(): void { document.querySelector<HTMLInputElement>(`[data-testid=${IMPORT_TESTIDS.folderInput}]`)?.click(); }

/** The menu beside the drawer's «ייבוא»: a folder, or the phone (the owner's own session only: a code is the owner's to issue). */
export function ImportMenu(): ReactElement {
  const { editor, state } = useEditorState();
  const S = IMPORT_MENU[state.lang];
  const owner = state.actor === 'user:local';
  return (
    <Menu label={S.more} onSelect={(id) => (id === 'folder' ? pickFolder() : editor.openPhoneDrop())}
      items={[{ id: 'folder', label: S.folder, disabled: !state.doc, icon: <FolderOpen size={16} strokeWidth={1.75} aria-hidden="true" />, testId: 'import-folder' }, ...(owner ? [{ id: 'phone', label: S.phone, disabled: !state.doc, icon: <Smartphone size={16} strokeWidth={1.75} aria-hidden="true" />, testId: IMPORT_TESTIDS.phoneDropOpen }] : [])]}
      trigger={(t) => (
        <button {...t} type="button" className="pf-btn pf-btn-primary pf-btn-sm pf-bw-import-more" aria-label={S.more} title={S.more} data-testid="import-more">
          <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )} />
  );
}

/** The one hidden folder input of the editor. */
export function FolderPicker(): ReactElement {
  const { editor } = useEditorState();
  const attrs = { webkitdirectory: '', directory: '' } as Record<string, string>;
  return (
    <input type="file" multiple hidden tabIndex={-1} aria-hidden="true" data-testid={IMPORT_TESTIDS.folderInput} {...attrs}
      onChange={(e) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = '';
        editor.importFolder(files.map((file) => ({ file, relativePath: (file as { webkitRelativePath?: string }).webkitRelativePath || file.name })));
      }} />
  );
}

/** Milliseconds since the epoch, ticked once a second while `on`. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [on]);
  return now;
}
const liveCode = (editor: Editor) => { const d = editor.getState().drop; return d && d.state !== 'closed' ? d : null; };

export function PhoneDropHost(): ReactElement | null {
  const { editor, state } = useEditorState();
  const [addresses, setAddresses] = useState<DropAddress[] | null>(null);
  const asked = useRef(false);
  const open = state.phoneDropOpen;
  useEffect(() => {
    if (!open) { asked.current = false; return; }
    if (asked.current) return;
    asked.current = true;
    setAddresses(null);
    void dropApi.addresses().then((r) => setAddresses(r.addresses), () => setAddresses([]));
    void editor.refreshDrop();
  }, [open, editor]);
  const code = state.drop;
  const now = useNow(open || !!liveCode(editor));
  if (state.actor !== 'user:local') return null;
  const live = code && state.dropLive?.dropId === code.dropId ? state.dropLive : null;
  const files = code ? state.imports.jobs.filter((j) => j.via === 'phone' && j.dropId === code.dropId) : [];
  return (
    <PhoneDrop lang={state.lang} open={open} addresses={addresses} code={code} live={live} files={files}
      problem={state.dropProblem} now={now}
      onOpenCode={(address) => void editor.openDropCode(address)} onNewCode={(address) => void editor.openDropCode(address)}
      onCloseCode={(dropId) => void editor.closeDropCode(dropId)} onHide={() => editor.hidePhoneDrop()}
      onRetry={(id) => void editor.imports.retry(id).catch(editor.fail)} onCancel={(id) => void editor.imports.cancel(id).catch(editor.fail)} onDismiss={(id) => void editor.imports.dismiss(id).catch(editor.fail)} />
  );
}

/** While a code is live and its dialog hidden: the time left, reopening the dialog, and closing the code. */
export function DropChip(): ReactElement | null {
  const { editor, state } = useEditorState();
  const code = liveCode(editor);
  const now = useNow(!!code && !state.phoneDropOpen);
  if (!code || state.phoneDropOpen) return null;
  const S = PHONE_DROP_STRINGS[state.lang];
  const left = formatClock(Date.parse((state.dropLive?.dropId === code.dropId ? state.dropLive : code).expiresAt) - now);
  return (
    <span className="pf-pd-chip-wrap">
      <button type="button" className="pf-btn pf-btn-secondary pf-btn-sm pf-pd-chip" data-testid={PHONE_DROP_TESTIDS.chip} onClick={() => editor.openPhoneDrop()}>
        <Smartphone size={14} strokeWidth={1.75} aria-hidden="true" /><span className="pf-btn-label">{S.chip.replace('{time}', '')}<bdi dir="ltr" className="num">{left}</bdi></span>
      </button>
      <button type="button" className="pf-btn pf-btn-ghost pf-btn-sm pf-pd-chip-close" aria-label={S.chipClose} title={S.chipClose} data-testid={PHONE_DROP_TESTIDS.chipClose} onClick={() => void editor.closeDropCode(code.dropId)}>
        <X size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </span>
  );
}
