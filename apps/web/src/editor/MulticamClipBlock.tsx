/**
 * The inspector block of a multicam segment (ADR-0020, W3): the angle radio list (switch_angles for this segment) and
 * «החל מראה זה על כל הזווית» (set_angle_look fromClipId), with what a switch drops reported in words. Mounted by the lead in
 * InspectorObject.tsx for picture clips; renders nothing for a clip without a multicam tag.
 * LEAD PLACEHOLDER: names the group and the angle the segment shows, plainly, and says the controls are not built yet.
 */
import { dictionaries } from '@pulseframe/i18n';
import { multicamGroupOf, type MediaClip } from '@pulseframe/core';
import { useEditorState } from './store.ts';
import { MULTICAM_TESTIDS as ID } from './multicam.testids.ts';

export function MulticamClipBlock({ clip }: { clip: MediaClip }) {
  const { state } = useEditorState();
  if (!clip.multicam || !state.rawDoc) return null;
  const t = dictionaries[state.lang];
  const group = multicamGroupOf(state.rawDoc, clip.multicam.groupId);
  const angle = group?.angles.find((a) => a.id === clip.multicam!.angleId);
  return (
    <div className="row" data-testid={ID.clipBlock}>
      <span>{t['multicam.title']}: <bdi>{group?.name ?? clip.multicam.groupId}</bdi> · <bdi>{angle?.label ?? clip.multicam.angleId}</bdi></span>
      <span className="muted" data-testid={ID.notBuilt}>{t['multicam.notBuilt']}</span>
    </div>
  );
}
