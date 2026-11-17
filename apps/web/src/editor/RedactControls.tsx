/**
 * Privacy regions of a video clip (ADR-0015): add one that follows a motion track of the clip's file, or a fixed one; its
 * shape, style (blur, pixelate, full cover), strength, margin, soft edges, cover colour, and what happens when tracking is
 * lost. The regions are drawn on each picture of the clip before its effects (so echoes and trails are covered as well).
 * While a region follows a track, a status banner says that automatic blur is not guaranteed redaction and how many frames
 * of the clip have weak or lost tracking. It warns and never blocks. Every change is one set_redact_region through Editor.commit.
 */
import { useState } from 'react';
import { findClip, type Clip, type RedactRegion } from '@pulseframe/core';
import { redactUnsureFrames } from './tracking.math.ts';
import { redactWarning, TRACKING_TESTIDS as ID, trackingT, type TrackingKey } from './tracking.strings.ts';
import { useEditorState } from './store.ts';
import './tracking.css';

type MediaClip = Extract<Clip, { type: 'media' }>;
type Patch = Partial<Omit<RedactRegion, 'id'>>;

export function RedactControls() {
  const { editor, state } = useEditorState();
  const sel = editor.selected;
  const doc = state.doc;
  if (!doc || !sel || state.selection.length !== 1 || sel.clip.type !== 'media' || sel.track.kind !== 'video' || !doc.assets[sel.clip.assetId]?.video) return null;
  return <RedactFields key={sel.clip.id} clipId={sel.clip.id} />;
}

function RedactFields({ clipId }: { clipId: string }) {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const tt = trackingT(lang);
  const doc = state.doc!;
  const found = findClip(doc, clipId);
  const clip = found?.clip.type === 'media' ? (found.clip as MediaClip) : null;
  const tracks = clip ? Object.values(doc.motionTracks ?? {}).filter((t) => t.assetId === clip.assetId).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) : [];
  const [source, setSource] = useState<string>(tracks[0]?.id ?? 'fixed');
  if (!clip) return null;
  const locked = !!found?.track.locked;
  const regions = clip.redact ?? [];
  const tracked = regions.some((r) => r.motionTrackId !== null);
  const unsure = tracked ? redactUnsureFrames(doc, clip) : 0;
  const src = source === 'fixed' || tracks.some((t) => t.id === source) ? source : 'fixed';

  const add = () => void editor.commit([{ op: 'set_redact_region', args: { clipId, region: { motionTrackId: src === 'fixed' ? null : src } } }], 'Add privacy region');
  const update = (regionId: string, patch: Patch) => void editor.commit([{ op: 'set_redact_region', args: { clipId, regionId, region: patch } }], 'Privacy region');
  const remove = (regionId: string) => void editor.commit([{ op: 'set_redact_region', args: { clipId, regionId, region: null } }], 'Remove privacy region');

  return (
    <div className="fields" data-testid={ID.redact} data-regions={regions.length}>
      <p className="muted">{tt('redact.note')}</p>
      {tracked && <p className="redact-warning" role="status" data-testid={ID.redactWarning} data-frames={unsure}>{redactWarning(lang, unsure)}</p>}
      <div className="row" style={{ alignItems: 'end' }}>
        <label>{tt('redact.source')}
          <select value={src} disabled={locked} data-testid={ID.redactSource} onChange={(e) => setSource(e.target.value)}>
            {tracks.map((t) => <option key={t.id} value={t.id}>{t.name} ({tt(t.kind === 'point' ? 'mtrack.kind.point' : 'mtrack.kind.region')})</option>)}
            <option value="fixed">{tt('redact.fixed')}</option>
          </select>
        </label>
        <button type="button" className="ghost" disabled={locked || regions.length >= 8} data-testid={ID.redactAdd} onClick={add}>{tt('redact.add')}</button>
      </div>
      {regions.length === 0 ? <p className="muted">{tt('redact.none')}</p> : (
        <ul className="redact-list">
          {regions.map((r, i) => <RegionRow key={r.id} region={r} n={i + 1} tracks={tracks} locked={locked} onChange={(p) => update(r.id, p)} onRemove={() => remove(r.id)} />)}
        </ul>
      )}
    </div>
  );
}

const RANGES: { key: 'strength' | 'pad' | 'feather' | 'x' | 'y' | 'width' | 'height'; label: TrackingKey; min: number; max: number; step: number; testid: string; fixedOnly?: true }[] = [
  { key: 'strength', label: 'redact.strength', min: 0, max: 1, step: 0.05, testid: ID.redactStrength },
  { key: 'pad', label: 'redact.pad', min: 0, max: 1, step: 0.05, testid: ID.redactPad },
  { key: 'feather', label: 'redact.feather', min: 0, max: 0.2, step: 0.01, testid: ID.redactFeather },
  { key: 'x', label: 'redact.x', min: -1, max: 1, step: 0.01, testid: ID.redactX, fixedOnly: true },
  { key: 'y', label: 'redact.y', min: -1, max: 1, step: 0.01, testid: ID.redactY, fixedOnly: true },
  { key: 'width', label: 'redact.width', min: 0.01, max: 2, step: 0.01, testid: ID.redactWidth },
  { key: 'height', label: 'redact.height', min: 0.01, max: 2, step: 0.01, testid: ID.redactHeight },
];

function RegionRow({ region: r, n, tracks, locked, onChange, onRemove }: { region: RedactRegion; n: number; tracks: { id: string; name: string; kind: 'point' | 'region' }[]; locked: boolean; onChange: (p: Patch) => void; onRemove: () => void }) {
  const { state } = useEditorState();
  const tt = trackingT(state.lang);
  const followsRegion = r.motionTrackId !== null && tracks.find((t) => t.id === r.motionTrackId)?.kind === 'region';
  const ranges = RANGES.filter((x) => (!x.fixedOnly || r.motionTrackId === null) && !(followsRegion && (x.key === 'width' || x.key === 'height')));
  const legend = `${tt('redact.region')} ${n}`;
  return (
    <li className="redact-region" data-testid={ID.redactRegion} data-region-id={r.id} data-motion-track-id={r.motionTrackId ?? ''}>
      <fieldset className="fields" style={{ border: 0, padding: 0, margin: 0 }} disabled={locked}>
        <legend>{legend}</legend>
        <label>{tt('redact.source')}
          <select value={r.motionTrackId ?? 'fixed'} data-testid={ID.redactRegionSource} onChange={(e) => onChange({ motionTrackId: e.target.value === 'fixed' ? null : e.target.value })}>
            {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            {r.motionTrackId !== null && !tracks.some((t) => t.id === r.motionTrackId) && <option value={r.motionTrackId}>{r.motionTrackId}</option>}
            <option value="fixed">{tt('redact.fixed')}</option>
          </select>
        </label>
        <label>{tt('redact.style')}
          <select value={r.style} data-testid={ID.redactStyle} onChange={(e) => onChange({ style: e.target.value as RedactRegion['style'] })}>
            <option value="blur">{tt('redact.style.blur')}</option>
            <option value="pixelate">{tt('redact.style.pixelate')}</option>
            <option value="fill">{tt('redact.style.fill')}</option>
          </select>
        </label>
        <label>{tt('redact.shape')}
          <select value={r.shape} data-testid={ID.redactShape} onChange={(e) => onChange({ shape: e.target.value as RedactRegion['shape'] })}>
            <option value="ellipse">{tt('redact.shape.ellipse')}</option>
            <option value="rect">{tt('redact.shape.rect')}</option>
          </select>
        </label>
        {ranges.map((x) => {
          const v = r[x.key];
          const commit = (raw: string) => { const nv = Math.round(Number(raw) * 1000) / 1000; if (Number.isFinite(nv) && nv !== v) onChange({ [x.key]: nv }); };
          return (
            <label key={`${x.key}:${v}`}>{tt(x.label)} <bdi className="val">{+v.toFixed(3)}</bdi>
              <input type="range" min={x.min} max={x.max} step={x.step} defaultValue={v} data-testid={x.testid}
                onPointerUp={(e) => commit(e.currentTarget.value)} onKeyUp={(e) => commit(e.currentTarget.value)} />
            </label>
          );
        })}
        {r.style === 'fill' && (
          <label>{tt('redact.color')}
            <input type="color" value={r.color} data-testid={ID.redactColor} onChange={(e) => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value) && e.target.value !== r.color) onChange({ color: e.target.value }); }} />
          </label>
        )}
        {r.motionTrackId !== null && (
          <>
            <label>{tt('redact.onLoss')}
              <select value={r.onLoss} data-testid={ID.redactOnLoss} onChange={(e) => onChange({ onLoss: e.target.value as RedactRegion['onLoss'] })}>
                <option value="frame">{tt('redact.onLoss.frame')}</option>
                <option value="hold">{tt('redact.onLoss.hold')}</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={r.weakIsLost} data-testid={ID.redactWeak} onChange={(e) => onChange({ weakIsLost: e.target.checked })} />
              {tt('redact.weakIsLost')}
            </label>
          </>
        )}
        <div className="row"><button type="button" className="ghost danger" data-testid={ID.redactRemove} aria-label={`${tt('redact.remove')}: ${legend}`} onClick={onRemove}>{tt('redact.remove')}</button></div>
      </fieldset>
    </li>
  );
}
