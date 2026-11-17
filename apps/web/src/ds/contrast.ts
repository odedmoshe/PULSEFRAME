/** WCAG 2.x contrast maths and a small reader for the token sheet. Pure: used by the token-contrast test. */
export type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`not a solid hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}
export function luminance([r, g, b]: Rgb): number {
  const f = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(a: string, b: string): number {
  const la = luminance(parseHex(a)), lb = luminance(parseHex(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Custom properties declared in one rule body: `--name: value;` (comments removed, values trimmed). */
export function parseDecls(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0, cur = '';
  const parts: string[] = [];
  for (const ch of clean) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ';' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  for (const p of parts) { const i = p.indexOf(':'); if (i > 0 && p.trim().startsWith('--')) out[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }
  return out;
}

/** The dark and light token maps of tokens.css. Light is dark plus the light overrides (what a viewer sees). */
export function readThemes(css: string): { dark: Record<string, string>; light: Record<string, string> } {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const body = (head: RegExp): string => {
    const m = head.exec(clean);
    if (!m) throw new Error(`tokens.css: no rule matches ${head}`);
    const open = clean.indexOf('{', m.index);
    let depth = 1, j = open + 1;
    for (; j < clean.length && depth > 0; j++) { if (clean[j] === '{') depth++; else if (clean[j] === '}') depth--; }
    return clean.slice(open + 1, j - 1);
  };
  const dark = parseDecls(body(/:root,\s*:root\[data-theme="dark"\]\s*\{/));
  const light = { ...dark, ...parseDecls(body(/:root\[data-theme="light"\]\s*\{/)) };
  return { dark, light };
}
