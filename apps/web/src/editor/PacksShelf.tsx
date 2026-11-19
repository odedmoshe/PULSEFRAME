/**
 * The first section «חבילות» of the templates drawer (ADR-0022; plan §8): one Tile per pack, its cover three real element
 * pictures on the pack palette and a mono count («4 תבניות · 25 אלמנטים»). A pack suggested for `today` (suggestPacks, with the
 * client's own local date) sorts first with a gold Badge from PackSuggestion.reason; dismissing it is a per-viewer preference in
 * localStorage (inside try/catch), never project state. Test ids: PACK_TESTIDS.shelf, card, suggest, suggestDismiss.
 * Each pack is a list item carrying data-pack-id; its Tile button is the card (data-testid=pack-card), so a proof finds a card
 * by `[data-pack-id="…"] [data-testid=pack-card]`. A pack whose cover element is not in this build shows fewer pictures.
 */
import { useMemo, useState } from 'react';
import { elementSvg, type GDate, type LifeEventHint, type PackSummary } from '@pulseframe/core';
import { Badge, Button, Tile } from '../ds/index.ts';
import { DS, CloseIcon, cx } from '../ds/util.tsx';
import { PACK_TESTIDS as TID } from './packs.testids.ts';
import { PACK_STRINGS } from './packs.strings.ts';
import { countLine, coverOf, dismissKey, readDismissed, shelfOrder, suggestionsFor, writeDismissed } from './packs.logic.ts';
import './packs.css';

const svgUri = (id: string, color: string, color2: string): string | null => {
  try { return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(elementSvg(id, { color, color2 }))}`; } catch { return null; }
};

function Cover({ pack }: { pack: PackSummary }) {
  const c = coverOf(pack);
  // the pack's own ground (its third colour) darkened toward the surface, so the elements in its first two colours stand out in both themes
  return (
    <span className="pf-shelf-cover" style={{ background: `color-mix(in oklab, ${c.ground} 30%, var(--pf-surface-2))` }}>
      {c.ids.map((id) => { const uri = svgUri(id, c.color, c.color2); return uri ? <img key={id} src={uri} alt="" draggable={false} /> : null; })}
    </span>
  );
}

export function PacksShelf({ packs, today, hints, lang, onOpen }: { packs: readonly PackSummary[]; today: GDate; hints?: readonly LifeEventHint[]; lang: 'he' | 'en'; onOpen: (packId: string) => void }) {
  const S = PACK_STRINGS[lang];
  const suggestions = useMemo(() => suggestionsFor(packs, today, hints ?? []), [packs, today.y, today.m, today.d, hints]); // eslint-disable-line react-hooks/exhaustive-deps
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());
  const rows = shelfOrder(packs, suggestions, dismissed);
  const dismiss = (key: string) => setDismissed((d) => { const next = new Set(d).add(key); writeDismissed(next); return next; });
  return (
    <section className={cx(DS, 'pf-shelf')} data-testid={TID.shelf} aria-label={S.shelfTitle} data-lang={lang}>
      <h3 className="pf-shelf-head">{S.shelfTitle}</h3>
      <p className="pf-shelf-intro">{S.shelfIntro}</p>
      {rows.length === 0 && <p className="pf-shelf-empty" role="status">{S.shelfEmpty}</p>}
      <ul className="pf-shelf-grid">
        {rows.map(({ pack, suggestion }) => {
          const name = pack.name[lang];
          return (
            <li key={pack.id} className={cx('pf-shelf-item', suggestion && 'is-suggested')} data-pack-id={pack.id}>
              <Tile name={name} image={<Cover pack={pack} />} testId={TID.card} onActivate={() => onOpen(pack.id)} />
              <span className="pf-shelf-count num" lang={lang}>{countLine(pack, S)}</span>
              {suggestion && (
                <span className="pf-shelf-suggest" data-testid={TID.suggest} data-days-away={suggestion.daysAway}>
                  <Badge tone="pulse"><span className="pf-sr">{S.suggestedLabel}: </span>{suggestion.reason[lang]}</Badge>
                  <Button size="sm" variant="ghost" icon={<CloseIcon size={14} />} data-testid={TID.suggestDismiss} aria-label={S.dismissFor(name)} onClick={() => dismiss(dismissKey(suggestion))}>{S.dismiss}</Button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
