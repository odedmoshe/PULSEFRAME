import { describe, expect, it } from 'vitest';
import { isConnectionCheck } from './AiTools.tsx';

describe('the connection check is not one of the owner tools', () => {
  it('is recognised by its id, whatever inputs it has', () => {
    expect(isConnectionCheck({ id: 'comfy.smoke.solid-image' })).toBe(true);
    expect(isConnectionCheck({ id: 'comfy.image.upscale' })).toBe(false);
    expect(isConnectionCheck({ id: 'local.voice.clean' })).toBe(false);
  });
});

describe('installer details on a tool card (owner rule: no developer language)', () => {
  it('drops environment variable names, addresses and paths, and says nothing when only that was there', async () => {
    const { installerDetail } = await import('./AiTools.tsx');
    expect(installerDetail('PF_COMFYUI_URL is not set', 'en')).toBeNull();
    expect(installerDetail('PF_COMFYUI_URL is not set', 'he')).toBeNull();
    const d = installerDetail('deep-filter exited 127: /usr/local/bin/deep-filter not found (PF_DENOISE_BIN) at http://127.0.0.1:8188/x', 'en')!;
    expect(d).not.toMatch(/PF_|http|\/usr/);
    expect(d).toContain('deep-filter exited 127');
    expect(installerDetail(undefined, 'he')).toBeNull();
  });
});
