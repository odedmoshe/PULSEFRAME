/**
 * The Shorts panel (ADR-0018, W3; inspector tab 'shorts', workspace 'shorts'): four steps — settings, measure, the review list
 * and the plan dialog — then «צור N קטעים» as ONE undoable step (POST /projects/:id/shorts), and the list of built shorts
 * (open, rebuild, export with sequenceId, delete). The score is shown with its rank and explanation and labelled
 * «ציון יחסי בתוך הסרטון הזה (היוריסטיקה)» (i18n shorts.score.label); never "viral", never a prediction. Platform fields
 * without a dated source read «לא אומת». Helpers: shorts.view.ts; strings: i18n shorts.*; test ids: shorts.testids.ts.
 *
 * PLACEHOLDER of the lead's contracts commit: it says plainly that the part is not built yet (i18n shorts.notBuilt) and does
 * nothing else; no candidate, score or plan is ever shown before the finder and planner exist. Not mounted yet.
 */
import type { ReactElement } from 'react';
import { dictionaries } from '@pulseframe/i18n';
import { useEditorState } from './store.ts';
import { SHORTS_TESTIDS } from './shorts.testids.ts';

export function ShortsPanel(): ReactElement {
  const { state } = useEditorState();
  const t = dictionaries[state.lang];
  return (
    <section data-testid={SHORTS_TESTIDS.panel} aria-labelledby="shorts-panel-title" dir={state.lang === 'he' ? 'rtl' : 'ltr'}>
      <h2 id="shorts-panel-title">{t['shorts.title']}</h2>
      <p data-testid={SHORTS_TESTIDS.notBuilt}>{t['shorts.notBuilt']}</p>
    </section>
  );
}
