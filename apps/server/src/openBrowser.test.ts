/**
 * PF_OPEN_BROWSER=1 (wave 8 booth pre-pass): the opener command per platform, an argument array never a shell string, a failure
 * printed and never thrown; and start-pulseframe.cmd sets it with CRLF line endings kept. Every spawn here is an injected recorder:
 * nothing is started. Nobody has run the Windows path on Windows.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openBrowserWanted, openerCommand, openOwnerLink, type Spawner } from './openBrowser.ts';

const URL_ = 'http://127.0.0.1:8787/?key=pfk_AbC-12_xyz';
function recorder(fail?: 'throw' | 'error') {
  const calls: { command: string; args: string[]; options: Record<string, unknown> }[] = [];
  let onError: ((e: Error) => void) | null = null;
  let unrefs = 0;
  const spawn: Spawner = (command, args, options) => {
    if (fail === 'throw') throw new Error('spawn EPERM');
    calls.push({ command, args, options: options as Record<string, unknown> });
    return { on: (_e: 'error', fn: (e: Error) => void) => { onError = fn; }, unref: () => { unrefs++; } };
  };
  return { spawn, calls, emitError: (e: Error) => onError?.(e), unrefs: () => unrefs };
}

describe('PF_OPEN_BROWSER', () => {
  it('is off unless exactly 1', () => {
    expect(openBrowserWanted({})).toBe(false);
    expect(openBrowserWanted({ PF_OPEN_BROWSER: '0' })).toBe(false);
    expect(openBrowserWanted({ PF_OPEN_BROWSER: 'true' })).toBe(false);
    expect(openBrowserWanted({ PF_OPEN_BROWSER: '1' })).toBe(true);
  });
  it('Windows: cmd /c start "" <url> as an argument array with verbatim arguments, hidden, detached', () => {
    const c = openerCommand('win32', URL_)!;
    expect(c.command).toBe('cmd');
    expect(c.args).toEqual(['/c', 'start', '""', URL_]);
    expect(c.options).toMatchObject({ windowsVerbatimArguments: true, windowsHide: true, detached: true, stdio: 'ignore' });
    expect(c.options.shell).toBeUndefined();
  });
  it('macOS open, other platforms xdg-open', () => {
    expect(openerCommand('darwin', URL_)).toMatchObject({ command: 'open', args: [URL_] });
    expect(openerCommand('linux', URL_)).toMatchObject({ command: 'xdg-open', args: [URL_] });
    expect(openerCommand('linux', URL_)!.options.shell).toBeUndefined();
  });
  it('a URL with a character cmd treats specially is never handed to an opener', () => {
    for (const bad of ['http://127.0.0.1:8787/?key=a&calc', 'http://127.0.0.1:8787/?key=a|x', 'http://127.0.0.1/"x', 'http://127.0.0.1/%PATH%', 'http://127.0.0.1/a b', 'file:///C:/x', 'http://127.0.0.1/^x']) {
      expect({ bad, cmd: openerCommand('win32', bad) }).toEqual({ bad, cmd: null });
    }
    const r = recorder(); const lines: string[] = [];
    expect(openOwnerLink('http://127.0.0.1:8787/?key=a&calc', { platform: 'win32', spawn: r.spawn, log: (l) => lines.push(l) })).toBe(false);
    expect(r.calls).toHaveLength(0);
    expect(lines.join('\n')).toMatch(/by hand/);
  });
  it('opens through the injected spawner, unrefs the child, and prints without the key', () => {
    const r = recorder(); const lines: string[] = [];
    expect(openOwnerLink(URL_, { platform: 'win32', spawn: r.spawn, log: (l) => lines.push(l) })).toBe(true);
    expect(r.calls).toEqual([{ command: 'cmd', args: ['/c', 'start', '""', URL_], options: expect.objectContaining({ windowsVerbatimArguments: true }) }]);
    expect(r.unrefs()).toBe(1);
    expect(lines.join('\n')).not.toContain('pfk_');
  });
  it('a failure is printed, never thrown: a spawn that throws, and an error event (no xdg-open)', () => {
    const lines: string[] = [];
    expect(openOwnerLink(URL_, { platform: 'linux', spawn: recorder('throw').spawn, log: (l) => lines.push(l) })).toBe(false);
    expect(lines.at(-1)).toMatch(/could not open the browser .*by hand/);
    const r = recorder();
    expect(openOwnerLink(URL_, { platform: 'linux', spawn: r.spawn, log: (l) => lines.push(l) })).toBe(true);
    expect(() => r.emitError(Object.assign(new Error('spawn xdg-open ENOENT'), { code: 'ENOENT' }))).not.toThrow();
    expect(lines.at(-1)).toBe('PF_OPEN_BROWSER: could not open the browser (xdg-open: ENOENT). Open the "Editor (owner)" link above by hand.');
  });
  it('start-pulseframe.cmd sets PF_OPEN_BROWSER=1 before pnpm start, unless already set, and keeps CRLF line endings', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const text = fs.readFileSync(path.join(root, 'start-pulseframe.cmd'), 'latin1');
    const lines = text.split('\r\n');
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
    const set = lines.indexOf('if not defined PF_OPEN_BROWSER set "PF_OPEN_BROWSER=1"');
    expect(set).toBeGreaterThan(0);
    expect(lines.indexOf('call pnpm start')).toBe(set + 1);
  });
});
