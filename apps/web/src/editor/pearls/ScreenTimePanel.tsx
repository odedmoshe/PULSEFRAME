/**
 * «מי כמה בסרט» under the pacing report of the inspector (wave 7 pearls track): a table (name, time, share of the picture time, an
 * aria-hidden proportional bar), the row «לא מתויג», the label (core SCREEN_TIME_LABEL, always shown with the numbers), the note
 * «רוב הסרט לא מתויג — המספרים חלקיים» when more than half the picture time has no tag, and per person «פנינים שלא בשימוש של <שם>»
 * opening the list filtered. Reads rawDoc and the active sequence through pearls.logic.ts (rule C18). Never a colour or a word that
 * judges: the bars are one neutral colour and the shares are plain percentages.
 * Drawn only when some range carries a person (before that there is nothing to measure). Before builder A's functions are merged the
 * panel says the measurement is not available yet, never a number.
 */
import { useMemo, type ReactElement } from 'react';
import { SCREEN_TIME_LABEL } from '@pulseframe/core';
import { isolate } from '../../ds/util.tsx';
import { useEditorState } from '../store.ts';
import { isNotBuilt, rangeMap, screenRows, screenTimeOf, secondsText, unusedPearlsOfPerson, usageOf } from './pearls.logic.ts';
import { pearlsT } from './pearls.strings.ts';
import { PEARLS_TESTIDS as ID } from './pearls.testids.ts';
import { showPearls } from './pearls.ui.ts';
import './pearls.css';

export function ScreenTimePanel(): ReactElement | null {
  const { state } = useEditorState();
  const P = pearlsT(state.lang);
  const raw = state.rawDoc, seq = state.activeSequenceId || raw?.mainSequenceId || '';
  const model = useMemo(() => {
    if (!raw || !seq || !Object.hasOwn(raw.sequences, seq)) return null;
    if (!Object.values(rangeMap(raw)).some((r) => r.people?.length)) return { kind: 'none' as const };
    try {
      const st = screenTimeOf(raw, seq);
      let unused: string[] | null = null;
      try { unused = usageOf(raw).unused; } catch (e) { if (!isNotBuilt(e)) throw e; }
      const name = (id: string) => (Object.hasOwn(raw.people ?? {}, id) ? raw.people![id]!.name : id);
      return { kind: 'table' as const, t: screenRows(st, name), unused, st };
    } catch (e) { if (isNotBuilt(e)) return { kind: 'not-built' as const }; throw e; }
  }, [raw, seq]);
  if (!model || model.kind === 'none') return null;
  const label = SCREEN_TIME_LABEL[state.lang];
  return (
    <section className="pf-screen" data-testid={ID.screenTime} aria-labelledby="pf-screen-title" data-state={model.kind}>
      <h4 id="pf-screen-title">{P('screenTitle')}</h4>
      {model.kind === 'not-built' ? <><p role="status" className="pf-film-muted">{P('notBuilt')}</p><p className="pf-film-muted" data-testid={ID.screenLabel}>{label}</p></> : (
        <>
          {model.t.pictureSeconds === 0 ? <p role="status" className="pf-film-muted">{P('screenNone')}</p> : (
            <table>
              <thead><tr><th scope="col">{P('colWho')}</th><th scope="col">{P('colTime')}</th><th scope="col">{P('colShare')}</th></tr></thead>
              <tbody>
                {model.t.rows.map((r) => (
                  <tr key={r.personId} data-testid={ID.screenRow} data-person-id={r.personId} data-frames={r.frames}>
                    <th scope="row"><bdi dir="auto">{r.name}</bdi></th>
                    <td><bdi dir="ltr" className="num">{P('screenSeconds', { seconds: secondsText(r.seconds) })}</bdi></td>
                    <td className="pf-screen-bar-cell"><bdi dir="ltr" className="num">{r.percent}%</bdi><span className="pf-screen-bar" aria-hidden="true" style={{ inlineSize: `${r.percent}%` }} /></td>
                  </tr>
                ))}
                <tr data-testid={ID.screenUntagged} data-frames={model.t.untagged.frames}>
                  <th scope="row">{P('untagged')}</th>
                  <td><bdi dir="ltr" className="num">{P('screenSeconds', { seconds: secondsText(model.t.untagged.seconds) })}</bdi></td>
                  <td className="pf-screen-bar-cell"><bdi dir="ltr" className="num">{model.t.untagged.percent}%</bdi><span className="pf-screen-bar" aria-hidden="true" style={{ inlineSize: `${model.t.untagged.percent}%` }} /></td>
                </tr>
              </tbody>
            </table>
          )}
          <p className="pf-film-muted" data-testid={ID.screenLabel}>{label}</p>
          {model.t.mostlyUntagged && <p className="pf-film-muted" role="status">{P('mostlyUntagged')}</p>}
          {model.unused && model.t.rows.map((r) => {
            const n = unusedPearlsOfPerson(raw!, model.unused!, r.personId).length;
            return n > 0 ? <button key={r.personId} type="button" className="ghost" data-testid={ID.screenUnused} data-person-id={r.personId} onClick={() => showPearls({ unused: true, personId: r.personId })}>{isolate(P('unusedOf', { name: r.name }))} <bdi dir="ltr" className="num">({n})</bdi></button> : null;
          })}
        </>
      )}
    </section>
  );
}
