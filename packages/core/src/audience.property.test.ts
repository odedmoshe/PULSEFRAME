/**
 * Properties of the audience rules (wave 8 audiences, W1) over random synthetic documents built through the real operations (no file
 * is read): effects of every registry row, transitions of every type, text loops, captions with random looks, music of every kind,
 * ducking and gains; versions of both profiles with random kept rules, role corrections, own sizes, and clips deleted afterwards.
 *
 * P1 (verifier C1/C2) the projection is a pure function of (master, variant): two projections are byte-identical, the master is not
 *    touched, and a report changes nothing in the document.
 * P2 (C7) applyAudience never throws, also with kept rules and role corrections for ids that do not exist; every projected version
 *    passes validateProject.
 * P3 a version with every rule kept (picture rules kept on every clip, every sound track corrected to 'other', its own caption look)
 *    is the projection of a plain format with the same frame and caption style: the rules change nothing else.
 * P4 the change list is complete and exact: each applied row names a field that differs from the plain projection, holding `before`
 *    there and `after` in the version; copying those fields back gives the plain projection exactly; kept rows change nothing.
 * P5 master edits flow: a strobe added to the master after the version exists is off in the version (unless kept on that clip).
 * P6 (C3) writing the projected title size back as the version's own size is a fixpoint: ×4/3 never applies twice.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyAudience, applyTransaction, createProject, EFFECTS, KEEPABLE, MUSIC_GENERATOR, modulatableParams, OpError, projectVariant, TRANSITIONS, validateProject,
  type AudienceChange, type ProjectDocument, type Variant,
} from './index.ts';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const HASH = (k: number) => `sha256:${k.toString(16).padStart(64, '0')}`;
const PROV = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };
const LIB = (kind: 'music' | 'loop' | 'sound') => ({ itemId: `syn/${kind}.wav`, sourceId: 'syn', kind, title: kind, sourceSha256: 'a'.repeat(64), ledger: { item: 'syn' }, licence: { id: 'CC0-1.0' }, credit: { text: `${kind} (synthetic)`, placement: 'description' as const }, flags: {} });
const sound = (id: string, k: number, provenance: Record<string, unknown>) => ({ id, kind: 'audio', name: `${id}.wav`, contentHash: HASH(k), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(20, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance });
const SOUND_ASSETS = ['ast_lm', 'ast_ll', 'ast_ls', 'ast_bm', 'ast_vo', 'ast_pl'] as const;
const allTracks = (d: ProjectDocument) => Object.values(d.sequences).flatMap((s) => s.tracks);
const allClips = (d: ProjectDocument) => allTracks(d).flatMap((t) => t.clips);
const clipOf = (d: ProjectDocument, id: string) => allClips(d).find((c) => c.id === id) as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads by path
const trackOf = (d: ProjectDocument, id: string) => allTracks(d).find((t) => t.id === id) as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads by path
const pick = <X,>(rnd: () => number, xs: readonly X[]): X => xs[Math.floor(rnd() * xs.length)]!;

/** A random document built through the operations; refused steps are skipped (they leave the document as it was). */
function randomDoc(seed: number): ProjectDocument {
  const rnd = mulberry32(seed);
  let doc = createProject({ id: `prj_p${seed}`, name: 'P', width: 640, height: 360, frameRate: R });
  doc.assets.ast_v = { id: 'ast_v', kind: 'video', name: 'v.mp4', contentHash: HASH(1), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(20, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 600 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: PROV } as never;
  doc.assets.ast_lm = sound('ast_lm', 2, { ...PROV, origin: 'upload', library: LIB('music') }) as never;
  doc.assets.ast_ll = sound('ast_ll', 3, { ...PROV, origin: 'upload', library: LIB('loop') }) as never;
  doc.assets.ast_ls = sound('ast_ls', 4, { ...PROV, origin: 'upload', library: LIB('sound') }) as never;
  doc.assets.ast_bm = sound('ast_bm', 5, { ...PROV, origin: 'generated', procedural: { id: 'music.calm', version: 1, generator: MUSIC_GENERATOR } }) as never;
  doc.assets.ast_vo = sound('ast_vo', 6, { ...PROV, origin: 'generated', voice: { jobId: 'j', engine: 'e', model: 'm', language: 'he', text: 'שלום', seed: 1, voice: 'built-in', watermark: null } }) as never;
  doc.assets.ast_pl = sound('ast_pl', 7, PROV) as never;
  let n = 0;
  const step = (op: string, args: Record<string, unknown>): Record<string, unknown> | null => {
    try { const r = applyTransaction(doc, [{ op, args }], { idSeed: `p${seed}_${n++}_`, actor: 'test' }); doc = r.doc; return r.results[0]?.output ?? {}; } catch (e) { if (e instanceof OpError) return null; throw e; }
  };
  // pictures one after another, some with their own sound
  let at = 0;
  const pictures: string[] = [];
  for (let k = 0, m = 2 + Math.floor(rnd() * 5); k < m; k++) {
    const len = 20 + Math.floor(rnd() * 60);
    const id = step('add_clip', { assetId: 'ast_v', start: f(at), sourceIn: f(Math.floor(rnd() * 100)), duration: f(len), withLinkedAudio: rnd() < 0.5 })?.clipId as string | undefined;
    if (id) pictures.push(id);
    at += len;
  }
  const end = at;
  if (rnd() < 0.4) step('add_adjustment', { span: 'edit' });
  const adjustment = allTracks(doc).find((t) => t.kind === 'adjustment')?.clips[0]?.id;
  const titles: string[] = [];
  for (let k = 0, m = Math.floor(rnd() * 3); k < m; k++) {
    const id = step('add_text', { text: pick(rnd, ['שלום', 'Hello', 'יום הולדת']), start: f(Math.floor(rnd() * end / 2)), duration: f(20 + Math.floor(rnd() * 30)), ...(rnd() < 0.5 ? { style: { sizeFrac: pick(rnd, [0.03, 0.06, 0.2, 0.45, 0.8]) } } : {}) })?.clipId as string | undefined;
    if (id) { titles.push(id); if (rnd() < 0.6) step('set_text_animation', { clipId: id, animation: { loop: pick(rnd, ['jitter', 'wave', 'pulse', null]) } }); }
  }
  // effects of every kind on pictures, titles and the adjustment; beat modulators where the type has one
  for (const clipId of [...pictures, ...titles, ...(adjustment ? [adjustment] : [])])
    for (let k = 0, m = Math.floor(rnd() * 3); k < m; k++) {
      const type = pick(rnd, EFFECTS).id;
      const fx = step('add_effect', { clipId, type });
      const effectId = fx?.effectId as string | undefined;
      const mod = modulatableParams(type);
      if (effectId && mod.length && rnd() < 0.5) step('set_effect_modulator', { clipId, effectId, param: mod[0]!, modulator: { depth: 0.001 } });
      if (effectId && rnd() < 0.15) step('update_effect', { clipId, effectId, enabled: false });
    }
  for (const clipId of pictures.slice(1)) if (rnd() < 0.7) step('set_transition', { clipId, type: pick(rnd, TRANSITIONS).id, frames: 1 + Math.floor(rnd() * 12) });
  // captions with a random look
  if (rnd() < 0.7) {
    step('add_caption_track', { mode: 'manual', style: { sizeFrac: pick(rnd, [0.03, 0.045, 0.1, 0.18, 0.3]), maxCharsPerLine: pick(rnd, [12, 26, 32, 60]), background: pick(rnd, [null, '#00000080']), preset: pick(rnd, ['classic', 'karaoke', 'word-pop']) } });
    for (let k = 0, m = 1 + Math.floor(rnd() * 3); k < m; k++) step('add_cue', { start: f(k * 25), duration: f(20), text: pick(rnd, ['שלום לכולם', 'hello there']) });
  }
  // sound tracks: one asset kind each, sometimes a mixed track; gains and ducking
  const soundTracks: string[] = allTracks(doc).filter((t) => t.kind === 'audio' && t.clips.length).map((t) => t.id);
  for (let k = 0, m = Math.floor(rnd() * 4); k < m; k++) {
    const trackId = step('add_track', { kind: 'audio' })?.trackId as string | undefined;
    if (!trackId) continue;
    soundTracks.push(trackId);
    step('add_clip', { assetId: pick(rnd, SOUND_ASSETS), trackId, start: f(0), duration: f(Math.max(10, Math.floor(end / 2))), withLinkedAudio: false });
    if (rnd() < 0.5) step('add_clip', { assetId: pick(rnd, SOUND_ASSETS), trackId, start: f(Math.max(10, Math.floor(end / 2))), duration: f(10), withLinkedAudio: false });
    if (rnd() < 0.5) step('set_track_audio', { trackId, gain: pick(rnd, [0, 0.5, 1, 2, 4]) });
  }
  for (const trackId of soundTracks) if (rnd() < 0.4) { const src = soundTracks.filter((t) => t !== trackId); if (src.length) step('set_ducking', { trackId, sourceTrackIds: [pick(rnd, src)], reductionDb: pick(rnd, [3, 10, 36, 40]) }); }
  return doc;
}

/** A version of `profile` with random kept rules (also on unknown ids), random role corrections and random own sizes. */
function addRandomVersion(doc: ProjectDocument, seed: number): { doc: ProjectDocument; id: string } {
  const rnd = mulberry32(seed * 7919 + 1);
  const profile = rnd() < 0.5 ? 'calm' : 'grandparents';
  let d = applyTransaction(doc, [{ op: 'add_audience_version', args: { profile } }], { idSeed: `v${seed}_`, actor: 'user:owner' }).doc;
  const id = Object.keys(d.variants).find((k) => !doc.variants[k])!;
  const ops: { op: string; args: Record<string, unknown> }[] = [];
  for (const c of allTracks(d).filter((t) => t.kind !== 'audio').flatMap((t) => t.clips)) {
    if (rnd() < 0.3) ops.push({ op: 'set_audience_keep', args: { variantId: id, clipId: c.id, rule: pick(rnd, KEEPABLE[profile]), keep: true } });
    if (c.type === 'text' && rnd() < 0.3) ops.push({ op: 'set_variant_override', args: { variantId: id, clipId: c.id, textStyle: { sizeFrac: pick(rnd, [0.04, 0.08, 0.3]) } } });
  }
  for (const t of allTracks(d).filter((x) => x.kind === 'audio')) if (rnd() < 0.3) ops.push({ op: 'update_audience_version', args: { variantId: id, sound: { trackId: t.id, role: pick(rnd, ['music', 'speech', 'other']) } } });
  if (rnd() < 0.3) ops.push({ op: 'update_audience_version', args: { variantId: id, musicDb: pick(rnd, [-20, -3, 0]) } });
  if (rnd() < 0.3) ops.push({ op: 'update_variant', args: { variantId: id, captionStyle: { sizeFrac: 0.05 } } });
  for (const o of ops) { try { d = applyTransaction(d, [o], { idSeed: `v${seed}_${o.op}_${JSON.stringify(o.args).length}_`, actor: 'user:owner' }).doc; } catch (e) { if (!(e instanceof OpError)) throw e; } }
  return { doc: d, id };
}
/** The same variant as a plain format: no audience, no kept rules (everything else of it as it is). */
function plainOf(doc: ProjectDocument, id: string): ProjectDocument {
  const d = structuredClone(doc);
  const v = d.variants[id]!;
  delete v.audience;
  for (const [k, ov] of Object.entries(v.overrides)) { delete ov.keep; if (!Object.keys(ov).length) delete v.overrides[k]; }
  return d;
}
const withoutVariants = (d: ProjectDocument) => JSON.stringify({ ...d, variants: {} });
const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

describe('properties of the audience rules over random documents', () => {
  it('the random documents are valid and reach every rule', () => {
    const rules = new Set<string>();
    for (const seed of SEEDS) {
      const { doc, id } = addRandomVersion(randomDoc(seed), seed);
      expect(validateProject(doc), `seed ${seed}`).toEqual([]);
      const report: AudienceChange[] = [];
      projectVariant(doc, id, report);
      for (const c of report) rules.add(`${c.rule}:${c.kept}`);
    }
    for (const r of ['effect', 'modulator', 'transition', 'text_loop', 'title_size', 'caption_look', 'music_level', 'ducking']) expect([...rules], r).toContain(`${r}:false`);
    for (const r of ['effect', 'transition']) expect([...rules], r).toContain(`${r}:true`);
  });
  it('P1: two projections of the same master and version are byte-identical; the master is untouched; a report changes nothing', () => {
    for (const seed of SEEDS) {
      const { doc, id } = addRandomVersion(randomDoc(seed), seed);
      const before = JSON.stringify(doc);
      const a = JSON.stringify(projectVariant(doc, id));
      expect(JSON.stringify(projectVariant(structuredClone(doc), id)), `seed ${seed}`).toBe(a);
      expect(JSON.stringify(projectVariant(doc, id, [])), `seed ${seed}`).toBe(a);
      expect(JSON.stringify(doc), `seed ${seed}`).toBe(before);
    }
  });
  it('P2: applyAudience never throws (unknown ids, kept rules on deleted clips) and every projected version is valid', () => {
    for (const seed of SEEDS) {
      let { doc, id } = addRandomVersion(randomDoc(seed), seed);
      // delete some clips after the version exists: their kept rules stay behind as dangling entries
      const rnd = mulberry32(seed + 99);
      for (const c of allClips(doc)) if (rnd() < 0.25) { try { doc = applyTransaction(doc, [{ op: 'delete_clip', args: { clipId: c.id } }], { idSeed: `d${seed}_${c.id}_`, actor: 'test' }).doc; } catch (e) { if (!(e instanceof OpError)) throw e; } }
      expect(validateProject(doc), `seed ${seed}`).toEqual([]);
      expect(validateProject(projectVariant(doc, id)), `seed ${seed}`).toEqual([]);
      const v = structuredClone(doc.variants[id]!) as Variant;
      v.overrides.clp_gone = { keep: ['effect', 'transition'] };
      v.audience!.sound = { ...(v.audience!.sound ?? {}), trk_gone: 'music' };
      v.captionStyle = { ...(v.captionStyle ?? {}), sizeFrac: 0.07 };
      for (const profile of ['calm', 'grandparents'] as const) {
        v.audience!.profile = profile;
        const out = projectVariant(doc, id);
        expect(() => applyAudience(out, v, []), `seed ${seed}`).not.toThrow();
        expect(() => applyAudience(structuredClone(doc), { ...v, overrides: {} })).not.toThrow();
      }
    }
  });
  it('P3: a version with every rule kept is the projection of a plain format with the same frame and caption style', () => {
    for (const seed of SEEDS) {
      const master = randomDoc(seed);
      for (const profile of ['calm', 'grandparents'] as const) {
        let d = applyTransaction(master, [{ op: 'add_audience_version', args: { profile } }], { idSeed: `k${seed}_`, actor: 'user:owner' }).doc;
        const id = Object.keys(d.variants).find((k) => !master.variants[k])!;
        const v = d.variants[id]!;
        for (const c of allTracks(d).filter((t) => t.kind !== 'audio').flatMap((t) => t.clips)) v.overrides[c.id] = { keep: [...KEEPABLE[profile]] };
        v.audience!.sound = Object.fromEntries(allTracks(d).filter((t) => t.kind === 'audio').map((t) => [t.id, 'other' as const]));
        v.captionStyle = { sizeFrac: 0.05, maxCharsPerLine: 40, background: null, preset: 'word-pop' };
        // the ops refuse title_size on a non-title and transition on a non-media clip; kept rules that do not apply are harmless here
        const kept = projectVariant(d, id);
        expect(withoutVariants(kept), `seed ${seed} ${profile}`).toBe(withoutVariants(projectVariant(plainOf(d, id), id)));
        const report: AudienceChange[] = [];
        projectVariant(d, id, report);
        expect(report.every((c) => c.kept), `seed ${seed} ${profile}: only kept rows`).toBe(true);
        d = structuredClone(d);
      }
    }
  });
  it('P4: every change is listed with what it was and what it became, and nothing else changes', () => {
    let rows = 0;
    for (const seed of SEEDS) {
      const { doc, id } = addRandomVersion(randomDoc(seed), seed);
      const report: AudienceChange[] = [];
      const A = projectVariant(doc, id, report);
      const P = projectVariant(plainOf(doc, id), id);
      expect(new Set(report.map((c) => c.key)).size, `seed ${seed}: keys unique`).toBe(report.length);
      for (const c of report) {
        const [, , detail] = c.key.split(':') as [string, string, string];
        const where = `seed ${seed} ${c.key}`;
        const ca: any = c.clipId ? clipOf(A, c.clipId) : undefined, cp: any = c.clipId ? clipOf(P, c.clipId) : undefined;
        const ta: any = c.trackId ? trackOf(A, c.trackId) : undefined, tp: any = c.trackId ? trackOf(P, c.trackId) : undefined;
        const fxA: any = ca?.effects?.find((e: { id: string }) => e.id === detail);
        const fxP: any = cp?.effects?.find((e: { id: string }) => e.id === detail);
        const read = (doc: 'A' | 'P'): unknown => {
          const cl = doc === 'A' ? ca : cp, tr = doc === 'A' ? ta : tp, fx = doc === 'A' ? fxA : fxP;
          switch (c.rule) {
            case 'effect': return fx.enabled ? fx.type : null;
            case 'modulator': return fx.modulate ? Object.keys(fx.modulate).sort().join(',') : null;
            case 'transition': return cl!.transition.type;
            case 'text_loop': return cl!.animation?.loop ?? null;
            case 'title_size': return cl!.style.sizeFrac;
            case 'caption_look': return tr!.caption.style[detail];
            case 'music_level': return tr!.audio?.gain ?? 1;
            case 'ducking': return tr!.audio.duck.reductionDb;
          }
        };
        expect(read('P'), `${where}: before is the plain value`).toBe(c.before);
        if (c.kept) { expect(read('A'), `${where}: kept, not applied`).toBe(c.before); continue; }
        expect(read('A'), `${where}: after is the version's value`).toBe(c.after);
        expect(c.after, where).not.toBe(c.before);
        rows++;
        // put the plain value back
        switch (c.rule) {
          case 'effect': fxA.enabled = fxP.enabled; break;
          case 'modulator': fxA.modulate = fxP.modulate; break;
          case 'transition': ca!.transition = cp!.transition; break;
          case 'text_loop': ca!.animation = cp!.animation; break;
          case 'title_size': ca!.style = { ...ca!.style, sizeFrac: cp!.style.sizeFrac }; break;
          case 'caption_look': ta!.caption.style[detail] = tp!.caption.style[detail]; break;
          case 'music_level': ta!.audio.gain = tp!.audio?.gain ?? 1; break;
          case 'ducking': ta!.audio.duck.reductionDb = tp!.audio.duck.reductionDb; break;
        }
      }
      // a track the rules gave an `audio` record of unity gain, centred, with no ducking had none in the master
      for (const t of allTracks(A)) { const tp = trackOf(P, t.id)!; if (!tp.audio && t.audio && t.audio.gain === 1 && t.audio.pan === 0 && t.audio.duck === null) delete t.audio; }
      // key order inside an object is not a change: compare canonically
      expect(canonical({ ...A, variants: {} }), `seed ${seed}`).toBe(canonical({ ...P, variants: {} }));
    }
    expect(rows).toBeGreaterThan(100);
  });
  it('P5: a strobe added to the master after the version exists is off in the version unless that clip keeps effects', () => {
    for (const seed of SEEDS) {
      const { doc, id } = addRandomVersion(randomDoc(seed), seed);
      const pic = allTracks(doc).filter((t) => t.kind === 'video').flatMap((t) => t.clips)[0];
      if (!pic) continue;
      let next: ProjectDocument;
      try { next = applyTransaction(doc, [{ op: 'add_effect', args: { clipId: pic.id, type: 'light.strobe' } }], { idSeed: `s${seed}_`, actor: 'test' }).doc; } catch (e) { if (e instanceof OpError) continue; throw e; }
      expect(JSON.stringify(next.variants[id]), `seed ${seed}`).toBe(JSON.stringify(doc.variants[id]));
      const kept = doc.variants[id]!.overrides[pic.id]?.keep?.includes('effect') ?? false;
      const strobes = clipOf(projectVariant(next, id), pic.id)!.effects!.filter((e: { type: string }) => e.type === 'light.strobe');
      expect(strobes.at(-1)!.enabled, `seed ${seed}`).toBe(kept);
    }
  });
  it('P6 (C3): writing the projected title size back as the version\'s own size changes nothing (×4/3 never twice)', () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const { doc, id } = addRandomVersion(randomDoc(seed), seed);
      if (doc.variants[id]!.audience!.profile !== 'grandparents') continue;
      const p = projectVariant(doc, id);
      for (const c of allClips(p)) {
        if (c.type !== 'text') continue;
        const back = structuredClone(doc);
        const ov = (back.variants[id]!.overrides[c.id] ??= {});
        ov.textStyle = { ...ov.textStyle, sizeFrac: c.style.sizeFrac };
        if (ov.keep?.includes('title_size')) continue; // kept: the master size is shown, and written back it is the version's own
        expect(clipOf(projectVariant(back, id), c.id)!.style.sizeFrac, `seed ${seed} ${c.id}`).toBe(c.style.sizeFrac);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });
});

function canonical(x: unknown): string {
  return JSON.stringify(x, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]])) : v));
}
