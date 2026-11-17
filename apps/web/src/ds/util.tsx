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
