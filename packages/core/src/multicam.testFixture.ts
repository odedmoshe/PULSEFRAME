/**
 * Test support for the multicam tests (multicam.test.ts, multicamOps.test.ts; ADR-0020): fixture files, a project, and a
 * podcast group built through the operations (create_multicam, set_multicam_sync) exactly as a person or agent would.
 * Labelled fixtures only: nothing here is measured.
 */
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, OpError, type Asset, type OpCall, type ProjectDocument, type SyncAnchor } from './index.ts';

export const R30 = { num: 30, den: 1 };
export const NTSC = { num: 30000, den: 1001 };
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' };
let hash = 0;
const nextHash = () => `sha256:${(++hash).toString(16).padStart(64, '0')}`;
export const camera = (name: string, seconds: number, rate = R30, sound = true): Omit<Asset, 'id'> => ({
  kind: 'video', name, contentHash: nextHash(), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(seconds, 1),
  video: { width: 1920, height: 1080, frameRate: rate, codec: 'h264', rotation: 0, frameCount: Math.floor((seconds * rate.num) / rate.den) },
  ...(sound ? { audio: { sampleRate: 48000, channels: 2, codec: 'aac' } } : {}), provenance,
});
export const recorder = (name: string, seconds: number): Omit<Asset, 'id'> => ({
  kind: 'audio', name, contentHash: nextHash(), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(seconds, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance,
});
let n = 0;
export const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `mt${n++}_`, actor: 'test', allowInternal });
export const refusal = (fn: () => unknown): OpError => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };
export const samples = (k: number, sr = 48000) => T.rt(k, sr);
/** A project with the given files imported; their ids in order. */
export function project(assets: Omit<Asset, 'id'>[], frameRate = R30, sampleRate = 48000): { doc: ProjectDocument; ids: string[] } {
  const r = tx(createProject({ id: 'prj_mc', name: 'MC', width: 1920, height: 1080, frameRate, sampleRate }), assets.map((asset) => ({ op: 'import_asset', args: { asset } })), true);
  return { doc: r.doc, ids: r.results.map((x) => x.output!.assetId as string) };
}
export interface Podcast { doc: ProjectDocument; groupId: string; mic: string; camA: string; camB: string; files: { mic: string; a: string; b: string } }
/**
 * A recorder (reference, 620 s), camera A and camera B (600 s each) synced by hand: A's source 0 plays at group 1.2 s, B's at
 * 2.5 s (offset-only maps unless anchors are given).
 */
export function podcast(o: { rate?: { num: number; den: number }; anchorsA?: SyncAnchor[]; anchorsB?: SyncAnchor[]; seconds?: number } = {}): Podcast {
  const seconds = o.seconds ?? 600;
  const { doc, ids } = project([recorder('mic.wav', seconds + 20), camera('a.mp4', seconds, o.rate ?? R30), camera('b.mp4', seconds, o.rate ?? R30)], o.rate ?? R30);
  const [mic, a, b] = ids as [string, string, string];
  let r = tx(doc, [{ op: 'create_multicam', args: { name: 'פודקאסט', angles: [{ assetIds: [mic] }, { assetIds: [a] }, { assetIds: [b] }] } }]);
  const out = r.results[0]!.output as { groupId: string; angleIds: string[] };
  const [micA, camA, camB] = out.angleIds as [string, string, string];
  r = tx(r.doc, [
    { op: 'set_multicam_sync', args: { groupId: out.groupId, angleId: camA, pieceIndex: 0, ...(o.anchorsA ? { anchors: o.anchorsA } : { offset: samples(57600) }) } },
    { op: 'set_multicam_sync', args: { groupId: out.groupId, angleId: camB, pieceIndex: 0, ...(o.anchorsB ? { anchors: o.anchorsB } : { offset: samples(120000) }) } },
  ]);
  return { doc: r.doc, groupId: out.groupId, mic: micA, camA, camB, files: { mic, a, b } };
}
