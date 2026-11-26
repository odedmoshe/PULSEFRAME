/**
 * The media drawer by capture date and by event (life line, ADR-0021; plan §7): the view switch «הכול · לפי תאריך · אירועים»
 * (a radio group; the choice is the one thing kept in browser storage), years with sticky headers and months
 * («מרץ 2024 · אדר ב׳ תשפ״ד») with counts, the group of files without a date with «קריאת תאריכים מהקבצים», and the list of
 * events (EventRow) with «סידור לפי אירועים». Data: core calendarGroups, eventSpan, eventDisplayName. Files are the library's own
 * cards (MediaGrid), so a card looks and works the same in every view. Every edit is an operation through Editor.commit.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { CalendarDays } from 'lucide-react';
import { eventOfAsset } from '@pulseframe/core';
import { Button, Seg } from '../../ds/index.ts';
import { ApiFailure } from '../../api.ts';
import { setRail } from '../chromeState.ts';
import { MediaGrid } from '../MediaLibrary.tsx';
import { useEditorState } from '../store.ts';
import { EventRow } from './EventRow.tsx';
import { ShiftClockButton } from './CaptureEditor.tsx';
import { PeopleSheet } from './PeopleSheet.tsx';
import { LIFE_STRINGS, fill } from './lifeline.strings.ts';
import { LIFE_TESTIDS } from './lifeline.testids.ts';
import { lifeApi } from './lifeline.api.ts';
import { clusterNudgeCount, dateGroups, eventModels, monthLabel, LIFE_VIEWS, LIFE_VIEW_STORAGE_KEY, type LifeView } from './lifeLibrary.logic.ts';
import { closePeople, setLifeView, showEvent, useLifeUi } from './lifeUi.ts';
import './lifeline.css';
import { PEARLS_UI_BUILT } from '../pearls/PearlsList.tsx';
import { PEARLS_TESTIDS } from '../pearls/pearls.testids.ts';
import { pearlsT } from '../pearls/pearls.strings.ts';

export { LIFE_VIEWS, LIFE_VIEW_STORAGE_KEY };
export type { LifeView };

/** The view switch under the filter chips of the media drawer. data-testid LIFE_TESTIDS.view; options LIFE_TESTIDS.viewOption(view). */
export function LifeViewSwitch({ view, onChange }: { view: LifeView; onChange: (view: LifeView) => void }): ReactElement | null {
  const { state } = useEditorState();
  const S = LIFE_STRINGS[state.lang];
  return (
    <div className="pf-life-view" data-testid={LIFE_TESTIDS.view}>
      <Seg size="sm" block label={S.viewLabel} value={view} onChange={onChange}
        options={[{ value: 'all', label: S.viewAll, testId: LIFE_TESTIDS.viewOption('all') }, { value: 'date', label: S.viewByDate, testId: LIFE_TESTIDS.viewOption('date') }, { value: 'events', label: S.viewEvents, testId: LIFE_TESTIDS.viewOption('events') },
          // «פנינים» (wave 7 pearls track): offered once builder C has built the list
          ...(PEARLS_UI_BUILT ? [{ value: 'pearls' as const, label: pearlsT(state.lang)('view'), testId: PEARLS_TESTIDS.view }] : [])]} />
    </div>
  );
}

/** The card «נמצאו 42 קבצים עם תאריך · סידור לפי אירועים»: shown while dated files exist and no event does. */
function ClusterNudge() {
  const { editor, state } = useEditorState();
  const S = LIFE_STRINGS[state.lang];
  const n = state.doc ? clusterNudgeCount(state.doc) : 0;
  const [busy, setBusy] = useState(false);
  if (n === 0) return null;
  const run = async () => {
    setBusy(true);
    const r = await editor.commit([{ op: 'cluster_events', args: {} }], 'Arrange by events');
    setBusy(false);
    if (r?.transactionId) editor.notify({ kind: 'undo', title: S.eventArranged, undoes: r.transactionId });
    setLifeView('events');
  };
  return (
    <div className="pf-life-nudge" role="group" aria-label={S.cluster}>
      <CalendarDays size={18} strokeWidth={1.75} aria-hidden="true" />
      <span>{fill(S.clusterNudge, { n })}</span>
      <Button size="sm" variant="secondary" busy={busy} data-testid={LIFE_TESTIDS.cluster} onClick={() => void run()}>{S.cluster}</Button>
    </div>
  );
}

/** «קריאת תאריכים מהקבצים»: the server looks at the stored originals of files without a date and commits one transaction. */
function ReadDates() {
  const { state } = useEditorState();
  const S = LIFE_STRINGS[state.lang];
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const doc = state.doc;
  if (!doc) return null;
  const run = async () => {
    setBusy(true); setSaid(null);
    try {
      const r = await lifeApi.readCaptureDates(doc.id);
      setSaid({ ok: true, text: fill(S.readDatesDone, { read: r.read, dated: r.dated }) });
    } catch (e) {
      const unavailable = e instanceof ApiFailure && (e.status === 404 || e.status === 501);
      setSaid({ ok: false, text: unavailable ? S.readDatesUnavailable : fill(S.readDatesFailed, { why: e instanceof Error ? e.message : '' }) });
    } finally { setBusy(false); }
  };
  return (
    <div className="pf-life-read">
      <Button size="sm" variant="secondary" busy={busy} data-testid={LIFE_TESTIDS.readDates} onClick={() => void run()}>{busy ? S.readDatesBusy : S.readDates}</Button>
      <p className="pf-life-note" role="status" data-testid="life-read-dates-said" data-ok={said ? String(said.ok) : undefined}>{said?.text}</p>
    </div>
  );
}

/** The body of the media drawer for the views 'date' and 'events' (the view 'all' stays the existing library). */
export function LifeLibrary({ view, onView }: { view: Exclude<LifeView, 'all' | 'pearls'>; onView?: (assetId: string) => void }): ReactElement | null {
  const { state } = useEditorState();
  const doc = state.doc;
  const S = LIFE_STRINGS[state.lang];
  if (!doc) return null;
  const view_ = onView ?? (() => undefined);
  if (view === 'events') {
    const rows = eventModels(doc, state.lang);
    const dated = dateGroups(doc).dated;
    return (
      <div className="pf-life" data-testid="life-events" data-view="events">
        <ClusterNudge />
        {rows.length === 0 && dated === 0 && <p className="pf-life-note" role="status">{S.eventsNoDated}</p>}
        {rows.length === 0 && dated > 0 && clusterNudgeCount(doc) === 0 && <p className="pf-life-note" role="status">{S.eventsNone}</p>}
        {rows.length > 0 && <ul className="pf-ev-list" aria-label={S.viewEvents}>{rows.map((m) => <EventRow key={m.id} eventId={m.id} />)}</ul>}
      </div>
    );
  }
  const g = dateGroups(doc);
  return (
    <div className="pf-life" data-testid="life-dates" data-view="date">
      <ClusterNudge />
      {g.dated === 0 && <p className="pf-life-note" role="status" data-testid="life-no-dates">{S.libraryNoDates}</p>}
      {g.dated > 0 && <div className="pf-life-bar"><ShiftClockButton assetIds={g.years.flatMap((y) => y.months.flatMap((m) => m.assetIds))} /></div>}
      {g.years.map((y) => (
        <section key={y.year} className="pf-life-year" data-testid={LIFE_TESTIDS.year(y.year)} aria-labelledby={`life-y-${y.year}`}>
          <h3 id={`life-y-${y.year}`} className="pf-life-yh"><span className="num">{y.year}</span><span className="pf-life-cnt num">{y.count}</span></h3>
          {y.months.map((m) => {
            const label = monthLabel(state.lang, m.year, m.month, m.hebrew);
            return (
              <section key={m.month} className="pf-life-month" data-testid={LIFE_TESTIDS.month(m.year, m.month)} aria-labelledby={`life-m-${m.year}-${m.month}`}>
                <h4 id={`life-m-${m.year}-${m.month}`} className="pf-life-mh"><span>{label.civil}</span> <span className="pf-life-mdot" aria-hidden="true">·</span> <bdi dir="rtl" className="pf-life-heb">{label.hebrew}</bdi><span className="pf-life-cnt num">{m.assetIds.length}</span></h4>
                <MediaGrid onView={view_} only={m.assetIds} />
              </section>
            );
          })}
        </section>
      ))}
      {g.undated.length > 0 && (
        <section className="pf-life-year pf-life-undated" data-testid={LIFE_TESTIDS.undated} aria-labelledby="life-undated-h">
          <h3 id="life-undated-h" className="pf-life-yh">{fill(S.undated, { n: g.undated.length })}</h3>
          <ReadDates />
          {g.undated.some((id) => /\.(heic|heif)$/i.test(doc.assets[id]?.name ?? '')) && <p className="pf-life-note">{S.undatedHeicNote}</p>}
          <MediaGrid onView={view_} only={g.undated} />
        </section>
      )}
    </div>
  );
}

/**
 * Always mounted with the browser drawer: the people sheet (opened from the palette and from the field menu) and the request to
 * bring an event into view from a link («on this day»: `#life-asset=<assetId>` in the address). Draws only the sheet.
 */
export function LifeHost(): ReactElement | null {
  const ui = useLifeUi();
  const { state } = useEditorState();
  const doc = state.doc;
  useEffect(() => {
    if (!doc) return;
    const m = /^#life-asset=([A-Za-z0-9_-]{1,64})$/.exec(typeof location === 'undefined' ? '' : location.hash);
    if (!m) return;
    const id = m[1]!;
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
    const e = Object.hasOwn(doc.assets, id) ? eventOfAsset(doc, id) : null;
    if (e) showEvent(e.id); else { setRail('media'); setLifeView('date'); }
  }, [doc?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return <PeopleSheet open={ui.peopleOpen} focusPersonId={ui.peopleFocus} onClose={closePeople} />;
}
