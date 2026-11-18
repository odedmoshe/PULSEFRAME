/**
 * The life-line commands of the palette (ADR-0021): arrange the library by events, read capture dates from the files, make the
 * selected title plain text, open the people sheet. Each edit is one transaction through Editor.commit (an operation the registry
 * knows), each answer an undo toast naming exactly that transaction, and each refusal a plain toast: nothing is changed silently.
 */
import { findClip } from '@pulseframe/core';
import { ApiFailure } from '../../api.ts';
import { setRail } from '../chromeState.ts';
import type { Editor } from '../store.ts';
import { freezeModel, timeInTitle } from './fieldText.logic.ts';
import { lifeApi } from './lifeline.api.ts';
import { LIFE_STRINGS, fill } from './lifeline.strings.ts';
import { clusterNudgeCount } from './lifeLibrary.logic.ts';
import { openPeople, setLifeView } from './lifeUi.ts';

/** Group the dated files of the library into events (cluster_events) and show the events view. */
export async function arrangeByEvents(e: Editor): Promise<void> {
  const S = LIFE_STRINGS[e.getState().lang];
  setRail('media'); setLifeView('events');
  const r = await e.commit([{ op: 'cluster_events', args: {} }], 'Arrange by events');
  if (r?.transactionId) e.notify({ kind: 'undo', title: S.eventArranged, undoes: r.transactionId });
}
export const canArrange = (e: Editor): boolean => !!e.doc && (clusterNudgeCount(e.doc) > 0 || Object.keys(e.doc.events ?? {}).length > 0);

/** Read capture dates again from the stored originals of the files that have none (the server commits one transaction). */
export async function readCaptureDates(e: Editor): Promise<void> {
  const doc = e.doc;
  if (!doc) return;
  const S = LIFE_STRINGS[e.getState().lang];
  try {
    const r = await lifeApi.readCaptureDates(doc.id);
    e.notify({ kind: 'info', title: fill(S.readDatesDone, { read: r.read, dated: r.dated }) });
  } catch (err) {
    const unavailable = err instanceof ApiFailure && (err.status === 404 || err.status === 501);
    e.notify({ kind: 'info', title: unavailable ? S.readDatesUnavailable : fill(S.readDatesFailed, { why: err instanceof Error ? err.message : '' }) });
  }
}

/** The selected title, when it has live fields. */
export const liveTitleId = (e: Editor): string | null => { const c = e.selected?.clip; return c && c.type === 'text' && c.fields ? c.id : null; };

/** «קבע כטקסט רגיל» for the selected title: core freezeOps, committed as one transaction, only when no field lacks data. */
export async function freezeSelectedTitle(e: Editor): Promise<void> {
  const S = LIFE_STRINGS[e.getState().lang];
  const held: { problem: string | null; varies?: boolean } = { problem: null };
  const id = liveTitleId(e);
  if (!id) { e.notify({ kind: 'info', title: S.fieldFreezeNone }); return; }
  const r = await e.commit(() => {
    const d = e.doc, f = d ? findClip(d, id) : undefined;
    if (!d || !f || f.clip.type !== 'text' || !f.clip.fields) { held.problem = S.fieldFreezeNone; return null; }
    const m = freezeModel(d, f.seq.id, f.clip, timeInTitle(f.clip, e.playhead));
    if (!m) { held.problem = S.fieldFreezeFailed; return null; }
    if (m.missing.length) { held.problem = fill(S.fieldFreezeMissing, { tokens: [...new Set(m.missing.map((x) => x.token))].join(', ') }); return null; }
    if (m.tooLong.length) { held.problem = S.fieldFreezeTooLong; return null; }
    held.varies = m.varies;
    return m.ops;
  }, 'Make title plain text');
  if (held.problem) e.notify({ kind: 'info', title: held.problem });
  else if (r?.transactionId) e.notify({ kind: 'undo', title: S.fieldFrozen, ...(held.varies ? { body: S.fieldVaries } : {}), undoes: r.transactionId });
}

export const openPeopleSheet = (): void => openPeople(null);
