/**
 * The allowlisted project summary a model receives (ADR-0027, plan §7.3; core AssistantSummary). Built FIELD BY FIELD from
 * the allowlist: no document object is ever spread or passed through, so a field added to the schema later is not sent
 * until someone adds it here on purpose.
 *
 * Never read here, whatever the switches (decision 7, core ASSISTANT_NEVER_SENT): media and their bytes, asset names (file
 * names), capture dates and devices, events, transcripts and caption wording, analyses other than the beat count and bpm,
 * provenance, recipe parameters, birth dates and word choices. The document is first reduced to names only
 * (peoplePrivacy.ts namesOnly), and the builder reads `people[].id` and `.name` only, and only with toggles.peopleNames.
 *
 * Owner-typed free text — title wording, marker labels and track names (a track may be named after a child) — is sent only
 * with toggles.titlesAndMarkers. Live-field tokens in a title are written as {שדה}, so no person id or field format leaves.
 *
 * Size: at most SUMMARY_MAX_BYTES of UTF-8 JSON. When the edit is larger, clips further than ASSISTANT_FOLD_SECONDS from the
 * playhead and outside the selection are folded into per-track counts (`folded`), and then, if it is still too large, the
 * furthest of the remaining unselected clips; a selection too large to fit is refused (413) rather than cut silently.
 */
import * as T from '@pulseframe/time';
import {
  ASSISTANT_FOLD_SECONDS, ASSISTANT_SUMMARY_FIELDS, beatNumbers, clipEnd, parseFields, sequenceDuration, SUMMARY_MAX_BYTES,
  type AssistantSummary, type AssistantToggles, type Clip, type ProjectDocument,
} from '@pulseframe/core';
import { ApiError } from '../store.ts';
import { namesOnly } from '../peoplePrivacy.ts';
import type { AssistantSummaryContext } from './contract.ts';

/** The descriptor's dataSent and the «מה נשלח?» list: the summary's own fields (core). */
export const SUMMARY_FIELDS = ASSISTANT_SUMMARY_FIELDS;
/** A track's own name is cut to this many characters (plan §7.3). */
export const TRACK_NAME_MAX = 40;
/** What a live field in a title is written as: the model sees that a field is there, never which or whose. */
export const FIELD_PLACEHOLDER = '{שדה}';
/** Track names when the owner's own names are not sent: kind and position, «רצועת וידאו 2». */
const TRACK_KIND_WORDS: Record<string, string> = { video: 'וידאו', audio: 'שמע', text: 'כותרות', caption: 'כתוביות', adjustment: 'התאמה' };

type SummaryClip = AssistantSummary['clips'][number];
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8');

/** A title's wording as sent: verbatim without live fields; with them, each field (also a person's) as {שדה} and the text otherwise as stored. */
function titleText(text: string, fields: boolean): { text: string; hasFields: boolean } {
  if (!fields) return { text, hasFields: false };
  let out = '', hasFields = false;
  for (const part of parseFields(text)) {
    if ('literal' in part) out += part.literal.replace(/[{}]/g, (b) => b + b);
    else if ('token' in part) { out += FIELD_PLACEHOLDER; hasFields = true; }
    else out += part.bad.replace(/[{}]/g, (b) => b + b);
  }
  return { text: out, hasFields };
}

export function assistantSummary(input: ProjectDocument, ctx: AssistantSummaryContext, toggles: AssistantToggles): AssistantSummary {
  const doc = namesOnly(input); // and the builder below never reads birthDate or form
  const sequenceId = ctx.sequenceId ?? doc.mainSequenceId;
  const seq = Object.hasOwn(doc.sequences, sequenceId) ? doc.sequences[sequenceId] : undefined;
  if (!seq) throw new ApiError(404, 'not_found', `sequence ${sequenceId} is not in this project`, { sequenceId }, 'Leave sequenceId out for the main edit, or name one of the project\'s sequences.');
  const rate = doc.settings.frameRate;
  const titles = toggles.titlesAndMarkers === true, names = toggles.peopleNames === true;

  // asset aliases A1, A2… in the order the clips first use them (tracks bottom first, clips in timeline order)
  const alias = new Map<string, string>();
  const aliasOf = (assetId: string) => { let a = alias.get(assetId); if (!a) { a = `A${alias.size + 1}`; alias.set(assetId, a); } return a; };
  const kindCount: Record<string, number> = {};
  const tracks: AssistantSummary['tracks'] = [];
  const clips: { clip: SummaryClip; c: Clip }[] = [];
  for (const t of seq.tracks) {
    const n = (kindCount[t.kind] = (kindCount[t.kind] ?? 0) + 1);
    tracks.push({
      id: t.id, kind: t.kind,
      name: titles ? t.name.slice(0, TRACK_NAME_MAX) : `רצועת ${TRACK_KIND_WORDS[t.kind] ?? t.kind} ${n}`,
      locked: t.locked, muted: t.muted, gain: t.audio ? t.audio.gain : t.kind === 'audio' ? 1 : null,
    });
    const ordered = [...t.clips].sort((a, b) => T.cmp(a.start, b.start));
    for (const c of ordered) {
      const s: SummaryClip = {
        id: c.id, trackId: t.id, type: c.type, start: T.normalize(c.start), duration: T.normalize(c.duration),
        asset: null, assetKind: null, linked: false, gain: null, speed: null, transition: false, effects: c.effects?.length ?? 0,
      };
      if (c.type === 'media') {
        s.asset = aliasOf(c.assetId);
        const kind = Object.hasOwn(doc.assets, c.assetId) ? doc.assets[c.assetId]!.kind : null;
        s.assetKind = kind === 'video' || kind === 'image' || kind === 'audio' ? kind : null;
        s.linked = c.linkGroupId !== null;
        s.gain = c.gain;
        s.speed = c.speed ? c.speed.num / c.speed.den : 1;
        s.transition = c.transition !== undefined;
      } else if (c.type === 'text') {
        const w = titleText(c.text, c.fields === true);
        if (titles) s.text = w.text;
        else { s.chars = [...c.text].length; s.hasFields = w.hasFields; }
      }
      clips.push({ clip: s, c });
    }
  }

  // music: assets on this sequence with a beat grid (count and bpm only; never the beats themselves, nor any other analysis)
  const music: AssistantSummary['music'] = [];
  for (const [assetId, a] of alias) {
    // the file's own beats, or those of the measured music it is a time-preserving copy of (core lineage beatNumbers: the rule
    // the timeline follows), so the assistant knows the music that is followed; a copy without a recorded time mapping has none
    const n = Object.hasOwn(doc.assets, assetId) ? beatNumbers(doc, assetId) : null;
    if (n && n.count > 0) music.push({ asset: a, beats: n.count, bpm: n.bpm });
  }
  const markers: AssistantSummary['markers'] = Object.values(doc.markers ?? {})
    .filter((m) => m.sequenceId === seq.id)
    .sort((x, y) => T.cmp(x.time, y.time) || (x.id < y.id ? -1 : 1))
    .map((m) => (titles ? { time: T.normalize(m.time), label: m.label } : { time: T.normalize(m.time) }));
  const clipIds = new Set(clips.map((x) => x.c.id));
  const selection = [...new Set(ctx.selection)].filter((id) => clipIds.has(id));
  const duration = sequenceDuration(doc, seq.id);

  const build = (kept: SummaryClip[], folded: Map<string, number>): AssistantSummary => ({
    format: 'pulseframe.assistant-summary', version: 1,
    settings: { width: doc.settings.width, height: doc.settings.height, frameRate: { num: rate.num, den: rate.den } },
    duration: { time: T.normalize(duration), seconds: Number(T.toSeconds(duration).toFixed(6)) },
    playheadFrame: ctx.playheadFrame, selection, sequenceId: seq.id,
    tracks, clips: kept,
    folded: folded.size ? seq.tracks.filter((t) => folded.has(t.id)).map((t) => ({ trackId: t.id, clips: folded.get(t.id)! })) : null,
    music, markers,
    ...(names ? { people: Object.values(doc.people ?? {}).map((p) => ({ id: p.id, name: p.name })) } : {}),
    sent: { titlesAndMarkers: titles, peopleNames: names },
  });

  const all = build(clips.map((x) => x.clip), new Map());
  if (bytes(all) <= SUMMARY_MAX_BYTES) return all;

  // too large: fold unselected clips, furthest from the playhead first (those beyond ASSISTANT_FOLD_SECONDS before any other)
  const t = T.frameTime(ctx.playheadFrame, rate);
  const distance = (c: Clip) => (T.lt(t, c.start) ? T.sub(c.start, t) : T.lt(clipEnd(c), t) ? T.sub(t, clipEnd(c)) : T.ZERO);
  const selected = new Set(selection);
  const foldable = clips.map((x, i) => ({ i, d: distance(x.c), x })).filter((e) => !selected.has(e.x.c.id)).sort((a, b) => T.cmp(b.d, a.d) || a.i - b.i);
  const far = T.rt(ASSISTANT_FOLD_SECONDS, 1);
  const beyond = foldable.filter((e) => T.lt(far, e.d)).length;
  const attempt = (k: number) => {
    const out = new Set(foldable.slice(0, k).map((e) => e.i));
    const folded = new Map<string, number>();
    for (const i of out) { const tr = clips[i]!.clip.trackId; folded.set(tr, (folded.get(tr) ?? 0) + 1); }
    return build(clips.filter((_x, i) => !out.has(i)).map((x) => x.clip), folded);
  };
  let s = attempt(beyond);
  if (bytes(s) <= SUMMARY_MAX_BYTES) return s;
  // the smallest k ≥ beyond that fits (folding more never makes it larger)
  let lo = beyond, hi = foldable.length;
  s = attempt(hi);
  if (bytes(s) > SUMMARY_MAX_BYTES)
    throw new ApiError(413, 'summary_too_large', `the selection and the tracks alone take more than ${SUMMARY_MAX_BYTES} bytes to describe`, { maxBytes: SUMMARY_MAX_BYTES, selected: selection.length }, 'Select fewer clips and ask again.');
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (bytes(attempt(mid)) <= SUMMARY_MAX_BYTES) hi = mid; else lo = mid;
  }
  return attempt(hi);
}
