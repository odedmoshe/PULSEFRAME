/**
 * Intents of the command bar (ADR-0027, plan §4.4, §8 W1 "Intents" and "Resolve"): every example phrasing of the table
 * (Hebrew and English) gives its expected kind and the golden canonical ops; «בטל השתקה» is unmute; «סנכרן לקצב» and
 * «ב־3 שניות» with a title ask; 30 ambiguous or unknown requests never plan or act; the target words resolve as the plan
 * says (selection, playhead, locked tracks, music tracks).
 *
 * BAR_UPDATE_GOLDEN=1 rewrites golden/intents.golden.json (read the diff before committing it).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonical, INTENT_IDS, type BarContext, type BarResult, type IntentId } from '../index.ts';
import { interpret } from './index.ts';
import { INTENT_EXAMPLES } from './lexicon.ts';
import { context, ctxFor, fixture, variants } from './fixture.testFixture.ts';

const fx = fixture();
const ACTIONS: ReadonlySet<IntentId> = new Set(['undo', 'redo', 'workspace', 'export_to', 'seek', 'play', 'pause', 'select_all', 'deselect', 'zoom_in', 'zoom_out', 'language', 'open']);
const expectedKind = (i: IntentId) => (i === 'sync_beat' ? 'ambiguous' : ACTIONS.has(i) ? 'action' : 'plan');

/** What the golden file keeps of a result: its kind and intent, and the canonical ops or the action. */
export function goldenOf(r: BarResult): unknown {
  if (r.kind === 'plan') return { kind: r.kind, intent: r.intent, ops: JSON.parse(canonical(r.ops)), notes: r.notes.map((n) => n.code) };
  if (r.kind === 'action') return { kind: r.kind, intent: r.intent, action: r.action };
  if (r.kind === 'ambiguous') return { kind: r.kind, intent: r.intent, choices: r.choices.map((c) => ({ en: c.en, ...(goldenOf(c.result) as object) })) };
  if (r.kind === 'refused') return { kind: r.kind, intent: r.intent, code: r.code };
  if (r.kind === 'incomplete') return { kind: r.kind, intent: r.intent, missing: r.missing };
  return { kind: r.kind, partial: r.partial };
}

const GOLDEN_URL = new URL('./golden/intents.golden.json', import.meta.url);
const examples = INTENT_IDS.flatMap((intent) => [...INTENT_EXAMPLES[intent].he, ...INTENT_EXAMPLES[intent].en].map((text) => ({ intent, text })));
const actual: Record<string, unknown> = Object.fromEntries(examples.map(({ intent, text }) => [`${intent} · ${text}`, goldenOf(interpret(text, ctxFor(intent)))]));
if (process.env.BAR_UPDATE_GOLDEN === '1') writeFileSync(GOLDEN_URL, `${JSON.stringify(actual, null, 1)}\n`);
const golden = JSON.parse(readFileSync(GOLDEN_URL, 'utf8')) as Record<string, unknown>;

describe('every example of the table', () => {
  it('every intent has Hebrew and English phrasings', () => {
    for (const id of INTENT_IDS) { expect(INTENT_EXAMPLES[id].he.length, id).toBeGreaterThan(0); expect(INTENT_EXAMPLES[id].en.length, id).toBeGreaterThan(0); }
  });
  for (const { intent, text } of examples) {
    it(`${intent}: «${text}» → ${expectedKind(intent)}, as the golden file`, () => {
      const r = interpret(text, ctxFor(intent));
      expect(r.kind, JSON.stringify(goldenOf(r))).toBe(expectedKind(intent));
      if (r.kind === 'plan' || r.kind === 'action') expect(r.intent).toBe(intent);
      expect(goldenOf(r)).toEqual(golden[`${intent} · ${text}`]);
    });
  }
  it('the golden file holds exactly these examples', () => expect(Object.keys(golden).sort()).toEqual(Object.keys(actual).sort()));
});

describe('the rules the plan names', () => {
  const ctx = ctxFor('split_here');
  it('«בטל השתקה» is unmute, never undo (the longest phrase wins)', () => {
    for (const t of ['בטל השתקה', 'בטל השתקה למוזיקה', 'בטלי את ההשתקה של המוזיקה']) {
      const r = interpret(t, context(variants.mutedMusic(fx), { selection: [fx.c2] }));
      expect(r.kind === 'unknown' ? null : r.intent, t).toBe('unmute');
    }
    expect(interpret('בטל השתקה למוזיקה', context(variants.mutedMusic(fx))).kind).toBe('plan');
    expect(interpret('בטל', ctx)).toMatchObject({ kind: 'action', intent: 'undo' });
    expect(interpret('בטל בחירה', ctx)).toMatchObject({ kind: 'action', intent: 'deselect' });
  });
  it('«חתוך כאן» splits, and names the trim readings beside it', () => {
    const r = interpret('חתוך כאן', ctx);
    expect(r).toMatchObject({ kind: 'plan', intent: 'split_here' });
    expect((r as Extract<BarResult, { kind: 'plan' }>).notes).toContainEqual({ code: 'alternative_reading', data: { intents: ['trim_start_here', 'trim_end_here'] } });
    expect(interpret('חתוך את ההתחלה עד כאן', ctx)).toMatchObject({ kind: 'plan', intent: 'trim_start_here' });
  });
  it('«סנכרן לקצב» always asks, with or without a chosen cut and a beat analysis', () => {
    for (const c of [ctx, ctxFor('sync_beat'), context(fixture(undefined, { music: false }).doc)]) {
      const r = interpret('סנכרן לקצב', c);
      expect(r.kind).toBe('ambiguous');
      expect((r as Extract<BarResult, { kind: 'ambiguous' }>).choices.length).toBeGreaterThan(0);
    }
    const noBeats = interpret('סנכרן לקצב', context(fixture(undefined, { music: false }).doc)) as Extract<BarResult, { kind: 'ambiguous' }>;
    expect(noBeats.question.he).toContain('אין ניתוח פעימות');
  });
  it('«ב־3 שניות» with a title asks: a position or a length', () => {
    const r = interpret('הוסף כותרת "מזל טוב" ב־3 שניות', ctx) as Extract<BarResult, { kind: 'ambiguous' }>;
    expect(r.kind).toBe('ambiguous');
    const plans = r.choices.map((c) => c.result as Extract<BarResult, { kind: 'plan' }>);
    expect(plans.map((p) => (p.ops[0]!.args as { start: unknown }).start)).toEqual([{ value: '3', timescale: 1 }, { value: '4', timescale: 1 }]);
    expect(plans.map((p) => (p.ops[0]!.args as { duration: unknown }).duration)).toEqual([{ value: '2', timescale: 1 }, { value: '3', timescale: 1 }]);
    // the same words with a verb that takes only a position are a position
    expect(interpret('פצל ב־3 שניות', ctx)).toMatchObject({ kind: 'plan', intent: 'split_at' });
  });
  it('«בשנייה 3» = 0:03 and «בשנייה השלישית» asks (lead decision 2); «דקה ועשר» = 1:10 (decision 3)', () => {
    const p = interpret('הוסף כותרת "x" בשנייה 3', ctx) as Extract<BarResult, { kind: 'plan' }>;
    expect((p.ops[0]!.args as { start: unknown }).start).toEqual({ value: '3', timescale: 1 });
    expect(interpret('הוסף כותרת "x" בשנייה השלישית', ctx).kind).toBe('ambiguous');
    expect(interpret('עבור לדקה ועשר', ctx)).toMatchObject({ kind: 'action', action: { kind: 'seek', frame: 70 * 30 } });
  });
  it('a title without a length takes the editor\'s own default (DEFAULT_TITLE_SECONDS) and says so', () => {
    const p = interpret('הוסף כותרת "x" כאן', ctx) as Extract<BarResult, { kind: 'plan' }>;
    expect((p.ops[0]!.args as { duration: unknown }).duration).toEqual({ value: '2', timescale: 1 });
    expect(p.notes).toContainEqual({ code: 'default_used', data: { field: 'duration', seconds: 2, frames: 60 } });
  });
  it('switching the workspace is refused while a take is recorded', () => {
    expect(interpret('עבור למצב הופעה', context(fx.doc, { performRecording: true }))).toMatchObject({ kind: 'refused', code: 'recording' });
  });
  it('undo and redo name the exact transaction, or say there is none', () => {
    expect(interpret('בטל', context(fx.doc))).toMatchObject({ action: { kind: 'undo', transactionId: 'tx_last', ops: ['split_clip'] } });
    expect(interpret('בטל', context(fx.doc, { undoTarget: null }))).toMatchObject({ kind: 'refused', code: 'nothing_to_undo' });
    expect(interpret('בצע שוב', context(fx.doc))).toMatchObject({ kind: 'refused', code: 'nothing_to_redo' });
  });
  it('export by voice only opens the sheet with the destination chosen', () => {
    for (const [t, d] of [['ייצא לוואטסאפ', 'whatsapp'], ['ייצא לווטסאפ', 'whatsapp'], ['ייצא לואטסאפ', 'whatsapp'], ['שלח בווצאפ', 'whatsapp'], ['ייצא ליוטיוב', 'youtube'], ['שמור למחשב', 'computer'], ['ייצוא לרילס', 'reels']] as const)
      expect(interpret(t, ctx), t).toMatchObject({ kind: 'action', action: { kind: 'export_sheet', destination: d } });
  });
  it('an unknown catalogue name is refused with its own words, never guessed', () => {
    expect(interpret('הוסף אפקט קסם', ctx)).toMatchObject({ kind: 'refused', intent: 'effect', code: 'unknown_name' });
    expect(interpret('החל מראה סגול זוהר', ctx)).toMatchObject({ kind: 'refused', intent: 'look', code: 'unknown_name' });
  });
  it('half a frame is refused', () => expect(interpret('הוסף כותרת "x" למשך חצי פריים', ctx)).toMatchObject({ kind: 'refused', code: 'half_frame' }));
  it('an unclosed quote asks for the text', () => expect(interpret('הוסף כותרת "מזל טוב', ctx)).toMatchObject({ kind: 'incomplete', intent: 'add_title', missing: ['text'] }));
});

describe('never guessed: 30 ambiguous or unknown requests plan nothing and run nothing', () => {
  const ctx = ctxFor('split_here');
  const none = context(fx.doc, { selection: [] });
  const REQUESTS: [string, BarContext][] = [
    ['חתוך', ctx], ['ב־3 שניות', ctx], ['הגבר ב־3', ctx], ['הקול', ctx], ['1,5 שניות', ctx], ['סנכרן לקצב', ctx], ['תעשה שמח', ctx], ['מחק', none],
    ['הוסף', ctx], ['הוסף כותרת', ctx], ['הגבר את הקול ב־3 דציבל', ctx], ['פצל כאן ואז מחק', ctx], ['הקליפ הבא', ctx], ['עבור', ctx], ['ייצא', ctx],
    ['מהירות', ctx], ['עמעום', ctx], ['השתק', ctx], ['הוסף כותרת "abc', ctx], ['הוסף אפקט קסם', ctx], ['הוסף כותרת "x" בשנייה השלישית', ctx],
    ['הוסף כותרת "x" ב־3 שניות', ctx], ['הוסף כותרת "x" ב־1,5 שניות', ctx], ['hello world', ctx], ['שלום', ctx], ['חתוך את הסוף', ctx], ['הקפא', ctx],
    ['מחק את הקליפ', context(fx.doc, { selection: [fx.c1, fx.c2] })], ['פצל כאן', context(fx.doc, { selection: [] })], ['הגבר את המוזיקה ב־3 דציבל', context(variants.twoMusic(fx))],
    ['zoom', ctx], ['דקה ועשר', ctx], ['הוסף כותרת "x" למשך חצי פריים', ctx],
  ];
  it('has at least 30 requests', () => expect(REQUESTS.length).toBeGreaterThanOrEqual(30));
  for (const [text, c] of REQUESTS) {
    it(`«${text}»`, () => {
      const r = interpret(text, c);
      expect(r.kind === 'plan' || r.kind === 'action', `${text}: ${JSON.stringify(goldenOf(r))}`).toBe(false);
      // it says what it read, and offers something: choices, an example, its reason, or what it did not read
      expect(r.tokens.length).toBeGreaterThan(0);
      if (r.kind === 'ambiguous') expect(r.choices.length).toBeGreaterThan(0);
      if (r.kind === 'unknown') expect(r.unread.length).toBeGreaterThan(0);
    });
  }
});

describe('resolve: the target words', () => {
  const plan = (r: BarResult) => r as Extract<BarResult, { kind: 'plan' }>;
  it('«הקליפ» with nothing selected is refused nothing_selected, offering the clip at the playhead', () => {
    const r = interpret('מחק את הקליפ', context(fx.doc, { selection: [] }));
    expect(r).toMatchObject({ kind: 'refused', code: 'nothing_selected' });
    expect((r as Extract<BarResult, { kind: 'refused' }>).choices!.map((c) => (c.result as Extract<BarResult, { kind: 'plan' }>).intent)).toContain('delete_clip');
  });
  it('one selected clip is the target', () => expect(plan(interpret('החל מראה חם', context(fx.doc, { selection: [fx.c1] }))).ops).toEqual([{ op: 'apply_look', args: { clipId: fx.c1, lookId: 'warm-sun' } }]));
  it('several selected: «הקליפ» asks «לכולם?», «הקליפים» takes them all', () => {
    const c = context(fx.doc, { selection: [fx.c1, fx.c3] });
    const r = interpret('החל מראה חם על הקליפ', c);
    expect(r.kind).toBe('ambiguous');
    const a = r as Extract<BarResult, { kind: 'ambiguous' }>;
    expect(a.question.he).toBe('נבחרו 2 קליפים — לכולם?');
    expect(plan(a.choices[0]!.result).ops.length).toBe(2);
    expect(plan(interpret('החל מראה חם על הקליפים', c)).ops.length).toBe(2);
  });
  it('the clip under the playhead: none → no_clip_here; one → it; several → choices plus «כל הקליפים בסמן»', () => {
    expect(interpret('פצל כאן', context(fx.doc, { playheadFrame: 2000 }))).toMatchObject({ kind: 'refused', code: 'no_clip_here' });
    const locked = context(variants.lockedTrack(fx.doc, fx.musicTrack), { playheadFrame: 120 });
    const one = plan(interpret('פצל כאן', locked));
    expect(one.ops).toEqual([{ op: 'split_clip', args: { clipId: fx.c2, at: { value: '4', timescale: 1 } } }]);
    expect(one.notes.find((n) => n.code === 'skipped_locked')).toBeTruthy();
    const several = interpret('פצל כאן', context(fx.doc, { playheadFrame: 120 })) as Extract<BarResult, { kind: 'ambiguous' }>;
    expect(several.kind).toBe('ambiguous');
    expect(several.choices.at(-1)!.he).toBe('כל הקליפים בסמן');
    expect(plan(several.choices.at(-1)!.result).ops.map((o) => (o.args as { clipId: string }).clipId)).toEqual([fx.c2, fx.song]);
  });
  it('locked tracks are never targets', () => {
    const doc = variants.lockedTrack(fx.doc, fx.videoTrack);
    expect(interpret('מחק את הקליפ', context(doc, { selection: [fx.c2] }))).toMatchObject({ kind: 'refused', code: 'locked' });
    const t = plan(interpret('הוסף מעבר בין כל הקליפים', context(doc)));
    expect(t.kind).toBe('refused');
  });
  it('«המוזיקה»: none → refused no_music_track with the audio tracks as choices; two → ambiguous', () => {
    const none = interpret('הגבר את המוזיקה ב־3 דציבל', context(fixture(undefined, { music: false }).doc));
    expect(none).toMatchObject({ kind: 'refused', code: 'no_music_track' });
    expect((none as Extract<BarResult, { kind: 'refused' }>).choices!.length).toBeGreaterThan(0);
    const two = interpret('הגבר את המוזיקה ב־3 דציבל', context(variants.twoMusic(fx))) as Extract<BarResult, { kind: 'ambiguous' }>;
    expect(two.kind).toBe('ambiguous');
    expect(two.choices.length).toBe(2);
  });
  it('«הקול» alone is always asked (music track or the clip)', () => {
    const r = interpret('הגבר את הקול ב־3 דציבל', ctxFor('gain_change')) as Extract<BarResult, { kind: 'ambiguous' }>;
    expect(r.kind).toBe('ambiguous');
    expect(r.choices.map((c) => (c.result as Extract<BarResult, { kind: 'plan' }>).ops[0]!.op)).toEqual(['set_track_audio', 'set_clip_gain']);
  });
});
