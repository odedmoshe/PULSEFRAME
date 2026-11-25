/**
 * The join of a shortened song, exact parts (wave 7 musicfit; built by builder A).
 * The feature extraction and the search over audio are the server's (apps/server/src/musicfit/features.ts, splice.ts); here is what is
 * exact: the order of candidates and the made file's grid. Rules (decisions §2.11): candidates ordered by cost rounded to 1e-6, then
 * phrase alignment (4 before 2 before 1), then the smaller distance from the wanted length, then the earlier `from`. The grid: a beat
 * b < from maps to b − startAt; b >= to maps to b − startAt − (to − from); beats in [from, to) are gone; a candidate whose grid is not
 * strictly ascending is dropped. Rationals only.
 */
import * as T from '@pulseframe/time';
import { MUSICFIT, type JoinCandidate, type JoinRemoval } from './musicFitContract.ts';

export interface SourceGrid { beats: readonly T.RationalTime[]; downbeats: readonly T.RationalTime[]; duration: T.RationalTime }
export interface FittedGridParts { beats: T.RationalTime[]; downbeats: T.RationalTime[]; duration: T.RationalTime; joinAt: T.RationalTime }
/** The made file's beats, bar starts, length and join, exact; null when the result is not strictly ascending. */
export function fittedGrid(source: SourceGrid, startAt: T.RationalTime, removal: JoinRemoval, usableEnd: T.RationalTime): FittedGridParts | null {
  const { from, to } = removal;
  if (T.isNegative(startAt) || T.lt(from, startAt) || !T.lt(from, to) || T.lt(usableEnd, to) || T.lt(source.duration, usableEnd)) return null;
  const cut = T.sub(to, from);
  const map = (list: readonly T.RationalTime[]): T.RationalTime[] | null => {
    const out: T.RationalTime[] = [];
    for (const b of list) {
      if (T.lt(b, startAt) || !T.lt(b, usableEnd) || (!T.lt(b, from) && T.lt(b, to))) continue;
      const m = T.lt(b, from) ? T.sub(b, startAt) : T.sub(T.sub(b, startAt), cut);
      if (out.length && !T.lt(out[out.length - 1]!, m)) return null;
      out.push(m);
    }
    return out;
  };
  const beats = map(source.beats), downbeats = map(source.downbeats);
  if (!beats || !downbeats) return null;
  return { beats, downbeats, duration: T.sub(T.sub(usableEnd, startAt), cut), joinAt: T.sub(from, startAt) };
}
/** The candidates in the order the plan offers them (at most MUSICFIT.maxCandidates). `cost` per candidate comes from the server's features. */
export function orderCandidates(scored: readonly (JoinCandidate & { cost: number })[], wantedSeconds: number): JoinCandidate[] {
  const key = (c: JoinCandidate & { cost: number }) => ({ cost: Math.round(c.cost * 1e6), phrase: -c.measured.phraseBars, off: Math.abs(c.madeSeconds - wantedSeconds) });
  return [...scored]
    .map((c) => ({ c, k: key(c) }))
    .sort((a, b) => a.k.cost - b.k.cost || a.k.phrase - b.k.phrase || a.k.off - b.k.off || T.cmp(a.c.removal.from, b.c.removal.from))
    .slice(0, MUSICFIT.maxCandidates)
    .map(({ c: { cost: _cost, ...rest } }) => rest);
}
