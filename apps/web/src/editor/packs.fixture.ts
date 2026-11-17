/**
 * A pack as the pack shelf and page receive it (a PackSummary), made here for tests and stories: the content packs of this build
 * come from the content worker's data files, and the components are built and tested without them. Labelled: this is a fixture,
 * not a pack of the product. Its ids exist in this build (ELEMENTS, TEMPLATES, CAPTION_LOOKS, MUSIC_STYLES), so the registries resolve them.
 */
import { CAPTION_LOOKS, ELEMENTS, MUSIC_STYLES, PACK_SOURCE, TEMPLATES, type PackSummary, type ProjectDocument } from '@pulseframe/core';

export const FIXTURE_PACK: PackSummary = {
  id: 'pack.fixture-hanukkah', version: 1,
  name: { he: 'חנוכה (דוגמה)', en: 'Hanukkah (fixture)' }, hint: { he: 'חבילת דוגמה לבדיקות', en: 'A fixture pack for tests' },
  palette: ['#FFD166', '#3DE0C8', '#1B2A4A'],
  occasion: { kind: 'holiday', family: 'hanukkah', leadDays: 21, trailDays: 10 },
  templateIds: [TEMPLATES[0]!.id, TEMPLATES[1]!.id, 'tpl.not-in-this-build'],
  elementIds: ELEMENTS.slice(0, 4).map((e) => e.id).concat('element.not-in-this-build'), coverElementIds: ELEMENTS.slice(0, 3).map((e) => e.id),
  looks: [{ id: 'look.fixture-warm', name: { he: 'חמים', en: 'Warm' }, hint: { he: 'גוון חם', en: 'A warm tint' }, effects: [{ type: 'filter.brightness', params: { amount: 0.05 } }] }],
  captionLookIds: CAPTION_LOOKS.slice(0, 2).map((l) => l.id), textPresetIds: ['clean-white'],
  titles: [
    { id: 'title.fixture-night', name: { he: 'נר ראשון', en: 'First candle' }, text: { he: 'חג שמח {name}', en: 'Happy holiday {name}' }, fallback: { he: 'חג שמח', en: 'Happy holiday' }, presetId: 'clean-white', seconds: 3, place: { x: 0, y: 0.1, sizeFrac: 0.08 } },
  ],
  sfxIds: ['sfx.fixture-chime'], musicStyleIds: MUSIC_STYLES.slice(0, 1).map((s) => s.id),
  fields: ['name', 'night'], liveFields: false, source: PACK_SOURCE,
};
/** A second fixture: a birthday-like pack suggested by a hint, never by the date. */
export const FIXTURE_BIRTHDAY: PackSummary = {
  ...FIXTURE_PACK, id: 'pack.fixture-birthday', name: { he: 'יום הולדת (דוגמה)', en: 'Birthday (fixture)' },
  occasion: { kind: 'life-event', event: 'birthday', windowDays: 14 }, fields: ['name', 'age'],
};
/** A document with the given caption tracks in its main sequence (only what captionTargets reads). */
export const docWithCaptionTracks = (tracks: { id: string; name: string }[]): ProjectDocument =>
  ({ mainSequenceId: 'seq1', sequences: { seq1: { tracks: [{ id: 'v1', kind: 'video', name: 'V1' }, ...tracks.map((t) => ({ ...t, kind: 'caption' }))] } } }) as unknown as ProjectDocument;
