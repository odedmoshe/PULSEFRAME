import { describe, expect, it } from 'vitest';
import { gradeT, pointLabel, pointValueText, presetName } from './grade.strings.ts';

describe('grade strings', () => {
  it('fill the point label and value text in both languages, and name the presets', () => {
    expect(pointLabel('he', 'master', 2, 4)).toBe('נקודה 2 מתוך 4 בעקומה הכללית');
    expect(pointLabel('en', 'r', 1, 3)).toBe('Point 1 of 3 on the red curve');
    expect(pointValueText('he', 64, 80)).toBe('כניסה 64, יציאה 80');
    expect(pointValueText('en', 64, 80)).toBe('in 64, out 80');
    expect(presetName('he', 'film')).toBe('מראה קולנועי');
    expect(gradeT('en')('graph', { channel: 'Master' })).toMatch(/^Master curve/);
    expect(gradeT('he')('zebraPaused')).toBe('זברה מוצגת כשהניגון עוצר');
  });
});
