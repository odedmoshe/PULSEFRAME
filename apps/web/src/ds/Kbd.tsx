import { DS, cx } from './util.tsx';

/** Key cap. `he` is the Hebrew-layout glyph on the same physical key (S ד, J ח, K ל, L ך): shown beside the Latin one. Bound by KeyboardEvent.code elsewhere. */
export const HEBREW_KEY_GLYPH: Readonly<Record<string, string>> = { Q: '/', W: "'", E: 'ק', R: 'ר', T: 'א', Y: 'ט', U: 'ו', I: 'ן', O: 'ם', P: 'פ', A: 'ש', S: 'ד', D: 'ג', F: 'כ', G: 'ע', H: 'י', J: 'ח', K: 'ל', L: 'ך', Z: 'ז', X: 'ס', C: 'ב', V: 'ה', B: 'נ', N: 'מ', M: 'צ' };
export function Kbd({ k, he, className }: { k: string; /** override or add the Hebrew glyph; `false` hides it */ he?: string | false; className?: string }) {
  const glyph = he === false ? undefined : he ?? (k.length === 1 ? HEBREW_KEY_GLYPH[k.toUpperCase()] : undefined);
  return <kbd className={cx(DS, 'pf-kbd', className)}><span>{k}</span>{glyph && <span className="pf-kbd-he" lang="he">{glyph}</span>}</kbd>;
}
/** A shortcut: several caps in a row ("Ctrl" "Shift" "Z"), always LTR. */
export function Keys({ keys }: { keys: readonly string[] }) {
  return <span className="pf-keys" dir="ltr">{keys.map((k, i) => <Kbd key={`${k}${i}`} k={k} />)}</span>;
}
