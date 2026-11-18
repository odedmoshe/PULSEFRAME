/**
 * The "on this day" card of the start hub (life line, ADR-0021; plan §7): «היום לפני 3 שנים» and, when the Hebrew date
 * matches, «כ״ה בכסלו לפני 3 שנים», up to four thumbnails and «פתיחה» (opens the project with the file's event in view).
 * Asked with the browser's own local day (lifeline.api.ts lifeApi.onThisDay); owner session only. Absent when there is nothing
 * to show or the call is refused; it never plays by itself (stills only, no autoplay).
 * Test ids: LIFE_TESTIDS.onThisDay, onThisDayOpen.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { History } from 'lucide-react';
import type { OnThisDayItem } from '@pulseframe/core';
import { Button } from '../../ds/index.ts';
import { useEditorState } from '../store.ts';
import { LifeThumb } from './LifeThumb.tsx';
import { LIFE_STRINGS, fill } from './lifeline.strings.ts';
import { LIFE_TESTIDS } from './lifeline.testids.ts';
import { lifeApi } from './lifeline.api.ts';
import './lifeline.css';

/** The items that belong on one card: those of the first item's project, years ago and calendar (the nearest year first, as the server orders them). */
export function cardGroup(items: readonly OnThisDayItem[]): OnThisDayItem[] {
  const first = items[0];
  return first ? items.filter((i) => i.projectId === first.projectId && i.yearsAgo === first.yearsAgo && i.match === first.match) : [];
}

export function OnThisDayCard({ onOpen }: { onOpen: (projectId: string, assetId: string) => void }): ReactElement | null {
  const { state } = useEditorState();
  const S = LIFE_STRINGS[state.lang];
  const [items, setItems] = useState<OnThisDayItem[]>([]);
  useEffect(() => {
    let live = true;
    // a refusal (not the owner's session), a server without the route, or no network: no card, and nothing to say
    lifeApi.onThisDay().then((r) => { if (live) setItems(r.items); }).catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, []);
  const group = cardGroup(items);
  const first = group[0];
  if (!first) return null;
  const heading = first.match === 'hebrew' && first.hebrewDate
    ? fill(S.onThisDayHebrew, { date: first.hebrewDate, n: first.yearsAgo })
    : first.yearsAgo === 1 ? S.onThisDayOneYear : fill(S.onThisDayYears, { n: first.yearsAgo });
  const shown = group.slice(0, 4);
  return (
    <section className="pf-otd" data-testid={LIFE_TESTIDS.onThisDay} aria-label={S.onThisDayRegion} data-match={first.match}>
      <History size={18} strokeWidth={1.75} aria-hidden="true" className="pf-otd-ic" />
      <div className="pf-otd-body">
        <h3 className="pf-otd-h" dir="auto">{heading}</h3>
        <p className="pf-otd-sub">{fill(S.onThisDayFrom, { project: first.projectName })}{first.eventName ? <> · <bdi dir="auto">{first.eventName}</bdi></> : null}</p>
        <ul className="pf-otd-strip" aria-label={S.onThisDayRegion}>
          {shown.map((i) => <li key={i.assetId} title={i.assetName}><LifeThumb projectId={i.projectId} assetId={i.assetId} className="pf-otd-th" /></li>)}
          {group.length > shown.length && <li className="pf-otd-more num">{fill(S.onThisDayMore, { n: group.length - shown.length })}</li>}
        </ul>
      </div>
      <Button size="sm" variant="secondary" data-testid={LIFE_TESTIDS.onThisDayOpen} onClick={() => onOpen(first.projectId, first.assetId)}>{S.onThisDayOpen}</Button>
    </section>
  );
}
