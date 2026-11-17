/**
 * The motion tracks of the selected video clip's file (ADR-0015): start one on the monitor (TrackPicker), track it with a
 * durable job (its progress and Stop), read how each frame went (counts per state and the stretches to check, each with a
 * jump to where the timeline shows it), rename, delete, and add a title that follows it. No AI model is involved.
 * Every change is an op through Editor.commit; the job attaches its result through the server's internal op.
 */
import { useEffect, useRef, useState } from 'react';
import * as T from '@pulseframe/time';
import { clipEnd, trackSummary, TRACK_STATES, type Clip, type MotionTrack, type TrackRun } from '@pulseframe/core';
import { dictionaries, jobStageLabel, translateRefusal, type Lang } from '@pulseframe/i18n';
import { ApiFailure } from '../api.ts';
import { timelineFrameOfSource, trackingProgress, trackRemoval } from './tracking.math.ts';
import { removeRegionsQuestion, stateName, stretch, TRACKING_TESTIDS as ID, trackingT } from './tracking.strings.ts';
import { InlineRename } from './InlineRename.tsx';
import { useEditorState } from './store.ts';
import './tracking.css';

type MediaClip = Extract<Clip, { type: 'media' }>;
const OPEN_JOB = new Set(['queued', 'running', 'cancel-requested']);
/** At most this many stretches are listed per track; the count of the rest is given. */
const PROBLEMS_SHOWN = 40;

/** A refusal said in the interface language: the code's headline, then the detail (translated when it is a known one). */
export function refusalText(lang: Lang, e: unknown): string {
  if (e instanceof ApiFailure) {
    const head = (dictionaries[lang] as Record<string, string>)[`error.code.${e.code}`];
    const detail = translateRefusal(lang, e.message) ?? e.message;
    return head ? `${head}: ${detail}` : detail;
  }
  return e instanceof Error ? e.message : String(e);
}

export function TrackingPanel() {
  const { editor, state } = useEditorState();
  const tt = trackingT(state.lang);
  const sel = editor.selected;
  const doc = state.doc;
  const clip = sel?.clip.type === 'media' ? (sel.clip as MediaClip) : null;
  const [said, setSaid] = useState('');
  // a track created here (TrackPicker sets it active) is announced once, in the panel's live status
  const lastActive = useRef(state.activeTrackId);
  useEffect(() => {
    if (state.activeTrackId && state.activeTrackId !== lastActive.current && doc?.motionTracks?.[state.activeTrackId]?.assetId === clip?.assetId) setSaid(tt('mtrack.pick.created'));
    lastActive.current = state.activeTrackId;
  }, [state.activeTrackId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!doc || !sel || !clip || state.selection.length !== 1 || sel.track.kind !== 'video') return null;
  const asset = doc.assets[clip.assetId];
  if (!asset?.video) return <div className="fields" data-testid={ID.panel} data-asset-id={clip.assetId}><p className="muted">{tt('mtrack.noVideo')}</p></div>;
  const tracks = Object.values(doc.motionTracks ?? {}).filter((t) => t.assetId === asset.id).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.id.localeCompare(b.id));
  const picking = state.picker?.clipId === clip.id ? state.picker.kind : null;
  const toggle = (kind: 'point' | 'region') => (picking === kind ? editor.closePicker() : editor.openPicker(kind, clip.id));
  return (
    <div className="fields tracking" data-testid={ID.panel} data-asset-id={asset.id}>
      <p className="muted pf-help">{tt('mtrack.note')}</p>
      <div className="row">
        <button type="button" className="ghost" aria-pressed={picking === 'point'} data-testid={ID.newPoint} onClick={() => toggle('point')}>{tt('mtrack.newPoint')}</button>
        <button type="button" className="ghost" aria-pressed={picking === 'region'} data-testid={ID.newRegion} onClick={() => toggle('region')}>{tt('mtrack.newRegion')}</button>
      </div>
      <p className="tracking-msg" role="status" data-testid={ID.status}>{said}</p>
      {tracks.length === 0 ? <p className="muted">{tt('mtrack.none')}</p> : (
        <ul className="mtrack-list" aria-label={tt('mtrack.list')}>
          {tracks.map((t) => <TrackItem key={t.id} track={t} clip={clip} videoTrackId={sel.track.id} active={state.activeTrackId === t.id} />)}
        </ul>
      )}
    </div>
  );
}

function TrackItem({ track, clip, videoTrackId, active }: { track: MotionTrack; clip: MediaClip; videoTrackId: string; active: boolean }) {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const tt = trackingT(lang);
  const doc = state.doc!;
  const [err, setErr] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [asking, setAsking] = useState(false);
  const jobId = state.trackJobFor[track.id];
  const job = jobId ? state.trackJobs[jobId] : undefined;
  const open = !!job && OPEN_JOB.has(job.status);
  const summary = trackSummary(track);
  const tracked = track.st.some((s) => s !== 4) || track.st.length > 1;
  const removal = trackRemoval(doc, track.id);
  const usedBy = removal.clips;
  const progress = trackingProgress(job?.stage);
  const stage = jobStageLabel(job?.stage, lang) || tt('mtrack.queued');

  const run = async (over: boolean) => {
    setErr(null);
    setOverwrite(false);
    try { await editor.trackMotion(track.id, (over ? { overwrite: true } : {}) as Partial<TrackRun>); }
    catch (e) { if (e instanceof ApiFailure && e.code === 'would_discard_edits') setOverwrite(true); else setErr(refusalText(lang, e)); }
  };
  const stop = () => { editor.cancelTracking(track.id).catch((e) => setErr(refusalText(lang, e))); };
  const jump = (from: number, to: number) => {
    const d = editor.doc;
    const hit = d ? timelineFrameOfSource(d, track.assetId, from, to - 1) : null;
    if (hit) { setErr(null); editor.seek(hit.frame); } else setErr(tt('mtrack.jump.none'));
  };
  // Privacy regions placed on the track go with it, and what they hide shows: that is asked first, never done in one click.
  const remove = (confirmed = false) => {
    const now = editor.doc ? trackRemoval(editor.doc, track.id) : removal; // as it is when the button is pressed
    if (now.confirm && !confirmed) { setAsking(true); return; }
    setAsking(false);
    void editor.commit([now.op], 'Remove motion track');
  };
  // Two commits, two undo steps: the title's id comes from the server's seed, so one transaction cannot name it in its second op.
  const followTitle = async () => {
    const rate = editor.rate;
    const d = editor.doc;
    const c = (d && d.sequences[d.mainSequenceId]!.tracks.flatMap((tr) => tr.clips).find((x) => x.id === clip.id)) || clip; // as it is now
    const start = editor.timeIn(c);
    const duration = T.max(T.frameTime(1, rate), T.sub(clipEnd(c), start));
    const r = await editor.commit([{ op: 'add_text', args: { text: tt('mtrack.followTitle.text'), start, duration } }], 'Add text');
    const id = r?.results[0]?.output?.clipId as string | undefined;
    if (!id) return;
    const f = await editor.commit([{ op: 'set_clip_follow', args: { clipId: id, follow: { motionTrackId: track.id, targetTrackId: videoTrackId, scale: false, smooth: 0 }, offset: { x: 0, y: -0.08 } } }], 'Follow motion');
    if (f) editor.select(id);
  };

  const counts = TRACK_STATES.filter((s) => summary.counts[s] > 0);
  const shown = summary.problems.slice(0, PROBLEMS_SHOWN);
  return (
    <li className="mtrack-item" data-testid={ID.item} data-motion-track-id={track.id} data-kind={track.kind} data-active={active || undefined}>
      <div className="mtrack-head">
        <span className="mtrack-name" dir="auto">{track.name}</span>
        <span className="badge">{tt(track.kind === 'point' ? 'mtrack.kind.point' : 'mtrack.kind.region')}</span>
        {track.origin.edited && <span className="badge">{tt('mtrack.edited')}</span>}
        <InlineRename value={track.name} label={tt('mtrack.rename')} testid={ID.rename} onCommit={(name) => void editor.commit([{ op: 'edit_motion_track', args: { motionTrackId: track.id, name: name.slice(0, 80) } }], 'Rename motion track')} />
      </div>
      <p className="muted">{summary.samples} {tt('mtrack.sourceFrames')}: <bdi dir="ltr">{stretch(track.from, track.from + summary.samples)}</bdi></p>
      {!tracked ? <p className="muted">{tt('mtrack.notTracked')}</p> : (
        <>
          <ul className="mtrack-counts" aria-label={tt('mtrack.counts')} data-testid={ID.counts} {...Object.fromEntries(TRACK_STATES.map((s) => [`data-${s}`, summary.counts[s]]))}>
            {counts.map((s) => <li key={s}>{stateName(lang, s)}: <bdi>{summary.counts[s]}</bdi></li>)}
          </ul>
          <p className="muted">{tt('mtrack.method')}: <bdi dir="ltr">{track.origin.method}</bdi></p>
        </>
      )}
      {tracked && (
        <div>
          <strong className="muted">{tt('mtrack.problems')}</strong>
          {summary.problems.length === 0 ? <p className="muted">{tt('mtrack.problems.none')}</p> : (
            <ul className="mtrack-problems" aria-label={tt('mtrack.problems')}>
              {shown.map((p) => (
                <li key={`${p.from}:${p.state}`} data-testid={ID.problem} data-from={p.from} data-to={p.to} data-state={p.state}>
                  <span>{stateName(lang, p.state)} · {tt('mtrack.sourceFrames')} <bdi dir="ltr">{stretch(p.from, p.to)}</bdi></span>
                  <button type="button" className="ghost" data-testid={ID.jump} aria-label={`${tt('mtrack.jump')}: ${stateName(lang, p.state)} ${stretch(p.from, p.to)}`} onClick={() => jump(p.from, p.to)}>{tt('mtrack.jump')}</button>
                </li>
              ))}
              {summary.problems.length > shown.length && <li className="muted">+<bdi>{summary.problems.length - shown.length}</bdi></li>}
            </ul>
          )}
        </div>
      )}
      {open ? (
        <div className="row" style={{ alignItems: 'center' }}>
          <div className="mtrack-bar" role="progressbar" aria-label={tt('mtrack.progress')} aria-valuemin={0} aria-valuemax={100}
            {...(progress.percent !== null ? { 'aria-valuenow': progress.percent } : {})} aria-valuetext={stage} data-testid={ID.progress} data-indeterminate={progress.percent === null || undefined}>
            <span style={{ inlineSize: `${progress.percent ?? 30}%` }} />
          </div>
          <span className="muted"><bdi>{stage}</bdi></span>
          <button type="button" className="ghost danger" data-testid={ID.stop} disabled={job?.status === 'cancel-requested'} onClick={stop}>{tt('mtrack.stop')}</button>
        </div>
      ) : (
        <div className="row">
          <button type="button" className="primary" data-testid={ID.run} onClick={() => void run(false)}>{tt(tracked ? 'mtrack.retrack' : 'mtrack.track')}</button>
          <button type="button" className="ghost" data-testid={ID.followTitle} onClick={() => void followTitle()}>{tt('mtrack.followTitle')}</button>
        </div>
      )}
      {overwrite && (
        <div className="fields">
          <p className="tracking-msg" role="alert">{tt('mtrack.overwrite')}</p>
          <div className="row"><button type="button" className="ghost" data-testid={ID.overwrite} onClick={() => void run(true)}>{tt('mtrack.overwriteGo')}</button></div>
        </div>
      )}
      <p className={`tracking-msg${job?.status === 'failed' ? ' danger' : ''}`} role="status" data-testid={ID.jobStatus} data-status={job?.status}>
        {job?.status === 'succeeded' ? tt('mtrack.done') : job?.status === 'canceled' ? tt('mtrack.canceled') : job?.status === 'failed' ? `${tt('mtrack.failed')}: ${refusalText(lang, new ApiFailure(0, job.error?.code ?? 'failed', job.error?.message ?? ''))}` : ''}
      </p>
      {err && <p className="tracking-msg danger" role="alert" data-testid={ID.error}>{err}</p>}
      {usedBy > 0 && <p className="muted">{tt('mtrack.usedBy')}: <bdi>{usedBy}</bdi></p>}
      {asking && removal.confirm ? (
        <div className="fields" role="alertdialog" aria-labelledby={`${track.id}-ask`} data-testid={ID.removeAsk} data-regions={removal.regions}>
          <p className="tracking-msg danger" id={`${track.id}-ask`}>{removeRegionsQuestion(lang, removal)}</p>
          <div className="row">
            <button type="button" className="ghost danger" data-testid={ID.removeConfirm} onClick={() => remove(true)}>{tt('mtrack.deleteRegionsGo')}</button>
            <button type="button" className="ghost" data-testid={ID.removeKeep} autoFocus onClick={() => setAsking(false)}>{tt('mtrack.deleteKeep')}</button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button type="button" className="ghost danger" data-testid={removal.confirm ? ID.removeRegions : removal.unbind ? ID.removeUnbind : ID.remove} onClick={() => remove()}>
            {tt(removal.confirm ? 'mtrack.deleteRegions' : removal.unbind ? 'mtrack.deleteUnbind' : 'mtrack.delete')}
          </button>
        </div>
      )}
    </li>
  );
}
