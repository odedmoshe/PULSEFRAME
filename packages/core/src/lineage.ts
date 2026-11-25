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
import { own } from './own.ts';

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
  let cur = own(doc.assets, assetId); // the id may come from a caller: an inherited name starts no chain
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

/**
 * How an asset's own clock relates to the clock of `anchorId` (a transcribed or measured recording), for edits driven by the anchor's
 * times (delete_transcript_range, filler and silence cuts, split_at_scenes):
 * - 'same': the asset is the anchor or shares its time lineage root (a time-preserving copy of it, the recording a time-preserving copy
 *   was made from, or a sibling copy). Moment t of the anchor is moment t + delta of the asset, exactly (rational times).
 * - 'untimed': a moving picture or sound made from the anchor's recording (directly or through other copies, along any of its sources)
 *   by a derivation that records no time mapping (no sourceRangeStart: reversed, stretched or generated). Where the anchor's moments
 *   lie in it is unknown, so an edit by the anchor's times must refuse rather than guess.
 * - null: unrelated, or a still picture (a still has no time).
 * Same-asset copies (a conformed file, an editing proxy) keep the asset's id, so they are the anchor itself.
 */
export type TimingRelation = { kind: 'same'; delta: T.RationalTime } | { kind: 'untimed'; viaAssetId: string };
export function timingRelations(doc: ProjectDocument, anchorId: string): (assetId: string) => TimingRelation | null {
  const anchor = timeLineage(doc, anchorId);
  const rootOf = new Map<string, Lineage>();
  const lineage = (id: string) => { let l = rootOf.get(id); if (!l) { l = timeLineage(doc, id); rootOf.set(id, l); } return l; };
  const memo = new Map<string, TimingRelation | null>();
  return (assetId) => {
    if (memo.has(assetId)) return memo.get(assetId)!;
    let out: TimingRelation | null = null;
    const asset = Object.hasOwn(doc.assets, assetId) ? doc.assets[assetId] : undefined;
    const lin = lineage(assetId);
    if (lin.rootAssetId === anchor.rootAssetId) out = { kind: 'same', delta: T.sub(anchor.offset, lin.offset) };
    else if (asset && asset.kind !== 'image' && (asset.video || asset.audio)) {
      // walk every source link up from the asset (breadth first, bounded): reaching the anchor's lineage means it was made from that recording
      const seen = new Set([assetId]);
      let level = [asset], depth = 0;
      while (!out && level.length && depth++ < MAX_LINEAGE_DEPTH) {
        const next: typeof level = [];
        for (const a of level)
          for (const id of a.provenance.derived?.sourceAssetIds ?? []) {
            if (seen.has(id) || !Object.hasOwn(doc.assets, id)) continue;
            seen.add(id);
            if (lineage(id).rootAssetId === anchor.rootAssetId) { out = { kind: 'untimed', viaAssetId: id }; break; }
            next.push(doc.assets[id]!);
          }
        level = next;
      }
    }
    memo.set(assetId, out);
    return out;
  };
}

/**
 * What `pick` finds for an asset, or for the nearest time-preserving source of it (the asset itself first, then up its chain, as
 * transcriptFor), with the offset to subtract from that source's times to get this asset's own. null when nothing of the chain has it.
 */
function nearestInChain<V>(doc: ProjectDocument, assetId: string, pick: (id: string) => V | undefined): { value: V; offset: T.RationalTime; assetId: string } | null {
  const lin = timeLineage(doc, assetId);
  let offset: T.RationalTime = T.ZERO;
  for (let i = 0; i < lin.chain.length; i++) {
    const id = lin.chain[i]!;
    if (i > 0) offset = T.add(offset, doc.assets[lin.chain[i - 1]!]!.provenance.derived!.sourceRangeStart!);
    const value = pick(id);
    if (value !== undefined) return { value, offset, assetId: id };
  }
  return null;
}
const analysisOf = (doc: ProjectDocument, id: string) => (Object.hasOwn(doc.analyses ?? {}, id) ? doc.analyses[id] : undefined);

/**
 * Scene cuts of an asset, or of the nearest time-preserving source of it that was analysed (as transcriptFor), with the offset to
 * subtract from them to get this asset's own times. null when none of the chain has scene analysis.
 */
export function sceneCutsFor(doc: ProjectDocument, assetId: string): { cuts: T.RationalTime[]; offset: T.RationalTime; assetId: string } | null {
  const found = nearestInChain(doc, assetId, (id) => analysisOf(doc, id)?.scenes?.cuts);
  return found ? { cuts: found.value, offset: found.offset, assetId: found.assetId } : null;
}

export type BeatAnalysis = NonNullable<ProjectDocument['analyses'][string]['beats']>;
/**
 * The beat analysis of an asset, or of the nearest time-preserving source of it whose beats were measured (as sceneCutsFor: a
 * cleaned-up or re-encoded copy of a piece of music keeps its beats), with the offset to subtract from its beat and bar times to get
 * this asset's own. null when none of the chain has one; a copy made without a recorded time mapping never takes its source's.
 */
export function beatsFor(doc: ProjectDocument, assetId: string): { beats: BeatAnalysis; offset: T.RationalTime; assetId: string } | null {
  const found = nearestInChain(doc, assetId, (id) => analysisOf(doc, id)?.beats);
  return found ? { beats: found.value, offset: found.offset, assetId: found.assetId } : null;
}

/**
 * For surfaces that read each clip's own nearest transcript or analysis (the pacing report, the beat montage): whether an asset
 * that has none is an UNTIMED copy of one of the transcribed or measured recordings `anchorIds` (timingRelations 'untimed'), so
 * that leaving it out can be said by name. Answers the first such recording, or null.
 */
export function untimedCopyFinder(doc: ProjectDocument, anchorIds: readonly string[]): (assetId: string) => { anchorId: string; viaAssetId: string } | null {
  const rels = new Map<string, ReturnType<typeof timingRelations>>();
  const memo = new Map<string, { anchorId: string; viaAssetId: string } | null>();
  return (assetId) => {
    if (memo.has(assetId)) return memo.get(assetId)!;
    let out: { anchorId: string; viaAssetId: string } | null = null;
    for (const anchorId of anchorIds) {
      let rel = rels.get(anchorId);
      if (!rel) { rel = timingRelations(doc, anchorId); rels.set(anchorId, rel); }
      const r = rel(assetId);
      if (r?.kind === 'untimed') { out = { anchorId, viaAssetId: r.viaAssetId }; break; }
    }
    memo.set(assetId, out);
    return out;
  };
}

/** The current master text of a translated id: a transcript phrase (segment id) or a manual caption cue (clip id); null when it no longer exists. */
export function masterTextOf(doc: ProjectDocument, id: string): string | null {
  for (const tr of Object.values(doc.transcripts ?? {})) for (const s of tr.segments) if (s.id === id) return s.text;
  for (const seq of Object.values(doc.sequences)) for (const t of seq.tracks) for (const c of t.clips) if (c.id === id && c.type === 'caption') return c.text;
  return null;
}

/** Segment/cue ids whose current master text hash differs from translation.sources (including ids whose phrase or cue is gone). */
export function staleTranslations(doc: ProjectDocument, variantId: string): string[] {
  const tr = own(doc.variants, variantId)?.translation;
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
  const v = own(doc.variants, variantId);
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
