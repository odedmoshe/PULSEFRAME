/**
 * Pure subtitle codec: SRT / WebVTT parse + serialize, ASS export, frame snapping.
 * SPEC §16 (captions) and §5 (exact time). No DOM, no floats on the parse/serialize path:
 * file times become `{ value: <ms>, timescale: 1000 }` and rationals are rounded to ms/cs with BigInt.
 */
import { rt, snapToFrame, frameTime, nearestFrameIndex, sub, toSeconds, isNegative, cmp } from '@pulseframe/time';
import type { RationalTime } from '@pulseframe/time';

export interface SubtitleCue {
  start: RationalTime;
  end: RationalTime;
  text: string;
  /** VTT cue id or SRT index as text */
  id?: string;
  /** raw VTT settings line, preserved but not interpreted */
  settings?: string;
}
export interface ParseWarning {
  line: number;
  code: string;
  message: string;
}
export interface ParseResult {
  format: 'srt' | 'vtt';
  cues: SubtitleCue[];
  warnings: ParseWarning[];
}
export class SubtitleParseError extends Error {
  code: string;
  line: number;
  constructor(code: string, message: string, line: number) {
    super(message);
    this.name = 'SubtitleParseError';
    this.code = code;
    this.line = line;
  }
}

const BOM = '﻿';
const TS = String.raw`(?:(\d+):)?(\d{1,2}):(\d{2})([.,])(\d{1,3})`;
const TIMING_RE = new RegExp(String.raw`^[ \t]*${TS}[ \t]*-->[ \t]*${TS}(?:[ \t]+(.*?))?[ \t]*$`);
const ANY_TIMING_RE = new RegExp(String.raw`^[ \t]*${TS}[ \t]*-->[ \t]*${TS}`, 'm');
const VTT_HEADER_RE = /^WEBVTT(?:[ \t]|$)/;
const VTT_SKIP_RE = /^(?:NOTE|STYLE|REGION)(?:[ \t]|$)/;
const BLANK_RE = /^[ \t]*$/;

export function detectFormat(text: string): 'srt' | 'vtt' | null {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  if (VTT_HEADER_RE.test(src.split(/\r\n|\r|\n/, 1)[0] ?? '')) return 'vtt';
  const m = ANY_TIMING_RE.exec(src);
  if (!m) return null;
  // Headerless: a comma decimal separator means SRT; dots only means a VTT missing its header.
  return m[4] === ',' || m[9] === ',' ? 'srt' : 'vtt';
}

/** Returns milliseconds (exact), or null when minutes/seconds are out of range. */
function msFrom(h: string | undefined, m: string, s: string, frac: string): bigint | null {
  if (Number(m) > 59 || Number(s) > 59) return null;
  const ms = BigInt(frac.padEnd(3, '0'));
  return ((BigInt(h ?? '0') * 60n + BigInt(m)) * 60n + BigInt(s)) * 1000n + ms;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', lrm: '‎', rlm: '‏', nbsp: ' ' };
const TAG_RE = /<\/?(?:i|b|u|s|c|v|ruby|rt|rp|lang|font|span)(?:[.\s][^<>]*)?>/gi;
const KARAOKE_RE = /<\d{1,}:\d{2}(?::\d{2})?\.\d{1,3}>/g;
const ASS_OVERRIDE_RE = /\{\\[^}]*\}/g;

function cleanText(raw: string, vtt: boolean): string {
  const stripped = raw.replace(TAG_RE, '').replace(KARAOKE_RE, '').replace(ASS_OVERRIDE_RE, '');
  // Entities are decoded after tag stripping (and in one pass) so "&lt;i&gt;" stays the literal text "<i>".
  return vtt ? stripped.replace(/&(amp|lt|gt|lrm|rlm|nbsp);/g, (_, n: string) => ENTITIES[n] ?? _) : stripped;
}

export function parseSubtitles(text: string, format?: 'srt' | 'vtt'): ParseResult {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const fmt = format ?? detectFormat(src);
  if (!fmt) throw new SubtitleParseError('unknown_format', 'cannot detect subtitle format', 1);
  const vtt = fmt === 'vtt';
  const lines = src.split(/\r\n|\r|\n/);
  const cues: SubtitleCue[] = [];
  const cueLines: number[] = [];
  const warnings: ParseWarning[] = [];
  const warn = (line: number, code: string, message: string) => warnings.push({ line, code, message });
  let hasHeader = false;
  let firstBlock = true;

  let i = 0;
  while (i < lines.length) {
    if (BLANK_RE.test(lines[i]!)) {
      i++;
      continue;
    }
    const startIdx = i;
    while (i < lines.length && !BLANK_RE.test(lines[i]!)) i++;
    const block = lines.slice(startIdx, i);
    const lineNo = startIdx + 1;
    const wasFirst = firstBlock;
    firstBlock = false;

    if (vtt && wasFirst && VTT_HEADER_RE.test(block[0]!)) {
      hasHeader = true;
      continue;
    }
    if (vtt && VTT_SKIP_RE.test(block[0]!)) continue;

    const t = block[0]!.includes('-->') ? 0 : block[1]?.includes('-->') ? 1 : -1;
    if (t < 0) {
      const l = block.length > 1 && /^[ \t]*\d+[ \t]*$/.test(block[0]!) ? 1 : 0;
      warn(lineNo + l, 'bad_timestamp', 'no valid "start --> end" timing line; block skipped');
      continue;
    }
    const timingLine = lineNo + t;
    const m = TIMING_RE.exec(block[t]!);
    if (!m) {
      warn(timingLine, 'bad_timestamp', `malformed timing line: ${block[t]!.trim()}`);
      continue;
    }
    const s = msFrom(m[1], m[2]!, m[3]!, m[5]!);
    const e = msFrom(m[6], m[7]!, m[8]!, m[10]!);
    if (s === null || e === null) {
      warn(timingLine, 'bad_timestamp', 'minutes or seconds out of range');
      continue;
    }
    if (e <= s) {
      warn(timingLine, 'end_before_start', 'cue end is not after its start; cue skipped');
      continue;
    }
    const expectSep = vtt ? '.' : ',';
    if (m[4] !== expectSep || m[9] !== expectSep) {
      warn(timingLine, 'decimal_separator', `expected "${expectSep}" as decimal separator in ${fmt.toUpperCase()}; accepted`);
    }
    const body = cleanText(block.slice(t + 1).join('\n'), vtt);
    if (body.trim() === '') {
      warn(timingLine, 'empty_text', 'cue has no text; cue skipped');
      continue;
    }
    const cue: SubtitleCue = { start: rt(s, 1000), end: rt(e, 1000), text: body };
    if (t === 1) cue.id = block[0]!.trim();
    if (m[11] !== undefined && m[11] !== '') cue.settings = m[11];
    cues.push(cue);
    cueLines.push(timingLine);
  }

  let maxEnd: RationalTime | null = null;
  for (let k = 0; k < cues.length; k++) {
    const c = cues[k]!;
    if (k > 0 && cmp(c.start, cues[k - 1]!.start) < 0) warn(cueLines[k]!, 'unsorted', 'cue starts before the previous cue');
    if (maxEnd && cmp(c.start, maxEnd) < 0) warn(cueLines[k]!, 'overlap', 'cue overlaps an earlier cue');
    if (!maxEnd || cmp(c.end, maxEnd) > 0) maxEnd = c.end;
  }

  if (cues.length === 0 && !(vtt && hasHeader && warnings.length === 0)) {
    const w = warnings[0];
    throw new SubtitleParseError(w?.code ?? 'no_cues', w?.message ?? 'no cues found', w?.line ?? 1);
  }
  return { format: fmt, cues, warnings };
}

/* ------------------------------ serialization ------------------------------ */

/** Round num/den (den > 0) half away from zero. */
function roundDiv(num: bigint, den: bigint): bigint {
  const neg = num < 0n;
  const a = neg ? -num : num;
  const q = (2n * a + den) / (2n * den);
  return neg ? -q : q;
}

/** Validate cues and return each boundary rounded to `unitsPerSecond` ticks. */
function validated(cues: SubtitleCue[], unitsPerSecond: bigint, what: string): { s: bigint; e: bigint; cue: SubtitleCue }[] {
  return cues.map((cue, i) => {
    if (isNegative(cue.start) || isNegative(cue.end)) throw new RangeError(`cue ${i + 1}: negative time`);
    if (cmp(cue.end, cue.start) <= 0) throw new RangeError(`cue ${i + 1}: end must be after start`);
    const s = roundDiv(BigInt(cue.start.value) * unitsPerSecond, BigInt(cue.start.timescale));
    const e = roundDiv(BigInt(cue.end.value) * unitsPerSecond, BigInt(cue.end.timescale));
    if (e <= s) throw new RangeError(`cue ${i + 1}: duration rounds to zero at ${what} precision`);
    return { s, e, cue };
  });
}

const pad = (n: bigint, w: number) => n.toString().padStart(w, '0');
function fmtMs(ms: bigint, sep: ',' | '.'): string {
  return `${pad(ms / 3_600_000n, 2)}:${pad((ms / 60_000n) % 60n, 2)}:${pad((ms / 1000n) % 60n, 2)}${sep}${pad(ms % 1000n, 3)}`;
}

/**
 * Cue text must not contain "-->" (it would be read as a timing line by VTT parsers), so the arrow is
 * replaced by "→" in the output. Blank lines would end the cue and are dropped.
 */
function bodyLines(text: string, i: number): string[] {
  const out = text
    .replace(/\r\n|\r/g, '\n')
    .replace(/-->/g, '→')
    .split('\n')
    .filter((l) => !BLANK_RE.test(l));
  if (out.length === 0) throw new RangeError(`cue ${i + 1}: empty text`);
  return out;
}

export function serializeSrt(cues: SubtitleCue[]): string {
  return validated(cues, 1000n, 'millisecond')
    .map(({ s, e, cue }, i) => `${i + 1}\n${fmtMs(s, ',')} --> ${fmtMs(e, ',')}\n${bodyLines(cue.text, i).join('\n')}\n`)
    .join('\n');
}

export function serializeVtt(cues: SubtitleCue[]): string {
  const blocks = validated(cues, 1000n, 'millisecond').map(({ s, e, cue }, i) => {
    const body = bodyLines(cue.text, i)
      .map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
      .join('\n');
    const id = cue.id && !/[\r\n]|-->/.test(cue.id) ? `${cue.id}\n` : '';
    const settings = cue.settings && !/[\r\n]/.test(cue.settings) ? ` ${cue.settings}` : '';
    return `${id}${fmtMs(s, '.')} --> ${fmtMs(e, '.')}${settings}\n${body}\n`;
  });
  return ['WEBVTT\n', ...blocks].join('\n');
}

export function serializeAss(
  cues: SubtitleCue[],
  opts: {
    width: number;
    height: number;
    fontFamily: string;
    fontSize: number;
    primaryColor: string;
    outlineColor: string;
    alignment?: 2 | 8 | 5;
    marginV?: number;
    rtl?: boolean;
  },
): string {
  if (!Number.isInteger(opts.width) || opts.width <= 0 || !Number.isInteger(opts.height) || opts.height <= 0) {
    throw new RangeError('width and height must be positive integers');
  }
  if (!(opts.fontSize > 0)) throw new RangeError('fontSize must be positive');
  if (!opts.fontFamily || /[,\r\n]/.test(opts.fontFamily)) throw new RangeError('fontFamily must be non-empty without commas or newlines');
  const colour = (c: string) => {
    const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(c);
    if (!m) throw new RangeError(`colour must be #RRGGBB: ${c}`);
    return `&H00${m[3]}${m[2]}${m[1]}`.toUpperCase();
  };
  const primary = colour(opts.primaryColor);
  const outline = colour(opts.outlineColor);
  const marginV = opts.marginV ?? 40;
  const cs = (v: bigint) => `${v / 360_000n}:${pad((v / 6000n) % 60n, 2)}:${pad((v / 100n) % 60n, 2)}.${pad(v % 100n, 2)}`;
  // libass only shapes/reorders RTL text correctly when built with HarfBuzz + FriBidi; the RLE/PDF marks
  // below are a hint, not a guarantee. The FFmpeg text path must be verified on the target build, not assumed.
  const esc = (l: string) => {
    const e = l.replace(/\{/g, '\\{').replace(/\}/g, '\\}');
    return opts.rtl ? `‫${e}‬` : e;
  };
  const events = validated(cues, 100n, 'centisecond').map(({ s, e, cue }, i) => {
    const text = bodyLines(cue.text, i).map(esc).join('\\N');
    return `Dialogue: 0,${cs(s)},${cs(e)},Default,,0,0,0,,${text}`;
  });
  return (
    [
      '[Script Info]',
      'ScriptType: v4.00+',
      `PlayResX: ${opts.width}`,
      `PlayResY: ${opts.height}`,
      'WrapStyle: 0',
      'ScaledBorderAndShadow: yes',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      `Style: Default,${opts.fontFamily},${opts.fontSize},${primary},${primary},${outline},&H00000000,0,0,0,0,100,100,0,0,1,2,0,${opts.alignment ?? 2},10,10,${marginV},1`,
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      ...events,
    ].join('\n') + '\n'
  );
}

/* --------------------------------- snapping --------------------------------- */

export function snapCuesToFrames(
  cues: SubtitleCue[],
  rate: { num: number; den: number },
): { cues: SubtitleCue[]; maxShiftSeconds: number } {
  let maxShift = 0;
  const shift = (a: RationalTime, b: RationalTime) => {
    const d = sub(a, b);
    return Math.abs(toSeconds(d));
  };
  const out = cues.map((cue) => {
    const si = nearestFrameIndex(cue.start, rate);
    const ei = Math.max(nearestFrameIndex(cue.end, rate), si + 1);
    const start = snapToFrame(cue.start, rate);
    const end = frameTime(ei, rate);
    maxShift = Math.max(maxShift, shift(start, cue.start), shift(end, cue.end));
    return { ...cue, start, end };
  });
  return { cues: out, maxShiftSeconds: maxShift };
}
