/**
 * The timeline's toolbar (DESIGN_REVIEW 2026-11-26 WP1, "labelled timeline toolbar"): one row where every everyday action
 * says its name beside its icon, in the order the owner uses them:
 *   undo, redo | split, delete, duplicate, close gaps, remove silences | range start, range end, range cut | + text
 *   · the ride bar over the selection (RideBar.tsx) · «עוד» (the rest) and the zoom.
 * Each button runs the command of the palette (commands.ts), so a key, the palette and the button do one same thing and the
 * button says why it cannot be used when it cannot. The tools that left the row (select and blade, main magnet, ripple delete,
 * link, marker, the ruler's time/bars switch, beat analysis, beat snapping before beats exist) are in «עוד»: its panel is
 * always in the page (hidden while closed), so every control keeps its test id; their keys are unchanged.
 * The range buttons run P5's commands `range.in`, `range.out`, `range.cut` once they are registered in COMMANDS; until then
 * they are drawn disabled and say «עוד לא נבנה» with what to use meanwhile.
 * At ≤ 1366 px the range buttons and «שכפול» move into «עוד» (timeline.css), then undo and redo drop their words.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, CopyPlus, Ellipsis, Flag, FlagOff, Link2, MapPin, Metronome, MousePointer2, Scissors, ScissorsLineDashed, Type, Unlink2, VolumeOff } from 'lucide-react';
import { Button, Seg, Tooltip } from '../ds/index.ts';
import { writeSnapBeats } from '../api.ts';
import { COMMANDS, chordLabel } from './commands.ts';
import { useEditorState, type Editor } from './store.ts';
import { IconDelete, IconMainMagnet, IconRedo, IconRippleDelete, IconUndo } from './icons.tsx';
import type { TlStrings } from './timeline.strings.ts';

const cmd = (id: string) => COMMANDS.find((c) => c.id === id);
const keysOf = (id: string): string[] | undefined => { const k = cmd(id)?.keys[0]; return k ? chordLabel(k).split('+') : undefined; };
const canRun = (editor: Editor, id: string) => { const c = cmd(id); return !!c && !!editor.doc && (!c.enabled || c.enabled(editor)); };
const run = (editor: Editor, id: string) => { const c = cmd(id); if (c && (!c.enabled || c.enabled(editor))) void c.run(editor); };

/**
 * «הסרת שתיקות»: the silence finder lives on the inspector's speech page (TranscriptPanel.tsx SilencePanel), which Captions
 * mode offers. The button goes there and puts the focus in the finder; it removes nothing by itself (the finder shows what it
 * found and asks first).
 */
function openSilences(editor: Editor) {
  editor.setWorkspace('captions');
  let tries = 0;
  const step = () => {
    const tab = document.querySelector<HTMLElement>('[data-testid=inspector-tab-speech]');
    if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
    const panel = document.querySelector<HTMLElement>('[data-testid=silence-panel]');
    const target = panel?.querySelector<HTMLElement>('button:not(:disabled), input, select') ?? panel;
    if (target && target.offsetParent) { target.scrollIntoView({ block: 'nearest' }); target.focus(); return; }
    if (++tries < 20) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * A worded toolbar button: icon and word (the word is its name, so what is read is what is seen); a longer help, its keys and,
 * when it cannot be used, the reason in the tooltip. A blocked button stays focusable (aria-disabled) so its reason can be reached.
 */
function Act({ testId, help, word, icon, keys, reason, onClick, className }: { testId?: string; help: string; word: string; icon: ReactNode; keys?: string[]; reason?: string; onClick: () => void; className?: string }) {
  return (
    <Tooltip label={reason ?? help} keys={reason ? undefined : keys} reason={!!reason}>
      <button type="button" className={`pf-ds pf-btn pf-btn-ghost pf-btn-sm tl-act${reason ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`} data-testid={testId} aria-disabled={reason ? true : undefined}
        onClick={(e) => { if (reason) { e.preventDefault(); return; } onClick(); }}>
        {icon}<span className="pf-btn-label">{word}</span>
      </button>
    </Tooltip>
  );
}

export interface ToolbarMore {
  tool: 'select' | 'blade'; setTool: (t: 'select' | 'blade') => void;
  behaviour: { mainMagnet?: boolean; rippleDelete?: boolean } | undefined; canBehave: boolean; setBehaviour: (patch: Record<string, boolean>) => void;
  snapBeats: boolean; setSnapBeats: (v: boolean) => void; hasBeats: boolean;
  rulerMode: 'time' | 'bars'; setRuler: (v: 'time' | 'bars') => void;
  /** the beat analysis action (PulseStrip.tsx TempoHead) while the beat has not been analysed */
  analyse: ReactNode;
}

/** The start of the toolbar: the everyday actions. They follow the selection and the playhead, so they listen to the player. */
export function ToolbarActions({ s }: { s: TlStrings }) {
  const { editor, state } = useEditorState();
  void state.tick;
  const doc = state.doc;
  const mod = chordLabel('Mod+KeyZ').split('+')[0]!;
  const range = (id: string, testId: string, label: string, word: string, icon: ReactNode, key: string, className = 'tl-range') => {
    const c = cmd(id);
    return <Act testId={testId} className={className} help={label} word={word} icon={icon} keys={c ? keysOf(id) : [key]}
      reason={!c ? s.notBuilt : !canRun(editor, id) ? s.rangeNeed : undefined} onClick={() => run(editor, id)} />;
  };
  return (
    <>
      <span className="tl-group" role="group" aria-label={s.groupHistory}>
        <Act testId="undo" className="tl-hist" help={s.undoHelp} word={s.undo} icon={<IconUndo className="pf-ico-flip" />} keys={[mod, 'Z']} reason={doc ? undefined : s.needProject} onClick={() => void editor.history('undo')} />
        <Act testId="redo" className="tl-hist" help={s.redoHelp} word={s.redo} icon={<IconRedo className="pf-ico-flip" />} keys={[mod, 'Shift', 'Z']} reason={doc ? undefined : s.needProject} onClick={() => void editor.history('redo')} />
      </span>
      <span className="tl-sep" aria-hidden="true" />
      <span className="tl-group" role="group" aria-label={s.groupEdit}>
        <Act testId="tl-split" help={s.split} word={s.splitWord} icon={<Scissors size={16} strokeWidth={1.75} aria-hidden="true" />} keys={keysOf('edit.split')} reason={canRun(editor, 'edit.split') ? undefined : s.splitNeed} onClick={() => run(editor, 'edit.split')} />
        <Act testId="tl-delete" help={s.deleteHelp} word={s.deleteWord} icon={<IconDelete />} keys={keysOf('edit.delete')} reason={canRun(editor, 'edit.delete') ? undefined : s.needClip} onClick={() => run(editor, 'edit.delete')} />
        <Act testId="tl-duplicate" className="tl-dup" help={s.duplicateHelp} word={s.duplicateWord} icon={<CopyPlus size={16} strokeWidth={1.75} aria-hidden="true" />} keys={keysOf('edit.duplicate')} reason={canRun(editor, 'edit.duplicate') ? undefined : s.needClip} onClick={() => run(editor, 'edit.duplicate')} />
        <Act testId="tl-close-gaps" help={s.closeGaps} word={s.closeGapsWord} icon={<Unlink2 size={16} strokeWidth={1.75} aria-hidden="true" />} reason={canRun(editor, 'edit.closeGaps') ? undefined : s.needProject} onClick={() => run(editor, 'edit.closeGaps')} />
        <Act testId="tl-silences" help={s.silencesHelp} word={s.silencesWord} icon={<VolumeOff size={16} strokeWidth={1.75} aria-hidden="true" />} reason={doc ? undefined : s.needProject} onClick={() => openSilences(editor)} />
      </span>
      <span className="tl-sep tl-range" aria-hidden="true" />
      <span className="tl-group tl-range" role="group" aria-label={s.groupRange}>
        {range('range.in', 'tl-range-in', s.rangeInHelp, s.rangeIn, <Flag size={16} strokeWidth={1.75} aria-hidden="true" />, 'I')}
        {range('range.out', 'tl-range-out', s.rangeOutHelp, s.rangeOut, <FlagOff size={16} strokeWidth={1.75} aria-hidden="true" />, 'O')}
        {range('range.cut', 'tl-range-cut', s.rangeCutHelp, s.rangeCut, <ScissorsLineDashed size={16} strokeWidth={1.75} aria-hidden="true" />, 'X')}
      </span>
      <span className="tl-sep" aria-hidden="true" />
      <Act testId="tl-add-text" help={s.addTextHelp} word={s.addTextWord} icon={<Type size={16} strokeWidth={1.75} aria-hidden="true" />} keys={keysOf('edit.addText')} reason={doc ? undefined : s.needProject} onClick={() => run(editor, 'edit.addText')} />
    </>
  );
}

/**
 * «עוד»: a button and a panel of the tools that left the row. The panel is a plain popover (not a menu: it holds switches and
 * a segmented control): Escape or a click outside closes it and the focus returns to the button.
 */
export function ToolbarMoreMenu({ s, m }: { s: TlStrings; m: ToolbarMore }) {
  const { editor, state } = useEditorState();
  void state.tick;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc, true); };
  }, [open]);
  const doc = state.doc;
  const behaveReason = !doc ? s.needClip : m.canBehave ? undefined : s.magnetSoon;
  return (
    <div className="tl-more" ref={root}>
      <Button ref={btn} size="sm" variant="ghost" className="tl-act tl-more-btn" data-testid="tl-more" aria-expanded={open} aria-controls="tl-more-panel" icon={<Ellipsis size={16} strokeWidth={1.75} aria-hidden="true" />} onClick={() => setOpen((o) => !o)}>
        {s.more}<ChevronDown size={13} strokeWidth={1.75} aria-hidden="true" />
      </Button>
      <div id="tl-more-panel" className="tl-more-panel" role="group" aria-label={s.moreTools} hidden={!open} data-testid="tl-more-panel">
        <div className="tl-more-row">
          <span className="tl-more-word">{s.tools}</span>
          <Seg label={s.tools} size="sm" value={m.tool} onChange={m.setTool} className="tl-tool"
            options={[{ value: 'select', label: s.toolSelect, ariaLabel: `${s.toolSelect} (V)`, icon: <MousePointer2 size={15} strokeWidth={1.75} aria-hidden="true" />, testId: 'tl-tool-select' }, { value: 'blade', label: s.toolBlade, ariaLabel: `${s.toolBlade} (C)`, icon: <Scissors size={15} strokeWidth={1.75} aria-hidden="true" />, testId: 'tl-tool-blade' }]} />
        </div>
        <div className="tl-more-row">
          <Button size="sm" variant="ghost" className={`tl-act tl-magnet${m.behaviour?.mainMagnet ? ' is-on' : ''}`} data-testid="tl-magnet" aria-pressed={!!m.behaviour?.mainMagnet} disabledReason={behaveReason} icon={<IconMainMagnet size={16} />} onClick={() => m.setBehaviour({ mainMagnet: !m.behaviour?.mainMagnet })}>{s.magnet}</Button>
          <Button size="sm" variant="ghost" className={`tl-act tl-ripple${m.behaviour?.rippleDelete ? ' is-on' : ''}`} data-testid="tl-ripple" aria-pressed={!!m.behaviour?.rippleDelete} disabledReason={behaveReason} icon={<IconRippleDelete size={16} />} onClick={() => m.setBehaviour({ rippleDelete: !m.behaviour?.rippleDelete })}>{s.ripple}</Button>
        </div>
        <div className="tl-more-row">
          <Button size="sm" variant="ghost" className="tl-act" data-testid="tl-link" disabledReason={canRun(editor, 'edit.link') ? undefined : s.linkNeed} icon={<Link2 size={16} strokeWidth={1.75} aria-hidden="true" />} onClick={() => run(editor, 'edit.link')}>{s.link}</Button>
          <Button size="sm" variant="ghost" className="tl-act" data-testid="tl-marker" keys={keysOf('marker.add')} disabledReason={canRun(editor, 'marker.add') ? undefined : s.markerThere} icon={<MapPin size={16} strokeWidth={1.75} aria-hidden="true" />} onClick={() => run(editor, 'marker.add')}>{s.marker}</Button>
        </div>
        {/* at narrow windows the range buttons and «שכפול» stand here (timeline.css shows this row at ≤ 1366 px) */}
        <div className="tl-more-row tl-more-narrow">
          <Button size="sm" variant="ghost" className="tl-act" disabledReason={canRun(editor, 'edit.duplicate') ? undefined : s.needClip} icon={<CopyPlus size={16} strokeWidth={1.75} aria-hidden="true" />} onClick={() => run(editor, 'edit.duplicate')}>{s.duplicateWord}</Button>
          {(['in', 'out', 'cut'] as const).map((k) => {
            const id = `range.${k}`, c = cmd(id);
            return <Button key={k} size="sm" variant="ghost" className="tl-act" disabledReason={!c ? s.notBuilt : !canRun(editor, id) ? s.rangeNeed : undefined} onClick={() => run(editor, id)}>{k === 'in' ? s.rangeIn : k === 'out' ? s.rangeOut : s.rangeCut}</Button>;
          })}
        </div>
        <div className="tl-more-row">
          <span className="tl-more-word">{s.rulerMode}</span>
          <Seg label={s.rulerMode} size="sm" value={m.rulerMode} onChange={m.setRuler} className="tl-ruler-mode"
            options={[{ value: 'time', label: s.rulerTime, testId: 'tl-ruler-time' }, { value: 'bars', label: s.rulerBars, disabled: !m.hasBeats, testId: 'tl-ruler-bars' }]} />
        </div>
        <div className="tl-more-row">
          {m.analyse}
          {/* beat snapping: on the row once beats exist (Timeline.tsx), here (and of no use yet) before */}
          {!m.hasBeats && <SnapSwitch s={s} on={m.snapBeats} set={m.setSnapBeats} />}
        </div>
      </div>
    </div>
  );
}

/** Beat snapping: a switch (it keeps the id snap-beats and its pressed state). */
export function SnapSwitch({ s, on, set }: { s: TlStrings; on: boolean; set: (v: boolean) => void }) {
  return (
    <Tooltip label={s.snapBeats}>
      <button type="button" role="switch" aria-checked={on} aria-label={s.snapBeats} className={`pf-btn pf-btn-ghost pf-btn-sm tl-act tl-snap${on ? ' is-on' : ''}`} data-testid="snap-beats" onClick={() => { set(!on); writeSnapBeats(!on); }}>
        <Metronome size={16} strokeWidth={1.75} aria-hidden="true" /><span className="pf-btn-label">{s.snapWord}</span>
      </button>
    </Tooltip>
  );
}
