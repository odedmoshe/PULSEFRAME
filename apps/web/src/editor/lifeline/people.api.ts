/**
 * REST calls of the people step (ADR-0021, people section). Every persistent edit of people is an operation through
 * Editor.commit (add_person, update_person, remove_person); these are reads. Both answer the owner's own session only
 * (403 owner_required for any token), and both answer 501 until W2 builds them.
 */
import { ApiFailure } from '../../api.ts';

/** One person as another project of the owner holds them (apps/server/src/lifeline.ts PersonSuggestion). */
export interface PersonSuggestion { name: string; birthDate: string | null; form?: 'm' | 'f'; projectId: string; projectName: string }
async function call<R>(path: string): Promise<R> {
  const r = await fetch(`/api/v1${path}`, { credentials: 'same-origin' });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : undefined;
  if (!r.ok) throw new ApiFailure(r.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `HTTP ${r.status}`, data?.error?.details, data?.error?.hint);
  return data as R;
}
export const peopleApi = {
  /** People already entered in the owner's other projects («העתקה מפרויקט אחר»). */
  suggestions: () => call<{ people: PersonSuggestion[] }>('/people-suggestions'),
  /** What the archive «בלי פרטי משפחה» would change: titles frozen at their first value, titles whose people field has no words. */
  familyCheck: (projectId: string) => call<{ varying: string[]; empty: string[] }>(`/projects/${encodeURIComponent(projectId)}/archive/family-check`),
  /** The download link of the archive; `omit` = «בלי פרטי משפחה». */
  archiveUrl: (projectId: string, family: 'keep' | 'omit') => `/api/v1/projects/${encodeURIComponent(projectId)}/archive${family === 'omit' ? '?family=omit' : ''}`,
};
