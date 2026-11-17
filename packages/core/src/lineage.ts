/**
 * Time lineage of derived assets (ADR-0017). A provider result that keeps the timing of its source (an enhanced copy of a video, a
 * cleaned-up copy of a sound, a smoother slow-motion copy) records `provenance.derived.sourceRangeStart`: where, on its source's own
 * clock, its own time zero lies. Following those links back reaches the asset whose transcript describes the speech, so captions,
 * ducking and the transcript panel keep working after a clip is given the derived copy (replace_clip_asset).
 * Also: staleness and reading speed of machine-translated language variants.
 */
import * as T from '@pulseframe/time';
import type { ProjectDocument, Transcript } from './schema.ts';
import { sha256Hex } from './sha256.ts';

/** Longest chain followed; deeper chains stop there (no project should come close). */
export const MAX_LINEAGE_DEPTH = 8;
export interface Lineage { rootAssetId: string; /** Root-asset time of this asset's time zero. */ offset: T.RationalTime; /** This asset first, then each time-preserving source up to the root. */ chain: string[] }

/**
 * Follows provenance.derived.sourceAssetIds[0] while derived.sourceRangeStart is present (max depth 8). Identity for non-derived assets.
 * A link to an asset that is no longer in the project ends the chain at the last asset that is.
 */
export function timeLineage(doc: ProjectDocument, assetId: string): Lineage {
  const chain = [assetId];
  let offset: T.RationalTime = T.ZERO;
  let cur = doc.assets[assetId];
  while (cur && chain.length <= MAX_LINEAGE_DEPTH) {
    const der = cur.provenance.derived;
    const parentId = der?.sourceAssetIds[0];
    if (!der?.sourceRangeStart || !parentId || !Object.hasOwn(doc.assets, parentId) || chain.includes(parentId)) break;
    offset = T.add(offset, der.sourceRangeStart);
    chain.push(parentId);
    cur = doc.assets[parentId];
  }
  return { rootAssetId: chain[chain.length - 1]!, offset, chain };
}

/**
 * Transcript of the root asset with the offset to subtract from its times; null when none. The nearest asset of the chain that has a
 * transcript wins (normally the root, where recognition ran; an asset transcribed itself uses its own, offset 0).
 */
export function transcriptFor(doc: ProjectDocument, assetId: string): { transcript: Transcript; offset: T.RationalTime } | null {
  const own = doc.transcripts?.[assetId];
  if (own && Object.hasOwn(doc.transcripts, assetId)) return { transcript: own, offset: T.ZERO };
  const lin = timeLineage(doc, assetId);
  let offset: T.RationalTime = T.ZERO;
  for (let i = 1; i < lin.chain.length; i++) {
    offset = T.add(offset, doc.assets[lin.chain[i - 1]!]!.provenance.derived!.sourceRangeStart!);
    const id = lin.chain[i]!;
    if (Object.hasOwn(doc.transcripts ?? {}, id)) return { transcript: doc.transcripts[id]!, offset };
  }
  return null;
}

/** The current master text of a translated id: a transcript phrase (segment id) or a manual caption cue (clip id); null when it no longer exists. */
export function masterTextOf(doc: ProjectDocument, id: string): string | null {
  for (const tr of Object.values(doc.transcripts ?? {})) for (const s of tr.segments) if (s.id === id) return s.text;
  for (const seq of Object.values(doc.sequences)) for (const t of seq.tracks) for (const c of t.clips) if (c.id === id && c.type === 'caption') return c.text;
  return null;
}

/** Segment/cue ids whose current master text hash differs from translation.sources (including ids whose phrase or cue is gone). */
export function staleTranslations(doc: ProjectDocument, variantId: string): string[] {
  const tr = doc.variants?.[variantId]?.translation;
  if (!tr) return [];
  return Object.entries(tr.sources).filter(([id, hash]) => { const text = masterTextOf(doc, id); return text === null || sha256Hex(text) !== hash; }).map(([id]) => id);
}

/** Characters a reader reads: letters, digits and punctuation, with each run of white space counted once and combining marks (niqqud, accents) not counted. */
export function readingLength(text: string): number {
  return [...text.normalize('NFC').trim().replace(/\s+/gu, ' ')].filter((ch) => !/\p{M}/u.test(ch)).length;
}
/**
 * Characters per second per phrase or cue of a language variant against a per-language limit (no universal 17 cps; SPEC §16).
 * The limit is looked up by the variant's language tag, then by its primary subtag (he-IL → he); no limit for the language = no issues.
 * Durations are the master's (phrase-timed): a phrase's own length in its source, a cue's length on the timeline.
 */
export function readingSpeedIssues(doc: ProjectDocument, variantId: string, limits: Record<string, number>): { id: string; cps: number; limit: number }[] {
  const v = doc.variants?.[variantId];
  const lang = v?.language ?? v?.translation?.to;
  if (!v || !lang) return [];
  const limit = limits[lang] ?? limits[lang.split('-')[0]!];
  if (!(limit !== undefined && limit > 0)) return [];
  const out: { id: string; cps: number; limit: number }[] = [];
  const check = (id: string, text: string, seconds: number) => {
    if (!(seconds > 0)) return;
    const cps = Math.round((readingLength(text) / seconds) * 10) / 10;
    if (cps > limit) out.push({ id, cps, limit });
  };
  const phrases = v.phraseText ?? {};
  for (const tr of Object.values(doc.transcripts ?? {})) for (const s of tr.segments) if (Object.hasOwn(phrases, s.id)) check(s.id, phrases[s.id]!, T.toSeconds(s.duration));
  for (const seq of Object.values(doc.sequences))
    for (const t of seq.tracks)
      for (const c of t.clips) {
        const text = c.type === 'caption' && Object.hasOwn(v.overrides, c.id) ? v.overrides[c.id]!.text : undefined;
        if (text !== undefined) check(c.id, text, T.toSeconds(c.duration));
      }
  return out;
}
