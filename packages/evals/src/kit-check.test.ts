/**
 * pnpm kit:check (kit-check.ts) against the LABELLED synthetic test library (packages/fixtures/src/instruments.ts: tones written by
 * code under a temporary folder; never a real sample set). The real kit (kit.calm.vsco) has no download here: it must answer
 * item_missing. Checks: the report's line formats, a missing file (exit 1 with the state), the proposed gains matching the synth RMS
 * within 0.1 dB on a second pass, the audition folder rules, and that nothing is written into the library or the repository.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SYNTHETIC_KIT_LABEL, writeSyntheticKit } from '../../fixtures/src/instruments.ts';
import { kitCheckMain } from './kit-check.ts';

const REPO = path.resolve(import.meta.dirname, '../../..');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (p: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };
function snapshot(root: string): string {
  const rows: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { const st = fs.statSync(p); rows.push(`${path.relative(root, p)} ${st.size} ${st.mtimeMs} ${createHash('sha256').update(fs.readFileSync(p)).digest('hex')}`); } } };
  walk(root);
  return rows.join('\n');
}
const gitStatus = () => { try { return execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: REPO, encoding: 'utf8' }); } catch { return 'no git'; } };
async function run(args: string[]): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const code = await kitCheckMain(args, { out: (l) => lines.push(l) });
  return { code, lines };
}
function world() {
  const lib = writeSyntheticKit(tmp('pf-kitcheck-lib-'), { pianoSeconds: 3, stringsSeconds: 2 });
  const side = tmp('pf-kitcheck-side-');
  const table = path.join(side, 'kits.json');
  fs.writeFileSync(table, JSON.stringify([lib.kit]));
  return { lib, side, table, base: ['--library', lib.root, '--kit', 'kit.calm.synthetic', '--kit-table', table, '--bars', '4', '--seed', '1'] };
}
const GAIN = /^GAIN (pad|double|arp|lead) current=(-?\d+\.\d{2}) proposed=(-?\d+\.\d{2}) synthRms=(\d+\.\d+) sampledRms=(\d+\.\d+) sampledPeakAtProposed=(\d+\.\d+)$/;
const gains = (lines: string[]) => lines.flatMap((l) => { const m = GAIN.exec(l); return m ? [{ part: m[1]!, current: Number(m[2]), proposed: Number(m[3]), synth: Number(m[4]), sampled: Number(m[5]) }] : []; });

describe('kit:check on the synthetic test library', () => {
  it('reports every section in order with stable ASCII lines, no absolute path, and writes nothing into the library or the repository; the proposed gains match on a second pass', async () => {
    const w = world();
    expect(w.lib.label).toBe(SYNTHETIC_KIT_LABEL);
    const before = snapshot(w.lib.root), git0 = gitStatus();
    const r = await run(w.base);
    expect(r.code, r.lines.join('\n')).toBe(0);
    for (const l of r.lines) {
      expect(l).toMatch(/^[\x20-\x7e]*$/);
      expect(l).toMatch(/^(KIT|L1|L4|GAIN|L6|L2|SUMMARY) /);
      for (const p of [w.lib.root, REPO, os.tmpdir(), os.homedir()]) expect(l.includes(p), l).toBe(false);
    }
    const order = [...new Set(r.lines.map((l) => l.split(' ')[0]!.replace('GAIN', 'L6')))];
    expect(order).toEqual(['KIT', 'L1', 'L4', 'L6', 'L2', 'SUMMARY']);
    expect(r.lines[0]).toMatch(/^KIT id=kit\.calm\.synthetic version=1 bank=[0-9a-f]{16} sampler=1 commit=([0-9a-f]{40}|unknown) node=v\d+\.\d+\.\d+ platform=\S+ style=music\.calm bars=4 seed=1$/);
    expect(r.lines).toContain(r.lines.find((l) => /^L1 state=ready files=14 bytes=\d+ bank=[0-9a-f]{16}$/.test(l)));
    expect(r.lines.filter((l) => /^L1 instrument (strings|piano) entry=\S+ files=7 regions=6 zones=6 rates=\d+ bits=\d+ channels=[12] loopedZones=\d+ zonesPlanned=\d+ decodedBytesPlanned=\d+$/.test(l))).toHaveLength(2);
    expect(r.lines.filter((l) => /^L4 part (pad|double|arp|lead) instrument=\S+ notes=\d+ outOfRange=0 edge=\d+ edgeDistances=\S+ samplesShort=\d+ worstShortMs=\d+\.\d$/.test(l))).toHaveLength(4);
    expect(r.lines.some((l) => /^L4 mix peak=\d\.\d{4} rms=\d\.\d{6} rmsDb=-?\d+\.\d{2} clamped=\d+ samplesAtCeiling=\d+ frames=\d+$/.test(l))).toBe(true);
    expect(r.lines).toContain('L4 validation ok');
    expect(gains(r.lines).map((g) => g.part)).toEqual(['pad', 'double', 'arp', 'lead']);
    expect(r.lines.some((l) => /^L6 mix atProposed peak=\d\.\d{4} rms=\d\.\d{6} rmsDb=-?\d+\.\d{2} clamped=\d+ validation=\S+$/.test(l))).toBe(true);
    expect(r.lines.some((l) => /^L2 pcm sha256=[0-9a-f]{64} again=equal child=equal equal=yes$/.test(l))).toBe(true);
    expect(r.lines.filter((l) => /^L2 golden (instruments|music) .* sha256=[0-9a-f]{64} equal=yes$/.test(l))).toHaveLength(8);
    expect(r.lines.at(-1)).toBe('SUMMARY ok');
    // the second pass, with the proposed gains in a copy of the kit table: the sampled part's RMS meets the synth's within 0.1 dB
    const first = gains(r.lines);
    const kit2 = { ...w.lib.kit, parts: Object.fromEntries(Object.entries(w.lib.kit.parts).map(([k, p]) => [k, { ...p, gainDb: first.find((g) => g.part === k)!.proposed }])) };
    const table2 = path.join(w.side, 'kits2.json');
    fs.writeFileSync(table2, JSON.stringify([kit2]));
    const r2 = await run([...w.base.slice(0, 5), table2, ...w.base.slice(6)]);
    expect(r2.code, r2.lines.join('\n')).toBe(0);
    for (const g of gains(r2.lines)) {
      expect(g.current).toBe(first.find((x) => x.part === g.part)!.proposed);
      expect(Math.abs(20 * Math.log10(g.sampled / g.synth)), `${g.part}`).toBeLessThan(0.1);
    }
    expect(snapshot(w.lib.root)).toBe(before);
    expect(gitStatus()).toBe(git0);
  }, 600_000);

  it('a missing kit file: exit 1 with the state, the refusal code and the path inside the item', async () => {
    const w = world();
    fs.rmSync(path.join(w.lib.items.piano.dir, 'samples', fs.readdirSync(path.join(w.lib.items.piano.dir, 'samples'))[0]!));
    const r = await run(w.base);
    expect(r.code).toBe(1);
    expect(r.lines[1]).toMatch(/^L1 state=file_missing code=instruments_file_missing path=samples\/piano-\S+\.wav message=".*"$/);
    expect(r.lines.at(-1)).toBe('SUMMARY failed=L1');
  }, 120_000);

  it('the real kit name answers item_missing honestly (this container has no download of it)', async () => {
    const w = world();
    const r = await run(['--library', w.lib.root, '--kit', 'kit.calm.vsco']);
    expect(r.code).toBe(1);
    expect(r.lines[0]).toMatch(/^KIT id=kit\.calm\.vsco version=1 bank=[0-9a-f]{16} /);
    expect(r.lines[1]).toMatch(/^L1 state=item_missing code=instruments_item_missing path=vsco-2-ce\/repo /);
  }, 60_000);

  it('the audition folder: refused inside a git working copy or when not empty; otherwise the blind pair and a key file', async () => {
    const w = world();
    const inRepo = await run([...w.base, '--audition', path.join(REPO, '.artifacts-kitcheck-audition-never')]);
    expect([inRepo.code, inRepo.lines.at(-2)]).toEqual([2, 'L5 refused reason="it is inside a git working copy"']);
    expect(fs.existsSync(path.join(REPO, '.artifacts-kitcheck-audition-never'))).toBe(false);
    const full = tmp('pf-kitcheck-full-');
    fs.writeFileSync(path.join(full, 'x'), 'x');
    expect((await run([...w.base, '--audition', full])).lines.at(-2)).toBe('L5 refused reason="it is not empty"');
    const out = path.join(tmp('pf-kitcheck-aud-'), 'pair');
    const r = await run([...w.base, '--audition', out]);
    expect(r.code, r.lines.join('\n')).toBe(0);
    expect(fs.readdirSync(out).sort()).toEqual(['A.wav', 'B.wav', 'key.txt']);
    expect(r.lines.some((l) => /^L5 audition files=A\.wav,B\.wav,key\.txt levelScale=\d\.\d{4} matchedRms=\d\.\d{6} /.test(l))).toBe(true);
    const rms = (f: string) => { const b = fs.readFileSync(path.join(out, f)); let e = 0; for (let o = 44; o < b.length; o += 2) e += b.readInt16LE(o) ** 2; return Math.sqrt(e / ((b.length - 44) / 2)); };
    expect(Math.abs(20 * Math.log10(rms('A.wav') / rms('B.wav')))).toBeLessThan(0.1);
  }, 600_000);
});
