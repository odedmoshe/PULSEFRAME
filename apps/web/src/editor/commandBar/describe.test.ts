/** The preview's words: every StepDetail kind in Hebrew and English, every note, every action, describeCall for every public op. */
import { describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { BAR_ACTION_KINDS, BAR_NOTE_CODES, STEP_DETAIL_KINDS, createProject, listOps, type BarAction, type BarNote, type StepDetail } from '@pulseframe/core';
import { dictionaries } from '@pulseframe/i18n';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.stubGlobal('window', globalThis);
const { describeAction, describeCall, describeNote, describeStep, opWords, refusalLine, refusalWords, showTime } = await import('./describe.ts');
const { barText, plain } = await import('./commandBar.strings.ts');

const R = { num: 30, den: 1 };
const DETAILS: Record<StepDetail['kind'], StepDetail> = {
  at: { kind: 'at', frame: 365, time: T.frameTime(365, R), rounded: false },
  span: { kind: 'span', fromFrame: 10, toFrame: 40 },
  clip: { kind: 'clip', clipId: 'clp_1', name: 'IMG_2041' },
  track: { kind: 'track', trackId: 'trk_1', name: 'מוזיקה' },
  gain: { kind: 'gain', fromLinear: 1, toLinear: 1.4125, db: '+3' },
  transition: { kind: 'transition', type: 'dissolve', frames: 15, clipId: 'clp_2', name: 'IMG_2042' },
  text: { kind: 'text', chars: 9, startFrame: 90, durationFrames: 60 },
  count: { kind: 'count', n: 3, of: 5 },
  speed: { kind: 'speed', from: 1, to: 2 },
  rename: { kind: 'rename', to: 'גן רימון' },
  plain: { kind: 'plain' },
};

describe('describeStep', () => {
  it('has a sample for every StepDetail kind of the contract', () => { expect(Object.keys(DETAILS).sort()).toEqual([...STEP_DETAIL_KINDS].sort()); });
  for (const lang of ['he', 'en'] as const) {
    it(`${lang}: every kind renders non-empty op words and a detail sentence`, () => {
      for (const d of Object.values(DETAILS)) {
        const w = describeStep({ op: 'split_clip', detail: d }, lang);
        expect(w.op.length, d.kind).toBeGreaterThan(0);
        expect(w.detail.length, d.kind).toBeGreaterThan(0);
        expect(w.detail, d.kind).not.toMatch(/\{\w+\}/);
      }
    });
  }
  it('Hebrew: the op is the dictionary word and the time is isolated as a number', () => {
    const w = describeStep({ op: 'split_clip', detail: DETAILS.at }, 'he');
    expect(w.op).toBe(opWords('split_clip', 'he'));
    expect(w.detail).toContain('⁦0:12.17⁩');
    expect(plain(w.detail)).toBe('בסמן 0:12.17 (פריים 365)');
  });
  it('names are isolated for their own direction; an unknown transition type keeps its id', () => {
    expect(describeStep({ op: 'set_transition', detail: DETAILS.clip }, 'he').detail).toContain('⁨IMG_2041⁩');
    expect(plain(describeStep({ op: 'set_transition', detail: { ...DETAILS.transition, type: 'zzz' } as StepDetail }, 'en').detail)).toContain('zzz');
  });
  it('a rounded time says so', () => {
    expect(plain(describeStep({ op: 'split_clip', detail: { ...DETAILS.at, rounded: true } as StepDetail }, 'en').detail)).toMatch(/rounded/);
  });
  it('showTime writes minutes, seconds and hundredths', () => { expect(showTime(T.rt(3723, 1))).toBe('62:03.00'); expect(showTime(T.rt(1, 2))).toBe('0:00.50'); });
});

describe('describeNote', () => {
  for (const lang of ['he', 'en'] as const) {
    it(`${lang}: every note code has a sentence with and without data`, () => {
      for (const code of BAR_NOTE_CODES) {
        const bare = describeNote({ code, data: {} } as BarNote, lang);
        expect(bare.length, code).toBeGreaterThan(0);
        expect(bare, code).not.toMatch(/\{\w+\}/);
        const rich = describeNote({ code, data: { what: 'x', n: 4, names: ['a', 'b'], frame: 8, time: T.frameTime(8, R), seconds: 3 } } as BarNote, lang);
        expect(rich.length, code).toBeGreaterThan(0);
        expect(rich, code).not.toMatch(/\{\w+\}/);
      }
    });
  }
  it('reads the grammar\'s real data shapes: skipped clips and tracks by name, ripple moves, the alternative readings, defaults', () => {
    // the shapes core commandBar/plans.ts and resolve.ts emit
    const skipped = describeNote({ code: 'skipped_no_handle', data: { clips: [{ clipId: 'c1', name: 'IMG_1' }, { clipId: 'c2', name: 'IMG_2', code: 'out_of_bounds', message: 'x' }] } }, 'he');
    expect(skipped).toContain('⁨IMG_1⁩');
    expect(skipped).toContain('⁨IMG_2⁩');
    expect(plain(skipped)).toMatch(/דילגתי על 2 /);
    expect(plain(describeNote({ code: 'skipped_has_transition', data: { clips: [{ clipId: 'c3', name: 'IMG_3' }] } }, 'en'))).toBe('Skipped 1 cuts that already have a transition: IMG_3');
    expect(plain(describeNote({ code: 'skipped_locked', data: { tracks: [{ trackId: 't1', name: 'מוזיקה' }] } }, 'he'))).toBe('לא נגעתי ברצועות נעולות: מוזיקה');
    expect(plain(describeNote({ code: 'skipped_locked', data: { clips: [{ clipId: 'clp_x', name: '' }] } }, 'en'))).toContain('clp_x'); // no name: its id
    expect(plain(describeNote({ code: 'ripple_moves', data: { moved: 3 } }, 'he'))).toBe('עוד 3 קליפים יזוזו כדי לסגור את הרווח');
    expect(plain(describeNote({ code: 'alternative_reading', data: { intents: ['trim_start_here', 'trim_end_here'] } }, 'he'))).toBe('אפשר גם: חיתוך ההתחלה או חיתוך הסוף');
    expect(plain(describeNote({ code: 'default_used', data: { field: 'duration', seconds: 2, frames: 60 } }, 'he'))).toBe('ברירת מחדל: 2 שניות');
    expect(plain(describeNote({ code: 'default_used', data: { field: 'start', value: 'playhead', frame: 120 } }, 'en'))).toBe('Default: the playhead, frame 120');
    expect(plain(describeNote({ code: 'default_used', data: { field: 'type', value: 'dissolve' } }, 'en'))).not.toBe('A default was used');
    expect(plain(describeNote({ code: 'rounded_to_frame', data: { field: 'time', frame: 90, time: T.frameTime(90, { num: 30000, den: 1001 }), seconds: '3' } }, 'he'))).toBe('עוגל לפריים הקרוב: 0:03.00 (פריים 90)');
  });
  it('skipped cuts are named in isolates', () => {
    expect(describeNote({ code: 'skipped_no_handle', data: { n: 2, names: ['IMG_1', 'IMG_2'] } }, 'he')).toContain('⁨IMG_1⁩');
  });
});

describe('describeAction', () => {
  const samples: Record<BarAction['kind'], BarAction> = {
    undo: { kind: 'undo', transactionId: 'tx_1', ops: ['split_clip'] }, redo: { kind: 'redo', transactionId: 'tx_2', ops: [] },
    workspace: { kind: 'workspace', workspace: 'perform' }, export_sheet: { kind: 'export_sheet', destination: 'whatsapp' },
    seek: { kind: 'seek', frame: 300 }, play: { kind: 'play' }, pause: { kind: 'pause' }, select_all: { kind: 'select_all' }, deselect: { kind: 'deselect' },
    zoom: { kind: 'zoom', dir: 1 }, language: { kind: 'language', to: 'en' }, command: { kind: 'command', commandId: 'view.openTemplates' }, recipe: { kind: 'recipe', recipeId: 'beat-montage' },
  };
  it('has a sample for every action kind', () => { expect(Object.keys(samples).sort()).toEqual([...BAR_ACTION_KINDS].sort()); });
  for (const lang of ['he', 'en'] as const) {
    it(`${lang}: every action has words, and an export only opens the sheet`, () => {
      for (const a of Object.values(samples)) { const s = describeAction(a, lang, R); expect(s.length, a.kind).toBeGreaterThan(0); expect(s, a.kind).not.toMatch(/\{\w+\}/); }
    });
  }
  it('Hebrew export line says nothing is exported until the button', () => {
    expect(plain(describeAction(samples.export_sheet, 'he'))).toBe('פותח את חלון הייצוא, יעד וואטסאפ. הייצוא מתחיל רק בכפתור "ייצוא"');
  });
});

describe('describeCall', () => {
  const doc = createProject({ id: 'prj_d', name: 'D', width: 1920, height: 1080, frameRate: R });
  const publicOps = listOps().filter((o) => !o.internal).map((o) => o.name);
  it('covers every public op with at least its op words, in both languages', () => {
    expect(publicOps.length).toBeGreaterThan(50);
    for (const op of publicOps) for (const lang of ['he', 'en'] as const) {
      const w = describeCall(doc, { op, args: {} }, lang);
      // the dictionary's own words, never the fallback (opWords falls back to the op name, so a length check could not fail)
      const words = (dictionaries[lang] as Record<string, string>)[`op.${op}`];
      expect(words, `${lang} op.${op}`).toBeTruthy();
      expect(w.op, op).toBe(words);
      expect(w.op, op).not.toBe(op);
      if (lang === 'he') expect(/[א-ת]/.test(w.op), op).toBe(true);
      expect(typeof w.detail).toBe('string');
    }
  });
  it('an op without words falls back to its name', () => { expect(describeCall(doc, { op: 'no_such_op', args: {} }, 'en').op).toBe('no_such_op'); });
  it('names the track and the time its arguments name', () => {
    const track = Object.values(doc.sequences)[0]!.tracks[0]!;
    const w = describeCall(doc, { op: 'set_track_audio', args: { trackId: track.id, at: T.frameTime(30, R) } }, 'he');
    expect(w.detail).toContain(track.name);
    expect(w.detail).toContain('0:01.00');
  });
});

describe('a server refusal in words (lead decision: a Hebrew next step in a Hebrew interface)', () => {
  it('Hebrew: a worded refusal is its Hebrew sentence alone (it carries the next step); the English hint is not shown', () => {
    const w = refusalWords('he', { code: 'host_not_allowed', message: 'the host evil.example.test is not listed in PF_ASSISTANT_HOSTS', hint: 'Add exactly this host to PF_ASSISTANT_HOSTS and restart the server, then save again.' });
    expect(w.untranslated).toBeNull();
    expect(w.next).toBeNull();
    expect(w.reason).toMatch(/^הכתובת .*evil\.example\.test.* אינה ברשימה .*; הוסיפו/);
    expect(refusalLine('he', w)).not.toMatch(/Add exactly/);
  });
  it('Hebrew: an unworded message with a known code is the code\'s headline with the bar\'s Hebrew next step', () => {
    expect(refusalWords('he', { code: 'owner_required', message: 'some sentence no table knows', hint: 'An English hint.' })).toEqual({ reason: 'הפעולה שמורה לבעלים', next: barText('he', 'fail.hint'), untranslated: null });
  });
  it('Hebrew: with no Hebrew wording at all, the server\'s English is shown marked as not translated, beside a Hebrew next step', () => {
    const w = refusalWords('he', { code: 'brand_new_code', message: 'a new sentence', hint: 'Do this.' });
    expect(w).toEqual({ reason: 'הפעולה נכשלה', next: barText('he', 'fail.hint'), untranslated: { message: 'a new sentence', hint: 'Do this.' } });
    expect(refusalLine('he', w)).toBe(`הפעולה נכשלה. ${barText('he', 'fail.hint')} (בלשון השרת, לא תורגם: a new sentence Do this.)`);
  });
  it('English: the server\'s own sentence and next step', () => {
    expect(refusalWords('en', { code: 'owner_required', message: 'only the owner', hint: 'The owner sets it up in Settings.' })).toEqual({ reason: 'only the owner', next: 'The owner sets it up in Settings.', untranslated: null });
    expect(refusalWords('en', { code: 'owner_required' }).reason).toBe('Only the owner can do this');
  });
  it('every assistant job error code reads in Hebrew with a next step, never the import\'s «בוטל» headline', () => {
    const w = refusalWords('he', { code: 'canceled', message: 'canceled; the answer that arrived was discarded' });
    expect(w.reason).not.toMatch(/ייבוא/);
    expect(w.reason).toMatch(/; /);
  });
});
