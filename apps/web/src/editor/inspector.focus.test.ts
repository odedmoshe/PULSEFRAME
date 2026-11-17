/**
 * Keyboard focus in the inspector's live rows (spec §7: every action usable without a pointer). A row keyed by its value is
 * unmounted by every committed change, which drops the focus of the slider or number the person is using to <body>. These
 * checks read the component source (no browser here) and pin that the rows of the basic tab, the place tab, the manual
 * colour block and the text size are keyed by WHAT they edit, never by the value, and that the number beside a slider follows
 * a drag instead of being given a no-op onChange. The browser check of the same is in the W3 screenshot scripts (focus stays
 * on the control after an arrow key).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('./InspectorObject.tsx', import.meta.url), 'utf8');

describe('inspector rows keep their elements across commits', () => {
  it('no Row, range or ScrubField is keyed by a value that a commit changes', () => {
    const keyed = [...src.matchAll(/<(Row|input|ScrubField|TransformRow|GradeRow|SizeRow)\b[^>]*?\bkey=\{([^}]*\}?[^}]*)\}/g)].map((m) => `${m[1]} key=${m[2]}`);
    const byValue = keyed.filter((k) => /\$\{[^}]*(now|value|size|\bv\b)/.test(k) || /key=\{?(now|v|size|value)\b/.test(k));
    expect(byValue).toEqual([]);
  });
  it('the number beside a slider follows the drag: no ScrubField has a no-op onChange', () => {
    expect(src).not.toMatch(/<ScrubField[^>]*onChange=\{\(\) => \{/s);
  });
  it('the live rows are controlled by a draft that a commit replaces (useDraft), not by defaultValue', () => {
    for (const name of ['TransformRow', 'GradeRow', 'SizeRow']) {
      const body = src.slice(src.indexOf(`function ${name}(`), src.indexOf('\n}\n', src.indexOf(`function ${name}(`)));
      expect(body, name).toMatch(/useDraft\(/);
      expect(body, name).not.toMatch(/defaultValue=\{(now|v|size|live)/);
    }
  });
});
