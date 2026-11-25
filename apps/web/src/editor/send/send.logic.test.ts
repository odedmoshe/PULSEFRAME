import { describe, expect, it } from 'vitest';
import type { ClipLoudnessRow, ExportChecks } from '@pulseframe/core';
import { createProject } from '@pulseframe/core';
import { defaultCeiling, bytesOfMb, clockOf, defaultMatchTarget, fitLineParts, findingRows, frameAt, limiterState, lookedKinds, matchOpArgs, parseCeiling, parseTarget, parseTargetMb, planMatch, readFitPlan, reductionPct, sayMb, skippedRows } from './send.logic.ts';

const rt = (value: number, timescale = 1) => ({ value: String(value), timescale });
const row = (clipId: string, lufs: number | null, peak: number | null, status: ClipLoudnessRow['status'] = 'measured', gain = 1): ClipLoudnessRow => ({ clipId, status, measuredLufs: lufs, peakDbfs: peak, gain, seconds: 10 });

describe('target size', () => {
  it('reads megabytes as 1,000,000 bytes and keeps the schema range', () => {
    expect(parseTargetMb('16')).toEqual({ ok: true, bytes: 16_000_000 });
    expect(parseTargetMb(' 16,5 ')).toEqual({ ok: true, bytes: 16_500_000 });
    expect(parseTargetMb('0.5')).toEqual({ ok: false, reason: 'too_small' });
    expect(parseTargetMb('4001')).toEqual({ ok: false, reason: 'too_big' });
    expect(parseTargetMb('4000')).toEqual({ ok: true, bytes: 4_000_000_000 });
    expect(parseTargetMb('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseTargetMb('1e3')).toEqual({ ok: false, reason: 'not_a_number' });
    expect(parseTargetMb('-5')).toEqual({ ok: false, reason: 'not_a_number' });
    expect(bytesOfMb(16.1)).toBe(16_100_000);
    expect(sayMb(16_000_000)).toBe('16');
    expect(sayMb(16_500_000)).toBe('16.5');
  });
  it('reads the plan: a fit refusal wins and carries the smallest size', () => {
    expect(readFitPlan({ manifest: { fit: { width: 480, height: 270, scale: 0.25, targetBytes: 16_000_000 } }, blockers: [] })).toEqual({ kind: 'plan', width: 480, height: 270, scale: 0.25, targetBytes: 16_000_000 });
    const r = readFitPlan({ blockers: [{ code: 'size_fit_too_small', message: 'm', hint: 'h', minBytes: 41_000_000 }] });
    expect(r).toMatchObject({ kind: 'refused', code: 'size_fit_too_small', minBytes: 41_000_000, hint: 'h' });
    expect(readFitPlan({ manifest: {}, blockers: [{ code: 'empty_sequence', message: 'x' }] })).toEqual({ kind: 'unknown' });
    expect(readFitPlan(null)).toEqual({ kind: 'unknown' });
  });
  it('the file card line counts attempts and calls nothing fine', () => {
    expect(fitLineParts({ targetBytes: 16_000_000, bytes: 15_600_000, attempts: [{}], result: 'fitted' })).toEqual({ got: '15.6', target: '16', attempt: 1, already: false });
    expect(fitLineParts({ targetBytes: 16_000_000, bytes: 15_900_000, attempts: [{}, {}], result: 'fitted' })?.attempt).toBe(2);
    expect(fitLineParts(null)).toBeNull();
  });
});

describe('the export report', () => {
  const checks: ExportChecks = {
    lookedFor: ['black', 'frozen', 'silence', 'clipped'],
    picture: { method: 'm', status: 'measured', findings: [{ kind: 'frozen', from: rt(90, 30), to: rt(150, 30), measured: { frames: 60 } }, { kind: 'black', from: rt(30, 30), to: rt(60, 30), context: 'gap', measured: {} }] },
    sound: { method: 'm', status: 'measured', findings: [{ kind: 'silence', from: rt(61, 10), to: rt(81, 10), soundPlays: false, measured: { rmsDb: -72.12345 } }] },
  };
  it('lists findings earliest first, with exact frames', () => {
    const rows = findingRows(checks, { num: 30, den: 1 });
    expect(rows.map((r) => r.kind)).toEqual(['black', 'frozen', 'silence']);
    expect(rows[0]).toMatchObject({ fromText: '0:01.0', toText: '0:02.0', frame: 30, context: 'gap' });
    expect(rows[2]).toMatchObject({ frame: 183, soundPlays: false, measured: 'rmsDb -72.123' });
    expect(findingRows(null, { num: 30, den: 1 })).toEqual([]);
  });
  it('frame arithmetic is exact at a fractional rate and floors', () => {
    expect(frameAt(rt(1001, 30000), { num: 30000, den: 1001 })).toBe(1);
    expect(frameAt(rt(1000, 30000), { num: 30000, den: 1001 })).toBe(0);
    expect(clockOf(rt(67300, 1000))).toBe('1:07.3');
  });
  it('a quiet report names only the kinds a part measured', () => {
    expect(lookedKinds(checks)).toEqual({ kinds: ['black', 'frozen', 'silence', 'clipped'], allMeasured: true });
    const half = { ...checks, sound: { ...checks.sound, status: 'not_measured' as const } };
    expect(lookedKinds(half)).toEqual({ kinds: ['black', 'frozen'], allMeasured: false });
  });
});

describe('limiter', () => {
  it('starts at the true peak target, kept inside −9…0, else −1', () => {
    const d = createProject({ id: 'p', name: 'x', width: 1920, height: 1080, frameRate: { num: 30, den: 1 } });
    expect(defaultCeiling(d)).toBe(-1);
    expect(defaultCeiling({ settings: { ...d.settings, loudness: { target: -14, truePeak: -12 } } })).toBe(-9);
  });
  it('ceiling is −9…0, one decimal', () => {
    expect(parseCeiling('-1')).toBe(-1);
    expect(parseCeiling('−0,5')).toBe(-0.5);
    expect(parseCeiling('-10')).toBeNull();
    expect(parseCeiling('0.1')).toBeNull();
    expect(parseCeiling('abc')).toBeNull();
  });
  it('the bar is empty with no limiter running and full at 12 dB', () => {
    expect(reductionPct(null)).toBeNull();
    expect(reductionPct(0)).toBe(0);
    expect(reductionPct(-6)).toBe(50);
    expect(reductionPct(-30)).toBe(100);
  });
  it('says honestly when the preview plays without it', () => {
    expect(limiterState(null, null, false)).toBe('off');
    expect(limiterState(-1, null, true)).toBe('on');
    expect(limiterState(-1, 'could not be loaded', false)).toBe('unavailable');
    expect(limiterState(-1, null, false)).toBe('unavailable');
  });
});

describe('clip loudness match', () => {
  const doc = createProject({ id: 'p', name: 'x', width: 1920, height: 1080, frameRate: { num: 30, den: 1 } });
  const rows = [row('a', -24, -12), row('b', -20, -10), row('c', -16, -3), row('d', null, null, 'silent'), row('e', -30, -20, 'too_short')];
  it('offers the median, and −18 for a single clip', () => {
    expect(defaultMatchTarget(rows, -20)).toBe(-20);
    expect(defaultMatchTarget([row('a', -24, -12)], -24)).toBe(-18);
    expect(defaultMatchTarget([row('d', null, null, 'silent')], null)).toBeNull();
  });
  it('plans with the op\'s own function and leaves unmeasurable clips out, saying so', () => {
    const plan = planMatch(doc, rows, -20);
    expect(plan.map((p) => p.clipId)).toEqual(['a', 'b', 'c']);
    expect(plan[0]!.changeDb).toBeCloseTo(4, 1);
    expect(plan[1]!.changeDb).toBeCloseTo(0, 1);
    expect(plan[2]!.changeDb).toBeCloseTo(-4, 1);
    expect(skippedRows(rows).map((r) => r.clipId)).toEqual(['d', 'e']);
    expect(matchOpArgs(rows, -20).clips).toHaveLength(3);
  });
  it('a peak stops the raise', () => {
    const p = planMatch(doc, [row('a', -30, -2)], -18);
    expect(p[0]!.limitedBy).toBe('peak');
  });
  it('parses a typed target in −40…−5', () => {
    expect(parseTarget('−18')).toBe(-18);
    expect(parseTarget('-3')).toBeNull();
    expect(parseTarget('x')).toBeNull();
  });
});
