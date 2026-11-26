import { useEffect, useRef, useState } from 'react';
import * as T from '@pulseframe/time';
import { findClip, splitSentences, volumeLevelAt, type Clip, type ProjectDocument } from '@pulseframe/core';
import { api, type LoudnessResult, type SpeechStatus } from '../api.ts';
import { useEditorState } from './store.ts';
import { SfxBrowser } from './SfxBrowser.tsx';
import { CommitSlider } from './AudioFxBlock.tsx';
import { Section } from './Section.tsx';
import { INSPECTOR_STRINGS } from './inspector.strings.ts';
import { trackRole } from './inspector.model.ts';
import { Switch } from '../ds/index.ts';
import { IconOnBeat } from './icons.tsx';
import { isShortActive, loudnessOps } from './shorts.view.ts';
import { dictionaries } from '@pulseframe/i18n';
import { LimiterSwitch, ReductionMeter } from './send/LimiterSwitch.tsx';
import { LoudnessMatch } from './send/LoudnessMatch.tsx';
import { defaultCeiling, trackClipIds } from './send/send.logic.ts';
import './send/send.css';
import { MUSICFIT_UI_BUILT, MusicFitBlock } from './musicfit/MusicFitBlock.tsx';

type Track = ProjectDocument['sequences'][string]['tracks'][number];

const MIN_DB = -60, MAX_DB = 12;
const linearToDb = (g: number) => (g <= 0 ? MIN_DB : Math.max(MIN_DB, Math.min(MAX_DB, 20 * Math.log10(g))));
const dbToLinear = (db: number) => (db <= MIN_DB ? 0 : Math.min(4, 10 ** (db / 20)));
const fmtDb = (db: number) => (db <= MIN_DB ? '−∞' : `${db > 0 ? '+' : ''}${db.toFixed(1)}`);
const fmt = (n: number | null, unit: string) => (n === null || !Number.isFinite(n) ? '—' : `${n.toFixed(1)} ${unit}`);

function NumberCommit({ label, value, min, max, step, onCommit, testid, unit, hideLabel }: { label: string; value: number; min: number; max?: number; step: number; onCommit: (v: number) => void; testid: string; unit?: string; hideLabel?: boolean }) {
  const [v, setV] = useState(String(value));
  // Only text the user typed since the last commit is ever committed. Without this, a field whose value follows the
  // playhead re-committed its old text on blur after the playhead had moved (a stray volume key at the new position).
  const dirty = useRef(false);
  useEffect(() => { setV(String(value)); dirty.current = false; }, [value]);
  const commit = () => {
    if (!dirty.current) { setV(String(value)); return; }
    dirty.current = false;
    const n = Number(v);
    if (v === '' || !Number.isFinite(n)) { setV(String(value)); return; }
    if (n !== value) onCommit(n);
  };
  return (
    <label className={unit ? 'num-unit' : undefined}>{hideLabel ? <span className="sr-only">{label}</span> : label}
      <input type="number" dir="ltr" min={min} max={max} step={step} value={v} data-testid={testid}
        onChange={(e) => { dirty.current = true; setV(e.target.value); }} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
      {unit && <u aria-hidden="true">{unit}</u>}
    </label>
  );
}

/** Volume automation of the selected sound clip: the level at the playhead, written as a key there. */
function VolumeKeys({ clip }: { clip: Extract<Clip, { type: 'media' }> }) {
  const { editor, t } = useEditorState();
  const local = T.sub(editor.playhead, clip.start);
  const inside = !T.isNegative(local) && T.lte(local, clip.duration);
  const keys = clip.volume ?? [];
  const here = keys.find((k) => T.eq(k.time, local));
  // Same rule as the mixer (one shared definition): held outside the keys, a straight line or a smooth curve between them.
  const now = volumeLevelAt(keys, local);
  // Handlers read the playhead when they run, not the position of the last render: a seek may not have re-rendered this panel yet.
  const liveLocal = () => { const at = T.sub(editor.playhead, clip.start); return !T.isNegative(at) && T.lte(at, clip.duration) ? at : null; };
  const set = (v: number) => { const at = liveLocal(); if (at) void editor.commit([{ op: 'set_volume_keyframe', args: { clipId: clip.id, time: at, value: Math.min(4, Math.max(0, v)) } }], 'Volume key'); };
  return (
    <div className="fields" data-testid="volume-keys">
      <NumberCommit label={`${t('sound.volume.level')}${here ? ' ◆' : ''}`} value={+now.toFixed(3)} min={0} max={4} step={0.05} testid="volume-level" onCommit={(v) => set(v)} />
      <div className="row">
        <button type="button" className="ghost" disabled={!inside || !!here} data-testid="volume-key-add" onClick={() => set(now)}>◆ {t('sound.volume.add')}</button>
        <button type="button" className="ghost" disabled={!here} data-testid="volume-key-remove" onClick={() => { const at = liveLocal(); if (at) void editor.commit([{ op: 'delete_volume_keyframe', args: { clipId: clip.id, time: at } }], 'Remove volume key'); }}>{t('sound.volume.remove')}</button>
        <button type="button" className="ghost" disabled={!keys.length} data-testid="volume-key-clear" onClick={() => void editor.commit([{ op: 'delete_volume_keyframe', args: { clipId: clip.id } }], 'Clear volume keys')}>{t('sound.volume.clear')}</button>
      </div>
      <label className="check">
        <input type="checkbox" disabled={!here} checked={here?.curve === 'smooth'} data-testid="volume-key-smooth"
          onChange={(e) => { const at = liveLocal(); if (at && here) void editor.commit([{ op: 'set_volume_keyframe', args: { clipId: clip.id, time: at, value: here.value, curve: e.target.checked ? 'smooth' : 'linear' } }], 'Volume curve'); }} />
        {t('sound.volume.smooth')}
      </label>
      <p className="muted pf-help" data-testid="volume-key-count">{t('sound.volume.hint')} <bdi>({keys.length})</bdi></p>
    </div>
  );
}

/** The speech a music track can give way to: another sound track, preferring one whose clips have a transcript, then one linked to the picture. */
export function speechTrackFor(doc: ProjectDocument, trackId: string): Track | null {
  const others = (doc.sequences[doc.mainSequenceId]?.tracks ?? []).filter((x) => x.kind === 'audio' && x.id !== trackId && x.clips.length > 0);
  const media = (tr: Track) => tr.clips.filter((c): c is Extract<Clip, { type: 'media' }> => c.type === 'media');
  return others.find((tr) => media(tr).some((c) => !!doc.transcripts[c.assetId])) ?? others.find((tr) => media(tr).some((c) => !!c.linkGroupId)) ?? others[0] ?? null;
}

/**
 * "Lower it when people speak" on a music clip: one switch that ducks the clip's track under the speech track the editor
 * finds by itself (set_ducking, the same operation as the mixer's row). It acts on the whole track, and says so.
 */
export function DuckSwitch({ clip }: { clip: Extract<Clip, { type: 'media' }> }) {
  const { editor, state } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  const doc = state.doc;
  const found = doc ? findClip(doc, clip.id) : undefined;
  if (!doc || !found) return null;
  const track = found.track;
  const duck = track.audio?.duck ?? null;
  const speech = duck ? (doc.sequences[doc.mainSequenceId]?.tracks ?? []).find((x) => x.id === duck.sourceTrackIds[0]) ?? null : speechTrackFor(doc, track.id);
  const set = (on: boolean, db = duck?.reductionDb ?? 9) => void editor.commit([{ op: 'set_ducking', args: { trackId: track.id, sourceTrackIds: on && speech ? [speech.id] : null, ...(on && speech ? { reductionDb: db } : {}) } }], 'Ducking');
  return (
    <div className="pf-card is-pulse duck-card" data-testid="duck-auto" data-on={duck ? 'true' : 'false'}>
      <div className="pf-card-row">
        <div className="pf-card-text">
          <strong>{S.duckTitle}</strong>
          <span className="muted">{speech ? <>{duck ? S.duckUnder : S.duckFound} <bdi>{speech.name}</bdi></> : S.duckNoSpeech}</span>
        </div>
        <Switch checked={!!duck} disabled={!speech || track.locked} onChange={(v) => set(v)} label={S.duckTitle} hideLabel tone="pulse" testId="duck-auto-switch" />
      </div>
      {duck && (
        <CommitSlider label={S.duckDepth} value={duck.reductionDb} min={1} max={40} step={1} testid="duck-auto-depth" display={(v) => `−${v}`} unit="dB" onCommit={(v) => set(true, v)} />
      )}
      <p className="muted pf-help">{S.duckWholeTrack}</p>
    </div>
  );
}

/** A fader that stands up: the level shows live and is committed once, when the gesture ends (as CommitSlider does). */
function Fader({ label, value, min, max, step, display, onCommit, testid }: { label: string; value: number; min: number; max: number; step: number; display: (v: number) => string; onCommit: (v: number) => void; testid: string }) {
  const [v, setV] = useState(value);
  const dirty = useRef(false);
  useEffect(() => { setV(value); dirty.current = false; }, [value]);
  const commit = (el: HTMLInputElement) => { if (!dirty.current) return; dirty.current = false; onCommit(Number(el.value)); };
  return (
    <label className="mix-fader">
      <span className="sr-only">{label}</span>
      <input type="range" className="pf-vrange" min={min} max={max} step={step} value={v} data-testid={testid} aria-label={label} aria-valuetext={display(v)} aria-orientation="vertical"
        style={{ '--v': `${((v - min) / (max - min)) * 100}%` } as React.CSSProperties}
        onChange={(e) => { dirty.current = true; setV(Number(e.target.value)); }}
        onPointerUp={(e) => commit(e.currentTarget)} onKeyUp={(e) => commit(e.currentTarget)} onBlur={(e) => commit(e.currentTarget)} />
      <bdi className="val num" dir="ltr">{display(v)}</bdi>
    </label>
  );
}

/**
 * One channel of the mixer. The strip (name, fader, pan, mute) stands in the row of strips; its "give way to speech" row lies
 * under them. Both stay inside this one list item (it has no box of its own: display contents), so a track's controls are
 * found together.
 */
function TrackRow({ track, others, index }: { track: Track; others: Track[]; index: number }) {
  const { editor, state, t } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  const gain = track.audio?.gain ?? 1;
  const pan = track.audio?.pan ?? 0;
  const duck = track.audio?.duck ?? null;
  const [db, setDb] = useState(duck?.reductionDb ?? 12);
  useEffect(() => { if (duck) setDb(duck.reductionDb); }, [duck?.reductionDb]);
  const set = (args: Record<string, unknown>) => void editor.commit([{ op: 'set_track_audio', args: { trackId: track.id, ...args } }], 'Track audio');
  const setDuck = (source: string, reductionDb: number) =>
    void editor.commit([{ op: 'set_ducking', args: { trackId: track.id, sourceTrackIds: source ? [source] : null, ...(source ? { reductionDb } : {}) } }], 'Ducking');
  const source = duck?.sourceTrackIds[0] ?? '';
  const doc = state.doc;
  const kind = doc ? trackRole(doc, track) : null;
  const first = track.clips.find((c) => c.type === 'media');
  const role = kind ? S.trackRole[kind] : first?.type === 'media' && doc?.assets[first.assetId] ? doc.assets[first.assetId]!.name.replace(/\.[a-z0-9]{2,5}$/i, '') : null;
  return (
    <li className="sound-track" data-testid="sound-track" data-track-id={track.id}>
      <div className="mix-strip" style={{ gridColumn: index + 1 }} data-muted={track.muted ? 'true' : 'false'}>
        <strong className="mix-name" title={role ? `${role} · ${track.name}` : track.name}><span className="mix-role" dir="auto">{role ?? '—'}</span><bdi className="mix-code num" dir="ltr">{track.name}</bdi></strong>
        <Fader label={`${t('sound.volume')}: ${track.name}`} value={linearToDb(gain)} min={MIN_DB} max={MAX_DB} step={0.5} testid="sound-gain"
          display={(v) => `${fmtDb(v)} dB`} onCommit={(v) => set({ gain: dbToLinear(v) })} />
        <label className="mix-pan">
          <span className="sr-only">{t('sound.pan')}: {track.name}</span>
          <PanSlider value={pan} label={`${t('sound.pan')}: ${track.name}`} display={(v) => (v === 0 ? t('sound.pan.center') : `${t(v < 0 ? 'sound.pan.left' : 'sound.pan.right')} ${Math.round(Math.abs(v) * 100)}%`)} onCommit={(v) => set({ pan: v })} />
        </label>
        <label className="check mix-mute" title={t('sound.mute')}>
          <input type="checkbox" checked={track.muted} data-testid="sound-mute" aria-label={`${t('sound.mute')}: ${track.name}`} onChange={(e) => set({ muted: e.target.checked })} />
          <span aria-hidden="true">M</span>
        </label>
      </div>
      <div className="fields mix-duck" data-testid="sound-duck" style={{ gridRow: index + 3 }}>
        <span className="mix-duck-name"><bdi>{track.name}</bdi></span>
        <label><span className="sr-only">{t('sound.duck.under')}: {track.name}</span>
          <select value={source} data-testid="sound-duck-source" onChange={(e) => setDuck(e.target.value, db)}>
            <option value="">{S.duckNone}</option>
            {others.map((o) => <option key={o.id} value={o.id}>{S.duckRow} {o.name}</option>)}
          </select>
        </label>
        <NumberCommit label={`${t('sound.duck.db')}: ${track.name}`} hideLabel unit="dB" value={db} min={1} max={40} step={1} testid="sound-duck-db"
          onCommit={(v) => { const c = Math.max(1, Math.min(40, v)); setDb(c); if (source) setDuck(source, c); }} />
      </div>
    </li>
  );
}

/** The pan of a channel: left and right are places, so the slider runs left to right in every language. */
function PanSlider({ value, label, display, onCommit }: { value: number; label: string; display: (v: number) => string; onCommit: (v: number) => void }) {
  const [v, setV] = useState(value);
  const dirty = useRef(false);
  useEffect(() => { setV(value); dirty.current = false; }, [value]);
  const commit = (el: HTMLInputElement) => { if (!dirty.current) return; dirty.current = false; onCommit(Number(el.value)); };
  return (
    <input type="range" dir="ltr" className="pf-range is-bipolar" min={-1} max={1} step={0.05} value={v} data-testid="sound-pan" aria-label={label} aria-valuetext={display(v)} title={display(v)}
      onChange={(e) => { dirty.current = true; setV(Number(e.target.value)); }}
      onPointerUp={(e) => commit(e.currentTarget)} onKeyUp={(e) => commit(e.currentTarget)} onBlur={(e) => commit(e.currentTarget)} />
  );
}

function Meter({ measured, target }: { measured: number | null; target: number | null }) {
  const { editor, state, t } = useEditorState();
  const player = editor.player;
  const playing = !!player?.playing;
  void state.tick;
  const [db, setDb] = useState<number | null>(null);
  useEffect(() => {
    if (!playing || !player) { setDb(null); return; }
    let raf = 0;
    const loop = () => { setDb(player.peakDb()); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, player]);
  const shown = db === null ? MIN_DB : Math.max(MIN_DB, Math.min(0, Number.isFinite(db) ? db : MIN_DB));
  const pct = ((shown - MIN_DB) / -MIN_DB) * 100;
  const over = db !== null && db > 0;
  return (
    <div className="sound-meter-wrap mix-strip mix-out">
      <strong title={t('sound.meter')}>{INSPECTOR_STRINGS[state.lang].mixOut}</strong>
      <div className={`sound-meter${over ? ' over' : ''}`} role="meter" aria-label={t('sound.meter')} aria-valuemin={MIN_DB} aria-valuemax={0} aria-valuenow={Math.round(shown)}
        aria-valuetext={db === null ? t('sound.meter.idle') : `${fmtDb(Number.isFinite(db) ? db : MIN_DB)} dBFS`} data-testid="sound-meter" data-over={over ? 'true' : 'false'}>
        <div className="sound-meter-bar" style={{ '--v': `${pct}%` } as React.CSSProperties} />
        <div className="sound-meter-mark" style={{ '--v': `${((-1 - MIN_DB) / -MIN_DB) * 100}%` } as React.CSSProperties} aria-hidden="true" />
      </div>
      {/* idle: the measured loudness, else the export target, else a short word that the meter moves while playing */}
      {(db !== null || measured !== null || target !== null) && <bdi className="val num" dir="ltr">{db !== null ? fmtDb(Number.isFinite(db) ? db : MIN_DB) : measured !== null ? `${fmtDb(measured)} LUFS` : `${fmtDb(target!)} LUFS`}</bdi>}
      {db === null && <span className="mix-out-note">{measured !== null ? INSPECTOR_STRINGS[state.lang].mixMeasured : target !== null ? INSPECTOR_STRINGS[state.lang].mixTarget : INSPECTOR_STRINGS[state.lang].mixIdle}</span>}
    </div>
  );
}

const TARGETS = [-14, -16, -23] as const;

/**
 * Narration from text with the local voice model: the setup state as the server reports it, the owner's model download for the
 * exact size shown, and the job. The result arrives as a normal audio clip at the playhead. Built-in voice only: a recorded
 * person's voice needs a consent statement and is not offered here yet.
 */
function Narration() {
  const { editor, state, t } = useEditorState();
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [text, setText] = useState('');
  const [withRef, setWithRef] = useState(false);
  const [speaker, setSpeaker] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [job, setJob] = useState<{ id: string; kind: 'voice' | 'download'; stage: string | null; all?: string[]; done?: number } | null>(null);
  const [note, setNote] = useState<{ kind: 'done' | 'failed'; detail?: string } | null>(null);
  const refresh = () => api.speech().then(setStatus).catch(() => setStatus(null));
  const docId = state.doc?.id;
  useEffect(() => { if (docId) void refresh(); }, [docId]);
  useEffect(() => {
    if (!job) return;
    let live = true, timer = 0;
    const tick = async () => {
      try {
        // a script is several jobs run in order: follow the first one that has not finished
        type J = { status: string; stage?: string | null; error?: { message?: string } };
        const ids = job.all ?? [job.id];
        let running: J | null = null, done = 0, failed: string | undefined, anyFailed = false, made = 0;
        for (const id of ids) {
          const j = (await api.job(id)) as unknown as J;
          if (!['succeeded', 'failed', 'canceled'].includes(j.status)) { running = j; break; }
          done++;
          if (j.status === 'failed') { anyFailed = true; failed = j.error?.message; }
          if (j.status === 'succeeded') made++;
        }
        if (!live) return;
        if (!running) {
          setJob(null);
          if (job.kind === 'download') void refresh();
          if (anyFailed) setNote({ kind: 'failed', detail: failed });
          else if (job.kind === 'voice' && made) { setNote({ kind: 'done' }); setText(''); }
          return;
        }
        const stage = `${ids.length > 1 ? `${done + 1}/${ids.length} · ` : ''}${running.stage ?? ''}`;
        setJob((cur) => (cur && cur.id === job.id ? { ...cur, stage, done } : cur));
      } catch { /* the next tick tries again */ }
      if (live) timer = window.setTimeout(tick, 1000);
    };
    timer = window.setTimeout(tick, 500);
    return () => { live = false; window.clearTimeout(timer); };
  }, [job?.id]);
  if (!status || !state.doc) return null;
  const pid = state.doc.id, nar = status.narration;
  const model = status.models.find((m) => m.kind === 'tts');
  // A reference voice comes from the selected clip's media: at least five seconds of sound.
  const selClip = editor.selected?.clip;
  const refAsset = selClip?.type === 'media' ? state.doc.assets[selClip.assetId] : undefined;
  const refOk = !!refAsset?.audio && T.toSeconds(refAsset.duration) >= 5;
  const reference = withRef && refOk && refAsset ? { referenceAssetId: refAsset.id, consent: { speaker: speaker.trim(), confirmed: true as const } } : null;
  const refBlocked = withRef && (!refOk || !speaker.trim() || !agreed);
  const start = (kind: 'voice' | 'download', p: Promise<{ jobId: string }>) => { setNote(null); p.then((r) => setJob({ id: r.jobId, kind, stage: null })).catch(editor.fail); };
  return (
    <div className="narration" data-testid="narration" data-state={job ? job.kind : nar.ready ? 'ready' : nar.reason ?? 'unknown'}>
      {job ? (
        <p role="status" data-testid="narration-progress">
          {t(job.kind === 'voice' ? 'narration.working' : 'asr.downloading')} <bdi className="muted">{job.stage ?? ''}</bdi>{' '}
          <button className="ghost" onClick={() => void Promise.all((job.all ?? [job.id]).map((id) => api.cancelJob(id))).catch(editor.fail)} data-testid="narration-cancel">{t('asr.cancel')}</button>
        </p>
      ) : nar.ready ? (
        <>
          <label>{t('narration.text')}
            <textarea dir="auto" rows={4} maxLength={6000} value={text} onChange={(e) => setText(e.target.value)} data-testid="narration-text" />
          </label>
          <p>
            <button disabled={!text.trim() || refBlocked} onClick={() => {
              const body = { text: text.trim(), language: /[\u0590-\u05ff]/.test(text) ? 'he' : 'en', start: editor.playhead, ...(reference ?? {}) };
              if (splitSentences(body.text, nar.maxCharacters).length < 2) return start('voice', api.narrate(pid, body));
              setNote(null);
              api.narrateScript(pid, body).then((r) => setJob({ id: r.jobs[0]!.jobId, kind: 'voice', stage: null, all: r.jobs.map((x) => x.jobId) })).catch(editor.fail);
            }} data-testid="narration-run">{t('narration.run')}</button>{' '}
            <span className="muted">{t(nar.device === 'cuda' ? 'asr.device.cuda' : 'asr.device.cpu')}</span>
          </p>
          <p className="muted pf-help">{t('narration.hint')}</p>
          <fieldset className="voice-reference" data-testid="narration-reference">
            <label><input type="checkbox" checked={withRef} onChange={(e) => { setWithRef(e.target.checked); setAgreed(false); }} data-testid="narration-use-reference" /> {t('narration.ref.use')}</label>
            {withRef && (refOk && refAsset ? (
              <>
                <p className="muted">{t('narration.ref.from')} <bdi>{refAsset.name}</bdi></p>
                <label>{t('narration.ref.speaker')}
                  <input type="text" dir="auto" maxLength={120} value={speaker} onChange={(e) => setSpeaker(e.target.value)} data-testid="narration-speaker" />
                </label>
                <label><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} data-testid="narration-consent" /> {t('narration.ref.consent')}</label>
                <p className="muted pf-help">{t('narration.ref.note')}</p>
              </>
            ) : <p className="muted" data-testid="narration-reference-none">{t('narration.ref.select')}</p>)}
          </fieldset>
        </>
      ) : nar.reason === 'model_missing' && model ? (
        <p data-testid="narration-model-missing">
          {t('narration.modelMissing')} <bdi>{model.title[state.lang === 'en' ? 'en' : 'he']}</bdi> · {t('asr.license')}: <bdi>{model.license}</bdi>{' '}
          <button onClick={() => start('download', api.downloadSpeechModel(pid, model.id, model.missingDownloadBytes))} data-testid="narration-download">{t('asr.download')} (<bdi>{(model.missingDownloadBytes / 1e9).toFixed(2)} GB</bdi>)</button>
        </p>
      ) : nar.reason === 'engine_not_working' ? (
        <p className="muted" data-testid="narration-unavailable">{t('narration.engineBroken')} <bdi>{nar.detail}</bdi></p>
      ) : (
        <p className="muted" data-testid="narration-unavailable">{INSPECTOR_STRINGS[state.lang].narrationNotInstalled}</p>
      )}
      {note && <p role="status" data-testid="narration-note" data-kind={note.kind}>{t(note.kind === 'done' ? 'narration.done' : 'narration.failed')} {note.detail && <bdi>{note.detail}</bdi>}</p>}
    </div>
  );
}

/** The sound of one selected sound clip: fades, the level at the playhead and its keys, the crossfade into it, fitting music to the edit. */
export function ClipSound({ clip }: { clip: Extract<Clip, { type: 'media' }> }) {
  const { editor, state, t } = useEditorState();
  const [xf, setXf] = useState('0');
  useEffect(() => setXf('0'), [clip.id]);
  const fadeSeconds = (d: T.RationalTime | undefined) => (d ? T.toSeconds(d) : 0);
  const setFade = (which: 'fadeIn' | 'fadeOut', seconds: number) =>
    void editor.commit([{ op: 'set_clip_fades', args: { clipId: clip.id, [which]: T.rt(Math.max(0, Math.round(seconds * 1000)), 1000) } }], 'Clip fades');
  const S = INSPECTOR_STRINGS[state.lang];
  return (
    <div className="fields clip-sound" data-testid="clip-sound">
      <VolumeKeys key={`vol:${clip.id}`} clip={clip} />
      <div className="pf-pair">
        <NumberCommit key={`in:${clip.id}`} label={t('sound.fadeIn')} value={fadeSeconds(clip.fadeIn)} min={0} step={0.1} testid="sound-fade-in" onCommit={(v) => setFade('fadeIn', v)} />
        <NumberCommit key={`out:${clip.id}`} label={t('sound.fadeOut')} value={fadeSeconds(clip.fadeOut)} min={0} step={0.1} testid="sound-fade-out" onCommit={(v) => setFade('fadeOut', v)} />
      </div>
      <Section id="sound-crossfade" title={S.crossfade} defaultOpen={false} help>
        <div className="fields" key={`xf:${clip.id}`}>
          <label>{t('sound.crossfade')}
            <input type="number" dir="ltr" min={0} step={0.1} value={xf} data-testid="sound-crossfade" onChange={(e) => setXf(e.target.value)} />
          </label>
          <p className="muted pf-help">{t('sound.crossfade.hint')}</p>
          <button type="button" className="ghost" data-testid="sound-crossfade-apply" disabled={xf === '' || !Number.isFinite(Number(xf)) || Number(xf) < 0}
            onClick={() => void editor.commit([{ op: 'set_audio_crossfade', args: { clipId: clip.id, duration: T.snapToFrame(T.rt(Math.round(Number(xf) * 1000), 1000), editor.rate) } }], 'Audio crossfade')}>{t('sound.crossfade.apply')}</button>
        </div>
      </Section>
      {!clip.linkGroupId && !clip.reverse && (
        <div className="row">
          <button type="button" className="ghost" data-testid="sound-fit-music" title={t('sound.fit.hint')} onClick={() => void editor.commit([{ op: 'fit_music', args: { clipId: clip.id } }], 'Fit music')}>{t('sound.fit')}</button>
        </div>
      )}
      {/* «התאמה לאורך» (wave 7 musicfit): once builder C has built it */}
      {MUSICFIT_UI_BUILT && <MusicFitBlock key={`mf:${clip.id}`} clip={clip} />}
    </div>
  );
}

/** The mixer (Sound mode): a strip per sound track and the output meter, who gives way to speech, the loudness of the whole edit, narration and the sound-effects library. */
export function SoundPanel() {
  const { editor, state, t } = useEditorState();
  const { doc } = state;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<LoudnessResult | null>(null);
  const [resRev, setResRev] = useState(0);
  // «השוואת עוצמה»: the selected sound clips, or every clip of the track the owner named (null: the selection)
  const [matchTrack, setMatchTrack] = useState<string | null>(null);
  if (!doc) return null;
  const S = INSPECTOR_STRINGS[state.lang];
  const tracks = (doc.sequences[doc.mainSequenceId]?.tracks ?? []).filter((x) => x.kind === 'audio');
  const target = doc.settings.loudness?.target ?? null;
  // a short has its own loudness target (format.loudness); the project's is left alone
  const setTarget = (v: number | null) => { if (state.rawDoc) void editor.commit(loudnessOps(state.rawDoc, state.activeSequenceId, v), 'Loudness target'); };
  const shortId = isShortActive(state.rawDoc, state.activeSequenceId) ? state.activeSequenceId : undefined;
  const measure = async () => {
    setBusy(true); setErr(null);
    try { setRes(await api.measureLoudness(doc.id, { sequenceId: shortId })); setResRev(state.revision); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const ducked = tracks.filter((x) => x.audio?.duck).length;
  const D = dictionaries[state.lang];
  // the sound clips of the selection; when none of the selected clips is on a sound track the raw selection goes to the measurement, which says why it cannot match them
  const selectedAudio = state.selection.filter((id) => tracks.some((tr) => tr.clips.some((c) => c.id === id)));
  const scopeTrack = matchTrack ? tracks.find((x) => x.id === matchTrack) ?? null : null;
  const matchIds = scopeTrack ? trackClipIds(scopeTrack) : selectedAudio.length ? selectedAudio : state.selection;
  const setLimiter = (ceiling: number | null) => void editor.commit([{ op: 'set_master_limiter', args: { ceiling } }], 'Master limiter');
  return (
    <div className="fields sound" data-testid="sound-panel">
      <div className="mix" role="group" aria-label={t('sound.tracks')}>
        {tracks.length === 0 ? <p className="muted">{t('sound.noTracks')}</p> : (
          <ul className="sound-tracks" style={{ '--n': tracks.length } as React.CSSProperties}>
            {tracks.map((tr, i) => <TrackRow key={tr.id} track={tr} index={i} others={tracks.filter((o) => o.id !== tr.id)} />)}
            <li className="mix-duck-head" role="presentation"><IconOnBeat size={16} /> {S.secDuck}</li>
          </ul>
        )}
        <Meter measured={res && resRev === state.revision && res.integratedLufs !== null && Number.isFinite(res.integratedLufs) ? res.integratedLufs : null} target={target} />
        <ReductionMeter lang={state.lang} ceiling={doc.settings.limiter?.ceiling ?? null} loudnessTarget={target} />
      </div>
      {tracks.length > 0 && <p className="muted pf-help mix-duck-hint" data-ducked={ducked}>{t('sound.duck.hint')}</p>}

      <div className={`pf-card loud-card${target === null ? '' : ' is-set'}`}>
        <div className="pf-card-row">
          <div className="pf-card-text">
            <strong>{t('sound.loudness')}</strong>
            <span className="muted">{res && res.integratedLufs !== null ? <bdi dir="ltr" className="num">{fmt(res.integratedLufs, 'LUFS')}</bdi> : S.loudUnknown}{target !== null && <> · {S.loudTarget} <bdi dir="ltr" className="num">{target} LUFS</bdi></>}</span>
          </div>
          {target !== -14 && <button type="button" className="primary" data-testid="sound-loudness-14" onClick={() => setTarget(-14)}>{S.loudAlign}</button>}
        </div>
        <label>{t('sound.loudness.target')}
          <select value={target === null ? '' : String(target)} data-testid="sound-loudness-target"
            onChange={(e) => setTarget(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">{t('sound.loudness.off')}</option>
            {TARGETS.map((x) => <option key={x} value={x}>{`${x} LUFS (${t(x === -14 ? 'sound.loudness.social' : x === -16 ? 'sound.loudness.podcast' : 'sound.loudness.broadcast')})`}</option>)}
          </select>
        </label>
        <p className="muted pf-help">{t('sound.loudness.hint')}</p>
        <LimiterSwitch lang={state.lang} ceiling={doc.settings.limiter?.ceiling ?? null} fallback={defaultCeiling(doc)} onChange={setLimiter} />
        <button className="ghost" disabled={busy} aria-busy={busy} onClick={() => void measure()} data-testid="sound-measure">{busy ? t('sound.measuring') : t('sound.measure')}</button>
        {err && <p className="muted danger" role="alert" data-testid="sound-error">{err}</p>}
        {res && (
          <div role="status" data-testid="sound-loudness-result" data-lufs={res.integratedLufs ?? ''} data-stale={resRev !== state.revision ? 'true' : 'false'}>
            {res.integratedLufs === null && <p>{t('sound.result.silent')}</p>}
            <dl className="sound-result">
              <dt>{t('sound.result.lufs')}</dt><dd dir="ltr">{fmt(res.integratedLufs, 'LUFS')}</dd>
              <dt>{t('sound.result.peak')}</dt><dd dir="ltr">{fmt(res.truePeakDbtp, 'dBTP')}</dd>
              <dt>{t('sound.result.range')}</dt><dd dir="ltr">{fmt(res.rangeLu, 'LU')}</dd>
              <dt>{t('sound.result.clip')}</dt><dd>{res.wouldClipWithoutNormalisation ? t('sound.result.clip.yes') : t('sound.result.clip.no')}</dd>
              <dt>{t('sound.result.gain')}</dt><dd dir="ltr">{res.target === null ? t('sound.result.noTarget') : fmt(res.exportWouldApplyGainDb, 'dB')}</dd>
            </dl>
            {res.limitedByPeak && <p className="muted">{t('sound.result.limited')}</p>}
            {resRev !== state.revision && <p className="muted">{t('sound.result.stale')}</p>}
            {res.note && <p className="muted" dir="auto">{res.note}</p>}
          </div>
        )}
      </div>

      <Section id="send-match" title={D['send.match']} defaultOpen={false} help>
        {tracks.length > 1 && (
          <div className="row" role="group" aria-label={D['send.matchTrack']} data-testid="loudness-match-tracks">
            {tracks.map((tr) => (
              <button key={tr.id} type="button" className="ghost" aria-pressed={matchTrack === tr.id} disabled={trackClipIds(tr).length === 0} onClick={() => setMatchTrack(matchTrack === tr.id ? null : tr.id)} data-testid="loudness-match-track" data-track-id={tr.id}>
                {D['send.matchTrack']}: <bdi>{tr.name}</bdi>
              </button>
            ))}
          </div>
        )}
        <LoudnessMatch lang={state.lang} projectId={doc.id} clipIds={matchIds} scopeLabel={scopeTrack?.name} />
      </Section>
      <Section id="narration" title={t('narration')} defaultOpen={false} help><Narration /></Section>
      <Section id="sfx" title={S.sfxLibrary} defaultOpen={false}><SfxBrowser /></Section>
    </div>
  );
}
