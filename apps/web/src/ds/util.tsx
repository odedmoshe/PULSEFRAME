import { useSyncExternalStore, type ReactNode } from 'react';
import { createElement, type ComponentType } from 'react';
import { Check, ChevronDown, CircleHelp, Info, Loader, Star, TriangleAlert, X, type LucideProps } from 'lucide-react';
import type { Dir } from './logic.ts';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
/** Root class of every primitive: re-asserts the spec values of the few token names the legacy sheet also defines (primitives.css). */
export const DS = 'pf-ds';

function subscribeDir(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['dir', 'lang'] });
  return () => mo.disconnect();
}
const dirSnapshot = (): Dir => (document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr');
/** The reading direction of the page (`<html dir>`), live. Primitives read it instead of taking a prop, so one switch flips them all. */
export function useDir(): Dir {
  return useSyncExternalStore(subscribeDir, dirSnapshot, () => 'ltr');
}

/** House defaults for the few glyphs the primitives draw: 16px, 1.75 stroke, decorative. */
const mk = (Icon: ComponentType<LucideProps>) => (p: LucideProps) => createElement(Icon, { size: 16, strokeWidth: 1.75, 'aria-hidden': 'true', focusable: 'false', ...p, className: cx('pf-ico', p.className) });
export const CheckIcon = mk(Check);
export const ChevronIcon = mk(ChevronDown);
export const CloseIcon = mk(X);
export const StarIcon = mk(Star);
export const HelpIcon = mk(CircleHelp);
export const InfoIcon = mk(Info);
export const WarnIcon = mk(TriangleAlert);
export const SpinnerIcon = mk(Loader);

/** A visually hidden but readable label (for screen readers). */
export const SrOnly = ({ children }: { children: ReactNode }) => <span className="pf-sr">{children}</span>;

export const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex],[contenteditable="true"]';

/** Number-like runs: 1080×1920, 12:30, 3.5, 100%. Wrapped so they keep their order inside a right-to-left sentence (UX_REDESIGN §4.16). */
export const NUMERIC_RUN = /\d+(?:[×x:.,/]\d+)*%?/g;
/**
 * A quantity with its unit, as «8.0 ש׳»: only the digits are LTR-isolated (`.num`), the unit stays in the sentence's own direction, so in a
 * right-to-left line the number is read first and the unit after it. (A whole «8.0 ש׳» inside one LTR run puts the unit first.)
 */
export function NumUnit({ value, unit }: { value: ReactNode; unit: string }) { return <bdi><span className="num">{value}</span> {unit}</bdi>; }
/** Splits a string into text and isolated `.num` runs; the whole thing sits in a <bdi> so user text picks its own direction. */
export function isolate(text: string): ReactNode {
  const out: ReactNode[] = []; let last = 0, n = 0;
  for (const m of text.matchAll(NUMERIC_RUN)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<bdi key={n++} className="num">{m[0]}</bdi>); last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <bdi>{out}</bdi>;
}
