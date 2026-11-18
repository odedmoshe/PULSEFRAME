/**
 * What the mounts of the content packs decide (ADR-0022), kept apart from the components so it can be tested without a browser:
 * the browser's own local day as a calendar day, the birthdays the pack shelf may suggest a pack for (from the owner's people:
 * this is the owner's own screen, nothing here leaves the browser), and the exact length of the edit for «כאורך הסרטון».
 * Pure; nothing here reads a clock (the caller gives the day).
 */
import * as T from '@pulseframe/time';
import { isValidGregorian, peopleOf, type GDate, type LifeEventHint, type ProjectDocument } from '@pulseframe/core';

/** The viewer's own local day (`new Date()` is read by the caller and given here). */
export const localGDate = (now: Date): GDate => ({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
/**
 * The birthdays of the project's people that fall on `today` or later this year, else next year (29 February is kept on 28
 * February in a year without one). The pack shelf suggests the birthday pack for the nearest one. A person without a birth date
 * gives none. Names stay in the owner's browser (the shelf prints them in its own badge, on the owner's screen only).
 */
export function birthdayHints(doc: ProjectDocument | null, today: GDate): LifeEventHint[] {
  const out: LifeEventHint[] = [];
  for (const p of Object.values(doc ? peopleOf(doc) : {})) {
    if (!p.birthDate) continue;
    const m = Number(p.birthDate.slice(5, 7)), d = Number(p.birthDate.slice(8, 10));
    const at = (y: number): GDate => (isValidGregorian({ y, m, d }) ? { y, m, d } : { y, m, d: 28 });
    const thisYear = at(today.y);
    const key = (g: GDate) => g.y * 10000 + g.m * 100 + g.d;
    out.push({ kind: 'birthday', on: key(thisYear) >= key(today) ? thisYear : at(today.y + 1), name: p.name });
  }
  return out.sort((a, b) => a.on.y * 10000 + a.on.m * 100 + a.on.d - (b.on.y * 10000 + b.on.m * 100 + b.on.d));
}
/** The length of the edit as MusicBrowser wants it for «כאורך הסרטון»: seconds as `n` or `n/d`; null for an empty timeline. */
export function fitSecondsOf(end: T.RationalTime): string | null {
  if (!T.lt(T.ZERO, end)) return null;
  return end.timescale === 1 ? end.value : `${end.value}/${end.timescale}`;
}
