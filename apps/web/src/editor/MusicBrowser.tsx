/**
 * The audio drawer's second tab «מוזיקה מובנית» (ADR-0022; plan §8; the lead mounts it after the redesign's audio drawer has
 * merged). Per style (listMusicStyles, the catalogue the server makes from): name, «120 BPM» as a .num token and the line
 * «קצב ידוע מהמתכון» (never "measured"); length chips 8 / 16 / 32 bars and «כאורך הסרטון» (the exact length in `fitSeconds`,
 * any "n" or "n/d", rounded up to whole bars here and sent as bars);
 * seconds and megabytes before adding; play/stop preview through the preview route (no autoplay); the section strip from
 * musicLayout with text labels, not colour alone; the attention badge «מוזיקה מובנית — עוד לא הושמעה לאף אחד» while a style is
 * unheard; «הוספה לציר הזמן» (POST /api/v1/projects/:id/music, placed from the start of the film: one undo). Test ids:
 * MUSIC_TESTIDS. Built from the redesign's primitives and tokens (apps/web/src/ds).
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Minus, Play, Plus, Square } from 'lucide-react';
import { Badge, Button, Chip, IconButton } from '../ds/index.ts';
import { MUSIC_TESTIDS } from './packs.testids.ts';
import { MUSIC_STRINGS } from './music.strings.ts';
import { addBody, errorText, formatDuration, formatMegabytes, lengthChoices, musicRows, previewUrl, PREVIEW_MAX_BARS, sectionStrip, stepSeed, type LengthKey, type MusicRow } from './music.logic.ts';
import { InstrumentsChoice } from './instruments/InstrumentsChoice.tsx';
import './musicBrowser.css';

const ico = { size: 16, strokeWidth: 1.75, 'aria-hidden': true as const, focusable: false as const };

export function MusicBrowser({ projectId, lang, fitSeconds, onAdded }: { projectId: string; lang: 'he' | 'en'; /** exact seconds of the edit as 'n' or 'n/d', for «כאורך הסרטון»; null = an empty timeline */ fitSeconds: string | null; onAdded?: (r: { assetId: string; clipId: string | null; revision: number }) => void }): ReactElement | null {
  const s = MUSIC_STRINGS[lang];
  const rows = useMemo(() => musicRows(lang), [lang]);
  const [choice, setChoice] = useState<Record<string, LengthKey>>({});
  const [seeds, setSeeds] = useState<Record<string, number>>({});
  const [playing, setPlaying] = useState<{ id: string; ready: boolean } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const audio = useRef<{ el: HTMLAudioElement; url: string } | null>(null);
  const pending = useRef<AbortController | null>(null);

  const stop = () => {
    pending.current?.abort();
    pending.current = null;
    const a = audio.current;
    audio.current = null;
    if (a) { a.el.pause(); a.el.removeAttribute('src'); URL.revokeObjectURL(a.url); }
    setPlaying(null);
  };
  useEffect(() => () => stop(), []);

  const play = async (row: MusicRow, bars: number, seed: number) => {
    if (playing?.id === row.id) return stop();
    stop();
    const ac = new AbortController();
    pending.current = ac;
    setPlaying({ id: row.id, ready: false });
    setStatus(bars > PREVIEW_MAX_BARS ? { kind: 'info', text: s.previewFirst } : null);
    try {
      const r = await fetch(previewUrl(row.id, bars, seed), { credentials: 'same-origin', signal: ac.signal });
      if (!r.ok) throw new Error(errorText(lang, s, r.status, await r.json().catch(() => null)));
      const blob = await r.blob();
      if (ac.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const el = new Audio(url);
      audio.current = { el, url };
      el.onended = () => { if (audio.current?.el === el) stop(); };
      await el.play();
      setPlaying({ id: row.id, ready: true });
    } catch (e) {
      if (ac.signal.aborted) return;
      stop();
      setStatus({ kind: 'err', text: e instanceof Error && e.message.startsWith(s.failed) ? e.message : `${s.playFailed}: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const add = async (row: MusicRow, key: LengthKey, seed: number) => {
    const c = lengthChoices(row.style, fitSeconds, s).find((x) => x.key === key)!;
    if (c.disabledReason) return;
    setAdding(row.id);
    setStatus(null);
    try {
      const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/music`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(addBody(row.id, c, seed)) });
      const body = await r.json().catch(() => null);
      if (!r.ok) { setStatus({ kind: 'err', text: errorText(lang, s, r.status, body) }); return; }
      const out = body as { assetId: string; clipId: string | null; revision: number };
      setStatus({ kind: 'ok', text: `${out.clipId ? s.added : s.addedLibrary}: ${row.name}` });
      onAdded?.(out);
    } catch (e) {
      setStatus({ kind: 'err', text: `${s.failed}: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setAdding(null);
    }
  };

  return (
    <section className="pf-music" data-testid={MUSIC_TESTIDS.panel} aria-labelledby="pf-music-title">
      <header className="pf-music-head">
        <h3 id="pf-music-title">{s.title}</h3>
        <p className="pf-music-intro">{s.intro}</p>
      </header>
      <ul className="pf-music-list" aria-label={s.list}>
        {rows.map((row) => {
          const key: LengthKey = choice[row.id] ?? '16';
          const seed = seeds[row.id] ?? 1;
          const choices = lengthChoices(row.style, fitSeconds, s);
          const c = choices.find((x) => x.key === key)!;
          const strip = c.bars && !c.disabledReason ? sectionStrip(row.id, c.bars, s) : [];
          const isPlaying = playing?.id === row.id;
          const nameId = `pf-music-name-${row.id.replace(/\W/g, '-')}`;
          return (
            <li key={row.id} className="pf-music-row" data-testid={MUSIC_TESTIDS.row} data-style-id={row.id} aria-labelledby={nameId}>
              <div className="pf-music-top">
                <div className="pf-music-names">
                  <span id={nameId} className="pf-music-name">{row.name}</span>
                  <span className="pf-music-hint">{row.hint}</span>
                </div>
                <IconButton
                  label={`${isPlaying ? s.stop : s.play}: ${row.name}`} pressed={isPlaying} data-testid={MUSIC_TESTIDS.play}
                  icon={isPlaying ? <Square {...ico} /> : <Play {...ico} />} busy={isPlaying && !playing?.ready}
                  disabledReason={c.bars ? undefined : (c.disabledReason ?? undefined)}
                  onClick={() => { if (c.bars) void play(row, c.bars, seed); }}
                />
              </div>
              <div className="pf-music-meta">
                <bdi className="pf-music-bpm num" dir="ltr">{row.bpm} {s.bpm}</bdi>
                <span className="pf-music-recipe">{s.knownFromRecipe}</span>
                {row.unheard && <Badge tone="attention" className="pf-music-unheard"><span data-testid={MUSIC_TESTIDS.unheard}>{row.label}</span></Badge>}
              </div>
              <div className="pf-music-lengths" role="group" aria-label={`${s.length}: ${row.name}`}>
                {choices.map((x) => (
                  <Chip
                    key={x.key} pressed={key === x.key} data-testid={MUSIC_TESTIDS.bars} data-bars={x.key}
                    aria-disabled={x.disabledReason ? true : undefined} title={x.disabledReason ?? undefined}
                    onClick={() => { if (!x.disabledReason) { if (isPlaying) stop(); setChoice((m) => ({ ...m, [row.id]: x.key })); } }}
                    count={x.key === 'fit' && x.bars && !x.disabledReason ? x.bars : undefined}
                  >{x.key === 'fit' ? s.fit : `${x.key} ${s.bars}`}</Chip>
                ))}
              </div>
              {/* «צליל» (wave 7 instruments; builder W3 wires the choice into the preview and the add): renders nothing until built */}
              <InstrumentsChoice styleId={row.id} lang={lang} bars={c.bars ?? 0} seed={seed} value="synth" onChange={() => undefined} />
              <div className="pf-music-seed" role="group" aria-label={`${s.seed}: ${row.name}`} data-testid={MUSIC_TESTIDS.seed}>
                <IconButton size="sm" label={s.seedDown} icon={<Minus {...ico} />} disabledReason={seed <= 0 ? s.seedDown : undefined} onClick={() => { if (isPlaying) stop(); setSeeds((m) => ({ ...m, [row.id]: stepSeed(seed, -1) })); }} />
                <span className="pf-music-seed-value" aria-live="polite">{s.seed} <bdi className="num">{seed}</bdi></span>
                <IconButton size="sm" label={s.seedUp} icon={<Plus {...ico} />} onClick={() => { if (isPlaying) stop(); setSeeds((m) => ({ ...m, [row.id]: stepSeed(seed, 1) })); }} />
              </div>
              {c.disabledReason ? <p className="pf-music-reason">{c.disabledReason}</p> : (
                <>
                  <p className="pf-music-size" data-testid={MUSIC_TESTIDS.size} aria-label={`${s.sizeLabel}: ${c.bars} ${s.bars}, ${formatDuration(c.seconds!)}, ${formatMegabytes(c.bytes!)} ${s.megabytes}`}>
                    <bdi className="num" dir="ltr">{c.bars}</bdi> {s.bars} · <bdi className="num" dir="ltr">{formatDuration(c.seconds!)}</bdi> · <bdi className="num" dir="ltr">{formatMegabytes(c.bytes!)} {s.megabytes}</bdi>
                  </p>
                  <ol className="pf-music-sections" data-testid={MUSIC_TESTIDS.sections} aria-label={s.sections}>
                    {strip.map((p) => (
                      <li key={p.startBar} className={`pf-music-part is-${p.kind}`} data-kind={p.kind} data-level={p.level} style={{ flexGrow: p.bars }} aria-label={`${p.label}, ${p.bars} ${s.bars}`}>
                        <span className="pf-music-part-label" aria-hidden="true">{p.label}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
              <Button
                variant="primary" size="sm" data-testid={MUSIC_TESTIDS.add} busy={adding === row.id}
                disabledReason={c.disabledReason ?? (adding !== null && adding !== row.id ? s.adding : undefined)}
                aria-describedby="pf-music-addhint" onClick={() => void add(row, key, seed)}
              >{s.add}</Button>
            </li>
          );
        })}
      </ul>
      <p id="pf-music-addhint" className="pf-music-note">{s.addHint}</p>
      <p className={`pf-music-status is-${status?.kind ?? 'none'}`} role="status">{adding ? s.adding : status?.text ?? ''}</p>
    </section>
  );
}
