/**
 * The Shorts panel (ADR-0018, W3; inspector tab 'shorts', workspace 'shorts'): four steps — settings, measure, the review list
 * and the plan dialog — then «צור N קטעים» as ONE undoable step (POST /projects/:id/shorts), and the list of built shorts
 * (open, rebuild, export with sequenceId, delete). The score is shown with its rank and explanation and labelled
 * «ציון יחסי בתוך הסרטון הזה (היוריסטיקה)» (i18n shorts.score.label); never "viral", never a prediction. Platform fields
 * without a dated source read «לא אומת». Helpers: shorts.view.ts; strings: shorts.strings.ts and i18n shorts.*; test ids:
 * shorts.testids.ts. Nothing here invents a result: candidates, scores and plans are what the server answered.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as T from '@pulseframe/time';
import { CAPTION_LOOKS, FORMAT_PROFILES, SCORE_COMPONENTS, sequenceList, transcriptStatements, type BuildShortsBody, type FindShortsBody, type ShortCandidate, type ShortCandidatesView, type ShortsPlanView, type Statement, type Transcript } from '@pulseframe/core';
import { dictionaries, jobStageLabel, translateRefusal, type Key } from '@pulseframe/i18n';
import { api, ApiFailure, type SpeechStatus } from '../api.ts';
import { Button, Chip, Dialog, ProgressBar } from '../ds/index.ts';
import { useEditorState } from './store.ts';
import { SHORTS_STRINGS } from './shorts.strings.ts';
import { SHORTS_TESTIDS as ID } from './shorts.testids.ts';
import { clock, editedClipCount, handleReviewKey, LENGTH_CHIPS, lengthRange, nudgeEdge, rebuildBody, SHORTS_MAX_SELECTED, stamp, toggleSelection, type ReviewEdges, type ReviewKeyAction } from './shorts.view.ts';
import { ConfirmRemoveSequence, focusSequenceTab } from './SequenceSwitcher.tsx';
import { SourceViewer } from './SourceViewer.tsx';
import './shorts.css';

type Loudness = 'project' | 'off' | '-14' | '-16' | '-23';
interface Settings {
  assetId: string; length: number; count: number; context: number; include: string[]; exclude: string[];
  tightenPauses: boolean; tightenFillers: boolean; look: string; profileId: string;
  reframe: 'auto' | 'track' | 'centre' | 'backdrop'; motionTrackId: string; loudness: Loudness;
}
interface Measure { status: 'idle' | 'running' | 'done' | 'failed'; stage: string | null; error: string | null; view: ShortCandidatesView | null }
interface Word { text: string; start: T.RationalTime; end: T.RationalTime }

const DEFAULTS: Omit<Settings, 'assetId'> = { length: 30, count: 10, context: 8, include: [], exclude: [], tightenPauses: false, tightenFillers: false, look: '', profileId: 'vertical-9x16', reframe: 'auto', motionTrackId: '', loudness: 'project' };

/** The words of a transcript with their times (only phrases timed word by word give edges to step on). */
function wordsOf(tr: Transcript | undefined): Word[] {
  if (!tr) return [];
  return tr.segments.flatMap((s) => (s.timing === 'word' ? s.words.map((w) => ({ text: w.text, start: w.start, end: T.add(w.start, w.duration) })) : []));
}
const statementsOf = (tr: Transcript | undefined): Statement[] | null => { if (!tr) return null; try { return transcriptStatements(tr); } catch { return null; } };
const sentence = (lang: 'he' | 'en', e: unknown) => (e instanceof ApiFailure ? translateRefusal(lang, e.message) ?? e.message : e instanceof Error ? e.message : String(e));

export function ShortsPanel() {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const S = SHORTS_STRINGS[lang];
  const t = dictionaries[lang] as Record<string, string>;
  const raw = state.rawDoc;
  const dir = lang === 'he' ? 'rtl' : 'ltr';
  const videos = useMemo(() => (raw ? Object.values(raw.assets).filter((a) => a.kind === 'video') : []), [raw]);
  const [cfg, setCfg] = useState<Settings>({ ...DEFAULTS, assetId: '' });
  const assetId = cfg.assetId && videos.some((v) => v.id === cfg.assetId) ? cfg.assetId : videos[0]?.id ?? '';
  const set = (p: Partial<Settings>) => setCfg((c) => ({ ...c, assetId, ...p }));
  const transcript = raw && assetId && Object.hasOwn(raw.transcripts, assetId) ? raw.transcripts[assetId] : undefined;
  const hasScenes = !!(raw && assetId && Object.hasOwn(raw.analyses, assetId) && raw.analyses[assetId]!.scenes);
  const wordTimed = !!transcript?.segments.some((s) => s.timing === 'word');
  const tracks = useMemo(() => (raw ? Object.values(raw.motionTracks).filter((m) => m.assetId === assetId) : []), [raw, assetId]);

  const [m, setM] = useState<Measure>({ status: 'idle', stage: null, error: null, view: null });
  const [speech, setSpeech] = useState<SpeechStatus | null>(null);
  const [busyStep, setBusyStep] = useState<'transcribe' | 'cuts' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const jobRef = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // ---- review state ----
  const [edges, setEdges] = useState<Record<string, ReviewEdges>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [live, setLive] = useState('');
  const [viewer, setViewer] = useState<{ assetId: string; startAt: T.RationalTime; back: string } | null>(null);
  const statements = useMemo(() => statementsOf(transcript), [transcript]);
  const words = useMemo(() => wordsOf(transcript), [transcript]);

  // ---- plan state ----
  const [plan, setPlan] = useState<{ view: ShortsPlanView; body: Partial<BuildShortsBody> } | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [rebuildNote, setRebuildNote] = useState<Record<string, string>>({});

  if (!raw) return null;
  const pid = raw.id;
  const finderBody = (): Partial<FindShortsBody> & { assetId: string } => ({ assetId, ...lengthRange(cfg.length), count: cfg.count, contextSeconds: cfg.context, include: cfg.include, exclude: cfg.exclude });

  // ---- step 2: measure ----
  const pollJob = async (jobId: string): Promise<ShortCandidatesView> => {
    jobRef.current = jobId;
    for (;;) {
      const j = await api.job(jobId);
      if (alive.current) setM((x) => ({ ...x, stage: j.stage }));
      if (j.status === 'succeeded') return (j.output as { result: ShortCandidatesView }).result;
      if (j.status === 'failed' || j.status === 'canceled') throw new ApiFailure(409, j.error?.code ?? j.status, j.error?.message ?? `measurement ${j.status}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  };
  const measure = async () => {
    if (!assetId) return;
    setM({ status: 'running', stage: null, error: null, view: null });
    setEdges({}); setSelected([]); setLive(''); setPlan(null);
    try {
      const r = await api.findShorts(pid, finderBody());
      const view = 'jobId' in r ? await pollJob(r.jobId) : r;
      if (alive.current) setM({ status: 'done', stage: null, error: null, view });
    } catch (e) {
      if (alive.current) setM({ status: 'failed', stage: null, error: sentence(lang, e), view: null });
    } finally { jobRef.current = null; }
  };
  const cancel = () => { if (jobRef.current) void api.cancelJob(jobRef.current).catch(() => undefined); };
  const askSpeech = () => { if (!speech) void api.speech().then(setSpeech).catch(() => undefined); };
  const transcribe = async () => {
    setNote(null); setBusyStep('transcribe');
    try {
      const sp = speech ?? await api.speech();
      setSpeech(sp);
      if (!sp.transcription.ready) { setNote(S.speechSetup); return; }
      await api.transcribe(pid, assetId, { language: lang });
      setNote(S.transcribing);
    } catch (e) { setNote(sentence(lang, e)); } finally { setBusyStep(null); }
  };
  const findCuts = async () => {
    setNote(null); setBusyStep('cuts');
    try { await api.analyzeAssetJob(pid, assetId, { kind: 'scenes' }); await editor.load(pid); } catch (e) { setNote(sentence(lang, e)); } finally { setBusyStep(null); }
  };

  // ---- step 3: review ----
  const candidates = m.view?.candidates ?? [];
  const edgesOf = (c: ShortCandidate): ReviewEdges => edges[c.id] ?? { start: c.start, end: c.end };
  const onAction = (c: ShortCandidate, a: ReviewKeyAction) => {
    if (a.kind === 'preview') { setViewer({ assetId: c.assetId, startAt: c.context.start, back: c.id }); return; }
    if (a.kind === 'toggle') {
      const r = toggleSelection(selected, c.id);
      setSelected(r.selected);
      setLive(r.capped ? S.capped(SHORTS_MAX_SELECTED) : S.announceSelected(c.rank, r.selected.includes(c.id)));
      return;
    }
    if (!statements || !words.length) { setLive(S.announceNoTranscript); return; }
    const cur = edgesOf(c);
    const next = nudgeEdge(cur, a.edge, a.dir, a.unit, { statements, words, minSeconds: lengthRange(cfg.length).minSeconds });
    const moved = a.edge === 'start' ? !T.eq(next.start, cur.start) : !T.eq(next.end, cur.end);
    if (!moved) { setLive(S.announceLimit(c.rank)); return; }
    setEdges((e) => ({ ...e, [c.id]: next }));
    const at = a.edge === 'start' ? next.start : next.end;
    const w = words.find((x) => T.eq(a.edge === 'start' ? x.start : x.end, at));
    const st = statements.find((x) => T.eq(a.edge === 'start' ? x.start : x.end, at));
    const parts = st ? st.text.split(' ') : [];
    const word = w?.text ?? (a.edge === 'start' ? parts[0] : parts[parts.length - 1]) ?? '';
    setLive((a.edge === 'start' ? S.announceStart : S.announceEnd)(c.rank, stamp(at), word));
  };
  const onListKey = (e: React.KeyboardEvent<HTMLOListElement>) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-candidate-id]');
    if (!row) return;
    // Space and Enter belong to a button inside the row when it has the focus; the brackets work from anywhere in the row
    if ((e.code === 'Space' || e.code === 'Enter') && e.target !== row) return;
    const c = candidates.find((x) => x.id === row.dataset.candidateId);
    if (!c) return;
    handleReviewKey(e, (a) => onAction(c, a));
  };

  // ---- step 4: plan ----
  const body = (): Partial<BuildShortsBody> => {
    const picks = candidates.filter((c) => selected.includes(c.id)).map((c) => {
      const ed = edges[c.id];
      return { ...(ed ? {} : { candidateId: c.id }), assetId: c.assetId, start: (ed ?? c).start, end: (ed ?? c).end };
    });
    const lv = cfg.loudness === 'project' ? 'project' as const : cfg.loudness === 'off' ? null : { target: Number(cfg.loudness), truePeak: -1 };
    return {
      picks, format: { profileId: cfg.profileId }, tighten: { pauses: cfg.tightenPauses, minPauseSeconds: 0.7, fillers: cfg.tightenFillers },
      captions: cfg.look ? { lookId: cfg.look } : null,
      reframe: { source: cfg.reframe, ...(cfg.reframe === 'track' || (cfg.reframe === 'auto' && cfg.motionTrackId) ? { motionTrackId: cfg.motionTrackId || tracks[0]?.id } : {}), framing: 1 },
      loudness: lv,
    } as Partial<BuildShortsBody>;
  };
  const makePlan = async () => {
    if (!selected.length) { setLive(S.planNone); return; }
    setPlanBusy(true); setPlanError(null);
    try {
      const b = body();
      const view = await api.planShorts(pid, b);
      setPlan({ view, body: b });
    } catch (e) { setPlanError(sentence(lang, e)); } finally { setPlanBusy(false); }
  };
  const create = async () => {
    if (!plan) return;
    setCreating(true); setPlanError(null);
    try {
      const r = await api.makeShorts(pid, { ...plan.body, expectedRevision: plan.view.revision });
      await editor.load(pid);
      const first = r.sequenceIds[0];
      if (first) editor.setActiveSequence(first);
      editor.notify({ kind: 'info', title: S.madeNotice(r.sequenceIds.length) });
      // close the dialog first: while it is open the page behind is inert and its cleanup returns the focus to the opener
      setPlan(null); setSelected([]);
      if (first) requestAnimationFrame(() => focusSequenceTab(first));
    } catch (e) { setPlanError(sentence(lang, e)); } finally { setCreating(false); }
  };

  // ---- built shorts ----
  const built = sequenceList(raw).filter((s) => s.origin === 'short');
  const rebuild = async (id: string) => {
    const b = rebuildBody(raw, id);
    if (!b) { setRebuildNote((n) => ({ ...n, [id]: S.rebuildNeedsAsset })); return; }
    setRebuildNote((n) => ({ ...n, [id]: '' }));
    try {
      const view = await api.planShorts(pid, b);
      const r = await api.makeShorts(pid, { ...b, expectedRevision: view.revision });
      await editor.load(pid);
      const first = r.sequenceIds[0];
      if (first) { editor.setActiveSequence(first); focusSequenceTab(first); }
    } catch (e) { setRebuildNote((n) => ({ ...n, [id]: sentence(lang, e) })); }
  };
  const exportShort = async (id: string, format: 'mp4' | 'png') => {
    try { await editor.startExport({ sequenceId: id, ...(format === 'png' ? { format: 'png', frame: state.activeSequenceId === id ? editor.frame : 0 } : {}) }); editor.notify({ kind: 'info', title: S.exported }); } catch (e) { editor.fail(e); }
  };

  const unavailable = (c: ShortCandidate) => c.warnings.includes('no_transcript');
  const noteState = m.view && !transcript;
  return (
    <section className="shorts-panel pf-ds" data-testid={ID.panel} aria-labelledby="shorts-panel-title" dir={dir}>
      <h2 id="shorts-panel-title">{t['shorts.title']}</h2>
      <p className="muted">{S.intro}</p>

      {/* ---- 1. settings ---- */}
      <section className="sh-step" data-testid={ID.step} data-step="settings" aria-labelledby="sh-h-settings">
        <h3 id="sh-h-settings"><bdi dir="ltr">1</bdi> · {S.steps.settings}</h3>
        {videos.length === 0 ? <p className="muted">{S.assetNone}</p> : (
          <div className="fields">
            <label>{S.asset}
              <select value={assetId} onChange={(e) => set({ assetId: e.target.value, motionTrackId: '' })} data-testid={ID.asset}>
                {videos.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <div role="group" aria-label={S.lengthGroup} className="sh-chips">
              {LENGTH_CHIPS.map((s) => <Chip key={s} pressed={cfg.length === s} data-testid={ID.lengthChip} data-seconds={s} aria-label={S.lengthChip(s)} onClick={() => set({ length: s })}><bdi dir="ltr">{s}</bdi></Chip>)}
            </div>
            <p className="muted pf-help">{S.lengthHint}</p>
            <div className="row">
              <label>{S.count}<input type="number" dir="ltr" min={1} max={40} value={cfg.count} onChange={(e) => set({ count: Math.min(40, Math.max(1, Math.round(Number(e.target.value)) || 1)) })} data-testid={ID.count} /></label>
              <label>{S.context}<input type="number" dir="ltr" min={0} max={30} value={cfg.context} onChange={(e) => set({ context: Math.min(30, Math.max(0, Number(e.target.value) || 0)) })} data-testid={ID.context} /></label>
            </div>
            <WordInput label={S.include} hint={S.wordHint} remove={S.removeWord} words={cfg.include} onChange={(w) => set({ include: w })} testId={ID.include} />
            <WordInput label={S.exclude} hint={S.wordHint} remove={S.removeWord} words={cfg.exclude} onChange={(w) => set({ exclude: w })} testId={ID.exclude} />
            <label className="check"><input type="checkbox" checked={cfg.tightenPauses} onChange={(e) => set({ tightenPauses: e.target.checked })} data-testid={ID.tightenPauses} /> {S.tightenPauses}</label>
            <label className="check"><input type="checkbox" checked={cfg.tightenFillers} onChange={(e) => set({ tightenFillers: e.target.checked })} data-testid={ID.tightenFillers} /> {S.tightenFillers}</label>
            <label>{S.captionLook}
              <select value={cfg.look} onChange={(e) => set({ look: e.target.value })} data-testid={ID.captionLook}>
                <option value="">{S.captionNone}</option>
                {CAPTION_LOOKS.map((l) => {
                  const off = l.needsWordTiming && !wordTimed;
                  return <option key={l.id} value={l.id} disabled={off}>{l.name[lang]}{off ? ` — ${S.captionNeedsWords}` : ''}</option>;
                })}
              </select>
            </label>
            {CAPTION_LOOKS.some((l) => l.needsWordTiming) && !wordTimed && <p className="muted pf-help" data-testid="shorts-caption-reason">{S.captionNeedsWordsOff}</p>}
            <label>{S.format}
              <select value={cfg.profileId} onChange={(e) => set({ profileId: e.target.value })} data-testid={ID.format}>
                {FORMAT_PROFILES.map((p) => <option key={p.id} value={p.id}>{p.name[lang]}</option>)}
              </select>
            </label>
            <p className="muted pf-help">{S.platformNote}: <span data-testid={ID.unverified}>{t['shorts.platform.unverified']}</span></p>
            <label>{S.reframe}
              <select value={cfg.reframe} onChange={(e) => set({ reframe: e.target.value as Settings['reframe'] })} data-testid={ID.reframeSource}>
                {(['auto', 'track', 'centre', 'backdrop'] as const).map((s) => (
                  <option key={s} value={s} data-source={s} disabled={s === 'track' && tracks.length === 0}>{t[`reframe.${s}`]}{s === 'track' && tracks.length === 0 ? ` — ${S.motionNone}` : ''}</option>
                ))}
              </select>
            </label>
            <label>{S.motionTrack}
              <select value={cfg.motionTrackId} disabled={tracks.length === 0} onChange={(e) => set({ motionTrackId: e.target.value })} data-testid={ID.motionTrack}>
                <option value="">{tracks.length === 0 ? S.motionNone : t['reframe.auto']}</option>
                {tracks.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
            </label>
            {tracks.length === 0 && <p className="muted pf-help" data-testid={ID.trackingUnavailable}>{t['shorts.trackingUnavailable']}</p>}
            <label>{S.loudness}
              <select value={cfg.loudness} onChange={(e) => set({ loudness: e.target.value as Loudness })} data-testid={ID.loudness}>
                <option value="project">{S.loudnessProject}</option><option value="off">{S.loudnessOff}</option>
                {(['-14', '-16', '-23'] as const).map((x) => <option key={x} value={x}>{`${x} LUFS`}</option>)}
              </select>
            </label>
          </div>
        )}
      </section>

      {/* ---- 2. measure ---- */}
      <section className="sh-step" data-testid={ID.step} data-step="measure" aria-labelledby="sh-h-measure">
        <h3 id="sh-h-measure"><bdi dir="ltr">2</bdi> · {S.steps.measure}</h3>
        {assetId && !transcript && (
          <div className="sh-state" data-testid={ID.noTranscript} role="note">
            <p>{t['shorts.noTranscript']}</p>
            <Button size="sm" variant="secondary" busy={busyStep === 'transcribe'} onClick={() => void transcribe()} onFocus={askSpeech} onMouseEnter={askSpeech} data-testid={ID.transcribe}>{t['shorts.transcribe']}</Button>
            {speech && !speech.transcription.ready && <p className="muted" role="status">{S.speechSetup} <bdi dir="ltr">{speech.transcription.reason ?? ''}</bdi></p>}
          </div>
        )}
        {assetId && !hasScenes && (
          <div className="sh-state" data-testid={ID.noScenes} role="note">
            <p>{t['shorts.noScenes']}</p>
            <Button size="sm" variant="secondary" busy={busyStep === 'cuts'} onClick={() => void findCuts()} data-testid={ID.findCuts}>{t['shorts.findCuts']}</Button>
          </div>
        )}
        {note && <p role="status" className="muted">{note}</p>}
        <div className="row">
          <Button variant="primary" busy={m.status === 'running'} disabled={!assetId} onClick={() => void measure()} data-testid={ID.measure}>{m.status === 'running' ? S.measuring : S.measure}</Button>
          {m.status === 'running' && <Button variant="ghost" onClick={cancel}>{S.cancel}</Button>}
        </div>
        {m.status === 'running' && (
          <div data-testid={ID.progress} className="sh-progress">
            <ProgressBar value={null} label={S.progress} />
            <p className="muted" role="status">{S.progress}{m.stage ? ` · ${jobStageLabel(m.stage, lang)}` : ''}</p>
          </div>
        )}
        {m.status === 'failed' && <p role="alert" className="danger">{S.failed}: {m.error}</p>}
      </section>

      {/* ---- 3. review ---- */}
      <section className="sh-step" data-testid={ID.step} data-step="review" aria-labelledby="sh-h-review">
        <h3 id="sh-h-review"><bdi dir="ltr">3</bdi> · {S.steps.review}</h3>
        {m.status === 'done' && m.view && (
          <>
            <p className="muted pf-help">{t['shorts.score.method']}</p>
            {noteState && <p className="muted">{t['shorts.noTranscript']}</p>}
            {candidates.length === 0 ? <p className="muted">{S.reviewNone}</p> : (
              <>
                <p className="muted pf-help">{S.keysHint}</p>
                <ol className="sh-list" data-testid={ID.list} aria-label={S.reviewTitle} onKeyDown={onListKey}>
                  {candidates.map((c) => (
                    <CandidateRow key={c.id} c={c} lang={lang} edges={edgesOf(c)} edited={!!edges[c.id]} selected={selected.includes(c.id)} warnNoTranscript={unavailable(c)}
                      onPreview={() => setViewer({ assetId: c.assetId, startAt: c.context.start, back: c.id })}
                      onToggle={() => onAction(c, { kind: 'toggle' })} />
                  ))}
                </ol>
              </>
            )}
            <p className="sh-count" aria-hidden="false"><bdi dir="ltr">{S.selectedCount(selected.length, SHORTS_MAX_SELECTED)}</bdi></p>
            {m.view.excluded.length > 0 && (
              <details className="sh-excluded" data-testid={ID.excluded}>
                <summary>{S.excludedTitle} (<bdi dir="ltr">{m.view.excluded.length}</bdi>)</summary>
                <ul>{m.view.excluded.map((x, i) => <li key={i}>{S.excludedWord} <q><bdi dir="auto">{x.word}</bdi></q> {S.excludedAt} <bdi dir="ltr">{stamp(x.at)}</bdi> · <bdi dir="ltr">{stamp(x.start)}–{stamp(x.end)}</bdi></li>)}</ul>
              </details>
            )}
          </>
        )}
        <div className="sr-only" role="status" aria-live="polite" data-testid={ID.live}>{live}</div>
      </section>

      {/* ---- 4. plan ---- */}
      <section className="sh-step" data-testid={ID.step} data-step="plan" aria-labelledby="sh-h-plan">
        <h3 id="sh-h-plan"><bdi dir="ltr">4</bdi> · {S.steps.plan}</h3>
        <Button variant="primary" busy={planBusy} disabledReason={selected.length ? undefined : S.planNone} onClick={() => void makePlan()} data-testid={ID.plan}>{planBusy ? S.planning : S.planButton}</Button>
        {planError && !plan && <p role="alert" className="danger">{planError}</p>}
      </section>

      {/* ---- the built shorts ---- */}
      <section className="sh-step" aria-labelledby="sh-h-built">
        <h3 id="sh-h-built">{S.built}</h3>
        {built.length === 0 ? <p className="muted">{S.builtNone}</p> : (
          <ul className="sh-built" data-testid={ID.built}>
            {built.map((s) => {
              const edited = editedClipCount(raw, s.id);
              return (
                <li key={s.id} data-testid={ID.builtRow} data-sequence-id={s.id}>
                  <strong dir="auto">{s.name}</strong> · <bdi dir="ltr">{clock(s.durationSeconds)}</bdi>
                  <span className="row">
                    <Button size="sm" variant="secondary" onClick={() => { editor.setActiveSequence(s.id); focusSequenceTab(s.id); }} data-testid={ID.open} data-sequence-id={s.id}>{S.open}</Button>
                    <Button size="sm" variant="ghost" onClick={() => void rebuild(s.id)} data-testid={ID.rebuild} data-sequence-id={s.id} aria-describedby={edited ? `sh-edit-${s.id}` : undefined}>{S.rebuild}</Button>
                    <Button size="sm" variant="ghost" onClick={() => void exportShort(s.id, 'mp4')} data-testid={ID.export} data-format="mp4" data-sequence-id={s.id}>{S.exportMp4}</Button>
                    <Button size="sm" variant="ghost" onClick={() => void exportShort(s.id, 'png')} data-testid={ID.export} data-format="png" data-sequence-id={s.id}>{S.exportPng}</Button>
                    <Button size="sm" variant="danger-quiet" onClick={() => setRemoving(s.id)} data-testid={ID.remove} data-sequence-id={s.id}>{S.remove}</Button>
                  </span>
                  {edited > 0 && <p className="muted" id={`sh-edit-${s.id}`} role="note">{S.rebuildWarn(edited)}</p>}
                  {rebuildNote[s.id] && <p role="alert" className="danger">{rebuildNote[s.id]}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ConfirmRemoveSequence sequence={built.find((s) => s.id === removing) ?? null} onClose={() => setRemoving(null)} />
      {viewer && <SourceViewer assetId={viewer.assetId} startAt={viewer.startAt} onClose={() => { const back = viewer.back; setViewer(null); setTimeout(() => document.querySelector<HTMLElement>(`[data-candidate-id="${back}"]`)?.focus(), 0); }} />}
      <Dialog open={!!plan} onClose={() => setPlan(null)} title={S.planTitle} size="lg" closeLabel={lang === 'he' ? 'סגירה' : 'Close'} testId={ID.planDialog}
        footer={plan && <>
          <Button variant="ghost" onClick={() => setPlan(null)}>{S.cancel}</Button>
          <Button variant="primary" busy={creating} onClick={() => void create()} data-testid={ID.create}>{creating ? S.creating : plan.view.shorts.length === 1 ? S.createOne : S.createN(plan.view.shorts.length)}</Button>
        </>}>
        {plan && (
          <div>
            <h4>{S.planSteps}</h4>
            <ol data-testid={ID.planSteps}>{plan.view.steps.map((x, i) => <li key={i} dir="auto">{x}</li>)}</ol>
            <ul className="sh-plan-shorts">
              {plan.view.shorts.map((s, i) => <li key={i}><strong dir="auto">{s.name}</strong> · <bdi dir="ltr">{s.seconds.toFixed(1)}</bdi> {S.planSeconds} · <bdi dir="ltr">{s.pieces}</bdi> {S.planPieces}</li>)}
            </ul>
            <p data-testid={ID.planOps}>{S.planOps}: <bdi dir="ltr">{plan.view.operations}</bdi></p>
            {plan.view.warnings.length > 0 && (
              <div role="group" aria-label={S.planWarnings}>
                <h4>{S.planWarnings}</h4>
                <ul>{plan.view.warnings.map((w, i) => <li key={i} data-testid={ID.planWarning} data-code={w.code}>{t[`shorts.plan.${w.code}`] ?? w.message}</li>)}</ul>
              </div>
            )}
            <p className="muted pf-help">{S.createNote}</p>
            {planError && <p role="alert" className="danger">{planError}</p>}
          </div>
        )}
      </Dialog>
    </section>
  );
}

/** A tag input: type a word, Enter adds it; each added word is a button that removes it. */
function WordInput({ label, hint, remove, words, onChange, testId }: { label: string; hint: string; remove: (w: string) => string; words: string[]; onChange: (w: string[]) => void; testId: string }) {
  const [text, setText] = useState('');
  const add = () => { const w = text.trim().slice(0, 40); if (w && !words.includes(w) && words.length < 20) onChange([...words, w]); setText(''); };
  return (
    <div className="sh-words">
      <label>{label}
        <input type="text" dir="auto" value={text} placeholder={hint} maxLength={40} onChange={(e) => setText(e.target.value)} data-testid={testId}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add(); } }} />
      </label>
      {words.length > 0 && <ul className="sh-tags">{words.map((w) => <li key={w}><button type="button" className="sh-tag" aria-label={remove(w)} onClick={() => onChange(words.filter((x) => x !== w))}><bdi dir="auto">{w}</bdi> ×</button></li>)}</ul>}
    </div>
  );
}

/** One candidate: rank, the first words, the range, the relative score with its explanation, the reasons, the warnings and the selection. */
function CandidateRow({ c, lang, edges, edited, selected, warnNoTranscript, onPreview, onToggle }: {
  c: ShortCandidate; lang: 'he' | 'en'; edges: ReviewEdges; edited: boolean; selected: boolean; warnNoTranscript: boolean; onPreview: () => void; onToggle: () => void;
}) {
  const S = SHORTS_STRINGS[lang];
  const t = dictionaries[lang] as Record<string, string>;
  const [open, setOpen] = useState(false);
  const detailsId = `sh-score-${c.id}`;
  const seconds = T.toSeconds(T.sub(edges.end, edges.start));
  void warnNoTranscript;
  return (
    <li>
      <article tabIndex={0} className={`sh-row${selected ? ' is-selected' : ''}`} data-testid={ID.candidate} data-candidate-id={c.id} data-rank={c.rank} data-selected={selected ? 'true' : 'false'}
        aria-label={`${t['shorts.rank']} ${c.rank}: ${c.firstWords}`}>
        <header className="sh-row-head">
          <span className="sh-rank">{t['shorts.rank']} <bdi dir="ltr">{c.rank}</bdi></span>
          <span className="sh-range"><bdi dir="ltr">{stamp(edges.start)}–{stamp(edges.end)}</bdi> · <bdi dir="ltr">{seconds.toFixed(1)}</bdi> {S.planSeconds}</span>
          {edited && <span className="sh-edited">{S.edited}</span>}
        </header>
        <q dir="auto" className="sh-quote">{c.firstWords}</q>
        <p className="sh-score-line">
          <span data-testid={ID.score}>{S.scoreWord} <bdi dir="ltr">{c.score}</bdi> ({S.heuristic})</span>{' '}
          <button type="button" className="sh-q" aria-expanded={open} aria-controls={detailsId} aria-label={S.moreScore} onClick={() => setOpen((x) => !x)}>?</button>
        </p>
        {open && (
          <div id={detailsId} className="sh-details" data-testid={ID.scoreDetails}>
            <p><strong>{t['shorts.score.label']}</strong></p>
            <p className="muted pf-help">{t['shorts.score.method']}</p>
            <h4>{t['shorts.components']}</h4>
            <ul className="sh-comps">
              {SCORE_COMPONENTS.map((k) => {
                const v = c.components[k];
                return (
                  <li key={k}>
                    <span className="sh-comp-name">{t[`shorts.component.${k}`]}</span>
                    <span className="sh-bar" aria-hidden="true"><i style={{ inlineSize: `${v ?? 0}%` }} /></span>
                    <span className="sh-comp-val">{v === null ? S.missingInput : <><bdi dir="ltr">{Math.round(v)}</bdi> {S.percentile}</>}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {c.reasons.length > 0 && (
          <ul className="sh-reasons" aria-label={t['shorts.reasons']}>
            {c.reasons.map((r, i) => (
              <li key={i} className="sh-chip" data-testid={ID.reason} data-code={r.code} data-sign={r.sign}>
                <span aria-hidden="true">{r.sign === 'plus' ? '+' : r.sign === 'minus' ? '−' : '•'}</span>{' '}
                {t[`shorts.reason.${r.code}`] ?? r.code}
                {r.value !== null && <> <bdi dir="ltr">{Math.round(r.value * 10) / 10}{r.unit ? ` ${r.unit}` : ''}</bdi></>}
                {r.quote && <> <q dir="auto">{r.quote}</q></>}
              </li>
            ))}
          </ul>
        )}
        {c.warnings.length > 0 && (
          <ul className="sh-warns">
            {c.warnings.map((w) => <li key={w} data-testid={ID.warning} data-code={w}><span aria-hidden="true">⚠</span> {t[`shorts.warn.${w}` as Key] ?? w}</li>)}
          </ul>
        )}
        <div className="row sh-row-actions">
          <Button size="sm" variant="ghost" onClick={onPreview} keys={[S.previewKeys]}>{S.preview}</Button>
          <Button size="sm" variant={selected ? 'primary' : 'secondary'} aria-pressed={selected} onClick={onToggle} data-testid={ID.select}>{selected ? `✓ ${S.unselect}` : S.select}</Button>
        </div>
      </article>
    </li>
  );
}
