import { useEffect, useMemo, useRef, useState } from 'react';
import * as T from '@pulseframe/time';
import { pacingReport } from '@pulseframe/core';
import { useEditorState } from './store.ts';
import { pacingStrings } from './pacing.strings.ts';
import { skippedNotes } from './transcriptLineage.logic.ts';
import './pacingPanel.css';

const CUTS_FULL = 8, WPS_FULL = 4.5; // the default limits: a cell is fully saturated at its limit
const clock = (t: T.RationalTime) => { const s = T.toSeconds(t), m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`; };
const num = (x: number, digits = 1) => String(Number(x.toFixed(digits)));

/** Pacing report of the main timeline: heat strip, totals and warnings, each with a way to go there. */
export function PacingPanel() {
  const { editor, state } = useEditorState();
  const { doc, lang } = state;
  const S = pacingStrings[lang];
  // The report is worked out only while this panel can be seen. The inspector keeps the panel of every tab mounted and hides
  // the others (display: none), and the document is a new object after every edit, so a report that is always on would be
  // recomputed after each commit with nobody looking. A hidden element has no box; the observer says when it gets one or loses it.
  const root = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') { setShown(true); return; }
    const ro = new ResizeObserver(() => setShown(el.getClientRects().length > 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const report = useMemo(() => (doc && shown ? pacingReport(doc) : null), [doc, shown]);
  if (!shown) return <section ref={root} className="pacing" aria-label={S.title}><h2>{S.title}</h2></section>;
  if (!doc || !report || report.windows.length === 0) return <section ref={root} className="pacing" aria-label={S.title}><h2>{S.title}</h2><p className="muted" data-testid="pacing-empty">{S.empty}</p></section>;
  const go = (t: T.RationalTime) => editor.seek(T.frameIndexAt(t, doc.settings.frameRate));
  return (
    <section ref={root} className="pacing" aria-label={S.title}>
      <h2>{S.title}</h2>
      <div className="pacing-labels" aria-hidden="true"><span>{S.cutsRow}</span><span>{S.wordsRow}</span></div>
      <div className="pacing-strip" data-testid="pacing-strip" role="group" aria-label={S.strip} dir="ltr">
        {report.windows.map((w, i) => (
          <button key={i} type="button" className="pacing-cell" data-cuts={w.cuts} data-wps={num(w.wordsPerSecond, 2)} onClick={() => go(w.start)}
            aria-label={S.cell(clock(w.start), clock(w.end), w.cuts, num(w.wordsPerSecond))}>
            <span className="pacing-heat pacing-cuts" style={{ ['--i' as string]: Math.min(1, w.cuts / CUTS_FULL) }} />
            <span className="pacing-heat pacing-words" style={{ ['--i' as string]: Math.min(1, w.wordsPerSecond / WPS_FULL) }} />
          </button>
        ))}
      </div>
      <p className="pacing-totals" data-testid="pacing-totals">{S.totals(num(report.totals.cutsPerMinute), num(report.totals.wordsPerMinute))}</p>
      {/* clips left out of the word counts because they show a copy that does not keep the recording's timing, by name (as the transcript panel's note) */}
      {skippedNotes(doc, report.skippedClips, S.untimedSkipped).map((n) => <p key={n} className="muted" role="status" data-testid="pacing-skipped-note">{n}</p>)}
      {report.issues.length === 0 ? <p className="muted" data-testid="pacing-clear">{S.clear}</p> : (
        <ul className="pacing-issues" data-testid="pacing-issues">
          {report.issues.map((i, k) => {
            const at = clock(i.start);
            return (
              <li key={k} data-code={i.code}>
                <span>{S.issue(i, at, num(i.value), num(i.limit))}</span>
                <button type="button" onClick={() => go(i.start)} aria-label={S.goTo(at)}>{S.go}</button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
