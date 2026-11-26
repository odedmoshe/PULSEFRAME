/**
 * PF_OPEN_BROWSER=1: after the server listens, open the owner link in the default browser (wave 8 booth pre-pass, decisions "booth";
 * verify C9: the key is stripped from the address bar after load, so a bookmark works only while the cookie lives). Off by default;
 * start-pulseframe.cmd sets it. Nobody has run this on Windows yet.
 *
 * - Windows: `cmd /c start "" <url>` through spawn with an argument array and windowsVerbatimArguments, never a shell string; the URL
 *   is checked first to hold only characters cmd does not treat specially (no & | ^ < > " % or spaces), else nothing is started.
 * - macOS: `open <url>`; other platforms: `xdg-open <url>`.
 * - A failure (no opener, a refused URL, a spawn error) is printed, never fatal; the printed owner link stays the way in.
 */
import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';

export interface OpenerCommand { command: string; args: string[]; options: SpawnOptions }
/** Characters an owner link may hold (http, loopback host, port, path, ?key=<token>). */
const SAFE_URL = /^https?:\/\/[A-Za-z0-9.\-[\]:]+(?:\/[A-Za-z0-9._~\-/?=]*)?$/;
export const openerUrlIsSafe = (url: string): boolean => url.length <= 2048 && SAFE_URL.test(url);

/** The command that opens `url` on `platform`, or null when the URL holds a character the opener could misread. */
export function openerCommand(platform: NodeJS.Platform, url: string): OpenerCommand | null {
  if (!openerUrlIsSafe(url)) return null;
  const options: SpawnOptions = { detached: true, stdio: 'ignore' };
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '""', url], options: { ...options, windowsVerbatimArguments: true, windowsHide: true } };
  if (platform === 'darwin') return { command: 'open', args: [url], options };
  return { command: 'xdg-open', args: [url], options };
}

export type Spawner = (command: string, args: string[], options: SpawnOptions) => { on(event: 'error', fn: (e: Error) => void): unknown; unref(): void };
export interface OpenDeps { platform?: NodeJS.Platform; spawn?: Spawner; log?: (line: string) => void }
/** Whether PF_OPEN_BROWSER asks for it (exactly '1'). */
export const openBrowserWanted = (env: NodeJS.ProcessEnv = process.env): boolean => env.PF_OPEN_BROWSER === '1';

/** Starts the opener and returns whether it was started (not whether a browser appeared: nothing here can see that). */
export function openOwnerLink(url: string, deps: OpenDeps = {}): boolean {
  const log = deps.log ?? ((l: string) => console.log(l));
  const cmd = openerCommand(deps.platform ?? process.platform, url);
  if (!cmd) { log('PF_OPEN_BROWSER: the owner link holds characters the opener could misread, so no browser was opened. Open the "Editor (owner)" link above by hand.'); return false; }
  try {
    const child = (deps.spawn ?? (nodeSpawn as unknown as Spawner))(cmd.command, cmd.args, cmd.options);
    child.on('error', (e) => log(`PF_OPEN_BROWSER: could not open the browser (${cmd.command}: ${String((e as NodeJS.ErrnoException).code ?? e.message).slice(0, 80)}). Open the "Editor (owner)" link above by hand.`));
    child.unref();
    log('PF_OPEN_BROWSER: opening the "Editor (owner)" link in the default browser.');
    return true;
  } catch (e) {
    log(`PF_OPEN_BROWSER: could not open the browser (${String((e as Error)?.message ?? e).slice(0, 80)}). Open the "Editor (owner)" link above by hand.`);
    return false;
  }
}
