/**
 * «מאגר» — the second tab of the media drawer (wave 8 sources, W3), against sourcesApi.ts, sources.testids.ts and the `sources.*`
 * strings. The link box on top; service chips with their state (roving tabindex; «צריך מפתח» opens Settings › «חיבורים»); kind
 * chips; the search box (dir="auto"; words are sent only on «חיפוש»/Enter, the hint says so); the remaining-searches line (C9); the
 * result grid (role listbox: arrows move, Space previews and never autoplays sound, Enter adds at the playhead on the target track,
 * Shift+Enter to the project only); licence badge named by the licence's own name; each licence warning quotes the licence's own
 * sentence; the provider's line under the results; download rows until the import card appears in ImportCards.
 * Nothing is called safe or allowed. No focus is moved in a later task (deferredFocus.test.ts).
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import type { SearchableSourceId, SourceKind, SourcePage, SourceResultRow, SourceState } from '@pulseframe/core';
import { SEARCHABLE_SOURCES, SOURCE_KINDS } from '@pulseframe/core';
import { Chip, Tabs, rovingNext, rovingTabStop, useDir } from '../../ds/index.ts';
import { sayFailure } from '../library/LibraryBrowser.tsx';
import { setSettingsOpen } from '../chromeState.ts';
import { useEditorState } from '../store.ts';
import { DownloadRow, LinkBox, WarningLine } from './SourceParts.tsx';
import { SOURCES_TESTIDS as TID } from './sources.testids.ts';
import { sourcesApi } from './sourcesApi.ts';
import { badgeTone, gridNext, licenceLabel, previewKindOf, providerName, remainingLine, sx, targetKindOf } from './sources.logic.ts';
import './sources.css';

export { ConnectionsSection } from './ConnectionsSection.tsx';
/** Flipped: Library.tsx and SettingsDialog.tsx mount the tab and the section. */
export const SOURCES_UI_BUILT = true;

type Dl = { jobId: string; title: string };

export function SourcesTab(): ReactElement {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const dir = useDir();
  const projectId = state.doc?.id ?? null;
  const [states, setStates] = useState<SourceState[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [provider, setProvider] = useState<SearchableSourceId>('openverse');
  const [kind, setKind] = useState<SourceKind | null>(null);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<SourceResultRow[]>([]);
  const [page, setPage] = useState<SourcePage | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<Dl[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    let live = true;
    sourcesApi.list().then((r) => { if (live) setStates(r.sources); }).catch((e) => { if (live) setListError(sayFailure(lang, e)); });
    return () => { live = false; abort.current?.abort(); };
  }, [lang]);

  const stateOf = (p: string): SourceState | undefined => states?.find((s) => s.provider === p);
  const needs = (s: SourceState | undefined): 'key' | 'contact' | null => (s?.state === 'needs_key' ? 'key' : s?.state === 'needs_contact' ? 'contact' : null);

  const search = async (more = false) => {
    const text = q.trim();
    if (!text) return;
    abort.current?.abort();
    const ac = (abort.current = new AbortController());
    setSearching(true); setError(null); setPreviewId(null);
    const pageNo = more && page?.next ? page.next : 1;
    try {
      const r = await sourcesApi.search(provider, { q: text, ...(kind ? { kind } : {}), ...(pageNo > 1 ? { page: pageNo } : {}), ...(lang === 'he' ? { lang: 'he' } : {}) }, ac.signal);
      if (ac.signal.aborted) return;
      setPage(r); setRows(more ? (prev) => [...prev, ...r.rows] : r.rows); if (!more) setActive(0);
      if (r.remaining) setStates((prev) => prev?.map((s) => (s.provider === provider ? { ...s, remaining: r.remaining } : s)) ?? prev);
    } catch (e) {
      if (ac.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      setError(sayFailure(lang, e)); if (!more) { setRows([]); setPage(null); }
    } finally { if (!ac.signal.aborted) setSearching(false); }
  };

  /** Where Enter puts it: the playhead, on the target track of its kind when one is chosen. */
  const place = useCallback((k: SourceKind | null) => {
    const trackId = editor.target(k ? targetKindOf(k) : 'video');
    return { start: editor.playhead, ...(trackId ? { trackId } : {}) };
  }, [editor]);

  const add = async (row: SourceResultRow, atPlayhead: boolean) => {
    if (!projectId) { setNote(sx(lang, 'sources.noProject')); return; }
    setNote(null);
    try {
      const a = await sourcesApi.importItem(projectId, { provider: row.provider, itemId: row.itemId, ...(atPlayhead ? { place: place(row.kind) } : {}) });
      setDownloads((d) => [...d, { jobId: a.jobId, title: row.title }]);
      setNote(sx(lang, 'sources.added', { title: row.title }));
    } catch (e) { setNote(sayFailure(lang, e)); }
  };

  const onGridKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const row = rows[active];
    if (e.key === ' ' && row) { e.preventDefault(); setPreviewId((p) => (p === `${row.provider}-${row.itemId}` ? null : `${row.provider}-${row.itemId}`)); return; }
    if (e.key === 'Enter' && row) { e.preventDefault(); void add(row, !e.shiftKey); return; }
    const to = gridNext(active, e.key, rows.length, dir);
    if (to !== null) { e.preventDefault(); setActive(to); }
  };

  const chipKey = (e: KeyboardEvent, i: number) => {
    const to = rovingNext(i, e.key, { count: SEARCHABLE_SOURCES.length, dir });
    if (to === null) return;
    e.preventDefault(); chipRefs.current[to]?.focus(); setProvider(SEARCHABLE_SOURCES[to]!);
  };
  const activeChip = Math.max(0, SEARCHABLE_SOURCES.indexOf(provider));
  const tabStop = rovingTabStop(activeChip, SEARCHABLE_SOURCES.length);
  const cur = stateOf(provider);
  const remaining = remainingLine(lang, page?.remaining ?? cur?.remaining);
  const previewRow = rows.find((r) => `${r.provider}-${r.itemId}` === previewId);
  const done = useCallback((jobId: string) => setDownloads((d) => d.filter((x) => x.jobId !== jobId)), []);
  const activeRow = rows[active];

  return (
    <div className="pf-src" data-testid={TID.panel}>
      <LinkBox lang={lang} projectId={projectId} place={() => place(null)} onStarted={(jobId, title) => setDownloads((d) => [...d, { jobId, title }])} />
      {downloads.length > 0 && <ul className="pf-src-downloads">{downloads.map((d) => <DownloadRow key={d.jobId} jobId={d.jobId} title={d.title} lang={lang} onDone={done} />)}</ul>}

      <div className="pf-src-chips" role="group" aria-label={sx(lang, 'sources.chips')}>
        {SEARCHABLE_SOURCES.map((p, i) => {
          const s = stateOf(p); const n = needs(s);
          return (
            <button key={p} ref={(el) => { chipRefs.current[i] = el; }} type="button" className={`pf-chip pf-ds${provider === p ? ' is-on' : ''}`} aria-pressed={provider === p} tabIndex={i === tabStop ? 0 : -1}
              data-testid={TID.chip(p)} onKeyDown={(e) => chipKey(e, i)}
              onClick={() => { setProvider(p); if (n) setSettingsOpen(true); }}>
              <span>{providerName(p)}</span>
              {n && <span className="pf-src-chip-state" data-testid={TID.chipState(p)}>{sx(lang, n === 'key' ? 'sources.needsKey' : 'sources.needsContact')}</span>}
            </button>
          );
        })}
      </div>
      {listError && <p className="pf-src-err" role="alert" dir="auto">{listError}</p>}

      <div className="pf-src-chips" role="group" aria-label={sx(lang, 'sources.kinds')}>
        <Chip pressed={kind === null} onClick={() => setKind(null)}>{sx(lang, 'sources.kindAll')}</Chip>
        {SOURCE_KINDS.map((k) => <Chip key={k} pressed={kind === k} data-testid={TID.kind(k)} onClick={() => setKind(kind === k ? null : k)}>{sx(lang, `sources.kind.${k}`)}</Chip>)}
      </div>

      <form className="pf-src-search" role="search" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <div className="pf-src-row">
          <input type="search" dir="auto" className="pf-src-input" value={q} onChange={(e) => setQ(e.target.value)} aria-label={sx(lang, 'sources.search')} aria-describedby="pf-src-search-hint" data-testid={TID.search} maxLength={100} />
          <button type="submit" className="pf-btn pf-btn-secondary pf-btn-sm pf-ds" disabled={!q.trim() || searching}><span className="pf-btn-label">{sx(lang, 'sources.searchGo')}</span></button>
        </div>
        <p className="pf-src-muted" id="pf-src-search-hint">{sx(lang, 'sources.searchHint')}</p>
        {remaining && <p className="pf-src-muted" data-testid={TID.remaining} role="status"><bdi>{remaining}</bdi></p>}
      </form>

      <div aria-live="polite" className="pf-src-muted">{searching ? sx(lang, 'sources.searching') : note}</div>
      {error && <p className="pf-src-err" role="alert" dir="auto">{error}</p>}
      {!searching && !error && page && rows.length === 0 && <p data-testid={TID.empty} dir="auto">{sx(lang, 'sources.noResults')}</p>}

      {rows.length > 0 && (
        <>
          <p className="pf-src-muted">{sx(lang, 'sources.addProjectHint')}</p>
          <ul className="pf-src-grid" role="listbox" tabIndex={0} aria-label={sx(lang, 'sources.results')} aria-activedescendant={activeRow ? `pf-src-opt-${activeRow.provider}-${activeRow.itemId}` : undefined}
            data-testid={TID.results} onKeyDown={onGridKey}>
            {rows.map((r, i) => <ResultCard key={`${r.provider}-${r.itemId}`} row={r} lang={lang} active={i === active} onPick={() => setActive(i)} />)}
          </ul>
          {previewRow && <Preview row={previewRow} />}
          <div className="pf-src-row">
            <button type="button" className="pf-btn pf-btn-secondary pf-btn-sm pf-ds" data-testid={TID.addAtPlayhead} disabled={!activeRow} onClick={() => activeRow && void add(activeRow, true)}><span className="pf-btn-label">{sx(lang, 'sources.addAtPlayhead')}</span></button>
            <button type="button" className="pf-btn pf-btn-secondary pf-btn-sm pf-ds" data-testid={TID.addToProject} disabled={!activeRow} onClick={() => activeRow && void add(activeRow, false)}><span className="pf-btn-label">{sx(lang, 'sources.addToProject')}</span></button>
            {page?.next && <button type="button" className="pf-btn pf-btn-ghost pf-btn-sm pf-ds" data-testid={TID.more} disabled={searching} onClick={() => void search(true)}><span className="pf-btn-label">{sx(lang, 'sources.more')}</span></button>}
          </div>
        </>
      )}
      {page && <p className="pf-src-muted" data-testid={TID.attribution} dir="auto">{page.attribution[lang]}</p>}
    </div>
  );
}

export function ResultCard({ row, lang, active, onPick }: { row: SourceResultRow; lang: 'he' | 'en'; active: boolean; onPick: () => void }): ReactElement {
  const licence = licenceLabel(lang, row.licence);
  const tone = badgeTone(row.flags);
  return (
    <li role="option" id={`pf-src-opt-${row.provider}-${row.itemId}`} aria-selected={active} className={`pf-src-card${active ? ' is-active' : ''}`} data-testid={TID.row(row.provider, row.itemId)} onClick={onPick}>
      {row.thumb && <img className="pf-src-thumb" src={sourcesApi.previewUrl(row.thumb)} alt="" loading="lazy" />}
      <span className="pf-src-title" dir="auto"><bdi>{row.title}</bdi></span>
      {row.author && <span className="pf-src-muted" dir="auto">{sx(lang, 'sources.byAuthor', { name: '' })}<bdi>{row.author}</bdi></span>}
      <span className={`pf-src-badge is-${tone}`} role="note" aria-label={licence} data-testid={TID.badge(row.itemId)}><bdi>{licence}</bdi></span>
      {row.warnings.length > 0 && <div data-testid={TID.warnings(row.itemId)}>{row.warnings.map((w, i) => <WarningLine key={`${w.code}-${i}`} w={w} lang={lang} />)}</div>}
    </li>
  );
}

/** The preview player: never starts sound by itself (a video starts muted; audio waits for its play button). Streams from our own handle URL. */
function Preview({ row }: { row: SourceResultRow }): ReactElement | null {
  if (!row.preview) return null;
  const src = sourcesApi.previewUrl(row.preview);
  const k = previewKindOf(row.kind);
  return (
    <div data-testid={TID.preview}>
      {k === 'video' ? <video className="pf-src-preview" src={src} controls muted autoPlay loop playsInline preload="metadata" aria-label={row.title} />
        : k === 'audio' ? <audio className="pf-src-preview" src={src} controls preload="none" aria-label={row.title} />
        : <img className="pf-src-preview" src={src} alt={row.title} />}
    </div>
  );
}

/** The media drawer's two tabs «הקבצים שלי» | «מאגר» (Library.tsx MediaDrawer passes what the drawer always showed as `mine`). */
export function MediaSourcesTabs({ mine }: { mine: ReactNode }): ReactNode {
  const { state } = useEditorState();
  const [tab, setTab] = useState<'mine' | 'sources'>('mine');
  const lang = state.lang;
  return (
    <>
      <Tabs label={sx(lang, 'sources.tab')} value={tab} onChange={(id) => setTab(id === 'sources' ? 'sources' : 'mine')} panelPrefix="pf-media-panel"
        tabs={[{ id: 'mine', label: sx(lang, 'sources.mine'), testId: TID.tabMine }, { id: 'sources', label: sx(lang, 'sources.tab'), testId: TID.tabSources }]} />
      <div role="tabpanel" id={`pf-media-panel-${tab}`} aria-labelledby={`pf-media-panel-tab-${tab}`} tabIndex={0}>
        {tab === 'sources' ? <SourcesTab /> : mine}
      </div>
    </>
  );
}
