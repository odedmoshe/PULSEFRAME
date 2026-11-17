import { type ReactNode } from 'react';
import { IconFlashShield, IconOnBeat } from '../editor/icons.tsx';
import { tileFace, tileInteractive, type TileState } from './logic.ts';
import { CheckIcon, DS, InfoIcon, StarIcon, cx, isolate } from './util.tsx';

export interface TileProps {
  name: string;
  /** the image: always drawn by the shared evaluate + compositor path (ADR-0005), never a CSS fake. Pass the <canvas>/<img>. */
  image?: ReactNode;
  /** flags; several may be set */
  state?: Partial<Record<TileState, boolean>>;
  /** hover-playing: 0..1 progress line */
  progress?: number;
  /** "מתאים" / "יקצר 0.2 ש׳" */
  fitNote?: string;
  /** "פעימה" */
  beatLabel?: string;
  heldLabel?: string;
  /** why a tile is unavailable */
  reason?: string;
  appliedLabel?: string;
  favouriteLabel?: string;
  onActivate?: () => void;
  onToggleFavourite?: () => void;
  className?: string;
  testId?: string;
}
/** Gallery / text-style / media / AI tile. Every state of the spec; the main button and the star are siblings (no nested buttons). */
export function Tile({ name, image, state = {}, progress, fitNote, beatLabel, heldLabel, reason, appliedLabel = 'Applied', favouriteLabel = 'Favourite', onActivate, onToggleFavourite, className, testId }: TileProps) {
  const face = tileFace(state);
  const live = tileInteractive(state);
  const note = state.fits || state.shortens ? fitNote : undefined;
  return (
    <div className={cx(DS, 'pf-tile', `is-${face}`, state.applied && 'is-applied', state.favourite && 'is-fav', state.beat && 'is-beat', state.shortens && 'is-shortens', state.fits && 'is-fits')} data-state={face}>
      <button type="button" className={cx('pf-tile-main', className)} data-testid={testId} aria-pressed={state.applied ? true : undefined} aria-disabled={live ? undefined : true} aria-busy={state.loading || undefined}
        onClick={() => { if (live) onActivate?.(); }}>
        <span className="pf-tile-img" aria-hidden="true">
          {image}
          {state.loading && <span className="pf-tile-shimmer" />}
          {face === 'held' && <span className="pf-tile-held"><IconFlashShield size={20} /></span>}
          {face === 'hover-playing' && <span className="pf-tile-progress"><i style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} /></span>}
          {state.applied && <span className="pf-tile-check"><CheckIcon size={14} strokeWidth={2.5} /></span>}
          {state.beat && <span className="pf-tile-beat"><IconOnBeat size={14} />{beatLabel && <span>{beatLabel}</span>}</span>}
        </span>
        <span className="pf-tile-name">{isolate(name)}</span>
        {(note || (face === 'held' && heldLabel) || (face === 'unavailable' && reason)) && (
          <span className={cx('pf-tile-note', state.shortens && 'is-warn', face === 'unavailable' && 'is-muted')}>
            {face === 'unavailable' ? <><InfoIcon size={13} />{reason}</> : face === 'held' ? heldLabel : note}
          </span>
        )}
        {state.applied && <span className="pf-sr">{appliedLabel}</span>}
      </button>
      {onToggleFavourite && live && (
        <button type="button" className={cx('pf-tile-star', state.favourite && 'is-on')} aria-label={favouriteLabel} aria-pressed={!!state.favourite} onClick={onToggleFavourite}><StarIcon size={15} fill={state.favourite ? 'currentColor' : 'none'} /></button>
      )}
    </div>
  );
}
