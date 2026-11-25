/**
 * The join of a shortened song, exact parts (wave 7 musicfit; BUILDER A). Final signatures; bodies throw MusicFitNotBuilt until built.
 * The feature extraction and the search over audio are the server's (apps/server/src/musicfit/features.ts, splice.ts); here is what is
 * exact: the order of candidates and the made file's grid. Rules (decisions §2.11): candidates ordered by cost rounded to 1e-6, then
 * phrase alignment (4 before 2 before 1), then the smaller distance from the wanted length, then the earlier `from`. The grid: a beat
 * b < from maps to b − startAt; b >= to maps to b − startAt − (to − from); beats in [from, to) are gone; a candidate whose grid is not
 * strictly ascending is dropped. Rationals only.
 */
import type * as T from '@pulseframe/time';
import { MusicFitNotBuilt, type JoinCandidate, type JoinRemoval } from './musicFitContract.ts';

export interface SourceGrid { beats: readonly T.RationalTime[]; downbeats: readonly T.RationalTime[]; duration: T.RationalTime }
export interface FittedGridParts { beats: T.RationalTime[]; downbeats: T.RationalTime[]; duration: T.RationalTime; joinAt: T.RationalTime }
/** The made file's beats, bar starts, length and join, exact; null when the result is not strictly ascending. */
export function fittedGrid(source: SourceGrid, startAt: T.RationalTime, removal: JoinRemoval, usableEnd: T.RationalTime): FittedGridParts | null {
  void source; void startAt; void removal; void usableEnd;
  throw new MusicFitNotBuilt('fittedGrid');
}
/** The candidates in the order the plan offers them (at most MUSICFIT.maxCandidates). `cost` per candidate comes from the server's features. */
export function orderCandidates(scored: readonly (JoinCandidate & { cost: number })[], wantedSeconds: number): JoinCandidate[] {
  void scored; void wantedSeconds;
  throw new MusicFitNotBuilt('orderCandidates');
}
