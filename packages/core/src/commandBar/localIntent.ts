/**
 * The local language assistant's answer → one bar phrase (wave 7; .artifacts/wave7/assistant-decisions.md §4). Pure, deterministic
 * (no clock, no random source, no DOM, no i18n import), the same in Node and the browser. LEAD pre-pass: the signatures; BUILDER A:
 * the bodies.
 *
 * groundLocalAnswer keeps only what the owner said. Per slot, the FIRST reason wins:
 *  - 'not_for_intent': the intent does not take the slot (LOCAL_INTENT_SLOTS; 'none' takes none), or `at` when `atSeconds` is kept
 *    beside it (one position only: the number the owner said stays);
 *  - 'malformed': a numeric slot (LOCAL_NUMERIC_SLOTS) outside LOCAL_DECIMAL; an enum value outside the vocabulary; a text slot that
 *    is empty, starts or ends with a space, is longer than LOCAL_TEXT_SLOT_MAX, or holds a control, format or line-separator character
 *    or a quote mark (an apostrophe or geresh between two letters and a gershayim between two Hebrew letters are part of a word:
 *    «צה״ל», «ג׳ירפה», "Noa's", and are kept);
 *  - 'ungrounded': a number that the grammar's OWN readers do not read at any position of tokenizeBar(request) with exactly that
 *    value — `db` and `factor` by parseNumber (digits or words: «שש» is 6, «חצי» is 0.5), `atSeconds` and `forSeconds` by the time
 *    reader readAmount, in seconds (parseTime's reading before the frame conversion: «שנייה וחצי» is 1.5, «דקה וחצי» is 90; a bare
 *    number with no unit grounds no time, a time with frames or an hh:mm:ss:ff timecode grounds no seconds, and an ordinal the grammar
 *    asks about, «בשנייה הרביעית», grounds nothing); a text that is not an exact substring of the NFC request.
 * Values are compared as exact rationals (exFromDecimal, bigint): "1.50" equals 1.5, nothing is parsed as a float. Nothing is ever
 * added, rounded or changed: a kept slot is the answer's own string, and a dropped slot makes the grammar ask (or, for an optional
 * slot, read the phrase exactly as if the owner had not said it), never a default chosen here.
 *
 * localPhrase renders the kept slots in the bar's own words (Hebrew or English templates, numbers in digits as given, text in
 * double quotes), or null when no phrase of the grammar reads as that intent: mute / unmute with target 'clip' (the grammar mutes
 * tracks only), seek with no position or with 'here' (every bare «עבור» is read as the workspace family first), gain_change with no
 * direction in Hebrew (the grammar's only direction-free verb is the English "turn"), and `at` together with `atSeconds`.
 * localIntent.test.ts reads every phrase of a table (every intent × the slot values of the table, both languages) back with the
 * grammar: the same family, the same values, and interpret(phrase, ctxFor(intent)) answers that intent.
 */
import {
  LOCAL_DECIMAL, LOCAL_DIRECTIONS, LOCAL_EDGES, LOCAL_INTENT_SLOTS, LOCAL_NUMERIC_SLOTS, LOCAL_POSITIONS,
  LOCAL_SLOT_NAMES, LOCAL_TARGETS, LOCAL_TEXT_SLOT_MAX,
  type LocalAnswer, type LocalDropReason, type LocalIntent, type LocalSlotName, type LocalSlots,
} from '../assistantContract.ts';
import { BAR_WORKSPACES, EXPORT_DESTINATION_IDS, type BarExact } from '../commandBarContract.ts';
import { tokenizeBar } from './match.ts';
import { exCmp, exFromDecimal, parseNumber } from './numbers.ts';
import { readAmount } from './time.ts';

/** True once builder A's bodies are in (the server's local branch refuses honestly until then). */
export const LOCAL_INTENT_BUILT = true;

export interface GroundedAnswer { intent: LocalAnswer['intent']; slots: LocalSlots; dropped: { slot: LocalSlotName; why: LocalDropReason }[] }

// ---------- grounding ----------
const ENUMS: Partial<Record<LocalSlotName, readonly string[]>> = {
  at: LOCAL_POSITIONS, target: LOCAL_TARGETS, dir: LOCAL_DIRECTIONS, edge: LOCAL_EDGES, workspace: BAR_WORKSPACES, destination: EXPORT_DESTINATION_IDS,
};
const NUMERIC: ReadonlySet<LocalSlotName> = new Set(LOCAL_NUMERIC_SLOTS);
const TIME_SLOTS: ReadonlySet<LocalSlotName> = new Set(['atSeconds', 'forSeconds']);

/** Quote marks the bar's tokenizer opens or closes a quoted span with, and their relatives; never kept in a text slot. */
const QUOTE_MARKS = /["“”„‟«»‹›‘‚‛`]/u;
/** A control, format (bidi, joiners) or line/paragraph separator character. */
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const LETTER = /\p{L}/u;
const HEBREW = /[א-ת]/;

/** Whether a text slot has an acceptable form (its grounding is checked apart). */
function textForm(text: string): boolean {
  if (!text || text.length > LOCAL_TEXT_SLOT_MAX || text !== text.trim()) return false;
  if (CONTROL.test(text) || QUOTE_MARKS.test(text)) return false;
  for (let k = 0; k < text.length; k++) {
    const c = text[k]!, prev = text[k - 1], next = text[k + 1];
    // an apostrophe or geresh inside a word ("Noa's", «ג'ירפה», «ג׳ירפה»); a gershayim between Hebrew letters («צה״ל»)
    if ((c === "'" || c === '’' || c === '׳') && !(prev && LETTER.test(prev) && (c === '׳' || (next && LETTER.test(next))))) return false;
    if (c === '״' && !(prev && next && HEBREW.test(prev) && HEBREW.test(next))) return false;
  }
  return true;
}

/** Every exact value the grammar's readers find in the request: numbers (parseNumber) and times in seconds (readAmount). */
export function groundedValues(request: string): { numbers: BarExact[]; seconds: BarExact[] } {
  const { tokens } = tokenizeBar(request);
  const numbers: BarExact[] = [], seconds: BarExact[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const n = parseNumber(tokens, i);
    if (n && 'value' in n) numbers.push(n.value);
    const a = readAmount(tokens, i);
    if (a && !a.alternatives && !a.refused && a.amount.frames.num === 0n && a.amount.nominal === undefined && !a.saidFrames) seconds.push(a.amount.secs);
  }
  return { numbers, seconds };
}

const hasExact = (list: readonly BarExact[], v: BarExact) => list.some((x) => exCmp(x, v) === 0);

export function groundLocalAnswer(request: string, answer: LocalAnswer): GroundedAnswer {
  const intent = answer.intent;
  const takes: readonly LocalSlotName[] = intent === 'none' ? [] : LOCAL_INTENT_SLOTS[intent] ?? [];
  const nfc = request.normalize('NFC');
  let values: ReturnType<typeof groundedValues> | null = null;
  const slots: LocalSlots = {};
  const dropped: GroundedAnswer['dropped'] = [];
  const given = answer.slots as Record<string, unknown>;
  for (const slot of LOCAL_SLOT_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(given, slot) || given[slot] === undefined) continue;
    const value = given[slot];
    const drop = (why: LocalDropReason) => dropped.push({ slot, why });
    if (!takes.includes(slot)) { drop('not_for_intent'); continue; }
    if (typeof value !== 'string') { drop('malformed'); continue; }
    if (NUMERIC.has(slot)) {
      if (!LOCAL_DECIMAL.test(value)) { drop('malformed'); continue; }
      const exact = exFromDecimal(value);
      if (!exact) { drop('malformed'); continue; }
      values ??= groundedValues(nfc);
      if (!hasExact(TIME_SLOTS.has(slot) ? values.seconds : values.numbers, exact)) { drop('ungrounded'); continue; }
    } else if (slot === 'text') {
      if (!textForm(value)) { drop('malformed'); continue; }
      if (!nfc.includes(value)) { drop('ungrounded'); continue; }
    } else if (!ENUMS[slot]!.includes(value)) { drop('malformed'); continue; }
    (slots as Record<string, string>)[slot] = value;
  }
  // one position: the time the owner said wins over a position word the model added beside it
  if (slots.at !== undefined && slots.atSeconds !== undefined) { delete slots.at; dropped.push({ slot: 'at', why: 'not_for_intent' }); }
  return { intent, slots, dropped };
}

/** The slots the grammar needs to act on each intent: without them the phrase reads 'incomplete' (the bar asks). seek needs at or atSeconds. */
export const LOCAL_REQUIRED_SLOTS: Readonly<Partial<Record<LocalIntent, readonly LocalSlotName[]>>> = {
  split_at: ['atSeconds'], add_title: ['text'], gain_change: ['target', 'dir', 'db'], mute: ['target'], unmute: ['target'], freeze: ['forSeconds'],
  speed: ['factor'], fades: ['edge', 'forSeconds'], rename_project: ['text'], workspace: ['workspace'], export_to: ['destination'],
};
/** The required slots an answer lacks (seek: 'atSeconds' stands for "a position"). Empty: the bar can act on the phrase. */
export function localMissing(intent: LocalIntent, slots: LocalSlots): LocalSlotName[] {
  if (intent === 'seek') return slots.at || slots.atSeconds ? [] : ['atSeconds'];
  return (LOCAL_REQUIRED_SLOTS[intent] ?? []).filter((s) => slots[s] === undefined);
}

// ---------- the phrase ----------
const one = (n: string) => { const e = exFromDecimal(n); return !!e && e.num === 1n && e.den === 1n; };
const secsHe = (n: string) => `${n} ${one(n) ? 'שנייה' : 'שניות'}`;
const secsEn = (n: string) => `${n} ${one(n) ? 'second' : 'seconds'}`;
const q = (t: string) => `"${t}"`;
const WORKSPACE_HE: Readonly<Record<(typeof BAR_WORKSPACES)[number], string>> = { pro: 'עריכה', color: 'צבע', sound: 'סאונד', captions: 'כתוביות', deliver: 'מסירה', shorts: 'קטעים קצרים', perform: 'הופעה' };
const DESTINATION_HE: Readonly<Record<(typeof EXPORT_DESTINATION_IDS)[number], string>> = { whatsapp: 'לוואטסאפ', reels: 'לרילס', youtube: 'ליוטיוב', computer: 'למחשב' };
const join = (...parts: (string | false | undefined | null)[]) => parts.filter((p): p is string => !!p).join(' ');

/** The fixed phrases (the grammar's own examples, golden-tested in intents.test.ts). */
const FIXED: Readonly<Partial<Record<LocalIntent, { he: string; en: string }>>> = {
  split_here: { he: 'חתוך כאן', en: 'split here' }, trim_start_here: { he: 'חתוך את ההתחלה עד כאן', en: 'trim the start to here' },
  trim_end_here: { he: 'קצץ את הסוף מכאן', en: 'trim the end from here' }, delete_clip: { he: 'מחק את הקליפ', en: 'delete the clip' },
  delete_keep_gap: { he: 'מחק והשאר רווח', en: 'delete and keep the gap' }, transitions_all: { he: 'הוסף מעבר בין כל הקליפים', en: 'add transitions between all clips' },
  transition_here: { he: 'הוסף מעבר כאן', en: 'add a transition here' }, close_gaps: { he: 'סגור רווחים', en: 'close gaps' },
  fit_music: { he: 'סיים את המוזיקה עם התמונה', en: 'fit the music' }, remove_empty_tracks: { he: 'הסר רצועות ריקות', en: 'remove empty tracks' },
  undo: { he: 'בטל', en: 'undo' }, redo: { he: 'בצע שוב', en: 'redo' }, play: { he: 'נגן', en: 'play' }, pause: { he: 'עצור', en: 'pause' },
  zoom_in: { he: 'הגדל', en: 'zoom in' }, zoom_out: { he: 'הקטן', en: 'zoom out' },
};

export function localPhrase(intent: LocalIntent, slots: LocalSlots, lang: 'he' | 'en'): string | null {
  const he = lang === 'he';
  const fixed = FIXED[intent];
  if (fixed) return he ? fixed.he : fixed.en;
  const s = slots;
  if (s.at !== undefined && s.atSeconds !== undefined) return null;
  const dur = s.forSeconds !== undefined ? (he ? `למשך ${secsHe(s.forSeconds)}` : `for ${secsEn(s.forSeconds)}`) : null;
  switch (intent) {
    case 'split_at':
      return he ? join('פצל', s.atSeconds !== undefined && `בשנייה ${s.atSeconds}`) : join('split', s.atSeconds !== undefined && `at ${secsEn(s.atSeconds)}`);
    case 'add_title': {
      const pos = s.atSeconds !== undefined ? (he ? `בשנייה ${s.atSeconds}` : `at ${secsEn(s.atSeconds)}`)
        : s.at === 'here' ? (he ? 'כאן' : 'here') : s.at === 'start' ? (he ? 'בהתחלה' : 'at the start') : s.at === 'end' ? (he ? 'בסוף' : 'at the end') : null;
      return join(he ? 'הוסף כותרת' : 'add title', s.text !== undefined && q(s.text), pos, dur);
    }
    case 'gain_change': {
      const target = s.target === 'music' ? (he ? 'את המוזיקה' : 'the music') : s.target === 'clip' ? (he ? 'את הקליפ' : 'the clip') : null;
      if (he) {
        if (!s.dir) return null;
        return join(s.dir === 'up' ? 'הגבר' : 'הנמך', target, s.db !== undefined && `ב־${s.db} דציבל`);
      }
      return join('turn', target, s.dir, s.db !== undefined && `${s.db} dB`);
    }
    case 'mute': case 'unmute': {
      if (s.target === 'clip') return null;
      const music = s.target === 'music';
      if (intent === 'mute') return he ? join('השתק', music && 'את המוזיקה') : join('mute', music && 'the music');
      return he ? join('בטל השתקה', music && 'למוזיקה') : join('unmute', music && 'the music');
    }
    case 'add_marker':
      return join(he ? 'הוסף סמן' : 'add a marker', s.text !== undefined && q(s.text));
    case 'freeze':
      return join(he ? 'הקפא את הפריים' : 'freeze frame', dur);
    case 'speed':
      return join(he ? 'מהירות' : 'speed', s.factor);
    case 'fades':
      if (he) return join('עמעם', s.edge === 'in' ? 'בהתחלה' : s.edge === 'out' ? 'בסוף' : null, dur);
      return join(s.edge === 'in' ? 'fade in' : s.edge === 'out' ? 'fade out' : 'fade', dur);
    case 'rename_project':
      if (he) return s.text !== undefined ? `שנה את שם הפרויקט ל${q(s.text)}` : 'שנה את שם הפרויקט';
      return join('rename the project', s.text !== undefined && `to ${q(s.text)}`);
    case 'seek':
      if (s.atSeconds !== undefined) return he ? `עבור לשנייה ${s.atSeconds}` : `go to ${secsEn(s.atSeconds)}`;
      if (s.at === 'start') return he ? 'קפוץ להתחלה' : 'go to the start';
      if (s.at === 'end') return he ? 'לך לסוף' : 'go to the end';
      return null;
    case 'workspace':
      if (he) return join('עבור למצב', s.workspace && WORKSPACE_HE[s.workspace]);
      return s.workspace ? `switch to ${s.workspace} mode` : 'switch mode';
    case 'export_to':
      if (he) return join('ייצא', s.destination && DESTINATION_HE[s.destination]);
      return join('export', s.destination && `to ${s.destination}`);
    default:
      return null;
  }
}
