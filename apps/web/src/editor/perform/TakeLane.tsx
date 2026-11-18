/**
 * The take lane (ADR-0025): what the planner did with every tap, in words. A chip is solid (kept), joined (merged) or dashed (held,
 * with the reason in words, never colour alone). Above it, while a ghost is shown, the banner «תצוגה מקדימה של ההופעה — עדיין לא
 * נשמר»; and the counts line. The chips are listed in time order; the lane does not draw timeline geometry (the timeline owns that).
 */
import type { Chip } from '@pulseframe/core';
import type { Lang } from '@pulseframe/i18n';
import { PERFORM_TESTIDS as ID } from './perform.testids.ts';
import { countChips } from './capture.ts';
import { performT } from './perform.strings.ts';

export interface TakeLaneProps {
  chips: readonly Chip[]; lang: Lang; ghost: boolean;
  /** i18n perform.ghostBanner and perform.held.* through the editor's `t` */
  ghostBanner: string; heldWords: (reason: NonNullable<Chip['reason']>) => string;
  /** the number of taps (in order) past the take limit, marked as they are made */
  overFrom?: number;
}

export function TakeLane({ chips, lang, ghost, ghostBanner, heldWords, overFrom = Infinity }: TakeLaneProps) {
  const S = performT(lang);
  const counts = countChips(chips);
  const sorted = [...chips].sort((a, b) => a.frame - b.frame || a.pad - b.pad || a.tap - b.tap);
  return (
    <section className="pf-perform-lane" data-testid={ID.lane} aria-label={S('pv.chips')}>
      {ghost && <p className="pf-perform-ghost" data-testid={ID.ghostBanner} role="note">{ghostBanner}</p>}
      <p className="pf-perform-counts" data-testid={ID.counts} dir="auto">{chips.length ? S('pv.counts', { kept: counts.kept, merged: counts.merged, held: counts.held }) : S('pv.laneEmpty')}</p>
      {chips.length > 0 && (
        <ul className="pf-perform-chips">
          {sorted.map((c) => {
            const word = S(`pv.chip.${c.state}` as 'pv.chip.kept');
            const why = c.state === 'held' && c.reason ? heldWords(c.reason) : null;
            return (
              <li key={`${c.tap}-${c.frame}`} className="pf-perform-chip" data-testid={ID.chip} data-state={c.state} data-reason={c.reason} data-frame={c.frame} data-pad={c.pad} tabIndex={0}
                aria-label={`${S('pv.chip.label', { pad: c.pad + 1, frame: c.frame, state: word })}${why ? `. ${why}` : ''}${c.tap >= overFrom ? `. ${S('pv.chip.over')}` : ''}`}>
                <span className="pf-perform-chip-pad" aria-hidden="true"><bdi dir="ltr">{c.pad + 1}</bdi></span>
                <span className="pf-perform-chip-state">{word}</span>
                {why && <span className="pf-perform-chip-why" dir="auto">{why}{c.since !== undefined ? ` (${S('pv.chip.since', { n: c.since })})` : ''}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
