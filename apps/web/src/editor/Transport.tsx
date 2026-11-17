/** The transport bar under the viewer: frame steps, play, loop, shuttle state and the timecode. Split out of panels.tsx unchanged. */
import * as T from '@pulseframe/time';
import { COMMANDS } from './commands.ts';
import { useEditorState, type Editor } from './store.ts';
import { IconLoop, IconNextFrame, IconPause, IconPlay, IconPrevFrame } from './icons.tsx';
import './stage.css';

const run = (editor: Editor, id: string) => { const c = COMMANDS.find((x) => x.id === id)!; if (!c.enabled || c.enabled(editor)) void c.run(editor); };

export function Transport() {
  const { editor, state, t } = useEditorState();
  const { doc } = state;
  const rate = editor.rate;
  const p = editor.player;
  return (
    <div className="transport" dir="ltr">
      <button className="ghost" onClick={() => run(editor, 'transport.prevFrame')} aria-label={t('frame.prev')}><IconPrevFrame /></button>
      <button className="primary" onClick={() => run(editor, 'transport.toggle')} aria-label={p?.playing ? t('pause') : t('play')} data-testid="play" data-playing={p?.playing ? 'true' : 'false'}>{p?.playing ? <IconPause /> : <IconPlay />}</button>
      <button className="ghost" onClick={() => run(editor, 'transport.nextFrame')} aria-label={t('frame.next')}><IconNextFrame /></button>
      <button className="ghost" onClick={() => run(editor, 'transport.loop')} aria-pressed={!!p?.loop} aria-label={t('cmd.loop')} title={t('cmd.loop')} data-testid="loop"><IconLoop /></button>
      {!!p?.shuttleRate && <span className="shuttle" role="status" data-testid="shuttle" aria-label={`${t(p.shuttleRate < 0 ? 'cmd.shuttleBack' : 'cmd.shuttleForward')} ×${Math.abs(p.shuttleRate)}`}>{p.shuttleRate < 0 ? '◀◀' : '▶▶'} ×{Math.abs(p.shuttleRate)}</span>}
      <span className="timecode" data-testid="timecode">{T.toTimecode(editor.playhead, rate)}</span>
      <span className="muted">/ {T.toTimecode(editor.duration, rate)} · {editor.viewDoc?.settings.width}×{editor.viewDoc?.settings.height} · {(rate.num / rate.den).toFixed(rate.den === 1 ? 0 : 2)} fps</span>
    </div>
  );
}
