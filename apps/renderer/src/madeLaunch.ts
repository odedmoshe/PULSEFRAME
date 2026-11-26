/**
 * How the made-clip browser is started («קליפ מקוד», wave 8 `motioncode`). Pre-pass contract: the arguments and the Linux
 * privilege-drop wrapper are settled here and exercised by gate G0 (`packages/evals/src/made-g0.ts`); the harness that drives
 * pages (`made.ts`, W1) builds on them. It is a SEPARATE browser from the export browser (`RenderHost`), whose pages hold render
 * tokens.
 *
 * Sandbox (verify C1 as amended after the owner's autonomy decision): Chromium's own sandbox is used wherever it starts. As uid 0
 * on Linux it refuses to start, so there the browser is started through a small wrapper that drops to an unprivileged uid
 * (65534 by default) when `setpriv` exists; measured by G0 in this container: the renderer then runs in its own user and network
 * namespace with seccomp-bpf. Where neither works the job warns («הדפדפן רץ בלי ארגז החול של כרום») and continues; nothing is
 * refused for lack of the sandbox. The sandbox protects the machine from a renderer exploit; it does NOT close web-API network
 * (that goes through the browser's network service). The arguments below, the route and the page CSP close the network, and the
 * judge is Chromium's net-log, not a listener.
 */
import { chmod, chown, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Launch arguments of the made browser. `made.invalid` is answered by the Playwright route, never by DNS, so it is NOT excluded
 * from the resolver map (verify C5: EXCLUDE would only send real DNS queries out). Port 9 is the dead proxy; loopback is sent
 * through it too (`<-loopback>`), so the editor's own port is unreachable even if the route were bypassed.
 */
export const MADE_CHROMIUM_ARGS: readonly string[] = Object.freeze([
  '--host-resolver-rules=MAP * ~NOTFOUND',
  '--proxy-server=http://127.0.0.1:9',
  '--proxy-bypass-list=<-loopback>',
  '--webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--force-webrtc-ip-handling-policy',
  '--disable-gpu',
  '--js-flags=--max-old-space-size=256',
  '--disable-background-networking',
  '--disable-component-update',
  '--no-pings',
  '--disable-features=NetworkPrediction,Translate',
  '--run-all-compositor-stages-before-draw',
  '--disable-threaded-animation',
  '--disable-checker-imaging',
  '--font-render-hinting=none',
]);

/**
 * The response CSP of a made page (verify C5). `navigate-to` is not listed: it never shipped in Chromium. Navigation is caught by
 * the route and by failing the job on any `framenavigated`. `/lib/` and `/assets/` are the locally served pinned libraries and
 * the owner's media (decision 5); internet files are fetched once BEFORE drawing and served from the same origin.
 */
export const MADE_PAGE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://made.invalid/lib/",
  "style-src 'unsafe-inline' https://made.invalid/fonts/",
  'img-src data: blob: https://made.invalid/assets/ https://made.invalid/fetched/',
  'media-src https://made.invalid/assets/ https://made.invalid/fetched/',
  'font-src https://made.invalid/fonts/',
  "frame-src 'none'",
  "worker-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/** The only origin a made page sees. */
export const MADE_ORIGIN = 'https://made.invalid';

export type MadeSandbox = 'chromium' | 'chromium-dropped-uid' | 'none';

export interface MadeLaunchPlan {
  /** What protects the machine: Chromium's sandbox as the current user, after dropping to an unprivileged uid, or nothing. */
  sandbox: MadeSandbox;
  /** Playwright's `chromiumSandbox`. */
  chromiumSandbox: boolean;
  /** Set when the browser must start through the privilege-drop wrapper (Linux as root). */
  dropToUid?: number;
  /** Why the sandbox is off, in words for the job report (he/en), when it is. */
  warning?: { he: string; en: string };
}

/** Decide how to launch, from facts only (no launch here). */
export function madeLaunchPlan(env: { platform: NodeJS.Platform; uid: number | null; setprivPath: string | null; dropUid?: number }): MadeLaunchPlan {
  if (env.platform !== 'linux' || env.uid !== 0) return { sandbox: 'chromium', chromiumSandbox: true };
  if (env.setprivPath) return { sandbox: 'chromium-dropped-uid', chromiumSandbox: true, dropToUid: env.dropUid ?? 65534 };
  return {
    sandbox: 'none', chromiumSandbox: false,
    warning: { he: 'הדפדפן רץ בלי ארגז החול של כרום (המחשב מריץ את העורך כמשתמש־על, ו־setpriv לא נמצא)', en: 'the browser runs without Chromium\'s sandbox (the editor runs as root here and setpriv was not found)' },
  };
}

/** Where `setpriv` is, if anywhere (Linux). */
export function findSetpriv(): string | null {
  for (const p of ['/usr/bin/setpriv', '/bin/setpriv']) if (existsSync(p)) return p;
  return null;
}

/**
 * Write the wrapper Playwright starts as `executablePath` on Linux as root. It gives the profile directory Playwright created
 * (root-owned, 0700) to the unprivileged uid, then replaces itself with the browser under that uid. Playwright talks to the
 * browser over inherited pipes (fds 3 and 4), which `exec` and `setpriv` keep. Returns the wrapper's path.
 */
export async function writeDropPrivilegeWrapper(dir: string, executable: string, uid: number, setpriv: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'made-chromium.sh');
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  await writeFile(file, [
    '#!/bin/sh',
    '# Made-clip browser: drop to an unprivileged uid so Chromium\'s own sandbox can start (written by madeLaunch.ts).',
    'for a in "$@"; do',
    '  case "$a" in --user-data-dir=*) d="${a#--user-data-dir=}"; chown -R ' + `${uid}:${uid}` + ' "$d" ;; esac',
    'done',
    `exec ${q(setpriv)} --reuid=${uid} --regid=${uid} --clear-groups ${q(executable)} "$@"`,
    '',
  ].join('\n'));
  await chmod(file, 0o755);
  return file;
}

/** Make a directory the dropped uid can write (net-log, artefacts). */
export async function dirForUid(dir: string, uid: number): Promise<string> {
  await mkdir(dir, { recursive: true });
  await chown(dir, uid, uid);
  return dir;
}

/**
 * The network part of the init script, run in EVERY frame (Playwright addInitScript reaches about:blank and srcdoc iframes; verify E2).
 * Measured by G0 here: with the launch arguments, the route and the page CSP alone, an RTCPeerConnection with a STUN server on
 * 127.0.0.1 still sent UDP datagrams (headless shell does not apply Chrome's WebRTC IP-handling policy switches), so the constructors
 * are deleted in every realm. W1's harness adds the clock trap, PF and the fonts to the same script; this part is the contract.
 */
export const MADE_INIT_NETWORK_LOCK = `(() => {
  const gone = ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCRtpSender', 'RTCRtpReceiver', 'RTCIceCandidate', 'RTCSessionDescription', 'WebTransport', 'WebSocket', 'WebSocketStream', 'EventSource', 'XMLHttpRequest', 'fetch', 'Worker', 'SharedWorker'];
  for (const k of gone) { try { Object.defineProperty(globalThis, k, { value: undefined, writable: false, configurable: false }); } catch {} }
  try { Object.defineProperty(Navigator.prototype, 'sendBeacon', { value: undefined, writable: false, configurable: false }); } catch {}
  try { Object.defineProperty(Navigator.prototype, 'mediaDevices', { get: () => undefined, configurable: false }); } catch {}
})();`;
