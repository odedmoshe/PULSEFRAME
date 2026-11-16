import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import './sections.css';

const KEY = 'pf.inspector.sections.v1';
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

/** Open or close every Section at once (the clip tab's open all / close all buttons). */
export function setAllSections(open: boolean) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { open } }));
}

/** A titled, foldable group. The body stays mounted when closed; the choice is remembered per id in this browser. */
export function Section({ id, title, icon, defaultOpen = true, children }: { id: string; title: string; icon?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState<boolean>(() => { const v = readMap()[id]; return typeof v === 'boolean' ? v : defaultOpen; });
  useEffect(() => {
    const on = (e: Event) => { const o = (e as CustomEvent<{ open: boolean }>).detail.open; setOpen(o); writeOne(id, o); };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [id]);
  return (
    <details className="pf-section" open={open} data-testid={`section-${id}`} onToggle={(e) => { const o = e.currentTarget.open; if (o !== open) { setOpen(o); writeOne(id, o); } }}>
      <summary>
        <span className="pf-section-chev" aria-hidden="true"><ChevronDown size={16} /></span>
        {icon}
        <span>{title}</span>
      </summary>
      <div className="pf-section-body">{children}</div>
    </details>
  );
}
export { SECTION_STRINGS } from './sections.strings.ts';
