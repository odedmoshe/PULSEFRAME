/**
 * The local assistant's grounding and phrases (wave 7; .artifacts/wave7/assistant-decisions.md §4–§5 builder A).
 *
 * groundLocalAnswer: what the owner did not say is dropped (never guessed, rounded or defaulted). localPhrase: a ROUND-TRIP table —
 * every intent × every combination of the table's slot values, Hebrew and English — read back by the existing grammar: the same
 * family reads every word with ONE reading set whose values are exactly the slots (numbers compared as exact rationals, text
 * verbatim), and interpret(phrase, ctxFor(intent)) answers that intent (a phrase missing a required slot is the grammar's own
 * 'incomplete' question).
 */
import { describe, expect, it } from 'vitest';
import { LOCAL_INTENT_SLOTS, LOCAL_INTENTS, type LocalAnswer, type LocalIntent, type LocalSlotName, type LocalSlots } from '../assistantContract.ts';
import type { BarExact, IntentId } from '../commandBarContract.ts';
import { interpret } from './index.ts';
import { FAMILIES } from './lexicon.ts';
import { parseFamily, tokenizeBar, type SpeedSpec, type TimeSpec } from './match.ts';
import { exFromDecimal, exText } from './numbers.ts';
import { readingSets } from './plans.ts';
import { ctxFor } from './fixture.testFixture.ts';
import { barUnderstands } from './understands.ts';
import { groundLocalAnswer, localMissing, localPhrase, LOCAL_INTENT_BUILT } from './localIntent.ts';

const ground = (request: string, intent: LocalAnswer['intent'], slots: LocalSlots) => groundLocalAnswer(request, { intent, slots });

describe('groundLocalAnswer: numbers and times', () => {
  it('is built', () => expect(LOCAL_INTENT_BUILT).toBe(true));
  it('keeps a number the grammar reads in the request, in words or digits, Hebrew or English', () => {
    expect(ground('המוזיקה חזקה מדי, תורידי אותה בשש דציבל', 'gain_change', { target: 'music', dir: 'down', db: '6' })).toEqual({ intent: 'gain_change', slots: { target: 'music', dir: 'down', db: '6' }, dropped: [] });
    expect(ground('תנמיך את הקליפ בארבעה', 'gain_change', { target: 'clip', dir: 'down', db: '4' }).slots.db).toBe('4');
    expect(ground('make the music quieter by six', 'gain_change', { db: '6', target: 'music', dir: 'down' }).slots.db).toBe('6');
    expect(ground('make the music quieter by 6 dB', 'gain_change', { db: '6' }).slots.db).toBe('6');
    expect(ground('שהקליפ ירוץ בחצי מהירות', 'speed', { factor: '0.5' }).slots).toEqual({ factor: '0.5' });
    expect(ground('תריץ את זה פי שתיים', 'speed', { factor: '2' }).slots).toEqual({ factor: '2' });
    expect(ground('תאיץ אותו פי 1.25', 'speed', { factor: '1.25' }).slots).toEqual({ factor: '1.25' });
  });
  it('keeps a time the grammar reads, in seconds: «שנייה וחצי» is 1.5, «חצי שנייה» 0.5, «דקה וחצי» 90, «שעתיים» 7200', () => {
    expect(ground('תקפיא את התמונה לשנייה וחצי', 'freeze', { forSeconds: '1.5' }).slots).toEqual({ forSeconds: '1.5' });
    expect(ground('תקפיא את התמונה לשנייה וחצי', 'freeze', { forSeconds: '1.50' }).slots).toEqual({ forSeconds: '1.50' }); // the answer's own string, same exact value
    expect(ground('שהתמונה תיכנס בהדרגה בחצי שנייה', 'fades', { edge: 'in', forSeconds: '0.5' }).slots).toEqual({ edge: 'in', forSeconds: '0.5' });
    expect(ground('תקפוץ לדקה וחצי מההתחלה', 'seek', { atSeconds: '90' }).slots).toEqual({ atSeconds: '90' });
    expect(ground('תפצל לי את זה בשנייה שמונה', 'split_at', { atSeconds: '8' }).slots).toEqual({ atSeconds: '8' });
    expect(ground('jump to second 20', 'seek', { atSeconds: '20' }).slots).toEqual({ atSeconds: '20' });
    expect(ground('תעבור ל־1:10', 'seek', { atSeconds: '70' }).slots).toEqual({ atSeconds: '70' });
    expect(ground('תקפיא את זה לשעתיים', 'freeze', { forSeconds: '7200' }).slots).toEqual({ forSeconds: '7200' });
    expect(ground('הכותרת תהיה 29.97 שניות', 'add_title', { forSeconds: '29.97' }).slots).toEqual({ forSeconds: '29.97' });
  });
  it('drops what the owner did not say: a guessed amount, a rounded or changed value, a number without a time unit, an ordinal the grammar asks about', () => {
    const cases: [string, LocalAnswer['intent'], LocalSlots, LocalSlotName][] = [
      ['תורידי קצת את המוזיקה', 'gain_change', { target: 'music', dir: 'down', db: '3' }, 'db'], // «קצת» is not a number
      ['תוריד את המוזיקה בשש דציבל', 'gain_change', { target: 'music', dir: 'down', db: '6.5' }, 'db'],
      ['תקפיא את התמונה לשנייה וחצי', 'freeze', { forSeconds: '2' }, 'forSeconds'], // never rounded
      ['תקפיא את התמונה לשנייה וחצי', 'freeze', { forSeconds: '0.5' }, 'forSeconds'], // «וחצי» alone is not the time said
      ['תקפיא את התמונה לשנייה וחצי', 'freeze', { forSeconds: '1' }, 'forSeconds'],
      ['תחתוך בשנייה הרביעית', 'split_at', { atSeconds: '4' }, 'atSeconds'], // the start of the 4th second or the 4 s mark: asked
      ['תחתוך בשנייה הרביעית', 'split_at', { atSeconds: '3' }, 'atSeconds'],
      ['תקפוץ לעשר', 'seek', { atSeconds: '10' }, 'atSeconds'], // ten what? a bare number grounds no time
      ['תקפיא את זה לשלושה פריימים', 'freeze', { forSeconds: '0.1' }, 'forSeconds'], // frames are not seconds
      ['תאט את הקליפ', 'speed', { factor: '0.5' }, 'factor'],
      ['תוסיף כותרת "יום הולדת 5"', 'add_title', { text: 'יום הולדת 5', atSeconds: '5' }, 'atSeconds'], // a number inside the quoted title is not a time
      ['תוריד את המוזיקה ב־1,5 דציבל', 'gain_change', { target: 'music', dir: 'down', db: '1.5' }, 'db'], // «1,5» is ambiguous: asked
      ['תוריד את המוזיקה ב־29.97 דציבל', 'gain_change', { target: 'music', dir: 'down', db: '29.9' }, 'db'],
    ];
    for (const [text, intent, slots, gone] of cases) {
      const g = ground(text, intent, slots);
      expect(g.dropped, text).toContainEqual({ slot: gone, why: 'ungrounded' });
      expect(g.slots[gone], text).toBeUndefined();
      expect(g.intent).toBe(intent);
    }
  });
  it('compares decimal strings exactly (no float that loses digits)', () => {
    expect(ground('תוריד את המוזיקה ב־0.1 דציבל', 'gain_change', { db: '0.1' }).slots.db).toBe('0.1');
    expect(ground('תוריד את המוזיקה ב־0.3 דציבל', 'gain_change', { db: '0.30' }).slots.db).toBe('0.30');
    expect(ground('תוריד את המוזיקה ב־123456.789 דציבל', 'gain_change', { db: '123456.789' }).slots.db).toBe('123456.789');
    expect(ground('תוריד את המוזיקה ב־123456.789 דציבל', 'gain_change', { db: '123456.788' }).dropped).toEqual([{ slot: 'db', why: 'ungrounded' }]);
    expect(ground('תוריד את המוזיקה ב־0.1 דציבל', 'gain_change', { db: '0.10000000000000001' }).dropped).toEqual([{ slot: 'db', why: 'malformed' }]);
  });
  it('drops a number outside LOCAL_DECIMAL as malformed', () => {
    for (const bad of ['6.', '.5', '-3', '1e3', '6 dB', '1,5', '1234567', '0.1234', '٦', '', ' 6']) {
      expect(ground('תוריד את המוזיקה בשש דציבל', 'gain_change', { db: bad }).dropped, bad).toEqual([{ slot: 'db', why: 'malformed' }]);
    }
  });
});

describe('groundLocalAnswer: text, enums, intents', () => {
  it('keeps a text that is an exact substring of the NFC request; drops a changed or invented one', () => {
    expect(ground('תשים כיתוב "יום הולדת 5" בשנייה 3', 'add_title', { text: 'יום הולדת 5', atSeconds: '3' })).toEqual({ intent: 'add_title', slots: { text: 'יום הולדת 5', atSeconds: '3' }, dropped: [] });
    expect(ground('תקרא לפרויקט גן רימון', 'rename_project', { text: 'גן רימון' }).slots).toEqual({ text: 'גן רימון' });
    expect(ground('תקרא לפרויקט גן רימון', 'rename_project', { text: 'גן הרימון' }).dropped).toEqual([{ slot: 'text', why: 'ungrounded' }]);
    expect(ground('תוסיף כותרת', 'add_title', { text: 'מזל טוב' }).dropped).toEqual([{ slot: 'text', why: 'ungrounded' }]);
    expect(ground('add a title Happy birthday', 'add_title', { text: 'happy birthday' }).dropped).toEqual([{ slot: 'text', why: 'ungrounded' }]); // case is kept as typed
    // NFC: a request typed decomposed still grounds the composed text; a slot that differs only by niqqud does not
    const decomposed = 'שם הפרויקט: Café'.normalize('NFD');
    expect(ground(decomposed, 'rename_project', { text: 'Café' }).slots).toEqual({ text: 'Café' });
    expect(ground('תקרא לפרויקט שלום', 'rename_project', { text: 'שָׁלוֹם' }).dropped).toEqual([{ slot: 'text', why: 'ungrounded' }]);
  });
  it('keeps a text that itself holds a number or a command word, and Hebrew abbreviations with geresh and gershayim', () => {
    for (const text of ['חתוך כאן בשנייה 3', 'הנמך את המוזיקה', 'צה״ל וג׳ירפה', "Noa's 5th birthday", '29.97']) {
      expect(ground(`תוסיף כותרת שאומרת ${text} בבקשה`, 'add_title', { text }).slots, text).toEqual({ text });
    }
  });
  it('drops a text with a quote, control or format character, a space at an edge, or over the limit, as malformed', () => {
    const req = 'כותרת "מזל טוב" ‏«שלום» a\tb x"y א״ ״א ‮abc ‍z';
    for (const bad of ['"מזל טוב"', '«שלום»', 'a\tb', 'x"y', 'א״', '״א', '‮abc', 'z‍', ' מזל', 'מזל ', '', 'א'.repeat(81), "'quoted'", 'line two']) {
      expect(ground(req + bad, 'add_title', { text: bad }).dropped, JSON.stringify(bad)).toEqual([{ slot: 'text', why: 'malformed' }]);
    }
    expect(ground('א'.repeat(80), 'add_title', { text: 'א'.repeat(80) }).slots.text).toHaveLength(80);
  });
  it('drops a slot the intent does not take; none stays none and keeps nothing; enums must be the vocabulary\'s', () => {
    expect(ground('תמחק את הקליפ בשש', 'delete_clip', { db: '6' })).toEqual({ intent: 'delete_clip', slots: {}, dropped: [{ slot: 'db', why: 'not_for_intent' }] });
    expect(ground('תעשה את זה יפה למוזיקה', 'none', { target: 'music', text: 'יפה' })).toEqual({ intent: 'none', slots: {}, dropped: [{ slot: 'target', why: 'not_for_intent' }, { slot: 'text', why: 'not_for_intent' }] });
    expect(ground('השתק', 'mute', { target: 'music' }).slots).toEqual({ target: 'music' }); // enums are not grounded in the words
    expect(ground('השתק', 'mute', { target: 'master' as 'music' }).dropped).toEqual([{ slot: 'target', why: 'malformed' }]);
    expect(ground('לך', 'seek', { at: 'middle' as 'start' }).dropped).toEqual([{ slot: 'at', why: 'malformed' }]);
  });
  it('keeps one position: the time said wins over a position word beside it', () => {
    expect(ground('תקפוץ לשנייה 10', 'seek', { at: 'start', atSeconds: '10' })).toEqual({ intent: 'seek', slots: { atSeconds: '10' }, dropped: [{ slot: 'at', why: 'not_for_intent' }] });
    expect(ground('תקפוץ להתחלה', 'seek', { at: 'start', atSeconds: '10' })).toEqual({ intent: 'seek', slots: { at: 'start' }, dropped: [{ slot: 'atSeconds', why: 'ungrounded' }] });
  });
  it('never adds or changes a value (a property over every slot)', () => {
    const answers: LocalAnswer[] = [
      { intent: 'add_title', slots: { text: 'מזל טוב', at: 'start', forSeconds: '4' } }, { intent: 'gain_change', slots: { target: 'clip', dir: 'up', db: '3' } },
      { intent: 'fades', slots: { edge: 'out', forSeconds: '2' } }, { intent: 'export_to', slots: { destination: 'reels', text: 'x' } },
    ];
    for (const a of answers) for (const req of ['', 'מזל טוב בהתחלה לארבע שניות', 'שלוש דציבל', 'שתי שניות', 'x']) {
      const g = ground(req, a.intent, a.slots);
      for (const [k, val] of Object.entries(g.slots)) expect((a.slots as Record<string, string>)[k]).toBe(val);
      expect(Object.keys(g.slots).length + g.dropped.length).toBe(Object.keys(a.slots).length);
    }
  });
});

// ---------- the round-trip table ----------
const FAMILY_OF: Partial<Record<LocalIntent, string>> = {
  split_here: 'split', split_at: 'split', trim_start_here: 'trim', trim_end_here: 'trim', delete_clip: 'delete', delete_keep_gap: 'delete', transitions_all: 'transitions', transition_here: 'transitions',
};
const familyOf = (i: LocalIntent) => FAMILIES.find((f) => f.id === (FAMILY_OF[i] ?? i))!;

const exactText = (s: string) => exText(exFromDecimal(s)!);
/** The slots as compared: numbers as exact decimal text. */
function norm(intent: LocalIntent, slots: LocalSlots): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(slots)) if (v !== undefined && LOCAL_INTENT_SLOTS[intent].includes(k as LocalSlotName)) out[k] = ['atSeconds', 'forSeconds', 'db', 'factor'].includes(k) ? exactText(v as string) : (v as string);
  return out;
}
/** What the grammar's own family reads in the phrase, as local slots; an error string when it does not read it as one reading. */
function readBack(intent: LocalIntent, phrase: string): Record<string, string> | string {
  const { tokens, unclosedQuote } = tokenizeBar(phrase);
  const p = parseFamily(familyOf(intent), tokens, unclosedQuote);
  if (!p.head || p.unread.length) return `family ${familyOf(intent).id} leaves ${JSON.stringify(p.unread.map((k) => tokens[k]!.raw))}`;
  const sets = readingSets(p);
  if (sets.length !== 1) return `${sets.length} reading sets`;
  const takes = LOCAL_INTENT_SLOTS[intent];
  const out: Record<string, string> = {};
  const secs = (t: TimeSpec) => (t.kind === 'abs' && t.amount.frames.num === 0n && !t.amount.nominal ? exText(t.amount.secs) : `bad time ${t.kind}`);
  for (const [key, value] of sets[0]!.values) {
    if (key === 'pos') {
      const t = value as TimeSpec;
      if (t.kind === 'abs') out.atSeconds = secs(t);
      else if (takes.includes('at')) out.at = t.kind;
    } else if (key === 'dur') out.forSeconds = secs(value as TimeSpec);
    else if (key === 'db') out.db = exText(value as BarExact);
    else if (key === 'speed') { const sp = value as SpeedSpec; out.factor = sp.kind === 'abs' ? exText(sp.v) : `bad speed ${sp.kind}`; }
    else if (key === 'text') out.text = (value as { text: string }).text;
    else if (key === 'target' || key === 'workspace' || key === 'destination') out[key] = value as string;
    else if (key === 'edge' && intent === 'fades') out.edge = value as string;
    else if (key === 'dir') out.dir = value as string;
  }
  const hv = p.hits.find((h) => h.head && h.value !== null)?.value;
  if (intent === 'gain_change' && (hv === 'up' || hv === 'down')) out.dir = hv;
  if (intent === 'fades' && (hv === 'in' || hv === 'out')) out.edge = hv;
  for (const k of Object.keys(out)) if (!takes.includes(k as LocalSlotName)) delete out[k];
  return out;
}

const TABLE_VALUES: Readonly<Record<LocalSlotName, readonly string[]>> = {
  at: ['here', 'start', 'end'], atSeconds: ['4', '1.5', '29.97', '0', '120'], forSeconds: ['2', '0.5', '29.97', '1'],
  target: ['music', 'clip'], dir: ['up', 'down'], db: ['3', '6', '1.5', '29.97'], factor: ['0.5', '2', '1.25', '29.97'], edge: ['in', 'out'],
  text: ['מזל טוב', 'יום הולדת 5', 'חתוך כאן בשנייה 3', 'הנמך את המוזיקה', 'צה״ל וג׳ירפה', "Noa's 5th birthday", 'delete the clip', '29.97', 'סבא וסבתא!', 'ל"ג'.replace('"', '׳')],
  workspace: ['pro', 'color', 'sound', 'captions', 'deliver', 'shorts', 'perform'], destination: ['reels', 'youtube', 'whatsapp', 'computer'],
};
/** Every combination of the table's values for the intent's slots (each slot absent or one value); at and atSeconds never together. */
function combos(intent: LocalIntent): LocalSlots[] {
  let out: LocalSlots[] = [{}];
  for (const slot of LOCAL_INTENT_SLOTS[intent]) out = out.flatMap((c) => [c, ...TABLE_VALUES[slot].map((v) => ({ ...c, [slot]: v }))]);
  return out.filter((c) => !(c.at !== undefined && c.atSeconds !== undefined));
}
/** The combinations no phrase of the grammar reads as the intent (documented in localIntent.ts). */
const expectNull = (intent: LocalIntent, s: LocalSlots, lang: 'he' | 'en') =>
  ((intent === 'mute' || intent === 'unmute') && s.target === 'clip') || (intent === 'seek' && !s.atSeconds && (!s.at || s.at === 'here')) || (intent === 'gain_change' && lang === 'he' && !s.dir);

describe('localPhrase: the round-trip table', () => {
  let rows = 0, nulls = 0;
  const failures: string[] = [];
  for (const intent of LOCAL_INTENTS) {
    const ctx = ctxFor(intent as IntentId);
    const fam = familyOf(intent);
    for (const slots of combos(intent)) for (const lang of ['he', 'en'] as const) {
      rows++;
      const phrase = localPhrase(intent, slots, lang);
      const tag = `${intent} ${lang} ${JSON.stringify(slots)} → ${JSON.stringify(phrase)}`;
      if (expectNull(intent, slots, lang)) { nulls++; if (phrase !== null) failures.push(`${tag}: expected null`); continue; }
      if (phrase === null) { failures.push(`${tag}: null`); continue; }
      if (!barUnderstands(phrase)) { failures.push(`${tag}: barUnderstands false`); continue; }
      const back = readBack(intent, phrase);
      if (typeof back === 'string') { failures.push(`${tag}: ${back}`); continue; }
      if (JSON.stringify(back, Object.keys(back).sort()) !== JSON.stringify(norm(intent, slots), Object.keys(norm(intent, slots)).sort())) { failures.push(`${tag}: read ${JSON.stringify(back)}`); continue; }
      const r = interpret(phrase, ctx);
      const missing = localMissing(intent, slots);
      if (r.kind === 'unknown') { failures.push(`${tag}: unknown`); continue; }
      if (missing.length) {
        if (r.kind !== 'incomplete' || !fam.intents.includes(r.intent)) failures.push(`${tag}: expected the grammar's question, got ${r.kind} ${'intent' in r ? r.intent : ''}`);
      } else if (r.kind === 'incomplete' || r.intent !== intent) failures.push(`${tag}: got ${r.kind} ${r.intent}`);
    }
  }
  it('every rendered phrase, for every intent and every combination of the table, in both languages, reads back as that intent with the same values', () => {
    expect(failures.slice(0, 20)).toEqual([]);
    expect([rows, nulls]).toEqual([1274, 23]); // 1251 phrases read back, 23 combinations with no grammar phrase (documented)
  });
  it('the read-back catches a phrase that says something else (control)', () => {
    expect(readBack('gain_change', 'הנמך את המוזיקה ב־7 דציבל')).toEqual({ target: 'music', dir: 'down', db: '7' });
    expect(norm('gain_change', { target: 'music', dir: 'down', db: '6' })).not.toEqual(readBack('gain_change', 'הנמך את המוזיקה ב־7 דציבל'));
    expect(typeof readBack('add_title', 'הוסף כותרת "x" ב־3 שניות')).toBe('string'); // two readings (position or length)
    expect(readBack('speed', 'מהירות כפולה')).toEqual({ factor: 'bad speed factor' }); // a factor said as a word is not this phrase's form
    expect(readBack('mute', 'השתק את הקליפ')).toMatch(/^family mute leaves/);
  });
  it('null only where no phrase of the grammar fits', () => {
    expect(localPhrase('mute', { target: 'clip' }, 'he')).toBeNull();
    expect(localPhrase('unmute', { target: 'clip' }, 'en')).toBeNull();
    expect(localPhrase('seek', {}, 'he')).toBeNull();
    expect(localPhrase('gain_change', { target: 'music', db: '6' }, 'he')).toBeNull();
    expect(localPhrase('gain_change', { target: 'music', db: '6' }, 'en')).toBe('turn the music 6 dB');
    expect(localPhrase('add_title', { text: 'x', at: 'start', atSeconds: '3' }, 'he')).toBeNull();
  });
  it('the phrases are the bar\'s own words', () => {
    expect(localPhrase('gain_change', { target: 'music', dir: 'down', db: '6' }, 'he')).toBe('הנמך את המוזיקה ב־6 דציבל');
    expect(localPhrase('add_title', { text: 'סבא וסבתא', at: 'start' }, 'he')).toBe('הוסף כותרת "סבא וסבתא" בהתחלה');
    expect(localPhrase('add_title', { text: 'Happy birthday', atSeconds: '29.97', forSeconds: '1' }, 'en')).toBe('add title "Happy birthday" at 29.97 seconds for 1 second');
    expect(localPhrase('rename_project', { text: 'גן רימון' }, 'he')).toBe('שנה את שם הפרויקט ל"גן רימון"');
    expect(localPhrase('fades', { edge: 'in', forSeconds: '0.5' }, 'he')).toBe('עמעם בהתחלה למשך 0.5 שניות');
    expect(localPhrase('export_to', { destination: 'whatsapp' }, 'he')).toBe('ייצא לוואטסאפ');
    expect(localPhrase('seek', { atSeconds: '10' }, 'en')).toBe('go to 10 seconds');
  });
});

describe('localPhrase after grounding: a dropped number makes the grammar ask, never a default', () => {
  const cases: [string, LocalIntent, LocalSlots, string][] = [
    ['תורידי קצת את המוזיקה', 'gain_change', { target: 'music', dir: 'down', db: '3' }, 'amount'],
    ['תקפיא את התמונה קצת', 'freeze', { forSeconds: '2' }, 'duration'],
    ['שהסוף ייעלם בהדרגה', 'fades', { edge: 'out', forSeconds: '1' }, 'duration'],
    ['תאט את הקליפ', 'speed', { factor: '0.5' }, 'amount'],
    ['תחתוך בשנייה הרביעית', 'split_at', { atSeconds: '4' }, 'time'],
    ['תוסיף כותרת', 'add_title', { text: 'מזל טוב', at: 'start' }, 'text'],
    ['תשנה את שם הפרויקט', 'rename_project', { text: 'סרט' }, 'text'],
  ];
  for (const [text, intent, slots, missing] of cases) {
    it(`«${text}» → the bar asks for the ${missing}`, () => {
      const g = groundLocalAnswer(text, { intent, slots });
      expect(g.dropped.some((d) => d.why === 'ungrounded')).toBe(true);
      for (const lang of ['he', 'en'] as const) {
        const phrase = localPhrase(intent, g.slots, lang)!;
        const r = interpret(phrase, ctxFor(intent as IntentId));
        expect(r.kind, `${lang}: ${phrase}`).toBe('incomplete');
        expect((r as { missing: string[] }).missing, phrase).toEqual([missing]);
      }
    });
  }
  it('an optional slot dropped reads as if the owner had not said it (the grammar\'s own visible default note, no value chosen here)', () => {
    const g = groundLocalAnswer('תוסיף כותרת "מזל טוב"', { intent: 'add_title', slots: { text: 'מזל טוב', atSeconds: '3', forSeconds: '4' } });
    expect(g.slots).toEqual({ text: 'מזל טוב' });
    const r = interpret(localPhrase('add_title', g.slots, 'he')!, ctxFor('add_title'));
    expect(r.kind).toBe('plan');
    expect((r as { notes: { code: string }[] }).notes.map((n) => n.code)).toEqual(['default_used', 'default_used']);
  });
});
