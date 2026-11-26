/**
 * The report of «תא הבדיקה» (wave 8 booth, builder W3): the text boothReport makes, in a read-only box, and «העתקת הדוח», which copies
 * exactly that text and nothing else. The notes warning is shown whenever a stored note exists (notes go into the report as they are);
 * the name warning when the server counted a name from a people sheet in a note. While the report is not built the box says so.
 */
import { useRef, useState, type ReactElement } from 'react';
import type { BoothSay } from '@pulseframe/core';
import { Button } from '../../ds/index.ts';
import { BOOTH_TESTIDS as TID } from './booth.testids.ts';
import type { ReportBox as Box } from './booth.logic.ts';

export interface ReportBoxProps { say: BoothSay; box: Box; notes: boolean; names: number }

export function ReportBox({ say, box, notes, names }: ReportBoxProps): ReactElement {
  const area = useRef<HTMLTextAreaElement>(null);
  const [said, setSaid] = useState('');
  const copy = async () => {
    if (!box.ok) return;
    try { await navigator.clipboard.writeText(box.text); setSaid(say('page.copied')); }
    catch {
      // no clipboard (an insecure page, a blocked permission): the box is selected so that Ctrl+C copies the same text
      area.current?.focus(); area.current?.select(); setSaid(say('page.reportSelected'));
    }
  };
  return (
    <section className="pf-booth-report" aria-labelledby="pf-booth-report-h">
      <h3 id="pf-booth-report-h">{say('page.reportHeading')}</h3>
      <p className="pf-booth-note">{say('page.reportHelp')}</p>
      {notes && <p className="pf-booth-warn" role="note" data-part="notes-warning">{say('booth.report.notesWarning')}</p>}
      {names > 0 && <p className="pf-booth-warn" role="alert" data-part="name-warning">{say('booth.report.nameWarning')}</p>}
      <textarea ref={area} readOnly dir="auto" rows={12} spellCheck={false} className="pf-booth-reportbox" aria-label={say('booth.report.box')} data-testid={TID.reportBox} data-built={box.ok ? 'yes' : 'no'} value={box.text} />
      <p id="pf-booth-report-advice" className="pf-booth-note" data-part="note-advice">{say('booth.noteAdvice')}</p>
      <div className="pf-booth-actions">
        <Button variant="primary" data-testid={TID.reportCopy} aria-describedby="pf-booth-report-advice" disabledReason={box.ok ? undefined : say('page.reportNotBuilt')} onClick={() => void copy()}>{say('booth.report.copy')}</Button>
        <span role="status" aria-live="polite" className="pf-booth-note" data-part="copy-state">{said}</span>
      </div>
    </section>
  );
}
