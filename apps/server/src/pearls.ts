/**
 * The read view of marked source ranges — «פנינים» (wave 7 pearls track; .artifacts/wave7/pearls-decisions.md). GET
 * /api/v1/projects/:id/pearls?sequenceId= and MCP get_pearls, both scope observe. BUILDER B owns this file; the shape is core
 * sourceRangesContract.ts PearlsView.
 *
 * RULES OF THE BODY:
 * - The document is the one the credential may read: the route and the tool hand in store.getProject's document (the reader
 *   document, peoplePrivacy.ts docForReader), and the view passes it through docForPrincipal once more (namesOnly is idempotent),
 *   so a 'names' credential reads every label as '' however the view is reached; the answer says so with labelsHidden
 *   (peopleAccess(p) !== 'full'). `verbatim` is computed from that document (false when hidden). People as { id, name } only:
 *   never a birth date, a word choice or an age.
 * - sequenceId absent = the main sequence; an unknown one is 404 not_found. Usage, screen time and the list order come from core
 *   (builder A's rangeUsage, screenTime, searchRanges); USAGE_LIMITS, SCREEN_TIME_TITLE and SCREEN_TIME_LABEL travel with the
 *   numbers. While core's functions are not built (SourceRangesNotBuilt) the view answers 501 pearls_not_built: never a made-up
 *   number. A range core reports no usage for is a fault (500 invalid_result), never a zero.
 * - byAgent = createdBy starts with 'agent:'. No label ever goes into an error, a log line, an event or a job record: errors here
 *   name ids only.
 */
import * as T from '@pulseframe/time';
import {
  isVerbatim, PEARLS_VIEW_NOTE, rangeUsage, SCREEN_TIME_LABEL, SCREEN_TIME_TITLE, screenTime, searchRanges, SourceRangesNotBuilt,
  type PearlRow, type PearlsView, type ProjectDocument, type SourceRange,
} from '@pulseframe/core';
import type { Principal } from './governance.ts';
import { docForPrincipal, peopleAccess } from './peoplePrivacy.ts';
import { ApiError } from './store.ts';

/** True once builder B has built the view (it still answers 501 while core's usage functions are not built). */
export const PEARLS_SERVER_BUILT = true;
export const PEARLS_SERVER_REFUSALS = {
  notBuilt: { status: 501, code: 'pearls_not_built', message: 'pearls are not built in this build yet', hint: 'Update the editor and try again.' },
  noUsage: { status: 500, code: 'invalid_result', message: 'the usage of a marked range is missing from the measurement', hint: 'This is a fault in this build; nothing was changed.' },
} as const;
const refuse = (r: { status: number; code: string; message: string; hint: string }, details: Record<string, unknown> = {}) => new ApiError(r.status, r.code, r.message, details, r.hint);
const own = <V>(rec: Readonly<Record<string, V>> | undefined, key: string): V | undefined => (rec && Object.hasOwn(rec, key) ? rec[key] : undefined);

/** The transcript words of the range's own file inside its span (the whole file for span null), as quotes.ts reads them. */
function wordsInside(doc: ProjectDocument, r: SourceRange): { text: string }[] {
  const tr = own(doc.transcripts, r.assetId);
  if (!tr) return [];
  const words = tr.segments.flatMap((s) => s.words);
  return r.span === null ? words : words.filter((w) => !T.lt(w.start, r.span!.start) && !T.lt(r.span!.end, T.add(w.start, w.duration)));
}

/** GET …/pearls and MCP get_pearls: the ranges with usage and screen time, as this credential may read them. */
export function pearlsView(given: ProjectDocument, revision: number, principal: Principal, sequenceId?: string): PearlsView {
  if (sequenceId !== undefined && !Object.hasOwn(given.sequences, sequenceId)) throw new ApiError(404, 'not_found', `sequence ${sequenceId} not found`, { sequenceId });
  const labelsHidden = peopleAccess(principal) !== 'full';
  const doc = docForPrincipal(given, principal);
  const seq = sequenceId ?? doc.mainSequenceId;
  let usage: ReturnType<typeof rangeUsage>, time: ReturnType<typeof screenTime>, order: string[];
  try {
    usage = rangeUsage(doc);
    time = screenTime(doc, seq);
    order = searchRanges(doc, '', {});
  } catch (e) {
    if (e instanceof SourceRangesNotBuilt) throw refuse(PEARLS_SERVER_REFUSALS.notBuilt);
    throw e;
  }
  const ranges = doc.sourceRanges ?? {};
  const rows: PearlRow[] = order.filter((id) => Object.hasOwn(ranges, id)).map((id) => {
    const r = ranges[id]!;
    const u = own(usage.ranges, id);
    if (!u) throw refuse(PEARLS_SERVER_REFUSALS.noUsage, { rangeId: id });
    const label = labelsHidden ? '' : r.label;
    return {
      id, assetId: r.assetId, assetName: own(doc.assets, r.assetId)?.name ?? '', kind: r.kind,
      span: r.span, startSeconds: r.span ? T.toSeconds(r.span.start) : null, endSeconds: r.span ? T.toSeconds(r.span.end) : null,
      label, verbatim: label !== '' && isVerbatim(label, wordsInside(doc, r)),
      people: (r.people ?? []).map((pid) => ({ id: pid, name: own(doc.people, pid)?.name ?? '' })),
      createdBy: r.createdBy, byAgent: r.createdBy.startsWith('agent:'),
      usage: u,
    };
  });
  return {
    revision, sequenceId: seq, ranges: rows, unused: usage.unused, screenTime: time, screenTimeTitle: SCREEN_TIME_TITLE, screenTimeLabel: SCREEN_TIME_LABEL,
    limits: usage.limits, labelsHidden, note: PEARLS_VIEW_NOTE,
  };
}
