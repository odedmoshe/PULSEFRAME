/**
 * Pearls in this browser (wave 7 pearls track; proof check P15): window.__pfPearlsHash(docs) runs core rangeUsage + screenTime (of
 * every sequence, by id order) over the fuzzed documents the proof passes in and returns a digest per document and one over all,
 * which must equal Node's (`pearlsDigest` is the same function; the proof calls it in Node). Digest = core fingerprint() of the
 * canonical form: exact rationals, no float. Until core's functions are built the hook throws SourceRangesNotBuilt, so the proof
 * reports the check as blocked, never as passed.
 */
import { fingerprint, pearlsDigest as coreDigest, rangeUsage, screenTime, type ProjectDocument } from '@pulseframe/core';

/** `core` is core's pearlsDigest of the same documents (the integration run compares it with Node's for pearlsDeterminismDocs()). */
export interface PearlsDigest { hash: string; perDoc: string[]; core: string }
/** The digest of usage and screen time over documents; the same code runs in Node and in the browser. */
export function pearlsDigest(docs: readonly ProjectDocument[]): PearlsDigest {
  const perDoc = docs.map((doc) => {
    const usage = rangeUsage(doc);
    const screen = Object.keys(doc.sequences).sort().map((id) => screenTime(doc, id));
    return fingerprint({ usage, screen });
  });
  return { hash: fingerprint(perDoc), perDoc, core: coreDigest(docs) };
}
if (typeof window !== 'undefined') (window as unknown as { __pfPearlsHash: typeof pearlsDigest }).__pfPearlsHash = pearlsDigest;
