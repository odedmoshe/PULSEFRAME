/**
 * The multicam panel (ADR-0020): a NON-modal region docked beside the viewer (Transport.tsx stage-side slot), so the digit
 * commands pass the shortcut gate. It holds the angle viewer, the tiles (a labelled group of toggle buttons in reading order,
 * RTL tile 1 top-right, each with «בשידור», its shortcut and its level), the «הקלטת החלפות» control with its reaction offset,
 * the speakers table, the auto-switch sheet (a labelled heuristic, with its basis) and the polite live region. Test ids:
 * multicam.testids.ts; chords: multicam.keys.ts; words: multicam.strings.ts and the shared dictionary.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as T from '@pulseframe/time';
import { dictionaries } from '@pulseframe/i18n';
import { decodeEnvelope, fromGroupExact, isDualMono, levelAt, multicamGroups, type LevelEnvelope, type MulticamAngle, type MulticamGroup, type MulticamView, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { api, ApiFailure, type RecipePlanResult } from '../api.ts';
import { Button } from '../ds/index.ts';
import { AngleViewer, LIVE_TILES, ThumbnailTile, useProgramGroupTime } from './AngleViewer.tsx';
import { MulticamSyncDialog } from './MulticamSyncDialog.tsx';
import { MULTICAM_STRINGS, type MulticamStrings } from './multicam.strings.ts';
import { MULTICAM_TESTIDS as ID } from './multicam.testids.ts';
import { pictureAngles } from './multicamSession.ts';
import { useEditorState } from './store.ts';
import './multicam.css';

/** The level meter's range: -60 dBFS (empty) to 0 (full). */
export const METER_FLOOR_DB = -60;
export const meterPercent = (db: number): number => Math.max(0, Math.min(100, Math.round(((db - METER_FLOOR_DB) / -METER_FLOOR_DB) * 100)));

/** The level envelopes of a group's files, asked for once (building one is the server's job and rebuildable): null = not available. */
function useEnvelopes(doc: ProjectDocument | null, group: MulticamGroup | undefined): Map<string, LevelEnvelope | null> {
  const [map, setMap] = useState<Map<string, LevelEnvelope | null>>(new Map());
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (!doc || !group) return;
    let live = true;
    void (async () => {
      for (const a of group.angles) for (const p of a.pieces) {
        const key = `${doc.id}:${p.assetId}`;
        if (asked.current.has(key) || !doc.assets[p.assetId]?.audio) continue;
        asked.current.add(key);
        let env: LevelEnvelope | null = null;
        try {
          let bytes = await api.envelopeBytes(doc.id, p.assetId);
          if (!bytes) { await api.buildEnvelope(doc.id, p.assetId); bytes = await api.envelopeBytes(doc.id, p.assetId); }
          env = bytes ? decodeEnvelope(p.assetId, bytes) : null;
        } catch { env = null; } // an honest "no level" on the tile, never a made-up one
        if (!live) return;
        setMap((m) => new Map(m).set(p.assetId, env));
      }
    })();
    return () => { live = false; };
  }, [doc?.id, group?.id, group?.angles.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return map;
}

/** The level in dBFS of an angle's file at group time `g`, or null when no envelope covers it. */
function angleLevel(doc: ProjectDocument, angle: MulticamAngle, g: T.RationalTime | null, envs: Map<string, LevelEnvelope | null>): number | null {
  if (!g) return null;
  for (const piece of angle.pieces) {
    const env = envs.get(piece.assetId);
    if (!env || !piece.anchors.length) continue;
    try {
      const f = fromGroupExact(piece, g);
      const sec = Number(f.n) / Number(f.d);
      if (sec < 0 || sec > T.toSeconds(doc.assets[piece.assetId]!.duration)) continue;
      return levelAt(env, null, T.rt(Math.round(sec * 1000), 1000));
    } catch { /* unplaced or not built */ }
  }
  return null;
}

function Tiles({ doc, group, lang, onAir, envs }: { doc: ProjectDocument; group: MulticamGroup; lang: 'he' | 'en'; onAir: string | null; envs: Map<string, LevelEnvelope | null> }) {
  const { editor } = useEditorState();
  const S = MULTICAM_STRINGS[lang];
  const gt = useProgramGroupTime();
  const g = gt && gt.groupId === group.id ? gt.g : null;
  const angles = pictureAngles(group);
  return (
    <ul className="mc-tiles" role="group" aria-label={S.tilesLabel} data-testid={ID.tiles}>
      {angles.map((a, i) => {
        const n = i + 1, on = a.id === onAir, db = angleLevel(doc, a, g, envs);
        const dictT = dictionaries[lang];
        return (
          <li key={a.id}>
            <button type="button" className="mc-tile" data-testid={ID.tile} data-angle-id={a.id} data-tile={n} aria-pressed={on}
              aria-keyshortcuts={a.id === group.wideAngleId ? `${n} 0` : `${n}`} aria-label={`${S.tile(n, a.label)}${on ? `, ${dictT['multicam.onAir']}` : ''}`}
              onClick={() => void editor.switchAngle(a.id)}>
              <span className="mc-tile-top">
                <span><span className="mc-tile-n num" aria-hidden="true">{n}</span> <bdi>{a.label}</bdi></span>
                {on && <span className="mc-onair" data-testid={ID.onAir}>{dictT['multicam.onAir']}</span>}
              </span>
              {i >= LIVE_TILES && <ThumbnailTile angle={a} group={group} lang={lang} />}
              {db !== null
                ? <span className="mc-meter" role="meter" aria-label={S.level} aria-valuemin={METER_FLOOR_DB} aria-valuemax={0} aria-valuenow={Math.max(METER_FLOOR_DB, Math.round(db))} aria-valuetext={S.meter(String(Math.round(db)))} data-testid={ID.meter} style={{ ['--mc-level' as string]: `${meterPercent(db)}%` }}><i /></span>
                : <span className="mc-note" data-testid={ID.meter} data-state="none">{S.noMeter}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Recorder({ lang }: { lang: 'he' | 'en' }) {
  const { editor, state } = useEditorState();
  const S = MULTICAM_STRINGS[lang], D = dictionaries[lang];
  const rec = !!state.multicamRec;
  const r = state.multicamReaction ?? 0;
  return (
    <div className="mc-rec">
      <Button variant={rec ? 'danger' : 'secondary'} aria-pressed={rec} data-testid={ID.record} disabledReason={!rec && !editor.multicamProgram() ? S.noProgramHint : undefined}
        onClick={() => void (rec ? editor.stopRecording() : editor.startRecording())}>{rec ? D['multicam.recordStop'] : D['multicam.record']}</Button>
      {rec && <span className="mc-recording" aria-hidden="true">● {S.recordingNow}</span>}
      <label>{S.reaction}
        <input type="number" min={0} max={10} step={1} value={r} data-testid={ID.reaction} aria-valuetext={S.frames(r)} aria-describedby="mc-reaction-hint"
          onChange={(e) => editor.setMulticamReaction(Number(e.target.value))} />
      </label>
      <p className="mc-note" id="mc-reaction-hint">{S.reactionHint}. {S.recordHint}</p>
    </div>
  );
}

interface SpeakerRow { id?: string; label: string; micAngleId: string; channel: number | null; shotAngleId: string | null }
function Speakers({ doc, group, lang }: { doc: ProjectDocument; group: MulticamGroup; lang: 'he' | 'en' }) {
  const { editor } = useEditorState();
  const S = MULTICAM_STRINGS[lang];
  const mics = group.angles.filter((a) => a.kind === 'sound' || doc.assets[a.pieces[0]!.assetId]?.audio);
  const fromGroup = (): SpeakerRow[] => group.speakers.map((s) => ({ id: s.id, label: s.label, micAngleId: s.micAngleId, channel: s.channel, shotAngleId: s.shotAngleId }));
  const [rows, setRows] = useState<SpeakerRow[]>(fromGroup);
  const sig = JSON.stringify(group.speakers);
  useEffect(() => { setRows(fromGroup()); }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (i: number, p: Partial<SpeakerRow>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const save = () => void editor.commit([{ op: 'update_multicam', args: { groupId: group.id, speakers: rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), label: r.label || '?', micAngleId: r.micAngleId, channel: r.channel, shotAngleId: r.shotAngleId })) } }], 'Update multicam group');
  return (
    <section aria-labelledby="mc-spk-h" data-testid={ID.speakers}>
      <h3 id="mc-spk-h">{dictionaries[lang]['multicam.speakers']}</h3>
      {rows.length === 0 ? <p className="mc-note">{S.speakersEmpty}</p> : (
        <table className="mc-table">
          <thead><tr><th scope="col">{S.speakerName}</th><th scope="col">{S.speakerMic}</th><th scope="col">{S.speakerChannel}</th><th scope="col">{S.speakerShot}</th><th scope="col"><span className="pf-sr">{S.removeSpeaker}</span></th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id ?? i} data-testid={ID.speaker} data-speaker-id={r.id}>
                <td><input value={r.label} aria-label={S.speakerName} maxLength={40} onChange={(e) => set(i, { label: e.target.value })} /></td>
                <td><select value={r.micAngleId} aria-label={S.speakerMic} data-testid={ID.speakerMic} onChange={(e) => set(i, { micAngleId: e.target.value })}>{mics.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></td>
                <td><select value={r.channel ?? ''} aria-label={S.speakerChannel} data-testid={ID.speakerChannel} onChange={(e) => set(i, { channel: e.target.value === '' ? null : Number(e.target.value) })}>
                  <option value="">{S.channelMix}</option>{[0, 1, 2, 3].map((c) => <option key={c} value={c}>{S.channelN(c + 1)}</option>)}</select></td>
                <td><select value={r.shotAngleId ?? ''} aria-label={S.speakerShot} data-testid={ID.speakerShot} onChange={(e) => set(i, { shotAngleId: e.target.value || null })}>
                  <option value="">{S.shotWide}</option>{pictureAngles(group).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></td>
                <td><Button size="sm" variant="ghost" onClick={() => setRows((x) => x.filter((_, k) => k !== i))}>{S.removeSpeaker}</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mc-rec">
        <Button size="sm" disabled={rows.length >= 8 || !mics.length} onClick={() => setRows((r) => [...r, { label: '', micAngleId: mics[0]!.id, channel: null, shotAngleId: null }])}>{S.addSpeaker}</Button>
        <Button size="sm" variant="primary" onClick={save}>{S.saveSpeakers}</Button>
      </div>
      <p className="mc-note">{S.speakersNote}</p>
    </section>
  );
}

/** The auto-switch sheet: plan, apply, regenerate through the existing recipe API; a labelled heuristic with its basis. */
function AutoSheet({ group, trackId, lang }: { group: MulticamGroup; trackId: string | null; lang: 'he' | 'en' }) {
  const { editor, state } = useEditorState();
  const S = MULTICAM_STRINGS[lang], D = dictionaries[lang];
  const [plan, setPlan] = useState<RecipePlanResult | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const runId = Object.values(state.doc?.recipeRuns ?? {}).filter((r) => r.recipeId === 'multicam-auto' && r.params.groupId === group.id).at(-1)?.id ?? null;
  const params = useMemo(() => ({ groupId: group.id, ...(trackId ? { trackId } : {}) }), [group.id, trackId]);
  const doc = state.doc;
  const speakers = group.speakers.length;
  const need = speakers < 2 ? S.autoNeedSpeakers : undefined;
  const run = async (f: () => Promise<unknown>, done?: string) => {
    setBusy(true); setMsg(null);
    try { await f(); if (done) setMsg(done); } catch (e) { setMsg(e instanceof ApiFailure && e.code === 'not_built' ? S.autoNotBuilt : `${S.autoFailed}: ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(false); }
  };
  return (
    <details className="mc-sheet" data-testid={ID.auto}>
      <summary>{D['multicam.auto']}</summary>
      <p className="mc-disclaimer" data-testid={ID.autoDisclaimer}>{D['multicam.auto.heuristic']}</p>
      <p className="mc-note">{S.autoIntro}</p>
      <p className="mc-setup" data-testid={ID.diarisation}>{D['multicam.diarisation.notInstalled']}</p>
      <div className="mc-rec">
        <Button disabled={!doc || busy} disabledReason={need} onClick={() => void run(async () => setPlan(await api.planRecipe(doc!.id, 'multicam-auto', params)))}>{S.autoPlan}</Button>
        <Button variant="primary" data-testid={ID.autoApply} disabledReason={need ?? (!plan ? S.autoPlan : undefined)} busy={busy}
          onClick={() => void run(async () => { await api.applyRecipe(doc!.id, 'multicam-auto', params); await editor.load(doc!.id); setPlan(null); }, S.autoDone)}>{S.autoApply}</Button>
        <Button data-testid={ID.autoRegenerate} disabledReason={need ?? (!runId ? S.autoApply : undefined)} busy={busy}
          onClick={() => void run(async () => { await api.regenerateRecipeRun(doc!.id, runId!); await editor.load(doc!.id); }, S.autoDone)}>{S.autoRegenerate}</Button>
      </div>
      {plan && (
        <div>
          <h3>{S.autoStepsTitle}</h3>
          <ol>{plan.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <h3>{S.autoBasis}</h3>
          <ul data-testid={ID.autoBasis}>{plan.basis.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </div>
      )}
      {msg && <p className="mc-note" role="status">{msg}</p>}
    </details>
  );
}

/** One click to centre a recorder whose channels carry different talkers (never applied by itself). */
function DualMono({ doc, group, lang, envs }: { doc: ProjectDocument; group: MulticamGroup; lang: 'he' | 'en'; envs: Map<string, LevelEnvelope | null> }) {
  const { editor } = useEditorState();
  const S = MULTICAM_STRINGS[lang], D = dictionaries[lang];
  const [done, setDone] = useState(false);
  const hits = group.angles.filter((a) => a.kind === 'sound').filter((a) => a.pieces.some((p) => { const e = envs.get(p.assetId); try { return !!e && e.channels.length === 2 && isDualMono(e); } catch { return false; } }));
  if (!hits.length) return null;
  const ops = (): OpCall[] => {
    const out: OpCall[] = [];
    for (const t of doc.sequences[doc.mainSequenceId]?.tracks ?? []) for (const c of t.clips) if (c.type === 'media' && c.multicam?.groupId === group.id && hits.some((a) => a.id === c.multicam!.angleId) && t.kind === 'audio') out.push({ op: 'add_audio_effect', args: { clipId: c.id, type: 'utility.width', params: { stereoWidth: 0 } } });
    return out;
  };
  return (
    <p className="mc-setup" data-testid={ID.dualMono}>{D['multicam.dualMono']}{' '}
      <Button size="sm" data-testid={ID.dualMonoApply} disabled={done || !ops().length} onClick={() => { void editor.commit(ops, 'Centre sound').then(() => setDone(true)); }}>{done ? S.dualMonoDone : D['multicam.dualMonoApply']}</Button></p>
  );
}

export function MulticamPanel() {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const S: MulticamStrings = MULTICAM_STRINGS[lang], D = dictionaries[lang];
  const groups = state.rawDoc ? multicamGroups(state.rawDoc) : [];
  const prog = editor.multicamProgram();
  const [chosen, setChosen] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const groupId = (prog?.groupId ?? chosen ?? groups[0]?.id) ?? null;
  const group = state.doc && groupId ? state.doc.multicam?.[groupId] : undefined;
  const envs = useEnvelopes(state.doc, group);
  const view = editor.viewDoc;
  // the angle on air: the tagged segment of the program track under the playhead, as shown (a recording's projection included)
  const seg = prog && view ? view.sequences[view.mainSequenceId]?.tracks.find((t) => t.id === prog.trackId)?.clips.find((c) => c.type === 'media' && c.multicam && T.lte(c.start, editor.playhead) && T.lt(editor.playhead, T.add(c.start, c.duration))) : undefined;
  const onAir = seg && seg.type === 'media' && seg.multicam?.groupId === groupId ? seg.multicam.angleId : null;
  const angles = group ? pictureAngles(group) : [];
  const live = useMemo(() => angles.slice(0, LIVE_TILES).map((a) => a.id), [angles.map((a) => a.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!groups.length || !group || !state.doc) return null;
  return (
    <aside className="stage-side pf-ds pf-insp pf-force-dark mc-panel" aria-label={D['multicam.title']} data-testid={ID.panel}>
      <div className="mc-head">
        <h2>{D['multicam.title']}</h2>
        <Button size="sm" onClick={() => setSyncOpen(true)}>{S.syncOpen}</Button>
      </div>
      {groups.length > 1 && (
        <label className="mc-note">{S.group}{' '}
          <select value={group.id} data-testid={ID.group} aria-label={S.groupsLabel} onChange={(e) => setChosen(e.target.value)}>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        </label>
      )}
      {!prog && <p className="mc-note" role="status">{S.noProgram}. {S.noProgramHint}</p>}
      <AngleViewer groupId={group.id} lang={lang} liveAngleIds={live} />
      <Tiles doc={state.doc} group={group} lang={lang} onAir={onAir} envs={envs} />
      <Recorder lang={lang} />
      <p className="mc-live" role="status" aria-live="polite" data-testid={ID.live}>{state.multicamLive?.text ?? ''}</p>
      <DualMono doc={state.doc} group={group} lang={lang} envs={envs} />
      <Speakers doc={state.doc} group={group} lang={lang} />
      <AutoSheet group={group} trackId={prog?.trackId ?? null} lang={lang} />
      {syncOpen && <MulticamSyncDialog groupId={group.id} lang={lang} onClose={() => setSyncOpen(false)} />}
    </aside>
  );
}
export type { MulticamView };
