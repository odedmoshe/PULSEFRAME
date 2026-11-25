/**
 * The strip under the viewer's scrubber (wave 7 pearls track): where the saved pearls of this file lie and which stretches of it
 * are already used on the timeline, both on the file's own length. It reads the whole document (rawDoc, rule C18) through the
 * memoised usage, so the player's ticks never recompute it. Used stretches come from core assetUsage; before builder A's body is
 * merged only the saved pearls are drawn (never a made-up use). Said in words too (role img label, a legend): never colour alone.
 */
import { useMemo, type ReactElement } from 'react';
import { assetUsage, type SourceSpan } from '@pulseframe/core';
import { useEditorState } from '../store.ts';
import { isNotBuilt, spanPearlsOf, stripSegments } from './pearls.logic.ts';
import { pearlsT } from './pearls.strings.ts';
import { PEARLS_TESTIDS as ID } from './pearls.testids.ts';
import './pearls.css';

export function PearlStrip({ assetId }: { assetId: string }): ReactElement | null {
  const { state } = useEditorState();
  const P = pearlsT(state.lang);
  const raw = state.rawDoc;
  const model = useMemo(() => {
    if (!raw || !Object.hasOwn(raw.assets, assetId)) return null;
    const pearls: SourceSpan[] = spanPearlsOf(raw, assetId).map((r) => r.span!);
    let used: SourceSpan[] = [], usedKnown = true;
    try { used = assetUsage(raw, assetId); } catch (e) { if (!isNotBuilt(e)) throw e; usedKnown = false; }
    return { pearls, used, usedKnown, segments: stripSegments(raw.assets[assetId]!.duration, pearls, used) };
  }, [raw, assetId]);
  if (!model || (!model.pearls.length && !model.used.length)) return null;
  return (
    <div className="pf-pearl-strip-wrap">
      <div className="pf-pearl-strip" role="img" aria-label={`${P('stripLabel')}: ${model.pearls.length} / ${model.used.length}`} data-testid={ID.strip} data-pearls={model.pearls.length} data-used={model.used.length}>
        {model.segments.map((s, i) => <i key={i} className={`is-${s.kind}`} style={{ insetInlineStart: `${s.fromPercent}%`, inlineSize: `${s.widthPercent}%` }} />)}
      </div>
      <p className="pf-pearl-strip-legend">{P('stripPearl')} <b aria-hidden="true">▬</b>{model.usedKnown ? <> · {P('stripUsed')} <b aria-hidden="true">▨</b></> : null}</p>
    </div>
  );
}
