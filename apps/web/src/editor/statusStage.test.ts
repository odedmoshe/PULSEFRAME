import { describe, expect, it } from 'vitest';
import { capStageLabel } from './statusStage.ts';

describe('capStageLabel', () => {
  it('turns the server stage words into the owner language', () => {
    expect(capStageLabel('submitting', 'he')).toBe('שולח');
    expect(capStageLabel('queued (waiting for compute: x)', 'en')).toBe('waiting in line');
    expect(capStageLabel('transfer (downloading outputs)', 'he')).toBe('מקבל את התוצאה');
    expect(capStageLabel('preparing', 'he')).toBe('מכין');
  });
  it('never shows a stage it does not know as raw text', () => {
    expect(capStageLabel('flux-capacitor 3/4', 'he')).toBe('בעבודה');
    expect(capStageLabel(null, 'en')).toBe('');
  });
});
