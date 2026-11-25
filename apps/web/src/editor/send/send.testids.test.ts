import { describe, expect, it } from 'vitest';
import { SEND_TESTIDS } from './send.testids.ts';

describe('send test ids (wave 7)', () => {
  it('are unique, kebab-case, and the ones the proofs name', () => {
    const ids = Object.values(SEND_TESTIDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(-[a-z]+)+$/);
    expect(SEND_TESTIDS.checkJump).toBe('export-check-jump');
    expect(SEND_TESTIDS.limiterSwitch).toBe('master-limiter-switch');
  });
  it.todo('C: every id is on its element in ExportSheet / SoundPanel (editor-interactions-proof rows S13, K6, L7; pnpm audit:testids)');
});
