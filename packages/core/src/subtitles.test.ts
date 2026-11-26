import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { rt } from '@pulseframe/time';
import {
  detectFormat,
  parseSubtitles,
  serializeAss,
  serializeSrt,
  serializeVtt,
  snapCuesToFrames,
  SubtitleParseError,
  type SubtitleCue,
} from './subtitles';

const ms = (n: number) => rt(n, 1000);
const cue = (s: number, e: number, text = 'x'): SubtitleCue => ({ start: ms(s), end: ms(e), text });

describe('parse SRT', () => {
  it('canonical', () => {
    const r = parseSubtitles('1\n00:00:01,000 --> 00:00:02,500\nHello\nworld\n\n2\n00:00:03,000 --> 00:00:04,000\nBye\n');
    expect(r.format).toBe('srt');
    expect(r.warnings).toEqual([]);
    expect(r.cues).toEqual([
      { start: ms(1000), end: ms(2500), text: 'Hello\nworld', id: '1' },
      { start: ms(3000), end: ms(4000), text: 'Bye', id: '2' },
    ]);
  });
  it('BOM, CRLF, CR and missing final newline', () => {
    const a = parseSubtitles('﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nA\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nB');
    expect(a.cues.map((c) => c.text)).toEqual(['A', 'B']);
    const b = parseSubtitles('1\r00:00:01,000 --> 00:00:02,000\rA\r\r2\r00:00:03,000 --> 00:00:04,000\rB\r');
    expect(b.cues.map((c) => c.text)).toEqual(['A', 'B']);
  });
  it('missing indices', () => {
    const r = parseSubtitles('00:00:01,000 --> 00:00:02,000\nA\n\n00:00:03,000 --> 00:00:04,000\nB\n');
    expect(r.cues).toEqual([cue(1000, 2000, 'A'), cue(3000, 4000, 'B')]);
  });
  it('comma/dot mix is accepted with a warning', () => {
    const r = parseSubtitles('1\n00:00:01.000 --> 00:00:02,000\nA\n', 'srt');
    expect(r.cues).toEqual([{ ...cue(1000, 2000, 'A'), id: '1' }]);
    expect(r.warnings).toEqual([{ line: 2, code: 'decimal_separator', message: expect.any(String) }]);
  });
  it('short fractions are padded on the right', () => {
    const r = parseSubtitles('00:00:01,5 --> 00:00:02,25\nA\n');
    expect(r.cues[0]!.start).toEqual(ms(1500));
    expect(r.cues[0]!.end).toEqual(ms(2250));
  });
  it('hours >= 100', () => {
    const r = parseSubtitles('1\n100:00:00,000 --> 123:59:59,999\nA\n');
    expect(r.cues[0]!.start).toEqual(ms(360_000_000));
    expect(r.cues[0]!.end).toEqual(ms(446_399_999));
    expect(serializeSrt(r.cues)).toBe('1\n100:00:00,000 --> 123:59:59,999\nA\n');
  });
  it('blank lines with whitespace separate cues', () => {
    const r = parseSubtitles('1\n00:00:01,000 --> 00:00:02,000\nA\n  \n\n\n2\n00:00:03,000 --> 00:00:04,000\nB\n');
    expect(r.cues).toHaveLength(2);
  });
});

describe('text handling', () => {
  it('preserves Hebrew, niqqud, Latin, digits and emoji exactly', () => {
    const t = 'שָׁלוֹם עולם hello 123 😀👨‍👩‍👧';
    for (const ser of [serializeSrt, serializeVtt]) {
      const back = parseSubtitles(ser([cue(0, 1000, t)])).cues[0]!.text;
      expect(back).toBe(t);
      expect(Buffer.from(back).equals(Buffer.from(t))).toBe(true);
    }
  });
  it('preserves bidi controls', () => {
    const t = '‏שלום‎ ‪a‫‬‭‮⁦b⁧⁨⁩';
    expect(parseSubtitles(serializeSrt([cue(0, 1000, t)])).cues[0]!.text).toBe(t);
    expect(parseSubtitles(serializeVtt([cue(0, 1000, t)])).cues[0]!.text).toBe(t);
  });
  it('strips inline tags but keeps a literal <', () => {
    const r = parseSubtitles(
      '1\n00:00:01,000 --> 00:00:02,000\n<i>a</i> <b>b</b> <u>c</u> <font color="#ff0000">d</font> {\\an8}e 3 < 5 and 5 > 3 <3\n',
    );
    expect(r.cues[0]!.text).toBe('a b c d e 3 < 5 and 5 > 3 <3');
  });
  it('does not decode entities in SRT', () => {
    expect(parseSubtitles('00:00:01,000 --> 00:00:02,000\nA &amp; B\n').cues[0]!.text).toBe('A &amp; B');
  });
});

describe('parse VTT', () => {
  const vtt = [
    'WEBVTT - header', // 1
    '', // 2
    'NOTE comment', // 3
    'more note', // 4
    '', // 5
    'STYLE', // 6
    '::cue { color: red }', // 7
    '', // 8
    'REGION', // 9
    'id:r1', // 10
    '', // 11
    'intro', // 12
    '00:01.000 --> 00:02.500 align:start position:10%', // 13
    '<v Roy>Hello &amp; <c.yellow>wor</c>ld</v>', // 14
    'a &lt;i&gt; &lrm;&rlm;&nbsp;&gt;', // 15
    '', // 16
    '00:00:03.000 --> 00:00:04.000', // 17
    'Kara<00:00:03.500>oke', // 18
  ].join('\n');
  it('handles blocks, ids, settings, voice spans, karaoke and entities', () => {
    const r = parseSubtitles(vtt);
    expect(r.format).toBe('vtt');
    expect(r.warnings).toEqual([]);
    expect(r.cues).toEqual([
      {
        start: ms(1000),
        end: ms(2500),
        text: 'Hello & world\na <i> ‎‏ >',
        id: 'intro',
        settings: 'align:start position:10%',
      },
      cue(3000, 4000, 'Karaoke'),
    ]);
  });
  it('header-only VTT is valid and empty', () => {
    expect(parseSubtitles('WEBVTT\n').cues).toEqual([]);
  });
});

describe('malformed input', () => {
  it('skips bad timestamps with correct line number and continues', () => {
    const r = parseSubtitles('1\n00:00:01,000 --> 00:00:02,000\nA\n\n2\n00:00:0x,000 --> 00:00:04,000\nB\n\n3\n00:00:05,000 --> 00:00:06,000\nC\n');
    expect(r.cues.map((c) => c.text)).toEqual(['A', 'C']);
    expect(r.warnings).toEqual([{ line: 6, code: 'bad_timestamp', message: expect.any(String) }]);
  });
  it('minutes out of range', () => {
    const r = parseSubtitles('00:00:01,000 --> 00:00:02,000\nA\n\n00:61:00,000 --> 00:62:00,000\nB\n');
    expect(r.warnings[0]).toMatchObject({ line: 4, code: 'bad_timestamp' });
  });
  it('end before start (and zero length)', () => {
    const r = parseSubtitles('00:00:05,000 --> 00:00:02,000\nA\n\n00:00:06,000 --> 00:00:06,000\nB\n\n00:00:07,000 --> 00:00:08,000\nC\n');
    expect(r.cues.map((c) => c.text)).toEqual(['C']);
    expect(r.warnings.map((w) => [w.line, w.code])).toEqual([[1, 'end_before_start'], [4, 'end_before_start']]);
  });
  it('empty text', () => {
    const r = parseSubtitles('00:00:01,000 --> 00:00:02,000\n<i></i>\n\n00:00:03,000 --> 00:00:04,000\nB\n');
    expect(r.cues).toHaveLength(1);
    expect(r.warnings).toEqual([{ line: 1, code: 'empty_text', message: expect.any(String) }]);
  });
  it('unsorted and overlapping cues are kept in file order with warnings', () => {
    const r = parseSubtitles('00:00:05,000 --> 00:00:08,000\nA\n\n00:00:01,000 --> 00:00:02,000\nB\n\n00:00:06,000 --> 00:00:09,000\nC\n');
    expect(r.cues.map((c) => c.text)).toEqual(['A', 'B', 'C']);
    expect(r.warnings.map((w) => [w.line, w.code])).toEqual([[4, 'unsorted'], [4, 'overlap'], [7, 'overlap']]);
  });
  it('throws only when nothing is usable', () => {
    expect(() => parseSubtitles('hello world')).toThrow(SubtitleParseError);
    expect(() => parseSubtitles('00:00:0x,000 --> 00:00:04,000\nB\n', 'srt')).toThrowError(
      expect.objectContaining({ code: 'bad_timestamp', line: 1 }),
    );
    expect(() => parseSubtitles('', 'srt')).toThrow(SubtitleParseError);
  });
});

describe('detectFormat', () => {
  it('detects', () => {
    expect(detectFormat('WEBVTT\n\n')).toBe('vtt');
    expect(detectFormat('﻿WEBVTT - x\r\n')).toBe('vtt');
    expect(detectFormat('1\n00:00:01,000 --> 00:00:02,000\nA')).toBe('srt');
    expect(detectFormat('00:01.000 --> 00:02.000\nA')).toBe('vtt');
    expect(detectFormat('nothing here')).toBeNull();
    expect(detectFormat('')).toBeNull();
  });
});

describe('serialize', () => {
  it('canonical SRT and VTT', () => {
    const cues = [cue(1000, 2500, 'Hello\nworld'), cue(3_661_001, 3_662_000, 'B')];
    expect(serializeSrt(cues)).toBe('1\n00:00:01,000 --> 00:00:02,500\nHello\nworld\n\n2\n01:01:01,001 --> 01:01:02,000\nB\n');
    expect(serializeVtt(cues)).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello\nworld\n\n01:01:01.001 --> 01:01:02.000\nB\n');
  });
  it('VTT escapes, keeps id/settings', () => {
    const out = serializeVtt([{ ...cue(0, 1000, 'a & b <c>'), id: 'n1', settings: 'align:start' }]);
    expect(out).toBe('WEBVTT\n\nn1\n00:00:00.000 --> 00:00:01.000 align:start\na &amp; b &lt;c&gt;\n');
  });
  it('replaces --> in text and drops blank lines', () => {
    const out = serializeSrt([cue(0, 1000, 'a\n-->\n\nb')]);
    expect(out).toBe('1\n00:00:00,000 --> 00:00:01,000\na\n→\nb\n');
    expect(parseSubtitles(out).cues[0]!.text).toBe('a\n→\nb');
  });
  it('rounds rationals to ms half away from zero', () => {
    const at = (value: number, timescale: number) =>
      serializeSrt([{ start: rt(0, 1), end: rt(value, timescale), text: 'x' }]).split('\n')[1]!.slice(-12);
    expect(at(1001, 30000)).toBe('00:00:00,033');
    expect(at(2002, 30000)).toBe('00:00:00,067'); // 66.73
    expect(at(3003, 30000)).toBe('00:00:00,100');
    expect(at(15 * 1001, 30000)).toBe('00:00:00,501'); // 500.5 -> tie -> away
    expect(at(1, 2000)).toBe('00:00:00,001'); // 0.5 ms
    expect(at(3, 2000)).toBe('00:00:00,002'); // 1.5 ms
  });
  it('rejects bad cues', () => {
    for (const ser of [serializeSrt, serializeVtt]) {
      expect(() => ser([cue(1000, 1000)])).toThrow(RangeError);
      expect(() => ser([cue(2000, 1000)])).toThrow(RangeError);
      expect(() => ser([{ start: ms(-1), end: ms(5), text: 'x' }])).toThrow(RangeError);
      expect(() => ser([{ start: ms(0), end: ms(-5), text: 'x' }])).toThrow(RangeError);
      expect(() => ser([cue(0, 5, '  \n ')])).toThrow(RangeError);
      expect(() => ser([{ start: rt(0, 1), end: rt(1, 90000), text: 'x' }])).toThrow(RangeError); // rounds to zero length
    }
  });
  it('writes cues in given order', () => {
    const out = serializeSrt([cue(5000, 6000, 'late'), cue(1000, 2000, 'early')]);
    expect(out.indexOf('late')).toBeLessThan(out.indexOf('early'));
  });
});

describe('ASS', () => {
  const opts = { width: 1920, height: 1080, fontFamily: 'Heebo', fontSize: 48, primaryColor: '#FFCC00', outlineColor: '#102030' };
  it('header, style, colours', () => {
    const out = serializeAss([cue(1000, 2500, 'Hi')], opts);
    expect(out).toContain('[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n');
    expect(out).toContain('[V4+ Styles]');
    expect(out).toContain('Style: Default,Heebo,48,&H0000CCFF,&H0000CCFF,&H00302010,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,40,1');
    expect(out).toContain('[Events]');
    expect(out).toContain('Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,Hi\n');
  });
  it('alignment and marginV', () => {
    expect(serializeAss([cue(0, 1000)], { ...opts, alignment: 8, marginV: 12 })).toContain(',2,0,8,10,10,12,1');
  });
  it('rounds centiseconds half away from zero and supports hours', () => {
    const d = (s: number, e: number) => serializeAss([cue(s, e)], opts).split('\n').find((l) => l.startsWith('Dialogue'))!.split(',').slice(1, 3).join(' ');
    expect(d(5, 15)).toBe('0:00:00.01 0:00:00.02'); // 0.5cs -> 1, 1.5cs -> 2
    expect(d(4, 14)).toBe('0:00:00.00 0:00:00.01');
    expect(d(3_661_000, 36_000_000)).toBe('1:01:01.00 10:00:00.00');
  });
  it('escapes braces, line breaks', () => {
    expect(serializeAss([cue(0, 1000, 'a {b}\nc')], opts)).toContain(',,a \\{b\\}\\Nc\n');
  });
  it('RTL wraps each line in RLE/PDF', () => {
    const out = serializeAss([cue(0, 1000, 'שלום\nעולם')], { ...opts, rtl: true });
    expect(out).toContain(',,‫שלום‬\\N‫עולם‬\n');
  });
  it('validates options and cues', () => {
    expect(() => serializeAss([], { ...opts, primaryColor: 'red' })).toThrow(RangeError);
    expect(() => serializeAss([], { ...opts, fontFamily: 'a,b' })).toThrow(RangeError);
    expect(() => serializeAss([cue(1000, 1000)], opts)).toThrow(RangeError);
  });
});

describe('snapCuesToFrames', () => {
  it('30/1', () => {
    const r = snapCuesToFrames([cue(1010, 2500)], { num: 30, den: 1 });
    expect(r.cues[0]!.start).toEqual({ value: '1', timescale: 1 });
    expect(r.cues[0]!.end).toEqual({ value: '5', timescale: 2 });
    expect(r.maxShiftSeconds).toBeCloseTo(0.01, 9);
    expect(r.maxShiftSeconds).toBeLessThanOrEqual(1 / 60);
  });
  it('30000/1001', () => {
    const r = snapCuesToFrames([cue(1000, 2000, 'keep')], { num: 30000, den: 1001 });
    expect(r.cues[0]).toEqual({ start: { value: '1001', timescale: 1000 }, end: { value: '1001', timescale: 500 }, text: 'keep' });
    expect(r.maxShiftSeconds).toBeCloseTo(0.002, 9);
    expect(r.maxShiftSeconds).toBeLessThanOrEqual(1001 / 30000 / 2);
  });
  it('25/1 with minimum one-frame duration', () => {
    const r = snapCuesToFrames([cue(1000, 1004), cue(90, 2000)], { num: 25, den: 1 });
    expect(r.cues[0]!.start).toEqual({ value: '1', timescale: 1 });
    expect(r.cues[0]!.end).toEqual({ value: '26', timescale: 25 });
    expect(r.cues[1]!.start).toEqual({ value: '2', timescale: 25 });
    expect(r.cues[1]!.end).toEqual({ value: '2', timescale: 1 });
    expect(snapCuesToFrames([cue(0, 1)], { num: 25, den: 1 }).cues[0]!.end).toEqual({ value: '1', timescale: 25 });
  });
});

describe('property: millisecond round trips', () => {
  const arb = fc.array(
    fc.record({ s: fc.integer({ min: 0, max: 1_500_000_000 }), d: fc.integer({ min: 1, max: 20_000_000 }) }),
    { minLength: 1, maxLength: 12 },
  );
  it('SRT and VTT preserve times exactly', () => {
    fc.assert(
      fc.property(arb, (rows) => {
        const cues = rows.map((r) => cue(r.s, r.s + r.d));
        for (const [ser, fmt] of [[serializeSrt, 'srt'], [serializeVtt, 'vtt']] as const) {
          const back = parseSubtitles(ser(cues), fmt).cues;
          expect(back.map((c) => [c.start, c.end])).toEqual(cues.map((c) => [c.start, c.end]));
        }
      }),
    );
  });
});
