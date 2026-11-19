/**
 * Follow a motion track (ADR-0015), for a title or a picture on a video track: choose a track of a file that plays on another
 * video track during the clip, attach it without a jump (the offset that keeps the clip where it is now is worked out with the
 * evaluator's own resolver: Editor.followOffset), scale with the tracked area, smoothing, and detach (the clip stays where it
 * is). Every change is one set_clip_follow through Editor.commit; what is decided is decided when the write's turn comes.
 */
import { useState } from 'react';
import { findClip, isTimeEffect, type Clip, type Follow } from '@pulseframe/core';
import { followCandidates } from './tracking.math.ts';
import { followStateName, TRACKING_TESTIDS as ID, trackingT } from './tracking.strings.ts';
import { useEditorState } from './store.ts';
import './tracking.css';

export function FollowControls() {
  const { editor, state } = useEditorState();
  const sel = editor.selected;
  if (!state.doc || !sel || state.selection.length !== 1) return null;
  const c = sel.clip;
  if (!(c.type === 'text' || (c.type === 'media' && sel.track.kind === 'video'))) return null;
  return <FollowFields key={c.id} clipId={c.id} />;
}

const keyOf = (f: { motionTrackId: string; targetTrackId: string }) => `${f.motionTrackId}|${f.targetTrackId}`;

function FollowFields({ clipId }: { clipId: string }) {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const tt = trackingT(lang);
  const doc = state.doc!;
  const found = findClip(doc, clipId);
  const clip = found?.clip as Exclude<Clip, { type: 'caption' }> | undefined;
  const follow = clip?.follow;
  const candidates = followCandidates(doc, clipId);
  const [choice, setChoice] = useState<string>(follow ? keyOf(follow) : candidates[0] ? keyOf(candidates[0]) : '');
  if (!clip) return null;
  const tracks = doc.sequences[doc.mainSequenceId]!.tracks;
  const first = clip.effects?.find((e) => e.enabled);
  const timeFx = !!first && isTimeEffect(first.type);
  const keyed = !!(clip.keyframes?.x?.length || clip.keyframes?.y?.length);
  const locked = !!found?.track.locked;
  const scale = follow?.scale ?? false;
  const smooth = follow?.smooth ?? 0;
  const motion = follow ? doc.motionTracks?.[follow.motionTrackId] : undefined;
  const shown = follow ? editor.resolvedTransformNow(clip) : null;

  /** Attach (or change) the follow; the offset keeps the clip where it is now on the master frame. */
  const attach = (next: Pick<Follow, 'motionTrackId' | 'targetTrackId'> & Partial<Pick<Follow, 'scale' | 'smooth'>>, label = 'Follow motion') => editor.commit(() => {
    const now = editor.doc ? findClip(editor.doc, clipId)?.clip : undefined;
    if (!now || now.type === 'caption') return null;
    const f: Follow = { motionTrackId: next.motionTrackId, targetTrackId: next.targetTrackId, scale: next.scale ?? now.follow?.scale ?? false, smooth: next.smooth ?? now.follow?.smooth ?? 0 };
    const offset = editor.followOffset(clipId, f);
    return [{ op: 'set_clip_follow', args: { clipId, follow: f, ...(offset ? { offset } : {}) } }];
  }, label);
  /** Detach: the clip stays where the follow had put it (its resolved position becomes its own). */
  const detach = () => editor.commit(() => {
    const d = editor.doc;
    const now = d ? findClip(d, clipId)?.clip : undefined;
    if (!d || !now || now.type === 'caption' || !now.follow) return null;
    const at = editor.layerAt(clipId, editor.timeIn(now), d);
    const t = at?.layer.transform;
    return [{ op: 'set_clip_follow', args: { clipId, follow: null, ...(t ? { offset: { x: Math.max(-4, Math.min(4, t.x)), y: Math.max(-4, Math.min(4, t.y)) } } : {}) } }];
  }, 'Detach from motion');

  const label = (cand: (typeof candidates)[number]) => `${cand.name} (${tt(cand.kind === 'point' ? 'mtrack.kind.point' : 'mtrack.kind.region')}) — ${tracks[cand.targetTrackIndex]?.name ?? ''}`;
  const chosen = candidates.find((x) => keyOf(x) === choice);
  return (
    <div className="fields" data-testid={ID.follow} data-following={follow ? follow.motionTrackId : undefined}>
      {follow && (
        <p className="follow-state" role="status" data-testid={ID.followState} data-state={shown?.follow?.state ?? ''}>
          {tt('follow.attached')}: <bdi dir="auto">{motion?.name ?? follow.motionTrackId}</bdi>
          {!motion ? <> · {tt('follow.missingTrack')}</> : shown?.follow ? <> · {tt('follow.state')}: {followStateName(lang, shown.follow.state)}</> : null}
        </p>
      )}
      {candidates.length === 0 && !follow ? <p className="muted">{tt('follow.none')}</p> : (
        <label>{tt('follow.track')}
          <select value={choice} data-testid={ID.followTrack} disabled={locked} onChange={(e) => {
            setChoice(e.target.value);
            const next = candidates.find((x) => keyOf(x) === e.target.value);
            if (follow && next && keyOf(next) !== keyOf(follow) && !timeFx) void attach(next); // already following: switch at once, still without a jump
          }}>
            {!chosen && <option value="">{tt('follow.pick')}</option>}
            {candidates.map((cand) => <option key={keyOf(cand)} value={keyOf(cand)}>{label(cand)}</option>)}
          </select>
        </label>
      )}
      {timeFx && <p className="muted" data-testid="follow-time-effect">{tt('follow.timeEffect')}</p>}
      {keyed && !follow && <p className="muted">{tt('follow.keyframed')}</p>}
      <div className="row">
        {!follow && <button type="button" className="primary" disabled={!chosen || timeFx || locked} data-testid={ID.followAttach} onClick={() => chosen && void attach(chosen)}>{tt('follow.attach')}</button>}
        {follow && <button type="button" className="ghost" disabled={locked} data-testid={ID.followDetach} onClick={() => void detach()}>{tt('follow.detach')}</button>}
      </div>
      {follow && (
        <>
          <label className="check">
            <input type="checkbox" checked={scale} disabled={locked || !motion} data-testid={ID.followScale} onChange={(e) => void attach({ ...follow, scale: e.target.checked }, 'Follow motion')} />
            {tt('follow.scale')}
          </label>
          <label>{tt('follow.smooth')} <bdi className="val">{smooth}</bdi>
            <input type="range" min={0} max={15} step={1} key={`smooth:${smooth}`} defaultValue={smooth} disabled={locked || !motion} data-testid={ID.followSmooth}
              onPointerUp={(e) => { const v = Number(e.currentTarget.value); if (v !== smooth) void attach({ ...follow, smooth: v }); }}
              onKeyUp={(e) => { const v = Number(e.currentTarget.value); if (v !== smooth) void attach({ ...follow, smooth: v }); }} />
          </label>
          <p className="muted pf-help">{tt('follow.offsetNote')}</p>
        </>
      )}
    </div>
  );
}
