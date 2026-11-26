/**
 * The booth report and its machine block (wave 8 booth; verify C4d). Moved here from contract.test.ts's W1 todo rows.
 */
import { describe, expect, it } from 'vitest';
import {
  BOOTH_BLOCK_BEGIN, BOOTH_BLOCK_END, BoothBlockSchema, boothBlockOf, boothBlockText, boothReport, parseBoothBlock,
  type BoothAnswer, type BoothCheckRow, type BoothItem, type BoothItemView, type BoothReportInput, type BoothSay,
} from '../index.ts';
import { BOOTH_EN, BOOTH_HE } from '../../../i18n/src/booth.ts';

const sha = (c: string) => `sha256:${c.repeat(64)}`;
const sayOf = (dict: Record<string, string>): BoothSay => (key, vars) => {
  const t = dict[key];
  if (t === undefined) return key;
  return t.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? `{${k}}`));
};
const he = sayOf(BOOTH_HE), en = sayOf(BOOTH_EN);
const item = (id: string, group: BoothItem['group'], title: string): BoothItem => ({
  id, source: id.startsWith('music:') ? 'music' : 'gpu-transition', group, kind: id.startsWith('music:') ? 'audio' : 'picture',
  title: { he: `${title}-he`, en: `${title}-en` }, what: { he: 'מה', en: 'what' }, recipe: sha('1'),
  make: id.startsWith('music:') ? { route: 'music', styleId: id.slice(6), bars: 8, seed: 1 } : { route: 'scene', scene: 'transition', id: id.split(':')[1]! },
  changesLight: false, exportStrip: false, usedBy: [], minutes: 0.5, problems: ['other'],
});
const answer = (id: string, verdict: BoothAnswer['verdict'], extra: Partial<BoothAnswer> = {}): BoothAnswer => ({ id, verdict, recipe: sha('1'), at: '2026-11-27T13:45:12.345Z', build: 'abc1234', ...extra });
const NOTE = 'בהתחלה [הוסר] רועש מדי';
const views: BoothItemView[] = [
  { item: item('music:music.calm', 'first.music', 'calm'), answer: answer('music:music.calm', 'ok', { played: sha('2') }), state: 'answered' },
  { item: item('music:music.pop', 'first.music', 'pop'), answer: answer('music:music.pop', 'bad', { problems: ['too-loud', 'harsh'], note: NOTE }), state: 'answered' },
  { item: item('gpu-transition:film-burn', 'first.gpu-new', 'burn'), answer: answer('gpu-transition:film-burn', 'skip', { browserAdapter: 'intel|gen-12lp||', browserSoftware: false }), state: 'changed', changedWhy: 'adapter' },
  { item: item('gpu-transition:ink-bleed', 'first.gpu-new', 'ink'), answer: null, state: 'unanswered' },
];
const checks: BoothCheckRow[] = [
  { id: 'ffmpeg', state: 'ok', code: 'encoder_absent', data: { version: 'ffmpeg version 7.1-full_build-www.gyan.dev Copyright (c) 2000-2024', h264_nvenc: false } },
  { id: 'export-gpu', state: 'fail', code: 'software_adapter', data: { vendor: 'google', software: true } },
];
const input: BoothReportInput = {
  view: { build: { commit: 'abc1234', bundle: 'unknown' }, machine: { os: 'Windows_NT 10.0.26100 x64', cpus: 12, memGiB: 16 }, firstSitting: { cards: 14, groups: ['first.gpu-new', 'first.music', 'first.mic'] }, groups: [], items: views },
  checks, date: '2026-11-27',
};
const blockLines = (t: string) => t.slice(t.indexOf(BOOTH_BLOCK_BEGIN), t.indexOf(BOOTH_BLOCK_END) + BOOTH_BLOCK_END.length).split('\n');

describe('the machine block', () => {
  it('C4d: ASCII-only lines of at most 64 characters, a sha256 line of the lines joined; parseBoothBlock round-trips the answers', () => {
    const text = boothBlockText(boothBlockOf(input));
    const lines = text.split('\n');
    expect(lines[0]).toBe(BOOTH_BLOCK_BEGIN);
    expect(lines.at(-1)).toBe(BOOTH_BLOCK_END);
    for (const l of lines.slice(1, -2)) { expect(l.length).toBeLessThanOrEqual(64); expect(l).toMatch(/^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/); }
    expect(lines.at(-2)).toMatch(/^sha256:[0-9a-f]{64}$/);
    const p = parseBoothBlock(`some chat text before\n${text}\nand after`);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.block.answers.map((a) => [a.id, a.verdict, a.state, a.date])).toEqual([
      ['music:music.calm', 'ok', 'answered', '2026-11-27'], ['music:music.pop', 'bad', 'answered', '2026-11-27'], ['gpu-transition:film-burn', 'skip', 'changed', '2026-11-27'],
    ]);
    expect(p.block.answers[1]!.problems).toEqual(['too-loud', 'harsh']);
    expect(p.block.checks).toEqual(checks);
    expect(BoothBlockSchema.parse(p.block)).toEqual(boothBlockOf(input));
  });
  it('C4d: a bidi mark (U+200F) inside the frame → not_ascii; one changed character → checksum; a pure re-wrap is accepted', () => {
    const text = boothBlockText(boothBlockOf(input));
    const lines = text.split('\n');
    const withMark = [...lines]; withMark[2] = `‏${withMark[2]}`;
    expect(parseBoothBlock(withMark.join('\n'))).toEqual({ ok: false, code: 'not_ascii' });
    const changed = text.replace('"cpus":12', '"cpus":13');
    expect(changed).not.toBe(text);
    expect(parseBoothBlock(changed)).toEqual({ ok: false, code: 'checksum' });
    // re-wrapped at 40 characters, CRLF line ends, a trailing space and an indent a chat app may add
    const body = lines.slice(1, -2).join('');
    const rewrapped = [BOOTH_BLOCK_BEGIN, ...(body.match(/.{1,40}/g) ?? []).map((l, i) => (i % 2 ? `  ${l}` : `${l} `)), lines.at(-2)!, BOOTH_BLOCK_END].join('\r\n');
    expect(parseBoothBlock(rewrapped).ok).toBe(true);
    expect(parseBoothBlock('no frame here')).toEqual({ ok: false, code: 'no_block' });
    expect(parseBoothBlock(`${BOOTH_BLOCK_BEGIN}\n{}\nsha256:${'0'.repeat(64)}`)).toEqual({ ok: false, code: 'no_block' });
    const noSum = [BOOTH_BLOCK_BEGIN, ...lines.slice(1, -2), BOOTH_BLOCK_END].join('\n');
    expect(parseBoothBlock(noSum)).toEqual({ ok: false, code: 'invalid' });
  });
  it('a block that passes the checksum but not the schema is invalid', async () => {
    const { sha256Hex } = await import('../sha256.ts');
    const json = JSON.stringify({ v: 1, date: '2026-11-27', extra: 1 });
    expect(parseBoothBlock([BOOTH_BLOCK_BEGIN, json, `sha256:${sha256Hex(json)}`, BOOTH_BLOCK_END].join('\n'))).toEqual({ ok: false, code: 'invalid' });
  });
  it('C4d: the block holds no note, no Hebrew, no time of day', () => {
    const block = blockLines(boothReport(input, he)).join('\n');
    expect(block).not.toMatch(/[֐-׿]/);
    expect(block).not.toContain('הוסר');
    expect(block.replace(/\n/g, '')).not.toMatch(/T\d{2}:\d{2}|13:45/);
    expect(block).not.toMatch(/note/);
  });
});

describe('the human part', () => {
  it('C4d: the report holds the notes as stored, the bad answers with their problems, the rows with their words; counts of the first sitting', () => {
    const t = boothReport(input, he);
    const human = t.slice(0, t.indexOf(BOOTH_BLOCK_BEGIN));
    expect(human.split('\n')[0]).toBe('PULSEFRAME — דוח תא הבדיקה · 2026-11-27 · build abc1234');
    expect(human).toContain('נבדקו 2 מתוך 4 · בסדר 1 · לא טוב 1 · דילוגים 0 · השתנו מאז 1');
    expect(human).toContain(`- music:music.pop «pop-he» — עוצמה גבוהה מדי, צרימה — "${NOTE}"`);
    expect(human).not.toContain('calm-he'); // an ok answer is counted, not listed
    expect(human).toContain('- תוכנת ffmpeg — זמין — לא קיים בהתקנה — ffmpeg version 7.1');
    expect(human).toContain('- כרטיס המסך בייצוא — כשל');
    const t2 = boothReport(input, en);
    expect(t2).toContain('- music:music.pop «pop-en» — Too loud');
    expect(t2.split('\n')[0]).toBe('PULSEFRAME — review booth report · 2026-11-27 · build abc1234');
  });
  it('with no bad answer and no rows it says none, and still ends with a block that parses', () => {
    const t = boothReport({ ...input, view: { ...input.view, items: [views[0]!] }, checks: [] }, he);
    expect(t.match(/^- אין$/gm)?.length).toBe(2);
    expect(parseBoothBlock(t).ok).toBe(true);
  });
});

describe('integration: a changed bad answer and the microphone numbers', () => {
  const micItem: BoothItem = { ...item('music:music.calm', 'first.mic', 'mic'), id: 'task:mic', source: 'task', kind: 'task', make: { route: 'task', task: 'mic' } };
  const extra: BoothItemView[] = [
    // a 'bad' answer whose item's recipe changed since: listed in «לא טוב», marked changed (it was in the block only before integration)
    { item: item('gpu-transition:page-turn-left', 'first.gpu-new', 'page'), answer: answer('gpu-transition:page-turn-left', 'bad', { problems: ['flicker'] }), state: 'changed', changedWhy: 'recipe' },
    { item: micItem, answer: answer('task:mic', 'ok', { mic: { peakDbfs: -12.3, clipped: 4 } }), state: 'answered' },
  ];
  const inp: BoothReportInput = { ...input, view: { ...input.view, items: [...views, ...extra] } };
  it('the changed bad answer is in the human «לא טוב» list, marked with why it changed', () => {
    const human = boothReport(inp, he).split(BOOTH_BLOCK_BEGIN)[0]!;
    expect(human).toContain('- gpu-transition:page-turn-left «page-he» — (השתנה מאז — בדקו שוב) — הבהוב');
    expect(boothReport(inp, en)).toContain('- gpu-transition:page-turn-left «page-en» — (Changed since — look again) — Flicker');
  });
  it('the microphone measurement is in the human part and in the machine block as numbers', () => {
    const t = boothReport(inp, he);
    expect(t.split(BOOTH_BLOCK_BEGIN)[0]).toContain('mic-he: שיא: -12.3 dBFS · דגימות שנחתכו: 4');
    const p = parseBoothBlock(t);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.block.answers.find((a) => a.id === 'task:mic')!.mic).toEqual({ peakDbfs: -12.3, clipped: 4 });
    // silence has no peak: null in the block, «-inf» in words
    const silent = boothReport({ ...inp, view: { ...inp.view, items: [{ ...extra[1]!, answer: answer('task:mic', 'bad', { mic: { peakDbfs: null, clipped: 0 } }) }] } }, en);
    expect(silent).toContain('- task:mic «mic-en» — Peak: -inf dBFS · Clipped samples: 0');
    const ps = parseBoothBlock(silent);
    expect(ps.ok && ps.block.answers[0]!.mic).toEqual({ peakDbfs: null, clipped: 0 });
  });
  it('the block refuses anything but numbers for the measurement (no audio can ride in it)', () => {
    const b = boothBlockOf(inp);
    const bad = { ...b, answers: b.answers.map((a) => (a.id === 'task:mic' ? { ...a, mic: { peakDbfs: -1, clipped: 0, wav: 'UklGR' } } : a)) };
    expect(BoothBlockSchema.safeParse(bad).success).toBe(false);
  });
});
