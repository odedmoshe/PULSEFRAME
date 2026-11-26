/**
 * booth:ingest (wave 8 booth; verify C4): the evidence JSON has no notes, marks stale answers, refuses a damaged block with the reason,
 * and the CLI writes <date>.json (into a temporary --out here).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { boothReport, type BoothItemView, type BoothSay } from '../../packages/core/src/index.ts';
import { boothItems } from '../../apps/server/src/booth/registry.ts';
import { ingestBoothReport } from './ingest.ts';

const LINE = 'ffmpeg version 7.1-full_build-www.gyan.dev Copyright (c) 2000-2024 the FFmpeg developers';
const env = { ffmpegLine: LINE, picturesRgba: `sha256:${'c'.repeat(64)}` };
const items = boothItems(env);
const say: BoothSay = (k) => k;
const NOTE = 'נועה בכתה כאן';
const at = (id: string) => items.find((i) => i.id === id)!;
const views: BoothItemView[] = [
  { item: at('music:music.calm'), answer: { id: 'music:music.calm', verdict: 'bad', problems: ['harsh'], note: NOTE, recipe: at('music:music.calm').recipe, at: '2026-11-27T10:00:00Z', build: 'abc1234' }, state: 'answered' },
  { item: at('music:music.pop'), answer: { id: 'music:music.pop', verdict: 'bad', problems: ['too-loud'], recipe: `sha256:${'7'.repeat(64)}`, at: '2026-11-27T10:01:00Z', build: 'abc1234' }, state: 'changed', changedWhy: 'recipe' },
  { item: at('sfx:sfx.pop'), answer: { id: 'sfx:sfx.pop', verdict: 'ok', recipe: at('sfx:sfx.pop').recipe, at: '2026-11-27T10:02:00Z', build: 'abc1234' }, state: 'answered' },
  { item: at('gpu-transition:film-burn'), answer: { id: 'gpu-transition:film-burn', verdict: 'ok', recipe: at('gpu-transition:film-burn').recipe, browserAdapter: 'intel|gen-12lp||', browserSoftware: false, at: '2026-11-27T10:03:00Z', build: 'abc1234' }, state: 'answered' },
];
const report = boothReport({
  view: { build: { commit: 'abc1234', bundle: 'unknown' }, machine: { os: 'Windows_NT 10.0.26100 x64', cpus: 12, memGiB: 16 }, firstSitting: { cards: 14, groups: ['first.gpu-new', 'first.music', 'first.mic'] }, groups: [], items: views },
  checks: [{ id: 'ffmpeg', state: 'ok', code: 'encoder_present', data: { version: LINE, h264_nvenc: true } }, { id: 'browser-gpu', state: 'ok', code: 'integrated', data: { vendor: 'intel', adapter: 'intel|gen-12lp||' } }],
  date: '2026-11-27',
}, say);
const ctx = (localFfmpegLine = 'ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers') => ({ commit: 'def567890abc', localFfmpegLine, itemsFor: (l: string) => boothItems({ ...env, ffmpegLine: l }) });

describe('ingestBoothReport', () => {
  it('writes no note, keeps verdicts and adapters, marks stale on another recipe, and words the status as the owner\'s statement', () => {
    expect(report).toContain(NOTE); // the human part has the note
    const r = ingestBoothReport(report, ctx());
    if (!r.ok) throw new Error(r.code);
    const json = JSON.stringify(r.review);
    expect(json).not.toContain('נועה');
    expect(json).not.toMatch(/note/i);
    expect(r.review.answers.map((a) => [a.id, a.verdict, a.stale, a.why ?? null])).toEqual([
      ['music:music.calm', 'bad', false, null], ['music:music.pop', 'bad', true, 'recipe'], ['sfx:sfx.pop', 'ok', false, null], ['gpu-transition:film-burn', 'ok', false, null],
    ]);
    expect(r.review.statusWord).toBe('owner-reviewed (their machine, 2026-11-27, adapter intel|gen-12lp||, build abc1234)');
    expect(json).not.toMatch(/verified|good/i);
  });
  it('an SFX recipe made with the owner\'s ffmpeg is current when the block\'s ffmpeg row names it; otherwise stale (recipe-or-ffmpeg)', () => {
    const r = ingestBoothReport(report, ctx('ffmpeg version 5'));
    expect(r.ok && r.review.answers.find((a) => a.id === 'sfx:sfx.pop')!.stale).toBe(false);
    const other = boothItems({ ...env, ffmpegLine: 'ffmpeg version 4' });
    const r2 = ingestBoothReport(report, { commit: 'x', localFfmpegLine: 'ffmpeg version 5', itemsFor: () => other });
    expect(r2.ok && r2.review.answers.find((a) => a.id === 'sfx:sfx.pop')).toMatchObject({ stale: true, why: 'recipe-or-ffmpeg' });
    const r3 = ingestBoothReport(report, { commit: 'x', localFfmpegLine: 'x', itemsFor: () => [] });
    expect(r3.ok && r3.review.answers.every((a) => a.why === 'unknown-item')).toBe(true);
  });
  it('refuses with the reason: no block, a bidi mark, a changed character', () => {
    expect(ingestBoothReport('hello', ctx())).toMatchObject({ ok: false, code: 'no_block' });
    const lines = report.split('\n');
    const i = lines.findIndex((l) => l.startsWith('-----BEGIN')) + 1;
    lines[i] = `‏${lines[i]}`;
    expect(ingestBoothReport(lines.join('\n'), ctx())).toMatchObject({ ok: false, code: 'not_ascii' });
    expect(ingestBoothReport(report.replace('"cpus":12', '"cpus":13'), ctx())).toMatchObject({ ok: false, code: 'checksum' });
  });
  it('the CLI writes <date>.json into --out and exits 1 with the reason on a damaged block', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-booth-ingest-'));
    try {
      const f = path.join(dir, 'report.txt');
      fs.writeFileSync(f, report);
      const tsx = path.resolve('node_modules/.bin/tsx');
      const out = execFileSync(tsx, ['tools/booth/ingest.ts', f, '--out', path.join(dir, 'out')], { encoding: 'utf8' });
      expect(out).toContain('owner-reviewed (their machine, 2026-11-27');
      const written = JSON.parse(fs.readFileSync(path.join(dir, 'out', '2026-11-27.json'), 'utf8'));
      expect(written.answers.length).toBe(4);
      expect(JSON.stringify(written)).not.toContain('נועה');
      fs.writeFileSync(f, report.replace('"cpus":12', '"cpus":13'));
      let code = 0, err = '';
      try { execFileSync(tsx, ['tools/booth/ingest.ts', f, '--out', path.join(dir, 'out2')], { encoding: 'utf8', stdio: 'pipe' }); } catch (e) { code = (e as { status: number }).status; err = String((e as { stderr: string }).stderr); }
      expect(code).toBe(1);
      expect(err).toContain('checksum');
      expect(fs.existsSync(path.join(dir, 'out2'))).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});
