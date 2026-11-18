import { describe, expect, it } from 'vitest';
import { translateRefusal } from './refusals.ts';

// The two validation sentences of core fields.ts lifeIssues (code life_unknown_field), as a commit refuses them.
describe('a brace group that is not a field, in a title with live fields', () => {
  it('is worded in Hebrew and keeps the offending groups', () => {
    const a = translateRefusal('he', 'transaction would produce an invalid project: title clip_7 has live fields, and these brace groups in it are not fields: {dat}, {x}');
    expect(a).toContain('{dat}, {x}');
    expect(a).toMatch(/[֐-׿]/);
    expect(a).not.toMatch(/transaction|invalid project/);
    const b = translateRefusal('he', 'transaction would produce an invalid project: title clip_7 has live fields, and these brace groups in its wording for format var_2 are not fields: {dat}');
    expect(b).toContain('{dat}');
    expect(b).not.toMatch(/transaction|invalid project/);
    expect(b).not.toBe(a);
  });
});
