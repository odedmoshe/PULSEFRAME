import { useEffect, useRef, useState } from 'react';
import * as T from '@pulseframe/time';
import { splitSentences, volumeLevelAt, type Clip, type ProjectDocument } from '@pulseframe/core';
import { api, type LoudnessResult, type SpeechStatus } from '../api.ts';
import { useEditorState } from './store.ts';

type Track = ProjectDocument['sequences'][string]['tracks'][number];

const MIN_DB = -60, MAX_DB = 12;
const linearToDb = (g: number) => (g <= 0 ? MIN_DB : Math.max(MIN_DB, Math.min(MAX_DB, 20 * Math.log10(g))));
const dbToLinear = (db: number) => (db <= MIN_DB ? 0 : Math.min(4, 10 ** (db / 20)));
const fmtDb = (db: number) => (db <= MIN_DB ? '−∞' : `${db > 0 ? '+' : ''}${db.toFixed(1)}`);
const fmt = (n: number | null, unit: string) => (n === null || !Number.isFinite(n) ? '—' : `${n.toFixed(1)} ${unit}`);

/** Slider that shows its value live but commits once, when the gesture ends. */
function CommitSlider({ label, value, min, max, step, display, onCommit, testid }: { label: string; value: number; min: number; max: number; step: number; display: (v: number) => string; onCommit: (v: number) => void; testid: string }) {
  const [v, setV] = useState(value);
  const dirty = useRef(false);
  useEffect(() => { setV(value); dirty.current = false; }, [value]);
  const commit = (el: HTMLInputElement) => { if (!dirty.current) return; dirty.current = false; onCommit(Number(el.value)); };
  return (
    <label>
      <span>{label}<bdi className="val" dir="ltr">{display(v)}</bdi></span>
      <input type="range" min={min} max={max} step={step} value={v} data-testid={testid} aria-valuetext={display(v)}
        onChange={(e) => { dirty.current = true; setV(Number(e.target.value)); }}
        onPointerUp={(e) => commit(e.currentTarget)} onKeyUp={(e) => commit(e.currentTarget)} onBlur={(e) => commit(e.currentTarget)} />
    </label>
  );
}

function NumberCommit({ label, value, min, max, step, onCommit, testid }: { label: string; value: number; min: number; max?: number; step: number; onCommit: (v: number) => void; testid: string }) {
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
    <label>{label}
      <input type="number" dir="ltr" min={min} max={max} step={step} value={v} data-testid={testid}
        onChange={(e) => { dirty.current = true; setV(e.target.value); }} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
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
      <p className="muted" data-testid="volume-key-count">{t('sound.volume.hint')} <bdi>({keys.length})</bdi></p>
    </div>
  );
}

function TrackRow({ track, others }: { track: Track; others: Track[] }) {
  const { editor, t } = useEditorState();
  const gain = track.audio?.gain ?? 1;
  const pan = track.audio?.pan ?? 0;
  const duck = track.audio?.duck ?? null;
  const [db, setDb] = useState(duck?.reductionDb ?? 12);
  useEffect(() => { if (duck) setDb(duck.reductionDb); }, [duck?.reductionDb]);
  const set = (args: Record<string, unknown>) => void editor.commit([{ op: 'set_track_audio', args: { trackId: track.id, ...args } }], 'Track audio');
  const setDuck = (source: string, reductionDb: number) =>
    void editor.commit([{ op: 'set_ducking', args: { trackId: track.id, sourceTrackIds: source ? [source] : null, ...(source ? { reductionDb } : {}) } }], 'Ducking');
  const source = duck?.sourceTrackIds[0] ?? '';
  return (
    <li className="sound-track" data-testid="sound-track" data-track-id={track.id}>
      <strong dir="auto">{track.name}</strong>
      <CommitSlider label={t('sound.volume')} value={linearToDb(gain)} min={MIN_DB} max={MAX_DB} step={0.5} testid="sound-gain"
        display={(v) => `${fmtDb(v)} dB`} onCommit={(v) => set({ gain: dbToLinear(v) })} />
      <CommitSlider label={t('sound.pan')} value={pan} min={-1} max={1} step={0.05} testid="sound-pan"
        display={(v) => (v === 0 ? t('sound.pan.center') : `${t(v < 0 ? 'sound.pan.left' : 'sound.pan.right')} ${Math.round(Math.abs(v) * 100)}%`)} onCommit={(v) => set({ pan: v })} />
      <label className="check">
        <input type="checkbox" checked={track.muted} data-testid="sound-mute" onChange={(e) => set({ muted: e.target.checked })} />
        {t('sound.mute')}
      </label>
      <div className="fields" data-testid="sound-duck">
        <label>{t('sound.duck.under')}
          <select value={source} data-testid="sound-duck-source" onChange={(e) => setDuck(e.target.value, db)}>
            <option value="">—</option>
            {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <NumberCommit label={t('sound.duck.db')} value={db} min={1} max={40} step={1} testid="sound-duck-db"
          onCommit={(v) => { const c = Math.max(1, Math.min(40, v)); setDb(c); if (source) setDuck(source, c); }} />
      </div>
    </li>
  );
}

function Meter() {
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
    <div className="sound-meter-wrap">
      <span className="muted">{t('sound.meter')}</span>
      <div className={`sound-meter${over ? ' over' : ''}`} role="meter" aria-label={t('sound.meter')} aria-valuemin={MIN_DB} aria-valuemax={0} aria-valuenow={Math.round(shown)}
        aria-valuetext={db === null ? t('sound.meter.idle') : `${fmtDb(Number.isFinite(db) ? db : MIN_DB)} dBFS`} data-testid="sound-meter" data-over={over ? 'true' : 'false'}>
        <div className="sound-meter-bar" style={{ width: `${pct}%` }} />
        <div className="sound-meter-mark" style={{ insetInlineStart: `${((-1 - MIN_DB) / -MIN_DB) * 100}%` }} aria-hidden="true" />
      </div>
      {db === null && <p className="muted">{t('sound.meter.idle')}</p>}
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
      <h3>{t('narration')}</h3>
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
          <p className="muted">{t('narration.hint')}</p>
          <fieldset className="voice-reference" data-testid="narration-reference">
            <label><input type="checkbox" checked={withRef} onChange={(e) => { setWithRef(e.target.checked); setAgreed(false); }} data-testid="narration-use-reference" /> {t('narration.ref.use')}</label>
            {withRef && (refOk && refAsset ? (
              <>
                <p className="muted">{t('narration.ref.from')} <bdi>{refAsset.name}</bdi></p>
                <label>{t('narration.ref.speaker')}
                  <input type="text" dir="auto" maxLength={120} value={speaker} onChange={(e) => setSpeaker(e.target.value)} data-testid="narration-speaker" />
                </label>
                <label><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} data-testid="narration-consent" /> {t('narration.ref.consent')}</label>
                <p className="muted">{t('narration.ref.note')}</p>
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
        <p className="muted" data-testid="narration-unavailable">{t('narration.notConfigured')}</p>
      )}
      {note && <p role="status" data-testid="narration-note" data-kind={note.kind}>{t(note.kind === 'done' ? 'narration.done' : 'narration.failed')} {note.detail && <bdi>{note.detail}</bdi>}</p>}
    </div>
  );
}

export function SoundPanel() {
  const { editor, state, t } = useEditorState();
  const { doc } = state;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<LoudnessResult | null>(null);
  const [resRev, setResRev] = useState(0);
  const [xf, setXf] = useState('0');
  useEffect(() => setXf('0'), [state.selection.join(',')]);
  if (!doc) return null;
  const tracks = (doc.sequences[doc.mainSequenceId]?.tracks ?? []).filter((x) => x.kind === 'audio');
  const sel = editor.selected;
  const clip = sel && state.selection.length === 1 && sel.track.kind === 'audio' && sel.clip.type === 'media' ? sel.clip : null;
  const target = doc.settings.loudness?.target ?? null;
  const measure = async () => {
    setBusy(true); setErr(null);
    try { setRes(await api.measureLoudness(doc.id)); setResRev(state.revision); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const fadeSeconds = (d: T.RationalTime | undefined) => (d ? T.toSeconds(d) : 0);
  const setFade = (which: 'fadeIn' | 'fadeOut', seconds: number) =>
    clip && void editor.commit([{ op: 'set_clip_fades', args: { clipId: clip.id, [which]: T.rt(Math.max(0, Math.round(seconds * 1000)), 1000) } }], 'Clip fades');
  return (
    <div className="fields sound" data-testid="sound-panel">
      <h3>{t('sound.tracks')}</h3>
      {tracks.length === 0 ? <p className="muted">{t('sound.noTracks')}</p> : (
        <ul className="sound-tracks">
          {tracks.map((tr) => <TrackRow key={tr.id} track={tr} others={tracks.filter((o) => o.id !== tr.id)} />)}
        </ul>
      )}
      <p className="muted">{t('sound.duck.hint')}</p>
      <Narration />

      {clip && (
        <>
          <h3>{t('sound.clip')}</h3>
          <NumberCommit key={`in:${clip.id}`} label={t('sound.fadeIn')} value={fadeSeconds(clip.fadeIn)} min={0} step={0.1} testid="sound-fade-in" onCommit={(v) => setFade('fadeIn', v)} />
          <NumberCommit key={`out:${clip.id}`} label={t('sound.fadeOut')} value={fadeSeconds(clip.fadeOut)} min={0} step={0.1} testid="sound-fade-out" onCommit={(v) => setFade('fadeOut', v)} />
          <VolumeKeys key={`vol:${clip.id}`} clip={clip} />
          <div className="fields" key={`xf:${clip.id}`}>
            <label>{t('sound.crossfade')}
              <input type="number" dir="ltr" min={0} step={0.1} value={xf} data-testid="sound-crossfade" onChange={(e) => setXf(e.target.value)} />
            </label>
            <p className="muted">{t('sound.crossfade.hint')}</p>
            <button type="button" className="ghost" data-testid="sound-crossfade-apply" disabled={xf === '' || !Number.isFinite(Number(xf)) || Number(xf) < 0}
              onClick={() => void editor.commit([{ op: 'set_audio_crossfade', args: { clipId: clip.id, duration: T.snapToFrame(T.rt(Math.round(Number(xf) * 1000), 1000), editor.rate) } }], 'Audio crossfade')}>{t('sound.crossfade.apply')}</button>
          </div>
          {!clip.linkGroupId && !clip.reverse && (
            <div className="row">
              <button type="button" className="ghost" data-testid="sound-fit-music" title={t('sound.fit.hint')} onClick={() => void editor.commit([{ op: 'fit_music', args: { clipId: clip.id } }], 'Fit music')}>{t('sound.fit')}</button>
            </div>
          )}
        </>
      )}

      <h3>{t('sound.loudness')}</h3>
      <label>{t('sound.loudness.target')}
        <select value={target === null ? '' : String(target)} data-testid="sound-loudness-target"
          onChange={(e) => void editor.commit([{ op: 'set_loudness_target', args: { target: e.target.value === '' ? null : Number(e.target.value) } }], 'Loudness target')}>
          <option value="">{t('sound.loudness.off')}</option>
          {TARGETS.map((x) => <option key={x} value={x}>{`${x} LUFS (${t(x === -14 ? 'sound.loudness.social' : x === -16 ? 'sound.loudness.podcast' : 'sound.loudness.broadcast')})`}</option>)}
        </select>
      </label>
      <p className="muted">{t('sound.loudness.hint')}</p>
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
      <Meter />
    </div>
  );
}
