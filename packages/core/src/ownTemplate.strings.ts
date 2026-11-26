/**
 * The fixed words an own template may hold (wave 8 owntemplate; plan 3.7, verifier C2): the placeholders and role words capture
 * writes, and the pieces of the hint built from counts. They are the ONLY words of a saved definition besides the name the owner
 * typed and, with «להשאיר את הטקסט», the titles' own words. The scan (ownTemplateScan.ts) allows exactly these. Hebrew addresses
 * nobody (nouns only); the English beside it.
 */
export const OWN_TEMPLATE_WORDS = {
  shotRole: { he: (n: number) => `צילום ${n}`, en: (n: number) => `Shot ${n}` },
  titleRole: { he: (n: number) => `כותרת ${n}`, en: (n: number) => `Title ${n}` },
  /** The default and fallback words of a title when the words are not kept. */
  titlePlaceholder: { he: (n: number) => `כותרת ${n}`, en: (n: number) => `Title ${n}` },
  /** The hint of the card, from the counts of the saved definition (C6: never tallied separately). */
  hint: {
    he: (o: { shots: number; titles: number; looks: number; beats: boolean }) => `${o.shots} צילומים ${o.beats ? 'על הפעימות של המוזיקה' : 'באורכים של הסרט'} · ${o.titles} כותרות · ${o.looks} מראות`,
    en: (o: { shots: number; titles: number; looks: number; beats: boolean }) => `${o.shots} shots ${o.beats ? 'on the beats of the music' : 'at the film\'s own lengths'} · ${o.titles} titles · ${o.looks} looks`,
  },
} as const;
/** Key shapes of an own definition's items (the scan's allow-list). */
export const OWN_KEY = { shot: (n: number) => `shot${n}`, title: (n: number) => `title${n}`, look: (n: number) => `look${n}`, pattern: /^(shot|title|look)\d{1,3}$/ } as const;
/** maxChars of a title whose words are placeholders (plan 3.6 step 5). */
export const OWN_TITLE_MAX_CHARS = 60;
