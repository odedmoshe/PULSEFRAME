/**
 * Fixture of templateParity2.test.ts (wave 8 owntemplate, verifier C4 / answer 2): the second parity golden. The first one
 * (templateParity.fixture.ts) covers the six catalogue templates on one 118 BPM file. This one covers what it does not and
 * what uses the same grid code (templatePlan.ts listGrid, steadyGrid, placedMusicGrid, anchorOf, scaleSpan):
 * - every content-pack template (TEMPLATES minus BUILTIN_TEMPLATES), with a measured music file with bars, with built-in music
 *   (the steady grid of a style), and with no music at all (the fallback grid), at three frame rates and three tempos;
 * - the family film planner (familyFilm.ts), with music with bars and uneven beats, music without bar starts, and no music.
 * Recorded on the tree BEFORE the owntemplate track touched templatePlan.ts (commit 2dcd371). Synthetic, labelled test data:
 * nothing here is a measurement. Every plan is hashed whole (notices included: a pack plan may have field notices).
 */
import { createHash } from 'node:crypto';
import * as T from '@pulseframe/time';
import { applyTransaction, BUILTIN_TEMPLATES, canonical, createProject, MOMENTS_ALGO, MOMENTS_METHOD, planTemplate, TEMPLATES, type MomentsItem, type ProjectDocument } from './index.ts';
import { planFamilyFilm } from './familyFilm.ts';

type Rate = { num: number; den: number };
const rt = (value: number, timescale: number) => ({ value: String(value), timescale });
const hash = (k: number) => `sha256:${k.toString(16).padStart(64, '0')}`;
const prov = { origin: 'fixture', importedAt: '2026-11-26T00:00:00.000Z', importedBy: 'test' };
const origin = { method: 'parity fixture 2', params: {}, createdAt: '2026-11-26T00:00:00.000Z', createdBy: 'test', edited: false };
const sha = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');

/** Beats of an uneven song: 96 BPM from 0.4 s, each gap varied by a fixed pattern of up to ±3 % (ms, exact). */
function unevenBeats(count: number): T.RationalTime[] {
  const out: T.RationalTime[] = [];
  let ms = 400;
  for (let k = 0; k < count; k++) { out.push(rt(ms, 1000)); ms += 625 + [0, 12, -9, 19, -15, 6, -18, 3][k % 8]!; }
  return out;
}

function project(rate: Rate, id: string): ProjectDocument {
  const doc = createProject({ id, name: 'parity 2', width: 1920, height: 1080, frameRate: rate });
  ['vid_a', 'vid_b', 'vid_c', 'vid_d', 'vid_e'].forEach((vid, i) => { doc.assets[vid] = { id: vid, kind: 'video', name: `${vid}.mp4`, contentHash: hash(40 + i), byteSize: 1000, container: 'mp4', mimeType: 'video/mp4', duration: rt(90 + 7 * i, 1), video: { width: 1920, height: 1080, frameRate: rate, codec: 'h264', rotation: 0, frameCount: null }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov } as never; });
  ['img_a', 'img_b', 'img_c'].forEach((img, i) => { doc.assets[img] = { id: img, kind: 'image', name: `${img}.png`, contentHash: hash(50 + i), byteSize: 100, container: 'png', mimeType: 'image/png', duration: rt(0, 1), image: { width: 1080, height: 1350, codec: 'png', hasAlpha: false }, provenance: prov } as never; });
  // a song with bars (uneven beats, a bar every four beats from beat 1: the first bar start is not the first beat)
  doc.assets.mus_bars = { id: 'mus_bars', kind: 'audio', name: 'mus_bars.wav', contentHash: hash(60), byteSize: 100, container: 'wav', mimeType: 'audio/wav', duration: rt(240, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov } as never;
  const beats = unevenBeats(370);
  doc.analyses.mus_bars = { assetId: 'mus_bars', beats: { origin, bpm: 96, confidence: 0.8, beats, downbeats: beats.filter((_, i) => i >= 1 && (i - 1) % 4 === 0), meter: 4 } } as never;
  // a song without bar starts (steady 132 BPM from 0.25 s: beat k at (1 + k·(60/132)·4)/4 s = (11 + 20k)/44 s)
  doc.assets.mus_flat = { id: 'mus_flat', kind: 'audio', name: 'mus_flat.wav', contentHash: hash(61), byteSize: 100, container: 'wav', mimeType: 'audio/wav', duration: rt(200, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov } as never;
  doc.analyses.mus_flat = { assetId: 'mus_flat', beats: { origin, bpm: 132, confidence: 0.7, beats: Array.from({ length: 430 }, (_, k) => rt(11 + 20 * k, 44)), meter: 4 } } as never;
  return doc;
}

/** The family film's documents: the same project with a moments record per video, attached by the real internal op. */
function filmProject(rate: Rate): ProjectDocument {
  const doc = project(rate, 'prj_parity2_film');
  const fps = rate.num / rate.den;
  const items: MomentsItem[] = ['vid_a', 'vid_b', 'vid_c', 'vid_d', 'vid_e'].map((assetId, i) => {
    const frames = Math.floor((90 + 7 * i) * fps);
    const w = (a: number, b: number, motion: number) => ({ peakFrame: Math.floor(frames * (a + b) / 2), fromFrame: Math.floor(frames * a), toFrame: Math.floor(frames * b), basis: i % 2 ? ['inner-motion'] : ['inner-motion', 'sound'], motion, level: i % 2 ? null : 6 + i, sharp: 1 + i / 10, luma: 110 + 5 * i }) as MomentsItem['windows'][number];
    return { assetId, algo: MOMENTS_ALGO, data: `sha256:${'b'.repeat(64)}`, measured: { picture: true, sound: i % 2 === 0 }, file: { motion: 8 + i, level: -300 }, flat: false, windows: [w(0.2, 0.35, 30 + i), w(0.55, 0.7, 50 - i)] } as MomentsItem;
  });
  return applyTransaction(doc, [{ op: 'attach_moments', args: { method: MOMENTS_METHOD, createdAt: '2026-11-26T10:00:00Z', items } }], { idSeed: 'p2mo_', actor: 'server:moments', allowInternal: true }).doc;
}

const RATES: Rate[] = [{ num: 30, den: 1 }, { num: 25, den: 1 }, { num: 30000, den: 1001 }];

/** case name -> SHA-256 of the canonical plan (or "refused: <message>"). */
export function parity2Hashes(): Record<string, string> {
  const out: Record<string, string> = {};
  const packTemplates = TEMPLATES.filter((t) => !BUILTIN_TEMPLATES.includes(t));
  if (packTemplates.length < 7) throw new Error(`expected the seven pack templates, found ${packTemplates.length}`);
  for (const rate of RATES) {
    const doc = project(rate, 'prj_parity2');
    for (const def of packTemplates) {
      const inputs: [string, Record<string, unknown>][] = [
        ['he-music-bars', { media: ['vid_a', 'img_a', 'vid_b', 'img_b', 'vid_c', 'img_c'], lang: 'he', musicAssetId: 'mus_bars', fields: { name: 'דנה', age: '7', when: 'בשבת', place: 'בגן', night: '3' } }],
        ['en-builtin-half', { media: ['vid_d', 'img_a'], lang: 'en', musicAssetId: null, builtinMusic: { styleId: def.music.builtin ?? 'music.calm', seed: 3 }, tempo: 'half', fields: { date: '2025-12-16' } }],
        ['he-none-double-shuffle', { media: ['img_c', 'vid_e', 'vid_a'], lang: 'he', musicAssetId: null, tempo: 'double', order: 'shuffle', seed: 5 }],
        ['en-flat-motion-none', { media: ['vid_b', 'vid_c', 'img_b', 'vid_d'], lang: 'en', musicAssetId: 'mus_flat', motion: 'none', fields: { name: 'Dana' } }],
      ];
      for (const [name, input] of inputs) {
        const key = `${def.id}@${rate.num}/${rate.den}:${name}`;
        try { out[key] = sha(planTemplate(doc, def, input)); } catch (e) { out[key] = `refused: ${(e as Error).message}`; }
      }
    }
    const film = filmProject(rate);
    const ctx = { capture: { vid_a: '2025-06-01T10:00:00', vid_b: '2025-06-01T10:05:00', vid_c: null, vid_d: '2025-06-01T09:00:00', vid_e: '2025-06-02', img_a: '2025-06-01', img_b: null, img_c: null }, title: null, closing: null };
    const filmInputs: [string, Record<string, unknown>][] = [
      ['music-bars-60', { assetIds: ['vid_a', 'vid_b', 'vid_c', 'vid_d', 'vid_e', 'img_a', 'img_b'], musicAssetId: 'mus_bars', lang: 'he' }],
      ['music-flat-30-arc', { assetIds: ['vid_a', 'vid_b', 'vid_c', 'vid_d', 'vid_e'], musicAssetId: 'mus_flat', targetSeconds: 30, order: 'arc', lang: 'en' }],
      ['none-90-given', { assetIds: ['vid_e', 'vid_d', 'img_c', 'vid_c', 'vid_b', 'vid_a'], musicAssetId: null, targetSeconds: 90, order: 'given', lang: 'he', motion: 'none' }],
      ['music-bars-at-lead', { assetIds: ['vid_a', 'vid_c', 'vid_e'], musicAssetId: 'mus_bars', at: T.frameTime(45, rate), ownSound: 'lead', openingTitle: true, closingCard: true, lang: 'he' }],
    ];
    for (const [name, params] of filmInputs) {
      const key = `family-film@${rate.num}/${rate.den}:${name}`;
      try { out[key] = sha(planFamilyFilm(film, params, ctx)); } catch (e) { out[key] = `refused: ${(e as Error).message}`; }
    }
  }
  return out;
}
