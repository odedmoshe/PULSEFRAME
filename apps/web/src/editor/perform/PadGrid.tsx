/**
 * The pad row (ADR-0025): eight buttons that mirror the physical number row, so the row is dir="ltr" in a right-to-left page.
 * A pad is a button with aria-pressed and aria-keyshortcuts, usable by pointer, touch and Enter (held) on the focused pad; the
 * number keys themselves are the capture's (capture.ts), not this component's. A pad that cannot be used says why in words
 * (needs a graphics card, no analysed music, not in the library yet) and never goes quiet. Nothing here commits.
 */
import { useId, type KeyboardEvent, type PointerEvent } from 'react';
import { ELEMENTS, type MoveSpec, type PadBank } from '@pulseframe/core';
import type { Lang } from '@pulseframe/i18n';
import { Pencil } from 'lucide-react';
import { Button, IconButton } from '../../ds/index.ts';
import { PERFORM_TESTIDS as ID } from './perform.testids.ts';
import type { PadStatus } from './capture.ts';
import { PERFORM_STRINGS, performT, type PerformKey } from './perform.strings.ts';

/**
 * What a pad is called: a title's own text, an element's name, a catalogue move's name in the page's language (perform.strings.ts
 * pv.move.*), else (a move the pad editor made) its id read as words.
 */
export function moveLabel(m: MoveSpec | null, lang: Lang): string {
  if (!m) return '';
  if (m.kind === 'title') return m.text;
  if (m.kind === 'sticker') { const e = ELEMENTS.find((x) => x.id === m.source.elementId); if (e) return e.name[lang]; }
  const key = `pv.move.${m.id.replace(/^move\./, '')}` as PerformKey;
  if (Object.hasOwn(PERFORM_STRINGS[lang], key)) return PERFORM_STRINGS[lang][key];
  return m.id.replace(/^move\./, '').replace(/[-_.]/g, ' ');
}
/** Synthetic pointer id of a pad pressed with Enter (a real pointer id is never this large). */
export const ENTER_POINTER_BASE = 1_000_000;

export interface PadGridProps {
  bank: PadBank; statuses: readonly PadStatus[]; held: ReadonlySet<number>; lang: Lang;
  onDown(pad: number, pointerId: number, timeStamp: number): void; onUp(pointerId: number, timeStamp: number): void;
  onEdit(pad: number): void; onAdd(pad: number): void; adding: number | null;
  /** Whether the number keys press pads right now (false while multicam owns them): the pads then say they work by pointer. */
  keysLive: boolean;
  /** «הוסיפו לספרייה» (i18n perform.addToLibrary) */
  addLabel: string;
}

export function PadGrid({ bank, statuses, held, lang, onDown, onUp, onEdit, onAdd, adding, keysLive, addLabel }: PadGridProps) {
  const S = performT(lang);
  const uid = useId();
  return (
    <div className="pf-perform-pads" dir="ltr" role="group" aria-label={S('pv.pads')} data-testid={ID.pads}>
      {Array.from({ length: bank.length }, (_, i) => {
        const m = bank[i] ?? null, st = statuses[i] ?? { state: 'empty' as const };
        const usable = st.state === 'ready';
        const down = held.has(i);
        const hidden = st.state === 'hidden';
        const state = hidden ? 'empty' : down ? 'held-down' : st.state === 'disabled' ? 'disabled' : st.state === 'empty' ? 'empty' : 'ready';
        const label = moveLabel(m, lang);
        const reasonId = `${uid}-r${i}`;
        const keyDown = (e: KeyboardEvent<HTMLButtonElement>) => { if (e.key === 'Enter' && !e.repeat && usable) { e.preventDefault(); onDown(i, ENTER_POINTER_BASE + i, e.timeStamp); } };
        const keyUp = (e: KeyboardEvent<HTMLButtonElement>) => { if (e.key === 'Enter') onUp(ENTER_POINTER_BASE + i, e.timeStamp); };
        const pDown = (e: PointerEvent<HTMLButtonElement>) => { if (!usable) return; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); onDown(i, e.pointerId, e.timeStamp); };
        const pUp = (e: PointerEvent<HTMLButtonElement>) => onUp(e.pointerId, e.timeStamp);
        return (
          <div key={i} className="pf-perform-padcell" data-hidden-by={hidden ? 'no-flashes' : undefined}>
            <button
              type="button" className="pf-perform-pad" data-testid={ID.pad} data-pad={i} data-move-id={m?.id ?? ''} data-state={state}
              aria-pressed={down} aria-keyshortcuts={keysLive ? `${i + 1}` : undefined} aria-disabled={!usable || undefined} aria-hidden={hidden || undefined} tabIndex={hidden ? -1 : 0}
              aria-label={m && !hidden ? `${i + 1}: ${label}` : `${i + 1}: ${S('pv.padEmpty')}`} aria-describedby={st.reason ? reasonId : undefined}
              onPointerDown={pDown} onPointerUp={pUp} onPointerCancel={pUp} onLostPointerCapture={pUp} onKeyDown={keyDown} onKeyUp={keyUp}
              onContextMenu={(e) => e.preventDefault()}
            >
              <span className="pf-perform-padkey" aria-hidden="true"><bdi dir="ltr">{i + 1}</bdi></span>
              <span className="pf-perform-padname" dir="auto">{hidden ? '' : label || S('pv.padEmpty')}</span>
            </button>
            {st.reason && <span id={reasonId} className="pf-perform-padreason" data-testid={ID.padReason} data-reason={st.reason} dir="auto">{S(`pv.reason.${st.reason}` as 'pv.reason.needs_gpu')}</span>}
            {st.reason === 'missing_asset' && (
              <Button size="sm" variant="secondary" busy={adding === i} data-testid={ID.padAddToLibrary} data-pad={i} onClick={() => onAdd(i)}>{adding === i ? S('pv.adding') : addLabel}</Button>
            )}
            {/* in the pad's top corner (perform.css), not on a line of its own under it: the cell stays short enough for a pad's reason and
                its add button to show above the transport in a short stage */}
            <IconButton size="sm" className="pf-perform-padedit" label={S('pv.editPad', { n: i + 1 })} icon={<Pencil size={14} strokeWidth={1.75} aria-hidden="true" />} onClick={() => onEdit(i)} />
          </div>
        );
      })}
    </div>
  );
}
