/** Lead contract of «ציור חי» in the editor (wave 8 ink pre-pass): ids, words, the mode's keys and its free shortcut. */
import { describe, expect, it } from 'vitest';
import { INK_HE } from '@pulseframe/i18n';
import { COMMANDS, MULTICAM_COMMANDS } from '../commands.ts';
import { INK_TESTIDS } from './ink.testids.ts';
import { inkT } from './ink.strings.ts';
import { INK_COMMAND_ID, INK_MODE_CHORD, inkKeyAction } from './inkKeys.ts';
import { INK_UI_BUILT } from './InkMode.tsx';

describe('ink editor contract', () => {
  it('test ids are unique and kebab-case', () => {
    const ids = Object.values(INK_TESTIDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^ink-[a-z0-9-]+$/);
  });
  it('inkT reads every ink.* word in both languages and fills placeholders', () => {
    for (const key of Object.keys(INK_HE).filter((k) => k.startsWith('ink.')).map((k) => k.slice(4))) for (const lang of ['he', 'en'] as const) expect(inkT(lang)(key), `${lang} ${key}`).not.toBe(key);
    expect(inkT('he')('strokesCount', { n: 3 })).toBe('3 קווים');
  });
  it('Shift+D is bound by no command but the mode\'s own (once W3 adds it)', () => {
    const takers = [...COMMANDS, ...MULTICAM_COMMANDS].filter((c) => c.keys.includes(INK_MODE_CHORD)).map((c) => c.id);
    expect(takers.filter((id) => id !== INK_COMMAND_ID)).toEqual([]);
    if (!INK_UI_BUILT) expect(takers).toEqual([]);
  });
  it('inside the mode no key reaches the command table: trim, duration, undo and play are caught', () => {
    expect(inkKeyAction('BracketLeft')).toEqual({ do: 'width', step: -1 });
    expect(inkKeyAction('BracketRight')).toEqual({ do: 'width', step: 1 });
    expect(inkKeyAction('KeyD')).toEqual({ do: 'swallow' });
    expect(inkKeyAction('Mod+KeyZ')).toEqual({ do: 'undoStroke' });
    expect(inkKeyAction('Mod+Shift+KeyZ')).toEqual({ do: 'swallow' });
    expect(inkKeyAction('Space')).toEqual({ do: 'spaceHint' });
    expect(inkKeyAction('Enter')).toEqual({ do: 'done' });
    expect(inkKeyAction('Enter', true)).toEqual({ do: 'control' });
    expect(inkKeyAction('Escape')).toEqual({ do: 'cancel' });
    expect(inkKeyAction('Digit2')).toEqual({ do: 'brush', brush: 'highlighter' });
    expect(inkKeyAction('Digit4')).toEqual({ do: 'swallow' });
    expect(inkKeyAction(INK_MODE_CHORD)).toEqual({ do: 'leave' });
    // every default binding of the command table is either one of the mode's own actions or caught
    for (const c of [...COMMANDS, ...MULTICAM_COMMANDS]) for (const k of c.keys) expect(['swallow', 'width', 'undoStroke', 'spaceHint', 'done', 'cancel', 'brush', 'leave', 'control'], k).toContain(inkKeyAction(k).do);
    const reachTimeline = [...COMMANDS].flatMap((c) => c.keys).filter((k) => inkKeyAction(k).do === 'control' && !/^(Shift\+)?(Tab|Arrow|Home|End)/.test(k));
    expect(reachTimeline).toEqual([]);
  });
  it.todo('W3: the mode\'s capture listener calls preventDefault and stopImmediatePropagation for every action but control, and the dispatcher skips while the mode is on');
  it.todo('W3: after pen-up the ghost holds the session as add_ink with play all (C2): every session stroke is on the stage');
  it.todo('W3: «סיום» is exactly one commit of add_ink; Escape with strokes asks first and confirming adds no revision');
});
