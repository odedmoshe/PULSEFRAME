/**
 * Source-level guard: a unit test that listens must ask the operating system for a free port (0) and read the real one back.
 * Two git worktrees run the suite at the same time on one machine; a fixed number gives EADDRINUSE, or worse, a test that
 * silently talks to the other worktree's server. This scans every *.test.ts under apps/ and packages/ for startServer /
 * createDropDoor / serve calls with a port other than 0, and for .listen( with a first argument other than 0 or an options
 * object. The proofs (*-proof*.ts) are not unit tests and are not scanned.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SELF = 'packages/evals/src/test-ports.test.ts';
/** file: reason. A file listed here may pass a non-zero or computed port; say why. */
export const ALLOWED: Record<string, string> = {
  'apps/server/src/drop.test.ts': 'the door test must know the door\'s port on 127.0.0.2 before it opens a code (to test refused connections and Host headers), so freePort() picks a free one per test; the busy-port test takes its port from a live blocker',
};

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.test.ts')) yield p;
  }
}

/** Findings in one source text: [line, snippet]. */
export function portFindings(src: string): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  const lineOf = (i: number) => src.slice(0, i).split('\n').length;
  // calls that take an options object with a port
  for (const m of src.matchAll(/\b(startServer|createDropDoor|serve)\(\s*\{/g)) {
    const window = src.slice(m.index!, m.index! + 600);
    const port = /[{,]\s*port\b(?:\s*:\s*([^,}]+))?/.exec(window);
    if (port && (port[1] ?? '').trim() !== '0') out.push([lineOf(m.index!), `${m[1]}( ... port${port[1] ? ': ' + port[1].trim() : ''}`]);
  }
  // net / http servers: .listen(<port>, ...) with anything but 0 or an options object / callback
  for (const m of src.matchAll(/\.listen\(\s*([^,)\s][^,)]*)/g)) {
    const a = m[1]!.trim();
    if (a === '0' || a.startsWith('{') || a.includes('=>') || a.startsWith('(')) continue;
    out.push([lineOf(m.index!), `.listen(${a}`]);
  }
  return out;
}

describe('unit tests never listen on a fixed port', () => {
  it('portFindings sees fixed, computed and shorthand ports and passes 0', () => {
    expect(portFindings('await startServer({ port: 8961, dataDir: d });')).toHaveLength(1);
    expect(portFindings('await startServer({ port: 20000 + Math.floor(Math.random() * 9), dataDir: d });')).toHaveLength(1);
    expect(portFindings('await startServer({ port, dataDir: d });')).toHaveLength(1);
    expect(portFindings('s.listen(8791, "127.0.0.1", r)')).toHaveLength(1);
    expect(portFindings('s.listen(BUSY_PORT, BIND, r)')).toHaveLength(1);
    expect(portFindings('await startServer({ port: 0, dataDir: d, dropPort: 0 });')).toEqual([]);
    expect(portFindings("s.listen(0, '127.0.0.1', r); c.listen({ resourcesListChanged: true })")).toEqual([]);
  });

  it('no *.test.ts outside the allowlist passes a non-zero port to startServer, createDropDoor, serve or listen', () => {
    const bad: string[] = [];
    const seen = new Set<string>();
    for (const top of ['apps', 'packages']) {
      for (const file of walk(path.join(root, top))) {
        const rel = path.relative(root, file).split(path.sep).join('/');
        if (rel === SELF) continue;
        const found = portFindings(fs.readFileSync(file, 'utf8'));
        if (!found.length) continue;
        seen.add(rel);
        if (!ALLOWED[rel]) for (const [line, snip] of found) bad.push(`${rel}:${line}  ${snip}`);
      }
    }
    expect(bad, 'use port 0 and read the real port from the returned server (or add the file to ALLOWED with a reason)').toEqual([]);
    for (const f of Object.keys(ALLOWED)) expect(seen.has(f), `${f} no longer needs its allowlist entry`).toBe(true);
  });
});
