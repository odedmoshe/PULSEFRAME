/**
 * The sync dialog of a multicam group (ADR-0020; modal): one row per file with its verdict chip IN WORDS (a mark and the verdict's
 * sentence, never colour alone), offset in <bdi dir="ltr">, drift ppm, peak ratio and residual; ±1 frame and ±1 ms spinbuttons
 * with aria-valuetext (set_multicam_sync nudge); the candidates with «בחירה» (set_multicam_sync offset); the capture-time hand
 * choice «לפי שעת הצילום (משוער)» with its uncertainty (never applied by itself); re-sync with the would_discard_edits prompt.
 * Data from GET /projects/:id/multicam/:groupId (core MulticamView).
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import * as T from '@pulseframe/time';
import { dictionaries } from '@pulseframe/i18n';
import type { MulticamPiece, MulticamView, SyncVerdict } from '@pulseframe/core';
import { api, ApiFailure } from '../api.ts';
import { Button, Dialog } from '../ds/index.ts';
import { MULTICAM_STRINGS } from './multicam.strings.ts';
import { MULTICAM_TESTIDS as ID } from './multicam.testids.ts';
import { useEditorState } from './store.ts';
import { assetDisplayName } from './assetLabel.ts';

export interface MulticamSyncDialogProps { groupId: string; lang: 'he' | 'en'; onClose: () => void }

/** A mark that says the verdict without colour (the chip also carries the sentence). */
export const VERDICT_MARK: Record<SyncVerdict, string> = { reference: '◆', confident: '✓', check: '!', ambiguous: '?', 'no-shared-sound': '✕', inconsistent: '✕', manual: '✎', unsynced: '–' };
/** Offset of a placed piece: group time of its source time 0, in seconds; null when it has no anchors. */
export function offsetSeconds(piece: MulticamPiece): number | null {
  const a = piece.anchors[0];
  return a ? T.toSeconds(T.sub(a.group, a.source)) : null;
}
const fmt = (v: number | null, digits: number, unit = '') => (v === null ? '–' : `${v.toFixed(digits)}${unit}`);
const isDiscardRefusal = (e: unknown) => e instanceof ApiFailure && e.status === 409 && (e.code === 'would_discard_edits' || (e.details as { why?: string } | undefined)?.why === 'would_discard_edits' || /hand/i.test(e.message));

/** A spinbutton that nudges by one unit per key press (ArrowUp later, ArrowDown earlier) and shows the running total in words. */
function Nudge({ label, kind, value, onNudge, lang, testId }: { label: string; kind: 'frame' | 'ms'; value: number; onNudge: (by: 1 | -1) => void; lang: 'he' | 'en'; testId: string }) {
  const S = MULTICAM_STRINGS[lang];
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); onNudge(1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); onNudge(-1); }
  };
  return (
    <span className="mc-nudge">
      <Button size="sm" aria-label={`${label}: ${S.nudgeEarlier}`} onClick={() => onNudge(-1)}>−</Button>
      <div role="spinbutton" tabIndex={0} aria-label={label} aria-valuenow={value} aria-valuemin={-100000} aria-valuemax={100000} aria-valuetext={S.nudgeValue(kind, value)} data-testid={testId} onKeyDown={key}>{value > 0 ? `+${value}` : value}</div>
      <Button size="sm" aria-label={`${label}: ${S.nudgeLater}`} onClick={() => onNudge(1)}>+</Button>
    </span>
  );
}

export function MulticamSyncDialog({ groupId, lang, onClose }: MulticamSyncDialogProps) {
  const { editor, state } = useEditorState();
  const S = MULTICAM_STRINGS[lang], D = dictionaries[lang] as Record<string, string>;
  const doc = state.doc;
  const [view, setView] = useState<MulticamView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(false);
  const [nudged, setNudged] = useState<Record<string, { frame: number; ms: number }>>({});
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const pid = doc?.id;
  const reload = useCallback(async () => {
    if (!pid) return;
    try { const v = await api.multicamView(pid, groupId); if (alive.current) { setView(v); setProblem(null); } }
    catch (e) { if (alive.current) setProblem(e instanceof ApiFailure && e.code === 'not_built' ? D['multicam.notBuilt']! : e instanceof Error ? e.message : String(e)); }
  }, [pid, groupId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [reload, state.revision]);

  const rate = editor.rate;
  const edit = async (angleId: string, pieceIndex: number, args: Record<string, unknown>) => {
    await editor.commit([{ op: 'set_multicam_sync', args: { groupId, angleId, pieceIndex, ...args } }], 'Correct angle sync');
    await reload();
  };
  const nudge = (angleId: string, pieceIndex: number, kind: 'frame' | 'ms', by: 1 | -1) => {
    const k = `${angleId}:${pieceIndex}`;
    setNudged((n) => ({ ...n, [k]: { frame: 0, ms: 0, ...n[k], [kind]: (n[k]?.[kind] ?? 0) + by } }));
    const unit = kind === 'frame' ? T.frameTime(1, rate) : T.rt(1, 1000);
    void edit(angleId, pieceIndex, { nudge: by === 1 ? unit : T.sub(T.ZERO, unit) });
  };

  const runSync = async (overwrite: boolean) => {
    if (!pid) return;
    setPrompt(false); setProblem(null); setBusy(S.syncRunning);
    try {
      const r = await api.multicamSync(pid, groupId, { background: true, ...(overwrite ? { overwrite: true } : {}) });
      if ('jobId' in r) {
        for (;;) {
          const j = await api.job(r.jobId);
          if (j.stage && alive.current) setBusy(`${S.syncRunning}: ${j.stage}`);
          if (j.status === 'succeeded') break;
          if (j.status === 'failed' || j.status === 'canceled') throw new ApiFailure(409, j.error?.code ?? j.status, j.error?.message ?? S.syncFailed, j.error);
          await new Promise((res) => setTimeout(res, 600));
        }
      }
      await editor.load(pid);
      await reload();
    } catch (e) {
      if (isDiscardRefusal(e)) setPrompt(true);
      else setProblem(`${S.syncFailed}: ${e instanceof Error ? e.message : String(e)}`);
    } finally { if (alive.current) setBusy(null); }
  };

  const group = view?.group ?? doc?.multicam?.[groupId];
  return (
    <Dialog open title={`${S.syncTitle}: ${group?.name ?? ''}`} onClose={onClose} testId={ID.syncDialog} size="lg" closeLabel={S.close}
      footer={<><Button onClick={() => void runSync(false)} busy={!!busy} data-testid={ID.resync}>{D['multicam.resync']}</Button><Button variant="primary" onClick={onClose}>{S.close}</Button></>}>
      <div className="mc-sync">
        {problem && <p role="alert" className="mc-setup">{problem}</p>}
        {busy && <p role="status" className="mc-note">{busy}</p>}
        {prompt && (
          <div role="alertdialog" aria-label={S.resyncAsk} className="mc-sheet" data-testid={ID.discardPrompt}>
            <p>{S.resyncAsk}</p>
            <div className="mc-rec"><Button variant="danger" onClick={() => void runSync(true)}>{S.resyncDiscard}</Button><Button onClick={() => setPrompt(false)}>{S.resyncKeep}</Button></div>
          </div>
        )}
        {!group && !problem && <p className="mc-note" role="status">{S.loading}</p>}
        {group && (
          <table className="mc-table">
            <thead><tr>
              <th scope="col">{S.syncColumns.file}</th><th scope="col">{S.syncColumns.verdict}</th><th scope="col">{S.syncColumns.offset}</th><th scope="col">{S.syncColumns.drift}</th>
              <th scope="col">{S.syncColumns.peak}</th><th scope="col">{S.syncColumns.residual}</th><th scope="col">{S.nudgeFrame} / {S.nudgeMs}</th>
            </tr></thead>
            <tbody>
              {group.angles.flatMap((a) => a.pieces.map((p, i) => {
                const q = p.quality, off = offsetSeconds(p), key = `${a.id}:${i}`;
                const n = nudged[key] ?? { frame: 0, ms: 0 };
                const asset = doc?.assets[p.assetId];
                const resid = q.residualSamples === null ? null : (q.residualSamples / group.sampleRate) * 1000;
                const priors = view?.capturePriors.find((c) => c.angleId === a.id && c.pieceIndex === i);
                return (
                  <tr key={key} data-testid={ID.syncRow} data-angle-id={a.id} data-piece={i}>
                    <th scope="row"><bdi>{a.label}</bdi>{a.pieces.length > 1 ? ` ${i + 1}` : ''}<br /><span className="mc-note"><bdi>{asset ? assetDisplayName(asset, lang) ?? asset.name : p.assetId}</bdi></span></th>
                    <td><span className="mc-chip" data-testid={ID.verdict} data-verdict={q.verdict} data-mark={VERDICT_MARK[q.verdict]}>{D[`multicam.verdict.${q.verdict}`]}</span></td>
                    <td data-testid={ID.offset}><bdi dir="ltr">{fmt(off, 3, ' s')}</bdi></td>
                    <td data-testid={ID.drift}><bdi dir="ltr">{fmt(q.driftPpm, 1, ' ppm')}</bdi></td>
                    <td data-testid={ID.peakRatio}><bdi dir="ltr">{fmt(q.peakRatio, 2)}</bdi></td>
                    <td data-testid={ID.residual}><bdi dir="ltr">{fmt(resid, 2, ' ms')}</bdi></td>
                    <td>
                      {q.verdict === 'reference' ? <span className="mc-note">{S.reference}</span> : (
                        <>
                          <Nudge label={`${S.nudgeFrame}: ${a.label}`} kind="frame" value={n.frame} lang={lang} testId={ID.nudgeFrame} onNudge={(by) => nudge(a.id, i, 'frame', by)} />
                          <Nudge label={`${S.nudgeMs}: ${a.label}`} kind="ms" value={n.ms} lang={lang} testId={ID.nudgeMs} onNudge={(by) => nudge(a.id, i, 'ms', by)} />
                          {(q.verdict === 'unsynced' || q.verdict === 'no-shared-sound') && <p className="mc-note">{p.anchors.length || !asset?.audio ? '' : S.unsyncedNote}{!asset?.audio ? S.whyNoAudio : ''}</p>}
                          {q.candidates.length > 0 && (
                            <div className="mc-cands" aria-label={S.candidates}>
                              {q.candidates.map((c, k) => (
                                <span key={k} data-testid={ID.candidate} data-index={k}>
                                  <bdi dir="ltr">{S.candidateLine(fmt(T.toSeconds(c.offset), 3, ' s'), c.score.toFixed(2))}</bdi>{' '}
                                  <Button size="sm" data-testid={ID.choose} onClick={() => void edit(a.id, i, { offset: c.offset })}>{D['multicam.choose']}</Button>
                                </span>
                              ))}
                            </div>
                          )}
                          {priors && priors.offsetSeconds !== null && (
                            <div className="mc-cands" data-testid={ID.capturePrior}>
                              <span><strong>{D['multicam.capturePrior']}</strong>: <bdi dir="ltr">{S.capturePriorLine(priors.offsetSeconds.toFixed(0), String(priors.uncertaintySeconds ?? '?'))}</bdi></span>{' '}
                              <Button size="sm" onClick={() => void edit(a.id, i, { offset: T.rt(Math.round(priors.offsetSeconds!), 1) })}>{D['multicam.choose']}</Button>
                              <p className="mc-note">{D['multicam.capturePriorNote']}</p>
                            </div>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        )}
        {group?.angles.some((a) => a.pieces.length > 1) && <p className="mc-note">{D['multicam.soundChunks']}</p>}
      </div>
    </Dialog>
  );
}
