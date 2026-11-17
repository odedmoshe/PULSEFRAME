/**
 * Built-in music on the server (ADR-0022): queue, validate, store and commit. Every sample is made under music/ (render.ts);
 * this file defines no synthesis function (test M9 asserts it).
 *
 * - makeMusic stores the WAV like makeSfx (content hash, storage ceiling, describeMedia) with
 *   provenance.procedural { id: style id, version: style version, generator: MUSIC_GENERATOR, params: musicProvenanceParams },
 *   sets asset.duration = T.rt(layout.totalFrames, 48000) EXACTLY (ffprobe's six decimals cannot hold the thirds of a second of
 *   72 and 90 BPM; the probe must agree within 1e-6 s) and returns the track's known grid (knownGridOf).
 * - addMusic is ONE commit of the internal add_builtin_music (allowInternal) after gov.assertMayAct(edit) +
 *   assertUnrestricted('add media to the library') + the storage ceiling. An agent in propose mode is refused as templates.ts
 *   refuses it (403 insufficient_scope: a proposal cannot carry an internal step).
 * - musicPreview: at most 32 bars; its own queue (one render at a time, a few waiting); previews only are cached, capped by bytes
 *   (64 MB); a render is cancelled when the request is aborted or after a time limit (RenderOptions.cancel).
 * - Errors: 404 not_found (style), 400 invalid_option (bars / fitSeconds / seed; both or neither length), 429 synthesis_busy,
 *   500 music_invalid (validateMusic), 507/413 as the storage ceiling reports today.
 *
 * CONTRACT FILE (lead pre-pass): the exports and their signatures are fixed; W3 writes the bodies. Until then every entry
 * answers 501 music_not_built: no track is made, stored or claimed.
 */
import { z } from 'zod';
import { MusicRequestSchema, RationalTimeSchema, type Asset, type KnownGrid, type MusicLayout, type MusicRequest } from '@pulseframe/core';
import type { Principal } from './auth.ts';
import type { Governance } from './governance.ts';
import { ApiError, type Store } from './store.ts';
import type { RenderedMusic } from './music/render.ts';

export type { RenderedMusic } from './music/render.ts';
/** The highest peak a valid track may have (the master's soft clip never exceeds 2/3). */
export const MUSIC_PEAK_LIMIT = 0.667;
/** The honest refusal of every entry while the synthesiser is not built. */
export const musicNotBuilt = () => new ApiError(501, 'music_not_built', 'built-in music is not built in this version yet', {}, 'Use a music file from the library (musicAssetId), or a template without music.');

/** Throws ApiError 500 music_invalid unless: wav.length === 44 + 4 · layout.totalFrames, every sample finite, peak <= MUSIC_PEAK_LIMIT, first and last frame 0. */
export function validateMusic(_r: RenderedMusic): void {
  throw musicNotBuilt();
}
/** Synthesise, validate and store one track; the asset is not attached to any project yet. */
export async function makeMusic(_store: Store, _req: MusicRequest, _actor: string): Promise<{ asset: Omit<Asset, 'id'>; grid: KnownGrid; layout: MusicLayout }> {
  throw musicNotBuilt();
}
/** WAV bytes for listening before adding (bars <= 32). Nothing is stored. */
export async function musicPreview(_styleId: string, _bars: number, _seed: number): Promise<Buffer> {
  throw musicNotBuilt();
}
/** POST /api/v1/projects/:id/music: a request plus, optionally, where to place one clip of the track. */
export const MusicBody = MusicRequestSchema.extend({ start: RationalTimeSchema.optional(), trackId: z.string().optional() }).strict();
export type MusicBodyInput = z.infer<typeof MusicBody>;
export interface AddMusicResult { assetId: string; clipId: string | null; revision: number; bars: number; seconds: number; sections: MusicLayout['sections'] }
/** One commit of add_builtin_music (see the header). */
export async function addMusic(_store: Store, _gov: Governance, _principal: Principal, _projectId: string, _body: MusicBodyInput): Promise<AddMusicResult> {
  throw musicNotBuilt();
}
