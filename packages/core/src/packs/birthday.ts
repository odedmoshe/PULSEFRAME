/**
 * The birthday pack (ADR-0022). The existing template tpl.birthday stays exactly as it is and joins the pack by id
 * (PackDef.templateIds); the pack adds three new templates beside it, 25 elements (packs/elements.birthday.ts), three looks,
 * three caption looks, six text styles and eight ready titles, with gendered and neutral variants of the age title.
 * All of it is original and made by formula; no songs, no lyrics, no song titles, no blessings in any default text. The pack
 * fields {name} {age} {when} {place} are literal words the caller gives; every title has fallback words without a field.
 * Run-time imports: elementKit.ts and other pack data files only; everything else is `import type`.
 */
import type { CaptionLook } from '../captionPresets.ts';
import type { TemplateDef } from '../templateContract.ts';
import type { TextPreset } from '../textPresets.ts';
import type { PackDef, PackLook, PackTitle } from './contract.ts';

const PINK = '#FF4D8D', SUN = '#FFC83D', SKY = '#35B6FF', DEEP = '#7A1D4A';
const el = (slug: string) => `element.party.${slug}`;
type Slot = TemplateDef['slots'][number];
type Anim = NonNullable<TemplateDef['texts'][number]['anim']>;
const A = (by: Anim['by'], inn: Anim['in'], out: Anim['out'], inSeconds: number, outSeconds = 0.4): Anim => ({ by, in: inn, out, loop: null, inSeconds, outSeconds });

// ---------------------------------------------------------------- text styles (ids are frozen once shipped)
const textPresets: readonly TextPreset[] = [
  { id: 'birthday-bubble', name: { he: 'יום הולדת, בועה', en: 'Birthday bubble' }, style: { fontFamily: 'Secular One', fontWeight: 400, sizeFrac: 0.1, color: '#FFFFFF', background: null, stroke: PINK, strokeFrac: 0.12 }, shadow: { color: '#000000', opacity: 0.35, blur: 0.01, x: 0, y: 0.005 } },
  { id: 'birthday-sunny', name: { he: 'יום הולדת, שמש', en: 'Birthday sunny' }, style: { fontFamily: 'Rubik', fontWeight: 700, sizeFrac: 0.08, color: SUN, background: null, stroke: DEEP, strokeFrac: 0.1 }, shadow: null },
  { id: 'birthday-pink-box', name: { he: 'יום הולדת, תיבה ורודה', en: 'Birthday pink box' }, style: { fontFamily: 'Heebo', fontWeight: 700, sizeFrac: 0.05, color: '#FFFFFF', background: '#D81B6A', stroke: null, strokeFrac: 0 }, shadow: null },
  { id: 'birthday-blue-box', name: { he: 'יום הולדת, תיבה תכלת', en: 'Birthday sky box' }, style: { fontFamily: 'Rubik', fontWeight: 700, sizeFrac: 0.05, color: '#FFFFFF', background: '#1565C0', stroke: null, strokeFrac: 0 }, shadow: null },
  { id: 'birthday-soft', name: { he: 'יום הולדת, רך', en: 'Birthday soft' }, style: { fontFamily: 'Assistant', fontWeight: 700, sizeFrac: 0.05, color: '#FFFFFF', background: null, stroke: null, strokeFrac: 0 }, shadow: { color: '#000000', opacity: 0.6, blur: 0.016, x: 0, y: 0.003 } },
  { id: 'birthday-neon', name: { he: 'יום הולדת, זוהר ורוד', en: 'Birthday pink glow' }, style: { fontFamily: 'Rubik', fontWeight: 700, sizeFrac: 0.075, color: '#FFE8F2', background: null, stroke: null, strokeFrac: 0, glow: { color: PINK, radiusFrac: 0.55, intensity: 0.85 } }, shadow: null },
];

// ---------------------------------------------------------------- caption looks
const captionLooks: readonly CaptionLook[] = [
  { id: 'caption.birthday-bubble', name: { he: 'יום הולדת, פס ורוד', en: 'Birthday, pink plate' }, hint: { he: 'כתב לבן עגול על פס ורוד', en: 'Round white type on a pink plate' },
    style: { preset: 'classic', fontFamily: 'Rubik', fontWeight: 700, sizeFrac: 0.046, color: '#FFFFFF', highlightColor: SUN, background: '#D81B6AE6', stroke: null, strokeFrac: 0.08, position: 'bottom', maxLines: 2, maxCharsPerLine: 30 }, needsWordTiming: false },
  { id: 'caption.birthday-pop', name: { he: 'יום הולדת, מילה קופצת', en: 'Birthday, popping words' }, hint: { he: 'מילה אחר מילה בצהוב עם קו מתאר סגול', en: 'One word at a time in yellow with a plum outline' },
    style: { preset: 'word-pop', fontFamily: 'Secular One', fontWeight: 400, sizeFrac: 0.08, color: SUN, highlightColor: '#FFFFFF', background: null, stroke: DEEP, strokeFrac: 0.14, position: 'center', maxLines: 2, maxCharsPerLine: 14, wordEntrance: 'pop' }, needsWordTiming: true },
  { id: 'caption.birthday-karaoke', name: { he: 'יום הולדת, מילה בצהוב', en: 'Birthday, word in yellow' }, hint: { he: 'לבן על פס כהה, המילה שנאמרת הופכת לצהוב', en: 'White on a dark plate; the spoken word turns yellow' },
    style: { preset: 'karaoke', fontFamily: 'Heebo', fontWeight: 700, sizeFrac: 0.048, color: '#FFFFFF', highlightColor: SUN, background: '#2A1240E6', stroke: null, strokeFrac: 0.08, position: 'bottom', maxLines: 2, maxCharsPerLine: 30 }, needsWordTiming: true },
];

// ---------------------------------------------------------------- looks (no graphics adapter; nothing flashes)
const looks: readonly PackLook[] = [
  { id: 'look.birthday-party-pop', name: { he: 'צבעים של מסיבה', en: 'Party colours' }, hint: { he: 'צבעים חיים וקצת יותר אור', en: 'Lively colours and a little more light' },
    effects: [{ type: 'color.adjust', params: { saturation: 1.2, contrast: 1.05, brightness: 1.03 } }, { type: 'light.vignette', params: { amount: 0.2 } }] },
  { id: 'look.birthday-confetti', name: { he: 'גשם קונפטי', en: 'Confetti rain' }, hint: { he: 'קונפטי צבעוני יורד על התמונה', en: 'Colourful confetti falls over the picture' },
    effects: [{ type: 'color.adjust', params: { saturation: 1.1, brightness: 1.02 } }, { type: 'overlay.confetti', params: { mode: 'fall', palette: 'party', density: 0.3 } }] },
  { id: 'look.birthday-dreamy', name: { he: 'חלומי', en: 'Dreamy' }, hint: { he: 'זוהר רך ואורות ורודים מרחפים', en: 'A soft glow and floating pink lights' },
    effects: [{ type: 'light.diffusion', params: { radius: 0.08, amount: 0.35 } }, { type: 'color.tint', params: { color: '#FF9EC4', amount: 0.12, mode: 'soft-light' } }, { type: 'overlay.bokeh', params: { color: '#FFB3D1', density: 0.25, amount: 0.5 } }] },
];

// ---------------------------------------------------------------- ready titles (the age title in a boy's, a girl's and a neutral form)
const titles: readonly PackTitle[] = [
  { id: 'title.birthday-happy', name: { he: 'יום הולדת שמח', en: 'Happy birthday' }, text: { he: 'יום הולדת שמח!', en: 'Happy birthday!' }, fallback: { he: 'יום הולדת שמח!', en: 'Happy birthday!' },
    presetId: 'birthday-bubble', seconds: 4, anim: A('letter', 'pop', 'fade', 0.8), place: { x: 0, y: -0.22, sizeFrac: 0.09 } },
  { id: 'title.birthday-name', name: { he: 'יום הולדת עם שם', en: 'Happy birthday with a name' }, text: { he: 'יום הולדת שמח, {name}!', en: 'Happy birthday, {name}!' }, fallback: { he: 'יום הולדת שמח!', en: 'Happy birthday!' },
    presetId: 'birthday-sunny', seconds: 4, anim: A('word', 'rise', 'fade', 0.6), place: { x: 0, y: -0.25, sizeFrac: 0.08 } },
  { id: 'title.birthday-boy', name: { he: 'בן…', en: 'He is…' }, text: { he: 'בן {age}!', en: 'He is {age}!' }, fallback: { he: 'יום הולדת שמח!', en: 'Happy birthday!' },
    presetId: 'birthday-blue-box', seconds: 4, anim: A('word', 'pop', 'fade', 0.5), place: { x: 0, y: -0.28, sizeFrac: 0.07 } },
  { id: 'title.birthday-girl', name: { he: 'בת…', en: 'She is…' }, text: { he: 'בת {age}!', en: 'She is {age}!' }, fallback: { he: 'יום הולדת שמח!', en: 'Happy birthday!' },
    presetId: 'birthday-pink-box', seconds: 4, anim: A('word', 'pop', 'fade', 0.5), place: { x: 0, y: -0.28, sizeFrac: 0.07 } },
  { id: 'title.birthday-turning', name: { he: 'חוגגים…', en: 'Turning…' }, text: { he: 'חוגגים {age}', en: 'Turning {age}' }, fallback: { he: 'יום הולדת שמח!', en: 'Happy birthday!' },
    presetId: 'birthday-bubble', seconds: 4, anim: A('letter', 'pop', 'fade', 0.7), place: { x: 0, y: -0.25, sizeFrac: 0.1 } },
  { id: 'title.birthday-cake', name: { he: 'זמן עוגה', en: 'Cake time' }, text: { he: 'הגיע זמן העוגה!', en: 'Cake time!' }, fallback: { he: 'הגיע זמן העוגה!', en: 'Cake time!' },
    presetId: 'birthday-pink-box', seconds: 3, anim: A('word', 'slide', 'fade', 0.4), place: { x: 0, y: 0.28, sizeFrac: 0.055 } },
  { id: 'title.birthday-celebrate', name: { he: 'בואו נחגוג', en: "Let's celebrate" }, text: { he: 'בואו נחגוג!', en: "Let's celebrate!" }, fallback: { he: 'בואו נחגוג!', en: "Let's celebrate!" },
    presetId: 'birthday-neon', seconds: 3, anim: A('letter', 'rise', 'fade', 0.6), place: { x: 0, y: 0, sizeFrac: 0.08 } },
  { id: 'title.birthday-invite', name: { he: 'הזמנה', en: 'Invitation' }, text: { he: 'מזמינים אותך למסיבה! {when}', en: 'You are invited! {when}' }, fallback: { he: 'מזמינים אותך למסיבה!', en: 'You are invited!' },
    presetId: 'birthday-soft', seconds: 4, anim: A('line', 'fade', 'fade', 0.6), place: { x: 0, y: 0.3, sizeFrac: 0.05 } },
];

// ---------------------------------------------------------------- templates
const slots = (count: number, make: (i: number) => Slot): Slot[] => Array.from({ length: count }, (_, i) => make(i));
const MOVES = ['motion.move.ken-burns-in', 'motion.move.pan-left', 'motion.move.ken-burns-out', 'motion.move.pan-right'] as const;
const dissolve = (seconds: number) => ({ type: 'dissolve', seconds, dir: 'fixed' as const });

/** The age: a big «חוגגים {age}», a crown over it and a bunch of balloons. */
const age: TemplateDef = {
  id: 'tpl.birthday-age', version: 1, pack: 'pack.birthday',
  name: { he: 'הגיל הגדול', en: 'The big age' },
  hint: { he: 'כותרת גדולה עם הגיל, כתר ובלונים, ואחריהם הרגעים של היום', en: 'A big title with the age, a crown and balloons, then the moments of the day' },
  genre: 'celebration', designedFor: 'tall',
  tempo: { fallbackBpm: 120 },
  music: { need: 'optional', startAt: 'first-downbeat', builtin: 'music.birthday' },
  slots: slots(6, (i) => ({ key: `moment${i + 1}`, role: { he: `רגע ${i + 1}`, en: `Moment ${i + 1}` }, accept: 'any', span: { bars: 1 }, motion: { presetId: MOVES[i % MOVES.length]!, amount: 0.6 }, ...(i > 0 ? { transitionIn: dissolve(0.4) } : {}) })),
  slotUse: { mode: 'media', min: 4 },
  texts: [
    { key: 'age', role: { he: 'הגיל', en: 'The age' }, default: { he: 'חוגגים {age}', en: 'Turning {age}' }, fallback: { he: 'יום הולדת שמח!', en: 'Happy birthday!' }, maxChars: 30, presetId: 'birthday-bubble',
      anim: A('letter', 'pop', 'fade', 0.8), at: { slot: 'moment1', spanSlots: 2 }, place: { x: 0, y: -0.2, sizeFrac: 0.11 } },
    { key: 'name', role: { he: 'שם החוגג', en: 'Name' }, default: { he: 'יום הולדת שמח, {name}!', en: 'Happy birthday, {name}!' }, fallback: { he: 'יום הולדת שמח!', en: 'Happy birthday!' }, maxChars: 40, presetId: 'birthday-sunny',
      anim: A('word', 'rise', 'fade', 0.5), at: { slot: 'moment6' }, place: { x: 0, y: 0.25, sizeFrac: 0.07 } },
  ],
  elements: [
    { key: 'crown', elementId: el('crown-party'), at: { slot: 'moment1', spanSlots: 2 }, place: { x: 0, y: -0.36, scale: 0.35 }, motion: { presetId: 'motion.in.drop' } },
    { key: 'balloons', elementId: el('balloons-bunch'), at: { slot: 'moment3', spanSlots: 3 }, place: { x: 0.28, y: 0.3, scale: 0.4 }, motion: { presetId: 'motion.loop.float' } },
  ],
  sfx: [{ key: 'cheer', sfxId: 'sfx.success', at: 'first', gain: 0.7 }, { key: 'pop', sfxId: 'sfx.pop', at: { text: 'name' }, gain: 0.8 }],
  adjust: [
    { key: 'confetti', span: 'all', effects: [{ type: 'overlay.confetti', params: { mode: 'fall', palette: 'party', density: 0.25 } }], fadeSeconds: 0.5 },
    { key: 'warm', span: 'all', effects: [{ type: 'color.adjust', params: { saturation: 1.12, brightness: 1.03 } }] },
  ],
};

/** The cake moment keeps its own sound (the singing, the candles); a confetti burst follows on the next slot. */
const cake: TemplateDef = {
  id: 'tpl.birthday-cake', version: 1, pack: 'pack.birthday',
  name: { he: 'רגע העוגה', en: 'The cake moment' },
  hint: { he: 'רגע העוגה שומר על הקול שלו, ואחריו מתפוצץ קונפטי', en: 'The cake moment keeps its own sound, and confetti bursts right after it' },
  genre: 'celebration', designedFor: 'tall',
  tempo: { fallbackBpm: 110 },
  music: { need: 'optional', startAt: 'first-downbeat', builtin: 'music.birthday' },
  slots: [
    { key: 'before', role: { he: 'לפני העוגה', en: 'Before the cake' }, accept: 'any', span: { bars: 1 }, motion: { presetId: 'motion.move.ken-burns-in', amount: 0.5 } },
    { key: 'cake', role: { he: 'רגע העוגה', en: 'The cake' }, accept: 'any', span: { bars: 2 }, keepAudio: true, transitionIn: dissolve(0.4) },
    { key: 'burst', role: { he: 'ההתפוצצות', en: 'The burst' }, accept: 'any', span: { bars: 1 }, tag: 'party', motion: { presetId: 'motion.move.ken-burns-out', amount: 0.6 }, transitionIn: { type: 'zoom', seconds: 0.3, dir: 'fixed' } },
    { key: 'after', role: { he: 'אחרי', en: 'Afterwards' }, accept: 'any', span: { bars: 1 }, motion: { presetId: 'motion.move.pan-right', amount: 0.5 }, transitionIn: dissolve(0.4) },
  ],
  slotUse: { mode: 'media', min: 4 },
  texts: [
    { key: 'time', role: { he: 'לפני העוגה', en: 'Before the cake' }, default: { he: 'הגיע זמן העוגה!', en: 'Cake time!' }, maxChars: 30, presetId: 'birthday-pink-box',
      anim: A('word', 'slide', 'fade', 0.4), at: { slot: 'before' }, place: { x: 0, y: 0.28, sizeFrac: 0.055 } },
    { key: 'wish', role: { he: 'משאלה', en: 'Make a wish' }, default: { he: 'מבקשים משאלה!', en: 'Make a wish!' }, maxChars: 30, presetId: 'birthday-sunny',
      anim: A('word', 'rise', 'fade', 0.5), at: { slot: 'cake', offsetBeats: 1 }, place: { x: 0, y: -0.3, sizeFrac: 0.06 } },
    { key: 'name', role: { he: 'שם החוגג', en: 'Name' }, default: { he: 'יום הולדת שמח, {name}!', en: 'Happy birthday, {name}!' }, fallback: { he: 'יום הולדת שמח!', en: 'Happy birthday!' }, maxChars: 40, presetId: 'birthday-bubble',
      anim: A('word', 'pop', 'fade', 0.5), at: { slot: 'after' }, place: { x: 0, y: 0.25, sizeFrac: 0.07 } },
  ],
  elements: [
    { key: 'balloon', elementId: el('balloon-heart'), at: { slot: 'before' }, place: { x: -0.32, y: -0.3, scale: 0.3 }, motion: { presetId: 'motion.in.drop' } },
    { key: 'confetti', elementId: el('confetti-burst'), at: { slot: 'burst' }, place: { x: 0, y: 0, scale: 1 }, motion: { presetId: 'motion.in.pop' } },
    { key: 'popper', elementId: el('party-popper'), at: { slot: 'after' }, place: { x: -0.3, y: -0.3, scale: 0.3 }, motion: { presetId: 'motion.in.pop' } },
  ],
  sfx: [{ key: 'hooray', sfxId: 'sfx.success', at: { slot: 'burst' }, gain: 0.7 }, { key: 'pop', sfxId: 'sfx.pop', at: { text: 'name' }, gain: 0.7 }],
  adjust: [
    { key: 'rain', span: { tag: 'party' }, effects: [{ type: 'overlay.confetti', params: { mode: 'fall', palette: 'party', density: 0.3 } }], fadeSeconds: 0.4 },
    { key: 'warm', span: 'all', effects: [{ type: 'color.adjust', params: { saturation: 1.1, brightness: 1.03 } }] },
  ],
};

/** A square invitation card: the name, the day and the place. */
const invite: TemplateDef = {
  id: 'tpl.birthday-invite', version: 1, pack: 'pack.birthday',
  name: { he: 'הזמנה ליום הולדת', en: 'Birthday invitation' },
  hint: { he: 'כרטיס ריבועי על תמונה אחת: שם החוגג, מתי ואיפה', en: 'A square card over one picture: whose it is, when and where' },
  genre: 'celebration', designedFor: 'square',
  tempo: { fallbackBpm: 110 },
  music: { need: 'optional', startAt: 'zero', builtin: 'music.birthday' },
  slots: [{ key: 'card', role: { he: 'תמונת ההזמנה', en: 'Card picture' }, accept: 'any', span: { seconds: '7' }, motion: { presetId: 'motion.move.ken-burns-in', amount: 0.4 } }],
  slotUse: { mode: 'all', min: 1 },
  texts: [
    { key: 'invite', role: { he: 'ההזמנה', en: 'Invitation' }, default: { he: 'מזמינים אותך!', en: 'You are invited!' }, maxChars: 30, presetId: 'birthday-bubble',
      anim: A('letter', 'pop', 'fade', 0.8, 0.5), at: { slot: 'card' }, place: { x: 0, y: -0.2, sizeFrac: 0.09 } },
    { key: 'name', role: { he: 'שם החוגג', en: 'Name' }, default: { he: 'ליום ההולדת של {name}', en: "{name}'s birthday party" }, fallback: { he: 'ליום ההולדת שלנו', en: 'To our birthday party' }, maxChars: 40, presetId: 'birthday-sunny',
      anim: A('word', 'rise', 'fade', 0.5), at: { slot: 'card', offsetBeats: 2 }, place: { x: 0, y: -0.06, sizeFrac: 0.06 } },
    { key: 'when', role: { he: 'מתי', en: 'When' }, default: { he: 'מתי: {when}', en: 'When: {when}' }, fallback: { he: 'המועד יפורסם בקרוב', en: 'The time will follow soon' }, maxChars: 40, presetId: 'birthday-pink-box',
      anim: A('line', 'fade', 'fade', 0.5), at: { slot: 'card', offsetBeats: 4 }, place: { x: 0, y: 0.1, sizeFrac: 0.05 } },
    { key: 'place', role: { he: 'איפה', en: 'Where' }, default: { he: 'איפה: {place}', en: 'Where: {place}' }, fallback: { he: 'המקום יפורסם בקרוב', en: 'The place will follow soon' }, maxChars: 40, presetId: 'birthday-soft',
      anim: A('line', 'fade', 'fade', 0.5), at: { slot: 'card', offsetBeats: 5 }, place: { x: 0, y: 0.22, sizeFrac: 0.05 } },
  ],
  elements: [
    { key: 'bunting', elementId: el('bunting'), at: { slot: 'card' }, place: { x: 0, y: -0.42, scale: 1 }, motion: { presetId: 'motion.in.drop' } },
  ],
  sfx: [{ key: 'cheer', sfxId: 'sfx.success', at: 'first', gain: 0.6 }],
  adjust: [{ key: 'dim', span: 'all', effects: [{ type: 'blur.gaussian', params: { radius: 0.008 } }, { type: 'color.adjust', params: { brightness: 0.7, saturation: 1.1 } }, { type: 'light.vignette', params: { amount: 0.4 } }], fadeSeconds: 0.5 }],
};

const ELEMENT_SLUGS = [
  'balloon', 'balloon-shine', 'balloons-bunch', 'balloon-heart', 'cake', 'cake-candles', 'cupcake', 'candle-birthday', 'party-hat', 'crown-party', 'gift-box', 'gift-bow', 'bunting', 'streamer', 'confetti-burst',
  'party-popper', 'blower', 'star-burst', 'number-badge', 'ribbon-banner', 'frame-polaroid', 'frame-bunting', 'lollipop', 'ice-cream', 'party-face',
] as const;

export const BIRTHDAY_PACK: PackDef | null = {
  id: 'pack.birthday', version: 1,
  name: { he: 'יום הולדת', en: 'Birthday' },
  hint: { he: 'בלונים, עוגות, כתרים וכותרות לגיל הגדול ולרגע העוגה', en: 'Balloons, cakes, crowns and titles for the big age and the cake moment' },
  palette: [PINK, SUN, SKY, '#FFFFFF'],
  occasion: { kind: 'life-event', event: 'birthday', windowDays: 14 },
  templates: [age, cake, invite], templateIds: ['tpl.birthday'],
  elementIds: ELEMENT_SLUGS.map(el), coverElementIds: [el('balloon-shine'), el('cake-candles'), el('party-hat')],
  looks, captionLooks, textPresets, titles,
  sfxIds: ['sfx.success', 'sfx.pop', 'sfx.bubble', 'sfx.boing'], musicStyleIds: ['music.birthday', 'music.pop'],
};
