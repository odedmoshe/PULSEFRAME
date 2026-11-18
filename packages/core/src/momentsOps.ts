/**
 * The internal operation attach_moments (wave 5 family film, ADR-0026): the moments job (apps/server/src/moments.ts) attaches
 * the measured candidate moments of every file it measured in ONE op, so one measurement is ONE revision and ONE undo entry.
 * Registered on import of this module (index.ts exports it). Undo is the generic one: affectedIds are the analysis entities, so
 * the store restores each analysis exactly (entities.ts analysisEntityId).
 *
 * - Each item REPLACES the file's earlier moments record whole; the file's scene and beat analyses are kept.
 * - Ids are looked up with an own-property test, so an id that names an Object.prototype member finds nothing.
 * - Every refusal has a fixed English sentence in MOMENTS_REFUSALS; the Hebrew wording is in packages/i18n/src/familyFilm.ts
 *   (HE_FAMILY_FILM) and packages/evals/src/family-film-wording.test.ts keeps the two in step and provokes each refusal for real.
 */
import { defineOp, OpError, type OpErrorCode } from './ops.ts';
import { analysisEntityId } from './entities.ts';
import { AttachMomentsArgsSchema, momentsProblem } from './momentsContract.ts';

interface Refusal<A extends unknown[]> { code: OpErrorCode; message: (...a: A) => string; hint?: string }
const refusal = <A extends unknown[]>(code: OpErrorCode, message: (...a: A) => string, hint?: string): Refusal<A> => ({ code, message, ...(hint ? { hint } : {}) });
/** Every refusal of attach_moments. The messages are fixed: the Hebrew table recognises them by their shape. */
export const MOMENTS_REFUSALS = {
  assetMissing: refusal('not_found', (assetId: string) => `asset ${assetId} not found`, 'get_summary lists the library files.'),
  noVideo: refusal('incompatible', (assetId: string) => `asset ${assetId} has no moving picture, so it has no moments to measure`, 'Moments are measured for video files only; a still is shown whole.'),
  twice: refusal('invalid_args', (assetId: string) => `asset ${assetId} is listed twice`, 'List each file once.'),
  badWindow: refusal('out_of_bounds', (assetId: string, why: string) => `the moments of asset ${assetId} do not fit the file: ${why}`, 'This is a fault of the measurement, not of the project; nothing was attached.'),
} as const;
export type MomentsRefusalKey = keyof typeof MOMENTS_REFUSALS;
export function momentsRefusal<K extends MomentsRefusalKey>(key: K, details: Record<string, unknown> = {}, ...args: Parameters<(typeof MOMENTS_REFUSALS)[K]['message']>): OpError {
  const r = MOMENTS_REFUSALS[key] as Refusal<unknown[]>;
  return new OpError(r.code, r.message(...args), details, r.hint);
}

/** attach_moments OpResult.output. */
export interface AttachMomentsOutput { assetIds: string[] }

defineOp({
  name: 'attach_moments',
  version: 1,
  internal: true,
  checksOwnIds: ['assetId'],
  description: 'Attach measured candidate moments of video files (the moments job; model-free, heuristic). Replaces earlier moments of the same files; their scene and beat analyses are kept.',
  args: AttachMomentsArgsSchema,
  apply(d, a, ctx) {
    const seen = new Set<string>();
    for (const item of a.items) {
      if (seen.has(item.assetId)) throw momentsRefusal('twice', { assetId: item.assetId }, item.assetId);
      seen.add(item.assetId);
      const asset = Object.hasOwn(d.assets, item.assetId) ? d.assets[item.assetId] : undefined;
      if (!asset) throw momentsRefusal('assetMissing', { assetId: item.assetId }, item.assetId);
      if (!asset.video || asset.kind === 'image') throw momentsRefusal('noVideo', { assetId: asset.id }, asset.id);
      const why = momentsProblem(asset, item);
      if (why) throw momentsRefusal('badWindow', { assetId: asset.id }, asset.id, why);
    }
    for (const item of a.items) {
      const cur = Object.hasOwn(d.analyses, item.assetId) ? d.analyses[item.assetId]! : { assetId: item.assetId };
      d.analyses[item.assetId] = {
        ...cur,
        moments: {
          origin: { method: a.method, params: { algo: item.algo }, createdAt: a.createdAt, createdBy: ctx.actor, edited: false },
          algo: item.algo, data: item.data, measured: { ...item.measured }, file: { ...item.file }, flat: item.flat,
          windows: item.windows.map((w) => ({ ...w, basis: [...w.basis] })), ...(item.truncated ? { truncated: true as const } : {}),
        },
      };
    }
    const assetIds = a.items.map((i) => i.assetId);
    const output: AttachMomentsOutput = { assetIds };
    return { affectedIds: assetIds.map(analysisEntityId), summary: `Measured moments of ${assetIds.length} file(s)`, output: output as unknown as Record<string, unknown> };
  },
});
