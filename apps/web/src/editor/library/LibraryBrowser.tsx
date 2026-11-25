/**
 * The library browser shared by the sound drawer's «מהספרייה» tab and the elements drawer's «מהספרייה» tab (wave 7 library track):
 * the honest state of the library first (loading, built-in-not-yet, not set up, indexing, error), then a kind switch, search, the
 * filter chips and the rows. Audition streams from the route into ONE <audio> element (never a blob), one at a time, Escape stops.
 * «שימוש בפרויקט» copies the file into the project at the playhead through POST /projects/:id/library/use. Test ids are fixed by
 * library.testids.ts; words by library.strings.ts and the shared tables (libText); a refusal is worded by the shared tables.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Play, Square } from 'lucide-react';
import type { LibraryFacets, LibraryItemsPage, LibraryKind, LibraryRow, LibraryStatus } from '@pulseframe/core';
import type { Lang } from '@pulseframe/i18n';
import { Button, Chip, IconButton } from '../../ds/index.ts';
import { api, ApiFailure } from '../../api.ts';
import { setSettingsOpen } from '../chromeState.ts';
import { refusalLine, refusalWords } from '../commandBar/describe.ts';
import { useEditorState } from '../store.ts';
import { LIBRARY_TESTIDS as TID } from './library.testids.ts';
import { fillLib, libText, LIBRARY_UI_STRINGS } from './library.strings.ts';
import {
  audioUnsupportedText, auditionable, badgeText, countOf, filtersActive, formatBytes, formatLength, hasHebrew, isAudioKind, isSoft, kindText, lengthLabel, LENGTH_ORDER, NO_FILTERS,
  panelState, queryOf, rowBadges, shownKinds, stateText, takesColour, tempoLabel, tempoOf, TEMPO_ORDER, unusableText, useBody,
  type FailureLike, type LengthBucket, type LibraryFilters, type TempoBucket,
} from './library.logic.ts';
import { useLibraryStatus } from './useLibraryStatus.ts';
import './library.css';

const ico = { size: 16, strokeWidth: 1.75, 'aria-hidden': true as const, focusable: false as const };
/** A server refusal in one line, in the interface language, with its next step (the shared tables word it). */
export const sayFailure = (lang: Lang, e: FailureLike | unknown): string => {
  const f = e as FailureLike;
  return refusalLine(lang, refusalWords(lang, e instanceof ApiFailure ? { code: e.code, message: e.message, hint: e.hint ?? null } : { code: f?.code ?? null, message: f?.message ?? (e instanceof Error ? e.message : String(e)), hint: f?.hint ?? null }));
};

/** One catalogue row. Presentational: the parent owns audition and use. */
export function LibraryRowView({ row, lang, playing, busy, blockedReason, thumb, onPlay, onUse }: {
  row: LibraryRow; lang: Lang; playing: boolean; busy: boolean; blockedReason?: string; thumb: boolean;
  onPlay?: (row: LibraryRow) => void; onUse: (row: LibraryRow) => void;
}): ReactElement {
  const L = LIBRARY_UI_STRINGS[lang];
  const audio = isAudioKind(row.kind);
  const tempo = tempoOf(row);
  const nameId = `pf-lib-name-${row.key.replace(/\W/g, '-')}`;
  const unusable = row.unusable ? unusableText(lang, row.unusable) : undefined;
  const playBlock = !auditionable(row) ? audioUnsupportedText(lang) : row.unusable ? unusable : undefined;
  return (
    <li className={`pf-lib-row${thumb ? ' is-visual' : ''}`} data-testid={TID.row} data-key={row.key} data-kind={row.kind} aria-labelledby={nameId}>
      {thumb && <img className="pf-lib-thumb" src={api.libraryThumbUrl(row.key, 128)} alt="" width={64} height={64} loading="lazy" decoding="async" />}
      <div className="pf-lib-main">
        <div className="pf-lib-top">
          <div className="pf-lib-names">
            <span id={nameId} className="pf-lib-title" dir="auto">{row.title}</span>
            {row.author && <span className="pf-lib-author" dir="auto">{row.author}</span>}
          </div>
          {audio && onPlay && (
            <IconButton label={`${playing ? L.stop : L.play}: ${row.title}`} pressed={playing} data-testid={TID.play} icon={playing ? <Square {...ico} /> : <Play {...ico} />}
              disabledReason={playBlock} onClick={() => onPlay(row)} />
          )}
        </div>
        <div className="pf-lib-meta">
          {audio && row.meta.durationSeconds !== undefined && <bdi className="num" dir="ltr">{formatLength(row.meta.durationSeconds)}</bdi>}
          {row.kind === 'music' && (tempo !== null ? <bdi className="num" dir="ltr">{tempo} BPM</bdi> : <span>{libText(lang, 'library.noTempo')}</span>)}
          {row.kind === 'music' && tempo !== null && <span className="pf-lib-muted">{libText(lang, 'library.publisherFigures')}</span>}
          {!audio && row.meta.width && row.meta.height && <bdi className="num" dir="ltr">{row.meta.width}×{row.meta.height}</bdi>}
          <bdi className="pf-lib-licence" data-testid={TID.licence} dir="ltr">{row.licenceId}</bdi>
          <a className="pf-lib-licence-link" href={api.libraryLicenceUrl(row.key)} target="_blank" rel="noopener noreferrer">{L.licence}</a>
          <bdi className="num pf-lib-muted" dir="ltr">{fillLib(L.bytesToCopy, { size: formatBytes(row.bytes) })}</bdi>
        </div>
        {(rowBadges(row).length > 0 || unusable) && (
          <ul className="pf-lib-badges" aria-label={row.title}>
            {rowBadges(row).map((b) => <li key={b} className={`pf-lib-badge is-${b}`} data-testid={TID.badge} data-badge={b}>{badgeText(lang, b)}</li>)}
            {unusable && <li className="pf-lib-badge is-unusable" data-testid={TID.unusable} data-reason={row.unusable}>{unusable}</li>}
          </ul>
        )}
        {row.credit && <p className="pf-lib-credit" dir="auto">{row.credit.text}</p>}
        {thumb && isSoft(row) && <p className="pf-lib-muted">{L.soft3d}</p>}
        <Button variant="primary" size="sm" data-testid={TID.use} busy={busy} disabledReason={unusable ?? blockedReason} onClick={() => onUse(row)}>
          {audio ? L.use : L.useAtPlayhead}
        </Button>
      </div>
    </li>
  );
}

/** A filter chip with a short list of values: the chip opens its values, a value pressed again clears. */
function FacetChip({ testId, label, value, options, open, onOpen, onPick }: {
  testId: string; label: string; value: string | undefined; options: { id: string; label: string }[]; open: boolean; onOpen: () => void; onPick: (id: string | undefined) => void;
}): ReactElement {
  const shown = options.find((o) => o.id === value)?.label ?? value;
  return (
    <>
      <Chip data-testid={testId} pressed={value !== undefined} aria-expanded={open} aria-haspopup="true" onClick={onOpen}>{shown ? <>{label}: <bdi dir="auto">{shown}</bdi></> : label}</Chip>
      {open && (
        <span className="pf-lib-options" role="group" aria-label={label}>
          {options.map((o) => <Chip key={o.id} pressed={o.id === value} onClick={() => onPick(o.id === value ? undefined : o.id)}><bdi dir="auto">{o.label}</bdi></Chip>)}
        </span>
      )}
    </>
  );
}

export function LibraryBrowser({ kinds, lang: langProp }: { kinds: readonly LibraryKind[]; lang?: Lang }): ReactElement {
  const { editor, state } = useEditorState();
  const lang = langProp ?? state.lang;
  const L = LIBRARY_UI_STRINGS[lang];
  const { status, failure } = useLibraryStatus();
  const panel = panelState(status, failure, (f) => sayFailure(lang, f));
  const visible = shownKinds(status, kinds);
  const [kind, setKind] = useState<LibraryKind>(kinds[0]!);
  const [text, setText] = useState('');
  const [filters, setFilters] = useState<LibraryFilters>(NO_FILTERS);
  const [openChip, setOpenChip] = useState<'genre' | 'mood' | 'tempo' | 'length' | null>(null);
  const [colour, setColour] = useState('#FFFFFF');
  const [rows, setRows] = useState<LibraryRow[]>([]);
  const [page, setPage] = useState<{ next: string | null; total: number } | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [using, setUsing] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [facets, setFacets] = useState<LibraryFacets>({ genre: [], mood: [] });
  const audioEl = useRef<HTMLAudioElement>(null);
  const seq = useRef(0);
  const audio = isAudioKind(kind);
  const ready = panel.kind === 'ready' || (panel.kind === 'indexing' && countOf(status, kinds) > 0);

  // a kind that has no rows left (the library changed) falls back to the first shown one
  useEffect(() => { if (visible.length && !visible.includes(kind)) setKind(visible[0]!); }, [visible.join(), kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = () => { const a = audioEl.current; if (a) { a.pause(); a.removeAttribute('src'); a.load(); } setPlaying(null); };
  useEffect(() => () => { const a = audioEl.current; if (a) { a.pause(); a.removeAttribute('src'); } }, []);
  // Escape stops the audition (it does nothing else while nothing plays)
  useEffect(() => {
    if (!playing) return;
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') stop(); };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, [playing]);

  // search: 250 ms after the last key; the answer of an older query is dropped
  useEffect(() => {
    if (!ready) return;
    const my = ++seq.current;
    const t = setTimeout(() => {
      setLoading(true); setListError(null);
      api.libraryItems(queryOf(kind, text, filters)).then(
        (p: LibraryItemsPage) => { if (seq.current === my) { setRows(p.rows); setPage({ next: p.next, total: p.total }); setLoading(false); } },
        (e: unknown) => { if (seq.current === my) { setRows([]); setPage(null); setListError(sayFailure(lang, e)); setLoading(false); } },
      );
    }, text ? 250 : 0);
    return () => clearTimeout(t);
  }, [ready, kind, text, JSON.stringify(filters), lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // the genre and mood chips offer what the whole catalogue holds for this kind (GET /library/facets), not the rows loaded so far
  useEffect(() => {
    if (!ready || !isAudioKind(kind)) return;
    let alive = true;
    api.libraryFacets(kind).then((f) => { if (alive) setFacets(f); }, () => { if (alive) setFacets({ genre: [], mood: [] }); });
    return () => { alive = false; };
  }, [ready, kind, status?.indexedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const more = async () => {
    if (!page?.next) return;
    const my = seq.current;
    setLoading(true);
    try {
      const p = await api.libraryItems(queryOf(kind, text, filters, page.next));
      if (seq.current === my) { setRows((r) => [...r, ...p.rows]); setPage({ next: p.next, total: p.total }); }
    } catch (e) { setListError(sayFailure(lang, e)); } finally { setLoading(false); }
  };

  const play = (row: LibraryRow) => {
    const a = audioEl.current;
    if (!a) return;
    if (playing === row.key) return stop();
    a.pause();
    a.src = api.libraryAudioUrl(row.key);
    setPlaying(row.key); setNote(null);
    a.play().catch(() => { if (audioEl.current === a) { setPlaying(null); setNote({ kind: 'err', text: audioUnsupportedText(lang) }); } });
  };

  const use = async (row: LibraryRow) => {
    const id = state.doc?.id;
    if (!id) return;
    setUsing(row.key); setNote(null);
    try {
      await api.useLibraryItem(id, useBody(row, { start: editor.playhead, trackId: editor.target(audio ? 'audio' : 'video'), color: colour }));
      setNote({ kind: 'ok', text: `${L.useAtPlayhead}: ${row.title}` });
    } catch (e) { setNote({ kind: 'err', text: sayFailure(lang, e) }); } finally { setUsing(null); }
  };

  const setF = (patch: Partial<LibraryFilters>) => { setFilters((f) => ({ ...f, ...patch })); };
  const toggleChip = (c: 'genre' | 'mood' | 'tempo' | 'length') => setOpenChip((o) => (o === c ? null : c));
  const names = (xs: { value: string; count: number }[]) => xs.map((x) => ({ id: x.value, label: x.value }));
  const tempoWord = { slow: L.tempoSlow, mid: L.tempoMid, fast: L.tempoFast } as const;
  const lengthWord = { short: L.lengthShort, mid: L.lengthMid, long: L.lengthLong } as const;
  const noProject = state.doc ? undefined : L.noProject;

  const gate = ((): ReactElement | null => {
    if (panel.kind === 'loading') return <p className="pf-lib-state" role="status">…</p>;
    if (panel.kind === 'not_built') return <p className="pf-lib-state" role="status" data-testid={TID.empty} data-state="not_built">{L.notBuilt}</p>;
    if (panel.kind === 'error') return <p className="pf-lib-state is-err" role="alert" data-testid={TID.empty} data-state="error">{panel.message}</p>;
    if (panel.kind === 'setup') {
      return (
        <div className="pf-lib-state" data-testid={TID.notConfigured} data-state={panel.state}>
          <p role="status">{panel.state === 'not_configured' ? L.notConfigured : stateText(lang, panel.state)}</p>
          <Button variant="secondary" size="sm" data-testid={TID.openSettings} onClick={() => setSettingsOpen(true)}>{L.openSettings}</Button>
        </div>
      );
    }
    return null;
  })();

  const indexingLine = panel.kind === 'indexing' && (
    <p className="pf-lib-state" role="status" data-testid={TID.indexing}>{fillLib(L.indexing, { rows: panel.rows })}</p>
  );
  const empty = ready && !loading && !listError && rows.length === 0;
  const emptyText = kind === 'music' && !filtersActive(filters, text) && (status?.counts.music ?? 0) === 0 ? L.noMusic : L.empty;

  return (
    <section className="pf-lib" data-surface={isAudioKind(kinds[0]!) ? 'audio' : 'visual'} aria-label={L.audioTab}>
      {/* one element for every audition: it streams from the route */}
      <audio ref={audioEl} preload="none" onEnded={() => setPlaying(null)} onError={() => { if (playing) { setPlaying(null); setNote({ kind: 'err', text: audioUnsupportedText(lang) }); } }} />
      {gate}
      {indexingLine}
      {ready && (
        <>
          {visible.length > 1 && (
            <div className="pf-lib-kinds" role="group" aria-label={L.audioTab}>
              {visible.map((k) => <Chip key={k} data-testid={TID.kind(k)} pressed={k === kind} count={status?.counts[k] ?? 0} onClick={() => { if (k !== kind) { stop(); setRows([]); setPage(null); setKind(k); } }}>{kindText(lang, k)}</Chip>)}
            </div>
          )}
          <input type="search" className="pf-lib-search" dir="auto" data-testid={TID.search} value={text} onChange={(e) => setText(e.target.value)} placeholder={L.searchHint} aria-label={L.search} />
          {hasHebrew(text) && <p className="pf-lib-muted">{L.prefixHeuristic}</p>}
          <div className="pf-lib-chips" role="group" aria-label={L.search}>
            {audio && <>
              <FacetChip testId={TID.chipGenre} label={L.genre} value={filters.genre} options={names(facets.genre)} open={openChip === 'genre'} onOpen={() => toggleChip('genre')} onPick={(v) => setF({ genre: v })} />
              <FacetChip testId={TID.chipMood} label={L.mood} value={filters.mood} options={names(facets.mood)} open={openChip === 'mood'} onOpen={() => toggleChip('mood')} onPick={(v) => setF({ mood: v })} />
              <FacetChip testId={TID.chipTempo} label={L.tempo} value={filters.tempo} options={TEMPO_ORDER.map((b) => ({ id: b, label: `${tempoWord[b]} (${tempoLabel(b)} BPM)` }))} open={openChip === 'tempo'} onOpen={() => toggleChip('tempo')} onPick={(v) => setF({ tempo: v as TempoBucket | undefined })} />
              <FacetChip testId={TID.chipLength} label={L.length} value={filters.length} options={LENGTH_ORDER.map((b) => ({ id: b, label: `${lengthWord[b]} (${lengthLabel(b)})` }))} open={openChip === 'length'} onOpen={() => toggleChip('length')} onPick={(v) => setF({ length: v as LengthBucket | undefined })} />
            </>}
            <Chip data-testid={TID.chipNoCredit} pressed={filters.noCredit} onClick={() => setF({ noCredit: !filters.noCredit })}>{L.noCredit}</Chip>
            <Chip data-testid={TID.chipCommercial} pressed={filters.commercial} onClick={() => setF({ commercial: !filters.commercial })}>{L.commercial}</Chip>
          </div>
          {takesColour(kind) && <label className="pf-lib-colour">{L.colour} <input type="color" data-testid={TID.colour} value={colour} onChange={(e) => setColour(e.target.value.toUpperCase())} /></label>}
          {listError && <p className="pf-lib-state is-err" role="alert">{listError}</p>}
          {empty && <p className="pf-lib-state" role="status" data-testid={TID.empty} data-state="empty">{emptyText}</p>}
          {page && rows.length > 0 && <p className="pf-lib-count" aria-live="polite"><bdi className="num">{page.total}</bdi></p>}
          <ul className={`pf-lib-list${audio ? '' : ' is-visual'}`} data-testid={TID.list} aria-label={kindText(lang, kind)} aria-busy={loading}>
            {rows.map((r) => <LibraryRowView key={r.key} row={r} lang={lang} playing={playing === r.key} busy={using === r.key} thumb={!audio} blockedReason={noProject}
              onPlay={audio ? play : undefined} onUse={(x) => void use(x)} />)}
          </ul>
          {page?.next && <Button variant="secondary" size="sm" data-testid={TID.more} busy={loading} onClick={() => void more()}>{L.more}</Button>}
          <p className={`pf-lib-note is-${note?.kind ?? 'none'}`} role="status">{note?.text ?? ''}</p>
        </>
      )}
    </section>
  );
}

export type { LibraryStatus };
