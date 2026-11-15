/**
 * Things a person should know about a media file as the editor uses it: it was converted at import, its picture or sound
 * starts late, its colours are a guess. Derived from the asset alone, so the editor, REST and MCP all say the same.
 */
import * as T from '@pulseframe/time';
import type { Asset } from './schema.ts';
import { startOffsetFrames } from './speed.ts';

export type AssetNotice =
  | { code: 'converted'; reasons: ('variable-frame-rate' | 'rotation' | 'codec' | 'pixel-aspect' | 'still-format')[] }
  | { code: 'picture-starts-late'; frames: number }
  | { code: 'sound-offset'; seconds: number }
  | { code: 'colour-untagged'; readAs: 'auto' | 'bt601' };

export function assetNotices(asset: Asset): AssetNotice[] {
  const out: AssetNotice[] = [];
  if (asset.conform) out.push({ code: 'converted', reasons: [...asset.conform.reasons] });
  // offsets of a frame or so are ordinary (encoder delay, B-frames); only say something when a person could notice
  const lead = asset.video ? startOffsetFrames(asset.video) : 0;
  if (lead >= 2) out.push({ code: 'picture-starts-late', frames: lead });
  const snd = asset.audio?.startTime ? T.toSeconds(asset.audio.startTime) : 0;
  if (Math.abs(snd) >= 0.05) out.push({ code: 'sound-offset', seconds: Number(snd.toFixed(3)) });
  if (asset.video?.untaggedColour && !asset.conform) out.push({ code: 'colour-untagged', readAs: asset.video.readColourAs ?? 'auto' });
  return out;
}
