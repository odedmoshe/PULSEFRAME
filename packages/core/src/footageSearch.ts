/**
 * «חיפוש בצילומים» — the pure functions (wave 7 search track; .artifacts/wave7/search-decisions.md §4). BUILDER A owns this file; the
 * signatures are the lead's.
 *
 * RULES OF THE BODIES
 * - Integer and string operations only; no locale API of any kind and no float time: the editor (Chromium) and the server (Node) give
 *   byte-identical answers (proof S3). Every sort has an explicit comparator in code-point or integer order. Times are exact rationals
 *   from @pulseframe/time, returned in lowest terms.
 * - Text keys through core searchKey (librarySearch.ts, shared with the library track; NFKD, points dropped, final letters as
 *   regular). footageQueryForms adds this track's prefix rule: the token, and the token without up to two leading letters of
 *   ו ה ב ל מ ש כ while at least two letters remain («בנרות» → «נרות»). A HEURISTIC, labelled as one. The same forms are taken of
 *   the words of the footage, so «נרות» finds «בנרות» and «בנרות» finds «נרות». A query form matches a word form when it is a
 *   prefix of it; a form with a prefix taken off matches only a whole word form (so «שמש» does not find every word in «מש…»); and,
 *   for Hebrew forms of at least three letters, when both spell the same without the vowel letters ו and י (core heSkeleton:
 *   pointed spelling «חֲנֻכָּה» → «חנכה» meets full spelling «חנוכה»).
 * - AND semantics: every non-date token matches a word of the item, of its file's name or of its file's event name (and, for the
 *   owner, a pearl's name or a tagged person's name); every date token matches its file's capture date (year, Gregorian or Hebrew
 *   month, Hebrew year, holiday family through capture.ts and hebrewCalendar.ts; a file whose Hebrew day is unsure matches by
 *   either reading). A file without a date matches no date token.
 * - reader 'agent' NEVER reads a pearl's label, a range's people or a person at all (decisions §2: fail-closed whatever the grant):
 *   doc.sourceRanges and doc.people are not touched (footageSearch.test.ts plants getters that throw). The server also hands it the
 *   reader document. reader 'owner' reads them. Only the owner's moments carry a snippet.
 * - Items: a file (whole), a transcript phrase (a segment of the recording's transcript, followed to copies with lineage
 *   transcriptFor; it needs at least one token found in its words), and for the owner a marked range (a pearl or a presence tag; it
 *   needs at least one token found in its name or its people). A transcript hit carries the exact rational span of the words its
 *   tokens found (first word start to last word end, in the file's own time; words outside the file are not read); a phrase timed
 *   only as a whole carries the phrase's span. Pearl hits carry the pearl's span; other hits are whole files (start/end null).
 *   Moments of one file with the same span are one moment with the union of their sources.
 * - Order: spans before whole files, then capture time (dated first), then name (code-point order), then start, ties by asset id,
 *   then end. A score is never part of a moment; "nothing found" is an empty list, never padded.
 */
import * as T from '@pulseframe/time';
import type { ProjectDocument, Transcript } from './schema.ts';
import { FOOTAGE_LIMITS, MOMENT_SOURCES, PICTURE_MIN_RELEVANCE, type Moment, type MomentSource } from './footageSearchContract.ts';
import { heSkeleton, searchKey } from './librarySearch.ts';
import { hebrewDayReadings, parseWall, shownCapture } from './capture.ts';
import { eventDisplayName, eventForCapture, compareWall } from './events.ts';
import { HOLIDAY_FAMILIES, hebrewFromRd, holidaysOn, type HebrewMonth } from './hebrewCalendar.ts';
import { transcriptFor } from './lineage.ts';

/** True once builder A has built the functions of this file. */
export const FOOTAGE_SEARCH_BUILT = true;

// ---------------------------------------------------------------- small exact helpers
const own = <V>(rec: Record<string, V> | undefined, id: string): V | undefined => (rec && Object.hasOwn(rec, id) ? rec[id] : undefined);
/** Code-point order (not UTF-16 code-unit order, not a locale's). */
function cpCmp(a: string, b: string): number {
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i)!, y = b.codePointAt(j)!;
    if (x !== y) return x < y ? -1 : 1;
    i += x > 0xffff ? 2 : 1; j += y > 0xffff ? 2 : 1;
  }
  return i < a.length ? 1 : j < b.length ? -1 : 0;
}
const norm = (t: T.RationalTime): T.RationalTime => { const n = T.normalize(t); return { value: n.value, timescale: n.timescale }; };
const HEBREW_WORD = /^[א-ת]+$/;

// ---------------------------------------------------------------- query forms
const PREFIX_LETTERS = new Set(['ו', 'ה', 'ב', 'ל', 'מ', 'ש', 'כ']);
/** The original form and the forms with one or two prefix letters taken off (at least two letters left); Hebrew words only. */
function formsOfKey(key: string): string[] {
  const out = [key];
  if (!HEBREW_WORD.test(key)) return out;
  const letters = [...key];
  for (let k = 1; k <= 2; k++) {
    if (letters.length - k < 2 || !PREFIX_LETTERS.has(letters[k - 1]!)) break;
    out.push(letters.slice(k).join(''));
  }
  return out;
}
/** The forms a query token is matched by (searchKey'd token first; heuristic prefix forms after). '' gives []. */
export function footageQueryForms(token: string): string[] {
  const key = searchKey(token);
  if (!key) return [];
  // one word per token: a token that searchKey splits (punctuation inside) keeps its words joined, as typed
  return formsOfKey(key.replace(/ /g, ''));
}

// ---------------------------------------------------------------- dates
/**
 * Hebrew month numbers of ParsedFootageQuery: 1 Tishrei … 5 Shevat, 6 Adar (any Adar: of a common year, Adar I or Adar II),
 * 7 Nisan … 12 Elul, 13 Adar I only, 14 Adar II only.
 */
const HEBREW_MONTH_ORDER: readonly HebrewMonth[] = ['tishrei', 'cheshvan', 'kislev', 'tevet', 'shevat', 'adar', 'nisan', 'iyar', 'sivan', 'tammuz', 'av', 'elul', 'adar1', 'adar2'];
type DateToken = ParsedFootageQuery['dates'][number];
const hm = (m: HebrewMonth): DateToken => ({ kind: 'hebrewMonth', month: HEBREW_MONTH_ORDER.indexOf(m) + 1 });
const gm = (month: number): DateToken => ({ kind: 'month', month });
const hol = (family: string): DateToken => ({ kind: 'holiday', family });
/** Our own spellings (the product's month and holiday tables, with common full and defective spellings and English forms). */
const DATE_PHRASES_RAW: readonly [string, DateToken][] = [
  ...([['ינואר', 1], ['פברואר', 2], ['מרץ', 3], ['מרס', 3], ['מארס', 3], ['אפריל', 4], ['מאי', 5], ['יוני', 6], ['יולי', 7], ['אוגוסט', 8], ['ספטמבר', 9], ['אוקטובר', 10], ['נובמבר', 11], ['דצמבר', 12],
    ['january', 1], ['february', 2], ['march', 3], ['april', 4], ['may', 5], ['june', 6], ['july', 7], ['august', 8], ['september', 9], ['october', 10], ['november', 11], ['december', 12]] as const)
    .map(([w, m]): [string, DateToken] => [w, gm(m)]),
  ...([['תשרי', 'tishrei'], ['חשון', 'cheshvan'], ['חשוון', 'cheshvan'], ['מרחשון', 'cheshvan'], ['מרחשוון', 'cheshvan'], ['כסלו', 'kislev'], ['כסליו', 'kislev'], ['טבת', 'tevet'], ['שבט', 'shevat'],
    ['אדר', 'adar'], ['אדר א', 'adar1'], ['אדר ראשון', 'adar1'], ['אדר ב', 'adar2'], ['אדר שני', 'adar2'], ['ניסן', 'nisan'], ['אייר', 'iyar'], ['איר', 'iyar'], ['סיון', 'sivan'], ['סיוון', 'sivan'],
    ['תמוז', 'tammuz'], ['אב', 'av'], ['אלול', 'elul'],
    ['tishrei', 'tishrei'], ['tishri', 'tishrei'], ['cheshvan', 'cheshvan'], ['heshvan', 'cheshvan'], ['marcheshvan', 'cheshvan'], ['kislev', 'kislev'], ['tevet', 'tevet'], ['shevat', 'shevat'], ['shvat', 'shevat'],
    ['adar', 'adar'], ['adar i', 'adar1'], ['adar 1', 'adar1'], ['adar ii', 'adar2'], ['adar 2', 'adar2'], ['nisan', 'nisan'], ['iyar', 'iyar'], ['sivan', 'sivan'], ['tammuz', 'tammuz'], ['tamuz', 'tammuz'], ['elul', 'elul']] as const)
    .map(([w, m]): [string, DateToken] => [w, hm(m)]),
  ...Object.entries(HOLIDAY_FAMILIES).flatMap(([family, n]): [string, DateToken][] => [[n.he, hol(family)], [n.en, hol(family)]]),
  ...([['חנכה', 'hanukkah'], ['chanukah', 'hanukkah'], ['chanukkah', 'hanukkah'], ['hanukah', 'hanukkah'], ['יום כפור', 'yom-kippur'], ['כיפור', 'yom-kippur'], ['כפור', 'yom-kippur'],
    ['סכות', 'sukkot'], ['succot', 'sukkot'], ['sukkos', 'sukkot'], ['שבעות', 'shavuot'], ['ליל הסדר', 'pesach'], ['passover', 'pesach'], ['עצמאות', 'yom-haatzmaut'],
    ['rosh hashanah', 'rosh-hashana'], ['ראש השנה', 'rosh-hashana']] as const).map(([w, f]): [string, DateToken] => [w, hol(f)]),
];
/** Phrases as searchKey'd words, longest first, then code-point order (deterministic). */
const DATE_PHRASES: readonly { words: string[]; date: DateToken }[] = (() => {
  const seen = new Set<string>();
  const out: { words: string[]; date: DateToken }[] = [];
  for (const [text, date] of DATE_PHRASES_RAW) {
    const key = searchKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ words: key.split(' '), date });
  }
  return out.sort((a, b) => b.words.length - a.words.length || cpCmp(a.words.join(' '), b.words.join(' ')));
})();
/** Hebrew numeral letter values (final forms as their base letters). */
const LETTER_VALUE: Readonly<Record<string, number>> = {
  'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9, 'י': 10, 'כ': 20, 'ך': 20, 'ל': 30, 'מ': 40, 'ם': 40, 'נ': 50, 'ן': 50, 'ס': 60, 'ע': 70,
  'פ': 80, 'ף': 80, 'צ': 90, 'ץ': 90, 'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400,
};
/** Hebrew years a capture can fall in (captures are 1900–2100). */
const HEBREW_YEAR_MIN = 5660, HEBREW_YEAR_MAX = 5861;
/**
 * A Hebrew year written in letters with gershayim before the last letter («תשפ״ה», «ה׳תשפ״ה», ASCII quotes too), or null. Up to two
 * leading prefix letters («בתשפ״ה») and the thousands letter ה are taken off when the letter after them is larger (numerals are
 * written largest first).
 */
function hebrewYearOf(raw: string): number | null {
  const s = raw.normalize('NFKD').replace(/[֑-ׇ]/g, '');
  if (!/^[א-ת]+['׳]?[א-ת]*["״][א-ת]$/.test(s)) return null;
  const letters = [...s.replace(/['"׳״]/g, '')];
  for (let k = 0; k < 3 && letters.length > 2 && (PREFIX_LETTERS.has(letters[0]!)) && LETTER_VALUE[letters[0]!]! < LETTER_VALUE[letters[1]!]!; k++) letters.shift();
  let sum = 0;
  for (let i = 0; i < letters.length; i++) {
    const v = LETTER_VALUE[letters[i]!]!;
    if (i > 0 && v > LETTER_VALUE[letters[i - 1]!]!) return null;
    sum += v;
  }
  const year = 5000 + sum;
  return year >= HEBREW_YEAR_MIN && year <= HEBREW_YEAR_MAX ? year : null;
}
/** A date name matched by a word: its own key, or a form with prefix letters taken off that keeps at least three letters («בחנוכה», «בדצמבר»). */
function dateWordMatches(word: string, name: string): boolean {
  if (word === name) return true;
  return formsOfKey(word).slice(1).some((f) => f === name && [...f].length >= 3);
}

/** A query split into date tokens (years, months, Hebrew years, holiday families) and word tokens (each with its forms). */
export interface ParsedFootageQuery {
  words: { token: string; forms: string[] }[];
  /** month: Gregorian 1–12. hebrewMonth: 1 Tishrei … 5 Shevat, 6 any Adar, 7 Nisan … 12 Elul, 13 Adar I, 14 Adar II. family: a key of HOLIDAY_FAMILIES. */
  dates: ({ kind: 'year'; year: number } | { kind: 'month'; month: number } | { kind: 'hebrewYear'; year: number } | { kind: 'hebrewMonth'; month: number } | { kind: 'holiday'; family: string })[];
}
export function parseFootageQuery(query: string): ParsedFootageQuery {
  const words: ParsedFootageQuery['words'] = [];
  const dates: ParsedFootageQuery['dates'] = [];
  const keys: string[] = [];
  const flush = () => {
    for (let i = 0; i < keys.length;) {
      const phrase = DATE_PHRASES.find((p) => i + p.words.length <= keys.length && dateWordMatches(keys[i]!, p.words[0]!) && p.words.every((w, k) => k === 0 || keys[i + k] === w));
      if (phrase) { dates.push({ ...phrase.date }); i += phrase.words.length; continue; }
      const key = keys[i]!;
      const year = /^\d{4}$/.test(key) ? Number(key) : NaN;
      if (year >= 1900 && year <= 2100) dates.push({ kind: 'year', year });
      else words.push({ token: key, forms: formsOfKey(key) });
      i++;
    }
    keys.length = 0;
  };
  for (const raw of query.split(/\s+/)) {
    if (!raw) continue;
    const hy = hebrewYearOf(raw);
    if (hy !== null) { flush(); dates.push({ kind: 'hebrewYear', year: hy }); continue; }
    const key = searchKey(raw);
    if (key) keys.push(...key.split(' '));
  }
  flush();
  return { words, dates };
}

// ---------------------------------------------------------------- matching
interface WordIndex { forms: (w: string) => string[]; skeleton: (f: string) => string | null }
function makeIndex(): WordIndex {
  const formCache = new Map<string, string[]>();
  const skelCache = new Map<string, string | null>();
  return {
    forms: (w) => { let f = formCache.get(w); if (!f) { f = formsOfKey(w); formCache.set(w, f); } return f; },
    skeleton: (f) => {
      let s = skelCache.get(f);
      if (s === undefined) { s = HEBREW_WORD.test(f) && [...f].length >= 3 ? heSkeleton(f) : null; skelCache.set(f, s); }
      return s;
    },
  };
}
/** Does a query token (its forms; forms[0] the original) match a word of the footage? */
function tokenMatchesWord(ix: WordIndex, forms: readonly string[], word: string): boolean {
  const wf = ix.forms(word);
  for (let q = 0; q < forms.length; q++) {
    const qf = forms[q]!, qs = ix.skeleton(qf);
    for (const f of wf) {
      if (q === 0 ? f.startsWith(qf) : f === qf) return true;
      if (qs !== null && qs === ix.skeleton(f)) return true;
    }
  }
  return false;
}
const anyWord = (ix: WordIndex, forms: readonly string[], words: readonly string[]) => words.some((w) => tokenMatchesWord(ix, forms, w));
const wordsOf = (text: string): string[] => { const k = searchKey(text); return k ? k.split(' ') : []; };
const nameWithoutExtension = (name: string) => name.replace(/\.[A-Za-z0-9]{1,8}$/, '');

interface DateFacts { gy: number; gm: number; hYears: Set<number>; hMonths: Set<HebrewMonth>; families: Set<string> }
function dateFactsOf(doc: ProjectDocument, assetId: string): DateFacts | null {
  const shown = shownCapture(doc, assetId);
  if (!shown) return null;
  try {
    const w = parseWall(shown.wall);
    const event = eventForCapture(doc, assetId);
    const facts: DateFacts = { gy: w.date.y, gm: w.date.m, hYears: new Set(), hMonths: new Set(), families: new Set() };
    for (const r of hebrewDayReadings(shown.capture, shown.wall, event ? event.afterSunset : null)) {
      const h = hebrewFromRd(r.rd);
      facts.hYears.add(h.y); facts.hMonths.add(h.m);
      for (const x of holidaysOn(r.rd, r.part)) facts.families.add(x.family);
    }
    return facts;
  } catch { return null; }
}
function dateMatches(f: DateFacts, d: DateToken): boolean {
  switch (d.kind) {
    case 'year': return f.gy === d.year;
    case 'month': return f.gm === d.month;
    case 'hebrewYear': return f.hYears.has(d.year);
    case 'hebrewMonth': {
      const m = HEBREW_MONTH_ORDER[d.month - 1];
      if (m === 'adar') return f.hMonths.has('adar') || f.hMonths.has('adar1') || f.hMonths.has('adar2');
      return m !== undefined && f.hMonths.has(m);
    }
    case 'holiday': return f.families.has(d.family);
  }
}

// ---------------------------------------------------------------- the search
export interface FootageSearchOptions {
  /** who the answer is for: 'agent' never reads pearl names, tags or people */
  reader: 'owner' | 'agent';
  /** moments at most (FOOTAGE_LIMITS.defaultResults when absent) */
  limit?: number;
}
interface Found { m: Moment; wall: string | null; name: string }
const SNIPPET_MAX = 200;
function snippetOf(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  let out = '';
  for (const ch of t) { if (out.length + ch.length > SNIPPET_MAX) break; out += ch; }
  return out;
}
const sourcesInOrder = (s: Set<MomentSource>): MomentSource[] => MOMENT_SOURCES.filter((x) => s.has(x));
function cmpTimeOrNull(a: T.RationalTime | null, b: T.RationalTime | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  return T.cmp(a, b);
}

/** The no-model section of an answer, on the document the caller may read. An empty list is an honest "nothing found". */
export function searchFootage(doc: ProjectDocument, query: string, opts: FootageSearchOptions): Moment[] {
  const limitIn = opts.limit ?? FOOTAGE_LIMITS.defaultResults;
  if (!Number.isInteger(limitIn) || limitIn < 1) throw new RangeError('limit is a whole number of at least 1');
  const limit = limitIn > FOOTAGE_LIMITS.maxResults ? FOOTAGE_LIMITS.maxResults : limitIn;
  const owner = opts.reader === 'owner';
  if (!owner && opts.reader !== 'agent') throw new RangeError('reader is owner or agent');
  const q = parseFootageQuery(query);
  if (!q.words.length && !q.dates.length) return [];
  const ix = makeIndex();
  const tokens = q.words.map((w) => w.forms);
  // owner only: the marked ranges by file, and the names of people. An agent's search never touches these fields.
  const rangesByAsset = new Map<string, { label: string; people: string[]; span: { start: T.RationalTime; end: T.RationalTime } | null }[]>();
  if (owner) {
    const ranges = doc.sourceRanges ?? {};
    const people = doc.people ?? {};
    for (const id of Object.keys(ranges).sort(cpCmp)) {
      const r = ranges[id]!;
      const names = (r.people ?? []).flatMap((p) => { const person = own(people, p); return person ? wordsOf(person.name) : []; });
      const list = rangesByAsset.get(r.assetId) ?? [];
      list.push({ label: r.label, people: names, span: r.span ? { start: r.span.start, end: r.span.end } : null });
      rangesByAsset.set(r.assetId, list);
    }
  }
  const found: Found[] = [];
  for (const assetId of Object.keys(doc.assets).sort(cpCmp)) {
    const asset = doc.assets[assetId]!;
    if (asset.kind === 'lut') continue;
    if (q.dates.length) {
      const facts = dateFactsOf(doc, assetId);
      if (!facts || !q.dates.every((d) => dateMatches(facts, d))) continue;
    }
    const wall = shownCapture(doc, assetId)?.wall ?? null;
    const nameWords = wordsOf(nameWithoutExtension(asset.name));
    const event = eventForCapture(doc, assetId);
    const eventWords = event ? [...new Set([...wordsOf(eventDisplayName(doc, event, 'he').name), ...wordsOf(eventDisplayName(doc, event, 'en').name)])] : [];
    const inName = tokens.map((f) => anyWord(ix, f, nameWords));
    const inEvent = tokens.map((f) => anyWord(ix, f, eventWords));
    const push = (start: T.RationalTime | null, end: T.RationalTime | null, sources: Set<MomentSource>, snippet?: string) => {
      if (q.dates.length) sources.add('date');
      const m: Moment = { assetId, start: start && norm(start), end: end && norm(end), sources: sourcesInOrder(sources) };
      if (owner && snippet !== undefined) m.snippet = snippet;
      found.push({ m, wall, name: asset.name });
    };
    // the file as a whole
    if (tokens.every((_, i) => inName[i] || inEvent[i])) {
      const s = new Set<MomentSource>();
      for (let i = 0; i < tokens.length; i++) { if (inName[i]) s.add('name'); if (inEvent[i]) s.add('event'); }
      push(null, null, s);
    }
    if (!tokens.length) continue; // a date-only query finds files, not phrases or pearls
    // transcript phrases, in the file's own time
    const tf = transcriptFor(doc, assetId);
    if (tf) for (const seg of (tf.transcript as Transcript).segments) {
      const timed = seg.words.length
        ? seg.words.map((w) => ({ words: wordsOf(w.text), start: T.sub(w.start, tf.offset), end: T.sub(T.add(w.start, w.duration), tf.offset) }))
        : [{ words: wordsOf(seg.text), start: T.sub(seg.start, tf.offset), end: T.sub(T.add(seg.start, seg.duration), tf.offset) }];
      const inside = timed.filter((w) => !T.isNegative(w.start) && T.lte(w.end, asset.duration) && T.lte(w.start, w.end));
      if (!inside.length) continue;
      let start: T.RationalTime | null = null, end: T.RationalTime | null = null, ok = true;
      const sources = new Set<MomentSource>();
      for (let i = 0; i < tokens.length && ok; i++) {
        let hit = false;
        for (const w of inside) {
          if (!anyWord(ix, tokens[i]!, w.words)) continue;
          hit = true;
          if (start === null || T.lt(w.start, start)) start = w.start;
          if (end === null || T.lt(end, w.end)) end = w.end;
        }
        if (hit) sources.add('transcript');
        if (inName[i]) sources.add('name');
        if (inEvent[i]) sources.add('event');
        ok = hit || inName[i]! || inEvent[i]!;
      }
      if (ok && start !== null && end !== null) push(start, end, sources, snippetOf(seg.text));
    }
    // marked ranges (owner only; rangesByAsset is empty for an agent)
    for (const r of rangesByAsset.get(assetId) ?? []) {
      const labelWords = wordsOf(r.label);
      const sources = new Set<MomentSource>();
      let ok = true;
      for (let i = 0; i < tokens.length && ok; i++) {
        const inLabel = anyWord(ix, tokens[i]!, labelWords), inPeople = anyWord(ix, tokens[i]!, r.people);
        if (inLabel) sources.add('pearl');
        if (inPeople) sources.add('person');
        if (inName[i]) sources.add('name');
        if (inEvent[i]) sources.add('event');
        ok = inLabel || inPeople || inName[i]! || inEvent[i]!;
      }
      if (ok && (sources.has('pearl') || sources.has('person'))) push(r.span ? r.span.start : null, r.span ? r.span.end : null, sources, r.label ? snippetOf(r.label) : undefined);
    }
  }
  // one moment per (file, span): the union of its sources; the first snippet in item order
  const merged = new Map<string, Found>();
  for (const f of found) {
    const key = `${f.m.assetId}|${f.m.start ? `${f.m.start.value}/${f.m.start.timescale}` : '-'}|${f.m.end ? `${f.m.end.value}/${f.m.end.timescale}` : '-'}`;
    const prev = merged.get(key);
    if (!prev) { merged.set(key, f); continue; }
    prev.m.sources = sourcesInOrder(new Set([...prev.m.sources, ...f.m.sources]));
    if (prev.m.snippet === undefined && f.m.snippet !== undefined) prev.m.snippet = f.m.snippet;
  }
  const list = [...merged.values()].sort((a, b) => {
    const spanA = a.m.start !== null ? 0 : 1, spanB = b.m.start !== null ? 0 : 1;
    if (spanA !== spanB) return spanA - spanB;
    if (a.wall !== b.wall) { if (a.wall === null) return 1; if (b.wall === null) return -1; const c = compareWall(a.wall, b.wall); if (c) return c; }
    return cpCmp(a.name, b.name) || cmpTimeOrNull(a.m.start, b.m.start) || cpCmp(a.m.assetId, b.m.assetId) || cmpTimeOrNull(a.m.end, b.m.end);
  });
  return list.slice(0, limit).map((f) => f.m);
}

// ---------------------------------------------------------------- picture search helpers
const checkRate = (rate: { num: number; den: number }) => {
  if (!Number.isSafeInteger(rate.num) || !Number.isSafeInteger(rate.den) || rate.num <= 0 || rate.den <= 0) throw new RangeError('a frame rate is two positive whole numbers');
};
/** The source frame indices sampled from a video: k_s = ceil(s · rate) for s = 0, 1, 2, … while k_s < frameCount (exact). */
export function sampleFrameTargets(rate: { num: number; den: number }, frameCount: number): number[] {
  checkRate(rate);
  if (!Number.isSafeInteger(frameCount) || frameCount < 0) throw new RangeError('a frame count is a whole number of at least 0');
  const num = BigInt(rate.num), den = BigInt(rate.den), n = BigInt(frameCount), step = BigInt(FOOTAGE_LIMITS.sampleEverySeconds);
  const out: number[] = [];
  for (let s = 0n; ; s += step) {
    const k = (s * num + den - 1n) / den; // ceil(s · num / den), s ≥ 0
    if (k >= n) break;
    const kn = Number(k);
    if (out.length === 0 || out[out.length - 1] !== kn) out.push(kn); // below one frame per second two seconds can share a frame
  }
  return out;
}

/**
 * int8 quantisation of a unit vector: scale = max|v| / 127, q = round half away from zero of v / scale (written out, not Math.round).
 * An all-zero vector gives scale 0 and zeros. RangeError for a value that is not finite.
 */
export function quantiseInt8(v: Float32Array): { scale: number; q: Int8Array } {
  let max = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i]!;
    if (!Number.isFinite(x)) throw new RangeError('a vector to quantise holds only finite numbers');
    const a = x < 0 ? -x : x;
    if (a > max) max = a;
  }
  const q = new Int8Array(v.length);
  if (max === 0) return { scale: 0, q };
  const scale = max / 127;
  for (let i = 0; i < v.length; i++) {
    const x = v[i]! / scale, a = x < 0 ? -x : x;
    let r = Math.floor(a + 0.5);
    if (r > 127) r = 127;
    q[i] = x < 0 ? -r : r;
  }
  return { scale, q };
}
/** The integer dot product of two int8 vectors of the same length (exact in a JS number for 768 dims). */
export function int8Dot(a: Int8Array, b: Int8Array): number {
  if (a.length !== b.length) throw new RangeError('int8Dot needs two vectors of one length');
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** A scored frame of the picture index (relevance = the model's own sigmoid, already above PICTURE_MIN_RELEVANCE). */
export interface PictureHit { assetId: string; frame: number; relevance: number }
/**
 * Moments from scored frames: the best FOOTAGE_LIMITS.topFrames; frames of one file closer than mergeGapSeconds merged; span =
 * [first − pad, last + pad] clamped to [0, duration] and snapped OUTWARD to project frames of `projectRate`; `frame` = the best frame;
 * at most `limit` by best relevance, ties by (assetId, start). sources ['picture'].
 * A hit below PICTURE_MIN_RELEVANCE, of a file that is not a video of `doc` (removed since the scan) or of a frame the file does not
 * have is not used. When the outward snap would leave the file, the end is the last project frame edge inside it; a file shorter than
 * one project frame gives the whole file (start/end null). The relevance orders and is never part of a moment.
 */
export function mergePictureHits(doc: ProjectDocument, hits: readonly PictureHit[], projectRate: { num: number; den: number }, limit: number): Moment[] {
  checkRate(projectRate);
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit is a whole number of at least 1');
  const best = new Map<string, PictureHit>();
  for (const h of hits) {
    if (!Number.isFinite(h.relevance)) throw new RangeError('a relevance is a finite number');
    if (!Number.isSafeInteger(h.frame) || h.frame < 0) throw new RangeError('a frame is a whole number of at least 0');
    if (h.relevance < PICTURE_MIN_RELEVANCE) continue;
    const asset = own(doc.assets, h.assetId);
    if (!asset || asset.kind !== 'video' || !asset.video) continue;
    if (asset.video.frameCount !== null && h.frame >= asset.video.frameCount) continue;
    const key = `${h.assetId}|${h.frame}`;
    const prev = best.get(key);
    if (!prev || h.relevance > prev.relevance) best.set(key, h);
  }
  const top = [...best.values()].sort((a, b) => (b.relevance - a.relevance) || cpCmp(a.assetId, b.assetId) || a.frame - b.frame).slice(0, FOOTAGE_LIMITS.topFrames);
  const byAsset = new Map<string, PictureHit[]>();
  for (const h of top) { const l = byAsset.get(h.assetId) ?? []; l.push(h); byAsset.set(h.assetId, l); }
  const gap = T.rt(FOOTAGE_LIMITS.mergeGapSeconds, 1), pad = T.rt(FOOTAGE_LIMITS.padSeconds, 1);
  const groups: { m: Moment; relevance: number }[] = [];
  for (const [assetId, list] of byAsset) {
    const asset = doc.assets[assetId]!, video = asset.video!;
    const origin = video.startTime ?? T.ZERO;
    const timeOf = (frame: number) => T.add(origin, T.frameTime(frame, video.frameRate));
    list.sort((a, b) => a.frame - b.frame);
    let cur: PictureHit[] = [];
    const close = () => {
      if (!cur.length) return;
      let top1 = cur[0]!;
      for (const h of cur) if (h.relevance > top1.relevance) top1 = h;
      let s = T.sub(timeOf(cur[0]!.frame), pad), e = T.add(timeOf(cur[cur.length - 1]!.frame), pad);
      if (T.isNegative(s)) s = T.ZERO;
      if (T.lt(asset.duration, e)) e = asset.duration;
      let start: T.RationalTime | null = T.frameTime(T.frameIndexAt(s, projectRate), projectRate);
      const endIndex = T.isFrameAligned(e, projectRate) ? T.frameIndexAt(e, projectRate) : T.frameIndexAt(e, projectRate) + 1;
      let end: T.RationalTime | null = T.frameTime(endIndex, projectRate);
      if (T.lt(asset.duration, end)) end = T.frameTime(T.frameIndexAt(asset.duration, projectRate), projectRate);
      if (!T.lt(start, end)) { start = null; end = null; }
      groups.push({ m: { assetId, start: start && norm(start), end: end && norm(end), sources: ['picture'], frame: top1.frame }, relevance: top1.relevance });
      cur = [];
    };
    for (const h of list) {
      if (cur.length && !T.lt(T.sub(timeOf(h.frame), timeOf(cur[cur.length - 1]!.frame)), gap)) close();
      cur.push(h);
    }
    close();
  }
  return groups
    .sort((a, b) => (b.relevance - a.relevance) || cpCmp(a.m.assetId, b.m.assetId) || cmpTimeOrNull(a.m.start, b.m.start))
    .slice(0, limit)
    .map((g) => g.m);
}
