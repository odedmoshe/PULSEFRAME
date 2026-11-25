/**
 * TEST DOUBLES (labelled) of builder A's core functions (packages/core/src/footageSearch.ts), for builder B's server tests while A is not
 * merged (those functions throw FootageSearchNotBuilt until then). They are deliberately small and NOT the product's search: name and
 * (owner only) pearl-label / tagged-person substring matching, the exact sampling formula k_s = ceil(s·rate), the written-out int8
 * quantisation, an integer dot product and a crude merge of frames into padded spans. Tests use the core functions themselves as soon
 * as FOOTAGE_SEARCH_BUILT is true (testCore() below).
 */
import * as T from '@pulseframe/time';
import { FOOTAGE_LIMITS, FOOTAGE_SEARCH_BUILT, type Moment, type ProjectDocument } from '@pulseframe/core';
import { CORE, type FootageCore } from '../answer.ts';

export const CORE_DOUBLES: FootageCore = {
  searchFootage(doc, query, opts) {
    const tokens = query.toLowerCase().split(/\s+/u).filter(Boolean);
    const out: Moment[] = [];
    for (const a of Object.values(doc.assets).sort((x, y) => (x.id < y.id ? -1 : 1))) if (tokens.every((t) => a.name.toLowerCase().includes(t))) out.push({ assetId: a.id, start: null, end: null, sources: ['name'] });
    if (opts.reader === 'owner') {
      for (const r of Object.values(doc.sourceRanges ?? {})) {
        const names = (r.people ?? []).map((p) => doc.people?.[p]?.name ?? '').join(' ').toLowerCase();
        const label = r.label.toLowerCase();
        const pearl = tokens.every((t) => label.includes(t)), person = tokens.every((t) => names.includes(t));
        if (pearl || person) out.push({ assetId: r.assetId, start: r.span?.start ?? null, end: r.span?.end ?? null, sources: pearl ? ['pearl'] : ['person'], ...(pearl ? { snippet: r.label } : {}) });
      }
    }
    return out.slice(0, opts.limit ?? FOOTAGE_LIMITS.defaultResults);
  },
  sampleFrameTargets(rate, frameCount) {
    const out: number[] = [];
    for (let s = 0; ; s++) { const k = Math.floor((s * rate.num + rate.den - 1) / rate.den); if (k >= frameCount) break; out.push(k); }
    return out;
  },
  quantiseInt8(v) {
    let max = 0;
    for (const x of v) max = Math.max(max, Math.abs(x));
    const scale = max / 127 || 1;
    const q = new Int8Array(v.length);
    for (let i = 0; i < v.length; i++) { const y = v[i]! / scale; q[i] = y < 0 ? -Math.floor(-y + 0.5) : Math.floor(y + 0.5); }
    return { scale, q };
  },
  int8Dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!; return s; },
  mergePictureHits(doc: ProjectDocument, hits, _rate, limit) {
    const byAsset = new Map<string, { frame: number; relevance: number }[]>();
    for (const h of hits) { const l = byAsset.get(h.assetId) ?? []; l.push(h); byAsset.set(h.assetId, l); }
    const res: (Moment & { best: number })[] = [];
    for (const [assetId, list] of byAsset) {
      const rate = doc.assets[assetId]!.video!.frameRate;
      const frames = list.sort((x, y) => x.frame - y.frame);
      let group: typeof frames = [];
      const flush = () => {
        if (!group.length) return;
        const best = group.reduce((m, h) => (h.relevance > m.relevance ? h : m));
        const pad = Math.round((FOOTAGE_LIMITS.padSeconds * rate.num) / rate.den);
        res.push({ assetId, start: T.frameTime(Math.max(0, group[0]!.frame - pad), rate), end: T.frameTime(group.at(-1)!.frame + pad, rate), sources: ['picture'], frame: best.frame, best: best.relevance });
        group = [];
      };
      const gap = (FOOTAGE_LIMITS.mergeGapSeconds * rate.num) / rate.den;
      for (const h of frames) { if (group.length && h.frame - group.at(-1)!.frame > gap) flush(); group.push(h); }
      flush();
    }
    return res.sort((x, y) => y.best - x.best).slice(0, limit).map(({ best: _b, ...m }) => m);
  },
};

/** The real core once builder A is merged; until then the labelled doubles. */
export const testCore = (): FootageCore => (FOOTAGE_SEARCH_BUILT ? CORE : CORE_DOUBLES);
export const CORE_LABEL = FOOTAGE_SEARCH_BUILT ? 'core (builder A)' : 'TEST DOUBLES of the core functions (builder A not merged)';
