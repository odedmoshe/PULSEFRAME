/**
 * Holiday dates to hold the Hebrew calendar (hebrewCalendar.ts, ADR-0021) against something outside its own arithmetic.
 * Test data only: nothing at run time reads this file.
 *
 * WHERE THE DATES COME FROM, exactly:
 * - The 45 dates of PUBLISHED_FIRST_DAYS are the table of the build plan (section 8). They were first worked out by the
 *   arithmetic of hebrewCalendar.ts and are checked in hebrewCalendar.test.ts against the Intl Hebrew calendar of the test
 *   machine (ICU), which is an independent implementation.
 * - They were then compared, date by date, with ONE published calendar that the build machine could reach: Hebcal
 *   (www.hebcal.com), its holiday list for Israel, read on 2026-11-17 from
 *   https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on&mod=on&year=<YEAR>&i=on&c=off for the years 2022 to 2027
 *   (i=on is the Israeli schedule). All 45 agree. Hebcal lists Hanukkah by the evening a candle is lit ("Chanukah: 1 Candle");
 *   the first daytime date here is the day after it. Simchat Torah in Israel is Hebcal's "Shmini Atzeret" row.
 * - The dates of ALSO_PUBLISHED (the days that move with the weekday, and a few fixed ones) were read from the same Hebcal
 *   lists on the same day. They are here because the moving rules are where an own calendar most easily goes wrong.
 * - A SECOND published calendar was NOT consulted: the build session was not permitted to read another site. So the second
 *   confirmation of every date is arithmetic and ICU only, not a published source. The owner reviews the holiday names and
 *   the schedule before the calendar is called right (wave-5 decisions).
 * Hebcal's holiday data is published under CC BY 4.0 (hebcal.com); only the dates were compared, no code or text is taken.
 */

/** First DAYTIME date (Gregorian, YYYY-MM-DD) of each holiday, Israeli schedule; `id` is the holiday row of hebrewCalendar.ts expected on that day. */
export const PUBLISHED_FIRST_DAYS: readonly { name: string; id: string; dates: readonly string[] }[] = [
  { name: 'Rosh Hashana', id: 'rosh-hashana', dates: ['2022-09-26', '2023-09-16', '2024-10-03', '2025-09-23', '2026-09-12'] },
  { name: 'Yom Kippur', id: 'yom-kippur', dates: ['2022-10-05', '2023-09-25', '2024-10-12', '2025-10-02', '2026-09-21'] },
  { name: 'Sukkot', id: 'sukkot', dates: ['2022-10-10', '2023-09-30', '2024-10-17', '2025-10-07', '2026-09-26'] },
  { name: 'Simchat Torah (Israel)', id: 'simchat-torah', dates: ['2022-10-17', '2023-10-07', '2024-10-24', '2025-10-14', '2026-10-03'] },
  { name: 'Hanukkah, day 1', id: 'hanukkah-day-1', dates: ['2022-12-19', '2023-12-08', '2024-12-26', '2025-12-15', '2026-12-05'] },
  { name: 'Purim', id: 'purim', dates: ['2023-03-07', '2024-03-24', '2025-03-14', '2026-03-03', '2027-03-23'] },
  { name: 'Pesach', id: 'pesach', dates: ['2023-04-06', '2024-04-23', '2025-04-13', '2026-04-02', '2027-04-22'] },
  { name: 'Yom HaAtzmaut (as observed)', id: 'yom-haatzmaut', dates: ['2023-04-26', '2024-05-14', '2025-05-01', '2026-04-22', '2027-05-12'] },
  { name: 'Shavuot', id: 'shavuot', dates: ['2023-05-26', '2024-06-12', '2025-06-02', '2026-05-22', '2027-06-11'] },
];

/** More dates read from the same Hebcal lists (2022–2027): the days that move with the weekday, the last day of Hanukkah and some fixed days. */
export const ALSO_PUBLISHED: readonly { name: string; id: string; dates: readonly string[] }[] = [
  { name: 'Yom HaShoah (as observed)', id: 'yom-hashoah', dates: ['2022-04-28', '2023-04-18', '2024-05-06', '2025-04-24', '2026-04-14', '2027-05-04'] },
  { name: 'Yom HaZikaron (as observed)', id: 'yom-hazikaron', dates: ['2022-05-04', '2023-04-25', '2024-05-13', '2025-04-30', '2026-04-21', '2027-05-11'] },
  { name: "Tisha B'Av (as observed; 2022 was postponed from Shabbat)", id: 'tisha-bav', dates: ['2022-08-07', '2023-07-27', '2024-08-13', '2025-08-03', '2026-07-23', '2027-08-12'] },
  { name: 'Jerusalem Day', id: 'jerusalem-day', dates: ['2022-05-29', '2023-05-19', '2024-06-05', '2025-05-26', '2026-05-15', '2027-06-04'] },
  { name: 'Lag BaOmer', id: 'lag-baomer', dates: ['2022-05-19', '2023-05-09', '2024-05-26', '2025-05-16', '2026-05-05', '2027-05-25'] },
  { name: 'Family Day', id: 'family-day', dates: ['2022-02-01', '2023-02-21', '2024-02-09', '2025-02-28', '2026-02-17', '2027-02-07'] },
  { name: 'Hanukkah, day 8', id: 'hanukkah-day-8', dates: ['2022-12-26', '2023-12-15', '2025-01-02', '2025-12-22', '2026-12-12'] },
  { name: 'Tu BiShvat', id: 'tu-bishvat', dates: ['2022-01-17', '2023-02-06', '2024-01-25', '2025-02-13', '2026-02-02', '2027-01-23'] },
  { name: "Tu B'Av", id: 'tu-bav', dates: ['2022-08-12', '2023-08-02', '2024-08-19', '2025-08-09', '2026-07-29', '2027-08-18'] },
  { name: 'Erev Pesach', id: 'erev-pesach', dates: ['2022-04-15', '2023-04-05', '2024-04-22', '2025-04-12', '2026-04-01'] },
  { name: 'Seventh day of Pesach', id: 'pesach-7', dates: ['2022-04-22', '2023-04-12', '2024-04-29', '2025-04-19', '2026-04-08'] },
  { name: 'Shushan Purim', id: 'shushan-purim', dates: ['2022-03-18', '2023-03-08', '2024-03-25', '2025-03-15', '2026-03-04'] },
];
