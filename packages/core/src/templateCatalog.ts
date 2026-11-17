/**
 * The built-in templates (ADR-0016): versioned code data, compiled to public ops by templatePlan.ts. Rule-based; no model.
 * - Looks are Canvas2D effects only (colour adjust, sepia, grayscale, blur, vignette, diffusion, grain, date stamp, confetti,
 *   bokeh), carried by adjustment items, and transitions are the CPU ones (dissolve, push, wipe, zoom): every template
 *   renders on any machine, without a graphics adapter.
 * - No strobe and no dip to white: nothing here adds a flash (ADR-0009).
 * - Hebrew and English names, hints, roles and default texts. Every id named here exists in this build's catalogues (effects,
 *   transitions, motion presets, text presets, elements; sound effects in apps/server/src/sfx.ts). templateCatalog.test.ts and
 *   apps/server/src/templateCatalog.test.ts check that.
 * - Keys are unique within a template across slots, texts, elements, sound effects and looks; the planner uses them as bind
 *   names, so none is a name every object answers to.
 * A change to what a template makes is a new `version`: the run records the version it applied.
 * Templates that need a model are not here: they are MODEL_GATED_TEMPLATES (templateContract.ts), listed as unavailable.
 */
import type { TemplateDef } from './templateContract.ts';

type SlotDef = TemplateDef['slots'][number];
const MOVES = ['motion.move.ken-burns-in', 'motion.move.pan-left', 'motion.move.ken-burns-out', 'motion.move.pan-right'] as const;

const travelMontage: TemplateDef = {
  id: 'tpl.travel-montage', version: 1,
  name: { he: 'מונטאז׳ טיול', en: 'Travel montage' },
  hint: { he: 'קטעים קצרים בקצב המוזיקה, תנועות מצלמה עדינות ומעברי דחיפה', en: 'Short shots on the beat of the music, gentle camera moves and push transitions' },
  genre: 'montage', designedFor: 'tall',
  tempo: { fallbackBpm: 120 },
  music: { need: 'beats', startAt: 'first-downbeat' },
  slots: Array.from({ length: 8 }, (_, i): SlotDef => ({
    key: `shot${i + 1}`, role: { he: `צילום ${i + 1}`, en: `Shot ${i + 1}` }, accept: 'any', span: { beats: 2 },
    motion: { presetId: MOVES[i % MOVES.length]!, amount: 0.8 },
    ...(i > 0 ? { transitionIn: i % 2 ? { type: 'push-left', seconds: 0.25, dir: 'reading' as const } : { type: 'dissolve', seconds: 0.2, dir: 'fixed' as const } } : {}),
  })),
  slotUse: { mode: 'media', min: 4 },
  texts: [
    { key: 'place', role: { he: 'שם המקום', en: 'Place' }, default: { he: 'הטיול שלנו', en: 'Our trip' }, maxChars: 24, presetId: 'display-big',
      anim: { by: 'letter', in: 'rise', out: 'fade', loop: null, inSeconds: 0.6, outSeconds: 0.4 }, at: { slot: 'shot1', spanSlots: 2 }, place: { x: 0, y: -0.25, sizeFrac: 0.09 } },
    { key: 'when', role: { he: 'מתי', en: 'When' }, default: { he: 'קיץ 2026', en: 'Summer 2026' }, maxChars: 24, presetId: 'minimal-small',
      anim: { by: 'word', in: 'fade', out: 'fade', loop: null, inSeconds: 0.4, outSeconds: 0.4 }, at: { slot: 'shot1', offsetBeats: 1, spanSlots: 2 }, place: { x: 0, y: -0.15 } },
  ],
  elements: [
    { key: 'pin', elementId: 'element.symbol.location-pin', color: '#FFFFFF', at: { slot: 'shot1', spanSlots: 2 }, place: { x: 0, y: -0.36, scale: 0.6 }, motion: { presetId: 'motion.in.drop' } },
  ],
  sfx: [{ key: 'whoosh', sfxId: 'sfx.whoosh-short', at: 'boundaries', everyN: 2, gain: 0.6 }],
  adjust: [{ key: 'look', span: 'all', effects: [{ type: 'color.adjust', params: { saturation: 1.15, contrast: 1.05 } }, { type: 'light.vignette', params: { amount: 0.3 } }] }],
};

const photoDump: TemplateDef = {
  id: 'tpl.photo-dump', version: 1,
  name: { he: 'פוטו דאמפ', en: 'Photo dump' },
  hint: { he: 'הרבה תמונות, חיתוך על כל פעימה, וגרעיניות של מצלמה ישנה', en: 'Lots of photos, a cut on every beat, and the grain of an old camera' },
  genre: 'montage', designedFor: 'tall',
  tempo: { fallbackBpm: 120 },
  music: { need: 'optional', startAt: 'first-downbeat' },
  slots: Array.from({ length: 12 }, (_, i): SlotDef => ({
    key: `photo${i + 1}`, role: { he: `תמונה ${i + 1}`, en: `Photo ${i + 1}` }, accept: 'image', span: { beats: 1 },
    ...(i % 3 === 0 ? { motion: { presetId: 'motion.move.ken-burns-in', amount: 0.5 } } : {}),
  })),
  slotUse: { mode: 'media', min: 6 },
  texts: [
    { key: 'title', role: { he: 'כותרת', en: 'Title' }, default: { he: 'פוטו דאמפ', en: 'Photo dump' }, maxChars: 30, presetId: 'sticker-white',
      anim: { by: 'word', in: 'pop', out: 'fade', loop: null, inSeconds: 0.4, outSeconds: 0.3 }, at: { slot: 'photo1', spanSlots: 3 }, place: { x: 0, y: 0.3, sizeFrac: 0.07 } },
  ],
  elements: [],
  sfx: [{ key: 'shutter', sfxId: 'sfx.shutter', at: 'boundaries', everyN: 2, gain: 0.5 }],
  adjust: [{ key: 'film', span: 'all', effects: [{ type: 'stylize.grain', params: { amount: 0.18 } }, { type: 'color.adjust', params: { contrast: 1.08, saturation: 0.95 } }] }],
};

const birthday: TemplateDef = {
  id: 'tpl.birthday', version: 1,
  name: { he: 'יום הולדת', en: 'Birthday' },
  hint: { he: 'כותרת זהב, קונפטי בפתיחה וברכה בסוף', en: 'A gold title, confetti at the start and a wish at the end' },
  genre: 'celebration', designedFor: 'tall',
  tempo: { fallbackBpm: 110 },
  music: { need: 'optional', startAt: 'first-downbeat' },
  slots: Array.from({ length: 6 }, (_, i): SlotDef => ({
    key: `moment${i + 1}`, role: { he: `רגע ${i + 1}`, en: `Moment ${i + 1}` }, accept: 'any', span: { bars: 1 },
    motion: { presetId: MOVES[i % MOVES.length]!, amount: 0.6 },
    ...(i > 0 ? { transitionIn: i === 3 ? { type: 'zoom', seconds: 0.3, dir: 'fixed' as const } : { type: 'dissolve', seconds: 0.4, dir: 'fixed' as const } } : {}),
    ...(i < 2 ? { tag: 'party' } : {}),
  })),
  slotUse: { mode: 'media', min: 4 },
  texts: [
    { key: 'title', role: { he: 'ברכה', en: 'Greeting' }, default: { he: 'יום הולדת שמח!', en: 'Happy birthday!' }, maxChars: 30, presetId: 'gold',
      anim: { by: 'letter', in: 'pop', out: 'fade', loop: null, inSeconds: 0.8, outSeconds: 0.4 }, at: { slot: 'moment1', spanSlots: 2 }, place: { x: 0, y: -0.22, sizeFrac: 0.08 } },
    { key: 'wish', role: { he: 'איחול לסיום', en: 'Closing wish' }, default: { he: 'עד 120!', en: 'Make a wish!' }, maxChars: 30, presetId: 'yellow-pop',
      anim: { by: 'word', in: 'rise', out: 'fade', loop: null, inSeconds: 0.5, outSeconds: 0.4 }, at: { slot: 'moment6' }, place: { x: 0, y: 0.25 } },
  ],
  elements: [
    { key: 'star', elementId: 'element.shape.star-5', color: '#FFD166', at: { slot: 'moment1', spanSlots: 2 }, place: { x: -0.3, y: -0.32, scale: 0.5 }, motion: { presetId: 'motion.loop.pulse' } },
    { key: 'heart', elementId: 'element.shape.heart', color: '#FF4D6D', at: { slot: 'moment6' }, place: { x: 0.3, y: 0.34, scale: 0.5 }, motion: { presetId: 'motion.in.pop' } },
  ],
  sfx: [{ key: 'cheer', sfxId: 'sfx.success', at: 'first', gain: 0.7 }, { key: 'pop', sfxId: 'sfx.pop', at: { text: 'wish' }, gain: 0.8 }],
  adjust: [
    { key: 'confetti', span: { tag: 'party' }, effects: [{ type: 'overlay.confetti', params: { mode: 'fall', palette: 'party', density: 0.3 } }], fadeSeconds: 0.5 },
    { key: 'warm', span: 'all', effects: [{ type: 'color.adjust', params: { saturation: 1.1, brightness: 1.03 } }] },
  ],
};

const quoteCard: TemplateDef = {
  id: 'tpl.quote-card', version: 1,
  name: { he: 'כרטיס ציטוט', en: 'Quote card' },
  hint: { he: 'ציטוט גדול, מילה אחר מילה, על רקע כהה ומטושטש', en: 'A large quote, word by word, over a dark blurred background' },
  genre: 'quote', designedFor: 'square',
  tempo: { fallbackBpm: 80 },
  music: { need: 'optional', startAt: 'zero' },
  slots: [{ key: 'backdrop', role: { he: 'רקע', en: 'Background' }, accept: 'any', span: { seconds: '6' }, motion: { presetId: 'motion.move.ken-burns-in', amount: 0.6 } }],
  slotUse: { mode: 'all', min: 1 },
  texts: [
    { key: 'quote', role: { he: 'הציטוט', en: 'Quote' }, default: { he: 'כל דרך ארוכה מתחילה בצעד אחד', en: 'Every long road begins with a single step' }, maxChars: 120, presetId: 'elegant-serif',
      anim: { by: 'word', in: 'fade', out: 'fade', loop: null, inSeconds: 1.5, outSeconds: 0.6 }, at: { slot: 'backdrop' }, place: { x: 0, y: -0.05, sizeFrac: 0.07 } },
    { key: 'author', role: { he: 'מי אמר', en: 'Who said it' }, default: { he: '— פתגם', en: '— Proverb' }, maxChars: 40, presetId: 'minimal-grey',
      anim: { by: 'line', in: 'fade', out: 'fade', loop: null, inSeconds: 0.6, outSeconds: 0.6 }, at: { slot: 'backdrop', offsetBeats: 2 }, place: { x: 0, y: 0.18, sizeFrac: 0.035 } },
  ],
  elements: [
    { key: 'rule', elementId: 'element.line.divider-diamond', color: '#F5E9D0', at: { slot: 'backdrop', offsetBeats: 1 }, place: { x: 0, y: 0.11, scale: 0.6 }, motion: { presetId: 'motion.in.fade' } },
  ],
  sfx: [],
  adjust: [{ key: 'dim', span: 'all', effects: [{ type: 'blur.gaussian', params: { radius: 0.012 } }, { type: 'color.adjust', params: { brightness: 0.55, saturation: 0.8 } }, { type: 'light.vignette', params: { amount: 0.5 } }], fadeSeconds: 0.8 }],
};

const countdownList: TemplateDef = {
  id: 'tpl.countdown-list', version: 1,
  name: { he: 'רשימת ספירה לאחור', en: 'Countdown list' },
  hint: { he: 'חמישה פריטים, מהחמישי עד הראשון, עם מספר גדול על כל אחד', en: 'Five items, from fifth to first, with a large number on each' },
  genre: 'list', designedFor: 'tall',
  tempo: { fallbackBpm: 100 },
  music: { need: 'optional', startAt: 'first-downbeat' },
  slots: Array.from({ length: 5 }, (_, i): SlotDef => ({
    key: `item${i + 1}`, role: { he: `מקום ${5 - i}`, en: `Number ${5 - i}` }, accept: 'any', span: { bars: 1 },
    motion: { presetId: 'motion.move.push-in-tilt', amount: 0.5 },
    ...(i > 0 ? { transitionIn: { type: 'push-left', seconds: 0.3, dir: 'reading' as const } } : {}),
  })),
  slotUse: { mode: 'all', min: 5 },
  texts: [
    { key: 'heading', role: { he: 'כותרת הרשימה', en: 'List heading' }, default: { he: 'חמשת הדברים שהכי אהבתי', en: 'My top five' }, maxChars: 40, presetId: 'black-box',
      anim: { by: 'word', in: 'slide', out: 'fade', loop: null, inSeconds: 0.5, outSeconds: 0.3 }, at: { slot: 'item1' }, place: { x: 0, y: -0.35, sizeFrac: 0.045 } },
    { key: 'number', role: { he: 'מספר', en: 'Number' }, default: { he: '{n}', en: '#{n}' }, maxChars: 6, presetId: 'display-yellow', perSlot: 'count-down',
      anim: { by: 'letter', in: 'pop', out: null, loop: null, inSeconds: 0.4, outSeconds: 0.3 }, at: { slot: 'item1' }, place: { x: 0, y: 0.25, sizeFrac: 0.14 } },
  ],
  elements: [
    { key: 'badge', elementId: 'element.badge.circle-badge', color: '#E10600', perSlot: 'count-down', at: { slot: 'item1' }, place: { x: 0, y: 0.25, scale: 0.9 }, motion: { presetId: 'motion.in.pop' } },
  ],
  sfx: [{ key: 'whoosh', sfxId: 'sfx.whoosh-short', at: 'boundaries', gain: 0.5 }, { key: 'ding', sfxId: 'sfx.ding', at: 'last', gain: 0.6 }],
  adjust: [{ key: 'punch', span: 'all', effects: [{ type: 'color.adjust', params: { contrast: 1.1, saturation: 1.1 } }] }],
};

const homeVideo: TemplateDef = {
  id: 'tpl.home-video', version: 1,
  name: { he: 'וידאו ביתי', en: 'Home video' },
  hint: { he: 'מראה של מצלמת וידאו ישנה: גוון חם, גרעיניות, וינייטה וחותמת תאריך. הקטעים שומרים על הקול שלהם', en: 'The look of an old camcorder: a warm tone, grain, a vignette and a date stamp. The clips keep their own sound' },
  genre: 'memories', designedFor: 'wide',
  tempo: { fallbackBpm: 90 },
  music: { need: 'optional', startAt: 'zero' },
  slots: Array.from({ length: 6 }, (_, i): SlotDef => ({
    key: `clip${i + 1}`, role: { he: `קטע ${i + 1}`, en: `Clip ${i + 1}` }, accept: 'any', span: { seconds: '3' }, keepAudio: true,
    ...(i > 0 ? { transitionIn: { type: 'dissolve', seconds: 0.5, dir: 'fixed' as const } } : {}),
  })),
  slotUse: { mode: 'media', min: 3 },
  texts: [
    { key: 'title', role: { he: 'כותרת', en: 'Title' }, default: { he: 'זיכרונות מהבית', en: 'Home memories' }, maxChars: 30, presetId: 'retro',
      anim: { by: 'line', in: 'fade', out: 'fade', loop: null, inSeconds: 0.8, outSeconds: 0.8 }, at: { slot: 'clip1' }, place: { x: 0, y: 0, sizeFrac: 0.08 } },
  ],
  elements: [],
  sfx: [{ key: 'crackle', sfxId: 'sfx.vinyl-crackle', at: 'first', gain: 0.3 }],
  adjust: [{ key: 'camcorder', span: 'all', effects: [{ type: 'color.sepia', params: { amount: 0.3 } }, { type: 'stylize.grain', params: { amount: 0.2 } }, { type: 'light.vignette', params: { amount: 0.45 } }, { type: 'stylize.date-stamp' }] }],
};

export const TEMPLATES: readonly TemplateDef[] = [travelMontage, photoDump, birthday, quoteCard, countdownList, homeVideo];
export const findTemplate = (id: string): TemplateDef | undefined => TEMPLATES.find((t) => t.id === id);
