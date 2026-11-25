/**
 * The start and duration rows of a clip's time block (InspectorObject.tsx TimeBlock) as buttons: the start goes to «מעבר לזמן»,
 * the duration opens «משך הקליפ» (D). The text of each row is what it was before (seconds with three decimals).
 */
import * as T from '@pulseframe/time';
import type { Clip } from '@pulseframe/core';
import type { Key } from '@pulseframe/i18n';
import { CRAFT_TESTIDS as TID } from './craft.testids.ts';
import { craftSurface } from './craft.state.ts';
import { say } from './craft.logic.ts';
import { useEditorState } from '../store.ts';

export function ClipTimeRows({ clip, t }: { clip: Clip; t: (k: Key) => string }) {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const start = `${T.toSeconds(clip.start).toFixed(3)}s`, dur = `${T.toSeconds(clip.duration).toFixed(3)}s`;
  const locked = editor.selectionLocked;
  return (
    <>
      <dt>{t('clip.start')}</dt>
      <dd><button type="button" className="pf-craft-rowbtn" data-testid={TID.clipStartButton} aria-haspopup="dialog" aria-label={`${t('clip.start')}: ${start} — ${say(lang, 'startRowGo')}`}
        onClick={() => { editor.seek(T.frameIndexAt(clip.start, editor.rate)); craftSurface.set({ kind: 'time', target: 'goto' }); }}><bdi className="num">{start}</bdi></button></dd>
      <dt>{t('clip.duration')}</dt>
      <dd><button type="button" className="pf-craft-rowbtn" data-testid={TID.clipDurationButton} aria-haspopup="dialog" disabled={locked} aria-label={`${t('clip.duration')}: ${dur} — ${say(lang, 'durationRowSet')}`}
        onClick={() => craftSurface.set({ kind: 'time', target: 'duration' })}><bdi className="num">{dur}</bdi></button></dd>
    </>
  );
}
