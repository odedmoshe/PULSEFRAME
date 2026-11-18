/**
 * The date stamp's source in the look panel (life line, ADR-0021; plan §7): «טקסט · מתאריך הצילום», the switch «שעון» and the
 * date order «'24 12 25 · 25.12.2024». Each change is one update_effect; going back writes source:'text' and clock:false
 * (update_effect merges parameters, so a value is switched back, never removed). The generic parameter loop of the look panel
 * leaves `source`, `clock` and `dateOrder` to this control (STAMP_SOURCE_PARAMS). The clock and the order apply while the
 * source is the capture date, so they are offered only then.
 * Test ids: LIFE_TESTIDS.stampSource, stampClock, stampOrder.
 */
import type { ReactElement } from 'react';
import { findClip } from '@pulseframe/core';
import { Seg, Switch } from '../../ds/index.ts';
import { useEditorState } from '../store.ts';
import { LIFE_STRINGS } from './lifeline.strings.ts';
import { LIFE_TESTIDS } from './lifeline.testids.ts';
import './lifeline.css';

/** The parameters of stylize.date-stamp this control owns: the look panel's generic loop skips them. */
export const STAMP_SOURCE_PARAMS: readonly string[] = ['source', 'clock', 'dateOrder'];

type Source = 'text' | 'capture';
type Order = 'ymd' | 'dmy';

export function StampSource({ clipId, effectId }: { clipId: string; effectId: string }): ReactElement | null {
  const { editor, state } = useEditorState();
  const S = LIFE_STRINGS[state.lang];
  const fx = state.doc ? findClip(state.doc, clipId)?.clip.effects?.find((e) => e.id === effectId) : undefined;
  if (!fx) return null;
  const source: Source = fx.params.source === 'capture' ? 'capture' : 'text';
  const clock = fx.params.clock === true;
  const order: Order = fx.params.dateOrder === 'dmy' ? 'dmy' : 'ymd';
  // one update_effect per change; the parameters merge, so going back writes the values that mean "off"
  const set = (params: Record<string, unknown>, label: string) => void editor.commit([{ op: 'update_effect', args: { clipId, effectId, params } }], label);
  return (
    <div className="pf-stamp" role="group" aria-label={S.stampSourceGroup}>
      <div className="pf-stamp-row" data-testid={LIFE_TESTIDS.stampSource}>
        <Seg size="sm" label={S.stampSourceLabel} value={source} onChange={(v) => { if (v !== source) set(v === 'capture' ? { source: 'capture' } : { source: 'text', clock: false }, 'Date stamp source'); }}
          options={[{ value: 'text', label: S.stampSourceText, testId: `${LIFE_TESTIDS.stampSource}-text` }, { value: 'capture', label: S.stampSourceCapture, testId: `${LIFE_TESTIDS.stampSource}-capture` }]} />
      </div>
      {source === 'capture' && (
        <>
          <Switch label={S.stampClock} checked={clock} testId={LIFE_TESTIDS.stampClock} onChange={(on) => set({ clock: on }, 'Date stamp clock')} />
          <div className="pf-stamp-row" data-testid={LIFE_TESTIDS.stampOrder}>
            <Seg size="sm" label={S.stampOrderLabel} value={order} onChange={(v) => { if (v !== order) set({ dateOrder: v }, 'Date stamp order'); }}
              options={[{ value: 'ymd', label: <bdi className="num" dir="ltr">&apos;24 12 25</bdi>, testId: `${LIFE_TESTIDS.stampOrder}-ymd` }, { value: 'dmy', label: <bdi className="num" dir="ltr">25.12.2024</bdi>, testId: `${LIFE_TESTIDS.stampOrder}-dmy` }]} />
          </div>
          <p className="pf-life-note">{S.stampNote}</p>
        </>
      )}
    </div>
  );
}
