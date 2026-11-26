/**
 * The booth's registry (wave 8 booth; plan §3.1 as cut by verify): ONE list of sources (BOOTH_SOURCES), each turning an existing
 * catalogue into BoothItems with a stable id and a recipe hash, and BOOTH_LATER (id → reason) for every catalogue member the booth does
 * not show yet. registry.test.ts fails when a catalogue gains a member that is neither an item nor a BOOTH_LATER row: that is how later
 * tracks are made to register. A future source is one more entry of BOOTH_SOURCES.
 *
 * RECIPES (verify C7): sha256 of canonical JSON (core `canonical`), made once per process.
 * - music: the style row, music.golden.json's sha256 of that style (8 bars, seed 1) and its synth version; `expected` = that sha256.
 * - sfx: { id, version, seconds, graph } and the first line of `ffmpeg -version` (the bytes depend on the ffmpeg build: a laptop with
 *   another ffmpeg asks again before anything is played; `played` is kept for the report).
 * - GPU transition: the catalogue row, the engine's kernel name and variant numbers (GPU_TRANSITIONS), BOOTH_SCENE_VERSION and the
 *   RGBA hash of the two test pictures. GAP (L6, for the ADR): the transition kernels' WGSL bodies are not exported by the engine
 *   (gpu.ts T2 is module-private), so an edit inside a kernel body does not change the recipe; nor do the JS `params` functions or the
 *   shared helpers (transitionUniforms).
 * - GPU effect: the catalogue row (its defaults, not the zod object), the engine's WGSL body (GPU_EFFECTS[id].wgsl), the scene version
 *   and the picture hash. Same GAP for the JS `params` functions.
 * - mic: a constant.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import {
  AUDIO_EFFECTS, BOOTH_FIRST_MUSIC, BOOTH_FIRST_TRANSITIONS, BOOTH_GROUPS, BOOTH_MUSIC_BARS, BOOTH_MUSIC_SEED, BOOTH_PROBLEMS, BOOTH_SCENE_VERSION,
  BoothItemSchema, canonical, EFFECTS, effectChangesLight, MOVES, MUSIC_STYLES, PACKS, TEMPLATES, transitionDef, TRANSITIONS,
  type BoothItem, type BoothProblem, type BoothSource, type EffectDef,
} from '@pulseframe/core';
import { GPU_EFFECTS, GPU_TRANSITIONS } from '@pulseframe/engine';
import { ffmpegVersionText } from '../renderCacheEnv.ts';
import { SFX, type SfxDef } from '../sfx.ts';
import { boothPictures } from './testPicture.ts';

/** What a recipe reads besides the catalogues (known at start, so "changed" is decided before anything plays). */
export interface BoothRegistryEnv { /** first line of `ffmpeg -version`, or 'ffmpeg unavailable' */ ffmpegLine: string; /** sha256 of both test pictures' RGBA */ picturesRgba: string }
export interface BoothSourceDef { id: BoothSource; items(env: BoothRegistryEnv): BoothItem[] }

export const recipeOf = (input: unknown): string => `sha256:${createHash('sha256').update(canonical(input)).digest('hex')}`;

/** «מה שומעים / מה רואים» — the same words as packages/i18n/src/booth.ts `booth.what.*` and `booth.mic.*` (registry.test.ts compares). */
export const BOOTH_WHAT = {
  music: { he: 'מה שומעים: 8 תיבות של הסגנון, כמו בדפדפן המוזיקה', en: 'What you hear: 8 bars of the style, as in the music browser' },
  sfx: { he: 'מה שומעים: הצליל כמו בדפדפן הצלילים', en: 'What you hear: the sound, as in the sound browser' },
  transition: { he: 'מה רואים: המעבר בין שתי תמונות הבדיקה, כפי שהדפדפן הזה מצייר אותו', en: 'What you see: the transition between the two test pictures, as this browser draws it' },
  effect: { he: 'מה רואים: האפקט על תמונת הבדיקה, כפי שהדפדפן הזה מצייר אותו', en: 'What you see: the effect on the test picture, as this browser draws it' },
  micTitle: { he: 'בדיקת מיקרופון', en: 'Microphone check' },
  mic: { he: 'הקלטה של 5 שניות, מושמעת מהזיכרון ולא נשמרת', en: 'A 5-second recording, played back from memory and never stored' },
} as const;

const problems = (kind: 'audio' | 'picture' | 'task'): BoothProblem[] => [...BOOTH_PROBLEMS[kind], ...BOOTH_PROBLEMS.all];
const words = (w: { he: string; en: string }) => ({ he: w.he, en: w.en });

// ------------------------------------------------------------------------------------------------------------------------- music
const golden = JSON.parse(fs.readFileSync(new URL('../music.golden.json', import.meta.url), 'utf8')) as { synth: number; bars: number; seed: number; sha256: Record<string, string> };
if (golden.bars !== BOOTH_MUSIC_BARS || golden.seed !== BOOTH_MUSIC_SEED) throw new Error('music.golden.json is not at the booth\'s 8 bars, seed 1');
export const musicSource: BoothSourceDef = {
  id: 'music',
  items: () => MUSIC_STYLES.filter((s) => s.review !== 'rejected').map((s) => {
    const g = golden.sha256[s.id];
    if (!g) throw new Error(`music.golden.json has no sha256 for ${s.id}`);
    const seconds = (BOOTH_MUSIC_BARS * s.meter * 60) / s.bpm;
    return {
      id: `music:${s.id}`, source: 'music', group: (BOOTH_FIRST_MUSIC as readonly string[]).includes(s.id) ? 'first.music' : 'more.sounds', kind: 'audio',
      title: words(s.name), what: words(BOOTH_WHAT.music),
      recipe: recipeOf({ source: 'music', style: { id: s.id, version: s.version, bpm: s.bpm, meter: s.meter, minBars: s.minBars, mood: s.mood }, golden: g, synth: golden.synth, bars: BOOTH_MUSIC_BARS, seed: BOOTH_MUSIC_SEED }),
      expected: `sha256:${g}`, make: { route: 'music', styleId: s.id, bars: BOOTH_MUSIC_BARS, seed: BOOTH_MUSIC_SEED },
      changesLight: false, exportStrip: false, usedBy: [], minutes: Math.round(((seconds + 20) / 60) * 10) / 10, problems: problems('audio'),
    } satisfies BoothItem;
  }),
};

// ------------------------------------------------------------------------------------------------------------------------- sounds
/** Where an SFX id is placed without the owner choosing it: pack sound lists, template (and pack template) cues, perform pads. */
export function autoUsedSfx(): Map<string, Set<'pack' | 'template' | 'perform'>> {
  const m = new Map<string, Set<'pack' | 'template' | 'perform'>>();
  const add = (id: string, by: 'pack' | 'template' | 'perform') => { if (!m.has(id)) m.set(id, new Set()); m.get(id)!.add(by); };
  for (const p of PACKS) for (const id of p.sfxIds) add(id, 'pack');
  for (const t of TEMPLATES) for (const cue of t.sfx ?? []) add(cue.sfxId, 'template');
  for (const mv of MOVES) if (mv.kind === 'sound') add(mv.source.sfxId, 'perform');
  return m;
}
export const sfxSource: BoothSourceDef = {
  id: 'sfx',
  items: (env) => {
    const auto = autoUsedSfx();
    return SFX.map((d: SfxDef) => {
      const by = auto.get(d.id);
      return {
        id: `sfx:${d.id}`, source: 'sfx', group: by ? 'more.auto-sounds' : 'more.sounds', kind: 'audio', title: words(d.name), what: words(BOOTH_WHAT.sfx),
        recipe: recipeOf({ source: 'sfx', id: d.id, version: d.version, seconds: d.seconds, graph: d.graph, ffmpeg: env.ffmpegLine }),
        make: { route: 'sfx', sfxId: d.id }, changesLight: false, exportStrip: false,
        usedBy: by ? (['perform', 'pack', 'template'] as const).filter((u) => by.has(u)) : [], minutes: 0.2, problems: problems('audio'),
      } satisfies BoothItem;
    });
  },
};

// --------------------------------------------------------------------------------------------------------------------- GPU pictures
/** Content-dependent GPU effects (verify C10f): nothing to see on a still test picture, an invitation to a false «שבור». */
export const BOOTH_CONTENT_DEPENDENT_EFFECTS: Readonly<Record<string, string>> = {
  'key.chroma': 'keys out a green screen; the test pictures have none, so it shows nothing to judge',
  'color.lut': 'needs a colour table imported into a project; with none chosen the picture is unchanged',
  // «תמונה חיה» (wave 8 living; added by the lead at the merge): needs a depth the owner drew for one photo, and its pass is not built yet
  'depth.living': 'needs a depth drawn by hand for one photo; the test pictures have none, so there is nothing to judge',
};
const transitionRow = (id: string) => JSON.parse(JSON.stringify(transitionDef(id))) as Record<string, unknown>;
export const gpuTransitionSource: BoothSourceDef = {
  id: 'gpu-transition',
  items: (env) => TRANSITIONS.filter((t) => t.gpu).map((t) => {
    const engine = GPU_TRANSITIONS[t.id];
    if (!engine) throw new Error(`the engine has no GPU kernel for ${t.id}`);
    const first = (BOOTH_FIRST_TRANSITIONS as readonly string[]).includes(t.id);
    const def = transitionDef(t.id)!;
    return {
      id: `gpu-transition:${t.id}`, source: 'gpu-transition', group: first ? 'first.gpu-new' : 'more.gpu-transitions', kind: 'picture',
      title: words(t.name), what: words(BOOTH_WHAT.transition),
      recipe: recipeOf({ source: 'gpu-transition', row: transitionRow(t.id), kernel: engine.kernel, v: engine.v, scene: BOOTH_SCENE_VERSION, pictures: env.picturesRgba }),
      make: { route: 'scene', scene: 'transition', id: t.id },
      // a light transition, and the flash (a full-frame white cover, outside the flash schedule by ADR-0011): both start as a still
      changesLight: def.light === true || def.kernel === 'flash', exportStrip: first, usedBy: [], minutes: 0.5, problems: problems('picture'),
    } satisfies BoothItem;
  }),
};
const effectRow = (e: EffectDef) => ({ id: e.id, version: e.version, category: e.category, name: e.name, description: e.description, cost: e.cost, temporal: e.temporal, seeded: e.seeded, defaults: e.params.parse({}) });
export const gpuEffectSource: BoothSourceDef = {
  id: 'gpu-effect',
  items: (env) => (EFFECTS as readonly EffectDef[]).filter((e) => e.cost === 'gpu' && !(e.id in BOOTH_CONTENT_DEPENDENT_EFFECTS)).map((e) => {
    const engine = GPU_EFFECTS[e.id];
    if (!engine) throw new Error(`the engine has no GPU pass for ${e.id}`);
    return {
      id: `gpu-effect:${e.id}`, source: 'gpu-effect', group: 'more.gpu-effects', kind: 'picture', title: words(e.name), what: words(BOOTH_WHAT.effect),
      recipe: recipeOf({ source: 'gpu-effect', row: effectRow(e), wgsl: engine.wgsl, lut: engine.lut ?? null, scene: BOOTH_SCENE_VERSION, pictures: env.picturesRgba }),
      make: { route: 'scene', scene: 'effect', id: e.id }, changesLight: effectChangesLight(e.id), exportStrip: false, usedBy: [], minutes: 0.5, problems: problems('picture'),
    } satisfies BoothItem;
  }),
};

// --------------------------------------------------------------------------------------------------------------------------- tasks
export const BOOTH_MIC_RECIPE_INPUT = { source: 'task', task: 'mic', version: 1, seconds: 5, stored: false } as const;
export const taskSource: BoothSourceDef = {
  id: 'task',
  items: () => [{
    id: 'task:mic', source: 'task', group: 'first.mic', kind: 'task', title: words(BOOTH_WHAT.micTitle), what: words(BOOTH_WHAT.mic),
    recipe: recipeOf(BOOTH_MIC_RECIPE_INPUT), make: { route: 'task', task: 'mic' }, changesLight: false, exportStrip: false, usedBy: [], minutes: 1, problems: problems('task'),
  }],
};

/** THE list of sources, one per BoothSource value. A later track adds its own here. */
export const BOOTH_SOURCES: readonly BoothSourceDef[] = [musicSource, sfxSource, gpuTransitionSource, gpuEffectSource, taskSource];

/** Catalogue members the booth does not show yet, by `<catalogue>:<id>`, with the reason. */
export const BOOTH_LATER: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(TRANSITIONS.filter((t) => !t.gpu).map((t) => [`transition:${t.id}`, 'Canvas2D transition: drawn the same on every machine without the graphics card; a later booth version'])),
  ...Object.fromEntries((EFFECTS as readonly EffectDef[]).filter((e) => e.cost !== 'gpu').map((e) => [`effect:${e.id}`, 'Canvas2D effect: drawn the same on every machine without the graphics card; a later booth version'])),
  ...Object.fromEntries(Object.entries(BOOTH_CONTENT_DEPENDENT_EFFECTS).map(([id, why]) => [`effect:${id}`, `content-dependent GPU effect: ${why}`])),
  ...Object.fromEntries(AUDIO_EFFECTS.map((e) => [`voice-effect:${e.id}`, 'voice effect: the product ships no voice to play it on; a later version uses the owner\'s own recording'])),
});

/** Every item, parsed with BoothItemSchema, in group order (BOOTH_GROUPS) then catalogue order. Throws on a duplicate id. */
export function boothItems(env: BoothRegistryEnv, sources: readonly BoothSourceDef[] = BOOTH_SOURCES): BoothItem[] {
  const all = sources.flatMap((s) => s.items(env).map((i) => BoothItemSchema.parse(i)));
  const seen = new Set<string>();
  for (const i of all) { if (seen.has(i.id)) throw new Error(`duplicate booth item ${i.id}`); seen.add(i.id); }
  return all.map((item, n) => ({ item, n })).sort((x, y) => BOOTH_GROUPS.indexOf(x.item.group) - BOOTH_GROUPS.indexOf(y.item.group) || x.n - y.n).map((x) => x.item);
}

/** The first line of `ffmpeg -version` (ASCII, at most 120 characters), or 'ffmpeg unavailable' when it cannot be started. */
export async function ffmpegFirstLine(read: () => Promise<string> = ffmpegVersionText): Promise<string> {
  try {
    const line = (await read()).split(/\r?\n/)[0]!.replace(/[^\x20-\x7e]/g, '').trim().slice(0, 120);
    return line || 'ffmpeg unavailable';
  } catch { return 'ffmpeg unavailable'; }
}
let registry: Promise<BoothItem[]> | null = null;
/** The registry of this process (recipes are made once per process start). */
export function boothRegistry(): Promise<BoothItem[]> {
  registry ??= (async () => boothItems({ ffmpegLine: await ffmpegFirstLine(), picturesRgba: boothPictures().rgbaSha256 }))();
  registry.catch(() => { registry = null; });
  return registry;
}
