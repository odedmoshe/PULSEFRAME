/**
 * The Hanukkah pack (ADR-0022): the first pack of the build (Hanukkah 5787 begins on the evening of 4 December 2026).
 *
 * Four templates, 25 elements (packs/elements.hanukkah.ts), three looks, three caption looks, six text styles, eight ready
 * titles and picks from the built-in sounds and music. All of it is original and made by formula; there are no songs, no
 * lyrics, no song titles and no blessings in any default text. The candle of the night is the pack field {night}; the
 * Hebrew date is the life line's live field {hebrewDate}. Every text has Hebrew and English; every title has fallback words
 * without a field. Only families of FONT_CATALOG are used.
 * Run-time imports: elementKit.ts and other pack data files only; everything else is `import type`.
 */
import type { CaptionLook } from '../captionPresets.ts';
import type { TemplateDef } from '../templateContract.ts';
import type { TextPreset } from '../textPresets.ts';
import type { PackDef, PackLook, PackTitle } from './contract.ts';

const GOLD = '#F5C542', NIGHT = '#0B1F4D', BLUE = '#3A6BD8', CREAM = '#FFF4D6';
const el = (slug: string) => `element.holiday.${slug}`;
type Slot = TemplateDef['slots'][number];
type Anim = NonNullable<TemplateDef['texts'][number]['anim']>;
const A = (by: Anim['by'], inn: Anim['in'], out: Anim['out'], inSeconds: number, outSeconds = 0.4): Anim => ({ by, in: inn, out, loop: null, inSeconds, outSeconds });

// ---------------------------------------------------------------- text styles (ids are frozen once shipped)
const textPresets: readonly TextPreset[] = [
  { id: 'hanukkah-gold', name: { he: 'חנוכה, זהב', en: 'Hanukkah gold' }, style: { fontFamily: 'Frank Ruhl Libre', fontWeight: 700, sizeFrac: 0.075, color: GOLD, background: null, stroke: '#1B2A5C', strokeFrac: 0.05 }, shadow: { color: '#000000', opacity: 0.6, blur: 0.012, x: 0, y: 0.004 } },
  { id: 'hanukkah-blue-box', name: { he: 'חנוכה, תיבה כחולה', en: 'Hanukkah blue box' }, style: { fontFamily: 'Heebo', fontWeight: 700, sizeFrac: 0.05, color: '#FFFFFF', background: '#1D3E91', stroke: null, strokeFrac: 0 }, shadow: null },
  { id: 'hanukkah-glow', name: { he: 'חנוכה, אור חם', en: 'Hanukkah warm glow' }, style: { fontFamily: 'Rubik', fontWeight: 700, sizeFrac: 0.07, color: CREAM, background: null, stroke: null, strokeFrac: 0, glow: { color: '#FFB347', radiusFrac: 0.5, intensity: 0.8 } }, shadow: null },
  { id: 'hanukkah-big', name: { he: 'חנוכה, כותרת גדולה', en: 'Hanukkah big title' }, style: { fontFamily: 'Secular One', fontWeight: 400, sizeFrac: 0.11, color: GOLD, background: null, stroke: NIGHT, strokeFrac: 0.09 }, shadow: null },
  { id: 'hanukkah-soft', name: { he: 'חנוכה, רך', en: 'Hanukkah soft' }, style: { fontFamily: 'Assistant', fontWeight: 400, sizeFrac: 0.045, color: CREAM, background: null, stroke: null, strokeFrac: 0 }, shadow: { color: '#000000', opacity: 0.7, blur: 0.016, x: 0, y: 0.002 } },
  { id: 'hanukkah-ribbon', name: { he: 'חנוכה, פס זהב', en: 'Hanukkah gold band' }, style: { fontFamily: 'Heebo', fontWeight: 700, sizeFrac: 0.05, color: NIGHT, background: GOLD, stroke: null, strokeFrac: 0 }, shadow: null },
];

// ---------------------------------------------------------------- caption looks
const captionLooks: readonly CaptionLook[] = [
  { id: 'caption.hanukkah-gold', name: { he: 'חנוכה, זהב על כהה', en: 'Hanukkah, gold on dark' }, hint: { he: 'כתב סריף זהוב על פס כחול כהה', en: 'Gold serif on a deep blue plate' },
    style: { preset: 'classic', fontFamily: 'Frank Ruhl Libre', fontWeight: 700, sizeFrac: 0.046, color: GOLD, highlightColor: '#FFFFFF', background: '#0B1F4DE6', stroke: null, strokeFrac: 0.08, position: 'bottom', maxLines: 2, maxCharsPerLine: 34 }, needsWordTiming: false },
  { id: 'caption.hanukkah-karaoke', name: { he: 'חנוכה, מילה בזהב', en: 'Hanukkah, word in gold' }, hint: { he: 'לבן על פס כחול, המילה שנאמרת הופכת לזהב', en: 'White on a blue plate; the spoken word turns gold' },
    style: { preset: 'karaoke', fontFamily: 'Heebo', fontWeight: 700, sizeFrac: 0.048, color: '#FFFFFF', highlightColor: GOLD, background: '#102A6BE6', stroke: null, strokeFrac: 0.08, position: 'bottom', maxLines: 2, maxCharsPerLine: 30 }, needsWordTiming: true },
  { id: 'caption.hanukkah-pop', name: { he: 'חנוכה, מילה קופצת', en: 'Hanukkah, popping words' }, hint: { he: 'מילה אחר מילה בזהב עם קו מתאר כחול', en: 'One word at a time in gold with a blue outline' },
    style: { preset: 'word-pop', fontFamily: 'Rubik', fontWeight: 700, sizeFrac: 0.07, color: GOLD, highlightColor: '#FFFFFF', background: null, stroke: NIGHT, strokeFrac: 0.12, position: 'center', maxLines: 2, maxCharsPerLine: 16, wordEntrance: 'pop' }, needsWordTiming: true },
];

// ---------------------------------------------------------------- looks (no graphics adapter; nothing flashes)
const looks: readonly PackLook[] = [
  { id: 'look.hanukkah-candlelight', name: { he: 'אור נרות', en: 'Candlelight' }, hint: { he: 'גוון חם, שוליים כהים ואורות זהב רכים', en: 'A warm tone, dark edges and soft gold lights' },
    effects: [{ type: 'color.adjust', params: { saturation: 1.1, contrast: 1.05 } }, { type: 'color.tint', params: { color: '#FFB454', amount: 0.18, mode: 'soft-light' } }, { type: 'light.vignette', params: { amount: 0.4 } }, { type: 'overlay.bokeh', params: { color: '#FFD27A', density: 0.25, amount: 0.5 } }] },
  { id: 'look.hanukkah-winter-night', name: { he: 'לילה של חורף', en: 'Winter night' }, hint: { he: 'כחול קר ושלג שיורד לאט', en: 'A cool blue and slow falling snow' },
    effects: [{ type: 'color.tint', params: { color: '#2F4C9E', amount: 0.25, mode: 'soft-light' } }, { type: 'color.adjust', params: { saturation: 0.9, brightness: 0.96 } }, { type: 'light.vignette', params: { amount: 0.45 } }, { type: 'overlay.snow', params: { density: 0.35, amount: 0.8 } }] },
  { id: 'look.hanukkah-gold-confetti', name: { he: 'קונפטי זהב', en: 'Gold confetti' }, hint: { he: 'קונפטי זהוב יורד על תמונה חמה', en: 'Gold confetti falls over a warm picture' },
    effects: [{ type: 'color.adjust', params: { saturation: 1.08, brightness: 1.02 } }, { type: 'overlay.confetti', params: { mode: 'fall', palette: 'gold', density: 0.25 } }] },
];

// ---------------------------------------------------------------- ready titles
const titles: readonly PackTitle[] = [
  { id: 'title.hanukkah-night', name: { he: 'נר של הלילה', en: 'Candle of the night' }, text: { he: 'נר {night} של חנוכה', en: 'Night {night} of Hanukkah' }, fallback: { he: 'חנוכה שמח', en: 'Happy Hanukkah' },
    presetId: 'hanukkah-gold', seconds: 4, anim: A('word', 'rise', 'fade', 0.6), place: { x: 0, y: -0.3, sizeFrac: 0.075 } },
  { id: 'title.hanukkah-happy', name: { he: 'חנוכה שמח', en: 'Happy Hanukkah' }, text: { he: 'חנוכה שמח!', en: 'Happy Hanukkah!' }, fallback: { he: 'חנוכה שמח!', en: 'Happy Hanukkah!' },
    presetId: 'hanukkah-big', seconds: 4, anim: A('letter', 'pop', 'fade', 0.8), place: { x: 0, y: -0.2, sizeFrac: 0.1 } },
  { id: 'title.hanukkah-date', name: { he: 'התאריך העברי', en: 'The Hebrew date' }, text: { he: 'חנוכה · {hebrewDate}', en: 'Hanukkah · {hebrewDate}' }, fallback: { he: 'חנוכה', en: 'Hanukkah' },
    presetId: 'hanukkah-glow', seconds: 4, anim: A('line', 'fade', 'fade', 0.6), place: { x: 0, y: 0.3, sizeFrac: 0.05 } },
  { id: 'title.hanukkah-family', name: { he: 'חנוכה אצל…', en: 'Hanukkah at…' }, text: { he: 'חנוכה אצל {name}', en: 'Hanukkah at {name}\'s' }, fallback: { he: 'חנוכה אצלנו', en: 'Hanukkah at our place' },
    presetId: 'hanukkah-blue-box', seconds: 4, anim: A('word', 'slide', 'fade', 0.5), place: { x: 0, y: -0.28, sizeFrac: 0.05 } },
  { id: 'title.hanukkah-eight', name: { he: 'שמונה ימים של אור', en: 'Eight days of light' }, text: { he: 'שמונה ימים של אור', en: 'Eight days of light' }, fallback: { he: 'שמונה ימים של אור', en: 'Eight days of light' },
    presetId: 'hanukkah-gold', seconds: 5, anim: A('line', 'fade', 'fade', 1), place: { x: 0, y: 0, sizeFrac: 0.07 } },
  { id: 'title.hanukkah-lighting', name: { he: 'מדליקים נרות', en: 'Lighting the candles' }, text: { he: 'מדליקים נרות', en: 'Lighting the candles' }, fallback: { he: 'מדליקים נרות', en: 'Lighting the candles' },
    presetId: 'hanukkah-soft', seconds: 3, anim: A('line', 'fade', 'fade', 0.8), place: { x: 0, y: 0.32, sizeFrac: 0.045 } },
  { id: 'title.hanukkah-sufganiyot', name: { he: 'זמן סופגניות', en: 'Sufganiya time' }, text: { he: 'זמן סופגניות!', en: 'Sufganiya time!' }, fallback: { he: 'זמן סופגניות!', en: 'Sufganiya time!' },
    presetId: 'hanukkah-ribbon', seconds: 3, anim: A('word', 'pop', 'fade', 0.4), place: { x: 0, y: 0.28, sizeFrac: 0.055 } },
  { id: 'title.hanukkah-gelt', name: { he: 'דמי חנוכה', en: 'Hanukkah gelt' }, text: { he: 'דמי חנוכה', en: 'Hanukkah gelt' }, fallback: { he: 'דמי חנוכה', en: 'Hanukkah gelt' },
    presetId: 'hanukkah-big', seconds: 3, anim: A('letter', 'rise', 'fade', 0.6), place: { x: 0, y: -0.25, sizeFrac: 0.09 } },
];

// ---------------------------------------------------------------- templates
const slots = (count: number, make: (i: number) => Slot): Slot[] => Array.from({ length: count }, (_, i) => make(i));
const dissolve = (seconds: number) => ({ type: 'dissolve', seconds, dir: 'fixed' as const });

/** The candle lighting: three calm moments; the first keeps its own sound (the family's voices), with the candle of the night as the title. */
const candles: TemplateDef = {
  id: 'tpl.hanukkah-candles', version: 1, pack: 'pack.hanukkah',
  name: { he: 'הדלקת נרות', en: 'Candle lighting' },
  hint: { he: 'שלושה רגעים רגועים: ההדלקה (עם הקול שלה), המשפחה והשולחן. הכותרת: «נר {night} של חנוכה»', en: 'Three calm moments: the lighting (with its own sound), the family and the table. The title says which night it is' },
  genre: 'celebration', designedFor: 'tall',
  tempo: { fallbackBpm: 90 },
  music: { need: 'optional', startAt: 'first-downbeat', builtin: 'music.calm' },
  slots: [
    { key: 'lighting', role: { he: 'ההדלקה', en: 'The lighting' }, accept: 'any', span: { bars: 2 }, keepAudio: true, motion: { presetId: 'motion.move.ken-burns-in', amount: 0.4 } },
    { key: 'family', role: { he: 'המשפחה', en: 'The family' }, accept: 'any', span: { bars: 2 }, motion: { presetId: 'motion.move.pan-left', amount: 0.5 }, transitionIn: dissolve(0.6) },
    { key: 'table', role: { he: 'השולחן', en: 'The table' }, accept: 'any', span: { bars: 2 }, motion: { presetId: 'motion.move.ken-burns-out', amount: 0.5 }, transitionIn: dissolve(0.6) },
  ],
  slotUse: { mode: 'media', min: 2 },
  texts: [
    { key: 'night', role: { he: 'הנר של הלילה', en: 'Candle of the night' }, default: { he: 'נר {night} של חנוכה', en: 'Night {night} of Hanukkah' }, fallback: { he: 'חנוכה שמח', en: 'Happy Hanukkah' }, maxChars: 40, presetId: 'hanukkah-gold',
      anim: A('word', 'rise', 'fade', 0.7), at: { slot: 'lighting', offsetBeats: 1, spanSlots: 1 }, place: { x: 0, y: -0.3, sizeFrac: 0.07 } },
    { key: 'date', role: { he: 'התאריך', en: 'The date' }, default: { he: 'חנוכה · {hebrewDate}', en: 'Hanukkah · {hebrewDate}' }, fallback: { he: 'ימי חנוכה', en: 'Days of Hanukkah' }, maxChars: 30, presetId: 'hanukkah-glow',
      anim: A('line', 'fade', 'fade', 0.6), at: { slot: 'family', offsetBeats: 1 }, place: { x: 0, y: 0.3, sizeFrac: 0.05 } },
    { key: 'house', role: { he: 'שם המשפחה', en: 'Family' }, default: { he: 'משפחת {name}', en: 'The {name} family' }, fallback: { he: 'המשפחה שלנו', en: 'Our family' }, maxChars: 30, presetId: 'hanukkah-soft',
      anim: A('word', 'fade', 'fade', 0.5), at: { slot: 'table', offsetBeats: 1 }, place: { x: 0, y: 0.3, sizeFrac: 0.05 } },
  ],
  elements: [
    { key: 'lights', elementId: el('hanukkiah-outline'), at: { slot: 'lighting' }, place: { x: 0, y: 0.32, scale: 0.5 }, motion: { presetId: 'motion.in.fade' } },
  ],
  sfx: [{ key: 'chime', sfxId: 'sfx.chime', at: 'first', gain: 0.5 }],
  adjust: [{ key: 'candlelight', span: 'all', effects: [{ type: 'color.adjust', params: { saturation: 1.08, contrast: 1.05 } }, { type: 'color.tint', params: { color: '#FFB454', amount: 0.16, mode: 'soft-light' } }, { type: 'light.vignette', params: { amount: 0.4 } }], fadeSeconds: 0.6 }],
};

/** Eight nights: one slot for each night, each with its own hanukkiah, one more candle lit every time. */
const eightNights: TemplateDef = {
  id: 'tpl.hanukkah-eight-nights', version: 1, pack: 'pack.hanukkah',
  name: { he: 'שמונה לילות', en: 'Eight nights' },
  hint: { he: 'רגע מכל לילה, ועל כל אחד חנוכייה עם נר אחד יותר', en: 'One moment from every night, each with a hanukkiah that has one more candle lit' },
  genre: 'celebration', designedFor: 'tall',
  tempo: { fallbackBpm: 80 },
  music: { need: 'optional', startAt: 'first-downbeat', builtin: 'music.calm' },
  slots: slots(8, (i) => ({ key: `night${i + 1}`, role: { he: `לילה ${i + 1}`, en: `Night ${i + 1}` }, accept: 'any', span: { bars: 1 }, motion: { presetId: i % 2 ? 'motion.move.ken-burns-out' : 'motion.move.ken-burns-in', amount: 0.4 }, ...(i > 0 ? { transitionIn: dissolve(0.4) } : {}) })),
  slotUse: { mode: 'all', min: 8 },
  texts: [
    { key: 'counter', role: { he: 'מספר הלילה', en: 'Night number' }, default: { he: 'לילה {n}', en: 'Night {n}' }, maxChars: 20, presetId: 'hanukkah-gold', perSlot: 'count-up',
      anim: A('word', 'rise', 'fade', 0.4, 0.3), at: { slot: 'night1' }, place: { x: 0, y: -0.3, sizeFrac: 0.07 } },
    { key: 'light', role: { he: 'כותרת הפתיחה', en: 'Opening title' }, default: { he: 'שמונה ימים של אור', en: 'Eight days of light' }, maxChars: 30, presetId: 'hanukkah-soft',
      anim: A('line', 'fade', 'fade', 0.6), at: { slot: 'night1' }, place: { x: 0, y: -0.2, sizeFrac: 0.04 } },
  ],
  elements: Array.from({ length: 8 }, (_, i): TemplateDef['elements'][number] => ({ key: `lit${i + 1}`, elementId: el(`hanukkiah-${i + 1}`), at: { slot: `night${i + 1}` }, place: { x: 0, y: 0.3, scale: 0.7 } })),
  sfx: [{ key: 'ding', sfxId: 'sfx.ding', at: 'boundaries', gain: 0.4 }, { key: 'end', sfxId: 'sfx.success', at: 'last', gain: 0.5 }],
  adjust: [{ key: 'candlelight', span: 'all', effects: [{ type: 'color.adjust', params: { saturation: 1.08, contrast: 1.05 } }, { type: 'color.tint', params: { color: '#FFB454', amount: 0.15, mode: 'soft-light' } }, { type: 'light.vignette', params: { amount: 0.45 } }] }],
};

/** The party: quick cuts, sufganiyot, dreidels and gold confetti. */
const party: TemplateDef = {
  id: 'tpl.hanukkah-party', version: 1, pack: 'pack.hanukkah',
  name: { he: 'מסיבת חנוכה', en: 'Hanukkah party' },
  hint: { he: 'חיתוכים בקצב, סופגניות, סביבונים וקונפטי זהב', en: 'Cuts on the beat, sufganiyot, dreidels and gold confetti' },
  genre: 'celebration', designedFor: 'tall',
  tempo: { fallbackBpm: 125 },
  music: { need: 'optional', startAt: 'first-downbeat', builtin: 'music.festive' },
  slots: slots(8, (i) => ({
    key: `beat${i + 1}`, role: { he: `רגע ${i + 1}`, en: `Moment ${i + 1}` }, accept: 'any', span: { beats: 4 },
    motion: { presetId: ['motion.move.ken-burns-in', 'motion.move.pan-left', 'motion.move.ken-burns-out', 'motion.move.pan-right'][i % 4]! , amount: 0.7 },
    ...(i > 0 ? { transitionIn: i % 3 === 0 ? { type: 'zoom', seconds: 0.25, dir: 'fixed' as const } : { type: 'push-left', seconds: 0.25, dir: 'reading' as const } } : {}),
  })),
  slotUse: { mode: 'media', min: 5 },
  texts: [
    { key: 'title', role: { he: 'כותרת', en: 'Title' }, default: { he: 'מסיבת חנוכה', en: 'Hanukkah party' }, maxChars: 30, presetId: 'hanukkah-big',
      anim: A('letter', 'pop', 'fade', 0.7), at: { slot: 'beat1', spanSlots: 2 }, place: { x: 0, y: -0.25, sizeFrac: 0.09 } },
    { key: 'cheer', role: { he: 'סיום', en: 'Closing line' }, default: { he: 'חנוכה שמח!', en: 'Happy Hanukkah!' }, maxChars: 30, presetId: 'hanukkah-ribbon',
      anim: A('word', 'pop', 'fade', 0.4), at: { slot: 'beat5' }, place: { x: 0, y: 0.28, sizeFrac: 0.06 } },
  ],
  elements: [
    { key: 'sufgan', elementId: el('sufganiya'), at: { slot: 'beat1', spanSlots: 2 }, place: { x: 0.28, y: 0.3, scale: 0.4 }, motion: { presetId: 'motion.in.pop' } },
    { key: 'dreidel', elementId: el('dreidel-two-colour'), at: { slot: 'beat3', spanSlots: 2 }, place: { x: -0.28, y: 0.3, scale: 0.4 }, motion: { presetId: 'motion.loop.wobble' } },
    { key: 'spin', elementId: el('dreidel-spinning'), at: { slot: 'beat5', spanSlots: 2 }, place: { x: 0.28, y: -0.3, scale: 0.4 }, motion: { presetId: 'motion.in.pop' } },
    { key: 'gelt', elementId: el('gelt-coin'), at: { slot: 'beat7', spanSlots: 2 }, place: { x: -0.28, y: -0.3, scale: 0.35 }, motion: { presetId: 'motion.in.pop' } },
  ],
  sfx: [{ key: 'pop', sfxId: 'sfx.pop', at: 'boundaries', everyN: 2, gain: 0.5 }, { key: 'win', sfxId: 'sfx.success', at: 'first', gain: 0.6 }],
  adjust: [
    { key: 'confetti', span: 'all', effects: [{ type: 'overlay.confetti', params: { mode: 'fall', palette: 'gold', density: 0.25 } }], fadeSeconds: 0.5 },
    { key: 'warm', span: 'all', effects: [{ type: 'color.adjust', params: { saturation: 1.1, brightness: 1.03 } }] },
  ],
};

/** A square greeting card on one picture: «חנוכה שמח!», the Hebrew date and who it is from. */
const greeting: TemplateDef = {
  id: 'tpl.hanukkah-greeting', version: 1, pack: 'pack.hanukkah',
  name: { he: 'ברכת חנוכה', en: 'Hanukkah greeting' },
  hint: { he: 'כרטיס ריבועי על תמונה אחת: «חנוכה שמח!», התאריך העברי ושם השולח', en: 'A square card over one picture: «Happy Hanukkah!», the Hebrew date and who it is from' },
  genre: 'celebration', designedFor: 'square',
  tempo: { fallbackBpm: 90 },
  music: { need: 'optional', startAt: 'zero', builtin: 'music.calm' },
  slots: [{ key: 'card', role: { he: 'תמונת הכרטיס', en: 'Card picture' }, accept: 'any', span: { seconds: '6' }, motion: { presetId: 'motion.move.ken-burns-in', amount: 0.4 } }],
  slotUse: { mode: 'all', min: 1 },
  texts: [
    { key: 'greet', role: { he: 'הברכה', en: 'Greeting' }, default: { he: 'חנוכה שמח!', en: 'Happy Hanukkah!' }, maxChars: 24, presetId: 'hanukkah-big',
      anim: A('letter', 'pop', 'fade', 0.8, 0.5), at: { slot: 'card' }, place: { x: 0, y: -0.12, sizeFrac: 0.1 } },
    { key: 'date', role: { he: 'התאריך', en: 'The date' }, default: { he: 'חנוכה · {hebrewDate}', en: 'Hanukkah · {hebrewDate}' }, fallback: { he: 'ימי חנוכה', en: 'Days of Hanukkah' }, maxChars: 30, presetId: 'hanukkah-glow',
      anim: A('line', 'fade', 'fade', 0.6), at: { slot: 'card', offsetBeats: 2 }, place: { x: 0, y: 0.08, sizeFrac: 0.045 } },
    { key: 'from', role: { he: 'מאת', en: 'From' }, default: { he: 'באהבה, {name}', en: 'With love, {name}' }, fallback: { he: 'באהבה', en: 'With love' }, maxChars: 30, presetId: 'hanukkah-soft',
      anim: A('line', 'fade', 'fade', 0.6), at: { slot: 'card', offsetBeats: 4 }, place: { x: 0, y: 0.3, sizeFrac: 0.045 } },
  ],
  elements: [
    { key: 'menorah', elementId: el('hanukkiah-8'), at: { slot: 'card' }, place: { x: 0, y: -0.33, scale: 0.4 }, motion: { presetId: 'motion.in.fade' } },
  ],
  sfx: [{ key: 'chime', sfxId: 'sfx.chime', at: 'first', gain: 0.5 }],
  adjust: [{ key: 'dim', span: 'all', effects: [{ type: 'blur.gaussian', params: { radius: 0.01 } }, { type: 'color.adjust', params: { brightness: 0.6, saturation: 0.9 } }, { type: 'color.tint', params: { color: '#1D3E91', amount: 0.25, mode: 'soft-light' } }, { type: 'light.vignette', params: { amount: 0.5 } }, { type: 'overlay.snow', params: { density: 0.3, amount: 0.7 } }], fadeSeconds: 0.6 }],
};

const ELEMENT_SLUGS = [
  'hanukkiah-1', 'hanukkiah-2', 'hanukkiah-3', 'hanukkiah-4', 'hanukkiah-5', 'hanukkiah-6', 'hanukkiah-7', 'hanukkiah-8', 'hanukkiah-outline', 'candle', 'candle-lit', 'candle-row', 'dreidel', 'dreidel-two-colour', 'dreidel-spinning',
  'sufganiya', 'sufganiya-bitten', 'sufganiyot-plate', 'latke', 'oil-jug', 'gelt-coin', 'gelt-stack', 'gift', 'lights-garland', 'frame-candles',
] as const;

export const HANUKKAH_PACK: PackDef | null = {
  id: 'pack.hanukkah', version: 1,
  name: { he: 'חנוכה', en: 'Hanukkah' },
  hint: { he: 'נרות, חנוכיות, סביבונים וסופגניות לסרטון של שמונת הימים', en: 'Candles, hanukkiyot, dreidels and sufganiyot for a film of the eight days' },
  palette: [NIGHT, BLUE, GOLD, CREAM],
  occasion: { kind: 'holiday', family: 'hanukkah', leadDays: 21, trailDays: 10 },
  templates: [candles, eightNights, party, greeting], templateIds: [],
  elementIds: ELEMENT_SLUGS.map(el), coverElementIds: [el('hanukkiah-8'), el('dreidel-two-colour'), el('sufganiya')],
  looks, captionLooks, textPresets, titles,
  sfxIds: ['sfx.chime', 'sfx.success', 'sfx.pop', 'sfx.coin'], musicStyleIds: ['music.festive', 'music.calm'],
};
