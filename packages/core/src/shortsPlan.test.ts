/**
 * planShorts (ADR-0018, plan §4.4): seeded property tests, 200 cases per frame rate (24, 25, 30000/1001, 30, 50, 60). Each
 * plan is applied as ONE apply_sequence_plan, and the made shorts are checked in the document with exact rational
 * comparisons: kept words inside the pieces, whole-frame starts and durations, outward slack under a frame, picture cuts at
 * least flashGapFrames apart, 1/100 s fades at removal joins only, pieces split at source scene cuts, the op cap, caption
 * margins above the safe area. Plus snapping ('words', 'exact', phrases), titles and the measured origin.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, BuildShortsBodySchema, createProject, findFillers, flashGapFrames, placed, planShorts, SHORTS_PICK_METHOD, ShortsError, sequenceDuration, sourceFrameIndexAt, startOffsetFrames, validateProject,
  type ApplySequencePlanOutput, type AudioFeatures, type MediaClip, type OpCall, type ProjectDocument, type ShortCandidate, type ShortsPlanContext,
} from './index.ts';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const RATES = [{ num: 24, den: 1 }, { num: 25, den: 1 }, { num: 30000, den: 1001 }, { num: 30, den: 1 }, { num: 50, den: 1 }, { num: 60, den: 1 }];
const SRC = { num: 30, den: 1 };
const ms = (n: number) => T.rt(Math.round(n), 1000);
const prov = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' };
const VIDEO = { kind: 'video' as const, name: 'talk.mp4', contentHash: `sha256:${'9'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(120, 1), video: { width: 1920, height: 1080, frameRate: SRC, codec: 'h264', rotation: 0, frameCount: 3600 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };
const VOCAB = ['אז', 'כמו', 'שאמרתי', 'צה״ל', 'זה', 'הבית', 'שלנו', 'מה', 'דעתכם', 'היום', 'נדבר', 'על', '3.5', 'מיליון', 'אנשים'];
const ctx0: ShortsPlanContext = { createdAt: '2026-11-18T00:00:00Z', candidates: new Map(), features: new Map() };
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `sp${n++}_`, actor: 'test', allowInternal: true });

/** A 2-minute talk: word-timed phrases with short gaps, some long pauses and «אממ» fillers, and scene cuts ≥ 1.5 s apart. */
function talk(seed: number, rate: { num: number; den: number }, o: { approximate?: boolean; scenes?: boolean } = {}) {
  const rnd = mulberry32(seed);
  let doc = tx(createProject({ id: 'prj_sp', name: 'SP', width: 1920, height: 1080, frameRate: rate }), [{ op: 'import_asset', args: { asset: VIDEO } }]).doc;
  const asset = Object.keys(doc.assets)[0]!;
  const segments: { start: T.RationalTime; duration: T.RationalTime; text: string; words: { start: T.RationalTime; duration: T.RationalTime; text: string }[]; approximate?: boolean }[] = [];
  let t = 400;
  while (t < 117_000) {
    const words: { start: T.RationalTime; duration: T.RationalTime; text: string }[] = [];
    const count = 3 + Math.floor(rnd() * 9);
    const segStart = t;
    for (let k = 0; k < count && t < 117_000; k++) {
      const d = 150 + Math.floor(rnd() * 450);
      words.push({ start: ms(t), duration: ms(d), text: rnd() < 0.08 ? 'אממ' : VOCAB[Math.floor(rnd() * VOCAB.length)]! });
      t += d + (rnd() < 0.12 ? 400 + Math.floor(rnd() * 1600) : 20 + Math.floor(rnd() * 230));
    }
    if (!words.length) break;
    const last = words.at(-1)!;
    segments.push({ start: words[0]!.start, duration: T.sub(T.add(last.start, last.duration), ms(segStart)), text: words.map((w) => w.text).join(' '), words, ...(o.approximate && rnd() < 0.3 ? { approximate: true } : {}) });
    t += 100 + Math.floor(rnd() * 600);
  }
  const ops: OpCall[] = [{ op: 'set_transcript', args: { assetId: asset, language: 'he', segments } }];
  const cuts: T.RationalTime[] = [];
  if (o.scenes !== false) {
    let f = 30 + Math.floor(rnd() * 60);
    while (f < 3550) { cuts.push(T.frameTime(f, SRC)); f += 45 + Math.floor(rnd() * 200); }
    ops.push({ op: 'edit_analysis', args: { assetId: asset, kind: 'scenes', add: cuts } });
  }
  doc = tx(doc, ops).doc;
  return { doc, asset, cuts, rnd };
}

/** The made short's pictures (foreground track), its sound clips and its caption track, from the document. */
function shortOf(doc: ProjectDocument, seqId: string) {
  const seq = doc.sequences[seqId]!;
  const videos = seq.tracks.filter((t) => t.kind === 'video');
  const fg = videos.at(-1)!; // the backdrop puts the foreground on V2
  const pieces = fg.clips as MediaClip[];
  const sounds = seq.tracks.filter((t) => t.kind === 'audio').flatMap((t) => t.clips) as MediaClip[];
  return { seq, pieces, sounds, captions: seq.tracks.find((t) => t.kind === 'caption') };
}

describe('planShorts: seeded property tests at six frame rates', () => {
  for (const rate of RATES) {
    it(`200 cases at ${rate.num}/${rate.den} fps`, () => {
      const fps = rate.num / rate.den, gap = flashGapFrames(fps), one = T.frameTime(1, rate);
      const fail: string[] = [];
      let tooLarge = 0, removedSome = 0, split = 0;
      const seen = new Map<string, number>();
      for (let c = 0; c < 200; c++) {
        const seed = c * 7919 + rate.num;
        const { doc, asset, cuts, rnd } = talk(seed, rate);
        const tr = doc.transcripts[asset]!;
        const words = tr.segments.flatMap((s) => s.words.map((w) => ({ ...w, end: T.add(w.start, w.duration) })));
        const startMs = 2000 + rnd() * 80_000, start = ms(startMs), len = Math.min(8000 + rnd() * 50_000, 118_000 - startMs);
        const body = BuildShortsBodySchema.parse({
          picks: [{ assetId: asset, start, end: T.add(start, ms(len)) }],
          format: rnd() < 0.5 ? { profileId: 'vertical-9x16' } : { width: 720, height: 1280, fit: 'cover', profileId: null, safeArea: { top: 0.08, bottom: 0.18, left: 0.05, right: 0.05 } },
          tighten: { pauses: rnd() < 0.7, minPauseSeconds: rnd() < 0.5 ? 0.3 : 0.7, fillers: rnd() < 0.6 },
          reframe: { source: rnd() < 0.25 ? 'backdrop' : 'centre', framing: rnd() < 0.5 ? 1 : 1.2 },
        });
        let plan;
        try { plan = planShorts(doc, body, ctx0); } catch (e) {
          if (e instanceof ShortsError && e.code === 'plan_too_large') { tooLarge++; continue; }
          throw e;
        }
        if (plan.ops.length > 2000) fail.push(`case ${c}: ${plan.ops.length} ops`);
        for (const w of plan.warnings) seen.set(w.code, (seen.get(w.code) ?? 0) + 1);
        const r = tx(doc, [{ op: 'apply_sequence_plan', args: { planKind: 'shorts', params: {}, steps: plan.steps, ops: plan.ops, origins: plan.origins } }]);
        const issues = validateProject(r.doc);
        if (issues.length) { fail.push(`case ${c}: invalid ${issues[0]!.message}`); continue; }
        const seqId = (r.results[0]!.output as unknown as ApplySequencePlanOutput).sequenceIds[0]!;
        const { seq, pieces, sounds, captions } = shortOf(r.doc, seqId);
        const kept = seq.origin!.kind === 'short' ? seq.origin!.kept : [];
        const excerpt = seq.origin!.excerpt;
        if (kept.length > 1) removedSome++;
        // starts and durations on whole frames, contiguous from 0; the sequence lasts the sum of its pieces
        let at = T.ZERO;
        for (const p of pieces) {
          if (!T.isFrameAligned(p.start, rate) || !T.isFrameAligned(p.duration, rate)) fail.push(`case ${c}: piece ${p.id} off the frame grid`);
          if (!T.eq(p.start, at)) fail.push(`case ${c}: piece ${p.id} starts at ${T.toSeconds(p.start)} not ${T.toSeconds(at)}`);
          at = T.add(at, p.duration);
        }
        if (!T.eq(sequenceDuration(r.doc, seqId), at)) fail.push(`case ${c}: sequence lasts ${T.toSeconds(sequenceDuration(r.doc, seqId))}, pieces ${T.toSeconds(at)}`);
        // each kept span: its pieces start at its exact start, follow each other in source, and overrun it by under one frame
        const spanOf = (p: MediaClip) => kept.findIndex((k) => T.lte(k.start, p.sourceIn) && T.lt(p.sourceIn, k.end));
        for (const [si, k] of kept.entries()) {
          const own = pieces.filter((p) => spanOf(p) === si);
          if (!own.length || !T.eq(own[0]!.sourceIn, k.start)) { fail.push(`case ${c}: span ${si} does not start a piece exactly`); continue; }
          let src = k.start, total = T.ZERO;
          for (const p of own) { if (!T.eq(p.sourceIn, src)) fail.push(`case ${c}: span ${si} pieces are not contiguous`); src = T.add(p.sourceIn, p.duration); total = T.add(total, p.duration); }
          const slack = T.sub(total, T.sub(k.end, k.start));
          if (T.isNegative(slack) || !T.lt(slack, one)) fail.push(`case ${c}: span ${si} slack ${T.toSeconds(slack)} s`);
        }
        // every kept word lies inside the pieces; a word is either kept whole or removed whole, and only fillers are removed
        const fillerIds = new Set(findFillers(tr).candidates.flatMap((f) => f.wordIds));
        for (const w of words) {
          if (T.lt(w.start, excerpt.start) || T.lt(excerpt.end, w.end)) continue;
          const whole = kept.some((k) => T.lte(k.start, w.start) && T.lte(w.end, k.end));
          const touches = kept.some((k) => T.lt(k.start, w.end) && T.lt(w.start, k.end));
          if (!whole && touches) fail.push(`case ${c}: word "${w.text}" at ${T.toSeconds(w.start)} is cut`);
          if (!touches && !fillerIds.has(w.id)) fail.push(`case ${c}: word "${w.text}" at ${T.toSeconds(w.start)} removed but not a filler`);
          if (whole) {
            const cover = pieces.filter((p) => T.lt(p.sourceIn, w.end) && T.lt(w.start, T.add(p.sourceIn, p.duration))).sort((a, b) => T.cmp(a.sourceIn, b.sourceIn));
            let reach = w.start;
            for (const p of cover) if (T.lte(p.sourceIn, reach)) reach = T.max(reach, T.add(p.sourceIn, p.duration));
            if (T.lt(reach, w.end)) fail.push(`case ${c}: word "${w.text}" at ${T.toSeconds(w.start)} is not inside the pieces`);
          }
        }
        // picture cuts at least flashGapFrames apart
        const cutFrames = pieces.slice(1).map((p) => T.frameIndexAt(p.start, rate));
        for (let k = 1; k < cutFrames.length; k++) if (cutFrames[k]! - cutFrames[k - 1]! < gap) fail.push(`case ${c}: cuts at frames ${cutFrames[k - 1]} and ${cutFrames[k]} (< ${gap})`);
        // fades: exactly 1/100 s, on the sound of pieces at removal joins only
        for (const [j, p] of pieces.entries()) {
          const snd = sounds.find((x) => x.linkGroupId === p.linkGroupId)!;
          const joinBefore = j > 0 && kept.some((k, si) => si > 0 && T.eq(k.start, p.sourceIn));
          const next = pieces[j + 1];
          const joinAfter = !!next && kept.some((k, si) => si > 0 && T.eq(k.start, next.sourceIn));
          const fi = snd.fadeIn, fo = snd.fadeOut;
          if (joinBefore !== !!fi || (fi && !T.eq(fi, T.rt(1, 100)))) fail.push(`case ${c}: fade-in of piece ${j} is ${fi ? T.toSeconds(fi) : 'absent'} (join ${joinBefore})`);
          if (joinAfter !== !!fo || (fo && !T.eq(fo, T.rt(1, 100)))) fail.push(`case ${c}: fade-out of piece ${j} is ${fo ? T.toSeconds(fo) : 'absent'} (join ${joinAfter})`);
        }
        // scene cuts: a piece that follows another of the same span starts at or past a cut, and the one before ends before it
        const a = r.doc.assets[asset]!;
        const video = { duration: a.duration, video: a.video! };
        const shown = (p: MediaClip, frame: T.RationalTime) => sourceFrameIndexAt(video, p, frame, rate);
        const cutIdx = cuts.map((x) => T.frameIndexAt(x, SRC) - startOffsetFrames(a.video!));
        for (let j = 1; j < pieces.length; j++) {
          const p = pieces[j]!, q = pieces[j - 1]!;
          if (spanOf(p) !== spanOf(q)) continue;
          split++;
          const first = shown(p, p.start), last = shown(q, T.sub(p.start, one));
          if (!cutIdx.some((ci) => first >= ci && last < ci)) fail.push(`case ${c}: piece ${j} does not start at a scene cut (${last} → ${first})`);
        }
        for (const ci of cutIdx) {
          const p = pieces.find((x) => shown(x, x.start) <= ci && shown(x, T.sub(T.add(x.start, x.duration), one)) >= ci && shown(x, x.start) < ci);
          if (p) fail.push(`case ${c}: piece ${p.id} plays across the scene cut at source frame ${ci}`);
        }
        // captions sit above the bottom safe area
        const sa = seq.format!.safeArea!;
        if (!captions || captions.caption!.style.marginFrac < sa.bottom + 0.02 - 1e-12) fail.push(`case ${c}: caption margin ${captions?.caption?.style.marginFrac} under ${sa.bottom + 0.02}`);
        if (pieces.length > 40) fail.push(`case ${c}: ${pieces.length} pieces`);
      }
      expect(fail.slice(0, 8)).toEqual([]);
      expect(seen.get('removal_skipped_flash_gap') ?? 0).toBeGreaterThan(0); // the flash rule was exercised, not just never needed
      expect(removedSome).toBeGreaterThan(40);
      expect(split).toBeGreaterThan(100);
      expect(tooLarge).toBeLessThan(20);
    }, 240_000);
  }
});

describe('planShorts: snapping, titles, origins and refusals', () => {
  const rate = { num: 30, den: 1 };
  it("'words' widens a pick to word edges and says so; 'exact' refuses an edge off a word with the nearest edges", () => {
    const { doc, asset } = talk(11, rate);
    const w = doc.transcripts[asset]!.segments[3]!.words;
    const word = w[1]!;
    const inside = T.add(word.start, ms(40));
    const end = T.add(inside, T.rt(12, 1));
    const plan = planShorts(doc, BuildShortsBodySchema.parse({ picks: [{ assetId: asset, start: inside, end }] }), ctx0);
    const o = plan.origins[0]!.origin;
    expect(T.eq(o.excerpt.start, word.start)).toBe(true);
    expect(plan.warnings.map((x) => x.code)).toContain('snapped_to_words');
    try { planShorts(doc, BuildShortsBodySchema.parse({ snap: 'exact', picks: [{ assetId: asset, start: inside, end }] }), ctx0); throw new Error('not refused'); }
    catch (e) {
      expect(e).toBeInstanceOf(ShortsError);
      const err = e as ShortsError;
      expect(err.code).toBe('off_word_boundary');
      expect(T.eq(err.details.nearestBefore as T.RationalTime, word.start)).toBe(true);
      expect(T.eq(err.details.nearestAfter as T.RationalTime, T.add(word.start, word.duration))).toBe(true);
    }
    // on word edges 'exact' keeps the pick as it is
    const last = doc.transcripts[asset]!.segments[8]!.words.at(-1)!;
    const exact = planShorts(doc, BuildShortsBodySchema.parse({ snap: 'exact', picks: [{ assetId: asset, start: word.start, end: T.add(last.start, last.duration) }] }), ctx0);
    expect(T.eq(exact.origins[0]!.origin.excerpt.start, word.start)).toBe(true);
    expect(exact.warnings.map((x) => x.code)).not.toContain('snapped_to_words');
  });
  it('approximate phrases snap to the phrase and warn, also in exact mode', () => {
    let found = false;
    for (let seed = 1; seed < 40 && !found; seed++) {
      const { doc, asset } = talk(seed, rate, { approximate: true });
      const seg = doc.transcripts[asset]!.segments.find((s) => s.timing === 'approximate' && T.toSeconds(s.start) > 5 && T.toSeconds(s.start) < 90);
      if (!seg || seg.words.length < 2) continue;
      found = true;
      const start = T.add(seg.words[1]!.start, ms(10));
      // the end on the end of a word some 12 s later (a word edge, or inside a phrase without word timing)
      const later = doc.transcripts[asset]!.segments.flatMap((s) => s.words).find((w) => T.lte(T.add(start, T.rt(12, 1)), T.add(w.start, w.duration)))!;
      const end = T.add(later.start, later.duration);
      for (const snap of ['words', 'exact'] as const) {
        const plan = planShorts(doc, BuildShortsBodySchema.parse({ snap, picks: [{ assetId: asset, start, end }] }), ctx0);
        expect(T.eq(plan.origins[0]!.origin.excerpt.start, seg.start)).toBe(true);
        expect(plan.warnings.map((x) => x.code)).toContain('snapped_to_phrase');
      }
    }
    expect(found).toBe(true);
  });
  it('a quote title must be verbatim; an agent title is flagged; the title sits in the first seconds', () => {
    const { doc, asset } = talk(5, rate);
    const seg = doc.transcripts[asset]!.segments[4]!;
    const start = seg.words[0]!.start, end = T.add(start, T.rt(20, 1));
    const quote = seg.words.slice(0, 2).map((x) => x.text).join(' ');
    const ok = planShorts(doc, BuildShortsBodySchema.parse({ picks: [{ assetId: asset, start, end, title: { text: quote, origin: 'quote' } }] }), ctx0);
    const text = ok.ops.find((s) => s.op === 'add_text')!;
    expect((text.args as { text: string }).text).toBe(quote);
    expect(ok.ops.some((s) => s.op === 'apply_text_preset')).toBe(true);
    const e = (() => { try { planShorts(doc, BuildShortsBodySchema.parse({ picks: [{ assetId: asset, start, end, title: { text: 'מילים שלא נאמרו בכלל', origin: 'quote' } }] }), ctx0); } catch (x) { return x as ShortsError; } return null; })();
    expect(e?.code).toBe('not_verbatim');
    const agent = planShorts(doc, BuildShortsBodySchema.parse({ picks: [{ assetId: asset, start, end, title: { text: 'כותרת', origin: 'agent' } }] }), ctx0);
    expect(agent.warnings.map((x) => x.code)).toContain('title_agent_text');
  });
  it('origin: the score and reasons come only from the measured candidate; a pick without one has none', () => {
    const { doc, asset } = talk(3, rate);
    const start = T.rt(20, 1), end = T.rt(45, 1);
    const cand = { id: 'cand_0123456789abcdef', rank: 1, assetId: asset, start, end, seconds: 25, statementIds: [], firstWords: '', text: '', contextBefore: '', contextAfter: '', context: { start, end }, score: 71.6, components: {} as ShortCandidate['components'], reasons: [{ code: 'louder_than_usual' as const, sign: 'plus' as const, value: 6, unit: 'dB' as const, at: start, quote: null }], warnings: [] };
    const ctx: ShortsPlanContext = { ...ctx0, candidates: new Map([[cand.id, cand]]) };
    const withCand = planShorts(doc, BuildShortsBodySchema.parse({ picks: [{ assetId: asset, start, end, candidateId: cand.id }] }), ctx).origins[0]!.origin;
    expect(withCand).toMatchObject({ candidateId: cand.id, score: 72, reasons: cand.reasons });
    const without = planShorts(doc, BuildShortsBodySchema.parse({ picks: [{ assetId: asset, start, end, candidateId: 'cand_ffffffffffffffff' }] }), ctx).origins[0]!.origin;
    expect(without).toMatchObject({ candidateId: null, score: null, reasons: [], method: SHORTS_PICK_METHOD });
  });
  it('origin: a candidate measured for another range of the same file is not used; a nudged candidate still is', () => {
    const { doc, asset } = talk(3, rate);
    const mk = (start: T.RationalTime, end: T.RationalTime): ShortCandidate => ({ id: 'cand_00000000000000aa', rank: 1, assetId: asset, start, end, seconds: T.toSeconds(T.sub(end, start)), statementIds: [], firstWords: '', text: '', contextBefore: '', contextAfter: '', context: { start, end }, score: 88, components: {} as ShortCandidate['components'], reasons: [{ code: 'louder_than_usual' as const, sign: 'plus' as const, value: 6, unit: 'dB' as const, at: start, quote: null }], warnings: [] });
    const originFor = (cand: ShortCandidate, start: T.RationalTime, end: T.RationalTime) => {
      const plan = planShorts(doc, BuildShortsBodySchema.parse({ picks: [{ assetId: asset, start, end, candidateId: cand.id }] }), { ...ctx0, candidates: new Map([[cand.id, cand]]) });
      return { origin: plan.origins[0]!.origin, steps: plan.steps };
    };
    // measured for 90–115 s, picked for 20–45 s: the score, reasons and method of the measurement do not travel
    const far = originFor(mk(T.rt(90, 1), T.rt(115, 1)), T.rt(20, 1), T.rt(45, 1));
    expect(far.origin).toMatchObject({ candidateId: null, score: null, reasons: [], method: SHORTS_PICK_METHOD });
    expect(far.steps.join(' ')).toMatch(/cand_00000000000000aa .*not used/);
    // half overlapping is not the measured window either
    expect(originFor(mk(T.rt(30, 1), T.rt(55, 1)), T.rt(20, 1), T.rt(45, 1)).origin.candidateId).toBeNull();
    // the same window with its edges nudged by a second or two is
    const near = originFor(mk(T.rt(20, 1), T.rt(45, 1)), T.rt(21, 1), T.rt(46, 1)).origin;
    expect(near).toMatchObject({ candidateId: 'cand_00000000000000aa', score: 88 });
  });
  it('privacy regions on clips of the same source pictures are carried onto every piece and backdrop copy of a short', () => {
    const f = (s: number) => T.frameTime(s * 30, rate);
    const strip = (x: { id: string }) => { const { id: _id, ...rest } = x; return rest; };
    /** The talk with two main clips carrying privacy regions: source 5–40 s (a filled rect) and 60–70 s (a pixelated ellipse). */
    const setup = (scenes: boolean) => {
      const { doc: d0, asset } = talk(9, rate, { scenes });
      let r = tx(d0, [
        { op: 'add_clip', args: { assetId: asset, start: f(0), sourceIn: f(5), duration: f(35) } },
        { op: 'add_clip', args: { assetId: asset, start: f(40), sourceIn: f(60), duration: f(10) } },
      ]);
      const [c1, c2] = r.results.map((x) => (x.output as { clipId: string }).clipId);
      r = tx(r.doc, [
        { op: 'set_redact_region', args: { clipId: c1, region: { shape: 'rect', x: 0.2, y: -0.1, width: 0.15, height: 0.2, style: 'fill', strength: 1 } } },
        { op: 'set_redact_region', args: { clipId: c2, region: { shape: 'ellipse', x: -0.3, y: 0.1, width: 0.1, height: 0.1, style: 'pixelate' } } },
      ]);
      const doc = r.doc;
      const regionOf = (clipId: string) => {
        for (const t of doc.sequences[doc.mainSequenceId]!.tracks) for (const c of t.clips) if (c.id === clipId && c.type === 'media') return c.redact!.map(strip);
        throw new Error('no clip');
      };
      const make = (start: number, end: number, source: 'backdrop' | 'centre') => {
        const plan = planShorts(doc, BuildShortsBodySchema.parse({ reframe: { source }, picks: [{ assetId: asset, start: T.rt(start, 1), end: T.rt(end, 1) }] }), ctx0);
        const out = tx(doc, [{ op: 'apply_sequence_plan', args: { planKind: 'shorts', params: {}, steps: plan.steps, ops: plan.ops, origins: plan.origins } }]);
        expect(validateProject(out.doc)).toEqual([]);
        const id = (out.results[0]!.output as unknown as ApplySequencePlanOutput).sequenceIds[0]!;
        const pictures = out.doc.sequences[id]!.tracks.filter((t) => t.kind === 'video').flatMap((t) => t.clips) as MediaClip[];
        return { pictures, plan };
      };
      return { r1: regionOf(c1!), r2: regionOf(c2!), make };
    };
    const { r1, r2, make } = setup(true);
    // 10–30 s lies in the first clip's source range only: both layers of the backdrop carry its region, and only it
    const a = make(10, 30, 'backdrop');
    expect(a.pictures.length).toBeGreaterThan(1);
    for (const p of a.pictures) expect(p.redact?.map(strip)).toEqual(r1);
    expect(a.plan.steps.join(' ')).toMatch(/privacy regions carried onto \d+ picture clip/);
    // 35–65 s, split at scene cuts: each piece carries the regions of the clips whose source range it meets
    const meets = (p: MediaClip, a0: number, z: number) => T.lt(p.sourceIn, T.rt(z, 1)) && T.lt(T.rt(a0, 1), T.add(p.sourceIn, p.duration));
    const seen = new Set<string>();
    for (const p of make(35, 65, 'centre').pictures) {
      const want = [...(meets(p, 5, 40) ? r1 : []), ...(meets(p, 60, 70) ? r2 : [])];
      seen.add(`${meets(p, 5, 40)}/${meets(p, 60, 70)}`);
      if (want.length) expect(p.redact?.map(strip)).toEqual(want); else expect(p.redact).toBeUndefined();
    }
    expect(seen).toEqual(new Set(['true/false', 'false/false', 'false/true']));
    // without scene cuts the one piece of 35–65 s meets both: it carries the union (private side)
    const whole = setup(false).make(35, 65, 'centre').pictures;
    expect(whole).toHaveLength(1);
    expect(whole[0]!.redact?.map(strip)).toEqual([...r1, ...r2]);
    // 75–95 s is shown by no clip with a region: none
    for (const p of make(75, 95, 'centre').pictures) expect(p.redact).toBeUndefined();
  });
  it('the backdrop fills the frame and the foreground is contained under either frame fit (contain profiles too)', () => {
    const { doc: d0, asset: land } = talk(9, rate);
    const portrait = { ...VIDEO, contentHash: `sha256:${'5'.repeat(64)}`, video: { ...VIDEO.video, width: 1080, height: 1920 } };
    const doc = tx(d0, [{ op: 'import_asset', args: { asset: portrait } }]).doc;
    const port = Object.keys(doc.assets).find((k) => k !== land)!;
    const cases: [string, unknown][] = [
      [port, { profileId: 'landscape-16x9' }], // fit contain
      [port, { width: 1920, height: 1080, fit: 'cover', profileId: null, safeArea: null }],
      [land, { profileId: 'vertical-9x16' }],
      [land, { width: 720, height: 1280, fit: 'contain', profileId: null, safeArea: null }],
      [land, { width: 720, height: 1280, fit: 'cover', profileId: null, safeArea: null }],
    ];
    const eps = 1e-6;
    for (const [assetId, format] of cases) {
      const plan = planShorts(doc, BuildShortsBodySchema.parse({ format, captions: null, reframe: { source: 'backdrop' }, picks: [{ assetId, start: T.rt(10, 1), end: T.rt(30, 1) }] }), ctx0);
      const out = tx(doc, [{ op: 'apply_sequence_plan', args: { planKind: 'shorts', params: {}, steps: plan.steps, ops: plan.ops, origins: plan.origins } }]);
      const id = (out.results[0]!.output as unknown as ApplySequencePlanOutput).sequenceIds[0]!;
      const seq = out.doc.sequences[id]!;
      const { width: W, height: H, fit } = seq.format!;
      const src = out.doc.assets[assetId]!.video!;
      const [v1, v2] = seq.tracks.filter((t) => t.kind === 'video');
      const where = `${src.width}×${src.height} in ${W}×${H} ${fit}`;
      expect(v1!.clips.length, where).toBeGreaterThan(0);
      for (const c of v1!.clips) {
        const p = placed(W, H, fit, src.width, src.height, c.transform);
        const w = p.w * p.scale, h = p.h * p.scale;
        expect(w >= W - eps && h >= H - eps, `${where}: the copy is ${w}×${h}`).toBe(true);
        expect(Math.min(Math.abs(w - W), Math.abs(h - H)), where).toBeLessThan(eps); // just covers
      }
      for (const c of v2!.clips) {
        const p = placed(W, H, fit, src.width, src.height, c.transform);
        const w = p.w * p.scale, h = p.h * p.scale;
        expect(w <= W + eps && h <= H + eps, `${where}: the foreground is ${w}×${h}`).toBe(true);
        expect(Math.min(Math.abs(w - W), Math.abs(h - H)), where).toBeLessThan(eps); // just contained
      }
    }
  });
  it('refuses: an unknown file, a pick outside the file, too short or too long, an unknown profile, tightening without word timing or features', () => {
    const { doc, asset } = talk(2, rate);
    const code = (b: unknown, ctx = ctx0) => { try { planShorts(doc, BuildShortsBodySchema.parse(b), ctx); } catch (e) { if (e instanceof ShortsError) return e.code; throw e; } return 'ok'; };
    expect(code({ picks: [{ assetId: 'ast_none', start: T.rt(1, 1), end: T.rt(20, 1) }] })).toBe('not_found');
    expect(code({ picks: [{ assetId: asset, start: T.rt(110, 1), end: T.rt(130, 1) }] })).toBe('invalid_args');
    expect(code({ picks: [{ assetId: asset, start: T.rt(10, 1), end: T.rt(11, 1) }] })).toBe('invalid_args');
    const longDoc = tx(createProject({ id: 'prj_long', name: 'L', width: 1920, height: 1080, frameRate: rate }), [{ op: 'import_asset', args: { asset: { ...VIDEO, contentHash: `sha256:${'7'.repeat(64)}`, duration: T.rt(600, 1), video: { ...VIDEO.video, frameCount: 18000 } } } }]).doc;
    const longId = Object.keys(longDoc.assets)[0]!;
    try { planShorts(longDoc, BuildShortsBodySchema.parse({ picks: [{ assetId: longId, start: T.rt(0, 1), end: T.rt(181, 1) }] }), ctx0); throw new Error('not refused'); }
    catch (e) { expect((e as ShortsError).message).toBe('pick 1 is longer than 180 seconds'); }
    expect(code({ format: { profileId: 'tiktok' }, picks: [{ assetId: asset, start: T.rt(10, 1), end: T.rt(30, 1) }] })).toBe('not_found');
    // no transcript: pauses come from the measured features, so without them the plan asks for the measurement
    const bare = tx(createProject({ id: 'prj_b', name: 'B', width: 1920, height: 1080, frameRate: rate }), [{ op: 'import_asset', args: { asset: VIDEO } }]).doc;
    const a2 = Object.keys(bare.assets)[0]!;
    const body = BuildShortsBodySchema.parse({ tighten: { pauses: true }, picks: [{ assetId: a2, start: T.rt(10, 1), end: T.rt(30, 1) }] });
    expect(() => planShorts(bare, body, ctx0)).toThrow(ShortsError);
    const rms = new Float32Array(1200).fill(-20);
    rms.fill(-60, 150, 162); // 1.2 s of silence at 15.0 s
    const features: AudioFeatures = { assetId: a2, contentHash: VIDEO.contentHash, version: 1, hops: 1200, analysedSeconds: 120, partial: false, rmsDb: rms, flatness: new Float32Array(1200), flux: new Float32Array(1200), method: 'audio-features 1: mono 16 kHz in 20-minute windows; per 100 ms hop: RMS level in dBFS (not LUFS), spectral flatness 100 Hz–7.9 kHz, positive log-spectral flux; no model' };
    const plan = planShorts(bare, body, { ...ctx0, features: new Map([[a2, features]]) });
    const kept = plan.origins[0]!.origin.kept;
    expect(kept).toHaveLength(2);
    expect(T.eq(kept[0]!.end, T.fromSeconds('15.12'))).toBe(true);
    expect(T.eq(kept[1]!.start, T.fromSeconds('16.08'))).toBe(true);
    expect(plan.warnings.map((x) => x.code)).toContain('no_scene_cuts');
  });
  it('more than 2000 operations is plan_too_large', () => {
    // ten 180 s shorts of a long file cut into many shots, with the blurred backdrop: well over 2000 steps
    const long = { ...VIDEO, contentHash: `sha256:${'8'.repeat(64)}`, duration: T.rt(1800, 1), video: { ...VIDEO.video, frameCount: 54000 } };
    let doc = tx(createProject({ id: 'prj_l', name: 'L', width: 1920, height: 1080, frameRate: rate }), [{ op: 'import_asset', args: { asset: long } }]).doc;
    const asset = Object.keys(doc.assets)[0]!;
    doc = tx(doc, [{ op: 'edit_analysis', args: { assetId: asset, kind: 'scenes', add: Array.from({ length: 400 }, (_, k) => T.rt(9 * k + 8, 2)) } }]).doc;
    const picks = Array.from({ length: 10 }, (_, k) => ({ assetId: asset, start: T.rt(180 * k, 1), end: T.rt(180 * k + 175, 1), title: { text: 'כותרת', origin: 'typed' as const } }));
    try { planShorts(doc, BuildShortsBodySchema.parse({ picks, reframe: { source: 'backdrop' } }), ctx0); throw new Error('not refused'); }
    catch (e) { expect((e as ShortsError).code).toBe('plan_too_large'); expect((e as ShortsError).details.operations).toBeGreaterThan(2000); }
  });
  it('the backdrop: a blurred picture-only copy under the foreground at backdropScale; a rebuild names plan-made shorts only', () => {
    const { doc, asset } = talk(9, rate);
    const plan = planShorts(doc, BuildShortsBodySchema.parse({ reframe: { source: 'backdrop' }, picks: [{ assetId: asset, start: T.rt(10, 1), end: T.rt(30, 1) }] }), ctx0);
    const r = tx(doc, [{ op: 'apply_sequence_plan', args: { planKind: 'shorts', params: {}, steps: plan.steps, ops: plan.ops, origins: plan.origins } }]);
    const id = (r.results[0]!.output as unknown as ApplySequencePlanOutput).sequenceIds[0]!;
    const [v1, v2] = r.doc.sequences[id]!.tracks.filter((t) => t.kind === 'video');
    for (const c of v1!.clips) { expect(c.effects?.[0]).toMatchObject({ type: 'blur.gaussian', params: { radius: 0.035 } }); expect(c.transform.opacity).toBe(0.55); }
    for (const c of v2!.clips) expect(c.transform.scale).toBe(0.31640625);
    expect(r.doc.sequences[id]!.tracks.filter((t) => t.kind === 'audio').flatMap((t) => t.clips)).toHaveLength(v2!.clips.length); // the copy has no sound
    expect(plan.warnings.map((x) => x.code)).not.toContain('upscaled'); // the foreground is contained: 0.5625× of its pixels
    const again = planShorts(r.doc, BuildShortsBodySchema.parse({ replaceSequenceIds: [id], picks: [{ assetId: asset, start: T.rt(40, 1), end: T.rt(60, 1) }] }), ctx0);
    expect(again.steps.at(-1)).toMatch(/Replaces 1 short/);
    expect(() => planShorts(r.doc, BuildShortsBodySchema.parse({ replaceSequenceIds: [r.doc.mainSequenceId], picks: [{ assetId: asset, start: T.rt(40, 1), end: T.rt(60, 1) }] }), ctx0)).toThrow(ShortsError);
  });
  it('the track source keys x per shot from the motion track; a track of another file is refused', () => {
    const { doc: d0, asset } = talk(6, rate);
    let doc = tx(d0, [{ op: 'create_motion_track', args: { assetId: asset, kind: 'point', frame: 0, x: 2000, y: 5000, name: 'speaker' } }]).doc;
    const mt = Object.keys(doc.motionTracks)[0]!;
    const k = 1800;
    doc = tx(doc, [{ op: 'attach_motion_track', args: { motionTrackId: mt, from: 1, x: Array.from({ length: k }, (_, i) => 2000 + Math.round(3000 * Math.sin(i / 90))), y: Array.from({ length: k }, () => 5000), q: Array.from({ length: k }, () => 90), st: Array.from({ length: k }, (_, i) => (i % 400 > 380 ? 3 : 1)), method: 'test', params: {}, createdAt: '2026-11-18T00:00:00Z' } }]).doc;
    const body = BuildShortsBodySchema.parse({ reframe: { source: 'auto', motionTrackId: mt }, format: { width: 720, height: 1280, fit: 'cover', profileId: null, safeArea: null }, picks: [{ assetId: asset, start: T.rt(5, 1), end: T.rt(40, 1) }] });
    const plan = planShorts(doc, body, ctx0);
    expect(plan.origins[0]!.origin).toMatchObject({ reframe: 'track', motionTrackId: mt });
    expect(plan.shorts[0]!.reframe.keys).toBeGreaterThan(0);
    const r = tx(doc, [{ op: 'apply_sequence_plan', args: { planKind: 'shorts', params: {}, steps: plan.steps, ops: plan.ops, origins: plan.origins } }]);
    expect(validateProject(r.doc)).toEqual([]);
    const id = (r.results[0]!.output as unknown as ApplySequencePlanOutput).sequenceIds[0]!;
    const { pieces } = shortOf(r.doc, id);
    expect(pieces.length).toBeGreaterThan(1);
    // every key list starts at its own piece (clip-local 0): no key pans across a scene cut
    for (const p of pieces) if (p.keyframes?.x) { expect(T.isZero(p.keyframes.x[0]!.time)).toBe(true); expect(T.lt(p.keyframes.x.at(-1)!.time, p.duration)).toBe(true); }
    const other = tx(createProject({ id: 'prj_o', name: 'O', width: 1920, height: 1080, frameRate: rate }), [{ op: 'import_asset', args: { asset: { ...VIDEO, contentHash: `sha256:${'6'.repeat(64)}` } } }]).doc;
    const merged = structuredClone(doc);
    const otherId = Object.keys(other.assets)[0]!;
    merged.assets[otherId] = other.assets[otherId]!;
    const e = (() => { try { planShorts(merged, BuildShortsBodySchema.parse({ ...body, picks: [{ assetId: otherId, start: T.rt(5, 1), end: T.rt(40, 1) }] }), ctx0); } catch (x) { return x as ShortsError; } return null; })();
    expect(e?.code).toBe('tracking_not_available');
  });
  it('a 1080×1920 short from 1080p warns upscaled; 720×1280 does not', () => {
    const { doc, asset } = talk(4, rate);
    const pick = [{ assetId: asset, start: T.rt(10, 1), end: T.rt(30, 1) }];
    expect(planShorts(doc, BuildShortsBodySchema.parse({ picks: pick }), ctx0).warnings.map((x) => x.code)).toContain('upscaled');
    expect(planShorts(doc, BuildShortsBodySchema.parse({ picks: pick, format: { width: 720, height: 1280, fit: 'cover', profileId: null, safeArea: null } }), ctx0).warnings.map((x) => x.code)).not.toContain('upscaled');
  });
});
