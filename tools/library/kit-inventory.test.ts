// Tests for the kit inventory (a read-only look at a sample set in the library). Everything here is a tiny synthetic tree in a temp folder.
import { afterAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { insideItem, keyNumber, run, scanSfz, wavInfo } from './kit-inventory.mjs';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function wav(frames: number, rate = 44100, channels = 2, bits = 16, smpl = false): Buffer {
  const block = channels * (bits / 8), data = Buffer.alloc(frames * block);
  const fmt = Buffer.alloc(24); fmt.write('fmt ', 0, 'latin1'); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(1, 8); fmt.writeUInt16LE(channels, 10); fmt.writeUInt32LE(rate, 12); fmt.writeUInt32LE(rate * block, 16); fmt.writeUInt16LE(block, 20); fmt.writeUInt16LE(bits, 22);
  const dh = Buffer.alloc(8); dh.write('data', 0, 'latin1'); dh.writeUInt32LE(data.length, 4);
  const extra = smpl ? Buffer.concat([Buffer.from('smpl', 'latin1'), Buffer.from([4, 0, 0, 0]), Buffer.alloc(4)]) : Buffer.alloc(0);
  const body = Buffer.concat([Buffer.from('WAVE', 'latin1'), fmt, extra, dh, data]);
  const head = Buffer.alloc(8); head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}
function tree(): { root: string; item: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitinv-')); dirs.push(root);
  const item = path.join(root, 'instruments', 'set');
  const put = (rel: string, data: Buffer | string) => { const f = path.join(item, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
  put('Samples/Piano/A 3 soft.wav', wav(44100));
  put('Samples/Piano/C4.wav', wav(22050, 48000, 1, 24, true));
  put('Samples/Strings/sus_C3.wav', wav(88200));
  put('SFZ/common.sfz', '<global> ampeg_release=0.4\n');
  put('SFZ/Piano.sfz', '// a piano\n#include "common.sfz"\n<control> default_path=..\\Samples\\Piano\\\n<group> lovel=1 hivel=80\n<region> sample=A 3 soft.wav lokey=a2 hikey=b3 pitch_keycenter=a3\n<region> sample=c4.WAV key=60 loop_mode=loop_continuous\n');
  put('SFZ/Strings.sfz', '<region> sample=../Samples/Strings/sus_C3.wav key=c3\n<region> sample=../Samples/Strings/nope.wav key=d3\n<region> sample=../../../outside.wav key=e3 trigger=release\n');
  put('.git/config', 'x');
  return { root, item };
}

describe('kit inventory', () => {
  it('resolves .. inside the item and refuses what leaves it', () => {
    expect(insideItem('SFZ', '..\\Samples\\Piano\\C4.wav')).toBe('Samples/Piano/C4.wav');
    expect(insideItem('SFZ', '../../x.wav')).toBeNull();
    expect(insideItem('SFZ', 'C:\\x.wav')).toBeNull();
    expect(insideItem('SFZ', '/etc/passwd')).toBeNull();
    expect(insideItem('', 'a/./b//c.wav')).toBe('a/b/c.wav');
  });
  it('reads note names and numbers', () => {
    expect(keyNumber('c4')).toBe(60); expect(keyNumber('A3')).toBe(57); expect(keyNumber('c#4')).toBe(61); expect(keyNumber('db4')).toBe(61); expect(keyNumber('60')).toBe(60); expect(keyNumber('x')).toBeNull();
  });
  it('scans regions, sample paths with spaces, default_path, includes and key range', () => {
    const s = scanSfz('<control> default_path=..\\S\\\n#include "inc.sfz"\n<region> sample=A 3 soft.wav lokey=a2 hikey=b3 // note\n<region> sample=x.wav key=60', (rel) => (rel === 'SFZ/inc.sfz' ? '<global> volume=-3' : null), 'SFZ/p.sfz');
    expect(s.regions).toBe(2);
    expect(s.samples.map((x) => x.withDefault)).toEqual(['../S/A 3 soft.wav', '../S/x.wav']);
    expect(s.includes).toEqual(['SFZ/inc.sfz']);
    expect([s.keyLo, s.keyHi]).toEqual([45, 60]);
    expect(s.opcodes.volume).toBe(1);
  });
  it('reads a WAV header by chunks and says nothing about a file that is not one', () => {
    const { item } = tree();
    const w = wavInfo(path.join(item, 'Samples', 'Piano', 'C4.wav'));
    expect(w).toMatchObject({ rate: 48000, channels: 1, bits: 24, frames: 22050, smpl: true });
    expect(wavInfo(path.join(item, 'SFZ', 'Piano.sfz'))).toBeNull();
  });
  it('overview: one line per .sfz with exact, case-only, missing and outside samples counted; .git is not listed', () => {
    const { root } = tree();
    const out: string[] = [];
    expect(run(['--root', root, '--item', 'instruments/set'], (l) => out.push(l))).toBe(0);
    expect(out[0]).toMatch(/^ITEM instruments\/set files=6 /);
    const piano = out.find((l) => l.startsWith('SFZ "SFZ/Piano.sfz"'))!;
    expect(piano).toMatch(/regions=2 files=2 .*missing=0 outside=0 caseOnly=1 dotdot=2 backslash=0 includes=1 keys=45\.\.60/);
    expect(piano).toMatch(/smpl=1 rate=44100\/48000 bits=16\/24 ch=1\/2/);
    const strings = out.find((l) => l.startsWith('SFZ "SFZ/Strings.sfz"'))!;
    expect(strings).toMatch(/regions=3 files=1 .*missing=1 outside=1 .*release=1/);
    const only: string[] = [];
    run(['--root', root, '--item', 'instruments/set', '--match', 'piano'], (l) => only.push(l));
    expect(only.filter((l) => l.startsWith('SFZ "')).length).toBe(1);
  });
  it('table: every file once with its sha256, a digest of the lines, saved under _manifests; a missing sample exits 1', () => {
    const { root, item } = tree();
    const out: string[] = [];
    expect(run(['--root', root, '--item', 'instruments/set', '--sfz', 'SFZ\\Piano.sfz'], (l) => out.push(l))).toBe(0);
    const lines = out.slice(out.indexOf('BEGIN') + 1, out.indexOf('END'));
    expect(lines.map((l) => l.split('  ')[2])).toEqual(['SFZ/Piano.sfz', 'SFZ/common.sfz', 'Samples/Piano/A 3 soft.wav', 'Samples/Piano/C4.wav']);
    const first = lines[0]!.split('  ');
    expect(first[0]).toBe(crypto.createHash('sha256').update(fs.readFileSync(path.join(item, 'SFZ', 'Piano.sfz'))).digest('hex'));
    const digest = crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
    expect(out.find((l) => l.startsWith('TABLE '))).toBe(`TABLE files=4 bytes=${lines.reduce((n, l) => n + Number(l.split('  ')[1]), 0)} sha256=${digest}`);
    const saved = fs.readdirSync(path.join(root, '_manifests', 'kit-inventory'));
    expect(saved).toEqual([`instruments_set-${digest.slice(0, 12)}.txt`]);
    expect(run(['--root', root, '--item', 'instruments/set', '--sfz', 'SFZ/Strings.sfz'], () => {})).toBe(1);
  });
  it('bad use: an item outside the library, an unknown argument', () => {
    const { root } = tree();
    expect(() => run(['--root', root, '--item', '../x'], () => {})).toThrow(/inside the library/);
    expect(() => run(['--nope'], () => {})).toThrow(/unknown argument/);
  });
});
