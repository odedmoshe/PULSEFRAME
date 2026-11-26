/**
 * The scanner behind test-ports.test.ts (no test framework import, so a script can run it on any checkout).
 * portFindings(src) lists, for one source text, every place that asks for a listening port other than 0: startServer /
 * createDropDoor / serve calls with an options object whose `port` or `dropPort` is not the literal 0, and `.listen(<x>` with
 * a first argument other than 0, an options object or a callback.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Findings in one source text: [line, snippet]. */
export function portFindings(src: string): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  const lineOf = (i: number) => src.slice(0, i).split('\n').length;
  // calls that take an options object with a port (and, for the server, the phone door's port)
  for (const m of src.matchAll(/\b(startServer|createDropDoor|serve)\(\s*\{/g)) {
    const window = src.slice(m.index!, m.index! + 700);
    for (const key of ['port', 'dropPort']) {
      const port = new RegExp(`[{,]\\s*${key}\\b(?:\\s*:\\s*([^,}]+))?`).exec(window);
      if (port && (port[1] ?? '').trim() !== '0') out.push([lineOf(m.index!), `${m[1]}( ... ${key}${port[1] ? ': ' + port[1].trim() : ''}`]);
    }
  }
  // net / http servers: .listen(<port>, ...) with anything but 0 or an options object / callback
  for (const m of src.matchAll(/\.listen\(\s*([^,)\s][^,)]*)/g)) {
    const a = m[1]!.trim();
    if (a === '0' || a.startsWith('{') || a.includes('=>') || a.startsWith('(')) continue;
    out.push([lineOf(m.index!), `.listen(${a}`]);
  }
  return out;
}

/** Every .ts file under `dir` (not node_modules, dist or dot folders) for which `want(name)` holds. */
export function* walkTs(dir: string, want: (name: string) => boolean): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkTs(p, want);
    else if (want(e.name)) yield p;
  }
}

/** The proofs, audits, conformance and bench scripts: every non-test .ts file directly in packages/evals/src. */
export function proofScripts(root: string): string[] {
  const dir = path.join(root, 'packages/evals/src');
  return [...walkTs(dir, (n) => n.endsWith('.ts') && !n.endsWith('.test.ts') && n !== 'test-ports.scan.ts')].filter((p) => path.dirname(p) === dir);
}
