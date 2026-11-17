/**
 * The browser drawer (docs/design/UX_REDESIGN.md §4.4): its content follows the rail's category. Media gets a header with the
 * one primary action (import), a search box, filter chips with counts and 16:9 cards (MediaLibrary.tsx); the empty state is a
 * drop zone. Audio, Elements, Templates and AI tools mount the components that already existed. Effects, transitions and
 * looks list the catalogue and apply it to the selected clip through the same registered ops the gallery uses.
 * `.library` stays the class the grid and the proofs find the drawer by.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowUpFromLine, Captions as CaptionsIcon, ImagePlus, Plus, Search, Sparkles, Type } from 'lucide-react';
import { COLOR_LOOKS, EFFECTS, TRANSITIONS, type Clip } from '@pulseframe/core';
import { Button, Chip } from '../ds/index.ts';
import { AiTools } from './AiTools.tsx';
import { CHROME_STRINGS } from './chrome.strings.ts';
import { useChrome, type RailCategory } from './chromeState.ts';
import { ElementsBrowser } from './ElementsBrowser.tsx';
import { pickCall, type PickKind } from './gallery.pick.ts';
import { filterAssets, MediaGrid, type MediaFilter } from './MediaLibrary.tsx';
import { SfxBrowser } from './SfxBrowser.tsx';
import { SourceViewer } from './SourceViewer.tsx';
import { useEditorState } from './store.ts';
import { TemplatesDrawer } from './TemplatesDrawer.tsx';
import '../ds/chrome.css';

const ACCEPT = 'video/*,audio/*,image/png,image/jpeg,image/webp,.cube';

export function Library() {
  const { editor, state, t } = useEditorState();
  const { rail } = useChrome();
  const { doc, uploading } = state;
  const S = CHROME_STRINGS[state.lang];
  const [viewing, setViewing] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');
  return (
    <aside className="library pf-ds pf-browser" id="pf-browser" aria-label={S.rail[rail]} data-testid="library" data-category={rail}
      onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
      onDrop={(e) => { setOver(false); const fs = [...(e.dataTransfer.files ?? [])]; if (!fs.length) return; e.preventDefault(); if (!uploading && doc) void editor.importFiles(fs); }}>
      {over && <div className="pf-drop-veil" aria-hidden="true"><ImagePlus size={28} />{S.dropTitle}</div>}
      {viewing && doc?.assets[viewing] && <SourceViewer assetId={viewing} onClose={() => { const id = viewing; setViewing(null); setTimeout(() => document.querySelector<HTMLElement>(`[data-testid="view-${id}"]`)?.focus(), 0); }} />}
      {rail === 'media' && <MediaDrawer onView={setViewing} />}
      {rail === 'audio' && <AudioDrawer onView={setViewing} />}
      {rail === 'text' && (
        <Pane title={S.textTitle}>
          <p className="pf-bw-lead">{S.textLead}</p>
          <Button variant="primary" size="md" icon={<Type size={16} aria-hidden="true" />} disabled={!doc} onClick={() => void editor.addText()} data-testid="add-text">{t('text.add')}</Button>
        </Pane>
      )}
      {rail === 'captions' && (
        <Pane title={S.captionsTitle}>
          <p className="pf-bw-lead">{S.captionsLead}</p>
          <Button variant="secondary" size="md" icon={<CaptionsIcon size={16} aria-hidden="true" />} onClick={() => editor.setWorkspace('captions')} data-testid="open-captions-mode">{S.captionsOpen}</Button>
        </Pane>
      )}
      {(rail === 'effects' || rail === 'transitions' || rail === 'looks') && <CatalogueDrawer kind={rail} />}
      {rail === 'elements' && <div className="pf-bw-legacy"><ElementsBrowser /></div>}
      {rail === 'templates' && <div className="pf-bw-legacy"><TemplatesDrawer /></div>}
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

function ImportButton() {
  const { editor, state, t } = useEditorState();
  const S = CHROME_STRINGS[state.lang];
  const { doc, uploading } = state;
  return (
    <label className={`pf-btn pf-btn-primary pf-btn-sm pf-bw-import${uploading || !doc ? ' is-disabled' : ''}`}>
      <ArrowUpFromLine size={16} strokeWidth={1.75} aria-hidden="true" /><span className="pf-btn-label">{uploading ? t('media.uploading') : S.import}</span>
      <input type="file" multiple accept={ACCEPT} disabled={uploading || !doc} data-testid="file-input" onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) void editor.importFiles(fs); }} />
    </label>
  );
}

function MediaDrawer({ onView }: { onView: (id: string) => void }) {
  const { state } = useEditorState();
  const S = CHROME_STRINGS[state.lang];
  const { doc } = state;
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<MediaFilter>('all');
  const n = (f: MediaFilter) => (doc ? filterAssets(doc, '', f).length : 0);
  const total = doc ? Object.keys(doc.assets).length : 0;
  const chips: [MediaFilter, string][] = [['all', S.filterAll], ['video', S.filterVideo], ['audio', S.filterAudio], ['image', S.filterImage], ['unused', S.filterUnused]];
  return (
    <Pane title={S.rail.media} count={total || undefined} action={<ImportButton />}>
      {total === 0 ? <DropZone /> : (
        <>
          <label className="pf-bw-search">
            <Search size={16} strokeWidth={1.75} aria-hidden="true" />
            <input type="search" dir="auto" value={q} onChange={(e) => setQ(e.target.value)} placeholder={S.searchMedia} aria-label={S.searchPlaceholder} data-testid="media-search" />
          </label>
          <div className="pf-bw-chips" role="group" aria-label={S.filters}>
            {chips.filter(([f]) => f === 'all' || n(f) > 0).map(([f, label]) => <Chip key={f} pressed={filter === f} count={n(f)} onClick={() => setFilter(f)} data-testid={`media-filter-${f}`}>{label}</Chip>)}
          </div>
          <div className="pf-bw-scroll"><MediaGrid onView={onView} query={q} filter={filter} /></div>
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
      <Button variant="secondary" size="md" disabled={!state.doc || state.uploading} onClick={() => input.current?.click()}>{state.uploading ? S.importing : S.dropPick}</Button>
      <input ref={input} type="file" multiple accept={ACCEPT} hidden tabIndex={-1} aria-hidden="true" onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) void editor.importFiles(fs); }} />
    </div>
  );
}

function AudioDrawer({ onView }: { onView: (id: string) => void }) {
  const { state } = useEditorState();
  const S = CHROME_STRINGS[state.lang];
  const hasAudio = !!state.doc && filterAssets(state.doc, '', 'audio').length > 0;
  return (
    <div className="pf-bw-audio">
      {hasAudio && <Pane title={S.rail.audio}><div className="pf-bw-scroll"><MediaGrid onView={onView} filter="audio" /></div></Pane>}
      <SfxBrowser />
    </div>
  );
}

const CATALOGUE: Record<'effects' | 'transitions' | 'looks', { kind: PickKind; items: () => { id: string; name: { he: string; en: string } }[] }> = {
  effects: { kind: 'effect', items: () => EFFECTS.map((e) => ({ id: e.id, name: e.name })) },
  transitions: { kind: 'transition', items: () => TRANSITIONS.map((x) => ({ id: x.id, name: x.name })) },
  looks: { kind: 'look', items: () => COLOR_LOOKS.map((l) => ({ id: l.id, name: l.name })) },
};

/** Effects, transitions and looks: the catalogue by name, applied to the selected clip as one registered op. The full gallery (previews on the frame) opens from its own button. */
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
  const gallery = () => document.querySelector<HTMLElement>('[data-testid=gallery-open]')?.click();
  return (
    <Pane title={title} count={all.length} action={<Button size="sm" variant="secondary" icon={<Sparkles size={16} aria-hidden="true" />} disabledReason={clip ? undefined : S.catNeedGallery} onClick={gallery} data-testid="catalogue-open-gallery">{S.catOpen}</Button>}>
      <label className="pf-bw-search">
        <Search size={16} strokeWidth={1.75} aria-hidden="true" />
        <input type="search" dir="auto" value={q} onChange={(e) => setQ(e.target.value)} placeholder={S.searchPlaceholder} aria-label={S.searchPlaceholder} data-testid="catalogue-search" />
      </label>
      {!clip && <p className="pf-bw-lead" role="status">{S.catNeedGallery}</p>}
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
