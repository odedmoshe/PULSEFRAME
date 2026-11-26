/**
 * The export sheet's licence lines (wave 7 library track), beside the flash card: «לשימוש לא מסחרי בלבד: …» when the job output's
 * licence.nonCommercial is not empty, and the credits card with its copy button and the paste note. Read from the job output only
 * (the server computed it from the export's snapshot). Nothing here blocks anything.
 */
import { useState, type ReactElement } from 'react';
import type { Lang } from '@pulseframe/i18n';
import { useEditorState } from '../store.ts';
import { LIBRARY_TESTIDS as TID } from './library.testids.ts';
import { fillLib, LIBRARY_UI_STRINGS } from './library.strings.ts';
import { exportLicence } from './library.logic.ts';
import { WarningLine } from '../sources/SourceParts.tsx';
import { SOURCE_WARNING_CODES, type SourceWarning } from '@pulseframe/core';

/** output.licence.licenceNotes (wave 8 sources; core CreditsView): the licence and term findings of the source files, each quoting its licence. Unknown shapes are skipped. non_commercial_content keeps its own line above. */
export function licenceNotesOf(output: Record<string, unknown> | null | undefined): SourceWarning[] {
  const l = output?.licence as { licenceNotes?: unknown } | undefined;
  if (!l || !Array.isArray(l.licenceNotes)) return [];
  return l.licenceNotes.filter((n): n is SourceWarning => !!n && typeof n === 'object' && (SOURCE_WARNING_CODES as readonly string[]).includes((n as SourceWarning).code) && Array.isArray((n as SourceWarning).termIds));
}

export function ExportLicenceLinesView({ output, lang }: { output: Record<string, unknown> | null | undefined; lang: Lang }): ReactElement | null {
  const L = LIBRARY_UI_STRINGS[lang];
  const [copied, setCopied] = useState(false);
  const lic = exportLicence(output);
  const notes = licenceNotesOf(output);
  if (!lic || (lic.nonCommercial.length === 0 && !lic.credits && notes.length === 0)) return null;
  const copy = async () => { try { await navigator.clipboard.writeText(lic.credits!.descriptionText); setCopied(true); } catch { setCopied(false); } };
  return (
    <div className="pf-lib-export">
      {lic.nonCommercial.length > 0 && <p className="pf-lib-export-nc" role="note" data-testid={TID.exportNonCommercial} dir="auto">{fillLib(L.nonCommercialLine, { titles: lic.nonCommercial.join(', ') })}</p>}
      {notes.length > 0 && <div className="pf-lib-export-notes">{notes.map((n, i) => <WarningLine key={`${n.code}-${n.assetId ?? i}-${i}`} w={n} lang={lang} />)}</div>}
      {lic.credits && (
        <div className="pf-lib-export-credits" data-testid={TID.exportCredits}>
          <h4>{L.creditsTitle}</h4>
          <pre className="pf-lib-credit-text" dir="auto">{lic.credits.descriptionText}</pre>
          <button type="button" className="pf-btn pf-btn-secondary pf-btn-sm pf-ds" data-testid={TID.exportCreditsCopy} onClick={() => void copy()}><span className="pf-btn-label">{copied ? L.copied : L.copyCredits}</span></button>
          <p className="pf-lib-muted">{L.pasteNote}</p>
        </div>
      )}
    </div>
  );
}

export function ExportLicenceLines({ output }: { output: Record<string, unknown> | null | undefined }) {
  const { state } = useEditorState();
  return <ExportLicenceLinesView output={output} lang={state.lang} />;
}
