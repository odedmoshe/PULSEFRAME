/**
 * The upright piano's file table of kit.calm.vsco@1 (musicKits.vsco.ts): the 70 lines the kit-inventory tool read on the owner's
 * computer on 2026-11-26, recomputed from the constant. Nothing here reads a sample or says how anything sounds.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { KitFileSchema, kitCalibrated, MUSIC_KITS } from './musicKits.ts';
import { VSCO_UPRIGHT_PIANO_FILES } from './musicKits.vsco.ts';

describe('VSCO_UPRIGHT_PIANO_FILES', () => {
  it('70 files, 253,644,252 bytes, table digest f002db28… (sha256 of the lines "sha256  bytes  path" joined by \\n, in order)', () => {
    expect(VSCO_UPRIGHT_PIANO_FILES.length).toBe(70);
    expect(VSCO_UPRIGHT_PIANO_FILES.reduce((s, f) => s + f.bytes, 0)).toBe(253_644_252);
    const text = VSCO_UPRIGHT_PIANO_FILES.map((f) => `${f.sha256}  ${f.bytes}  ${f.path}`).join('\n');
    expect(createHash('sha256').update(text).digest('hex')).toBe('f002db28b36570a6627b34a51b65b1109034406ed49fc0a01fd8982daf89d4a0');
    for (const f of VSCO_UPRIGHT_PIANO_FILES) expect(KitFileSchema.safeParse(f).success, f.path).toBe(true);
    expect(new Set(VSCO_UPRIGHT_PIANO_FILES.map((f) => f.path)).size).toBe(70);
  });
  it('is the piano of kit.calm.vsco with entry UprightPiano.sfz (a listed file); the kit stays not calibrated (strings not read)', () => {
    const kit = MUSIC_KITS.find((k) => k.id === 'kit.calm.vsco')!;
    const piano = kit.instruments.find((i) => i.id === 'piano')!;
    expect(piano.entry).toBe('UprightPiano.sfz');
    expect(piano.files).toEqual([...VSCO_UPRIGHT_PIANO_FILES]);
    expect(piano.files.some((f) => f.path === piano.entry)).toBe(true);
    const strings = kit.instruments.find((i) => i.id === 'strings')!;
    expect([strings.entry, strings.files.length]).toEqual([null, 0]);
    expect(kitCalibrated(kit)).toBe(false);
  });
});
