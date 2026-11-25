/**
 * Third-party SVG before it reaches the rasteriser (wave 7 library track; plan §4.2). WORKER A builds the body.
 * Refuses — never repairs — on any of: `<script`, `<foreignObject`, `<image`, `<iframe`, `<a `, animation elements (`<animate`,
 * `<set`), an `on…=` attribute, `<!ENTITY` or a DOCTYPE internal subset, `xml-stylesheet`, `@import`, any `href` or `url(` that is
 * not a `#fragment`; and text above SVG_MAX_BYTES. Case-insensitive. Third-party SVG never reaches the browser either way.
 */
export const SVG_MAX_BYTES = 512 * 1024;
export type SvgCheck = { ok: true; svg: string } | { ok: false; why: string };
/** Until worker A builds it, every SVG is refused (fail-closed). */
export function sanitiseSvg(text: string): SvgCheck {
  void text;
  return { ok: false, why: 'the SVG check is not built yet' };
}
