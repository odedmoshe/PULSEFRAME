/**
 * The internal operation attach_footage_notes (wave 8 `understand`; plan §3.2, verify C7). LEAD-BUILT, complete: modelled line by
 * line on attach_moments (momentsOps.ts). The describe job attaches the notes pointers of every file it finished in ONE op, so one job
 * pass is ONE revision and ONE undo entry («ביטול התיאורים» undoes it by transaction id, C7). Registered on import of this module.
 *
 * - Each item REPLACES the asset's earlier `notes` pointer; its scenes, beats, moments and camera motion are kept.
 * - Undo is the generic one: affectedIds are the analysis entities (entities.ts analysisEntityId), restored exactly; refused with
 *   undo_conflict by the store when someone changed that asset's analysis afterwards (store.ts conflict check per entity).
 * - Ids are looked up with an own-property test, so an id that names an Object.prototype member finds nothing.
 * - Every refusal has a fixed English sentence in UNDERSTAND_OP_REFUSALS; the Hebrew is in packages/i18n/src/understand.ts
 *   (HE_UNDERSTAND) and packages/evals/src/understand-wording.test.ts provokes each through the op.
 */
import { defineOp, OpError, type OpErrorCode } from './ops.ts';
import { analysisEntityId } from './entities.ts';
import { AttachFootageNotesArgsSchema } from './understandContract.ts';

interface Refusal<A extends unknown[]> { code: OpErrorCode; message: (...a: A) => string; hint?: string }
const refusal = <A extends unknown[]>(code: OpErrorCode, message: (...a: A) => string, hint?: string): Refusal<A> => ({ code, message, ...(hint ? { hint } : {}) });
/** Every refusal of attach_footage_notes. The messages are fixed: the Hebrew table recognises them by their shape. */
export const UNDERSTAND_OP_REFUSALS = {
  assetMissing: refusal('not_found', (assetId: string) => `asset ${assetId} not found`, 'get_summary lists the library files.'),
  noPicture: refusal('incompatible', (assetId: string) => `asset ${assetId} has no picture to describe`, 'Notes are made for videos and photos.'),
  twice: refusal('invalid_args', (assetId: string) => `asset ${assetId} is listed twice`, 'List each file once.'),
  badCounts: refusal('out_of_bounds', (assetId: string, why: string) => `the notes of asset ${assetId} do not fit the file: ${why}`, 'This is a fault of the describe job, not of the project; nothing was attached.'),
} as const;
export type UnderstandOpRefusalKey = keyof typeof UNDERSTAND_OP_REFUSALS;
export function understandOpRefusal<K extends UnderstandOpRefusalKey>(key: K, details: Record<string, unknown> = {}, ...args: Parameters<(typeof UNDERSTAND_OP_REFUSALS)[K]['message']>): OpError {
  const r = UNDERSTAND_OP_REFUSALS[key] as Refusal<unknown[]>;
  return new OpError(r.code, r.message(...args), details, r.hint);
}

/** attach_footage_notes OpResult.output. */
export interface AttachFootageNotesOutput { assetIds: string[] }

defineOp({
  name: 'attach_footage_notes',
  version: 1,
  internal: true,
  checksOwnIds: ['assetId'],
  description: 'Point the project at the footage notes the describe job stored for these files (what is seen, on-screen text; written by a model, not checked). Replaces earlier notes pointers of the same files; their scene, beat, moments and camera analyses are kept.',
  args: AttachFootageNotesArgsSchema,
  apply(d, a, ctx) {
    const seen = new Set<string>();
    for (const item of a.items) {
      if (seen.has(item.assetId)) throw understandOpRefusal('twice', { assetId: item.assetId }, item.assetId);
      seen.add(item.assetId);
      const asset = Object.hasOwn(d.assets, item.assetId) ? d.assets[item.assetId] : undefined;
      if (!asset) throw understandOpRefusal('assetMissing', { assetId: item.assetId }, item.assetId);
      if (!(asset.kind === 'image' || (asset.kind === 'video' && asset.video))) throw understandOpRefusal('noPicture', { assetId: asset.id }, asset.id);
      if (item.described + item.failed !== item.spans) throw understandOpRefusal('badCounts', { assetId: asset.id }, asset.id, `${item.described} described and ${item.failed} failed are not ${item.spans} spans`);
      if (asset.kind === 'image' && item.spans !== 1) throw understandOpRefusal('badCounts', { assetId: asset.id }, asset.id, `a photo has one span, not ${item.spans}`);
    }
    for (const item of a.items) {
      const cur = Object.hasOwn(d.analyses, item.assetId) ? d.analyses[item.assetId]! : { assetId: item.assetId };
      d.analyses[item.assetId] = {
        ...cur,
        notes: {
          origin: { method: a.method, params: { producer: item.producer }, createdAt: a.createdAt, createdBy: ctx.actor, edited: false },
          producer: item.producer, model: item.model, data: item.data, spans: item.spans, described: item.described, failed: item.failed,
          ...(item.truncated ? { truncated: true as const } : {}),
        },
      };
    }
    const assetIds = a.items.map((i) => i.assetId);
    const output: AttachFootageNotesOutput = { assetIds };
    return { affectedIds: assetIds.map(analysisEntityId), summary: `Attached footage notes of ${assetIds.length} file(s)`, output: output as unknown as Record<string, unknown> };
  },
});
