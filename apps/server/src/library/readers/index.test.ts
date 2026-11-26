/**
 * Which ledger entries are listed, and by which reader (lead decision, wave 7 library integration): a source without a reader of
 * its own is listed by folder only under music/ and sounds/ (generic-audio) and visual/ (generic-image), where every file of the
 * entry shares the entry's single licence; FSD50K and FSL10K (a licence per clip) and the instruments, models, fonts, maps and
 * transitions folders are never listed, only counted («לא נקרא»).
 */
import { describe, expect, it } from 'vitest';
import type { LedgerEntry } from '@pulseframe/core';
import { genericAudio } from './genericAudio.ts';
import { genericImage } from './genericImage.ts';
import { incompetech } from './incompetech.ts';
import { readerFor } from './index.ts';

const e = (source: string, path: string) => ({ item: `${source}/x`, source, path, kind: 'file' }) as unknown as LedgerEntry;
const name = (c: ReturnType<typeof readerFor>) => ('reader' in c ? c.reader : c.notListed);

describe('readerFor (the one switch)', () => {
  it('a source with its own reader is read by it', () => {
    expect(name(readerFor(e('incompetech', 'music/incompetech/mp3/a.mp3')))).toBe(incompetech);
    expect(name(readerFor(e('musopen-flac', 'music/musopen/flac/a.flac')))).toBe(genericAudio);
  });
  it('a source without a reader: listed by folder only for music, sounds and pictures', () => {
    expect(name(readerFor(e('some-cc0-music', 'music/other/a.wav')))).toBe(genericAudio);
    expect(name(readerFor(e('some-cc0-sounds', 'sounds/other/a.wav')))).toBe(genericAudio);
    expect(name(readerFor(e('some-cc0-pictures', 'visual/illustrations/a.png')))).toBe(genericImage);
    expect(name(readerFor(e('something-else', 'docs/a.txt')))).toBe('source:something-else');
  });
  it('per-clip licence sets and the counted folders are never listed', () => {
    expect(name(readerFor(e('fsd50k', 'sounds/fsd50k/FSD50K.dev_audio.zip')))).toBe('source:fsd50k');
    expect(name(readerFor(e('fsl10k', 'sounds/loops/fsl10k')))).toBe('source:fsl10k');
    expect(name(readerFor(e('tinysol', 'instruments/tinysol/audio')))).toBe('instruments');
    expect(name(readerFor(e('t5-base', 'models/t5-base/model.safetensors')))).toBe('models');
    expect(name(readerFor(e('google-fonts-hebrew', 'visual/fonts/google-fonts')))).toBe('visual/fonts');
    expect(name(readerFor(e('natural-earth', 'visual/maps/natural-earth')))).toBe('visual/maps');
    expect(name(readerFor(e('gl-transitions', 'visual/transitions/gl-transitions-3.3.0')))).toBe('visual/transitions');
  });
});
