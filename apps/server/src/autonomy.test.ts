/**
 * Autonomy (autonomy.ts), the source walk the verifier asks for (C1, C2): a FLOOR site reading the policy predicate, a policy
 * site still reading a raw owner check, or `isOwnerFloor` used off the exact floor list, fails here. Every remaining raw check
 * (`kind === 'user'`, `isOwnerSession(` …) in apps/server/src is listed below with the reason it is not a policy gate.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { actsAsOwner, FLOOR_SITES, isOwnerFloor, OPEN_GATES, ownerKeeps, stampOpen } from './autonomy.ts';
import type { Principal } from './governance.ts';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === 'node_modules' || e.name === 'testdata' ? [] : walk(path.join(dir, e.name))) : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [path.join(dir, e.name)] : []);
const FILES = walk(SRC).map((f) => ({ rel: path.relative(SRC, f).split(path.sep).join('/'), lines: fs.readFileSync(f, 'utf8').split('\n') }));
const code = (l: string) => !/^\s*(\*|\/\/|\/\*\*)/.test(l);
const RAW = /kind !== 'user'|kind === 'user'|isOwnerSession\(|kind === 'agent'|kind !== 'agent'|actor === 'user:local'/;

/** Raw owner/agent checks that are NOT policy gates, each with its reason. */
const RAW_ALLOWED: readonly { file: string; frag: string; why: string }[] = [
  { file: 'assistant/contract.ts', frag: 'export const isOwnerSession', why: 'the definition (kept for wording; no gate reads it after the swap)' },
  { file: 'auth.ts', frag: 'if (!perMinute || p.kind !== \'agent\') return p;', why: 'I1 rate limit: an owner switch, off by default (S)' },
  { file: 'mcp.ts', frag: 'if (principal.kind === \'user\' && !auth.originAllowed(req))', why: 'FLOOR A8: Origin check of the owner cookie' },
  { file: 'http.ts', frag: 'if (listener.kind === \'user\') extras.door?.events.on(\'drop\'', why: 'FLOOR A23: the phone door\'s dialog goes to the owner\'s window only' },
  { file: 'governance.ts', frag: 'const modeOf = ', why: 'what mode a credential has (not a gate)' },
  { file: 'governance.ts', frag: 'if (p.kind === \'agent\' && this.isPaused(projectId))', why: 'A6 pause: the owner\'s brake, kept (K)' },
  { file: 'governance.ts', frag: 'const g = p.kind === \'agent\' ? p.grant : undefined;', why: 'A3 grant limits: exist only if the owner set them (S)' },
  { file: 'search/routes.ts', frag: 'const g = p.kind === \'agent\' ? p.grant : undefined;', why: 'A3 grant project limit (S)' },
  { file: 'governance.ts', frag: 'if (p.kind === \'user\') return this.store.commit({ ...req, actor: p.actor });', why: 'the owner\'s commit path (open agents keep their grant\'s scope guard)' },
  { file: 'governance.ts', frag: 'if (p.kind !== \'agent\' || p.actor !== ASSISTANT_ACTOR', why: 'identity of the in-memory command-bar assistant (not a gate)' },
  { file: 'templates.ts', frag: '.mode === \'propose\') throw', why: 'A25 fact: a proposal cannot carry internal steps (propose credentials are never stamped open)' },
  { file: 'familyFilm.ts', frag: '.mode === \'propose\') throw', why: 'A25 fact: a proposal cannot carry internal steps (propose credentials are never stamped open)' },
  { file: 'perform.ts', frag: '.mode === \'propose\') throw', why: 'A25 fact: a proposal cannot carry internal steps (propose credentials are never stamped open)' },
  { file: 'craft/contract.ts', frag: '.mode === \'propose\') throw', why: 'A25 fact: a proposal cannot carry internal steps (propose credentials are never stamped open)' },
  { file: 'library/routes.ts', frag: '.mode === \'propose\') throw', why: 'A25 fact: a proposal cannot carry internal steps (propose credentials are never stamped open)' },
  { file: 'shorts.ts', frag: '.mode === \'propose\') throw', why: 'A25 fact: a proposal cannot carry internal steps (propose credentials are never stamped open)' },
  { file: 'music.ts', frag: '.mode === \'propose\') throw', why: 'A25 fact: a proposal cannot carry internal steps (propose credentials are never stamped open)' },
  { file: 'story.ts', frag: '.mode === \'propose\') throw', why: 'A25 fact: a proposal cannot carry internal steps (propose credentials are never stamped open)' },
  { file: 'musicfit/routes.ts', frag: '.mode === \'propose\') throw', why: 'A25 fact: a proposal cannot carry internal steps (propose credentials are never stamped open)' },
];
/** Policy sites not swapped yet (this list is emptied family by family; an entry here is a gate still shut in open mode). */
const PENDING: readonly { file: string; frag: string }[] = [
  { file: 'peoplePrivacy.ts', frag: 'if (p.kind === \'user\') return \'full\';' },
  { file: 'peoplePrivacy.ts', frag: 'if (p.kind === \'user\') return;' },
  { file: 'capabilities.ts', frag: 'const isAgent = (req: { actor: string; principal?: Principal }) => req' },
  { file: 'governance.ts', frag: 'if (p.kind === \'user\') return; // the owner spends their own money; gr' },
  { file: 'search/answer.ts', frag: 'if (!isOwnerSession(p)) {' },
  { file: 'assistant/visibility.ts', frag: 'if (j.type !== ASSISTANT_JOB_TYPE || isOwnerSession(p)) return null;' },
  { file: 'assistant/visibility.ts', frag: 'export const mayReadProposal = (p: Principal, proposal: { actor: strin' },
  { file: 'assistant/visibility.ts', frag: 'if (isOwnerSession(p)) return whole;' },
];

describe('autonomy source walk (C1, C2)', () => {
  it('every raw owner check outside autonomy.ts is a listed non-gate (or a policy site still pending)', () => {
    const stray: string[] = [];
    for (const f of FILES) {
      if (f.rel === 'autonomy.ts') continue;
      f.lines.forEach((l, i) => {
        if (!code(l) || !RAW.test(l)) return;
        const t = l.trim();
        if (RAW_ALLOWED.some((a) => a.file === f.rel && t.includes(a.frag)) || PENDING.some((a) => a.file === f.rel && t.startsWith(a.frag))) return;
        stray.push(`${f.rel}:${i + 1}: ${t.slice(0, 120)}`);
      });
    }
    expect(stray).toEqual([]);
  });
  it('isOwnerFloor is read at exactly the floor sites, and no floor site reads the policy predicate', () => {
    const uses: string[] = [];
    for (const f of FILES) {
      if (f.rel === 'autonomy.ts') continue;
      f.lines.forEach((l, i) => { if (code(l) && l.includes('isOwnerFloor(')) uses.push(`${f.rel}:${i + 1}`); });
    }
    const floorLines = FLOOR_SITES.filter((s) => s.file !== 'autonomy.ts').map((s) => {
      const f = FILES.find((x) => x.rel === s.file)!;
      const i = f.lines.findIndex((l) => l.includes(s.needle));
      expect(i, `${s.file}: ${s.needle}`).toBeGreaterThanOrEqual(0);
      expect(f.lines[i]).toContain('isOwnerFloor(');
      expect(f.lines[i]).not.toMatch(/actsAsOwner|ownerKeeps/);
      return `${s.file}:${i + 1}`;
    });
    expect(uses.sort()).toEqual([...floorLines].sort());
    const self = FILES.find((x) => x.rel === 'autonomy.ts')!.lines.find((l) => l.includes('only the owner switches between open and guarded mode'))!;
    expect(self).toContain('isOwnerFloor(');
  });
  it('every OPEN_GATES row names a line that reads the policy predicate (and never the floor one)', () => {
    for (const g of OPEN_GATES) {
      const f = FILES.find((x) => x.rel === g.file);
      expect(f, g.file).toBeDefined();
      const i = f!.lines.findIndex((l) => l.includes(g.needle));
      expect(i, `${g.id} ${g.file}: ${g.needle}`).toBeGreaterThanOrEqual(0);
      expect(f!.lines[i], `${g.id} ${g.file}`).toMatch(/actsAsOwner/);
      expect(f!.lines[i]).not.toContain('isOwnerFloor(');
    }
  });
});

describe('the stamp and the predicates', () => {
  const agent: Principal = { actor: 'agent:local', kind: 'agent', scopes: ['observe', 'edit'] };
  const observer: Principal = { actor: 'agent:observer', kind: 'agent', scopes: ['observe'] };
  const owner: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
  it('guarded stamps nothing (today, byte for byte)', () => {
    expect(stampOpen(agent, 'guarded')).toBe(agent);
    expect(actsAsOwner(stampOpen(agent, 'guarded'))).toBe(false);
  });
  it('open stamps an editing agent (autopilot for the built-in token) and leaves read-only and propose credentials alone', () => {
    const s = stampOpen(agent, 'open');
    expect(s).toMatchObject({ open: true, mode: 'autopilot', actor: 'agent:local' });
    expect(actsAsOwner(s)).toBe(true);
    expect(stampOpen(observer, 'open')).toBe(observer);
    const propose: Principal = { actor: 'agent:p', kind: 'agent', scopes: ['observe'], mode: 'propose' };
    expect(stampOpen(propose, 'open')).toBe(propose);
    const assistant: Principal = { actor: 'agent:assistant', kind: 'agent', scopes: ['observe', 'edit'], mode: 'propose' };
    expect(stampOpen(assistant, 'open')).toBe(assistant);
    const edit: Principal = { actor: 'agent:e', kind: 'agent', scopes: ['observe', 'edit'], mode: 'edit' };
    expect(stampOpen(edit, 'open')).toMatchObject({ open: true, mode: 'edit' });
  });
  it('the floor never reads the stamp', () => {
    const s = stampOpen(agent, 'open');
    expect(isOwnerFloor(s)).toBe(false);
    expect(ownerKeeps(s)).toBe(false);
    expect(isOwnerFloor(owner)).toBe(true);
  });
});
