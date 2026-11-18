/**
 * The assistant's row in the palette (ADR-0027; plan §6 "Assistant row"). W3 builds it: «עוזר השפה לא מחובר» with «איך מחברים»
 * when not ready; when ready, the send line, the job's stage in words (never a percentage), the proposal preview, accept or
 * reject through editor.decideProposal.
 * PLACEHOLDER of the lead's pre-pass: the row the palette showed before the bar, moved here unchanged — greyed, not
 * choosable, honest that no model is connected.
 */
import { Bot } from 'lucide-react';
import { CHROME_STRINGS } from '../chrome.strings.ts';
import { COMMAND_BAR_TESTIDS } from './commandBar.testids.ts';
import type { AssistantRowProps } from './contract.ts';

export function AssistantRow({ query, lang, optionDomId }: AssistantRowProps) {
  const C = CHROME_STRINGS[lang];
  return (
    <div className="pf-pal-option is-assistant" role="option" aria-selected="false" aria-disabled="true" id={optionDomId('assistant')} data-testid={COMMAND_BAR_TESTIDS.assistantRow}>
      <span className="pf-pal-names"><Bot size={14} strokeWidth={1.75} aria-hidden="true" className="pf-pal-ic is-agent" /><span className="pf-pal-label">{C.palAssistantRow(query.trim())}</span><span className="pf-pal-unavail">{C.palNoModel.split(' · ')[0]}</span></span>
    </div>
  );
}
