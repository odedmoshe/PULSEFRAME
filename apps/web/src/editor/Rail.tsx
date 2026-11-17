/**
 * The rail (docs/design/UX_REDESIGN.md §4.3): 72 px at the start edge, full height. Categories, each an icon over a label:
 * assets (media, audio, text, captions), the catalogue (effects, transitions, looks, elements, templates), tools (AI), and
 * shortcuts and settings pinned at the bottom. The active category decides what the browser drawer shows (Library.tsx).
 * A vertical tablist with a roving tabindex; Alt+1…0 choose a category. The Effects, Transitions and Looks items open the
 * drawer whose button owns `gallery-open` (Library.tsx; the gallery opens through editor.openGallery).
 * Keep the root element and its data-shell-slot: the shell finds the mount by it.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Captions, Clapperboard, Keyboard, LayoutTemplate, Blend, Music, Contrast, Settings, Shapes, Sparkles, Type, WandSparkles } from 'lucide-react';
import { Tooltip } from '../ds/index.ts';
import { CHROME_STRINGS } from './chrome.strings.ts';
import { RAIL_CATEGORIES, setPaletteView, setRail, setSettingsOpen, useChrome, type RailCategory } from './chromeState.ts';
import { SettingsDialog, applyTheme, readTheme } from './SettingsDialog.tsx';
import { useEditorState } from './store.ts';
import '../ds/chrome.css';

const ICON: Record<RailCategory, ReactNode> = {
  media: <Clapperboard />, audio: <Music />, text: <Type />, captions: <Captions />, effects: <Sparkles />, transitions: <Blend />,
  looks: <Contrast />, elements: <Shapes />, templates: <LayoutTemplate />, ai: <WandSparkles />,
};
const GROUPS: RailCategory[][] = [['media', 'audio', 'text', 'captions'], ['effects', 'transitions', 'looks', 'elements', 'templates'], ['ai']];
const isTyping = (el: EventTarget | null) => { const e = el as HTMLElement | null; return !!e && (e.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName)); };

export function Rail() {
  const { editor, state } = useEditorState();
  const { rail } = useChrome();
  const S = CHROME_STRINGS[state.lang];
  const refs = useRef<Partial<Record<RailCategory, HTMLButtonElement | null>>>({});
  const aiBusy = !!state.capJob && ['queued', 'running'].includes(state.capJob.status);

  useEffect(() => { if (readTheme() === 'light') applyTheme('light'); }, []);
  // Alt+1…0 (0 = the tenth category), unless typing or a dialog is open.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || isTyping(e.target) || document.querySelector('[aria-modal="true"]')) return;
      const m = /^Digit([0-9])$/.exec(e.code);
      if (!m) return;
      const cat = RAIL_CATEGORIES[(Number(m[1]) + 9) % 10]!;
      e.preventDefault(); setRail(cat); refs.current[cat]?.focus();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  // The palette's "open templates" and the start hub raise a counter on the editor: show the Templates drawer.
  const seen = useRef(state.templatesFocus);
  useEffect(() => { if (state.templatesFocus !== seen.current) { seen.current = state.templatesFocus; setRail('templates'); } }, [state.templatesFocus]);

  const flat = GROUPS.flat();
  const onKey = (e: React.KeyboardEvent, cat: RailCategory) => {
    const i = flat.indexOf(cat);
    let to = -1;
    if (e.key === 'ArrowDown') to = (i + 1) % flat.length; else if (e.key === 'ArrowUp') to = (i - 1 + flat.length) % flat.length;
    else if (e.key === 'Home') to = 0; else if (e.key === 'End') to = flat.length - 1;
    if (to < 0) return;
    e.preventDefault(); setRail(flat[to]!); refs.current[flat[to]!]?.focus();
  };
  const digit = (c: RailCategory) => String((flat.indexOf(c) + 1) % 10);

  return (
    <nav className="pf-ds pf-rail" data-shell-slot="rail" aria-label={S.railLabel}>
      <div role="tablist" aria-orientation="vertical" aria-label={S.railLabel} className="pf-rail-list">
        {GROUPS.map((g, gi) => (
          <div key={gi} className="pf-rail-group" role="presentation">
            {g.map((c) => (
              <Tooltip key={c} label={S.rail[c]} keys={['Alt', digit(c)]}>
                <button ref={(el) => { refs.current[c] = el; }} type="button" role="tab" id={`pf-rail-${c}`} aria-selected={rail === c} aria-controls="pf-browser" tabIndex={rail === c ? 0 : -1}
                  className={`pf-rail-btn${rail === c ? ' is-on' : ''}`} data-testid={`rail-${c}`} aria-label={c === 'ai' && aiBusy ? `${S.rail[c]} · ${S.aiRunning}` : undefined}
                  onClick={() => setRail(c)} onKeyDown={(e) => onKey(e, c)}>
                  <span className="pf-rail-ic" aria-hidden="true">{ICON[c]}{c === 'ai' && aiBusy && <i className="pf-rail-dot" />}</span>
                  <span className="pf-rail-label">{S.rail[c]}</span>
                </button>
              </Tooltip>
            ))}
          </div>
        ))}
      </div>
      <div className="pf-rail-pinned">
        <Tooltip label={S.shortcuts} keys={['Ctrl', 'K']}>
          <button type="button" className="pf-rail-btn" data-testid="rail-shortcuts" aria-haspopup="dialog" onClick={() => { setPaletteView('shortcuts'); editor.set({ paletteOpen: true }); }}>
            <span className="pf-rail-ic" aria-hidden="true"><Keyboard /></span><span className="pf-rail-label">{S.shortcuts}</span>
          </button>
        </Tooltip>
        <button type="button" className="pf-rail-btn" data-testid="rail-settings" aria-haspopup="dialog" onClick={() => setSettingsOpen(true)}>
          <span className="pf-rail-ic" aria-hidden="true"><Settings /></span><span className="pf-rail-label">{S.settings}</span>
        </button>
      </div>
      <SettingsDialog />
    </nav>
  );
}
