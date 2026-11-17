/**
 * Sound-effect registry (ADR-0010, SPEC §10). Contract only: ids, versions, stages, parameter schemas, defaults.
 * The one implementation of every effect is packages/engine/src/audiofx, shared by preview, browser export and server export.
 */
import { z } from 'zod';
import { GENERIC_NOISE_PROFILE, NOISE_PROFILE_PATTERN } from './voiceClean.ts';

export type AudioFxParamValue = number | string | boolean;
export type AudioFxParams = Record<string, AudioFxParamValue>;
/** 1 time · 2 tone · 3 texture | × volume keys × fades | 4 space · 5 rhythm · 6 motion | × gain × duck × balance */
export type AudioFxStage = 1 | 2 | 3 | 4 | 5 | 6;
export const isWindowStage = (s: AudioFxStage): boolean => s <= 3;

export interface AudioFxDef<S extends z.ZodObject = z.ZodObject> {
  id: string;
  /** Bump whenever output changes (golden-hash test). */
  version: number;
  stage: AudioFxStage;
  category: 'cleanup' | 'voice' | 'space' | 'tone' | 'texture' | 'utility';
  name: { he: string; en: string };
  description: string;
  limits: string;
  params: S;
  /** At most one effect with exclusive 'voice' per clip. */
  exclusive?: 'voice';
  seeded: boolean;
  /** Upper bound of the ring-out after the clip end for any params in range (0 for window stages). */
  maxTailSeconds: number;
  /** Params at which the output is exactly the dry sound; such an instance is left out of the plan. */
  isIdentity: (p: AudioFxParams) => boolean;
  /** Upper bound in ms of the source read ahead and compensated (any params in range, 44.1–96 kHz, speed 0.25–4); absent = 0 (ADR-0013). */
  aheadMs?: number;
}

export const AudioFxInstanceSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.string().min(1).max(48),
  enabled: z.boolean(),
  params: z.record(z.string(), z.union([z.number(), z.string().max(64), z.boolean()])),
}).strict();
export type AudioFxInstance = z.infer<typeof AudioFxInstanceSchema>;
export const MAX_AUDIO_FX = 8;

const amount = (d: number) => z.number().min(0).max(1).default(d).describe('0 = no effect (dry), 1 = full effect');
const seed = z.number().int().min(0).max(1_000_000).default(1).describe('noise pattern; combined with the effect id, so every clip gets its own');
const dry = (p: AudioFxParams) => p.amount === 0;
const def = <S extends z.ZodObject>(d: AudioFxDef<S>): AudioFxDef => d as unknown as AudioFxDef;

/** Registry order is the processing order inside a stage. The cleanup effects (ADR-0013) come first: they repair the sound before anything shapes it. */
export const AUDIO_EFFECTS: readonly AudioFxDef[] = [
  def({ id: 'cleanup.dehum', version: 1, stage: 2, category: 'cleanup', name: { he: 'הסרת זמזום', en: 'Hum removal' }, seeded: false, maxTailSeconds: 0, isIdentity: dry, aheadMs: 0,
    description: 'Removes mains hum (50 or 60 Hz) and its first harmonics with narrow notches; sound between the notches is untouched. Follows the clip speed.',
    limits: 'Steady mains hum only; not other buzz or whine. Measured on synthetic hum; not yet listened to by the owner.',
    params: z.object({ amount: amount(1), mainsHz: z.enum(['50', '60']).default('50').describe('mains frequency where the recording was made'), harmonics: z.number().int().min(1).max(8).default(4).describe('multiples of the mains frequency removed'), width: z.number().min(0).max(1).default(0.5).describe('0 = narrowest notches, 1 = widest') }).strict() }),
  def({ id: 'cleanup.denoise', version: 1, stage: 2, category: 'cleanup', name: { he: 'הפחתת רעש', en: 'Noise reduction' }, seeded: false, maxTailSeconds: 0, isIdentity: dry, aheadMs: 50,
    description: 'Lowers steady background noise (hiss, fan, room tone) with a spectral gate driven by the recording\'s measured noise profile (measure_voice). No AI model.',
    limits: 'Steady noise only: not voices, music, barks or doors. Moving the clip by a fraction of a frame changes the result very slightly. Measured on synthetic speech; not yet listened to by the owner.',
    params: z.object({ amount: amount(1), reductionDb: z.number().min(3).max(30).default(12).describe('largest reduction of the noise, dB'), sensitivityDb: z.number().min(-10).max(10).default(0).describe('positive treats more of the sound as noise'), profile: z.string().regex(NOISE_PROFILE_PATTERN).default(GENERIC_NOISE_PROFILE).describe('noise level in 24 bands, encoded; from measure_voice. The default is a generic quiet floor'), source: z.string().max(64).default('').describe('asset the profile was measured on; empty = generic') }).strict() }),
  def({ id: 'cleanup.speech', version: 1, stage: 2, category: 'cleanup', name: { he: 'שיפור דיבור', en: 'Speech enhancer' }, seeded: false, maxTailSeconds: 0, isIdentity: dry, aheadMs: 250,
    description: 'Clearer, even speech: removes rumble, adds presence, evens out phrase levels toward a target and keeps peaks under a ceiling.',
    limits: 'The ceiling applies to this clip before clip gain and volume keys; it is not a master limiter. Pauses are never raised. Not yet listened to by the owner.',
    params: z.object({ amount: amount(1), lowCutHz: z.number().int().min(20).max(150).default(80).describe('rumble below this is removed'), presence: z.number().min(0).max(1).default(0.5).describe('less mud, more presence and air'), levelDb: z.number().min(0).max(15).default(8).describe('largest change the leveller makes, dB'), targetDb: z.number().min(-30).max(-12).default(-20).describe('speech level the leveller aims for, dBFS RMS'), ceilingDb: z.number().min(-6).max(0).default(-1).describe('the clip never peaks above this, dBFS sample peak') }).strict() }),
  def({ id: 'tone.bassboost', version: 1, stage: 2, category: 'tone', name: { he: 'הגברת באס', en: 'Bass boost' }, seeded: false, maxTailSeconds: 0, isIdentity: dry,
    description: 'Fuller, heavier low end: a low shelf with automatic make-up gain (-gain/3 dB) and a soft limit above -1 dBFS.',
    limits: 'Can raise the mix level; with a loudness target the export normalises it.',
    params: z.object({ amount: amount(1), gainDb: z.number().min(3).max(15).default(8).describe('boost at the lowest frequencies, dB'), freqHz: z.number().int().min(60).max(150).default(90).describe('shelf corner, Hz') }).strict() }),
  def({ id: 'voice.telephone', version: 1, stage: 3, category: 'voice', exclusive: 'voice', name: { he: 'טלפון', en: 'Telephone' }, seeded: true, maxTailSeconds: 0, isIdentity: dry,
    description: 'A voice heard through a phone line: 300-3400 Hz, slight grit, optional line hiss. A DSP effect, not voice conversion.',
    limits: 'Hiss is seeded noise; the same document always gives the same hiss.',
    params: z.object({ amount: amount(1), grit: z.number().min(0).max(1).default(0.4), hiss: z.number().min(0).max(1).default(0.3).describe('0 = none'), seed }).strict() }),
  def({ id: 'voice.megaphone', version: 1, stage: 3, category: 'voice', exclusive: 'voice', name: { he: 'מגפון', en: 'Megaphone' }, seeded: false, maxTailSeconds: 0, isIdentity: dry,
    description: 'A loud-hailer voice: honky mid band, horn resonance, harsh saturation.',
    limits: 'No oversampling in this version: strong drive adds some aliasing.',
    params: z.object({ amount: amount(1), drive: z.number().min(0).max(1).default(0.6) }).strict() }),
  def({ id: 'voice.radio', version: 1, stage: 3, category: 'voice', exclusive: 'voice', name: { he: 'רדיו', en: 'Radio' }, seeded: true, maxTailSeconds: 0, isIdentity: dry,
    description: 'An old transistor radio: 200-5000 Hz, saturation, static with crackle, slow level wobble.',
    limits: 'Crackle positions are seeded and identical on every route.',
    params: z.object({ amount: amount(1), noise: z.number().min(0).max(1).default(0.4).describe('static and crackle'), seed }).strict() }),
  def({ id: 'voice.robot', version: 1, stage: 3, category: 'voice', exclusive: 'voice', name: { he: 'רובוט', en: 'Robot' }, seeded: false, maxTailSeconds: 0, isIdentity: dry,
    description: 'A metallic robot voice: ring modulation plus a short metallic comb.',
    limits: 'Not a vocoder; the words stay as spoken.',
    params: z.object({ amount: amount(1), pitchHz: z.number().int().min(30).max(200).default(90), metal: z.number().min(0).max(1).default(0.5) }).strict() }),
  def({ id: 'texture.8bit', version: 1, stage: 3, category: 'texture', name: { he: '8 ביט', en: '8-bit' }, seeded: false, maxTailSeconds: 0, isIdentity: dry,
    description: 'Game-console sound: fewer levels and a lower sample rate.',
    limits: 'Aliasing is the intended sound.',
    params: z.object({ amount: amount(1), bits: z.number().int().min(3).max(10).default(6), rateKhz: z.number().int().min(3).max(24).default(8) }).strict() }),
  def({ id: 'space.echo', version: 1, stage: 4, category: 'space', name: { he: 'הד', en: 'Echo' }, seeded: false, maxTailSeconds: 8.01, isIdentity: dry, // 8 repeats of 1 s, plus the ring of the tone filter (under 3 ms)
    description: 'Distinct repeats that ring on past the end of the clip (cut at the end of the video).',
    limits: 'At most 8 repeats of at most 1 s.',
    params: z.object({ amount: amount(0.5), delayMs: z.number().int().min(50).max(1000).default(250), repeats: z.number().int().min(1).max(8).default(4), feedback: z.number().min(0.2).max(0.8).default(0.5), pingPong: z.boolean().default(false), tone: z.number().min(0).max(1).default(0).describe('0 = bright, 1 = dark repeats') }).strict() }),
  def({ id: 'space.reverb', version: 1, stage: 4, category: 'space', name: { he: 'הדהוד', en: 'Reverb' }, seeded: false, maxTailSeconds: 7.6, isIdentity: dry,
    description: 'Places the sound in a room, hall, cave or shower; the reverb rings on past the end of the clip (cut at the end of the video).',
    limits: 'Algorithmic, not a measured room; decay at most 3 s in this version.',
    params: z.object({ amount: amount(0.3), room: z.enum(['room', 'hall', 'cave', 'bathroom']).default('hall'), decaySeconds: z.number().min(0.2).max(3).default(1.8), predelayMs: z.number().int().min(0).max(100).default(20), damping: z.number().min(0).max(1).default(0.5), spread: z.number().min(0).max(1).default(1) }).strict() }),
  def({ id: 'utility.width', version: 1, stage: 6, category: 'utility', name: { he: 'רוחב סטריאו', en: 'Stereo width' }, seeded: false, maxTailSeconds: 0, isIdentity: (p) => p.stereoWidth === 1,
    description: 'Narrows (0 = mono) or widens (2) the stereo image.',
    limits: 'A mono source has no side signal: width does nothing to it.',
    params: z.object({ stereoWidth: z.number().min(0).max(2).default(1.5) }).strict() }),
];

export interface AudioPreset { id: string; name: { he: string; en: string }; effects: readonly { type: string; params?: AudioFxParams }[] }
export const AUDIO_PRESETS: readonly AudioPreset[] = [
  { id: 'telephone', name: { he: 'טלפון', en: 'Telephone' }, effects: [{ type: 'voice.telephone' }] },
  { id: 'megaphone', name: { he: 'מגפון', en: 'Megaphone' }, effects: [{ type: 'voice.megaphone' }] },
  { id: 'radio', name: { he: 'רדיו', en: 'Radio' }, effects: [{ type: 'voice.radio' }] },
  { id: 'robot', name: { he: 'רובוט', en: 'Robot' }, effects: [{ type: 'voice.robot' }] },
  { id: '8bit', name: { he: '8 ביט', en: '8-bit' }, effects: [{ type: 'texture.8bit' }] },
  { id: 'room', name: { he: 'חדר', en: 'Room' }, effects: [{ type: 'space.reverb', params: { room: 'room', decaySeconds: 0.6, amount: 0.25 } }] },
  { id: 'hall', name: { he: 'אולם', en: 'Hall' }, effects: [{ type: 'space.reverb', params: { room: 'hall', decaySeconds: 1.8, amount: 0.3 } }] },
  { id: 'cave', name: { he: 'מערה', en: 'Cave' }, effects: [{ type: 'space.reverb', params: { room: 'cave', decaySeconds: 3, amount: 0.45, predelayMs: 60 } }] },
  { id: 'bathroom', name: { he: 'מקלחת', en: 'Shower' }, effects: [{ type: 'space.reverb', params: { room: 'bathroom', decaySeconds: 0.9, amount: 0.35 } }] },
  { id: 'stadium', name: { he: 'כרוז באצטדיון', en: 'Stadium announcer' }, effects: [{ type: 'voice.megaphone', params: { drive: 0.3 } }, { type: 'space.echo', params: { delayMs: 180, repeats: 2, feedback: 0.35, amount: 0.35 } }, { type: 'space.reverb', params: { room: 'hall', decaySeconds: 2.5, amount: 0.3 } }] },
  { id: 'thoughts', name: { he: 'מחשבות', en: 'Inner thoughts' }, effects: [{ type: 'space.reverb', params: { room: 'room', decaySeconds: 0.8, amount: 0.4 } }, { type: 'utility.width', params: { stereoWidth: 0.6 } }] },
];

export const findAudioEffect = (id: string): AudioFxDef | undefined => AUDIO_EFFECTS.find((e) => e.id === id);
/** Parse with defaults; throws ZodError on bad params, Error on unknown type. */
export function audioEffectParams(type: string, params: unknown): AudioFxParams {
  const d = findAudioEffect(type);
  if (!d) throw new Error(`unknown audio effect ${type}`);
  return d.params.parse(params ?? {}) as AudioFxParams;
}
/** Canonical list order: stage, then registry order (stable). Ops keep lists in this order; the plan processes in it. */
export function sortAudioFx(list: readonly AudioFxInstance[]): AudioFxInstance[] {
  const rank = (t: string) => { const i = AUDIO_EFFECTS.findIndex((e) => e.id === t); return i < 0 ? 1e9 : AUDIO_EFFECTS[i]!.stage * 1000 + i; };
  return [...list].sort((a, b) => rank(a.type) - rank(b.type));
}
export function describeAudioCatalog() {
  return {
    audioEffects: AUDIO_EFFECTS.map((e) => ({ id: e.id, version: e.version, stage: e.stage, category: e.category, name: e.name, description: e.description, limits: e.limits, exclusive: e.exclusive ?? null, seeded: e.seeded, maxTailSeconds: e.maxTailSeconds,
      latency: e.aheadMs ? `none: reads up to ${e.aheadMs} ms ahead and compensates it, so the sound is not delayed (ADR-0010 D4)` : 'none (0 samples)', aheadMs: e.aheadMs ?? 0, implementation: 'shared TypeScript DSP (packages/engine/src/audiofx): the same code in preview, browser export and server export; only decoding differs', defaults: e.params.parse({}), paramsSchema: z.toJSONSchema(e.params) })),
    audioPresets: AUDIO_PRESETS.map((p) => ({ id: p.id, name: p.name, effects: p.effects.map((f) => ({ type: f.type, params: audioEffectParams(f.type, f.params ?? {}) })) })),
  };
}
