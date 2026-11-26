/**
 * «תא הבדיקה» (wave 8 booth, builder W3): the owner's review dialog. The first screen says «חלק ראשון: 0 מתוך 14» (never a larger total),
 * what the sitting is and how long it takes (an estimate), how to come back after a restart, the computer check and «התחלה». Then the
 * cards, one at a time: keys 1/2/3 answer, R plays again, «הקודם»/«הבא» move. After an answer the next card is drawn in the same render
 * and its play button takes the focus in that render's layout effect (an intent in a ref; never a timer, apps/web/src/deferredFocus.test.ts),
 * and the polite status line says the next title. Everything is reachable and answerable from the keyboard; Escape closes (ds Dialog) and the focus
 * goes back to the rail button. Nothing is asked of the server before the dialog opens, and the dialog exists only in the owner's session
 * (BoothEntry). Answers are saved on the server (owner-review.json); the computer-check rows are kept in this browser.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { BOOTH_CHECKS, BoothCheckRowSchema, type BoothAnswer, type BoothBrowserCheckId, type BoothCheckRow, type BoothItemView, type BoothServerCheckId, type BoothVerdict, type BoothView } from '@pulseframe/core';
import { FlashGuard } from '@pulseframe/engine';
import type { Lang } from '@pulseframe/i18n';
import { Button, Dialog } from '../../ds/index.ts';
import { ApiFailure, api } from '../../api.ts';
import { refusalLine, refusalWords } from '../commandBar/describe.ts';
import { useEditorState } from '../store.ts';
import { BoothCard, type BadPanel } from './BoothCard.tsx';
import type { AudioControl } from './AudioCard.tsx';
import { BoothExportStrip } from './BoothExportStrip.tsx';
import { ReportBox } from './ReportBox.tsx';
import type { BoothAnswerExtras } from './booth.contract.ts';
import { BOOTH_TESTIDS as TID } from './booth.testids.ts';
import {
  answerBody, buildQueue, commandIn, firstPartCounts, hasNotes, HEAVY_CHECKS, isTyping, keyAction, LIGHT_CHECKS, localDay, moreGroups, nextPartIndex, queueCounts,
  answerAllowed, pictureOnlySkip, reportBox, reportInput, rowWords, startIndex, viewQuery, withAnswer, type BoothKeyAction, type QueueEntry,
} from './booth.logic.ts';
import { closeBooth, readRows, readVolume, useBoothOpen, writeRow, writeVolume } from './booth.state.ts';
import { makeSay } from './booth.strings.ts';
import { runBrowserCheck } from './check/browserChecks.ts';
import './booth.css';

/** The ONE guard of a dialog (EffectGallery precedent). It also keeps the times at which a rise of light reached the screen, so the proof reads the guard's own count. */
export class CountingGuard extends FlashGuard {
  riseTimes: number[] = [];
  decided = 0;
  override decide(...a: Parameters<FlashGuard['decide']>): ReturnType<FlashGuard['decide']> { this.decided++; return super.decide(...a); }
  override shown(...a: Parameters<FlashGuard['shown']>): ReturnType<FlashGuard['shown']> { const n = super.shown(...a); if (n) this.riseTimes.push(a[1]); return n; }
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const failureWords = (lang: Lang, e: unknown): string => {
  const f = e as { code?: string; message?: string; hint?: string };
  return refusalLine(lang, refusalWords(lang, e instanceof ApiFailure ? { code: e.code, message: e.message, hint: e.hint ?? null } : { code: f?.code ?? null, message: f?.message ?? (e instanceof Error ? e.message : String(e)), hint: f?.hint ?? null }));
};

export function BoothDialog(): ReactElement {
  const open = useBoothOpen();
  const { state } = useEditorState();
  const say = useMemo(() => makeSay(state.lang), [state.lang]);
  return (
    <Dialog open={open} onClose={closeBooth} title={say('booth.title')} size="lg" closeLabel={say('booth.close')} testId={TID.dialog} className="pf-booth-dialog">
      {open && <Sitting lang={state.lang} />}
    </Dialog>
  );
}

interface SaveProblem { text: string; idx: number; queue: QueueEntry[] }

function Sitting({ lang }: { lang: Lang }): ReactElement {
  const say = useMemo(() => makeSay(lang), [lang]);
  const [view, setView] = useState<BoothView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadTick, setLoadTick] = useState(0);
  const [rows, setRows] = useState(readRows);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [queue, setQueue] = useState<QueueEntry[] | null>(null);
  const [at, setAt] = useState(0);
  const [starting, setStarting] = useState(false);
  const [bad, setBad] = useState<BadPanel | null>(null);
  const [replay, setReplay] = useState(0);
  const [announce, setAnnounce] = useState('');
  const [saveProblem, setSaveProblem] = useState<SaveProblem | null>(null);
  const [names, setNames] = useState<Record<string, number>>({});
  const [volume, setVolume] = useState(readVolume);
  const [copied, setCopied] = useState('');
  const [drawBlockedId, setDrawBlockedId] = useState<string | null>(null);
  const guard = useMemo(() => new CountingGuard(), []);
  const extras = useRef<Record<string, Partial<BoothAnswerExtras>>>({});
  const audioControl = useRef<AudioControl | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  const homeRef = useRef<HTMLHeadingElement>(null);
  const focusIntent = useRef<'card' | 'problem' | 'home' | null>(null);
  const reduced = useMemo(reducedMotion, []);

  // the booth view: asked of the server only now, when the owner opened the dialog, with the adapters the rows found (a picture answer
  // given on another graphics card then reads «נבדק על כרטיס מסך אחר — בדקו כאן»); asked again when a row finds another adapter
  const q = viewQuery(rows);
  const qKey = `${q.browserAdapter ?? ''}\n${q.exportAdapter ?? ''}`;
  useEffect(() => {
    let live = true;
    api.booth(q).then((v) => { if (live) { setView(v); setLoadError(null); } }, (e: unknown) => { if (live) setLoadError(failureWords(lang, e)); });
    return () => { live = false; };
  }, [lang, loadTick, qKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map((view?.items ?? []).map((v) => [v.item.id, v])), [view]);
  const entry = queue?.[at] ?? null;
  const current: BoothItemView | null = entry && entry.t === 'card' ? byId.get(entry.id) ?? null : null;
  const gpuRow = rows['browser-gpu'] ?? null;

  // The focus goes where the next render draws it: one task, no timer.
  useLayoutEffect(() => {
    const k = focusIntent.current;
    if (!k) return;
    if (k === 'problem') {
      const first = cardRef.current?.querySelector<HTMLElement>(`[data-testid="${TID.problem}"] input`);
      if (!first) return;
      first.focus();
    } else if (k === 'home') {
      homeRef.current?.focus();
    } else {
      const c = cardRef.current;
      const target = c?.querySelector<HTMLElement>(`[data-testid="${TID.play}"]`) ?? c?.querySelector<HTMLElement>(`[data-testid="${TID.picturePlay}"]:not([disabled])`) ?? c?.querySelector<HTMLElement>(`[data-testid="${TID.micRecord}"]`) ?? c?.querySelector<HTMLElement>(`[data-testid="${TID.answer}"]`) ?? c?.querySelector<HTMLElement>('h3') ?? c;
      target?.focus();
    }
    focusIntent.current = null;
  });

  // ---- the self-check
  const runCheck = async (id: (typeof BOOTH_CHECKS)[number]['id']): Promise<BoothCheckRow | null> => {
    const def = BOOTH_CHECKS.find((c) => c.id === id)!;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), def.timeoutMs);
    try {
      const raw = def.side === 'browser' ? await runBrowserCheck(id as BoothBrowserCheckId, ac.signal) : await api.runBoothCheck(id as BoothServerCheckId, ac.signal);
      const parsed = BoothCheckRowSchema.safeParse(raw);
      if (!parsed.success || parsed.data.id !== id) { setRowErrors((r) => ({ ...r, [id]: say('page.check.invalid') })); return null; }
      setRows(writeRow(parsed.data));
      setRowErrors((r) => { const { [id]: _drop, ...rest } = r; return rest; });
      return parsed.data;
    } catch (e) {
      if (ac.signal.aborted) { const row: BoothCheckRow = { id, state: 'unknown', code: null, data: {} }; setRows(writeRow(row)); return row; }
      setRowErrors((r) => ({ ...r, [id]: say('page.check.noAnswer', { why: failureWords(lang, e) }) }));
      return null;
    } finally { clearTimeout(timer); }
  };
  const runLight = async () => {
    setRunning('all');
    for (const c of LIGHT_CHECKS) await runCheck(c.id);
    setRunning(null);
    setAnnounce(say('page.check.doneAll'));
  };
  const runHeavy = async (id: (typeof BOOTH_CHECKS)[number]['id']) => { setRunning(id); await runCheck(id); setRunning(null); };
  const copyCommand = async (cmd: string) => {
    try { await navigator.clipboard.writeText(cmd); setCopied(say('page.copied')); } catch { setCopied(say('page.copyFailed')); }
  };

  // ---- the sitting
  const start = async () => {
    if (!view) return;
    setStarting(true);
    const g = gpuRow ?? await runCheck('browser-gpu');
    const q = buildQueue(view.items, g, moreOpen);
    setStarting(false);
    if (!q.length) return;
    setQueue(q); setAt(startIndex(q, view.items)); setBad(null); focusIntent.current = 'card';
  };
  const go = (to: number | null) => {
    setBad(null);
    if (to === null || !queue || to >= queue.length) { setQueue(null); focusIntent.current = 'home'; return; }
    setAt(Math.max(0, to)); focusIntent.current = 'card';
  };
  const titleAt = (q: QueueEntry[], i: number): string => { const e = q[i]; return e?.t === 'windows' ? say('booth.windows.title') : e ? byId.get(e.id)?.item.title[lang] ?? '' : ''; };

  const save = (v: BoothItemView, verdict: BoothVerdict, p?: BadPanel) => {
    if (!queue) return;
    const x = { ...extras.current[v.item.id] };
    const body = answerBody(v, { verdict, ...(p ? { problems: p.problems, note: p.note } : {}), extras: x });
    const here = at, q = queue;
    // advance first, in this render: the next card is drawn and focused by the layout effect, not after the network answers
    setBad(null); setSaveProblem(null);
    if (here + 1 < q.length) { setAt(here + 1); focusIntent.current = 'card'; setAnnounce(say('page.nextIs', { title: titleAt(q, here + 1) })); }
    else { setQueue(null); focusIntent.current = 'home'; setAnnounce(say('page.lastCard')); }
    api.putBoothAnswer(v.item.id, body).then((res) => {
      setView((cur) => (cur ? withAnswer(cur, res.answer as BoothAnswer) : cur));
      setNames((n) => ({ ...n, [v.item.id]: res.namesInNote }));
      if (res.namesInNote > 0) setAnnounce(say('page.names', { n: res.namesInNote }));
    }, (e: unknown) => {
      if (e instanceof ApiFailure && e.code === 'booth_stale_recipe') setLoadTick((t) => t + 1);
      setSaveProblem({ text: say('page.saveFailed', { title: v.item.title[lang], why: failureWords(lang, e) }), idx: here, queue: q });
    });
  };
  const onlySkip = !!current && pictureOnlySkip(current, gpuRow, drawBlockedId === current.item.id);
  const answer = (verdict: BoothVerdict) => {
    if (!current || !answerAllowed(verdict, onlySkip)) return;
    if (verdict === 'bad' && !bad) { setBad({ problems: [], note: '' }); focusIntent.current = 'problem'; return; }
    save(current, verdict, verdict === 'bad' ? bad ?? { problems: [], note: '' } : undefined);
  };
  const again = () => {
    if (current?.item.kind === 'audio') audioControl.current?.restart();
    else setReplay((r) => r + 1);
  };

  // keys by physical code, only inside the dialog, never while typing, never with the «מה לא טוב?» panel open
  const onKey = useRef<(a: BoothKeyAction) => void>(() => undefined);
  onKey.current = (a) => { if (!current || bad) return; if (a === 'again') again(); else answer(a); };
  useEffect(() => {
    if (!queue) return;
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest(`[data-testid="${TID.dialog}"]`) || isTyping(t)) return;
      const a = keyAction(e);
      if (!a) return;
      e.preventDefault();
      onKey.current(a);
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [queue]);

  const setVol = (v: number) => { setVolume(v); writeVolume(v); };
  const onExtras = (id: string) => (x: BoothAnswerExtras) => { extras.current[id] = { ...extras.current[id], ...x }; };
  const onPlayed = (id: string) => (sha: string) => { extras.current[id] = { ...extras.current[id], played: sha }; };

  // ---- the report
  const box = useMemo(() => (view ? reportBox(reportInput(view, rows, localDay(new Date())), say) : null), [view, rows, say]);
  const nameCount = Object.values(names).reduce((a, b) => a + b, 0);

  if (!view) {
    return (
      <div className="pf-booth" data-state={loadError ? 'failed' : 'loading'}>
        {loadError
          ? <><p role="alert" className="pf-booth-warn">{say('page.loadFailed', { why: loadError })}</p><Button onClick={() => setLoadTick((t) => t + 1)}>{say('page.retry')}</Button></>
          : <p role="status">{say('page.loading')}</p>}
      </div>
    );
  }

  const first = firstPartCounts(view.items);
  const exportStripViews = view.items.filter((v) => v.item.exportStrip);
  const live = <p className="pf-booth-live" role="status" aria-live="polite" data-part="live">{announce}</p>;
  const problemBar = saveProblem && (
    <div className="pf-booth-warn" role="alert" data-part="save-problem">
      <span>{saveProblem.text}</span>{' '}
      <Button size="sm" onClick={() => { setQueue(saveProblem.queue); setAt(saveProblem.idx); setSaveProblem(null); focusIntent.current = 'card'; }}>{say('page.backToCard')}</Button>
    </div>
  );

  // ================================================================ the cards
  if (queue && entry) {
    const counts = queueCounts(queue, view.items);
    const nextPart = nextPartIndex(queue, at);
    const cardsBefore = queue.slice(0, at).filter((e) => e.t === 'card').length;
    return (
      <div className="pf-booth" data-mode="cards">
        <div className="pf-booth-bar">
          <Button size="sm" variant="ghost" onClick={() => go(null)}>{say('page.back')}</Button>
          <p role="status" aria-live="polite" className="pf-booth-progress" data-testid={TID.progress}>{say('booth.progress', counts)}</p>
          <Button size="sm" data-testid={TID.skipPart} disabledReason={nextPart === null ? say('page.skipPartNone') : undefined} onClick={() => go(nextPart)}>{say('booth.skipPart')}</Button>
        </div>
        {problemBar}
        {live}
        {entry.t === 'windows'
          ? (
            <section className="pf-booth-card" data-testid={TID.windowsStep} data-step="windows" aria-labelledby="pf-booth-windows-h">
              <h3 id="pf-booth-windows-h" className="pf-booth-title" tabIndex={-1} ref={(n) => { (cardRef as { current: HTMLElement | null }).current = n; }}>{say('booth.windows.title')}</h3>
              <p className="pf-booth-warn">{say('page.windowsNotTried')}</p>
              <p>{say('booth.windows.steps')}</p>
              <p className="pf-booth-note">{say('booth.reopen')}</p>
              <p className="pf-booth-note">{say('page.windowsNext')}</p>
            </section>
          )
          : current && (
            <BoothCard ref={cardRef} lang={lang} say={say} view={current} n={cardsBefore + 1} m={counts.total} replay={replay} browserGpu={gpuRow} guard={guard} reducedMotion={reduced}
              volume={volume} onVolume={setVol} audioControl={audioControl} onPlayed={onPlayed(current.item.id)} onExtras={onExtras(current.item.id)}
              bad={bad} onBad={setBad} onSubmitBad={() => save(current, 'bad', bad ?? undefined)} onCancelBad={() => { setBad(null); focusIntent.current = 'card'; }}
              onAnswer={answer} onAgain={again} names={names[current.item.id] ?? 0}
              drawBlocked={drawBlockedId === current.item.id} onNeedsGpu={(needs) => setDrawBlockedId((cur) => (needs ? current.item.id : cur === current.item.id ? null : cur))} />
          )}
        {/* ONE export strip for the dialog, kept mounted (hidden) when the card is not a transition of the first sitting */}
        <div hidden={!(current?.item.exportStrip)} data-part="export-strip-wrap"><BoothExportStrip lang={lang} views={exportStripViews} exportGpu={rows['export-gpu'] ?? null} onExtras={(id, x) => onExtras(id)(x)} /></div>
        <div className="pf-booth-actions">
          <Button data-testid={TID.prev} disabledReason={at === 0 ? say('page.prevNone') : undefined} onClick={() => go(at - 1)}>{say('booth.prev')}</Button>
          <Button data-testid={TID.next} onClick={() => go(at + 1 < queue.length ? at + 1 : null)}>{at + 1 < queue.length ? say('booth.next') : say('page.nextFinish')}</Button>
        </div>
        <div ref={(n) => { if (n) (n as unknown as { boothGuard?: CountingGuard }).boothGuard = guard; }} data-part="guard" hidden />
      </div>
    );
  }

  // ================================================================ the first screen
  const more = moreGroups(view.items);
  const answeredAny = view.items.some((v) => v.state === 'answered');
  return (
    <div className="pf-booth" data-mode="home">
      <h3 ref={homeRef} tabIndex={-1} className="pf-booth-title">{say('page.firstScreenHeading')}</h3>
      <p role="status" aria-live="polite" className="pf-booth-first" data-testid={TID.progress}>{say('booth.firstPart', first)}</p>
      <p className="pf-booth-note">{say('booth.firstPartMinutes')}</p>
      <p>{say('booth.intro')}</p>
      <p className="pf-booth-note">{say('booth.afterRestart')}</p>
      <p>{say('page.firstScreenNext')}</p>
      {problemBar}
      {live}
      <div className="pf-booth-actions">
        <Button variant="primary" data-testid="booth-start" busy={starting} onClick={() => void start()}>{starting ? say('page.starting') : answeredAny ? say('page.resume') : say('page.start')}</Button>
      </div>

      <section className="pf-booth-check" aria-labelledby="pf-booth-check-h">
        <h3 id="pf-booth-check-h">{say('booth.selfCheck')}</h3>
        <p className="pf-booth-note">{say('booth.selfCheckNote')}</p>
        <div className="pf-booth-actions">
          <Button data-testid={TID.checkRun} data-autofocus busy={running === 'all'} disabledReason={running && running !== 'all' ? say('page.check.heavyBusy') : undefined} onClick={() => void runLight()}>{say('booth.selfCheckRun')}</Button>
          <span className="pf-booth-note" role="status" aria-live="polite" data-part="copied">{copied}</span>
        </div>
        <ul className="pf-booth-rows">
          {BOOTH_CHECKS.map((def) => {
            const row = rows[def.id];
            const w = rowWords(say, def.id, row);
            const busy = running === def.id || (running === 'all' && !def.heavy);
            const cmd = w.next ? commandIn(w.next) : null;
            return (
              <li key={def.id} className="pf-booth-row" data-testid={TID.checkRow} data-check={def.id} data-state={busy ? 'running' : row?.state ?? 'idle'} data-heavy={def.heavy ? 'yes' : 'no'}>
                <strong>{w.title}</strong>{' '}
                <span data-part="state">{busy ? say('page.check.running') : row ? w.state : say('page.check.notRun')}</span>
                {row && w.code && <span data-part="code"> · {w.code}</span>}
                {rowErrors[def.id] && <span className="pf-booth-warn" role="status" data-part="error"> · {rowErrors[def.id]}</span>}
                {row && w.next && <p className="pf-booth-note" data-part="next">{w.next}{cmd && <> <Button size="sm" variant="ghost" data-testid={TID.checkCopy} aria-label={`${say('booth.copyCommand')}: ${cmd}`} onClick={() => void copyCommand(cmd)}>{say('booth.copyCommand')}</Button></>}</p>}
                {def.heavy && (
                  <p className="pf-booth-note">{say('booth.heavyWarning')}{' '}
                    <Button size="sm" data-testid={TID.checkHeavyRun} aria-label={`${say('booth.heavyRun')}: ${w.title}`} busy={running === def.id} disabledReason={running && running !== def.id ? say('page.check.heavyBusy') : undefined} onClick={() => void runHeavy(def.id)}>{say('booth.heavyRun')}</Button></p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {more.length > 0 && (
        <section className="pf-booth-more" aria-labelledby="pf-booth-more-h">
          <h3 id="pf-booth-more-h">{say('page.moreHeading')}</h3>
          <p className="pf-booth-note">{say('booth.moreHelp')}</p>
          <Button data-testid={TID.more} aria-expanded={moreOpen} onClick={() => setMoreOpen((m) => !m)}>{say('booth.more')}</Button>
          {moreOpen && (
            <ul className="pf-booth-rows" data-part="more-groups">
              {more.map((g) => <li key={g.group} data-group={g.group}><strong>{say(`booth.group.${g.group}`)}</strong> · {say('page.moreItems', { n: g.n })} · {say('page.moreAnswered', { done: g.done, n: g.n })}</li>)}
            </ul>
          )}
        </section>
      )}

      {box && <ReportBox say={say} box={box} notes={hasNotes(view.items)} names={nameCount} />}
    </div>
  );
}
