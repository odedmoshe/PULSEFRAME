/**
 * Bilingual command palette and shortcut editor (SPEC §2, §3). Generated from the COMMANDS registry
 * and the i18n dictionaries; searches both languages. Bindings are changed only through Keymap.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { dictionaries, type Key, type Lang } from '@pulseframe/i18n';
import { COMMANDS, chordLabel, chordOf, type Command, type Keymap } from './commands.ts';
import { COLOR_LOOKS, EFFECTS, TRANSITIONS } from '@pulseframe/core';
import { Film, Search, Sparkles } from 'lucide-react';
import { CHROME_STRINGS } from './chrome.strings.ts';
import { getChrome, setPaletteView } from './chromeState.ts';
import { pickCall, type PickKind } from './gallery.pick.ts';
import { normalize, rankCommands, rankWithRescue } from './palette.search.ts';
import { defaultActiveKey, exactCommandId } from './palette.enter.ts';
import { useEditorState } from './store.ts';
import { ToastSlot } from '../ds/index.ts';
import './command-palette.css';
// the Hebrew command bar (ADR-0027): its rows come first in the one listbox (commandBar/contract.ts)
import { AssistantRow } from './commandBar/AssistantRow.tsx';
import { BarPanel, BarSection } from './commandBar/BarSection.tsx';
import { useBarSlot } from './commandBar/useBarResult.ts';

const MODIFIER_CODES = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'OS', 'AltGraph']);
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
const SEARCH_ITEMS = COMMANDS.map((c) => ({ id: c.id, he: c.text?.he ?? dictionaries.he[c.label], en: c.text?.en ?? dictionaries.en[c.label] }));
const GROUP_ORDER = [...new Set(COMMANDS.map((c) => c.group))];
const byId = new Map(COMMANDS.map((c) => [c.id, c]));
const otherLang = (l: Lang): Lang => (l === 'he' ? 'en' : 'he');
type Scope = 'all' | 'commands' | 'catalogue' | 'media' | 'assistant';
interface CatItem { key: string; kind: PickKind; id: string; he: string; en: string }
const CATALOGUE: CatItem[] = [
  ...EFFECTS.map((e) => ({ key: `effect:${e.id}`, kind: 'effect' as const, id: e.id, he: e.name.he, en: e.name.en })),
  ...TRANSITIONS.map((x) => ({ key: `transition:${x.id}`, kind: 'transition' as const, id: x.id, he: x.name.he, en: x.name.en })),
  ...COLOR_LOOKS.map((l) => ({ key: `look:${l.id}`, kind: 'look' as const, id: l.id, he: l.name.he, en: l.name.en })),
];
const catById = new Map(CATALOGUE.map((c) => [c.key, c]));
const CAT_SEARCH = CATALOGUE.map((c) => ({ id: c.key, he: c.he, en: c.en }));

export function CommandPalette({ keymap }: { keymap: Keymap }) {
  const { state } = useEditorState();
  if (!state.paletteOpen) return null;
  return <PaletteDialog keymap={keymap} />;
}

function PaletteDialog({ keymap }: { keymap: Keymap }) {
  const { editor, state, t } = useEditorState();
  const lang = state.lang;
  const C = CHROME_STRINGS[lang];
  const [view, setView] = useState<'palette' | 'shortcuts'>(getChrome().paletteView);
  const [scope, setScope] = useState<Scope>('all');
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [displaced, setDisplaced] = useState<string[] | null>(null);
  const [, setTick] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const listId = 'pf-palette-list';

  // Under the command bar (§4.10): placed from its position, clamped to the window. The intent to start on the shortcuts page is used once.
  useEffect(() => {
    setPaletteView('palette');
    const r = document.querySelector<HTMLElement>('[data-testid=open-palette]')?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(Math.max(r.width, 600), window.innerWidth - 24);
    setAnchor({ top: r.bottom + 8, width, left: Math.max(12, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 12)) });
  }, []);
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
  const bar = useBarSlot(query, { lang, close, setQuery: (q: string) => { setQuery(q); setActiveId(null); inputRef.current?.focus(); } });
  const label = (c: Command, l: Lang = lang) => c.text?.[l] ?? dictionaries[l][c.label];
  const enabled = (c: Command) => !c.enabled || c.enabled(editor);
  const chords = (c: Command) => keymap.keysFor(c.id);

  // Display order: grouped commands (registry order) when the query is empty; otherwise ranked commands, then the catalogue
  // (effects, transitions, looks), then the project's media. Typing on the other keyboard layout is rescued (palette.search.ts).
  const searching = !!normalize(query);
  const cmdRank = useMemo(() => rankWithRescue(query, SEARCH_ITEMS), [query]);
  const ranked = useMemo(() => cmdRank.ids.map((id) => byId.get(id)!), [cmdRank]);
  const rescued = cmdRank.rescued;
  const needle = rescued ?? query;
  const catRows = useMemo(() => (searching ? rankCommands(needle, CAT_SEARCH).map((k) => catById.get(k)!) : []), [needle, searching]);
  const doc = state.doc;
  const mediaRows = useMemo(() => {
    if (!searching || !doc) return [];
    const items = Object.values(doc.assets).filter((a) => a.kind !== 'lut').map((a) => ({ id: a.id, he: a.name, en: a.name }));
    return rankCommands(needle, items).map((id) => doc.assets[id]!);
  }, [needle, searching, doc]);
  const showCmd = scope === 'all' || scope === 'commands';
  const showCat = searching && (scope === 'all' || scope === 'catalogue');
  const showMedia = searching && (scope === 'all' || scope === 'media');
  const cmdShown = !showCmd ? [] : scope === 'all' && searching ? ranked.slice(0, 8) : ranked;
  const catShown = !showCat ? [] : scope === 'all' ? catRows.slice(0, 6) : catRows.slice(0, 40);
  const mediaShown = !showMedia ? [] : scope === 'all' ? mediaRows.slice(0, 4) : mediaRows;
  const groups = useMemo(
    () => (searching ? [{ group: null as Command['group'] | null, items: cmdShown }] : GROUP_ORDER.map((g) => ({ group: g as Command['group'] | null, items: cmdShown.filter((c) => c.group === g) }))).filter((g) => g.items.length),
    [searching, cmdShown],
  );
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const clip = editor.selected?.clip;
  // One cursor over every selectable row: commands, catalogue entries, media. The assistant row is shown but cannot be chosen.
  const barKeys = scope === 'assistant' ? [] : bar.keys;
  const keys = useMemo(() => [...barKeys, ...flat.map((c) => c.id), ...catShown.map((c) => c.key), ...mediaShown.map((a) => `media:${a.id}`)], [barKeys, flat, catShown, mediaShown]);
  const active = flat.find((c) => c.id === activeId) ?? (activeId ? undefined : flat[0]);
  // Enter's default: the bar's answer (plan §6), unless the text is exactly a command's name and the bar has nothing to run for it (palette.enter.ts).
  const exactId = useMemo(() => exactCommandId(query, SEARCH_ITEMS) ?? exactCommandId(rescued, SEARCH_ITEMS), [query, rescued]);
  const barRuns = barKeys.length > 0 && !bar.pending && bar.view.query === query && !!bar.view.entries[0]?.target;
  const activeKey = activeId && keys.includes(activeId) ? activeId : defaultActiveKey({ keys, barRuns, exactId });
  const counts = { catalogue: catRows.length, media: mediaRows.length };
  const optionDomId = (id: string) => `pf-palette-opt-${id.replace(/[^A-Za-z0-9_-]/g, '-')}`;

  useEffect(() => {
    if (activeKey) document.getElementById(optionDomId(activeKey))?.scrollIntoView?.({ block: 'nearest' });
  }, [activeKey]);

  const run = (c: Command | undefined) => {
    if (!c || !enabled(c)) return;
    close();
    // Let the dialog unmount and focus return first, so commands that need focus elsewhere work.
    setTimeout(() => void c.run(editor), 0);
  };
  const runKey = (key: string | null) => {
    if (!key) return;
    if (barKeys.includes(key)) { bar.activate(key); return; }
    if (key.startsWith('media:')) { close(); const id = key.slice(6); setTimeout(() => void editor.addAsset(id), 0); return; }
    const cat = catById.get(key);
    if (cat) {
      if (!clip) return;
      const call = pickCall(clip, { kind: cat.kind, id: cat.id });
      close();
      if (call) setTimeout(() => void editor.commit([call], `Palette: ${cat.id}`), 0);
      return;
    }
    run(byId.get(key));
  };
  const move = (to: number) => keys.length && setActiveId(keys[(to + keys.length) % keys.length]!);

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const i = activeKey ? keys.indexOf(activeKey) : 0;
    if (e.key === 'ArrowDown') { e.preventDefault(); move(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(keys.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); runKey(activeKey); }
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
    <div className="pf-pal-backdrop pf-ds" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={dialogRef} className="pf-pal-dialog" style={anchor ? { position: 'fixed', top: anchor.top, left: anchor.left, width: anchor.width } : undefined} role="dialog" aria-modal="true" aria-label={t('cmd.palette')} data-testid="palette-dialog" onKeyDown={onDialogKey}>
        {view === 'palette' ? (
          <>
            <div className="pf-pal-top">
              <Search size={18} strokeWidth={1.75} aria-hidden="true" />
              <input
                ref={inputRef}
                className="pf-pal-input"
                data-testid="palette-input"
                role="combobox"
                aria-expanded="true"
                aria-autocomplete="list"
                aria-controls={listId}
                aria-activedescendant={activeKey ? optionDomId(activeKey) : undefined}
                aria-describedby={scope !== 'assistant' && bar.describedBy ? bar.describedBy : undefined}
                aria-label={t('cmd.palette')}
                placeholder={C.cmdPlaceholder}
                value={query}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => { setQuery(e.target.value); setActiveId(null); }}
                onKeyDown={onInputKey}
              />
              <kbd className="pf-pal-esc" dir="ltr">Esc</kbd>
            </div>
            <div className="pf-pal-scopes" role="group" aria-label={C.palScopes}>
              {([['all', C.scopeAll, null], ['commands', C.scopeCommands, null], ['catalogue', C.scopeCatalogue, searching ? counts.catalogue : null], ['media', C.scopeMedia, searching ? counts.media : null], ['assistant', C.scopeAssistant, null]] as [Scope, string, number | null][]).map(([id, label, n]) => (
                <button key={id} type="button" className="pf-pal-scope" aria-pressed={scope === id} data-testid={`palette-scope-${id}`} onClick={() => { setScope(id); setActiveId(null); inputRef.current?.focus(); }}>{label}{n != null && <span className="pf-pal-n num">{n}</span>}</button>
              ))}
            </div>
            {rescued && <p className="pf-pal-note" role="status" data-testid="palette-rescued">{C.palRescued(rescued)}</p>}
            <div id={listId} className="pf-pal-list" role="listbox" aria-label={t('cmd.palette')}>
              {scope !== 'assistant' && <BarSection slot={bar} query={query} activeKey={activeKey} onHover={(k) => k !== activeKey && setActiveId(k)} optionDomId={optionDomId} />}
              {scope !== 'assistant' && groups.map((g) => (
                <div key={g.group ?? 'results'} role="group" aria-label={g.group ? t(`group.${g.group}` as Key) : scope === 'all' ? C.scopeCommands : undefined}>
                  {(g.group || (searching && scope === 'all')) && <div className="pf-pal-heading" aria-hidden="true">{g.group ? t(`group.${g.group}` as Key) : C.scopeCommands}</div>}
                  {g.items.map((c) => {
                    const ok = enabled(c);
                    return (
                      <div
                        key={c.id}
                        id={optionDomId(c.id)}
                        role="option"
                        data-testid="palette-option"
                        data-command-id={c.id}
                        aria-selected={c.id === activeKey}
                        aria-disabled={ok ? undefined : 'true'}
                        className="pf-pal-option"
                        data-active={c.id === activeKey || undefined}
                        onMouseMove={() => c.id !== activeKey && setActiveId(c.id)}
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
              {scope !== 'assistant' && catShown.length > 0 && (
                <div role="group" aria-label={C.palCatalogue}>
                  <div className="pf-pal-heading" aria-hidden="true">{C.palCatalogue}{!clip && <span className="pf-pal-unavail"> · {C.palSelectClip}</span>}</div>
                  {catShown.map((c) => (
                    <div key={c.key} id={optionDomId(c.key)} role="option" data-testid="palette-catalogue" data-kind={c.kind} data-id={c.id} aria-selected={c.key === activeKey} aria-disabled={clip ? undefined : 'true'} className="pf-pal-option"
                      data-active={c.key === activeKey || undefined} onMouseMove={() => c.key !== activeKey && setActiveId(c.key)} onClick={() => runKey(c.key)}>
                      <span className="pf-pal-names">
                        <Sparkles size={14} strokeWidth={1.75} aria-hidden="true" className="pf-pal-ic" />
                        <span className="pf-pal-label" lang={lang}>{c[lang]}</span>
                        {c[other] !== c[lang] && <span className="pf-pal-alt" lang={other}>{c[other]}</span>}
                      </span>
                      <span className="pf-pal-kind">{c.kind === 'effect' ? C.palEffect : c.kind === 'transition' ? C.palTransition : C.palLook}</span>
                    </div>
                  ))}
                </div>
              )}
              {scope !== 'assistant' && mediaShown.length > 0 && (
                <div role="group" aria-label={C.palMedia}>
                  <div className="pf-pal-heading" aria-hidden="true">{C.palMedia}</div>
                  {mediaShown.map((a) => (
                    <div key={a.id} id={optionDomId(`media:${a.id}`)} role="option" data-testid="palette-media" data-asset-id={a.id} aria-selected={`media:${a.id}` === activeKey} className="pf-pal-option"
                      data-active={`media:${a.id}` === activeKey || undefined} onMouseMove={() => setActiveId(`media:${a.id}`)} onClick={() => runKey(`media:${a.id}`)}>
                      <span className="pf-pal-names"><Film size={14} strokeWidth={1.75} aria-hidden="true" className="pf-pal-ic" /><span className="pf-pal-label" dir="auto">{a.name}</span></span>
                      <span className="pf-pal-kind">{C.palAddMedia}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Outside the listbox (it owns only options and groups): the empty line, and the assistant, which is not an option
                (the arrows never reach it) and holds real buttons — «איך מחברים», send, accept and reject (ADR-0027). */}
            {scope !== 'assistant' && keys.length === 0 && <div className="pf-pal-empty pf-pal-extra" role="status">{searching ? C.palEmpty : t('palette.empty')}</div>}
            {(scope === 'all' || scope === 'assistant') && searching && (
              <div className="pf-pal-extra" role="group" aria-label={C.scopeAssistant}>
                <AssistantRow query={query} lang={lang} optionDomId={optionDomId} />
              </div>
            )}
            {scope === 'assistant' && <p className="pf-pal-note is-block pf-pal-extra" role="status" data-testid="palette-assistant-note">{C.palAssistantOff}</p>}
            {/* the bar's live region and preview: outside the listbox, which owns only options and groups (ADR-0027) */}
            <BarPanel slot={bar} query={query} activeKey={activeKey} off={scope === 'assistant'} />
            <div className="pf-pal-footer">
              <span className="pf-pal-hints" aria-hidden="true"><span><kbd>↑↓</kbd> {C.palFooter.nav}</span><span><kbd>Enter</kbd> {C.palFooter.apply}</span><span><kbd>Esc</kbd> {C.palFooter.close}</span></span>
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
            <p className="muted pf-pal-mouse" data-testid="shortcuts-mouse">{t('shortcuts.mouse')}</p>
            <div className="pf-pal-footer">
              <span className="pf-pal-status" role="status" data-testid="shortcut-status">
                {displaced && displaced.length > 0 && `${t('shortcuts.displaced')}: ${displaced.map((id) => (byId.get(id) ? label(byId.get(id)!) : id)).join(', ')}`}
              </span>
              <button type="button" className="pf-pal-btn" onClick={() => { keymap.reset(); setDisplaced(null); setCapturing(null); setTick((n) => n + 1); }}>{t('shortcuts.reset')}</button>
              <button type="button" className="pf-pal-btn" onClick={close}>{t('close')}</button>
            </div>
          </>
        )}
        {/* the toast region while this modal is open: a toast under the page behind could be neither reached nor heard (ds/toastHost.ts) */}
        <ToastSlot />
      </div>
    </div>
  );
}
