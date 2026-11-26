/**
 * THE PICTURE-MAP CONTRACT — one contract for every consumer of a model-made map (wave 8 picmodels; picmodels-verify.md §0 table, last
 * column, with C1–C5 and C15; decisions.md "Batch C … picmodels"). TYPES AND CONSTANTS ONLY.
 *
 * NOTHING SERVES, MAKES OR STORES A MAP IN THIS WAVE. There is no map job, no map store, no map route body, no PFMAP file and no
 * Depth Anything 3 or SAM 2 Python; the route strings below are NOT registered. They move to the laptop wave as one track with their
 * consumers (living «תמונה חיה» depth, behind «מאחורי הדמות» matte), which cite this file instead of writing their own format, key or
 * route. Living and behind version 1 ship hand-made defaults and do not read anything of this file at run time.
 *
 * THE RULES THE LAPTOP WAVE BUILDS (each a sentence of the verifier's table):
 * - Unit. depth: stills only. matte: a still, or a range of at most PICTURE_MAP_LIMITS.matteFrames frames in the motion-track frame
 *   numbering (frameSource(…, 'original'), apps/server/src/tracking.ts).
 * - Values. depth: u16 NEARNESS, the 1st percentile → 0 and the 99th → 65535, clipped, near = large (one outlier pixel cannot flatten
 *   the map). matte: u8 coverage 0..255 (0 / 255 with an edge in between), NOT premultiplied.
 * - Size. Shown orientation (EXIF applied), long side min(source, PICTURE_MAP_LIMITS.longSide) for both kinds; the runtime resizes
 *   the model's output as floats, before quantising.
 * - Wire. ONE PLANE PER REQUEST: the zlib-deflate stream of the raw plane (u8, or u16 little-endian), headers x-pf-width, x-pf-height,
 *   x-pf-bits, x-pf-frame; NO Content-Encoding. Inflated with DecompressionStream('deflate') in the browser and zlib in Node.
 * - At rest. One store, PICTURE_MAP_STORE_DIR under the data directory, OUTSIDE pulseframe.sqlite and blobs/ (the search-index
 *   precedent): never in a backup, never in an archive, never listed by the derivatives route. One file per map: a header and per-plane
 *   offsets and SHA-256.
 * - Identity in the document. The document records the map's CONTENT ID (PictureMapRef.mapId = sha256 of the canonical header and the
 *   plane digests), NEVER the cache key. The cache key (content hash, kind, model, pins, worker digest, package versions, device,
 *   request) is a unique column of the store, used only to answer "already made?" (C4): a re-pinned worker or a CPU→CUDA switch must
 *   not orphan a stored document.
 * - Bytes. Two route families: the owner's own session (403 owner_required before anything is read), and the render token for the ids
 *   that the token's snapshot document names (the /render/:token/… routes sit before the /api/v1 authentication middleware, C2).
 *   Agents get states and numbers only; pixels only through render_frame.
 * - Missing. One FrameProvider.pictureMap?({ mapId, frame }); null puts the clip in `missing` with reason
 *   `picture_map_missing:<kind>`. Preview: a notice; still and export: refused (existing rule), blocker PICTURE_MAP_MISSING_CODE.
 * - Attach. The runtime calls an attach function the consumer registers, in the job's own revision, stale-protected (ADR-0007); a
 *   stale result is kept as a proposal (C5).
 * - Lifetime. Purged on assets-gone, project delete, garbage collection and owner forget; NEVER on reference loss (undo and redo
 *   must find the bytes).
 * - Validation (C15). matte: every positive click lands on coverage ≥ 128 and every negative one on < 128 (else
 *   matte_missed_click), and the matte is not empty (matte_empty). depth: p99 − p1 > 0 before quantising (else map_constant).
 *   No non-finite value (counted in Python before quantising).
 */

export const PICTURE_MAP_KINDS = ['depth', 'matte'] as const;
export type PictureMapKind = (typeof PICTURE_MAP_KINDS)[number];
export const PICTURE_MAP_LIMITS = { longSide: 1024, matteFrames: 300, depthStillsOnly: true } as const;
/** The bits of a plane of each kind. */
export const PICTURE_MAP_BITS: Readonly<Record<PictureMapKind, 8 | 16>> = { depth: 16, matte: 8 };
/** The folder under the data directory (never in a backup or an archive; backup.ts copies named files and folders only). */
export const PICTURE_MAP_STORE_DIR = 'picmodels';
/** The response headers of one plane (lowercase, as Node and fetch give them). */
export const PICTURE_MAP_HEADERS = { width: 'x-pf-width', height: 'x-pf-height', bits: 'x-pf-bits', frame: 'x-pf-frame' } as const;
/** The two route families of the laptop wave (NOT registered in this wave; listed so that nobody invents a third). */
export const PICTURE_MAP_ROUTES_LATER = {
  owner: 'GET /api/v1/projects/:id/picture-maps/:mapId/planes/:k',
  render: 'GET /api/v1/render/:token/picture-maps/:mapId/planes/:k',
} as const;
/** The export blocker and the compositor's missing reason. */
export const PICTURE_MAP_MISSING_CODE = 'picture_map_missing' as const;
export const pictureMapMissingReason = (kind: PictureMapKind): string => `${PICTURE_MAP_MISSING_CODE}:${kind}`;
/** The job failures of the laptop wave's validation (C15). */
export const PICTURE_MAP_FAILURES = ['map_invalid', 'map_constant', 'matte_missed_click', 'matte_empty'] as const;
export type PictureMapFailure = (typeof PICTURE_MAP_FAILURES)[number];
/** The consumers that may register an attach function. */
export const PICTURE_MAP_CONSUMERS = ['living', 'behind'] as const;
export type PictureMapConsumer = (typeof PICTURE_MAP_CONSUMERS)[number];

/** What a document holds of a map: its content id only (never the cache key). */
export interface PictureMapRef { kind: PictureMapKind; mapId: string }
/** The canonical header of a stored map, from which (with the plane digests) the content id is computed. */
export interface PictureMapHeader {
  kind: PictureMapKind; bits: 8 | 16; width: number; height: number;
  /** a still: [0]; a matte range: the source frame numbers, ascending */
  frames: number[];
  modelId: string;
  /** SHA-256 of each raw (inflated) plane, in frame order */
  planeSha256: string[];
}
/** One plane as the bytes route gives it. */
export interface PictureMapPlane { width: number; height: number; bits: 8 | 16; frame: number; /** zlib-deflate of the raw plane */ deflated: Uint8Array }
/** The parts of the runtime's cache key ("already made?"); never written into a document. */
export interface PictureMapCacheKeyParts {
  contentHash: string; kind: PictureMapKind; modelId: string; pins: string[]; worker: string;
  runtime: { packages: Record<string, string>; device: 'cpu' | 'cuda'; dtype: string };
  input: { longSide: number; frames: number[]; prompt: unknown };
}
/** The FrameProvider member the compositor asks (laptop wave); null = the clip is missing with pictureMapMissingReason(kind). */
export type PictureMapProvider = (q: { mapId: string; frame: number }) => PictureMapPlane | null;
/** What a consumer registers: commit the result in the job's own revision (stale-protected); a stale result becomes a proposal. */
export interface PictureMapAttach { consumer: PictureMapConsumer; clipId: string; assetId: string; contentHash: string }
