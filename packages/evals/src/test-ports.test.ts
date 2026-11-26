/**
 * Source-level guard: a unit test that listens must ask the operating system for a free port (0) and read the real one back.
 * Two git worktrees run the suite at the same time on one machine; a fixed number gives EADDRINUSE, or worse, a test that
 * silently talks to the other worktree's server. This scans every *.test.ts under apps/ and packages/ for startServer /
 * createDropDoor / serve calls with a port other than 0, and for .listen( with a first argument other than 0 or an options
 * object. A second block does the same for the proof, audit, conformance and bench scripts in packages/evals/src (a proof
 * that fixes a port collides with a second proof, or with the dev server, when both run at the same time).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { portFindings, proofScripts, walkTs } from './test-ports.scan.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SELF = 'packages/evals/src/test-ports.test.ts';
/** file: reason. A file listed here may pass a non-zero or computed port; say why. */
export const ALLOWED_PROOFS: Record<string, string> = {
  'packages/evals/src/phase0-proof.ts': 'the restart check at the end starts the second server on the first one\'s bound port (read from its url): the proof keeps using the same base URL after the restart',
  'packages/evals/src/soak.ts': 'the restart check starts the second server on the first one\'s bound port (read from its url): the owner cookie and the origin it was issued for are used again after the restart',
  'packages/evals/src/phone-drop-server.ts': 'the launcher that proof:phone-drop spawns as a child: it takes --port and --drop-port from its argv and passes them on; the proof passes --port 0 and a drop port it has just asked the system for (the door binds only while a code is live, and P2/P3c/P20 assert that the port refuses while none is, so the number must be known first)',
};
export const ALLOWED: Record<string, string> = {
  'apps/server/src/drop.test.ts': 'the door test must know the door\'s port on 127.0.0.2 before it opens a code (to test refused connections and Host headers), so freePort() picks a free one per test; the busy-port test takes its port from a live blocker',
};

const walk = (dir: string) => walkTs(dir, (n) => n.endsWith('.test.ts'));

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

describe('proofs, audits and benches never listen on a fixed or random port', () => {
  it('sees a dropPort, a random port in a constant-free call, and passes port 0 with dropPort 0', () => {
    expect(portFindings("await startServer({ port: 0, dataDir: d, dropPort: 8804 });")).toHaveLength(1);
    expect(portFindings("await startServer({ port: 18600 + Math.floor(Math.random() * 90), dataDir: d });")).toHaveLength(1);
    expect(portFindings("await startServer({ port: 0, dataDir: d, dropPort: 0, dropAdmitAddresses: ['127.0.0.1'] });")).toEqual([]);
  });

  it('no script in packages/evals/src outside the allowlist passes a non-zero port to startServer, createDropDoor, serve or listen', () => {
    const bad: string[] = [];
    const seen = new Set<string>();
    for (const file of proofScripts(root)) {
      const rel = path.relative(root, file).split(path.sep).join('/');
      const found = portFindings(fs.readFileSync(file, 'utf8'));
      if (!found.length) continue;
      seen.add(rel);
      if (!ALLOWED_PROOFS[rel]) for (const [line, snip] of found) bad.push(`${rel}:${line}  ${snip}`);
    }
    expect(bad, 'use port 0 (and dropPort 0) and read the real one from the returned server (or add the file to ALLOWED_PROOFS with a reason)').toEqual([]);
    for (const f of Object.keys(ALLOWED_PROOFS)) expect(seen.has(f), `${f} no longer needs its allowlist entry`).toBe(true);
  });
});
