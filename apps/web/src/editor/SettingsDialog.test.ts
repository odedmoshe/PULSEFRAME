import { describe, expect, it } from 'vitest';
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
