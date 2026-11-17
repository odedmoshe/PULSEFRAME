/**
 * Fixture of templateParity.test.ts (ADR-0022): plans every built-in template on fixed projects and fixed inputs and returns
 * one SHA-256 per case. It takes the core library as a parameter, so the same code plans against this tree and against the
 * tree before the content packs (how the pinned hashes were recorded; see the test). Imports nothing from core itself.
 */
import { createHash } from 'node:crypto';

/** The few parts of @pulseframe/core the fixture uses (as they were before ADR-0022). */
export interface CoreForParity {
  createProject: (o: { id: string; name: string; width: number; height: number; frameRate: { num: number; den: number } }) => any;
  planTemplate: (doc: any, def: any, input: unknown) => any;
  canonical: (v: unknown) => string;
  TEMPLATES: readonly { id: string; music: { need: string } }[];
}
const rt = (value: number, timescale: number) => ({ value: String(value), timescale });
const hash = (k: number) => `sha256:${k.toString(16).padStart(64, '0')}`;
const prov = { origin: 'fixture', importedAt: '2026-11-17T00:00:00.000Z', importedBy: 'test' };

function project(core: CoreForParity, rate: { num: number; den: number }) {
  const doc = core.createProject({ id: 'prj_parity', name: 'parity', width: 1080, height: 1920, frameRate: rate });
  ['vid_a', 'vid_b', 'vid_c', 'vid_d'].forEach((id, i) => { doc.assets[id] = { id, kind: 'video', name: `${id}.mp4`, contentHash: hash(10 + i), byteSize: 1000, container: 'mp4', mimeType: 'video/mp4', duration: rt(120, 1), video: { width: 1080, height: 1920, frameRate: rate, codec: 'h264', rotation: 0, frameCount: null }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov }; });
  ['img_a', 'img_b'].forEach((id, i) => { doc.assets[id] = { id, kind: 'image', name: `${id}.png`, contentHash: hash(20 + i), byteSize: 100, container: 'png', mimeType: 'image/png', duration: rt(0, 1), image: { width: 1080, height: 1080, codec: 'png', hasAlpha: false }, provenance: prov }; });
  doc.assets.mus = { id: 'mus', kind: 'audio', name: 'mus.wav', contentHash: hash(30), byteSize: 100, container: 'wav', mimeType: 'audio/wav', duration: rt(300, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov };
  // 118 BPM from 0.25 s: beat k at (1 + 2·k·(60/118)·2)/4 s = (59 + 240k)/236 s, a bar every four beats
  const beats = Array.from({ length: 560 }, (_, k) => rt(59 + 120 * k, 236));
  doc.analyses.mus = { assetId: 'mus', beats: { origin: { method: 'parity fixture', params: {}, createdAt: '2026-11-17T00:00:00.000Z', createdBy: 'test', edited: false }, bpm: 118, confidence: 0.9, beats, downbeats: beats.filter((_, i) => i % 4 === 0), meter: 4 } };
  return doc;
}
/** case name -> SHA-256 of the canonical plan (without the `notices` list ADR-0022 adds; it must be empty for every case). */
export function parityHashes(core: CoreForParity): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rate of [{ num: 30, den: 1 }, { num: 25, den: 1 }, { num: 30000, den: 1001 }]) {
    const doc = project(core, rate);
    for (const def of core.TEMPLATES) {
      const inputs: [string, Record<string, unknown>][] = [
        ['he', { media: ['vid_a', 'img_a', 'vid_b', 'vid_c', 'img_b', 'vid_d'], lang: 'he', musicAssetId: def.music.need === 'none' ? null : 'mus' }],
        ['en-shuffle-double', { media: ['vid_a', 'vid_b'], lang: 'en', order: 'shuffle', seed: 7, tempo: 'double', musicAssetId: def.music.need === 'beats' ? 'mus' : null, texts: {} }],
      ];
      for (const [name, input] of inputs) {
        const key = `${def.id}@${rate.num}/${rate.den}:${name}`;
        let plan: Record<string, unknown>;
        try { plan = core.planTemplate(doc, def, input); } catch (e) { out[key] = `refused: ${(e as Error).message}`; continue; }
        const { notices, ...rest } = plan as { notices?: unknown[] };
        if (notices && notices.length) throw new Error(`${key}: a plan of a built-in template has notices`);
        out[key] = createHash('sha256').update(core.canonical(rest)).digest('hex');
      }
    }
  }
  return out;
}
