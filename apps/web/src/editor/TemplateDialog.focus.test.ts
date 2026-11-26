/**
 * The template dialog moves the focus to a step's heading when the step changes. It must do so in the commit that draws the step
 * (a layout effect), not in a later task: a deferred focus() (setTimeout) fired after the person, or Playwright, had already gone to
 * the texts step's field, and a Hebrew letter typed there landed on the heading (editor-interactions, 2026-11-26: «יום הולדת שמח»
 * counted 12). There is no DOM in the unit tests, so this reads the source; editor-interactions checks the focus in a real browser
 * (Back and Next clicked in one page task, the heading focused before any timer runs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const code = fs.readFileSync(path.join(import.meta.dirname, 'TemplateDialog.tsx'), 'utf8');
const goBody = (() => { const at = code.indexOf('const go = (s: Step) =>'); expect(at).toBeGreaterThan(0); return code.slice(at, code.indexOf('\n  };', at)); })();

describe('the template dialog\'s step focus', () => {
  it('go() does not defer the heading focus to a timer', () => {
    expect(goBody).not.toMatch(/setTimeout|requestAnimationFrame|queueMicrotask/);
  });
  it('a layout effect on the step focuses the new step\'s heading', () => {
    expect(code).toMatch(/import \{[^}]*\buseLayoutEffect\b[^}]*\} from 'react'/);
    const effect = code.slice(code.indexOf('useLayoutEffect(() => {'));
    expect(effect.slice(0, effect.indexOf('}, [step, titleId]);'))).toMatch(/document\.getElementById\(`\$\{titleId\}-\$\{step\}`\)\?\.focus\(\)/);
  });
});
