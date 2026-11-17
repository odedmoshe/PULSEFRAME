/**
 * Fixed data-testids of the content packs, the built-in music and the font picker (ADR-0022), shared by the editor
 * components and the proofs (fonts-proof.ts, music-proof.ts, packs-proof.ts, a11y-audit.ts). Lead contracts commit: W2 and W3
 * put exactly these on the elements named here and do not rename them. A list item repeats its id and carries a data-*
 * attribute (data-pack-id, data-style-id, data-family, data-key …), as the template drawer does (templates.testids.ts).
 */
import type { PackFieldKey } from '@pulseframe/core';

/** The tabs of a pack page, in their order (תבניות / כותרות / אלמנטים / מראה / כתוביות / צליל). */
export const PACK_TABS = ['templates', 'titles', 'elements', 'looks', 'captions', 'sound'] as const;
export type PackTab = (typeof PACK_TABS)[number];

export const PACK_TESTIDS = {
  // templates drawer, first section «חבילות»: the shelf, a pack tile (data-pack-id), the suggestion badge on a tile, its dismiss button
  shelf: 'pack-shelf', card: 'pack-card', suggest: 'pack-suggest', suggestDismiss: 'pack-suggest-dismiss',
  // the start hub's suggestion card and its open button
  hubSuggest: 'pack-hub-suggest', hubOpen: 'pack-hub-open',
  // a pack page: the page, its back button, a tab (pack-tab-<tab>) and its panel
  page: 'pack-page', back: 'pack-back', tab: (t: PackTab) => `pack-tab-${t}`, panel: (t: PackTab) => `pack-panel-${t}`,
  // the items of the tabs (data-template-id, data-title-id, data-element-id, data-look-id, data-caption-look-id, data-sfx-id / data-style-id)
  template: 'pack-template', title: 'pack-title', titleMotionNone: 'pack-title-motion-none', element: 'pack-element', look: 'pack-look', captionLook: 'pack-caption-look', sound: 'pack-sound',
  // the template dialog's fieldset «פרטים»: one field per pack field (tpl-field-<key>), the date, its live Hebrew date (aria-live), the lighting switch
  fields: 'tpl-fields', field: (k: PackFieldKey) => `tpl-field-${k}`, date: 'tpl-field-date', hebrewDate: 'tpl-field-hebrew-date', atLighting: 'tpl-field-at-lighting',
  // the template dialog's music source (radio group: none / library / builtin), the style select and the seed («גרסה») stepper
  musicSource: 'tpl-music-source', musicSourceOption: (s: 'none' | 'library' | 'builtin') => `tpl-music-source-${s}`, musicStyle: 'tpl-music-style', musicSeed: 'tpl-music-seed',
} as const;

export const MUSIC_TESTIDS = {
  // the audio drawer's second tab and its panel
  tab: 'music-tab', panel: 'music-panel',
  // a style row (data-style-id), its play/stop toggle (aria-pressed), its length chips (data-bars; 'fit' = «כאורך הסרטון»), its seed stepper,
  // its section strip (each section carries data-kind and a text label), its unheard badge, its add button
  row: 'music-row', play: 'music-play', bars: 'music-bars', seed: 'music-seed', sections: 'music-sections', unheard: 'music-unheard', add: 'music-add',
  // what adding would take: seconds and megabytes, shown before the add
  size: 'music-size',
} as const;

export const FONT_TESTIDS = {
  // the picker (listbox), an option (data-family, data-weight), a category chip (data-category), the «ניקוד נבדק» badge, the pairings line
  picker: 'font-picker', option: 'font-option', category: 'font-category', nikud: 'font-nikud', pairs: 'font-pairs',
} as const;
