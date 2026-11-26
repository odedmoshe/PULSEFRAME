/**
 * The note under the viewer while a version for an audience is viewed: «{name} · {n} שינויים · לא נצפתה» (wave 8 audiences). The count
 * is the change list's applied rules (api.audienceChanges, refetched when the revision changes); until it is known, or when the
 * server cannot say, the name and «לא נצפתה» are shown without a number. Nothing here says the version was seen or heard.
 */
import { useEditorState } from '../store.ts';
import { audienceT } from './audience.strings.ts';
import { AUDIENCE_TESTIDS } from './audience.testids.ts';
import { appliedCount, stageNote } from './audience.logic.ts';
import { useAudienceChanges } from './AudiencePanel.tsx';

export function AudienceStageNote() {
  const { state } = useEditorState();
  const v = state.viewVariantId ? state.doc?.variants?.[state.viewVariantId] : undefined;
  const load = useAudienceChanges(state.doc?.id, v?.audience ? v.id : undefined, state.revision);
  if (!v?.audience) return null;
  const t = audienceT(state.lang);
  const text = load.state === 'list' ? stageNote(v.name, appliedCount(load.data), state.lang) : `${v.name} · ${t('unseen')}`;
  return <p className="stage-audience" role="status" data-testid={AUDIENCE_TESTIDS.stageNote}>{text}</p>;
}
