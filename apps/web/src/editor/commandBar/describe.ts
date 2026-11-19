/**
 * The preview's words (ADR-0027; plan §4.5, §6): a plan step as dictionaries[lang]['op.' + op] plus a sentence for its
 * StepDetail, a note in words, an action in words, and describeCall for any public op (the assistant's proposals), falling back
 * to the op words. Pure: the strings come from commandBar.strings.ts. Values that keep their own direction (times, dB, frame
 * numbers) are wrapped by ltr(); names and typed words by auto() (BarPreview turns the isolates into <bdi>).
 */
import * as T from '@pulseframe/time';
import { TRANSITIONS, findClip, type BarAction, type BarNote, type OpCall, type PlanStep, type ProjectDocument, type StepDetail } from '@pulseframe/core';
import { dictionaries, translateRefusal, type Lang } from '@pulseframe/i18n';
import { CHROME_STRINGS } from '../chrome.strings.ts';
import { COMMANDS } from '../commands.ts';
import { auto, barText, ltr, type BarTextKey } from './commandBar.strings.ts';

export interface StepWords { op: string; detail: string }

/** The op's words in the interface language; the op name itself when the dictionary has none. */
export function opWords(op: string, lang: Lang): string {
  return (dictionaries[lang] as Record<string, string>)[`op.${op}`] || op;
}
/** 0:12.05 (minutes, seconds, hundredths): display only, never stored. */
export function showTime(t: T.RationalTime): string {
  const cs = Math.round(T.toSeconds(t) * 100);
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}
const num = (n: number): string => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));
const transitionName = (type: string, lang: Lang): string => TRANSITIONS.find((x) => x.id === type)?.name[lang] ?? type;

export function describeDetail(d: StepDetail, lang: Lang): string {
  const t = (k: BarTextKey, v?: Record<string, string | number>) => barText(lang, k, v);
  switch (d.kind) {
    case 'at': return t(d.rounded ? 'detail.at.rounded' : 'detail.at', { time: ltr(showTime(d.time)), frame: ltr(d.frame) });
    case 'span': return t('detail.span', { from: ltr(d.fromFrame), to: ltr(d.toFrame) });
    case 'clip': return t('detail.clip', { name: auto(d.name) });
    case 'track': return t('detail.track', { name: auto(d.name) });
    case 'gain': return t('detail.gain', { from: ltr(num(d.fromLinear)), to: ltr(num(d.toLinear)), db: ltr(d.db) });
    case 'transition': return t('detail.transition', { type: transitionName(d.type, lang), frames: ltr(d.frames), name: auto(d.name) });
    case 'text': return t('detail.text', { chars: ltr(d.chars), start: ltr(d.startFrame), frames: ltr(d.durationFrames) });
    case 'count': return t('detail.count', { n: ltr(d.n), of: ltr(d.of) });
    case 'speed': return t('detail.speed', { from: ltr(`×${num(d.from)}`), to: ltr(`×${num(d.to)}`) });
    case 'rename': return t('detail.rename', { to: auto(d.to) });
    case 'plain': return t('detail.plain');
  }
}
export function describeStep(step: PlanStep, lang: Lang): StepWords {
  return { op: opWords(step.op, lang), detail: describeDetail(step.detail, lang) };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** The names in a note's list: plain strings, or the grammar's {clipId|trackId, name} rows (core commandBar plans.ts, resolve.ts). */
export const noteNames = (v: unknown): string[] => (Array.isArray(v) ? v : []).map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? str((x as { name?: unknown }).name) ?? str((x as { clipId?: unknown }).clipId) ?? str((x as { trackId?: unknown }).trackId) : null)).filter((x): x is string => !!x);
const names = (lang: Lang, v: unknown): string => {
  const all = noteNames(v);
  const list = all.slice(0, 8);
  return list.length ? barText(lang, 'note.names', { list: list.map(auto).join(', ') + (all.length > list.length ? ` (+${ltr(all.length - list.length)})` : '') }) : '';
};
/** A time in a note's data: a RationalTime, or seconds as a number or an exact decimal or fraction text ('3/2'). */
const noteTime = (v: unknown): string | null => {
  if (T.isRationalTime(v)) return showTime(v);
  if (int(v) !== null) return showTime(T.fromSeconds(String(v)));
  const m = typeof v === 'string' ? /^(\d+)(?:\/(\d+))?$/.exec(v) : null;
  return m ? showTime(T.rt(m[1]!, Number(m[2] ?? 1))) : null;
};
/** What a default stood for (the grammar's {field, value, seconds, frames, frame}). */
function defaultWhat(d: Record<string, unknown>, lang: Lang): string | null {
  const he = lang === 'he';
  const field = str(d.field);
  if (str(d.what)) return str(d.what);
  if (d.value === 'playhead') return int(d.frame) !== null ? (he ? `הסמן, פריים ${ltr(d.frame as number)}` : `the playhead, frame ${ltr(d.frame as number)}`) : (he ? 'הסמן' : 'the playhead');
  if (field === 'type' && str(d.value)) return transitionName(d.value as string, lang);
  if (int(d.seconds) !== null) return he ? `${ltr(num(d.seconds as number))} שניות` : `${ltr(num(d.seconds as number))} seconds`;
  if (int(d.frames) !== null) return he ? `${ltr(d.frames as number)} פריימים` : `${ltr(d.frames as number)} frames`;
  return str(d.text);
}

/**
 * A note in words. The data's shape belongs to the grammar (core commandBar/: default_used {field, value, seconds, frames,
 * frame}; rounded_to_frame {frame, time}; skipped_* {clips | tracks: [{…Id, name}]}; ripple_moves {moved}; alternative_reading
 * {intents}); plain lists and the keys n/count/names are read too, and every note has a sentence without any data.
 */
export function describeNote(note: BarNote, lang: Lang): string {
  const t = (k: BarTextKey, v?: Record<string, string | number>) => barText(lang, k, v);
  const d = note.data ?? {};
  const listed = d.names ?? d.clips ?? d.tracks ?? d.list;
  const n = int(d.n) ?? int(d.count) ?? int(d.moved) ?? (Array.isArray(listed) ? listed.length : null);
  const list = names(lang, listed);
  switch (note.code) {
    case 'default_used': {
      const what = defaultWhat(d, lang);
      return what ? t('note.default_used', { what }) : t('note.default_used.plain');
    }
    case 'rounded_to_frame': {
      const time = noteTime(d.time ?? d.seconds ?? d.to);
      const frame = int(d.frame);
      return time && frame !== null ? t('note.rounded_to_frame', { time: ltr(time), frame: ltr(frame) }) : t('note.rounded_to_frame.plain');
    }
    case 'skipped_locked': return t('note.skipped_locked', { names: list });
    case 'skipped_no_handle': return t('note.skipped_no_handle', { n: ltr(n ?? 0), names: list });
    case 'skipped_has_transition': return t('note.skipped_has_transition', { n: ltr(n ?? 0), names: list });
    case 'ripple_moves': return t('note.ripple_moves', { n: ltr(n ?? 0) });
    case 'applies_to_master': return t('note.applies_to_master');
    case 'alternative_reading': {
      const what = str(d[lang]) ?? str(d.what);
      const intents = (Array.isArray(d.intents) ? d.intents : str(d.intent) ? [d.intent] : []).filter((x): x is string => typeof x === 'string');
      const words = what ?? (intents.length ? intents.map((i) => intentName(i, lang)).join(lang === 'he' ? ' או ' : ' or ') : null);
      return words ? t('note.alternative_reading', { what: auto(words) }) : t('note.alternative_reading.plain');
    }
    case 'no_beat_analysis': return t('note.no_beat_analysis');
  }
}

const commandName = (id: string, lang: Lang): string => {
  const c = COMMANDS.find((x) => x.id === id);
  return c ? (c.text?.[lang] ?? (dictionaries[lang] as Record<string, string>)[c.label] ?? id) : id;
};
const opList = (ops: readonly string[], lang: Lang): string => [...new Set(ops)].map((o) => opWords(o, lang)).join(', ');
/** An action in words (what Enter will do; never a project change). `rate` lets a seek show its time. */
export function describeAction(a: BarAction, lang: Lang, rate?: T.Rate): string {
  const t = (k: BarTextKey, v?: Record<string, string | number>) => barText(lang, k, v);
  switch (a.kind) {
    case 'undo': return a.ops.length ? t('act.undo', { what: opList(a.ops, lang) }) : t('act.undo.plain');
    case 'redo': return a.ops.length ? t('act.redo', { what: opList(a.ops, lang) }) : t('act.redo.plain');
    case 'workspace': return t('act.workspace', { name: CHROME_STRINGS[lang].modes[a.workspace as keyof (typeof CHROME_STRINGS)['he']['modes']] ?? a.workspace });
    case 'export_sheet': return t('act.export_sheet', { dest: t(`dest.${a.destination}` as BarTextKey) });
    case 'seek': return rate ? t('act.seek.time', { frame: ltr(a.frame), time: ltr(showTime(T.frameTime(a.frame, rate))) }) : t('act.seek', { frame: ltr(a.frame) });
    case 'play': return t('act.play');
    case 'pause': return t('act.pause');
    case 'select_all': return t('act.select_all');
    case 'deselect': return t('act.deselect');
    case 'zoom': return t(a.dir > 0 ? 'act.zoom.in' : 'act.zoom.out');
    case 'language': return t(a.to === 'he' ? 'act.language.he' : 'act.language.en');
    case 'command': return t('act.command', { name: auto(commandName(a.commandId, lang)) });
    case 'recipe': return t('act.recipe', { name: auto(a.recipeId) });
  }
}

const clipLabel = (doc: ProjectDocument, id: unknown): string | null => {
  if (typeof id !== 'string') return null;
  const f = findClip(doc, id);
  if (!f) return null;
  const c = f.clip;
  const name = c.type === 'media' ? doc.assets[c.assetId]?.name : c.type === 'adjustment' ? c.label : c.type === 'text' ? c.text : undefined;
  return name?.replace(/\s+/g, ' ').trim().slice(0, 40) || id;
};
const trackLabel = (doc: ProjectDocument, id: unknown): string | null => {
  if (typeof id !== 'string') return null;
  for (const s of Object.values(doc.sequences)) { const tr = s.tracks.find((x) => x.id === id); if (tr) return tr.name || id; }
  return null;
};
/**
 * Any public op call (the assistant's proposals) in words: the op words, and a detail built from what its arguments name that
 * the document knows (clip, track, a time, a count). An op with nothing recognisable has the op words only (detail is '').
 */
export function describeCall(doc: ProjectDocument, call: OpCall, lang: Lang): StepWords {
  const a = (call.args ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  const clip = clipLabel(doc, a.clipId);
  if (clip) parts.push(barText(lang, 'detail.clip', { name: auto(clip) }));
  const track = trackLabel(doc, a.trackId);
  if (track) parts.push(barText(lang, 'detail.track', { name: auto(track) }));
  if (Array.isArray(a.clipIds) && a.clipIds.length) parts.push(barText(lang, 'detail.count', { n: ltr(a.clipIds.length), of: ltr(a.clipIds.length) }));
  for (const k of ['at', 'start', 'time']) if (T.isRationalTime(a[k])) { parts.push(ltr(showTime(a[k] as T.RationalTime))); break; }
  const name = str(a.name) ?? str(a.to);
  if (name && call.op.startsWith('rename')) parts.push(barText(lang, 'detail.rename', { to: auto(name) }));
  return { op: opWords(call.op, lang), detail: parts.join(' · ') };
}

/** The words of an intent, for the live region and alternatives. */
export const intentName = (intent: string, lang: Lang): string => {
  const k = `intent.${intent}` as BarTextKey;
  const w = barText(lang, k);
  return w === `intent.${intent}` || !w ? intent : w;
};

/**
 * A server refusal (a commit the server refused, an assistant route or job error) in the interface language, with the next
 * step (lead decision: a refusal shown in the bar or in Settings gives the owner a Hebrew next step when the UI is Hebrew).
 * Hebrew: the refusal's own Hebrew sentence (translateRefusal; it carries the way forward), else the code's headline
 * (error.code.*) with the bar's Hebrew next step; the server's English sentence and hint are shown ONLY when no Hebrew
 * wording exists, and then marked as not translated (`untranslated`), beside a Hebrew next step. English: the server's own
 * sentence and hint.
 */
export interface RefusalWords { reason: string; next: string | null; untranslated: { message: string; hint: string | null } | null }
export function refusalWords(lang: Lang, e: { code?: string | null; message?: string | null; hint?: string | null } | null | undefined): RefusalWords {
  const code = e?.code ?? null, message = e?.message?.trim() || null, hint = e?.hint?.trim() || null;
  const d = dictionaries[lang] as Record<string, string>;
  const headline = code ? d[`error.code.${code}`] ?? null : null;
  if (lang === 'en') return { reason: message ?? headline ?? d['error.generic'] ?? 'The action failed', next: hint ?? barText('en', 'fail.hint'), untranslated: null };
  const said = message ? translateRefusal('he', message) : undefined;
  if (said) return { reason: said, next: null, untranslated: null };
  if (headline) return { reason: headline, next: barText('he', 'fail.hint'), untranslated: null };
  return { reason: d['error.generic'] ?? 'הפעולה נכשלה', next: barText('he', 'fail.hint'), untranslated: message || hint ? { message: message ?? '', hint } : null };
}
/** The same words as one plain line (a live region, a note in Settings): the untranslated part follows its Hebrew mark. */
export function refusalLine(lang: Lang, w: RefusalWords): string {
  const tail = w.untranslated ? ` (${(dictionaries[lang] as Record<string, string>)['refusal.untranslated']}: ${[w.untranslated.message, w.untranslated.hint].filter(Boolean).join(' ')})` : '';
  return `${w.reason}${w.next ? `. ${w.next}` : ''}${tail}`;
}
