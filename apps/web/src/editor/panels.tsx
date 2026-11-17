/**
 * The editor's panels now live in their own files (UI redesign pre-pass: a mechanical split, no behaviour change).
 * This file only re-exports them, so existing imports keep working; import from the panel's own file in new code.
 */
export { Header } from './Header.tsx';
export { ErrorBar } from './ErrorBar.tsx';
export { Library } from './Library.tsx';
export { Transport } from './Transport.tsx';
export { Inspector } from './Inspector.tsx';
