/**
 * The booth report «העתקת הדוח» (wave 8 booth track; verify C4). BUILDER W1 writes the bodies; the signatures and the format are the
 * lead's (booth/contract.ts BOOTH_BLOCK_BEGIN/END, BoothBlockSchema) and do not change.
 *
 * FORMAT (plain text, one language for the human part, then the machine block):
 *   PULSEFRAME — <booth.report.title> · <date> · build <commit>
 *   <booth.report.counts: answered of the first sitting / of everything shown, ok, bad, skipped, changed since>
 *   <booth.report.bad>: one line per 'bad' answer: id «title» — problems — "note" (the note as stored, already scrubbed on the server)
 *   <booth.report.checks>: one line per self-check row: title — state words (no data values but versions and adapter vendor)
 *   -----BEGIN PF-BOOTH 1-----
 *   <BoothBlock JSON, ASCII only, cut into lines of at most 64 characters>
 *   sha256:<hex of those lines joined without line breaks>
 *   -----END PF-BOOTH 1-----
 * Never in it: paths, the data or library folder, user, host, project, asset, file or people names, birth dates, IP addresses, the
 * drop's address, tokens. Notes go only into the human part (scrubbed), never into the block.
 */
import { sha256Hex } from '../sha256.ts';
import {
  BOOTH_BLOCK_BEGIN, BOOTH_BLOCK_END, BOOTH_FIRST_GROUPS, BOOTH_LIMITS, BoothBlockSchema, BoothCheckRowSchema,
  type BoothBlock, type BoothBlockParse, type BoothItemView, type BoothReportInput, type BoothSay,
} from './contract.ts';

const counts = (views: readonly BoothItemView[]) => {
  const answered = views.filter((v) => v.state === 'answered');
  return {
    done: answered.length, total: views.length,
    ok: answered.filter((v) => v.answer!.verdict === 'ok').length, bad: answered.filter((v) => v.answer!.verdict === 'bad').length,
    skip: answered.filter((v) => v.answer!.verdict === 'skip').length, changed: views.filter((v) => v.state === 'changed').length,
  };
};
/** The words for a row's reason code, when the strings have them (`booth.check.<id>.<code>`, then `booth.check.<code>`). */
function codeWords(say: BoothSay, id: string, code: string | null): string | null {
  if (!code) return null;
  for (const key of [`booth.check.${id}.${code}`, `booth.check.${code}`]) {
    const w = say(key);
    if (w && w !== key) return w;
  }
  return null;
}
const oneLine = (t: string) => t.replace(/[\r\n\t]+/g, ' ').trim();

/** The whole report text (human part + machine block). Pure; same in Node and Chromium. */
export function boothReport(input: BoothReportInput, say: BoothSay): string {
  const { view, date } = input;
  const hebrew = /[֐-׿]/.test(say('booth.title'));
  const lines: string[] = [`${say('booth.report.title')} · ${date} · build ${view.build.commit}`];
  const first = view.items.filter((v) => BOOTH_FIRST_GROUPS.includes(v.item.group));
  lines.push(say('booth.report.counts', counts(first)));
  if (first.length < view.items.length && view.items.some((v) => !BOOTH_FIRST_GROUPS.includes(v.item.group) && v.answer)) lines.push(`${say('booth.more')}: ${say('booth.report.counts', counts(view.items))}`);
  lines.push(say('booth.report.bad'));
  const bad = view.items.filter((v) => v.state === 'answered' && v.answer!.verdict === 'bad');
  if (!bad.length) lines.push(`- ${say('booth.report.none')}`);
  for (const v of bad) {
    const a = v.answer!;
    const parts = [`- ${v.item.id} «${hebrew ? v.item.title.he : v.item.title.en}»`];
    if (a.problems?.length) parts.push(a.problems.map((p) => say(`booth.problem.${p}`)).join(', '));
    if (a.note) parts.push(`"${oneLine(a.note)}"`);
    lines.push(parts.join(' — '));
  }
  lines.push(say('booth.report.checks'));
  if (!input.checks.length) lines.push(`- ${say('booth.report.none')}`);
  for (const r of input.checks) {
    const words = [say(`booth.check.${r.id}`), say(`booth.checkState.${r.state}`)];
    const cw = codeWords(say, r.id, r.code);
    if (cw) words.push(cw);
    // values: only a version line and an adapter vendor (both already allow-listed ASCII by BoothCheckRowSchema)
    for (const k of ['version', 'vendor'] as const) if (typeof r.data[k] === 'string' && r.data[k]) words.push(String(r.data[k]));
    lines.push(`- ${words.join(' — ')}`);
  }
  return `${lines.join('\n')}\n${boothBlockText(boothBlockOf(input))}\n`;
}

/** The machine data of a report (no notes): what boothReport puts in the block. */
export function boothBlockOf(input: BoothReportInput): BoothBlock {
  const answers = input.view.items.filter((v) => v.answer && v.state !== 'unanswered').map((v) => {
    const a = v.answer!;
    return {
      id: v.item.id, recipe: a.recipe, ...(a.played ? { played: a.played } : {}), verdict: a.verdict, ...(a.problems?.length ? { problems: [...a.problems] } : {}),
      ...(a.browserAdapter !== undefined ? { browserAdapter: a.browserAdapter } : {}), ...(a.browserSoftware !== undefined ? { browserSoftware: a.browserSoftware } : {}),
      ...(a.exportAdapter !== undefined ? { exportAdapter: a.exportAdapter } : {}), ...(a.exportSoftware !== undefined ? { exportSoftware: a.exportSoftware } : {}),
      date: a.at.slice(0, 10), state: v.state as 'answered' | 'changed',
    };
  });
  return BoothBlockSchema.parse({
    v: 1, date: input.date, build: { commit: input.view.build.commit, bundle: input.view.build.bundle }, machine: { ...input.view.machine },
    answers, checks: input.checks.map((r) => BoothCheckRowSchema.parse(r)),
  });
}

/**
 * JSON with every non-ASCII character AND every space escaped (\u0020): the block then holds no space at all, so a chat app that
 * re-wraps the lines at spaces, trims them or indents them changes nothing the checksum covers (parseBoothBlock drops spaces).
 */
const asciiJson = (v: unknown) => JSON.stringify(v).replace(/[^\x21-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
/** Lines of at most `max` characters. */
const cut = (text: string, max: number): string[] => text.match(new RegExp(`.{1,${max}}`, 'g')) ?? [];

/** The framed block text: BEGIN, the JSON in lines of ≤ 64, `sha256:` line, END. */
export function boothBlockText(block: BoothBlock): string {
  const lines = cut(asciiJson(BoothBlockSchema.parse(block)), BOOTH_LIMITS.blockLineChars);
  return [BOOTH_BLOCK_BEGIN, ...lines, `sha256:${sha256Hex(lines.join(''))}`, BOOTH_BLOCK_END].join('\n');
}

/** Finds the first block in a pasted text; refuses non-ASCII inside the frame, a checksum mismatch, or a block that fails BoothBlockSchema. */
export function parseBoothBlock(text: string): BoothBlockParse {
  const b = text.indexOf(BOOTH_BLOCK_BEGIN);
  if (b < 0) return { ok: false, code: 'no_block' };
  const e = text.indexOf(BOOTH_BLOCK_END, b + BOOTH_BLOCK_BEGIN.length);
  if (e < 0) return { ok: false, code: 'no_block' };
  const inner = text.slice(b + BOOTH_BLOCK_BEGIN.length, e);
  // line breaks are the only characters outside printable ASCII a block may hold (a re-wrap is not a change; a bidi mark is)
  if (/[^\x20-\x7e\r\n]/.test(inner)) return { ok: false, code: 'not_ascii' };
  const lines = inner.split(/\r?\n|\r/).map((l) => l.replace(/ /g, '')).filter((l) => l.length > 0);
  const last = lines.pop();
  if (!last || !/^sha256:[0-9a-f]{64}$/.test(last)) return { ok: false, code: 'invalid' };
  const body = lines.join('');
  if (`sha256:${sha256Hex(body)}` !== last) return { ok: false, code: 'checksum' };
  let json: unknown;
  try { json = JSON.parse(body); } catch { return { ok: false, code: 'invalid' }; }
  const r = BoothBlockSchema.safeParse(json);
  return r.success ? { ok: true, block: r.data } : { ok: false, code: 'invalid' };
}
