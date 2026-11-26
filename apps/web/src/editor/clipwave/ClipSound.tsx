/**
 * A video clip's own sound, under its filmstrip inside the clip (wave 8D P5 d). It is the shared clip layer (ClipVisuals) asked
 * for the waveform derivative of the clip's file, the same peaks a sound clip of that file draws, held once in the shared cache.
 */
import * as T from '@pulseframe/time';
import { toSourceSpan, type Asset, type Clip } from '@pulseframe/core';
import { ClipVisuals } from '../../ClipVisuals.tsx';
import { showsOwnSound, soundBand } from './clipWave.logic.ts';
import './clipWave.css';

export function ClipSound({ projectId, clip, asset, trackKind, laneHeight, clipHeight, widthPx, missing }: { projectId: string; clip: Clip; asset: Asset | undefined; trackKind: string; laneHeight: number; clipHeight: number; widthPx: number; missing: boolean }) {
  if (clip.type !== 'media' || !asset || !showsOwnSound({ trackKind, clipType: clip.type, asset, laneHeight, freeze: !!clip.freeze, missing })) return null;
  const band = soundBand(clipHeight);
  return (
    <span className="clip-own-sound" data-testid="clip-own-sound" style={{ top: band.top, height: band.height }} aria-hidden="true">
      <ClipVisuals projectId={projectId} asset={asset} kind="audio" sourceIn={clip.sourceIn} duration={toSourceSpan(clip, clip.duration) as T.RationalTime} widthPx={widthPx} heightPx={band.height} reverse={!!clip.reverse} tintKey="own-sound" />
    </span>
  );
}
