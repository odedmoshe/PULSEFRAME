import { describe, expect, it } from 'vitest';
import { isConnectionCheck } from './AiTools.tsx';

describe('the connection check is not one of the owner tools', () => {
  it('is recognised by its id, whatever inputs it has', () => {
    expect(isConnectionCheck({ id: 'comfy.smoke.solid-image' })).toBe(true);
    expect(isConnectionCheck({ id: 'comfy.image.upscale' })).toBe(false);
    expect(isConnectionCheck({ id: 'local.voice.clean' })).toBe(false);
  });
});
