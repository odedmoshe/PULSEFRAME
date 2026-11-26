/**
 * The inspector block of a multicam segment (ADR-0020): the angle radio list (switch_angles for this segment alone) and
 * «החל מראה זה על כל הזווית» (set_angle_look fromClipId), with what a switch dropped reported in words. Mounted in
 * InspectorObject.tsx for picture clips; renders nothing for a clip without a multicam tag.
 */
import { useState } from 'react';
import { dictionaries } from '@pulseframe/i18n';
import { clipEnd, findClip, multicamGroupOf, type MediaClip, type SetAngleLookOutput, type SwitchAnglesOutput } from '@pulseframe/core';
import { Button } from '../ds/index.ts';
import { MULTICAM_STRINGS } from './multicam.strings.ts';
import { MULTICAM_TESTIDS as ID } from './multicam.testids.ts';
import { pictureAngles } from './multicamSession.ts';
import { useEditorState } from './store.ts';
import './multicam.css';

export function MulticamClipBlock({ clip }: { clip: MediaClip }) {
  const { editor, state } = useEditorState();
  const [note, setNote] = useState<string | null>(null);
  if (!clip.multicam || !state.rawDoc || !state.doc) return null;
  const lang = state.lang, S = MULTICAM_STRINGS[lang], D = dictionaries[lang] as Record<string, string>;
  const group = multicamGroupOf(state.rawDoc, clip.multicam.groupId);
  const found = findClip(state.doc, clip.id);
  const picture = found?.track.kind === 'video';
  const droppedText = (dropped: SwitchAnglesOutput['dropped']) => {
    const by = new Map<string, number>();
    for (const d of dropped) by.set(d.what, (by.get(d.what) ?? 0) + 1);
    return [...by].map(([w, n]) => S.droppedLine(D[`multicam.dropped.${w}`] ?? w, n)).join('. ');
  };
  const switchTo = async (angleId: string) => {
    if (!group || angleId === clip.multicam!.angleId) return;
    const r = await editor.commit([{ op: 'switch_angles', args: { groupId: group.id, cuts: [{ at: clip.start, angleId }], until: { at: clipEnd(clip) }, coverage: 'clip' } }], 'Switch angles');
    const o = r?.results[0]?.output as SwitchAnglesOutput | undefined;
    setNote(o ? [droppedText(o.dropped), ...o.skipped.map((k) => D[`multicam.skip.${k.reason}`] ?? k.reason), ...o.warnings.map((w) => D[`multicam.warn.${w.code}`] ?? w.code)].filter(Boolean).join('. ') : null);
  };
  const applyLook = async () => {
    if (!group) return;
    const r = await editor.commit([{ op: 'set_angle_look', args: { groupId: group.id, angleId: clip.multicam!.angleId, fromClipId: clip.id } }], 'Angle look');
    const o = r?.results[0]?.output as SetAngleLookOutput | undefined;
    setNote(o ? [S.appliedLook(o.appliedClipIds.length), droppedText(o.dropped)].filter(Boolean).join('. ') : null);
  };
  const name = `mc-angle-${clip.id}`;
  return (
    <div className="mc-block" data-testid={ID.clipBlock}>
      <span>{D['multicam.title']}: <bdi>{group?.name ?? clip.multicam.groupId}</bdi></span>
      {group && picture && (
        <fieldset role="radiogroup" aria-label={S.angleList}>
          <legend className="pf-sr">{S.angleList}</legend>
          {pictureAngles(group).map((a, i) => (
            <label key={a.id}><input type="radio" name={name} checked={a.id === clip.multicam!.angleId} data-testid={ID.angleRadio} data-angle-id={a.id} onChange={() => void switchTo(a.id)} /> <span className="num">{i + 1}</span> · <bdi>{a.label}</bdi></label>
          ))}
        </fieldset>
      )}
      {group && picture && <Button size="sm" data-testid={ID.applyLook} onClick={() => void applyLook()}>{D['multicam.applyLookToAngle']}</Button>}
      {note && <p className="mc-note" role="status">{note}</p>}
    </div>
  );
}
