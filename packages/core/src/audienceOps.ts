/**
 * The three public operations of «גרסה לכל קהל» (wave 8 audiences; audienceContract.ts). Registered on import (index.ts). The lead
 * wrote names, versions, descriptions, argument schemas and the bodies (they are small and settled by the verifier). Each body
 * first refuses `notBuilt` while AUDIENCE_PROJECTION_BUILT is false (audience.ts, W1 sets it when applyAudience is built and called
 * from projectVariant): until then a version would project as the master while calling itself calm, which would be dishonest.
 * Refusals only through audienceRefusal(...), in the order AUDIENCE_REFUSALS lists for each op. Undo is the generic one (the variant
 * entity). All three are in ASSISTANT_EXCLUDED_OPS so the reviewed assistant prompt is unchanged; they stay on MCP and REST.
 */
import { z } from 'zod';
import { defineOp, findClip } from './ops.ts';
import type { ProjectDocument, Variant } from './schema.ts';
import { AUDIENCE_MUSIC_DB_MAX, AUDIENCE_MUSIC_DB_MIN, AUDIENCE_PROFILES, AUDIENCE_RULES_VERSION, audienceRefusal, KEEP_RULES, KEEPABLE, SOUND_ROLES, type AudienceProfile } from './audienceContract.ts';
import { AUDIENCE_PROJECTION_BUILT } from './audience.ts';

/** The name a new version gets when the caller gives none (the editor passes the name in the interface language). */
export const AUDIENCE_DEFAULT_NAMES: Readonly<Record<AudienceProfile, { he: string; en: string }>> = {
  calm: { he: 'גרסה רגועה', en: 'Calm version' },
  grandparents: { he: 'לסבא וסבתא', en: 'For grandparents' },
};

export const AddAudienceVersionArgsSchema = z.object({
  profile: z.enum(AUDIENCE_PROFILES),
  name: z.string().min(1).max(80).optional(),
}).strict();
export const UpdateAudienceVersionArgsSchema = z.object({
  variantId: z.string(),
  name: z.string().min(1).max(80).optional(),
  musicDb: z.number().int().min(AUDIENCE_MUSIC_DB_MIN).max(AUDIENCE_MUSIC_DB_MAX).nullable().optional().describe('integer dB relative to the rest of the mix; null returns to the profile\'s default (calm −6, grandparents −8)'),
  sound: z.object({ trackId: z.string(), role: z.enum(SOUND_ROLES).nullable() }).strict().optional().describe('correct the role of one sound track; role null returns it to the heuristic'),
}).strict();
export const SetAudienceKeepArgsSchema = z.object({
  variantId: z.string(),
  clipId: z.string(),
  rule: z.enum(KEEP_RULES),
  keep: z.boolean(),
}).strict();

const notBuilt = (op: string) => { if (!AUDIENCE_PROJECTION_BUILT) throw audienceRefusal('notBuilt', { op }, op); };
function mustAudience(d: ProjectDocument, variantId: string): Variant & { audience: NonNullable<Variant['audience']> } {
  const v = Object.hasOwn(d.variants, variantId) ? d.variants[variantId] : undefined;
  if (!v) throw audienceRefusal('notFound', { variantId }, variantId);
  if (!v.audience) throw audienceRefusal('notAudience', { variantId }, variantId);
  return v as Variant & { audience: NonNullable<Variant['audience']> };
}

defineOp({
  name: 'add_audience_version',
  version: 1,
  description: 'Add a version of the whole edit for an audience: profile calm («רגועה»: effects that flash, flicker or shake are turned off, transitions that flash or jolt become a soft dissolve, beat kicks and the jitter text loop go, the music is 6 dB lower relative to the rest of the mix) or grandparents («לסבא וסבתא»: the calm picture rules, titles and captions a third larger within limits, a caption box and the classic caption look, the music 8 dB lower, ducking that already exists 6 dB deeper). The version has the master frame and always follows the current master edit: the rules run on it every time. It never changes timing (fast cuts are listed, not changed), and it is not a medical safety claim. get_audience_changes lists what it changes.',
  args: AddAudienceVersionArgsSchema,
  apply(d, a, ctx) {
    notBuilt('add_audience_version');
    const v: Variant = {
      id: ctx.newId('var'), name: a.name ?? AUDIENCE_DEFAULT_NAMES[a.profile].en,
      width: d.settings.width, height: d.settings.height, fit: d.settings.fit ?? 'contain', profileId: null, safeArea: null, overrides: {},
      audience: { profile: a.profile, rules: AUDIENCE_RULES_VERSION },
    };
    d.variants[v.id] = v;
    return { affectedIds: [v.id], summary: `Added the version ${v.name} (${a.profile})`, output: { variantId: v.id } };
  },
});

defineOp({
  name: 'update_audience_version',
  version: 1,
  description: 'Change a version for an audience: its name, its music level (integer dB from −20 to 0, relative to the rest of the mix; null = the profile\'s default) or the role of one sound track (music, speech or other; null returns the track to the rule: music only when every clip on it is library, built-in or fitted music). Nobody here has listened to the result.',
  args: UpdateAudienceVersionArgsSchema,
  apply(d, a) {
    notBuilt('update_audience_version');
    const v = mustAudience(d, a.variantId);
    if (a.sound) {
      const track = Object.values(d.sequences).flatMap((s) => s.tracks).find((t) => t.id === a.sound!.trackId);
      if (!track) throw audienceRefusal('trackNotFound', { trackId: a.sound.trackId }, a.sound.trackId);
      if (track.kind !== 'audio') throw audienceRefusal('trackNotSound', { trackId: track.id }, track.id);
      const next = { ...(v.audience.sound ?? {}) };
      if (a.sound.role === null) delete next[track.id]; else next[track.id] = a.sound.role;
      if (Object.keys(next).length) v.audience.sound = next; else delete v.audience.sound;
    }
    if (a.musicDb === null) delete v.audience.musicDb; else if (a.musicDb !== undefined) v.audience.musicDb = a.musicDb;
    if (a.name !== undefined) v.name = a.name;
    return { affectedIds: [v.id], summary: `Updated the version ${v.name}` };
  },
});

defineOp({
  name: 'set_audience_keep',
  version: 1,
  description: 'In a version for an audience, keep one rule as in the master on one clip («להשאיר כמו במקור»), or give the change back (keep false). Rules: effect, modulator (beat kicks), transition, text_loop; title_size in a grandparents version. The rule keeps applying to every other clip, and to clips added later.',
  args: SetAudienceKeepArgsSchema,
  apply(d, a) {
    notBuilt('set_audience_keep');
    const v = mustAudience(d, a.variantId);
    if (!KEEPABLE[v.audience.profile].includes(a.rule)) throw audienceRefusal('notKeepable', { variantId: v.id, rule: a.rule, profile: v.audience.profile }, a.rule, v.audience.profile);
    const f = findClip(d, a.clipId);
    if (!f) throw audienceRefusal('clipNotFound', { clipId: a.clipId }, a.clipId);
    if (f.track.kind === 'audio') throw audienceRefusal('clipIsSound', { clipId: a.clipId }, a.clipId);
    const fits = a.rule === 'title_size' || a.rule === 'text_loop' ? f.clip.type === 'text' : a.rule === 'transition' ? f.clip.type === 'media' : true;
    if (!fits) throw audienceRefusal('ruleNotForClip', { clipId: a.clipId, rule: a.rule }, a.rule, a.clipId);
    const cur = v.overrides[a.clipId] ?? {};
    const set = new Set(cur.keep ?? []);
    if (a.keep) set.add(a.rule); else set.delete(a.rule);
    const keep = KEEP_RULES.filter((r) => set.has(r));
    const next = { ...cur };
    if (keep.length) next.keep = keep; else delete next.keep;
    if (Object.keys(next).length) v.overrides[a.clipId] = next; else delete v.overrides[a.clipId];
    return { affectedIds: [v.id], summary: `Version ${v.name}: ${a.rule} ${a.keep ? 'kept as in the master' : 'applied again'} on a clip`, output: { keep } };
  },
});
