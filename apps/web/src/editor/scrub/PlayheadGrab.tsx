/**
 * The press area of the playhead (wave 8D P5 a): GRAB_PX wide, centred on the line, over the top rows (pulse strip, ruler, flash
 * lane) where the cap is. Mounted inside the playhead's cap (Timeline.tsx); the drag itself is useScrub. There is none over the
 * lanes: there it would take the clicks, drags and trims of the clip under the playhead (proof:phase3 caught a plain click on a
 * short clip taken by it); a press on the ruler anywhere jumps there and drags as well.
 */
import { useEditorState } from '../store.ts';
import { RANGE_STRINGS } from '../range/range.strings.ts';
import { GRAB_PX } from './scrub.logic.ts';
import { useScrub } from './useScrub.ts';
import './scrub.css';

export function PlayheadGrab({ where }: { where: 'cap' }) {
  const { state } = useEditorState();
  const { onGrabDown } = useScrub();
  return <i className={`playhead-grab at-${where}`} data-testid={`playhead-grab-${where}`} style={{ width: GRAB_PX }} title={RANGE_STRINGS[state.lang].playheadGrab} aria-hidden="true" onPointerDown={onGrabDown} />;
}
