/**
 * Bilingual command palette and shortcut editor (SPEC §2, §3). Generated from the COMMANDS registry
 * and the i18n dictionaries; searches both languages. Bindings are changed only through Keymap.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { dictionaries, type Key, type Lang } from '@pulseframe/i18n';
import { COMMANDS, chordLabel, chordOf, type Command, type Keymap } from './commands.ts';
import { rankCommands } from './palette.search.ts';
import { useEditorState } from './store.ts';
import './command-palette.css';

const MODIFIER_CODES = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'OS', 'AltGraph']);
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
const SEARCH_ITEMS = COMMANDS.map((c) => ({ id: c.id, he: dictionaries.he[c.label], en: dictionaries.en[c.label] }));
const GROUP_ORDER = [...new Set(COMMANDS.map((c) => c.group))];
const byId = new Map(COMMANDS.map((c) => [c.id, c]));
const otherLang = (l: Lang): Lang => (l === 'he' ? 'en' : 'he');

export function CommandPalette({ keymap }: { keymap: Keymap }) {
  const { state } = useEditorState();
  if (!state.paletteOpen) return null;
  return <PaletteDialog keymap={keymap} />;
}

function PaletteDialog({ keymap }: { keymap: Keymap }) {
  const { editor, state, t } = useEditorState();
  const lang = state.lang;
  const [view, setView] = useState<'palette' | 'shortcuts'>('palette');
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [displaced, setDisplaced] = useState<string[] | null>(null);
  const [, setTick] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const listId = 'pf-palette-list';

  // Focus the search input on open; restore the previous focus on close.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    if (view === 'shortcuts') backRef.current?.focus();
    else inputRef.current?.focus();
  }, [view]);

  const close = () => editor.set({ paletteOpen: false });
  const label = (c: Command, l: Lang = lang) => dictionaries[l][c.label];
  const enabled = (c: Command) => !c.enabled || c.enabled(editor);
  const chords = (c: Command) => keymap.keysFor(c.id);

  // Display order: grouped (registry order) when the query is empty, otherwise a ranked flat list.
  const ranked = useMemo(() => rankCommands(query, SEARCH_ITEMS).map((id) => byId.get(id)!), [query]);
  const groups = useMemo(
    () => (query.trim() ? [{ group: null as Command['group'] | null, items: ranked }] : GROUP_ORDER.map((g) => ({ group: g as Command['group'] | null, items: ranked.filter((c) => c.group === g) }))).filter((g) => g.items.length),
    [query, ranked],
  );
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const active = flat.find((c) => c.id === activeId) ?? flat[0];
  const optionDomId = (id: string) => `pf-palette-opt-${id.replace(/[^A-Za-z0-9_-]/g, '-')}`;

  useEffect(() => {
    if (active) document.getElementById(optionDomId(active.id))?.scrollIntoView?.({ block: 'nearest' });
  }, [active?.id]);

  const run = (c: Command | undefined) => {
    if (!c || !enabled(c)) return;
    close();
    // Let the dialog unmount and focus return first, so commands that need focus elsewhere work.
    setTimeout(() => void c.run(editor), 0);
  };
  const move = (to: number) => flat.length && setActiveId(flat[(to + flat.length) % flat.length]!.id);

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const i = active ? flat.indexOf(active) : 0;
    if (e.key === 'ArrowDown') { e.preventDefault(); move(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(flat.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); run(active); }
  };

  const onDialogKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (capturing) {
      // Everything goes to the capture, not to the global shortcut dispatcher.
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setCapturing(null); return; }
      if (MODIFIER_CODES.has(e.code) || e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      const lost = keymap.bind(capturing, [chordOf(e)]);
      setCapturing(null);
      setDisplaced(lost);
      setTick((n) => n + 1);
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') {
      const nodes = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (!nodes.length) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const at = document.activeElement;
      if (e.shiftKey && (at === first || !dialogRef.current?.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !dialogRef.current?.contains(at))) { e.preventDefault(); first.focus(); }
    }
  };

  const chordCell = (c: Command) => {
    const ks = chords(c);
    if (!ks.length) return <span className="pf-pal-none">{t('shortcuts.none')}</span>;
    return <span className="pf-pal-chords">{ks.map((k) => <kbd key={k} dir="ltr">{chordLabel(k)}</kbd>)}</span>;
  };

  const other = otherLang(lang);

  return (
    <div className="pf-pal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={dialogRef} className="pf-pal-dialog" role="dialog" aria-modal="true" aria-label={t('cmd.palette')} data-testid="palette-dialog" onKeyDown={onDialogKey}>
        {view === 'palette' ? (
          <>
            <input
              ref={inputRef}
              className="pf-pal-input"
              data-testid="palette-input"
              role="combobox"
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls={listId}
              aria-activedescendant={active ? optionDomId(active.id) : undefined}
              aria-label={t('cmd.palette')}
              placeholder={t('palette.placeholder')}
              value={query}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => { setQuery(e.target.value); setActiveId(null); }}
              onKeyDown={onInputKey}
            />
            <div id={listId} className="pf-pal-list" role="listbox" aria-label={t('cmd.palette')}>
              {groups.map((g) => (
                <div key={g.group ?? 'results'} role="group" aria-label={g.group ? t(`group.${g.group}` as Key) : undefined}>
                  {g.group && <div className="pf-pal-heading" aria-hidden="true">{t(`group.${g.group}` as Key)}</div>}
                  {g.items.map((c) => {
                    const ok = enabled(c);
                    return (
                      <div
                        key={c.id}
                        id={optionDomId(c.id)}
                        role="option"
                        data-testid="palette-option"
                        data-command-id={c.id}
                        aria-selected={c.id === active?.id}
                        aria-disabled={ok ? undefined : 'true'}
                        className="pf-pal-option"
                        data-active={c.id === active?.id || undefined}
                        onMouseMove={() => c.id !== active?.id && setActiveId(c.id)}
                        onClick={() => run(c)}
                      >
                        <span className="pf-pal-names">
                          <span className="pf-pal-label" lang={lang}>{label(c)}</span>
                          {label(c, other) !== label(c) && <span className="pf-pal-alt" lang={other}>{label(c, other)}</span>}
                          {!ok && <span className="pf-pal-unavail">{t('palette.unavailable')}</span>}
                        </span>
                        {chordCell(c)}
                      </div>
                    );
                  })}
                </div>
              ))}
              {!flat.length && <div className="pf-pal-empty" role="status">{t('palette.empty')}</div>}
            </div>
            <div className="pf-pal-footer">
              <button type="button" className="pf-pal-btn" data-testid="palette-shortcuts" onClick={() => setView('shortcuts')}>{t('shortcuts')}</button>
              <button type="button" className="pf-pal-btn" onClick={close}>{t('close')}</button>
            </div>
          </>
        ) : (
          <>
            <div className="pf-pal-head">
              <h2 className="pf-pal-title">{t('shortcuts')}</h2>
              <button ref={backRef} type="button" className="pf-pal-btn" data-testid="palette-back" onClick={() => { setView('palette'); setCapturing(null); setDisplaced(null); }}>{t('cmd.palette')}</button>
            </div>
            <div className="pf-pal-scroll">
              <table className="pf-pal-table" data-testid="shortcut-table">
                <caption className="pf-pal-sr">{t('shortcuts')}</caption>
                <tbody>
                  {COMMANDS.map((c) => {
                    const isCapturing = capturing === c.id;
                    const custom = keymap.isCustom(c.id);
                    return (
                      <tr key={c.id} data-command-id={c.id} data-custom={custom || undefined}>
                        <th scope="row" className="pf-pal-cell-name">
                          <span className="pf-pal-label" lang={lang}>{label(c)}</span>
                          {label(c, other) !== label(c) && <span className="pf-pal-alt" lang={other}>{label(c, other)}</span>}
                        </th>
                        <td>{isCapturing ? <span className="pf-pal-capture" role="status">{t('shortcuts.press')}</span> : chordCell(c)}{custom && <span className="pf-pal-custom" aria-hidden="true"> ●</span>}</td>
                        <td className="pf-pal-cell-action">
                          <button type="button" className="pf-pal-btn" aria-label={`${t('shortcuts.change')}: ${label(c)}`} onClick={() => { setDisplaced(null); setCapturing(c.id); }}>{t('shortcuts.change')}</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="pf-pal-footer">
              <span className="pf-pal-status" role="status" data-testid="shortcut-status">
                {displaced && displaced.length > 0 && `${t('shortcuts.displaced')}: ${displaced.map((id) => (byId.get(id) ? label(byId.get(id)!) : id)).join(', ')}`}
              </span>
              <button type="button" className="pf-pal-btn" onClick={() => { keymap.reset(); setDisplaced(null); setCapturing(null); setTick((n) => n + 1); }}>{t('shortcuts.reset')}</button>
              <button type="button" className="pf-pal-btn" onClick={close}>{t('close')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
