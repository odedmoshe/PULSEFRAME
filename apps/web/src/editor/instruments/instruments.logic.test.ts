/**
 * «כלים מוקלטים» in the editor (wave 7 instruments track): the lead's rows on the pure helpers, and the it.todo rows builder W3 must make
 * pass. Builder W3 owns this file.
 */
import { describe, expect, it } from 'vitest';
import { auditionOrder, instrumentsPreviewUrl, levelScale } from './instruments.logic.ts';

describe('instruments logic (lead rows)', () => {
  it('the blind order maps a drawn bit to «א»/«ב»; the preview URL asks for recorded and the level match only when chosen; the level scale is ≤ 1', () => {
    expect(auditionOrder(0)).toEqual({ a: 'recorded', b: 'synth' });
    expect(auditionOrder(1)).toEqual({ a: 'synth', b: 'recorded' });
    expect(instrumentsPreviewUrl('music.calm', 16, 1, 'synth')).toBe('/api/v1/music/music.calm/audio?bars=16&seed=1');
    expect(instrumentsPreviewUrl('music.calm', 16, 1, 'recorded', true)).toBe('/api/v1/music/music.calm/audio?bars=16&seed=1&instruments=recorded&match=1');
    expect([levelScale('0.5'), levelScale('1.2'), levelScale(null), levelScale('x'), levelScale('0')]).toEqual([0.5, 1, 1, 1, 1]);
  });
  it.todo('W3: «צליל» is a radiogroup operated by the arrow keys; recorded stays selectable whatever the state; the state line words each KitState in he and en');
  it.todo('W3: the add button sends instruments; a refusal is shown in words (translateRefusal), never silently synthesised');
  it.todo('W3: «השוואה עיוורת» plays A and B with audio.volume from x-pf-level-scale, reveals after «מה היה מה?», stores no choice');
  it.todo('W3: «שמעתי» calls api.markKitHeard; for a non-owner session the 403 is shown in words and nothing changes; no string uses a forbidden word');
});
