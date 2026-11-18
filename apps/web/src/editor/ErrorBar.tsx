/** The error bar under the top bar: a refused edit or a failed export, with its dismissal. Split out of panels.tsx unchanged. */
import { useEditorState } from './store.ts';
import { IconClose } from './icons.tsx';

export function ErrorBar() {
  const { editor, state, t } = useEditorState();
  const { error, exportJob: job } = state;
  if (!error && job?.status !== 'failed') return null;
  return (
    <div className="error" role="alert">
      {/* a coded refusal: translated headline, then the server's detail in its own direction (it is English) */}
      {error && state.errorHeadline && error.startsWith(`${state.errorHeadline}: `)
        ? <><span data-testid="error-headline">{state.errorHeadline}</span>: <bdi dir="auto" data-testid="error-detail">{error.slice(state.errorHeadline.length + 2)}</bdi></>
        : error ?? `${t('export.failed')}: ${job?.error?.message ?? ''}`}
      <button className="ghost" onClick={() => editor.set({ error: null, ...(job?.status === 'failed' ? { exportJob: null } : {}) })} aria-label={t('close')}><IconClose /></button>
    </div>
  );
}
