/** Owner-visible Hebrew defects: header field words, built-in music label, pack hints, export fix labels, installer detail. */
import { describe, expect, it } from 'vitest';
import { CAPTION_LOOKS, MUSIC_STYLES, PACKS, TEMPLATES, type Asset } from '@pulseframe/core';
import { assetDisplayName } from './assetLabel.ts';
import { clipLabel } from './Timeline.tsx';
import { readableHint } from './packs.logic.ts';
import { PACK_STRINGS } from './packs.strings.ts';
import { fixLabel } from './exportSheet.logic.ts';
import { EXPORT_STRINGS } from './exportSheet.strings.ts';
import { installerDetail } from './AiTools.tsx';

const music = (name: string, bars: number): Pick<Asset, 'name' | 'provenance'> => ({
  name, provenance: { origin: 'generated', importedAt: '', importedBy: 'x', procedural: { id: 'music.festive', version: 1, generator: 'g', params: { bars } } },
} as never);

describe('built-in music label', () => {
  it('is Hebrew in the Hebrew interface and English in English; a renamed or ordinary asset is untouched', () => {
    const a = music('Festive · 8 bars.wav', 8);
    expect(assetDisplayName(a, 'he')).toBe('חגיגי · 8 תיבות');
    expect(assetDisplayName(a, 'en')).toBe('Festive · 8 bars.wav');
    expect(assetDisplayName(music('my song.wav', 8), 'he')).toBe('my song.wav');
    expect(assetDisplayName({ name: 'IMG_1.jpg', provenance: { origin: 'upload' } } as never, 'he')).toBe('IMG_1.jpg');
  });
  it('the timeline label uses it', () => {
    const doc = { assets: { a1: music('Festive · 8 bars.wav', 8) } } as never;
    expect(clipLabel(doc, { type: 'media', assetId: 'a1' } as never, 'he')).toBe('חגיגי · 8 תיבות');
  });
});

describe('title header', () => {
  it('shows the readable field form, no raw {date}', () => {
    const doc = { assets: {}, people: {} } as never;
    const label = clipLabel(doc, { type: 'text', text: 'חנוכה · {date}', fields: true } as never, 'he');
    expect(label).not.toContain('{date}');
    expect(label).toContain('{תאריך}');
  });
});

describe('pack hints', () => {
  it('no hint (pack, template, look, caption look, music) shows a raw {key}, in either language', () => {
    for (const lang of ['he', 'en'] as const) {
      const words = PACK_STRINGS[lang].hintField;
      const hints = [...PACKS.map((p) => p.hint[lang]), ...TEMPLATES.map((t) => t.hint[lang]), ...CAPTION_LOOKS.map((l) => l.hint[lang]), ...MUSIC_STYLES.map((m) => m.hint[lang])];
      for (const h of hints) expect(readableHint(h, words), h).not.toMatch(/\{[A-Za-z0-9_]+\}/);
    }
    expect(readableHint('נר {night} של חנוכה', PACK_STRINGS.he.hintField)).toBe('נר [מספר הלילה] של חנוכה');
  });
});

describe('export fix buttons', () => {
  it('the strings exist in both languages and the server wordings are read', () => {
    const he = EXPORT_STRINGS.he.fix, en = EXPORT_STRINGS.en.fix;
    expect(Object.keys(he)).toEqual(Object.keys(en));
    expect(fixLabel(he, 'Remove this stretch from every track')).toBe('להסיר את הקטע הזה מכל הערוצים');
    expect(fixLabel(en, 'Remove this stretch from every track')).toBe('Remove this stretch from every track');
    for (const l of ['Remove the transition', 'Remove the velocity ramp', 'Lower the velocity ramp to ×3', 'Shorten the transition to 12 frames', 'Shorten the transition to 8 frames, at velocity ×2 and without the beat lock']) {
      expect(fixLabel(he, l), l).not.toMatch(/[A-Za-z]/);
      expect(fixLabel(en, l)).toBe(l);
    }
  });
});

describe('installer detail', () => {
  it('is a whole Hebrew sentence', () => {
    const d = installerDetail('PF_TOOLS_PYTHON is not set: no tools environment (torch, transformers, sentencepiece) is configured', 'he')!;
    expect(d).not.toMatch(/[A-Za-z]/);
    const e = installerDetail('PF_DENOISE_BIN is not set: no engine is installed for this tool (the operator installs it; the product never does)', 'he')!;
    expect(e).not.toMatch(/[A-Za-z]/);
    expect(installerDetail('PF_X is not set', 'he')).toBeNull();
  });
});
