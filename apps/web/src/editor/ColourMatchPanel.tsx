/**
 * «התאמת צבע»: colour match to a reference clip, or automatic colour balance (ADR-0014), in the look panel of a picture clip.
 * The server measures (match_colour as a durable job: stills from scratch documents through the export compositor, never the proxy,
 * the thumbnails or the Scopes canvas) and returns candidate set_colour_grade ops; «החל» commits them as ONE editor.commit, so one
 * undo takes the whole match back. Before, after and reference are still tiles drawn by the shared evaluate + drawGraph on scratch
 * documents (the EffectGallery draft path): never a toggling or blinking comparison (ADR-0009). Nothing here moves or blinks.
 * The reference clip, the choices and the last result are session state of this browser tab, never stored in the project.
 * Disabled, with the reason, where this browser's own graphics adapter check failed (the grade is a WebGPU pass, ADR-0008).
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import * as T from '@pulseframe/time';
import { applyTransaction, findClip, type Clip, type ProjectDocument } from '@pulseframe/core';
import { drawGraph, evaluate } from '@pulseframe/engine';
import { isolateClip } from '@pulseframe/engine/colourMatch.ts';
import { effectParamLabel } from '@pulseframe/i18n';
import { api, type ColourMatch, type ColourMatchRequest, type ColourMatchTarget } from '../api.ts';
import { useEditorState, type Editor } from './store.ts';
import { thumbSize } from './gallery.pick.ts';
import { COLOUR_MATCH_STRINGS, COLOUR_MATCH_TESTIDS as ID, fill, type ColourMatchStrings } from './colourMatch.strings.ts';
import './colourMatch.css';

type PictureClip = Extract<Clip, { type: 'media' }>;
export type Scope = 'clip' | 'track' | 'all';
export type Method = 'match' | 'balance';
type Run =
  | { kind: 'idle' }
  | { kind: 'measuring'; jobId: string }
  | { kind: 'done'; result: ColourMatch }
  | { kind: 'failed'; reason: string }
  | { kind: 'canceled' }
  | { kind: 'applied'; n: number };
interface Session { projectId: string | null; referenceId: string | null; scope: Scope; method: Method; amount: number; run: Run }

// ---- session state of this tab (never stored in the project) ----
let session: Session = { projectId: null, referenceId: null, scope: 'clip', method: 'match', amount: 1, run: { kind: 'idle' } };
const listeners = new Set<() => void>();
const setSession = (patch: Partial<Session>) => { session = { ...session, ...patch }; for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
/** The session for this project: another project starts afresh. */
function useSession(projectId: string | null): Session {
  const s = useSyncExternalStore(subscribe, () => session);
  useEffect(() => { if (projectId && session.projectId !== projectId) { generation++; setSession({ projectId, referenceId: null, run: { kind: 'idle' } }); } }, [projectId]);
  return s;
}
let generation = 0;
/** Start the measurement as a durable job and follow it until it ends (also when the panel is closed meanwhile). */
async function measure(projectId: string, body: ColourMatchRequest) {
  const gen = ++generation;
  try {
    const { jobId } = await api.startColourMatchJob(projectId, body);
    if (gen !== generation) return;
    setSession({ run: { kind: 'measuring', jobId } });
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000));
      if (gen !== generation) return;
      let j: { status: string; output?: { result?: ColourMatch } | null; error?: { message?: string } | null };
      try { j = await api.job(jobId); } catch { continue; } // the next tick asks again
      if (gen !== generation) return;
      if (j.status === 'succeeded' && j.output?.result) { setSession({ run: { kind: 'done', result: j.output.result } }); return; }
      if (j.status === 'failed') { setSession({ run: { kind: 'failed', reason: j.error?.message ?? 'unknown' } }); return; }
      if (j.status === 'canceled') { setSession({ run: { kind: 'canceled' } }); return; }
    }
  } catch (e) {
    if (gen === generation) setSession({ run: { kind: 'failed', reason: e instanceof Error ? e.message : String(e) } });
  }
}
async function cancel() {
  const run = session.run;
  if (run.kind !== 'measuring') return;
  generation++;
  setSession({ run: { kind: 'canceled' } });
  await api.cancelJob(run.jobId).catch(() => undefined);
}

// ---- what is asked (pure; tested in ColourMatchPanel.test.ts) ----
/** Picture clips of the main sequence (media on a video track, a video or image file), by start, then track; on one track when given. */
export function pictureClipIds(doc: ProjectDocument, trackId?: string): string[] {
  const seq = doc.sequences[doc.mainSequenceId]!;
  const out: { id: string; start: T.RationalTime; track: number }[] = [];
  seq.tracks.forEach((t, track) => {
    if (t.kind !== 'video' || (trackId && t.id !== trackId)) return;
    for (const c of t.clips) if (c.type === 'media' && ['video', 'image'].includes(doc.assets[c.assetId]?.kind ?? '')) out.push({ id: c.id, start: c.start, track });
  });
  return out.sort((a, b) => T.cmp(a.start, b.start) || a.track - b.track).map((x) => x.id);
}
export type Blocked = 'needReference' | 'referenceIsTarget' | 'noTargets';
/** The request for the panel's choices, or why there is none. A reference that no longer exists counts as none. */
export function requestFor(doc: ProjectDocument, clipId: string, c: { scope: Scope; method: Method; amount: number; referenceId: string | null }): { request: ColourMatchRequest } | { blocked: Blocked } {
  const ref = c.method === 'match' && c.referenceId && findClip(doc, c.referenceId) ? c.referenceId : null;
  if (c.method === 'match' && !ref) return { blocked: 'needReference' };
  let targets: string[] | 'all';
  if (c.scope === 'all') targets = 'all';
  else if (c.scope === 'clip') {
    if (clipId === ref) return { blocked: 'referenceIsTarget' };
    targets = [clipId];
  } else {
    const track = findClip(doc, clipId)?.track.id;
    targets = track ? pictureClipIds(doc, track).filter((id) => id !== ref) : [];
    if (!targets.length) return { blocked: 'noTargets' };
  }
  const amount = Math.round(Math.min(1, Math.max(0, c.amount)) * 100) / 100;
  return { request: { method: c.method, ...(ref ? { referenceClipId: ref } : {}), targetClipIds: targets, amount, samples: 3 } };
}
/** The scratch documents of a result row's three tiles: the clip as it is, as it would be, and the reference (each alone, the shared isolateClip). */
export function tileDocs(doc: ProjectDocument, target: Pick<ColourMatchTarget, 'clipId' | 'params'>, referenceId: string | null): { before: ProjectDocument; after: ProjectDocument | null; reference: ProjectDocument | null } {
  const before = isolateClip(doc, target.clipId, 'shown');
  let after: ProjectDocument | null = null;
  try {
    // the real op (dropKeyframes so that an animated grade's clip can be shown too, though it is left out of the ops)
    const graded = applyTransaction(doc, [{ op: 'set_colour_grade', args: { clipId: target.clipId, params: { ...target.params }, mode: 'replace', dropKeyframes: true } }], { idSeed: 'cmtile_', actor: 'colour-match-tile' }).doc;
    after = isolateClip(graded, target.clipId, 'shown');
  } catch { /* refused (a locked track): no after tile */ }
  return { before, after, reference: referenceId && findClip(doc, referenceId) ? isolateClip(doc, referenceId, 'shown') : null };
}
const verdictWord = (S: ColourMatchStrings, v: ColourMatchTarget['verdict']) => (v === 'close' ? S.verdictClose : v === 'noticeable' ? S.verdictNoticeable : S.verdictPartial);
const WARNING_WORD = { changes_within_clip: 'warnChanges', not_verified: 'warnNotVerified', replaces_grade: 'warnReplaces', animated_grade: 'warnAnimated' } as const;
const nameOf = (doc: ProjectDocument, clipId: string) => { const c = findClip(doc, clipId)?.clip; return c?.type === 'media' ? doc.assets[c.assetId]?.name ?? clipId : clipId; };

// ---- still tiles: one drawGraph at a time, drawn once ----
let drawing: Promise<unknown> = Promise.resolve();
const TILE_LONG_SIDE = 112;
function Tile({ doc, clipId, label, editor }: { doc: ProjectDocument | null; clipId: string; label: string; editor: Editor }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'drawing' | 'drawn' | 'missing'>('drawing');
  const [tw, th] = thumbSize(doc?.settings.width ?? 16, doc?.settings.height ?? 9, TILE_LONG_SIDE);
  useEffect(() => {
    const canvas = ref.current, frames = editor.pool?.draftFrames;
    if (!doc || !canvas || !frames) { setState('missing'); return; }
    let dead = false;
    drawing = drawing.then(async () => {
      if (dead) return;
      try {
        const clip = findClip(doc, clipId)!.clip, rate = doc.settings.frameRate;
        const frame = T.nearestFrameIndex(clip.start, rate) + Math.floor(Math.max(1, T.frameCount(clip.duration, rate)) / 2);
        const g = evaluate(doc, T.frameTime(frame, rate));
        const r = await drawGraph(canvas.getContext('2d')!, { ...g, width: tw, height: th }, frames);
        if (!dead) setState(r.missing.length || r.unavailableEffects.length ? 'missing' : 'drawn');
      } catch { if (!dead) setState('missing'); }
    });
    return () => { dead = true; };
  }, [doc, clipId, editor, tw, th]);
  return (
    <figure className="cm-tile" data-testid={ID.tile} data-state={state}>
      <canvas ref={ref} width={tw} height={th} role="img" aria-label={label} />
      {state === 'missing' && <figcaption className="muted">{label}</figcaption>}
    </figure>
  );
}

function ResultRow({ doc, target, referenceId, S, lang, editor }: { doc: ProjectDocument; target: ColourMatchTarget; referenceId: string | null; S: ColourMatchStrings; lang: 'he' | 'en'; editor: Editor }) {
  const [docs] = useState(() => { try { return tileDocs(doc, target, referenceId); } catch { return null; } });
  const name = nameOf(doc, target.clipId), refName = referenceId ? nameOf(doc, referenceId) : '';
  const n = (v: number) => <bdi dir="ltr">{v.toFixed(1)}</bdi>;
  const [lead, tail] = (target.residual.verified !== null ? S.residual : S.residualModel).split('{n}');
  return (
    <tr data-testid={ID.row} data-clip-id={target.clipId} data-verdict={target.verdict}>
      <th scope="row"><bdi>{name}</bdi></th>
      <td><Tile doc={docs?.before ?? null} clipId={target.clipId} label={fill(S.tileBefore, { name })} editor={editor} /></td>
      <td><Tile doc={docs?.after ?? null} clipId={target.clipId} label={fill(S.tileAfter, { name })} editor={editor} /></td>
      <td>{referenceId ? <Tile doc={docs?.reference ?? null} clipId={referenceId} label={fill(S.tileReference, { name: refName })} editor={editor} /> : <span className="muted">{S.tileNone}</span>}</td>
      <td className="cm-result">
        <strong>{verdictWord(S, target.verdict)}</strong>
        <span>{lead}{n(target.residual.verified ?? target.residual.model)}{tail}</span>
        {target.limitedBy.length > 0 && (
          <ul className="cm-chips">{target.limitedBy.map((k) => <li key={k} className="cm-chip">{fill(S.limit, { name: effectParamLabel(k, lang, 'color.grade') })}</li>)}</ul>
        )}
        {target.warnings.length > 0 && <ul className="cm-warnings">{target.warnings.map((w) => <li key={w}>{S[WARNING_WORD[w]]}</li>)}</ul>}
      </td>
    </tr>
  );
}

export function ColourMatchPanel({ clip }: { clip: PictureClip }) {
  const { editor, state } = useEditorState();
  const doc = state.doc;
  const s = useSession(doc?.id ?? null);
  const lang = state.lang, S: ColourMatchStrings = COLOUR_MATCH_STRINGS[lang];
  const headingId = useId(), noteId = useId(), scopeName = useId(), methodName = useId();
  const [busy, setBusy] = useState(false);
  if (!doc) return null;
  const gpu = state.gpu, gpuOk = !!gpu?.available;
  const referenceId = s.referenceId && findClip(doc, s.referenceId) ? s.referenceId : null;
  const ask = requestFor(doc, clip.id, s);
  const blocked = 'blocked' in ask ? ask.blocked : null;
  const measuring = s.run.kind === 'measuring';
  const result = s.run.kind === 'done' ? s.run.result : null;
  const stale = !!result && result.revision !== state.revision;
  const apply = async () => {
    if (!result || stale || busy || !result.ops.length) return;
    setBusy(true);
    try {
      const r = await editor.commit(result.ops, S.title);
      if (r) setSession({ run: { kind: 'applied', n: result.ops.length } });
    } finally { setBusy(false); }
  };
  const radio = <V extends string>(name: string, group: string, value: V, current: V, label: string, set: (v: V) => void) => (
    <label key={value} className="cm-radio">
      <input type="radio" name={name} value={value} checked={current === value} disabled={measuring} onChange={() => set(value)} data-testid={`${group}-${value}`} />
      {label}
    </label>
  );
  return (
    <section className="cm" data-testid={ID.panel} aria-labelledby={headingId} data-state={!gpuOk ? 'unavailable' : s.run.kind}>
      <h4 id={headingId}>{S.title} <span className="cm-badge" data-testid={ID.unlooked}>{S.unlooked}</span></h4>
      <p className="muted pf-help" id={noteId}>{S.intro} {S.statsNote}</p>
      {!gpuOk && (
        <p className="muted danger" role="status" data-testid={ID.unavailable}>
          {gpu ? <>{S.unavailable} <bdi>{gpu.reason}</bdi></> : S.gpuChecking}
        </p>
      )}
      <div className="cm-reference">
        <span data-testid={ID.reference}>{referenceId === clip.id ? S.referenceThis : referenceId ? <>{S.referenceIs.split('{name}')[0]}<bdi>{nameOf(doc, referenceId)}</bdi>{S.referenceIs.split('{name}')[1]}</> : S.referenceNone}</span>
        <button type="button" data-testid={ID.setReference} disabled={referenceId === clip.id || measuring} onClick={() => setSession({ referenceId: clip.id, method: 'match' })}>{S.setReference}</button>
      </div>
      <fieldset className="cm-group" data-testid={ID.method}>
        <legend>{S.method}</legend>
        {radio(methodName, ID.method, 'match', s.method, S.methodMatch, (v: Method) => setSession({ method: v }))}
        {radio(methodName, ID.method, 'balance', s.method, S.methodBalance, (v: Method) => setSession({ method: v }))}
      </fieldset>
      <fieldset className="cm-group" data-testid={ID.scope}>
        <legend>{S.scope}</legend>
        {radio(scopeName, ID.scope, 'clip', s.scope, S.scopeClip, (v: Scope) => setSession({ scope: v }))}
        {radio(scopeName, ID.scope, 'track', s.scope, S.scopeTrack, (v: Scope) => setSession({ scope: v }))}
        {radio(scopeName, ID.scope, 'all', s.scope, S.scopeAll, (v: Scope) => setSession({ scope: v }))}
      </fieldset>
      <label className="cm-amount">
        <span>{S.amount} <bdi dir="ltr">{Math.round(s.amount * 100)}%</bdi></span>
        <input type="range" min={0} max={1} step={0.05} value={s.amount} disabled={measuring} data-testid={ID.amount} aria-valuetext={fill(S.amountValue, { n: Math.round(s.amount * 100) })} onChange={(e) => setSession({ amount: Number(e.target.value) })} />
      </label>
      {blocked && <p className="muted" data-testid={`${ID.measure}-blocked`}>{S[blocked]}</p>}
      <div className="cm-actions">
        <button type="button" className="primary" data-testid={ID.measure} disabled={!gpuOk || !!blocked || measuring} aria-describedby={noteId}
          onClick={() => { if ('request' in ask) void measure(doc.id, ask.request); }}>{S.measure}</button>
        {measuring && <button type="button" className="ghost" data-testid={ID.cancel} onClick={() => void cancel()}>{S.cancel}</button>}
      </div>
      <p role="status" aria-live="polite" className="cm-status" data-testid={ID.progress}>
        {measuring ? S.measuring : s.run.kind === 'failed' ? <>{S.failed.split('{reason}')[0]}<bdi>{s.run.reason}</bdi></> : s.run.kind === 'canceled' ? S.canceled : s.run.kind === 'applied' ? fill(S.applied, { n: s.run.n }) : ''}
      </p>
      {result && (
        <>
          {result.unavailable && <p className="muted" data-testid={ID.status}>{S.unverified.split('{reason}')[0]}<bdi>{result.unavailable}</bdi></p>}
          <table className="cm-results" data-testid={ID.results}>
            <caption>{S.resultsCaption}</caption>
            <thead><tr><th scope="col">{S.colClip}</th><th scope="col">{S.colBefore}</th><th scope="col">{S.colAfter}</th><th scope="col">{S.colReference}</th><th scope="col">{S.colResult}</th></tr></thead>
            <tbody>{result.targets.map((t) => <ResultRow key={`${result.revision}:${t.clipId}`} doc={doc} target={t} referenceId={result.reference?.clipId ?? null} S={S} lang={lang} editor={editor} />)}</tbody>
          </table>
          {stale && <p className="muted danger" role="status">{S.stale}</p>}
          <button type="button" className="primary" data-testid={ID.apply} disabled={!gpuOk || stale || busy || !result.ops.length} onClick={() => void apply()}>
            {result.ops.length ? fill(S.applyN, { n: result.ops.length }) : S.applyNone}
          </button>
        </>
      )}
    </section>
  );
}
