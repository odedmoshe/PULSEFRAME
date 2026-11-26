/** Settings (rail, bottom) and the status centre (status-bar pips): language, theme, and what still needs setting up, said plainly. */
import { useState } from 'react';
import { Dialog, Seg } from '../ds/index.ts';
import { CHROME_STRINGS } from './chrome.strings.ts';
import { setSettingsOpen, useChrome } from './chromeState.ts';
import { useEditorState } from './store.ts';
import { RenderCacheStorage } from './RenderCacheStorage.tsx';
import { AssistantSettings } from './commandBar/AssistantSettings.tsx';
import { LibrarySettings } from './library/LibrarySettings.tsx';
import { UNDERSTAND_UI_BUILT, UnderstandSettings } from './understand/ShotNotes.tsx';
import { ConnectionsSection, SOURCES_UI_BUILT } from './sources/SourcesTab.tsx';

const THEME_KEY = 'pf.theme';
export const readTheme = (): 'dark' | 'light' => { try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } };
/** Applies the saved theme at start-up (dark by default, whatever the OS says). */
export function applyTheme(theme: 'dark' | 'light') {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* not remembered in a private window */ }
}

type Rows = { id: string; name: string; word: string; tone: 'ok' | 'need' | 'off'; why?: string }[];
/** What still needs setting up, in the owner's words: the server's own reason text (variable names, paths) is never shown. */
export function capRows(gpu: { available: boolean } | null | undefined, provider: { provider: { configured: boolean } } | null | undefined, S: Pick<typeof CHROME_STRINGS.he, 'gpu' | 'ai' | 'assistant' | 'assistantOff' | 'capReady' | 'capSetup' | 'gpuWhy' | 'aiWhy'>): Rows {
  return [
    { id: 'gpu', name: S.gpu, word: gpu ? (gpu.available ? S.capReady : S.capSetup) : '…', tone: gpu ? (gpu.available ? 'ok' : 'need') : 'off', why: gpu && !gpu.available ? S.gpuWhy : undefined },
    { id: 'ai', name: S.ai, word: provider ? (provider.provider.configured ? S.capReady : S.capSetup) : '…', tone: provider ? (provider.provider.configured ? 'ok' : 'need') : 'off', why: provider && !provider.provider.configured ? S.aiWhy : undefined },
    { id: 'assistant', name: S.assistant, word: S.assistantOff, tone: 'off' },
  ];
}

export function SettingsDialog() {
  const { editor, state } = useEditorState();
  const { settingsOpen } = useChrome();
  const S = CHROME_STRINGS[state.lang];
  const [theme, setTheme] = useState<'dark' | 'light'>(readTheme);
  const rows = capRows(state.gpu, state.provider, S);
  return (
    <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} title={S.settingsTitle} closeLabel={S.settingsClose} size="md" testId="settings-dialog">
      <div className="pf-set">
        <div className="pf-set-row"><span>{S.interfaceLang}</span>
          <Seg size="sm" label={S.interfaceLang} value={state.lang} onChange={(v) => editor.setLang(v)} options={[{ value: 'he', label: 'עברית' }, { value: 'en', label: 'English' }]} /></div>
        <div className="pf-set-row"><span>{S.theme}</span>
          <Seg size="sm" label={S.theme} value={theme} onChange={(v) => { setTheme(v); applyTheme(v); }} options={[{ value: 'dark', label: S.themeDark }, { value: 'light', label: S.themeLight }]} /></div>
        {/* the picture while playing (pictureSize.ts): a choice of this browser, not of the project */}
        <div className="pf-set-row" data-testid="settings-play-sharpness"><span>{S.playSharpness}<small className="pf-set-note" id="pf-set-play-sharpness-why">{S.playSharpnessWhy}</small></span>
          <Seg size="sm" label={S.playSharpness} describedBy="pf-set-play-sharpness-why" value={state.playSharpness} onChange={(v) => editor.setPlaySharpness(v)} options={[{ value: 'smooth', label: S.playSmooth, testId: 'play-sharpness-smooth' }, { value: 'sharper', label: S.playSharper, testId: 'play-sharpness-sharper' }]} /></div>
        <h3 className="pf-set-h">{S.capabilities}</h3>
        <ul className="pf-set-caps">
          {rows.map((r) => (
            <li key={r.id} data-tone={r.tone}><span className="pf-set-dot" aria-hidden="true" /><span className="pf-set-name">{r.name}</span><span className="pf-set-word">{r.word}</span>{r.why && <span className="pf-set-why" dir="auto">{r.why}</span>}</li>
          ))}
        </ul>
        {/* the render cache of the fast export (ADR-0024): its size and «ניקוי» (the owner's own session) */}
        {settingsOpen && <RenderCacheStorage />}
        {/* the command bar's language assistant (ADR-0027): the owner's own session only (AssistantSettings decides) */}
        {settingsOpen && <AssistantSettings />}
        {/* the owner's content library folder (wave 7 library track; LibrarySettings decides what each session sees) */}
        {settingsOpen && <LibrarySettings />}
        {/* «חיבורים» (wave 8 sources, C1): the outside services' keys and the download limit; mounted only once built */}
        {settingsOpen && SOURCES_UI_BUILT && <ConnectionsSection />}
        {/* «מה יש בקליפ» (wave 8 understand): auto, stretch length, the describing model; mounted only once built (W3) */}
        {settingsOpen && UNDERSTAND_UI_BUILT && <UnderstandSettings />}
      </div>
    </Dialog>
  );
}
