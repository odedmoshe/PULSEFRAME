/**
 * The browser drawer (docs/design/UX_REDESIGN.md §4.4): its content follows the rail's category. Media gets a header with the
 * one primary action (import), a search box, filter chips with counts and 16:9 cards (MediaLibrary.tsx); the empty state is a
 * drop zone. Audio, Elements, Templates and AI tools mount the components that already existed. Effects, transitions and
 * looks list the catalogue and apply it to the selected clip through the same registered ops the gallery uses.
 * `.library` stays the class the grid and the proofs find the drawer by.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowUpFromLine, Captions as CaptionsIcon, ImagePlus, Plus, Search, Sparkles, Type } from 'lucide-react';
import { COLOR_LOOKS, PICKABLE_EFFECTS, TRANSITIONS, type Clip } from '@pulseframe/core';
import { Button, Chip, Tabs } from '../ds/index.ts';
import { AiTools } from './AiTools.tsx';
import { CHROME_STRINGS } from './chrome.strings.ts';
import { useChrome, type RailCategory } from './chromeState.ts';
import { LibraryElementsDrawer } from './library/LibraryElementsDrawer.tsx';
import { LibraryAudioTab, LIBRARY_UI_BUILT } from './library/LibraryAudioTab.tsx';
import { LIBRARY_TESTIDS } from './library/library.testids.ts';
import { LIBRARY_UI_STRINGS } from './library/library.strings.ts';
import { pickCall, type PickKind } from './gallery.pick.ts';
import { filterAssets, MediaGrid, type MediaFilter } from './MediaLibrary.tsx';
import { SfxBrowser } from './SfxBrowser.tsx';
import { SourceViewer } from './SourceViewer.tsx';
import { useEditorState } from './store.ts';
import { TemplatesDrawer } from './TemplatesDrawer.tsx';
import { TextStyles } from './TextStyles.tsx';
import { TripMapEntry, TRIPMAP_UI_BUILT } from './tripMap/TripMapDialog.tsx';
import { MadeEntry, MADE_UI_BUILT } from './made/MadeEntry.tsx';
import { LifeHost, LifeLibrary, LifeViewSwitch } from './lifeline/LifeLibrary.tsx';
import { FontsSection, MusicTab, PacksSection } from './lifeline/PacksMount.tsx';
import { PACKS_MOUNT_STRINGS } from './lifeline/packs.mount.strings.ts';
import { setLifeView, useLifeUi } from './lifeline/lifeUi.ts';
import { MUSIC_TESTIDS } from './packs.testids.ts';
import { FootageResults } from './search/FootageResults.tsx';
import { ImportCards } from './ImportCards.tsx';
import { DropChip, ImportMenu } from './ImportHosts.tsx';
import { collectDropped } from './imports.logic.ts';
import { MulticamLibraryEntry } from './MulticamLibraryEntry.tsx';
import '../ds/chrome.css';
import { PEARLS_UI_BUILT, PearlsList } from './pearls/PearlsList.tsx'; // «פנינים» (wave 7): the fourth view, once builder C has built it
import { focusNow } from '../ds/focus.ts';

const ACCEPT = 'video/*,audio/*,image/png,image/jpeg,image/webp,.cube';

export function Library() {
  const { editor, state, t } = useEditorState();
  const { rail } = useChrome();
  const { doc, uploading } = state;
  const S = CHROME_STRINGS[state.lang];
  const [viewing, setViewing] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  // the Templates drawer is collapsible on its own; in the drawer it is always open
  useEffect(() => { if (rail === 'templates' && !state.templatesOpen) editor.set({ templatesOpen: true }); }, [rail, state.templatesOpen, editor]);
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');
  return (
    <aside className="library pf-ds pf-browser" id="pf-browser" aria-label={S.rail[rail]} data-testid="library" data-category={rail}
      onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
      onDrop={(e) => {
        setOver(false);
        if (!e.dataTransfer.files?.length || !doc) return;
        e.preventDefault();
        // A dropped folder is walked (webkitGetAsEntry, taken before the first await); plain files go to the queue as they are.
        void collectDropped(e.dataTransfer.items).then((entries) => {
          if (entries.some((x) => x.relativePath.includes('/'))) editor.importFolder(entries);
          else void editor.importFiles(entries.map((x) => x.file));
        });
      }}>
      {over && <div className="pf-drop-veil" aria-hidden="true"><ImagePlus size={28} />{S.dropTitle}</div>}
      {viewing && doc?.assets[viewing] && <SourceViewer assetId={viewing} onClose={() => { focusNow(document.querySelector<HTMLElement>(`[data-testid="view-${viewing}"]`) ?? document.querySelector<HTMLElement>(`[data-testid="more-${viewing}"]`)); setViewing(null); }} />}
      <LifeHost />
      {rail === 'media' && <MediaDrawer onView={setViewing} />}
      {rail === 'audio' && <AudioDrawer onView={setViewing} />}
      {rail === 'text' && (
        <Pane title={S.textTitle}>
          <p className="pf-bw-lead">{S.textLead}</p>
          <Button variant="primary" size="md" icon={<Type size={16} aria-hidden="true" />} disabled={!doc} onClick={() => void editor.addText()} data-testid="add-text">{t('text.add')}</Button>
          {/* «מפת טיול חדשה» (wave 8 tripmap): mounted only once the map is built, so no dead button is shown */}
          {TRIPMAP_UI_BUILT && <TripMapEntry />}
          {MADE_UI_BUILT && <MadeEntry />}
          {/* the text styles as tiles: they apply to the selected title (apply_text_preset) and say so while none is selected */}
          <div className="pf-bw-scroll"><TextStyles testId="text-preset-drawer" /><FontsSection /></div>
        </Pane>
      )}
      {rail === 'captions' && (
        <Pane title={S.captionsTitle}>
          <p className="pf-bw-lead">{S.captionsLead}</p>
          <Button variant="secondary" size="md" icon={<CaptionsIcon size={16} aria-hidden="true" />} onClick={() => editor.setWorkspace('captions')} data-testid="open-captions-mode">{S.captionsOpen}</Button>
        </Pane>
      )}
      {(rail === 'effects' || rail === 'transitions' || rail === 'looks') && <CatalogueDrawer kind={rail} />}
      {rail === 'elements' && <div className="pf-bw-legacy"><LibraryElementsDrawer /></div>}
      {rail === 'templates' && <div className="pf-bw-legacy"><PacksSection /><TemplatesDrawer /></div>}
      {rail === 'ai' && <div className="pf-bw-legacy"><AiTools /></div>}
    </aside>
  );
}

function Pane({ title, count, action, children }: { title: string; count?: number | string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="pf-bw-pane">
      <header className="pf-bw-head"><h2 className="pf-bw-title">{title}{count != null && <span className="pf-bw-count num">{count}</span>}</h2>{action}</header>
      {children}
    </section>
  );
}

/**
 * The drawer's primary action «ייבוא» (file-input) and its menu of other ways in (a folder, the phone; ImportHosts.tsx). Uploads
 * go to the import queue one after another: `uploading` changes the label only and never disables the picker (ADR-0023).
 */
function ImportButton() {
  const { editor, state, t } = useEditorState();
  const S = CHROME_STRINGS[state.lang];
  const { doc, uploading } = state;
  return (
    <span className="pf-bw-import-group">
      <DropChip />
      <label className={`pf-btn pf-btn-primary pf-btn-sm pf-bw-import${!doc ? ' is-disabled' : ''}`} aria-busy={uploading || undefined}>
        <ArrowUpFromLine size={16} strokeWidth={1.75} aria-hidden="true" /><span className="pf-btn-label">{uploading ? t('media.uploading') : S.import}</span>
        <input type="file" multiple accept={ACCEPT} disabled={!doc} data-testid="file-input" onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) void editor.importFiles(fs); }} />
      </label>
      <ImportMenu />
    </span>
  );
}
/** The import cards (ADR-0023): their own list above the grid, outside `ul.assets` (proofs wait on `.assets li` for a real asset). */
function Imports() {
  const { editor, state } = useEditorState();
  return <ImportCards lang={state.lang} state={state.imports} onRetry={(id) => void editor.imports.retry(id).catch(editor.fail)} onCancel={(id) => void editor.imports.cancel(id).catch(editor.fail)} onDismiss={(id) => void editor.imports.dismiss(id).catch(editor.fail)} onCancelLocal={(id) => editor.imports.cancelLocal(id)} />;
}

function MediaDrawer({ onView }: { onView: (id: string) => void }) {
  const { state } = useEditorState();
  const S = CHROME_STRINGS[state.lang];
  const { doc } = state;
  const [q, setQ] = useState('');
  const searchBox = useRef<HTMLInputElement>(null); // the footage results hear Enter and ArrowDown on this box and give focus back to it
  const [filter, setFilter] = useState<MediaFilter>('all');
  const n = (f: MediaFilter) => (doc ? filterAssets(doc, '', f).length : 0);
  const total = doc ? Object.keys(doc.assets).length : 0;
  const chips: [MediaFilter, string][] = [['all', S.filterAll], ['video', S.filterVideo], ['audio', S.filterAudio], ['image', S.filterImage], ['unused', S.filterUnused]];
  const { view } = useLifeUi(); // life line (ADR-0021): the library by date and by event; the chips and the search belong to the plain view
  return (
    <Pane title={S.rail.media} count={total || undefined} action={<ImportButton />}>
      <Imports />
      {total === 0 ? <DropZone /> : (
        <>
          <label className="pf-bw-search">
            <Search size={16} strokeWidth={1.75} aria-hidden="true" />
            <input type="search" dir="auto" value={q} disabled={view !== 'all'} onChange={(e) => setQ(e.target.value)} placeholder={S.searchMedia} aria-label={S.searchPlaceholder} data-testid="media-search" ref={searchBox} />
          </label>
          {/* «חיפוש בצילומים» (wave 7 search track): moments under the box; renders nothing until built (search/FootageResults.tsx) */}
          {view === 'all' && q.trim() !== '' && <FootageResults query={q} onView={onView} box={searchBox} />}
          <div className="pf-bw-chips" role="group" aria-label={S.filters}>
            {chips.filter(([f]) => f === 'all' || n(f) > 0).map(([f, label]) => <Chip key={f} pressed={filter === f} count={n(f)} disabled={view !== 'all'} onClick={() => setFilter(f)} data-testid={`media-filter-${f}`}>{label}</Chip>)}
          </div>
          <LifeViewSwitch view={view} onChange={setLifeView} />
          <div className="pf-bw-scroll">{view === 'all' || (view === 'pearls' && !PEARLS_UI_BUILT) ? <MediaGrid onView={onView} query={q} filter={filter} /> : view === 'pearls' ? <PearlsList onView={onView} /> : <LifeLibrary view={view} onView={onView} />}</div>
          <MulticamLibraryEntry lang={state.lang} />
        </>
      )}
    </Pane>
  );
}

/** The empty state: a dashed drop zone with the button behind it. The same input as the header's would duplicate the test id, so this one is a plain button that opens the header's input. */
function DropZone() {
  const { editor, state } = useEditorState();
  const S = CHROME_STRINGS[state.lang];
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="pf-bw-drop" data-testid="media-empty">
      <ImagePlus size={30} strokeWidth={1.5} aria-hidden="true" />
      <p>{S.dropTitle}</p>
      <Button variant="secondary" size="md" disabled={!state.doc} onClick={() => input.current?.click()}>{state.uploading ? S.importing : S.dropPick}</Button>
      <input ref={input} type="file" multiple accept={ACCEPT} hidden tabIndex={-1} aria-hidden="true" onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) void editor.importFiles(fs); }} />
    </div>
  );
}

function AudioDrawer({ onView }: { onView: (id: string) => void }) {
  const { state } = useEditorState();
  const S = CHROME_STRINGS[state.lang];
  const M = PACKS_MOUNT_STRINGS[state.lang];
  const hasAudio = !!state.doc && filterAssets(state.doc, '', 'audio').length > 0;
  const L = LIBRARY_UI_STRINGS[state.lang];
  // per visit; the built-in music is the drawer's second tab (ADR-0022), the owner's library its third (wave 7, once built)
  const [tab, setTab] = useState<'effects' | 'music' | 'library'>('effects');
  return (
    <div className="pf-bw-audio">
      {hasAudio && <Pane title={S.rail.audio}><div className="pf-bw-scroll"><MediaGrid onView={onView} filter="audio" /></div></Pane>}
      <Tabs label={M.audioTabs} value={tab} onChange={(id) => setTab(id === 'music' ? 'music' : id === 'library' && LIBRARY_UI_BUILT ? 'library' : 'effects')} panelPrefix="pf-audio-panel"
        tabs={[{ id: 'effects', label: M.tabEffects, testId: 'audio-tab-effects' }, { id: 'music', label: M.tabMusic, testId: MUSIC_TESTIDS.tab }, ...(LIBRARY_UI_BUILT ? [{ id: 'library', label: L.audioTab, testId: LIBRARY_TESTIDS.audioTab }] : [])]} />
      <div role="tabpanel" id={`pf-audio-panel-${tab}`} aria-labelledby={`pf-audio-panel-tab-${tab}`} tabIndex={0} data-testid={tab === 'music' ? MUSIC_TESTIDS.panel : tab === 'library' ? LIBRARY_TESTIDS.audioPanel : 'audio-panel-effects'}>
        {tab === 'music' ? <MusicTab /> : tab === 'library' ? <LibraryAudioTab /> : <SfxBrowser />}
      </div>
    </div>
  );
}

const CATALOGUE: Record<'effects' | 'transitions' | 'looks', { kind: PickKind; items: () => { id: string; name: { he: string; en: string } }[] }> = {
  effects: { kind: 'effect', items: () => PICKABLE_EFFECTS.map((e) => ({ id: e.id, name: e.name })) }, // a living picture: the Motion tab (opOnlyEffect)
  transitions: { kind: 'transition', items: () => TRANSITIONS.map((x) => ({ id: x.id, name: x.name })) },
  looks: { kind: 'look', items: () => COLOR_LOOKS.map((l) => ({ id: l.id, name: l.name })) },
};

/**
 * Effects, transitions and looks: the catalogue by name, applied to the selected clip as one registered op. The full gallery
 * (previews on the frame) opens from this drawer's button, which owns `gallery-open` while it is shown (editor.openGallery;
 * the inspector's button is then its alias, EffectGallery.tsx).
 */
function CatalogueDrawer({ kind }: { kind: 'effects' | 'transitions' | 'looks' }) {
  const { editor, state } = useEditorState();
  const S = CHROME_STRINGS[state.lang];
  const lang = state.lang;
  const [q, setQ] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  const spec = CATALOGUE[kind];
  const all = useMemo(() => spec.items(), [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const needle = q.trim().toLowerCase();
  const shown = all.filter((i) => !needle || i.name.he.toLowerCase().includes(needle) || i.name.en.toLowerCase().includes(needle));
  const clip: Clip | undefined = editor.selected?.clip;
  const apply = async (id: string, name: string) => {
    if (!clip) return;
    const call = pickCall(clip, { kind: spec.kind, id });
    if (!call) { setSaid(name); return; }
    await editor.commit([call], `Catalogue: ${id}`);
    setSaid(name);
  };
  const title = kind === 'effects' ? S.catEffectsTitle : kind === 'transitions' ? S.catTransitionsTitle : S.catLooksTitle;
  const gallery = () => editor.openGallery(kind);
  return (
    <Pane title={title} count={all.length} >
      <label className="pf-bw-search">
        <Search size={16} strokeWidth={1.75} aria-hidden="true" />
        <input type="search" dir="auto" value={q} onChange={(e) => setQ(e.target.value)} placeholder={S.searchPlaceholder} aria-label={S.searchPlaceholder} data-testid="catalogue-search" />
      </label>
      {clip ? <Button size="sm" variant="secondary" icon={<Sparkles size={16} aria-hidden="true" />} onClick={gallery} aria-haspopup="dialog" data-testid="gallery-open">{S.catOpen}</Button>
        : <p className="pf-bw-lead" role="status">{S.catNeedGallery}</p>}
      <ul className="pf-bw-list" aria-label={title}>
        {shown.map((i) => (
          <li key={i.id}>
            <button type="button" className="pf-bw-row" disabled={!clip} onClick={() => void apply(i.id, i.name[lang])} data-testid="catalogue-row" data-kind={spec.kind} data-id={i.id}>
              <span className="pf-bw-rowName" lang={lang}>{i.name[lang]}</span>
              <span className="pf-bw-rowAlt" lang={lang === 'he' ? 'en' : 'he'}>{i.name[lang === 'he' ? 'en' : 'he']}</span>
              <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {said && <p className="pf-bw-lead" role="status"><bdi>{said}</bdi></p>}
    </Pane>
  );
}
