import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, CircleHelp, RotateCcw } from 'lucide-react';
import { isolate } from '../ds/util.tsx';
import './sections.css';

const KEY = 'pf.inspector.sections.v2';
const EVENT = 'pf:sections';

function readMap(): Record<string, boolean> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, boolean>) : {};
  } catch { return {}; }
}
function writeOne(id: string, open: boolean) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...readMap(), [id]: open })); } catch { /* storage unavailable */ }
}

/** Open or close every Section at once (the "all tools" view's open all / close all buttons). */
export function setAllSections(open: boolean) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { open } }));
}

/**
 * How the sections around a component behave. `flat` is the "all tools on one screen" view: every section starts open with
 * its help shown, and nothing is remembered, so the view is the same every time it is opened.
 */
export const SectionsContext = createContext<{ flat: boolean; labels: { help: string; reset: string } }>({ flat: false, labels: { help: 'Help', reset: 'Reset' } });

export interface SectionProps {
  id: string;
  title: string;
  icon?: ReactNode;
  /** whether it starts open when the person has not chosen yet; primary sections do, secondary ones show their summary instead */
  defaultOpen?: boolean;
  /** shown on the header while the section is closed: its values in a few words ("100% · רגיל") */
  summary?: ReactNode;
  /** true: the body has `.pf-help` notes that the "?" shows; a node: the note itself, shown under the header */
  help?: ReactNode | true;
  onReset?: () => void;
  /** 'pulse': the "on the beat" style (gold), for what follows the music */
  tone?: 'pulse';
  children: ReactNode;
}

/**
 * A titled, foldable group of the inspector. The body stays mounted when closed; the choice is remembered per id in this
 * browser. A closed section says what it holds (its summary); explanations wait behind "?".
 */
export function Section({ id, title, icon, defaultOpen = true, summary, help, onReset, tone, children }: SectionProps) {
  const { flat, labels } = useContext(SectionsContext);
  const initial = () => { if (flat) return true; const v = readMap()[id]; return typeof v === 'boolean' ? v : defaultOpen; };
  const [open, setOpen] = useState<boolean>(initial);
  // the view can change under a mounted section (the all-tools button with a clip selected): every section opens in the
  // all-tools view, and back in tabs each one is as the person left it
  const firstFlat = useRef(flat);
  useEffect(() => { if (firstFlat.current === flat) return; firstFlat.current = flat; setOpen(initial()); }, [flat]); // eslint-disable-line react-hooks/exhaustive-deps
  const [helpOpen, setHelpOpen] = useState(false);
  const bodyId = useId(), helpId = useId();
  useEffect(() => {
    const on = (e: Event) => { const o = (e as CustomEvent<{ open: boolean }>).detail.open; setOpen(o); if (!flat) writeOne(id, o); };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [id, flat]);
  const toggle = () => { const o = !open; setOpen(o); if (!flat) writeOne(id, o); };
  const showHelp = flat || helpOpen;
  return (
    <section className={`pf-section pf-sec${open ? ' is-open' : ''}${tone ? ` is-${tone}` : ''}`} data-testid={`section-${id}`} data-open={open ? 'true' : 'false'} data-help={showHelp ? 'open' : undefined}>
      <header className="pf-section-head">
        <h3 className="pf-section-title">
          <button type="button" className="pf-section-toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
            <ChevronDown className="pf-section-chev pf-ico" size={16} strokeWidth={1.75} aria-hidden="true" />
            {icon}
            <span className="pf-sec-name">{title}</span>
            {!open && summary != null && summary !== '' && <span className="pf-section-summary">{typeof summary === 'string' ? isolate(summary) : <bdi>{summary}</bdi>}</span>}
          </button>
        </h3>
        {onReset && open && <button type="button" className="pf-section-help" aria-label={`${labels.reset}: ${title}`} title={labels.reset} onClick={onReset}><RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" /></button>}
        {help != null && help !== false && open && !flat && (
          <button type="button" className="pf-section-help" aria-label={`${labels.help}: ${title}`} title={labels.help} aria-expanded={helpOpen} aria-controls={help === true ? bodyId : helpId} onClick={() => setHelpOpen(!helpOpen)}><CircleHelp size={14} strokeWidth={1.75} aria-hidden="true" /></button>
        )}
      </header>
      {help != null && help !== true && help !== false && showHelp && open && <div id={helpId} role="note" className="pf-section-pop">{help}</div>}
      <div id={bodyId} className="pf-section-body" hidden={!open}>{children}</div>
    </section>
  );
}
export { SECTION_STRINGS } from './sections.strings.ts';
