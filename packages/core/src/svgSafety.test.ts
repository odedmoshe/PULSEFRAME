import { describe, expect, it } from 'vitest';
import { elementSvg, ELEMENT_IDS } from './index.ts';
import { sanitiseSvg, SVG_MAX_BYTES } from './svgSafety.ts';

const ok = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24" width="24" height="24"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs><path fill="url(#g)" d="M0 0h24v24H0z"/><use xlink:href="#g"/></svg>';
const wrap = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`;

describe('sanitiseSvg', () => {
  it('passes a plain SVG unchanged (never repairs)', () => {
    expect(sanitiseSvg(ok)).toEqual({ ok: true, svg: ok });
    expect(sanitiseSvg(`<?xml version="1.0" encoding="UTF-8"?>\n<!-- made by hand -->\n${ok}`).ok).toBe(true);
    expect(sanitiseSvg(wrap('<text>Tom &amp; Jerry &#x5D0;</text>')).ok).toBe(true);
  });
  it('passes every built-in element formula (our own SVG)', () => {
    for (const id of ELEMENT_IDS) expect({ id, ok: sanitiseSvg(elementSvg(id, { color: '#ffffff', color2: '#00aaaa' })).ok }).toEqual({ id, ok: true });
  });
  const refused: [string, string][] = [
    ['script', wrap('<script>alert(1)</script>')],
    ['prefixed script', '<svg:svg xmlns:svg="http://www.w3.org/2000/svg"><svg:script>x</svg:script></svg:svg>'],
    ['upper-case script', wrap('<SCRIPT>x</SCRIPT>')],
    ['script inside a comment', wrap('<!-- <script> -->')],
    ['foreignObject', wrap('<foreignObject><div/></foreignObject>')],
    ['image', wrap('<image href="#x"/>')],
    ['feImage', wrap('<filter><feImage href="#a"/></filter>')],
    ['iframe', wrap('<iframe/>')],
    ['link element', wrap('<a href="#x"><rect/></a>')],
    ['link element, no attributes', wrap('<a><rect/></a>')],
    ['animate', wrap('<rect><animate attributeName="x"/></rect>')],
    ['animateTransform', wrap('<rect><animateTransform/></rect>')],
    ['set', wrap('<rect><set attributeName="fill" to="red"/></rect>')],
    ['onload', '<svg onload="alert(1)" xmlns="http://www.w3.org/2000/svg"/>'],
    ['onclick after slash', '<svg/onclick="x" xmlns="http://www.w3.org/2000/svg"></svg>'],
    ['entity declaration', '<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg>&a;</svg>'],
    ['external DTD', '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg/>'],
    ['undeclared entity', wrap('<text>&nbsp;</text>')],
    ['xml-stylesheet', '<?xml-stylesheet href="a.css"?><svg/>'],
    ['@import', wrap('<style>@import "x.css";</style>')],
    ['outside href', wrap('<use href="other.svg#a"/>')],
    ['outside xlink:href', wrap('<use xlink:href="http://example.com/a.svg#b"/>')],
    ['unquoted href', wrap('<use href=#a />')],
    ['outside url()', wrap('<rect style="fill:url(http://example.com/x.png)"/>')],
    ['quoted outside url()', wrap('<rect fill="url(\'file:///etc/passwd\')"/>')],
    ['javascript:', wrap('<rect fill="javascript:x"/>')],
    ['data:', wrap('<rect style="fill:url(data:image/png;base64,AAAA)"/>')],
    ['xml:base', wrap('<g xml:base="http://x/"/>')],
    ['other encoding', '<?xml version="1.0" encoding="UTF-16"?><svg/>'],
    ['NUL', wrap('<g>\u0000</g>')],
    ['not UTF-8', wrap('<g>�</g>')],
    ['not svg', '<html><body/></html>'],
    ['empty', ''],
  ];
  for (const [name, text] of refused) {
    it(`refuses: ${name}`, () => {
      const r = sanitiseSvg(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.why.length).toBeGreaterThan(5);
    });
  }
  it('refuses text above the size limit', () => {
    expect(sanitiseSvg(wrap(`<g>${'x'.repeat(SVG_MAX_BYTES)}</g>`))).toEqual({ ok: false, why: `it is larger than ${SVG_MAX_BYTES} bytes` });
  });
});
