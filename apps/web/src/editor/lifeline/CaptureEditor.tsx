/**
 * The capture date of library files (life line, ADR-0021; plan §7): the date badge of a media card (`15.3.24`; an estimate
 * has a dashed badge AND the words «משוער משם הקובץ», never colour alone), the dialog «תאריך צילום…» (date, optional time,
 * «משוער», a live echo of the weekday and the Hebrew date, שמירה / הסרת התאריך → set_asset_capture) and, for several
 * files, «הזזת השעון…» (shift_asset_captures). Dates and numbers sit in `.num` / <bdi>. Every change is one operation through
 * Editor.commit; nothing here is kept in browser storage.
 * Test ids: LIFE_TESTIDS.dateBadge(assetId), captureEdit (the menu item that opens this), captureSave, shiftClock (the button that opens the shift).
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Clock } from 'lucide-react';
import type { Key } from '@pulseframe/i18n';
import { Button, Dialog, Seg, AnchoredError } from '../../ds/index.ts';
import { useEditorState } from '../store.ts';
import { LIFE_STRINGS, fill, type LifeWords } from './lifeline.strings.ts';
import { LIFE_TESTIDS } from './lifeline.testids.ts';
import { badgeOf, captureEcho, captureInputOf, parseCaptureInput, removeCaptureOp, saveCaptureOp, shiftMinutes, shiftOp, shiftability, badgeText, type ShiftBlock } from './lifeLibrary.logic.ts';
import './lifeline.css';

/** The date badge on a media card; draws nothing for a file without a date. An estimate is dashed and says so in words. */
export function DateBadge({ assetId }: { assetId: string }): ReactElement | null {
  const { state } = useEditorState();
  const doc = state.doc;
  const b = doc ? badgeOf(doc, assetId) : null;
  if (!b) return null;
  const S = LIFE_STRINGS[state.lang];
  const why = b.source === 'filename' ? S.dateCirca : S.captureCirca;
  return (
    <span className={`pf-life-date${b.circa ? ' is-circa' : ''}`} data-testid={LIFE_TESTIDS.dateBadge(assetId)} data-circa={b.circa ? 'true' : undefined}
      title={b.circa ? fill(S.dateBadgeCircaLabel, { date: b.text, source: why }) : fill(S.dateBadgeLabel, { date: b.text })}>
      <bdi dir="ltr" className="num pf-life-date-n">{b.text}</bdi>
      {b.circa && <span className="pf-life-date-w">{why}</span>}
    </span>
  );
}

const reasonText = (S: LifeWords, r: 'empty' | 'bad_day' | 'bad_time' | 'out_of_range'): string => (r === 'empty' ? S.captureEmpty : r === 'bad_day' ? S.captureBadDay : r === 'bad_time' ? S.captureBadTime : S.captureOutOfRange);

/** The capture date of one file in a dialog: date, optional time, «משוער», the live echo, save and remove. */
export function CaptureEditor({ assetId, onClose }: { assetId: string; onClose: () => void }): ReactElement | null {
  const { editor, state, t } = useEditorState();
  const doc = state.doc;
  const S = LIFE_STRINGS[state.lang];
  const start = useMemo(() => (doc ? captureInputOf(doc, assetId) : null), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [date, setDate] = useState(start?.date ?? '');
  const [time, setTime] = useState(start?.time ?? '');
  const [circa, setCirca] = useState(start?.circa ?? false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setProblem(null); }, [date, time, circa]);
  if (!doc || !Object.hasOwn(doc.assets, assetId) || !start) return null;
  const asset = doc.assets[assetId]!;
  const parsed = parseCaptureInput({ date, time, circa });
  const echo = parsed.ok ? captureEcho(state.lang, parsed.at) : null;
  const save = async () => {
    if (!parsed.ok) { setProblem(reasonText(S, parsed.reason)); return; }
    setBusy(true);
    const r = await editor.commit([saveCaptureOp(assetId, parsed, asset.capture)], 'Capture date');
    setBusy(false);
    if (r) { onClose(); if (r.transactionId) editor.notify({ kind: 'undo', title: S.captureSaved, undoes: r.transactionId }); }
  };
  const remove = async () => {
    setBusy(true);
    const r = await editor.commit([removeCaptureOp(assetId)], 'Remove capture date');
    setBusy(false);
    if (r) { onClose(); if (r.transactionId) editor.notify({ kind: 'undo', title: S.captureRemoved, undoes: r.transactionId }); }
  };
  return (
    <Dialog open onClose={onClose} title={S.captureTitle} size="sm" closeLabel={t('close' as Key)} testId="life-capture-dialog"
      footer={<>
        {start.hasOwn && <Button variant="ghost" onClick={() => void remove()} disabled={busy} data-testid="life-capture-remove">{S.captureRemove}</Button>}
        <Button variant="secondary" onClick={onClose}>{S.captureCancel}</Button>
        <Button variant="primary" onClick={() => void save()} busy={busy} data-testid={LIFE_TESTIDS.captureSave}>{S.captureSave}</Button>
      </>}>
      <div className="pf-life-form">
        <p className="pf-life-file" dir="auto">{asset.name}</p>
        <label className="pf-life-field"><span>{S.captureDate}</span>
          <input type="date" className="num" dir="ltr" value={date} min="1900-01-01" max="2100-12-31" data-autofocus="" data-testid="life-capture-date" onChange={(e) => setDate(e.target.value)} aria-invalid={!!problem || undefined} />
        </label>
        <label className="pf-life-field"><span>{S.captureTime}</span>
          <input type="time" className="num" dir="ltr" value={time} data-testid="life-capture-time" onChange={(e) => setTime(e.target.value)} />
        </label>
        <label className="pf-life-check"><input type="checkbox" checked={circa} onChange={(e) => setCirca(e.target.checked)} data-testid="life-capture-circa" /> <span>{S.captureCirca}</span></label>
        <p className="pf-life-echo" aria-live="polite" aria-label={S.captureEchoLabel} data-testid="life-capture-echo" dir="auto">{echo ?? ' '}</p>
        {start.inherited && <p className="pf-life-note">{S.captureInherited}</p>}
        {start.source && <p className="pf-life-note">{fill(S.captureSource, { source: t(`life.capture.source.${start.source}` as Key) })}</p>}
        {start.assumedZone && <p className="pf-life-note">{fill(S.captureAssumedZone, { zone: start.assumedZone })}</p>}
        {problem && <AnchoredError blocking>{problem}</AnchoredError>}
      </div>
    </Dialog>
  );
}

const blockText = (S: LifeWords, b: ShiftBlock): string => (b === 'no_date' ? S.shiftBlockNoDate : b === 'inherited' ? S.shiftBlockInherited : S.shiftBlockDayOnly);

/** The clock shift of several files: pick the files, the direction and how far (days, hours, minutes); one shift_asset_captures. */
export function ClockShift({ assetIds, onClose }: { assetIds: readonly string[]; onClose: () => void }): ReactElement | null {
  const { editor, state, t } = useEditorState();
  const doc = state.doc;
  const S = LIFE_STRINGS[state.lang];
  const [later, setLater] = useState(false);
  const [days, setDays] = useState(0), [hours, setHours] = useState(0), [minutes, setMinutes] = useState(0);
  const eligible = useMemo(() => (doc ? shiftability(doc, assetIds) : { ok: [] as string[], blocked: {} as Record<string, ShiftBlock> }), [doc, assetIds]);
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!doc) return null;
  const total = shiftMinutes({ days, hours, minutes, later });
  // a date without a time moves by whole days only: such a file joins when the step is a multiple of 1440 minutes
  const dayOnly = Object.entries(eligible.blocked).filter(([, b]) => b === 'day_only').map(([id]) => id);
  const wholeDays = total !== null && total % 1440 === 0;
  const chosen = [...eligible.ok, ...(wholeDays ? dayOnly : [])].filter((id) => !off.has(id));
  const shown = [...eligible.ok, ...dayOnly];
  const apply = async () => {
    if (total === null) { setProblem(days * 1440 + hours * 60 + minutes === 0 ? S.shiftZero : S.shiftTooBig); return; }
    if (chosen.length === 0) { setProblem(S.shiftNoFiles); return; }
    setBusy(true);
    const r = await editor.commit([shiftOp(chosen, total)], 'Shift clock');
    setBusy(false);
    if (r) { onClose(); if (r.transactionId) editor.notify({ kind: 'undo', title: fill(S.shiftDone, { n: chosen.length }), undoes: r.transactionId }); }
  };
  const num = (v: number, set: (n: number) => void, label: string, testId: string) => (
    <label className="pf-life-field is-num"><span>{label}</span>
      <input type="number" className="num" dir="ltr" min={0} step={1} value={v} data-testid={testId} onChange={(e) => { setProblem(null); set(Math.max(0, Math.floor(Number(e.target.value) || 0))); }} />
    </label>
  );
  return (
    <Dialog open onClose={onClose} title={S.shiftTitle} size="md" closeLabel={t('close' as Key)} testId="life-shift-dialog"
      footer={<><Button variant="secondary" onClick={onClose}>{S.captureCancel}</Button><Button variant="primary" busy={busy} onClick={() => void apply()} data-testid="life-shift-apply">{S.shiftApply}</Button></>}>
      <div className="pf-life-form">
        <p className="pf-life-note">{S.shiftNote}</p>
        <Seg label={S.shiftDirection} size="sm" value={later ? 'later' : 'earlier'} onChange={(v) => setLater(v === 'later')}
          options={[{ value: 'earlier', label: S.shiftEarlier, testId: 'life-shift-earlier' }, { value: 'later', label: S.shiftLater, testId: 'life-shift-later' }]} />
        <div className="pf-life-row">{num(days, setDays, S.shiftDays, 'life-shift-days')}{num(hours, setHours, S.shiftHours, 'life-shift-hours')}{num(minutes, setMinutes, S.shiftMinutesUnit, 'life-shift-minutes')}</div>
        <fieldset className="pf-life-files">
          <legend>{S.shiftFiles} <bdi className="num">({chosen.length})</bdi></legend>
          {shown.length === 0 && <p className="pf-life-note" role="status">{S.shiftNoFiles}</p>}
          <ul>
            {shown.map((id) => {
              const a = doc.assets[id]!;
              const dis = dayOnly.includes(id) && !wholeDays;
              return (
                <li key={id}>
                  <label className="pf-life-check"><input type="checkbox" checked={!dis && !off.has(id)} disabled={dis} onChange={(e) => setOff((o) => { const n = new Set(o); if (e.target.checked) n.delete(id); else n.add(id); return n; })} />
                    <span dir="auto" className="pf-life-name">{a.name}</span>{(() => { const b = badgeOf(doc, id); return b ? <bdi className="num pf-life-n" dir="ltr">{badgeText(b.wall)}</bdi> : null; })()}</label>
                  {dis && <span className="pf-life-why">{blockText(S, 'day_only')}</span>}
                </li>
              );
            })}
            {Object.entries(eligible.blocked).filter(([, b]) => b !== 'day_only').map(([id, b]) => (
              <li key={id}><label className="pf-life-check is-off"><input type="checkbox" checked={false} disabled /><span dir="auto" className="pf-life-name">{doc.assets[id]?.name ?? id}</span></label><span className="pf-life-why">{blockText(S, b)}</span></li>
            ))}
          </ul>
        </fieldset>
        {problem && <AnchoredError blocking>{problem}</AnchoredError>}
      </div>
    </Dialog>
  );
}

/** The button that opens the clock shift for `assetIds` (a group of files). Draws nothing when there is no dated file among them. */
export function ShiftClockButton({ assetIds, size = 'sm' }: { assetIds: readonly string[]; size?: 'sm' | 'md' }): ReactElement | null {
  const { state } = useEditorState();
  const [open, setOpen] = useState(false);
  const doc = state.doc;
  if (!doc || assetIds.length === 0) return null;
  const S = LIFE_STRINGS[state.lang];
  return (
    <>
      <Button size={size} variant="ghost" icon={<Clock size={14} strokeWidth={1.75} aria-hidden="true" />} aria-haspopup="dialog" data-testid={LIFE_TESTIDS.shiftClock} onClick={() => setOpen(true)}>{S.shiftClock}</Button>
      {open && <ClockShift assetIds={assetIds} onClose={() => setOpen(false)} />}
    </>
  );
}
