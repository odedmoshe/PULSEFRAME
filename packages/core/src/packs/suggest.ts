/**
 * Which packs to suggest on a given day (ADR-0022), and the Hanukkah candle of a day. Pure: `today` comes from the caller
 * (the browser's own local day); nothing here reads a clock. The dates come from the life line's calendar
 * (hebrewCalendar.ts: the holiday table on the Israeli schedule); nothing about the Hebrew calendar is worked out here.
 */
import { GREGORIAN_MONTH_NAMES, gregorianFromRd, hanukkahDay, hebrewFromRd, HOLIDAY_FAMILIES, holidayTable, isValidGregorian, rdFromGregorian, type GDate } from '../hebrewCalendar.ts';
import type { LifeEventHint, PackDef, PackSuggestion, PackWords } from './contract.ts';

/**
 * The Hanukkah candle (1..8) of a civil day, or null outside Hanukkah. `atLighting` true = at that evening's candle
 * lighting, which belongs to the NEXT Hebrew day: 4 December 2026 at the lighting is candle 1 (25 Kislev 5787 is 5 December),
 * and its daytime is not Hanukkah yet. false = the daytime of that day. Null for a day that does not exist.
 */
export function candleNight(date: GDate, atLighting: boolean): number | null {
  if (!isValidGregorian(date)) return null;
  return hanukkahDay(rdFromGregorian(date) + (atLighting ? 1 : 0));
}

/** The first and last day (day numbers) of each occurrence of a holiday family in a Hebrew year: the holiday itself, without the eve before it. */
function occurrences(years: readonly number[]): Map<string, { first: number; last: number }[]> {
  const out = new Map<string, { first: number; last: number }[]>();
  for (const y of years) {
    const span = new Map<string, { first: number; last: number }>();
    for (const row of holidayTable(y)) {
      // a row that names only a daytime (ערב חג: the day before a holiday begins) is the eve, not the holiday: every day of
      // a holiday itself has a night part, the evening that begins it
      if (row.part === 'day') continue;
      const cur = span.get(row.holiday.family);
      if (!cur) span.set(row.holiday.family, { first: row.rd, last: row.rd });
      else { cur.first = Math.min(cur.first, row.rd); cur.last = Math.max(cur.last, row.rd); }
    }
    for (const [family, s] of span) out.set(family, [...(out.get(family) ?? []), s]);
  }
  return out;
}
const dayMonth = (g: GDate, lang: 'he' | 'en') => (lang === 'he' ? `${g.d} ב${GREGORIAN_MONTH_NAMES[g.m - 1]!.he}` : `${g.d} ${GREGORIAN_MONTH_NAMES[g.m - 1]!.en}`);
const inDaysHe = (n: number) => (n === 1 ? 'מחר' : n === 2 ? 'בעוד יומיים' : `בעוד ${n} ימים`);
const inDaysEn = (n: number) => (n === 1 ? 'tomorrow' : `in ${n} days`);
const agoHe = (n: number) => (n === 1 ? 'אתמול' : n === 2 ? 'לפני יומיים' : `לפני ${n} ימים`);
const agoEn = (n: number) => (n === 1 ? 'yesterday' : `${n} days ago`);

/**
 * The packs to suggest on `today`, nearest first (by |daysAway|, then in the order of `packs`).
 * - holiday occasion: suggested from leadDays before the holiday's first day until trailDays after its last day. The holiday
 *   begins the evening before its first day, and daysAway counts to that evening: on 17 November 2026 Hanukkah (first day
 *   5 December) is 17 days away, «מתחיל בערב 4 בדצמבר · בעוד 17 ימים». The Hebrew year of `today` and the years before and
 *   after it are looked at, so a holiday early in the next year is seen from the end of this one.
 * - life-event occasion: suggested when `hints` holds a birthday within windowDays either side of `today`.
 * - always: never suggested.
 * A day that does not exist gives no suggestions. A family the calendar does not know is never suggested.
 */
export function suggestPacks(packs: readonly PackDef[], today: GDate, hints: readonly LifeEventHint[] = []): PackSuggestion[] {
  if (!isValidGregorian(today)) return [];
  const now = rdFromGregorian(today), year = hebrewFromRd(now).y;
  let table: Map<string, { first: number; last: number }[]> | null = null;
  const found: (PackSuggestion & { order: number })[] = [];
  for (const [order, pack] of packs.entries()) {
    const o = pack.occasion;
    if (o.kind === 'holiday') {
      if (!Object.hasOwn(HOLIDAY_FAMILIES, o.family)) continue;
      table ??= occurrences([year - 1, year, year + 1]);
      const name = HOLIDAY_FAMILIES[o.family]!;
      const hit = (table.get(o.family) ?? []).filter((s) => now >= s.first - o.leadDays && now <= s.last + o.trailDays).sort((a, b) => Math.abs(a.first - now) - Math.abs(b.first - now))[0];
      if (!hit) continue;
      const evening = hit.first - 1; // the evening that begins the holiday
      const daysAway = now < evening ? evening - now : now <= hit.last ? 0 : hit.last - now;
      const eve = gregorianFromRd(evening);
      const reason: PackWords = daysAway > 0 ? { he: `${name.he} מתחיל בערב ${dayMonth(eve, 'he')} · ${inDaysHe(daysAway)}`, en: `${name.en} begins on the evening of ${dayMonth(eve, 'en')} · ${inDaysEn(daysAway)}` }
        : daysAway === 0 ? (now === evening ? { he: `${name.he} מתחיל הערב`, en: `${name.en} begins this evening` } : { he: `${name.he} עכשיו`, en: `${name.en} is now` })
        : { he: `${name.he} הסתיים ${agoHe(-daysAway)}`, en: `${name.en} ended ${agoEn(-daysAway)}` };
      found.push({ packId: pack.id, daysAway, firstDay: gregorianFromRd(hit.first), lastDay: gregorianFromRd(hit.last), eveningBefore: true, reason, order });
    } else if (o.kind === 'life-event') {
      const near = hints.filter((h) => h.kind === o.event && isValidGregorian(h.on)).map((h) => ({ h, rd: rdFromGregorian(h.on) })).filter((x) => Math.abs(x.rd - now) <= o.windowDays).sort((a, b) => Math.abs(a.rd - now) - Math.abs(b.rd - now))[0];
      if (!near) continue;
      const daysAway = near.rd - now, who = near.h.name?.trim();
      const whatHe = who ? `יום ההולדת של ${who}` : 'יום הולדת', whatEn = who ? `${who}'s birthday` : 'A birthday';
      const reason: PackWords = daysAway > 0 ? { he: `${whatHe} ${inDaysHe(daysAway)} · ${dayMonth(near.h.on, 'he')}`, en: `${whatEn} ${inDaysEn(daysAway)} · ${dayMonth(near.h.on, 'en')}` }
        : daysAway === 0 ? { he: `${whatHe} היום`, en: `${whatEn} is today` }
        : { he: `${whatHe} היה ${agoHe(-daysAway)}`, en: `${whatEn} was ${agoEn(-daysAway)}` };
      found.push({ packId: pack.id, daysAway, firstDay: near.h.on, lastDay: near.h.on, eveningBefore: false, reason, order });
    }
  }
  return found.sort((a, b) => Math.abs(a.daysAway) - Math.abs(b.daysAway) || a.order - b.order).map(({ order: _order, ...s }) => s);
}
