import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Seg } from '../ds/index.ts';
import { CHROME_STRINGS } from './chrome.strings.ts';
import { capRows } from './SettingsDialog.tsx';

describe('capRows', () => {
  for (const lang of ['he', 'en'] as const) {
    it(`${lang}: a provider that is not set up is said plainly, never with the server's reason text`, () => {
      const rows = capRows({ available: false, reason: 'no adapter (WebGPU)' } as never, { provider: { configured: false, reason: 'PF_COMFYUI_URL is not set' } } as never, CHROME_STRINGS[lang]);
      const text = JSON.stringify(rows);
      expect(text).not.toMatch(/PF_|WebGPU|is not set/);
      expect(rows.find((r) => r.id === 'ai')?.why).toBe(CHROME_STRINGS[lang].aiWhy);
    });
  }
});

describe('the picture while playing (Settings)', () => {
  it('both languages name the two choices and explain the cost in one line: frames may drop without a graphics card', () => {
    expect(CHROME_STRINGS.he).toMatchObject({ playSmooth: 'חלק', playSharper: 'חד יותר' });
    expect(CHROME_STRINGS.en).toMatchObject({ playSmooth: 'Smooth', playSharper: 'Sharper' });
    expect(CHROME_STRINGS.he.playSharpnessWhy).toMatch(/פריימים/);
    expect(CHROME_STRINGS.he.playSharpnessWhy).toMatch(/כרטיס גרפי/);
    expect(CHROME_STRINGS.en.playSharpnessWhy).toMatch(/drop frames/);
    expect(CHROME_STRINGS.en.playSharpnessWhy).toMatch(/graphics card/);
    for (const lang of ['he', 'en'] as const) { expect(CHROME_STRINGS[lang].playSharpness.length).toBeGreaterThan(0); expect(CHROME_STRINGS[lang].playSharpnessWhy).not.toMatch(/\n/); }
    expect(CHROME_STRINGS.he.playSharpnessWhy).not.toMatch(/[A-Za-z]{3,}/); // Hebrew wording throughout
  });
  it('the dialog draws the choice from the editor\'s state and sends it to setPlaySharpness, with the explanation tied to the control', () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, 'SettingsDialog.tsx'), 'utf8');
    expect(src).toContain('value={state.playSharpness} onChange={(v) => editor.setPlaySharpness(v)}');
    expect(src).toContain('describedBy="pf-set-play-sharpness-why"');
    expect(src).toContain('id="pf-set-play-sharpness-why">{S.playSharpnessWhy}');
    const html = renderToStaticMarkup(createElement(Seg, { label: 'x', describedBy: 'why', value: 'smooth', onChange: () => {}, options: [{ value: 'smooth', label: 'a' }, { value: 'sharper', label: 'b' }] }));
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-describedby="why"');
    expect(renderToStaticMarkup(createElement(Seg, { label: 'x', value: 'a', onChange: () => {}, options: [{ value: 'a', label: 'a' }] }))).not.toContain('aria-describedby');
  });
});
