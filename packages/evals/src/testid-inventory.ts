/**
 * Test-id inventory (UI redesign, lead pre-pass step 9; test-id policy: "no id is deleted").
 *
 * Lists every data-testid that a proof or the a11y audit under packages/evals/src uses, and asserts that each one exists
 * in the editor:
 *   static   the id (or the pattern, for ids built from a clip or file id) is found in the web source (apps/web/src and
 *            the pages beside it): as a data-testid attribute, as a data-testid template, or as a string constant;
 *   dynamic  the id is in the DOM of the built editor in the states listed in STATES below (the audit's twelve states,
 *            the two header states and a few more that open panels the twelve do not), driven on a synthetic project.
 * The static check fails on any id no source emits. The dynamic check is a pin: an id that was in the DOM of a state in
 * the committed report (docs/evidence/testid-inventory.json) must still be there in that state. A proof reaches many ids
 * only in its own scenario (a running job, a refusal, a second page); those are listed with no state and are covered by
 * the static check and by the proof itself.
 *
 *   pnpm build && pnpm audit:testids             check against the committed report, then refresh it
 *   pnpm audit:testids -- --accept               record the DOM as it is now (only with a listed migration of the ids lost)
 *   pnpm audit:testids -- --static               the source check only: no server, no browser, the report is not written
 *   PF_TESTIDS_PORT=8942 pnpm audit:testids      another port (default 8889)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '../../..');
const EVALS = path.join(root, 'packages/evals/src');
const WEB = path.join(root, 'apps/web');
const REPORT = path.join(root, 'docs/evidence/testid-inventory.json');
const art = path.join(root, '.artifacts/testid-inventory');

/** A reference to a test id in a proof. A pattern has `*` where the proof fills in a clip, file or item id. */
export interface Ref { id: string; kind: 'exact' | 'pattern'; file: string; line: number }
export interface Unresolved { file: string; line: number; text: string; why: string }
type Consts = Record<string, Record<string, string>>;

const lineOf = (src: string, pos: number) => src.slice(0, pos).split('\n').length;
const patternRegex = (p: string) => new RegExp(`^${p.split('*').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`);
const hasLetters = (s: string) => /[a-z0-9]/i.test(s);

/** Splits a template body into literal parts and `${…}` expressions. */
function templateParts(body: string): { lit: string[]; expr: string[] } {
  const lit: string[] = [''], expr: string[] = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '$' && body[i + 1] === '{') {
      let depth = 1, j = i + 2;
      for (; j < body.length && depth > 0; j++) { if (body[j] === '{') depth++; else if (body[j] === '}') depth--; }
      expr.push(body.slice(i + 2, j - 1));
      lit.push('');
      i = j - 1;
    } else lit[lit.length - 1] = lit[lit.length - 1]! + body[i]!;
  }
  return { lit, expr };
}

/** The string literals passed for parameter `name` of the function that encloses `pos` (a helper such as `q = (id) => …`). */
function callSiteLiterals(src: string, pos: number, name: string): string[] | null {
  const heads = [...src.slice(0, pos).matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::[^=]+)?=>|function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g)];
  for (const h of heads.reverse()) {
    const fn = h[1] ?? h[3]!, params = (h[2] ?? h[4] ?? '').split(',').map((p) => p.trim().replace(/[?:=].*$/s, '').trim());
    const index = params.indexOf(name);
    if (index < 0) continue;
    const out: string[] = [];
    for (const c of src.matchAll(new RegExp(`(?<![\\w$.])${fn.replace(/\$/g, '\\$')}\\(`, 'g'))) {
      if (c.index === h.index + h[0].indexOf(fn)) continue;
      // the arguments, split at commas outside brackets and quotes
      const args: string[] = [];
      let depth = 0, quote = '', cur = '', i = c.index + c[0].length;
      for (; i < src.length; i++) {
        const ch = src[i]!;
        if (quote) { cur += ch; if (ch === '\\') cur += src[++i] ?? ''; else if (ch === quote) quote = ''; continue; }
        if (ch === '"' || ch === "'" || ch === '`') { quote = ch; cur += ch; continue; }
        if ('([{'.includes(ch)) depth++;
        if (')]}'.includes(ch)) { if (depth === 0) break; depth--; }
        if (ch === ',' && depth === 0) { args.push(cur.trim()); cur = ''; } else cur += ch;
      }
      args.push(cur.trim());
      const a = args[index];
      const m = a ? /^(['"])([^'"]+)\1$/.exec(a) : null;
      if (m) out.push(m[2]!);
    }
    return out;
  }
  return null;
}

/** Every test id a source file refers to: selectors, getByTestId calls and comparisons with an element's own test id. */
export function extractRefs(file: string, src: string, consts: Consts = {}): { refs: Ref[]; unresolved: Unresolved[] } {
  const refs: Ref[] = [], unresolved: Unresolved[] = [];
  const add = (id: string, kind: Ref['kind'], pos: number) => { if (id) refs.push({ id, kind, file, line: lineOf(src, pos) }); };
  const miss = (pos: number, text: string, why: string) => unresolved.push({ file, line: lineOf(src, pos), text: text.slice(0, 120), why });
  const expression = (expr: string, pos: number, text: string) => {
    const e = expr.trim();
    if (/dataset\??\.testid|getAttribute\(/.test(e)) return; // the proof echoes an id it read from the page
    const member = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(e);
    if (member) { const v = consts[member[1]!]?.[member[2]!]; if (v) add(v, 'exact', pos); else miss(pos, text, `${member[1]} is not a table of test ids this script can read`); return; }
    if (/^[A-Za-z_$][\w$]*$/.test(e)) {
      const lits = callSiteLiterals(src, pos, e);
      if (lits?.length) for (const l of lits) add(l, 'exact', pos); else miss(pos, text, `no call passes a literal for "${e}"`);
      return;
    }
    miss(pos, text, 'the id is computed');
  };
  const template = (body: string, pos: number, text: string, wrap: (id: string) => string = (x) => x) => {
    const { lit, expr } = templateParts(body);
    if (!expr.length) { add(wrap(body), wrap(body).includes('*') ? 'pattern' : 'exact', pos); return; }
    // constants first: `${TID.card}` is an exact id
    const filled = expr.map((e) => { const m = /^\s*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*$/.exec(e); return m ? consts[m[1]!]?.[m[2]!] : undefined; });
    const joined = lit.map((l, i) => l + (i < expr.length ? filled[i] ?? '*' : '')).join('');
    if (!joined.includes('*')) { add(wrap(joined), wrap(joined).includes('*') ? 'pattern' : 'exact', pos); return; }
    if (expr.length === 1 && !hasLetters(lit.join(''))) { expression(expr[0]!, pos, text); return; }
    if (!hasLetters(joined.replace(/\*/g, ''))) { miss(pos, text, 'every part of the id is filled in at run time'); return; }
    add(wrap(joined.replace(/\*+/g, '*')), 'pattern', pos);
  };

  // [data-testid=x], [data-testid="x"], [data-testid^="x-"], with or without a template inside
  for (const m of src.matchAll(/data-testid([\^*$]?)=/g)) {
    let i = m.index + m[0].length;
    if (src[i] === '\\') i++;
    const quote = src[i] === '"' || src[i] === "'" ? src[i++]! : '';
    let depth = 0, v = '';
    for (; i < src.length; i++) {
      const ch = src[i]!;
      if (depth === 0 && ch === '$' && src[i + 1] === '{') { depth = 1; v += '${'; i++; continue; }
      if (depth > 0) { if (ch === '{') depth++; else if (ch === '}') depth--; v += ch; continue; }
      if (ch === '\\' || ch === ']' || ch === '`' || ch === '\n' || (quote ? ch === quote : /[\s"')]/.test(ch))) break;
      v += ch;
    }
    if (!v || v.startsWith('{')) continue; // JSX in a comment or a string: not a selector
    const op = m[1];
    template(v, m.index, src.slice(m.index, i + 1), (id) => (op === '^' ? `${id}*` : op === '$' ? `*${id}` : op === '*' ? `*${id}*` : id));
  }
  // getByTestId('x'), getByTestId(`x-${id}`), getByTestId(TID.x), getByTestId(param)
  for (const m of src.matchAll(/getByTestId\(\s*/g)) {
    const i = m.index + m[0].length, ch = src[i]!;
    if (ch === "'" || ch === '"') { const end = src.indexOf(ch, i + 1); add(src.slice(i + 1, end), 'exact', m.index); continue; }
    if (ch === '`') {
      let j = i + 1, depth = 0;
      for (; j < src.length; j++) { if (src[j] === '$' && src[j + 1] === '{') { depth++; j++; } else if (depth > 0 && src[j] === '}') depth--; else if (depth === 0 && src[j] === '`') break; }
      template(src.slice(i + 1, j), m.index, src.slice(m.index, j + 2));
      continue;
    }
    let j = i, depth = 0;
    for (; j < src.length; j++) { if (src[j] === '(') depth++; else if (src[j] === ')') { if (depth === 0) break; depth--; } }
    expression(src.slice(i, j), m.index, src.slice(m.index, j + 1));
  }
  // el.dataset.testid === 'x', el.getAttribute('data-testid') === 'x'
  for (const m of src.matchAll(/(?:dataset\??\.testid|getAttribute\(['"]data-testid['"]\))\s*[!=]==?\s*(['"])([^'"]+)\1/g)) add(m[2]!, 'exact', m.index);
  // el.dataset.testid.replace('inspector-tab-', '')
  for (const m of src.matchAll(/dataset\??\.testid!?\.replace\(\s*(['"])([^'"]+)\1/g)) add(`${m[2]}*`, 'pattern', m.index);
  return { refs, unresolved };
}

export interface Emitted { exact: Map<string, Set<string>>; templates: { pattern: string; file: string }[]; literals: Map<string, Set<string>> }
/** What the web source can put in a data-testid: attributes, attribute templates, and every plain string literal (for ids kept in constants). */
export function scanSource(files: { file: string; src: string }[]): Emitted {
  const exact = new Map<string, Set<string>>(), literals = new Map<string, Set<string>>(), templates: Emitted['templates'] = [];
  const put = (map: Map<string, Set<string>>, id: string, file: string) => { if (!map.has(id)) map.set(id, new Set()); map.get(id)!.add(file); };
  for (const { file, src } of files) {
    for (const m of src.matchAll(/(?:data-testid|testid|testId|['"]data-testid['"])\s*[=:]\s*\{?\s*(['"])([A-Za-z0-9_.:-]+)\1/g)) put(exact, m[2]!, file);
    for (const m of src.matchAll(/setAttribute\(\s*['"]data-testid['"]\s*,\s*(['"])([A-Za-z0-9_.:-]+)\1/g)) put(exact, m[2]!, file);
    for (const m of src.matchAll(/(?:data-testid|testid|testId|['"]data-testid['"])\s*[=:]\s*\{?\s*`([^`]+)`/g)) {
      const { lit, expr } = templateParts(m[1]!);
      if (!expr.length) put(exact, m[1]!, file); else templates.push({ pattern: lit.join('*').replace(/\*+/g, '*'), file });
    }
    // ids that reach the attribute through an expression: a ternary, a constants table, a helper
    for (const m of src.matchAll(/(['"])([a-z][a-z0-9]*(?:[-.:][a-zA-Z0-9]+)*)\1/g)) put(literals, m[2]!, file);
    for (const m of src.matchAll(/`([a-z][a-z0-9-]*-)\$\{[^`]*`/g)) { const { lit } = templateParts(m[0].slice(1, -1)); templates.push({ pattern: lit.join('*').replace(/\*+/g, '*'), file: `${file} (template literal)` }); }
  }
  return { exact, templates, literals };
}

export interface StaticEvidence { found: boolean; how: 'attribute' | 'constant' | 'template' | null; where: string[] }
/** A template counts only when its fixed text says something: `x-${id}` does, `${group}-${value}` does not. */
const telling = (pattern: string) => pattern.replace(/[^a-z0-9]/gi, '').length >= 3;
export function staticEvidence(ref: { id: string; kind: Ref['kind'] }, e: Emitted): StaticEvidence {
  const files = (s: Iterable<string>) => [...new Set(s)].sort().slice(0, 4);
  const templates = e.templates.filter((x) => telling(x.pattern));
  if (ref.kind === 'exact') {
    if (e.exact.has(ref.id)) return { found: true, how: 'attribute', where: files(e.exact.get(ref.id)!) };
    if (e.literals.has(ref.id)) return { found: true, how: 'constant', where: files(e.literals.get(ref.id)!) };
    const t = templates.filter((x) => patternRegex(x.pattern).test(ref.id));
    if (t.length) return { found: true, how: 'template', where: files(t.map((x) => x.file)) };
    return { found: false, how: null, where: [] };
  }
  const re = patternRegex(ref.id), head = ref.id.split('*')[0]!, tail = ref.id.split('*').at(-1)!;
  const hits = [...e.exact.keys()].filter((id) => re.test(id));
  if (hits.length) return { found: true, how: 'attribute', where: files(hits.flatMap((id) => [...e.exact.get(id)!])) };
  // a template in the source that can produce an id the proof's pattern accepts: the fixed start (or end) is the same text
  const agree = (a: string, b: string, from: 'start' | 'end') => !!a && !!b && (from === 'start' ? a.startsWith(b) || b.startsWith(a) : a.endsWith(b) || b.endsWith(a));
  const t = templates.filter((x) => { const h = x.pattern.split('*')[0]!, tl = x.pattern.split('*').at(-1)!; return head ? agree(h, head, 'start') && (!tail || !tl || agree(tl, tail, 'end')) : agree(tl, tail, 'end'); });
  if (t.length) return { found: true, how: 'template', where: files(t.map((x) => x.file)) };
  return { found: false, how: null, where: [] };
}

const walk = (dir: string, keep: (f: string) => boolean): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.name === 'node_modules' || d.name === 'dist' ? [] : d.isDirectory() ? walk(path.join(dir, d.name), keep) : keep(d.name) ? [path.join(dir, d.name)] : []);
const rel = (f: string) => path.relative(root, f).split(path.sep).join('/');

/** Tables of test ids a proof imports from the web source (`import { TEMPLATE_TESTIDS } from '…/templates.testids.ts'`), under every name the file gives them. */
async function constsOf(file: string, src: string): Promise<Consts> {
  const out: Consts = {};
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'(\.[^']+\.ts)'/g)) {
    const names = m[1]!.split(',').map((x) => x.trim()).filter((x) => /TEST_?IDS?$|_IDS$/.test(x.split(/\s+as\s+/)[0]!));
    if (!names.length) continue;
    const mod = await import(pathToFileURL(path.resolve(path.dirname(file), m[2]!)).href) as Record<string, unknown>;
    for (const n of names) { const [orig, alias] = n.split(/\s+as\s+/); const v = mod[orig!]; if (v && typeof v === 'object') out[alias ?? orig!] = Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string')) as Record<string, string>; }
  }
  for (const m of src.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/g)) if (out[m[2]!]) out[m[1]!] = out[m[2]!]!;
  return out;
}

export async function inventory() {
  const proofFiles = walk(EVALS, (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'testid-inventory.ts');
  const refs: Ref[] = [], unresolved: Unresolved[] = [];
  for (const file of proofFiles) {
    const src = fs.readFileSync(file, 'utf8');
    if (!src.includes('testid') && !src.includes('TestId')) continue;
    const r = extractRefs(rel(file), src, await constsOf(file, src));
    refs.push(...r.refs); unresolved.push(...r.unresolved);
  }
  const webFiles = [...walk(path.join(WEB, 'src'), (f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts')), ...fs.readdirSync(WEB).filter((f) => f.endsWith('.html')).map((f) => path.join(WEB, f))];
  const emitted = scanSource(webFiles.map((file) => ({ file: rel(file), src: fs.readFileSync(file, 'utf8') })));
  const byId = new Map<string, { id: string; kind: Ref['kind']; usedBy: Set<string> }>();
  for (const r of refs) { const k = `${r.kind}:${r.id}`; if (!byId.has(k)) byId.set(k, { id: r.id, kind: r.kind, usedBy: new Set() }); byId.get(k)!.usedBy.add(path.basename(r.file)); }
  const ids = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)).map((x) => ({ id: x.id, kind: x.kind, usedBy: [...x.usedBy].sort(), static: staticEvidence(x, emitted) }));
  return { ids, unresolved, proofFiles: proofFiles.length, webFiles: webFiles.length };
}

// ---- dynamic: the DOM of the built editor in the screenshot states ----

const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 });
const f = (n: number) => ({ value: String(n), timescale: 30 });

async function domStates(): Promise<{ states: Record<string, string[]>; browser: string }> {
  const { chromium } = await import('playwright');
  const { startServer } = await import('@pulseframe/server');
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  // synthetic media only (ffmpeg sources): four pictures with sound, a still, a music bed with a kick every half second, a voice-like tone
  const enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-shortest'];
  const video = (name: string, source: string, seconds: number) => { const file = path.join(art, name); ff(['-f', 'lavfi', '-t', String(seconds), '-i', source, '-f', 'lavfi', '-t', String(seconds), '-i', 'sine=frequency=330:sample_rate=48000', '-af', 'volume=0.1', ...enc, file]); return file; };
  const media = {
    beach: video('beach-day.mp4', 'gradients=s=640x360:r=30:speed=0.02', 6),
    cake: video('birthday-cake.mp4', 'testsrc2=s=640x360:r=30', 6),
    park: video('park-walk.mp4', 'mandelbrot=s=640x360:r=30', 5),
    tiny: video('tiny.mp4', 'testsrc2=s=320x180:r=30', 1),
    photo: path.join(art, 'family-photo.png'), music: path.join(art, 'upbeat-music.mp3'), voice: path.join(art, 'narration.m4a'),
  };
  ff(['-f', 'lavfi', '-i', 'smptehdbars=s=640x480', '-frames:v', '1', media.photo]);
  ff(['-f', 'lavfi', '-t', '24', '-i', "aevalsrc='0.55*sin(2*PI*(55+70*exp(-mod(t,0.5)*30))*t)*exp(-mod(t,0.5)*9)+0.1*sin(2*PI*220*t)':s=48000:c=stereo", '-c:a', 'libmp3lame', '-b:a', '128k', media.music]);
  ff(['-f', 'lavfi', '-t', '8', '-i', "aevalsrc='0.3*sin(2*PI*(160+40*sin(2*PI*3*t))*t)*(0.5+0.5*sin(2*PI*1.5*t))':s=48000", '-c:a', 'aac', '-b:a', '64k', media.voice]);

  const s = await startServer({ port: Number(process.env.PF_TESTIDS_PORT ?? 8889), dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const post = async (p: string, body: unknown) => { const r = await fetch(`${s.url}/api/v1${p}`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json() as any; if (!r.ok) throw new Error(`${p}: ${JSON.stringify(j).slice(0, 300)}`); return j; };
  const tx = async (pid: string, ops: unknown[]) => (await post(`/projects/${pid}/transactions`, { ops })).results as any[];
  const upload = async (pid: string, file: string) => (await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any;
  const browser = await chromium.launch();
  const states: Record<string, string[]> = {};
  try {
    const empty = (await post('/projects', { name: 'פרויקט חדש', width: 1920, height: 1080 })).project.id as string;
    const main = (await post('/projects', { name: 'סוף שבוע משפחתי', width: 1920, height: 1080, frameRate: { num: 30, den: 1 } })).project.id as string;
    const A: Record<string, string> = {};
    for (const k of ['beach', 'cake', 'park', 'photo', 'music', 'voice'] as const) A[k] = (await upload(main, media[k])).assetId;
    const clip = async (asset: string, start: number, extra: object = {}) => (await tx(main, [{ op: 'add_clip', args: { assetId: A[asset], start: f(start), ...extra } }]))[0].output.clipId as string;
    const beach = await clip('beach', 0, { sourceIn: f(15), duration: f(120) });
    const cake = await clip('cake', 120, { sourceIn: f(30), duration: f(120) });
    await clip('park', 240, { sourceIn: f(30), duration: f(90) });
    await clip('photo', 330, { duration: f(60) });
    await clip('music', 0, { duration: f(390) });
    await clip('voice', 30);
    const title = (await tx(main, [{ op: 'add_text', args: { text: 'סוף שבוע בים', start: f(10), duration: f(90) } }]))[0].output.clipId as string;
    await tx(main, [{ op: 'set_transition', args: { clipId: cake, type: 'dissolve', frames: 12 } }]);
    await tx(main, [{ op: 'add_effect', args: { clipId: beach, type: 'light.vignette' } }]);
    const seg = (at: number, d: number, text: string) => ({ start: f(at), duration: f(d), text });
    await tx(main, [{ op: 'set_transcript', args: { assetId: A.voice, language: 'he', origin: 'manual', segments: [seg(0, 90, 'שלום לכולם, ברוכים הבאים'), seg(90, 90, 'היום אנחנו בים עם כל המשפחה')] } }]);
    await tx(main, [{ op: 'add_caption_track', args: { mode: 'transcript' } }]);
    await tx(main, [{ op: 'add_marker', args: { time: f(120), label: 'עוגה' } }]);
    const variant = (await tx(main, [{ op: 'add_variant', args: { profileId: 'vertical-9x16' } }]))[0].output.variantId as string;
    const busy = (await post('/projects', { name: 'הרבה קאטים', width: 1080, height: 1920 })).project.id as string;
    const B = { beach: (await upload(busy, media.beach)).assetId, cake: (await upload(busy, media.cake)).assetId, music: (await upload(busy, media.music)).assetId };
    let at = 0;
    for (let i = 0; i < 16; i++) { const len = 20 + ((i * 7) % 25); await tx(busy, [{ op: 'add_clip', args: { assetId: i % 2 ? B.cake : B.beach, start: f(at), sourceIn: f((i * 11) % 60), duration: f(len) } }]); at += len; }
    await tx(busy, [{ op: 'add_clip', args: { assetId: B.music, start: f(0), duration: f(at) } }]);
    const tiny = (await post('/projects', { name: 'בדיקת ייצוא', width: 320, height: 180, frameRate: { num: 30, den: 1 } })).project.id as string;
    await tx(tiny, [{ op: 'add_clip', args: { assetId: (await upload(tiny, media.tiny)).assetId, start: f(0) } }]);

    const open = async (pid: string) => {
      const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })).newPage();
      await page.addInitScript('globalThis.__name = (f) => f'); // tsx/esbuild helper referenced by functions passed to page.evaluate
      await page.goto(`${s.url}/?key=${s.auth.tokens.owner}&project=${pid}`);
      await page.getByTestId('project-name').waitFor();
      await page.waitForTimeout(2000);
      return page;
    };
    const snap = async (page: import('playwright').Page, name: string) => {
      await page.waitForTimeout(500);
      states[name] = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')!))].sort());
      console.log(`  state ${name}: ${states[name]!.length} ids in the DOM`);
    };
    const sel = async (page: import('playwright').Page, id: string) => { await page.locator(`[data-testid="clip-${id}"]`).first().click(); await page.waitForTimeout(700); };
    const tab = async (page: import('playwright').Page, id: string) => { await page.getByTestId(`inspector-tab-${id}`).click(); await page.waitForTimeout(600); };
    const pro = async (page: import('playwright').Page) => { await page.getByTestId('workspace-switch').selectOption('pro'); await tab(page, 'clip'); };

    // STATES: the twelve states of the audit …
    let page = await open(empty);
    await snap(page, '01-start-empty');
    await page.context().close();
    page = await open(main); await pro(page);
    await snap(page, '02-main');
    await sel(page, beach); await snap(page, '03-clip-selected');
    await page.getByTestId('format-switch').selectOption(variant); await page.getByTestId('format-badge').waitFor(); await snap(page, '04-format-9x16');
    await page.context().close();
    page = await open(busy); await snap(page, '05-busy-timeline'); await page.context().close();
    page = await open(main); await pro(page);
    await sel(page, cake);
    await page.getByTestId('gallery-open').first().scrollIntoViewIfNeeded(); await page.getByTestId('gallery-open').first().click();
    await page.getByTestId('gallery-tab-transitions').click(); await page.waitForTimeout(1500);
    await snap(page, '06-gallery-transitions');
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    await sel(page, title); await snap(page, '07-text-selected');
    for (const [n, t] of [['08', 'captions'], ['09', 'sound'], ['10', 'deliver']] as const) { await tab(page, t); await snap(page, `${n}-tab-${t}`); }
    await page.keyboard.press('Control+KeyK'); await page.getByTestId('palette-input').waitFor(); await snap(page, '11-command-palette');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await page.getByTestId('lang-toggle').click(); await page.waitForTimeout(800); await snap(page, '12-english-main');
    await page.getByTestId('lang-toggle').click(); await page.waitForTimeout(500);
    // … the two header states of the audit's critical findings …
    await page.getByTestId('projects-open').click(); await page.getByTestId('projects-dialog').waitFor(); await snap(page, '14-projects-dialog');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    // … and the panels the twelve do not open
    for (const t of ['speech', 'review', 'recipes'] as const) { await tab(page, t); await snap(page, `x-tab-${t}`); }
    await sel(page, beach); await tab(page, 'all'); await snap(page, 'x-tab-all-clip-selected');
    await page.locator('[data-testid^="view-"]').first().click(); await page.getByTestId('source-viewer').waitFor(); await snap(page, 'x-source-viewer');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await page.locator(`[data-testid="clip-${cake}"]`).first().click({ button: 'right' }); await page.waitForTimeout(500); await snap(page, 'x-clip-menu');
    await page.keyboard.press('Escape');
    await page.context().close();
    page = await open(tiny);
    await page.getByTestId('export').click();
    await page.getByTestId('export-finished').waitFor({ timeout: 240000 });
    await snap(page, '13-export-finished');
    await page.context().close();
    return { states, browser: browser.version() };
  } finally {
    await browser.close();
    await s.close();
  }
}

async function main() {
  const accept = process.argv.includes('--accept'), staticOnly = process.argv.includes('--static');
  const inv = await inventory();
  const missing = inv.ids.filter((x) => !x.static.found);
  console.log(`test ids used by ${inv.proofFiles} proof files: ${inv.ids.length} (${inv.ids.filter((x) => x.kind === 'pattern').length} patterns); not found in the web source: ${missing.length}; references this script could not read: ${inv.unresolved.length}`);
  for (const m of missing) console.log(` MISSING in source: ${m.id}  (used by ${m.usedBy.join(', ')})`);
  if (staticOnly) { if (missing.length) process.exitCode = 1; return; }

  const dom = await domStates();
  const seenIn = (x: { id: string; kind: Ref['kind'] }) => Object.entries(dom.states).filter(([, ids]) => (x.kind === 'exact' ? ids.includes(x.id) : ids.some((d) => patternRegex(x.id).test(d)))).map(([name]) => name);
  const ids = inv.ids.map((x) => ({ ...x, dynamic: seenIn(x) }));
  // the pin: what the committed report saw must still be there, state by state
  const pinned = fs.existsSync(REPORT) ? JSON.parse(fs.readFileSync(REPORT, 'utf8')) as { ids: { id: string; kind: string; dynamic: string[]; static?: { how: string | null } }[] } : null;
  const lost: { id: string; state: string }[] = [];
  if (pinned) for (const p of pinned.ids) {
    const now = ids.find((x) => x.id === p.id && x.kind === p.kind);
    for (const st of p.dynamic) if (!now?.dynamic.includes(st)) lost.push({ id: p.id, state: st });
    // an id that was an attribute in the source and is now only some string constant has most likely left its element
    if (p.static?.how && p.static.how !== 'constant' && now?.static.how === 'constant') lost.push({ id: p.id, state: '(source: no longer a data-testid attribute)' });
  }
  for (const l of lost) console.log(` LOST: ${l.id}  (${l.state})`);
  const ok = missing.length === 0 && (lost.length === 0 || accept);
  const report = {
    ranAt: new Date().toISOString(),
    machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, browser: dom.browser },
    scope: 'Every data-testid a proof or the a11y audit (packages/evals/src) refers to. static: found in the web source (attribute, attribute template, or string constant). dynamic: the states of the built editor, on a synthetic project at 1440x900, in whose DOM the id was present; an empty list means the id is reached only in its own proof scenario. Not a proof that a control works: the proofs do that.',
    states: Object.keys(dom.states),
    summary: { ids: ids.length, patterns: ids.filter((x) => x.kind === 'pattern').length, staticMissing: missing.map((x) => x.id), inTheDomOfAState: ids.filter((x) => x.dynamic.length).length, onlyInItsOwnProofScenario: ids.filter((x) => !x.dynamic.length).length, lostSinceTheLastReport: lost, acceptedWithLosses: accept && lost.length > 0, unreadableReferences: inv.unresolved.length },
    ids,
    unreadableReferences: inv.unresolved,
    result: ok ? 'PASS' : 'FAIL',
  };
  console.log(`in the DOM of a driven state: ${report.summary.inTheDomOfAState} of ${ids.length}; lost since the last report: ${lost.length}`);
  if (ok) {
    // one id per line, so the report can be read and compared line by line
    const lines = (list: unknown[]) => (list.length ? `[\n${list.map((x) => `    ${JSON.stringify(x)}`).join(',\n')}\n  ]` : '[]');
    const { ids: idList, unreadableReferences, ...head } = report;
    const text = JSON.stringify({ ...head, ids: '@ids', unreadableReferences: '@unreadable' }, null, 2).replace('"@ids"', () => lines(idList)).replace('"@unreadable"', () => lines(unreadableReferences));
    fs.writeFileSync(REPORT, text + '\n');
    console.log(`test-id inventory: PASS. Evidence: docs/evidence/testid-inventory.json`);
  }
  else { console.log('test-id inventory: FAIL (the committed report is left as it was)'); process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
