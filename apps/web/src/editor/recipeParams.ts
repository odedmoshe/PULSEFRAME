/**
 * The parameters the recipes panel (RecipesPanel.tsx) sends for a recipe: what the person changed in its form, and for
 * everything else a default taken from the project (the selected clip, the first fitting clip or file). Pure, so it is
 * checked without a browser against the recipes' own parameter schemas.
 */
import { cutoutsOf, type Asset, type MediaClip, type ProjectDocument } from '@pulseframe/core';
import * as T from '@pulseframe/time';
import type { RecipeParams } from '../api.ts';

export type RecipeForm = Record<string, unknown>;
export const DEFAULT_PROFILES = ['vertical-9x16', 'square-1x1', 'portrait-4x5'];
/** The recipes this panel has a form for; a recipe without one is not offered here (agents still reach it through the API). */
export const RECIPE_FORM_IDS: readonly string[] = ['beat-montage', 'social-pack', 'tidy-speech', 'portrait-blur'];
/** Portrait blur's default radius (a fraction of the frame height), as in the recipe's schema. */
export const PORTRAIT_DEFAULT_RADIUS = 0.02;

/** A still picture clip on a picture track, with the cut-outs made from its picture (newest first). */
export interface PictureClip { clipId: string; assetId: string; start: T.RationalTime; cutoutIds: string[] }

/** What the forms choose from. */
export interface RecipeSources {
  pictureAssets: Asset[];
  audioAssets: Asset[];
  audioClips: MediaClip[];
  /** The selected clip, when it is a media clip on a sound track. */
  selectedMusic?: string;
  /** Still picture clips of the main sequence, in timeline order. */
  pictureClips: PictureClip[];
  /** The selected clip, when it is one of pictureClips. */
  selectedPicture?: string;
}
export function recipeSources(doc: ProjectDocument | null, selectedClipId?: string): RecipeSources {
  const assets = doc ? Object.values(doc.assets) : [];
  const tracks = doc ? (doc.sequences[doc.mainSequenceId]?.tracks ?? []) : [];
  const audioClips = tracks.filter((tr) => tr.kind === 'audio').flatMap((tr) => tr.clips.filter((c): c is MediaClip => c.type === 'media'));
  const pictureClips: PictureClip[] = doc
    ? tracks.filter((tr) => tr.kind === 'video')
      .flatMap((tr) => tr.clips.filter((c): c is MediaClip => c.type === 'media' && doc.assets[c.assetId]?.kind === 'image'))
      .sort((x, y) => T.cmp(x.start, y.start))
      .map((c) => ({ clipId: c.id, assetId: c.assetId, start: c.start, cutoutIds: cutoutsOf(doc, c.assetId).map((a) => a.id) }))
    : [];
  return {
    pictureAssets: assets.filter((a) => a.video || a.image),
    audioAssets: assets.filter((a) => a.audio),
    audioClips,
    selectedMusic: audioClips.some((c) => c.id === selectedClipId) ? selectedClipId : undefined,
    pictureClips,
    selectedPicture: pictureClips.some((c) => c.clipId === selectedClipId) ? selectedClipId : undefined,
  };
}

/** Effective parameters sent to the server, built from the form plus defaults. */
export function recipeParams(recipeId: string, form: RecipeForm | undefined, src: RecipeSources): RecipeParams {
  const f = form ?? {};
  if (recipeId === 'beat-montage') {
    const unchecked = (f.unchecked as string[] | undefined) ?? [];
    const musicClipId = (f.musicClipId as string | undefined) ?? src.selectedMusic ?? src.audioClips[0]?.id ?? '';
    return {
      musicClipId,
      assetIds: src.pictureAssets.map((a) => a.id).filter((id) => !unchecked.includes(id)),
      everyBeats: (f.everyBeats as number | undefined) ?? 4,
      ...(f.cutOn === 'bars' ? { cutOn: 'bars' } : {}),
      order: (f.order as string | undefined) ?? 'sequence',
      ...(f.seed !== undefined ? { seed: f.seed } : {}),
    };
  }
  if (recipeId === 'social-pack') {
    return {
      profiles: (f.profiles as string[] | undefined) ?? DEFAULT_PROFILES,
      captions: (f.captions as boolean | undefined) ?? true,
      ...(f.captionPreset !== undefined ? { captionPreset: f.captionPreset } : {}),
      loudness: f.loudness === undefined ? -14 : f.loudness,
    };
  }
  if (recipeId === 'portrait-blur') {
    // The clip: the one chosen in the form, else the selected picture clip, else the first one whose picture has a cut-out.
    const clipId = (f.clipId as string | undefined) ?? src.selectedPicture ?? (src.pictureClips.find((c) => c.cutoutIds.length > 0) ?? src.pictureClips[0])?.clipId ?? '';
    // A cut-out chosen in the form counts only while it is one of this clip's picture; otherwise the recipe takes the newest.
    const cut = f.cutoutAssetId as string | undefined;
    const keep = cut !== undefined && !!src.pictureClips.find((c) => c.clipId === clipId)?.cutoutIds.includes(cut);
    return { clipId, ...(keep ? { cutoutAssetId: cut } : {}), radius: (f.radius as number | undefined) ?? PORTRAIT_DEFAULT_RADIUS };
  }
  if (recipeId !== 'tidy-speech') return {};
  return {
    assetId: (f.assetId as string | undefined) ?? src.audioAssets[0]?.id ?? '',
    keepSeconds: (f.keepSeconds as number | undefined) ?? 0.12,
    ...(f.loudness !== undefined ? { loudness: f.loudness } : {}),
    ...(f.captions !== undefined ? { captions: f.captions } : {}),
  };
}
