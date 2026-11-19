/**
 * The library entry «סנכרון וחיתוך» (ADR-0020): with 2–9 files chosen in the media library (the checkboxes of MediaGrid) it chains
 * create_multicam, the sync job (polled), a review stop (MULTICAM_TESTIDS.reviewStop) whenever a MEASURED file is not
 * 'confident' (the reference and a hand-synced file do not count; wave4-decisions.md), then place_multicam, all through the usual
 * commit path. Each file is its own angle. A family event filmed by several phones shows each file's capture-time prior in the
 * sync review (the dialog). The selection is session state of this browser; the project holds nothing until the chain starts.
 */
import { useState, useSyncExternalStore } from 'react';
import * as T from '@pulseframe/time';
import { dictionaries } from '@pulseframe/i18n';
import type { MulticamView, PlaceMulticamOutput, CreateMulticamOutput } from '@pulseframe/core';
import { api, ApiFailure } from '../api.ts';
import { Button } from '../ds/index.ts';
import { MulticamSyncDialog } from './MulticamSyncDialog.tsx';
import { MULTICAM_STRINGS } from './multicam.strings.ts';
import { MULTICAM_TESTIDS as ID } from './multicam.testids.ts';
import { useEditorState } from './store.ts';
import './multicam.css';

// ---- the library selection: a tiny external store shared by the cards (MediaLibrary.tsx) and this entry ----
let picks: readonly string[] = [];
const listeners = new Set<() => void>();
const emit = (next: readonly string[]) => { picks = next; for (const l of listeners) l(); };
export const togglePick = (assetId: string): void => emit(picks.includes(assetId) ? picks.filter((x) => x !== assetId) : [...picks, assetId]);
export const clearPicks = (): void => emit([]);
export const usePicks = (): readonly string[] => useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => picks);

export const MIN_FILES = 2, MAX_FILES = 9;
/** The files a verdict list stops the chain for: measured pieces that are not confident (the reference and hand-synced files are excluded). */
export function needsReview(view: Pick<MulticamView, 'group'>): { angleId: string; pieceIndex: number; verdict: string }[] {
  const out: { angleId: string; pieceIndex: number; verdict: string }[] = [];
  for (const a of view.group.angles) a.pieces.forEach((p, i) => { const v = p.quality.verdict; if (v !== 'reference' && v !== 'manual' && v !== 'confident') out.push({ angleId: a.id, pieceIndex: i, verdict: v }); });
  return out;
}

type Step = 'idle' | 'create' | 'sync' | 'review' | 'place' | 'done' | 'failed';
export interface MulticamLibraryEntryProps { lang: 'he' | 'en' }
export function MulticamLibraryEntry({ lang }: MulticamLibraryEntryProps) {
  const { editor, state } = useEditorState();
  const S = MULTICAM_STRINGS[lang], D = dictionaries[lang] as Record<string, string>;
  const chosen = usePicks();
  const doc = state.doc;
  const files = chosen.filter((id) => doc?.assets[id]);
  const [step, setStep] = useState<Step>('idle');
  const [detail, setDetail] = useState<string>('');
  const [made, setMade] = useState<{ groupId: string; view: MulticamView } | null>(null);
  const [dialog, setDialog] = useState(false);
  if (!doc || (files.length === 0 && step === 'idle')) return null;
  const busy = step === 'create' || step === 'sync' || step === 'place';
  const reason = files.length < MIN_FILES ? S.libNeed : files.length > MAX_FILES ? S.libTooMany : undefined;

  const fail = (why: string) => { setStep('failed'); setDetail(S.stepFailed(why)); };
  const place = async (groupId: string, view: MulticamView) => {
    setStep('place');
    const g = view.group;
    // the program's picture: the first picture angle that is placed in group time (the reference when it is a camera)
    const pic = g.angles.find((a) => a.kind === 'picture' && a.pieces.some((p) => p.anchors.length > 0));
    if (!pic) { fail(D['multicam.verdict.unsynced']!); return; }
    const r = await editor.commit([{ op: 'place_multicam', args: { groupId, at: T.ZERO, angleId: pic.id } }], 'Place multicam program');
    const out = r?.results[0]?.output as PlaceMulticamOutput | undefined;
    if (!r || !out) { fail(editor.getState().error ?? S.syncFailed); return; }
    if (editor.target('video') !== out.videoTrackId) editor.toggleTarget('video', out.videoTrackId); // the digits then work on it at once
    setStep('done'); setDetail(S.stepDone); setMade(null); clearPicks();
  };
  const start = async () => {
    setDetail(''); setStep('create');
    try {
      const c = await editor.commit([{ op: 'create_multicam', args: { angles: files.map((assetId) => ({ assetIds: [assetId] })) } }], 'Create multicam group');
      const created = c?.results[0]?.output as CreateMulticamOutput | undefined;
      if (!c || !created) { fail(editor.getState().error ?? S.stepCreate); return; }
      setStep('sync');
      const r = await api.multicamSync(doc.id, created.groupId, { background: true });
      if ('jobId' in r) {
        for (;;) {
          const j = await api.job(r.jobId);
          if (j.stage) setDetail(j.stage);
          if (j.status === 'succeeded') break;
          if (j.status === 'failed' || j.status === 'canceled') throw new ApiFailure(409, j.error?.code ?? j.status, j.error?.message ?? S.syncFailed);
          await new Promise((res) => setTimeout(res, 600));
        }
      }
      await editor.load(doc.id);
      const view = await api.multicamView(doc.id, created.groupId);
      setMade({ groupId: created.groupId, view });
      if (needsReview(view).length) { setStep('review'); setDetail(''); return; }
      await place(created.groupId, view);
    } catch (e) { fail(e instanceof ApiFailure && e.code === 'not_built' ? D['multicam.notBuilt']! : e instanceof Error ? e.message : String(e)); }
  };
  const proceed = async () => { if (!made) return; const view = await api.multicamView(doc.id, made.groupId).catch(() => made.view); await place(made.groupId, view); };

  return (
    <section className="mc-entry" aria-label={D['multicam.syncAndCut']} data-testid="multicam-entry">
      {step === 'idle' || step === 'failed' || step === 'done' ? (
        <>
          <p className="mc-note" role="status">{files.length ? S.libCount(files.length) : ''} {files.length ? '' : S.libHint}</p>
          <div className="mc-rec">
            <Button variant="primary" data-testid={ID.syncAndCut} disabledReason={reason} onClick={() => void start()}>{D['multicam.syncAndCut']}</Button>
            {files.length > 0 && <Button size="sm" variant="ghost" onClick={clearPicks}>{S.libClear}</Button>}
          </div>
        </>
      ) : null}
      {busy && (
        <ol className="mc-steps" aria-live="polite" aria-busy="true">
          <li aria-current={step === 'create' ? 'step' : undefined}>{S.stepCreate}</li>
          <li aria-current={step === 'sync' ? 'step' : undefined}>{S.stepSync}{step === 'sync' && detail ? `: ${detail}` : ''}</li>
          <li aria-current={step === 'place' ? 'step' : undefined}>{S.stepPlace}</li>
        </ol>
      )}
      {step === 'review' && made && (
        <div className="mc-sheet" role="group" aria-label={S.stepReview} data-testid={ID.reviewStop}>
          <p>{D['multicam.reviewStop']}</p>
          <ul>{needsReview(made.view).map((r) => { const a = made.view.group.angles.find((x) => x.id === r.angleId)!; return <li key={`${r.angleId}${r.pieceIndex}`}><bdi>{a.label}</bdi>: {D[`multicam.verdict.${r.verdict}`]}</li>; })}</ul>
          <div className="mc-rec">
            <Button onClick={() => setDialog(true)}>{S.reviewSyncDialog}</Button>
            <Button variant="primary" onClick={() => void proceed()}>{S.reviewContinue}</Button>
            <Button variant="ghost" onClick={() => { setStep('idle'); setMade(null); }}>{S.reviewCancel}</Button>
          </div>
        </div>
      )}
      {(step === 'done' || step === 'failed') && detail && <p role="status" className="mc-note" data-state={step}>{detail}</p>}
      {dialog && made && <MulticamSyncDialog groupId={made.groupId} lang={lang} onClose={() => { setDialog(false); void api.multicamView(doc.id, made.groupId).then((v) => setMade({ groupId: made.groupId, view: v })).catch(() => {}); }} />}
    </section>
  );
}
