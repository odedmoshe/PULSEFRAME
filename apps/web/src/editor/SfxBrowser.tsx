import { useEffect, useMemo, useRef, useState } from 'react';
import * as T from '@pulseframe/time';
import { api, ApiFailure, type SoundEffectInfo } from '../api.ts';
import { NumUnit } from '../ds/index.ts';
import { useEditorState } from './store.ts';
import { SFX_CATEGORIES, SFX_STRINGS } from './sfx.strings.ts';
import './sfxBrowser.css';

/** Built-in synthesised sound effects: search, filter by category, listen, add at the playhead. */
export function SfxBrowser() {
  const { editor, state } = useEditorState();
  const s = SFX_STRINGS[state.lang === 'en' ? 'en' : 'he'];
  const lang = state.lang === 'en' ? 'en' : 'he';
  const projectId = state.doc?.id;
  const [items, setItems] = useState<SoundEffectInfo[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('all');
  const [playing, setPlaying] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const blobs = useRef(new Map<string, Blob>());
  const audio = useRef<{ el: HTMLAudioElement; url: string; id: string } | null>(null);
  const token = useRef(0);
  /** The sound the listener asked for: set from the press, so a second press stops it even while it is still loading. */
  const wanted = useRef<string | null>(null);

  useEffect(() => {
    if (!projectId || items) return;
    let live = true;
    api.soundEffects().then((l) => live && setItems(l)).catch((e) => live && setLoadErr(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [projectId, items]);

  const stop = () => {
    token.current++;
    wanted.current = null;
    const a = audio.current;
    audio.current = null;
    if (a) { a.el.pause(); a.el.removeAttribute('src'); URL.revokeObjectURL(a.url); }
    setPlaying(null);
  };
  useEffect(() => () => stop(), []);

  const play = async (fx: SoundEffectInfo) => {
    if (wanted.current === fx.id) return stop();
    stop();
    wanted.current = fx.id;
    const my = token.current;
    setPlaying(fx.id); setStatus(null);
    try {
      let blob = blobs.current.get(fx.id);
      if (!blob) { blob = await api.soundEffectAudio(fx.id); blobs.current.set(fx.id, blob); }
      if (token.current !== my) return;
      const url = URL.createObjectURL(blob);
      const el = new Audio(url);
      audio.current = { el, url, id: fx.id };
      el.onended = () => { if (audio.current?.el === el) stop(); };
      await el.play();
    } catch (e) {
      if (token.current === my) { stop(); setStatus({ kind: 'err', text: `${s.playFailed}: ${e instanceof Error ? e.message : String(e)}` }); }
    }
  };

  const add = async (fx: SoundEffectInfo) => {
    if (!projectId) return;
    const start = editor.playhead;
    setAdding(fx.id); setStatus(null);
    try {
      await api.addSoundEffect(projectId, { sfxId: fx.id, start });
      setStatus({ kind: 'ok', text: `${s.added}: ${fx.name[lang]} ${s.at}${T.toSeconds(start).toFixed(2)} ${s.seconds}` });
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof ApiFailure || e instanceof Error ? e.message : String(e) });
    } finally { setAdding(null); }
  };

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (items ?? []).filter((x) => (cat === 'all' || x.category === cat) && (!n || x.name.he.toLowerCase().includes(n) || x.name.en.toLowerCase().includes(n)));
  }, [items, q, cat]);

  if (!projectId) return null;
  return (
    <section className="sfx" data-testid="sfx-browser" aria-labelledby="sfx-title">
      <div className="sfx-head">
        <h3 id="sfx-title">{s.title}</h3>
        <span className="muted" data-testid="sfx-count">{items ? items.length : ''}</span>
      </div>
      <input type="search" dir="auto" value={q} onChange={(e) => setQ(e.target.value)} placeholder={s.searchPlaceholder} aria-label={s.search} data-testid="sfx-search" />
      <div className="sfx-chips" role="group" aria-label={s.categories}>
        <button type="button" aria-pressed={cat === 'all'} onClick={() => setCat('all')} data-testid="sfx-cat-all">{s.all}</button>
        {SFX_CATEGORIES.map((c) => <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)} data-testid={`sfx-cat-${c}`}>{s.cat[c]}</button>)}
      </div>
      {loadErr && <p className="muted danger" role="alert">{s.loadFailed}: {loadErr}</p>}
      {!items && !loadErr && <p className="muted">{s.loading}</p>}
      <ul className="sfx-list" role="list" aria-label={s.list}>
        {shown.map((fx) => {
          const name = fx.name[lang];
          return (
            <li key={fx.id} className="sfx-row" role="listitem" data-testid="sfx-row" data-id={fx.id}>
              <span className="sfx-name" dir="auto" title={name}>{name}</span>
              <span className="sfx-len"><NumUnit value={fx.seconds.toFixed(1)} unit={s.seconds} /></span>
              <button type="button" aria-pressed={playing === fx.id} aria-label={`${s.play}: ${name}`} onClick={() => void play(fx)} data-testid="sfx-play">{playing === fx.id ? '■' : '▶'}</button>
              <button type="button" aria-label={`${s.add}: ${name}`} disabled={adding !== null} aria-busy={adding === fx.id} onClick={() => void add(fx)} data-testid="sfx-add">＋</button>
            </li>
          );
        })}
      </ul>
      {items && shown.length === 0 && <p className="muted">{s.empty}</p>}
      <p className={`sfx-status muted${status?.kind === 'err' ? ' danger' : ''}`} role="status" data-testid="sfx-status">{adding ? s.adding : status?.text ?? ''}</p>
    </section>
  );
}
