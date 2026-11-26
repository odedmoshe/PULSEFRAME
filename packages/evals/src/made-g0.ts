/**
 * Gate G0 of the made-clip track (wave 8 `motioncode`, verify C1 + C5): the made browser starts with Chromium's sandbox ON
 * (on Linux as root: through the privilege-drop wrapper of `madeLaunch.ts`), its renderer runs in its own network namespace with
 * seccomp-bpf, and a page's network attempts leave nothing in Chromium's net-log (no DNS job, no socket connect, no UDP, no URL
 * request other than the routed `made.invalid`), and a loopback listener sees zero connections.
 * Exit 0 = pass, 1 = a row failed, 2 = blocked (Chromium will not start). Run: `pnpm proof:made-g0` (through .artifacts/heavy).
 */
import { chmod, mkdtemp, readFile, readdir, readlink, rm } from 'node:fs/promises';
import http from 'node:http';
import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium, type BrowserContext } from 'playwright';
import { MADE_CHROMIUM_ARGS, MADE_INIT_NETWORK_LOCK, MADE_ORIGIN, MADE_PAGE_CSP, dirForUid, findSetpriv, madeLaunchPlan, writeDropPrivilegeWrapper } from '../../../apps/renderer/src/madeLaunch.ts';

const rows: { name: string; ok: boolean; detail: string }[] = [];
const row = (name: string, ok: boolean, detail: string) => { rows.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`); };

/** Network attempts of the page; every name string-built so a static scan would not see them. */
const attackPage = (tcp: number, udp: number) => `<!doctype html><meta charset=utf-8><title>g0</title><body><script>
(async () => {
  const W = window, H = ['127.0.0.1:${tcp}', 'localhost:${tcp}', 'pf-probe.localhost:${tcp}', 'example.com'];
  const tries = [];
  for (const h of H) {
    tries.push(W['fe'+'tch']?.('http://' + h + '/f').catch(() => {}));
    try { const x = new W['XML'+'HttpRequest'](); x.open('GET', 'http://' + h + '/x'); x.send(); } catch {}
    try { const i = new Image(); i.src = 'http://' + h + '/i.png'; document.body.append(i); } catch {}
    try { new W['Web'+'Socket']('ws://' + h + '/w'); } catch {}
    try { new W['Event'+'Source']('http://' + h + '/e'); } catch {}
    try { navigator['send'+'Beacon']('http://' + h + '/b', 'x'); } catch {}
    try { const l = document.createElement('link'); l.rel = 'dns-prefetch'; l.href = '//' + h; document.head.append(l); } catch {}
    try { const l = document.createElement('link'); l.rel = 'prefetch'; l.href = 'http://' + h + '/p'; document.head.append(l); } catch {}
    try { const s = document.createElement('style'); s.textContent = '@font-face{font-family:x;src:url(http://' + h + '/f.woff2)} body{font-family:x;background:url(http://' + h + '/bg.png)}'; document.head.append(s); } catch {}
  }
  try { const pc = new W['RTCPeer'+'Connection']({ iceServers: [{ urls: 'stun:127.0.0.1:${udp}' }] }); pc.createDataChannel('d'); await pc.setLocalDescription(await pc.createOffer()); } catch {}
  try { const f = document.createElement('iframe'); document.body.append(f); const w = f.contentWindow; w['fe'+'tch']?.('http://127.0.0.1:${tcp}/iframe').catch(() => {}); try { new w['RTCPeer'+'Connection']({ iceServers: [{ urls: 'stun:127.0.0.1:${udp}' }] }).createDataChannel('x'); } catch {} } catch {}
  try { const u = URL.createObjectURL(new Blob(["fetch('http://127.0.0.1:${tcp}/worker')"], { type: 'text/javascript' })); new W['Wor'+'ker'](u); } catch {}
  try { W['op'+'en']('http://127.0.0.1:${tcp}/popup'); } catch {}
  await Promise.allSettled(tries);
  await new Promise((r) => setTimeout(r, 1500));
  document.title = 'done';
})();
</script>`;

interface NetLog { constants: { logEventTypes: Record<string, number>; logSourceType: Record<string, number> }; events: { type: number; source: { type: number }; params?: any }[] }
async function readNetLog(file: string): Promise<NetLog> {
  let text = (await readFile(file, 'utf8')).trim();
  if (!text.endsWith('}')) text = text.replace(/,\s*$/, '') + ']}'; // a log cut at exit lacks its closing brackets
  return JSON.parse(text);
}
const fmt = (c: ReturnType<typeof netLogCounts>) => `host-resolver jobs ${c.hostResolverJobs}, socket connects ${c.socketConnects}, UDP ${c.udpConnects}, other URL requests ${c.otherUrlRequests.length}${c.otherUrlRequests.length ? ` (${c.otherUrlRequests.slice(0, 5).join(', ')})` : ''}, made.invalid requests ${c.madeRequests}`;
function netLogCounts(log: NetLog) {
  const name = Object.fromEntries(Object.entries(log.constants.logEventTypes).map(([k, v]) => [v, k]));
  const c = { hostResolverJobs: 0, socketConnects: 0, udpConnects: 0, otherUrlRequests: [] as string[], madeRequests: 0 };
  for (const e of log.events) {
    const n = name[e.type] ?? '';
    if (/^HOST_RESOLVER_(MANAGER|DNS)_JOB$|^HOST_RESOLVER_IMPL_JOB$|^HOST_RESOLVER_MANAGER_JOB$/.test(n)) c.hostResolverJobs++;
    if (n === 'TCP_CONNECT' || n === 'TCP_CONNECT_ATTEMPT' || n === 'SOCKET_CONNECT') c.socketConnects++;
    if (n === 'UDP_CONNECT' || n === 'UDP_LOCAL_ADDRESS') c.udpConnects++;
    if (n === 'URL_REQUEST_START_JOB' && e.params?.url) {
      if (String(e.params.url).startsWith(MADE_ORIGIN + '/')) c.madeRequests++; else c.otherUrlRequests.push(String(e.params.url));
    }
  }
  return c;
}

/** The browser process started with this net-log path (unique to this run; other agents run the same executable), and its renderers. */
async function pidsOf(marker: string): Promise<{ browser?: number; renderers: number[] }> {
  const procs: { pid: number; ppid: number; cmd: string }[] = [];
  for (const d of await readdir('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    const cmd = (await readFile(`/proc/${d}/cmdline`, 'utf8').catch(() => '')).replace(/\0/g, ' ');
    const stat = await readFile(`/proc/${d}/stat`, 'utf8').catch(() => '');
    const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    if (cmd) procs.push({ pid: Number(d), ppid, cmd });
  }
  const browser = procs.find((p) => p.cmd.includes(marker) && !p.cmd.includes('--type=') && /chrome-headless-shell\.real/.test(p.cmd))?.pid;
  const mine = new Set<number>(browser ? [browser] : []);
  for (let grew = true; grew;) { grew = false; for (const p of procs) if (!mine.has(p.pid) && mine.has(p.ppid)) { mine.add(p.pid); grew = true; } }
  return { browser, renderers: procs.filter((p) => mine.has(p.pid) && p.cmd.includes('--type=renderer')).map((p) => p.pid) };
}
const procInfo = async (pid: number) => {
  const status = await readFile(`/proc/${pid}/status`, 'utf8');
  return { net: await readlink(`/proc/${pid}/ns/net`), user: await readlink(`/proc/${pid}/ns/user`), seccomp: /^Seccomp:\s*(\d)/m.exec(status)?.[1], uid: /^Uid:\s*(\d+)/m.exec(status)?.[1] };
};

async function main() {
  const exe = chromium.executablePath().replace('chromium-1243/chrome-linux64/chrome', 'chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell');
  const plan = madeLaunchPlan({ platform: process.platform, uid: process.getuid?.() ?? null, setprivPath: findSetpriv() });
  console.log(`launch plan: ${JSON.stringify(plan)}; executable ${exe}`);
  const work = await mkdtemp(path.join(os.tmpdir(), 'pf-made-g0-'));
  await chmod(work, 0o711); // the dropped uid must be able to reach its own folders inside (mkdtemp makes 0700)
  const uid = plan.dropToUid;
  const logDir = uid !== undefined ? await dirForUid(path.join(work, 'log'), uid) : path.join(work, 'log');
  if (uid === undefined) await import('node:fs/promises').then((f) => f.mkdir(logDir, { recursive: true }));
  const executablePath = uid !== undefined ? await writeDropPrivilegeWrapper(path.join(work, 'bin'), exe, uid, findSetpriv()!) : exe;

  let tcpHits = 0; let udpHits = 0;
  const tcp = net.createServer((s) => { tcpHits++; s.destroy(); }); await new Promise<void>((r) => tcp.listen(0, '127.0.0.1', r));
  const httpSrv = http.createServer((_q, r) => { tcpHits++; r.end(); }); await new Promise<void>((r) => httpSrv.listen(0, '127.0.0.1', r));
  const udp = dgram.createSocket('udp4'); udp.on('message', () => { udpHits++; }); await new Promise<void>((r) => udp.bind(0, '127.0.0.1', r));
  const tcpPort = (tcp.address() as net.AddressInfo).port; const udpPort = udp.address().port;

  const launch = async (log: string) => {
    try {
      return await chromium.launch({ executablePath, chromiumSandbox: plan.chromiumSandbox, args: [...MADE_CHROMIUM_ARGS, `--log-net-log=${log}`, '--net-log-capture-mode=Everything'], timeout: 30_000 });
    } catch (e: any) {
      console.error(`BLOCKED: the made browser did not start: ${e?.message ?? e}`); process.exit(2);
    }
  };
  const route = async (context: BrowserContext, body: string) => {
    await context.route('**/*', (rt) => rt.request().url() === `${MADE_ORIGIN}/page.html`
      ? rt.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': MADE_PAGE_CSP }, body })
      : rt.abort());
    await context.routeWebSocket('**', (ws) => ws.close());
  };
  let browser: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    // Run 1: a blank page in the sandboxed browser. Row 1: sandbox engaged; row 2: the net-log has no request at all.
    const log1 = path.join(logDir, 'blank.json');
    browser = await launch(log1);
    const c1 = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    await route(c1, '<!doctype html><title>blank</title>');
    const p1 = await c1.newPage(); await p1.goto(`${MADE_ORIGIN}/page.html`);
    const pids = await pidsOf(log1);
    if (!pids.browser || !pids.renderers.length) row('G0.1 sandbox', false, `processes not found: ${JSON.stringify(pids)}`);
    else {
      const b = await procInfo(pids.browser); const r = await procInfo(pids.renderers[0]!);
      const ok = plan.chromiumSandbox && b.net !== r.net && b.user !== r.user && r.seccomp === '2' && b.uid !== '0';
      row('G0.1 sandbox', ok, `chromiumSandbox=${plan.chromiumSandbox} browser uid ${b.uid} ns/net ${b.net} ns/user ${b.user}; renderer ${pids.renderers[0]} ns/net ${r.net} ns/user ${r.user} Seccomp ${r.seccomp}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
    await c1.close(); await browser.close(); browser = undefined;
    const blank = netLogCounts(await readNetLog(log1));
    row('G0.2 net-log, blank page', blank.hostResolverJobs === 0 && blank.socketConnects === 0 && blank.udpConnects === 0 && blank.otherUrlRequests.length === 0, fmt(blank));
    // Runs 2 and 3: the attack page, first with the launch arguments, route and CSP only (recorded), then with the init-script lock too (gated).
    for (const locked of [false, true]) {
      tcpHits = 0; udpHits = 0;
      const log = path.join(logDir, locked ? 'attack-locked.json' : 'attack-bare.json');
      browser = await launch(log);
      const c2 = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
      if (locked) await c2.addInitScript(MADE_INIT_NETWORK_LOCK);
      await route(c2, attackPage(tcpPort, udpPort));
      let navigations = 0; let popups = 0;
      const p2 = await c2.newPage();
      c2.on('page', (pg) => { if (pg !== p2) { popups++; void pg.close(); } });
      p2.on('framenavigated', () => { navigations++; });
      await p2.goto(`${MADE_ORIGIN}/page.html`);
      await p2.waitForFunction(() => document.title === 'done', undefined, { timeout: 20_000 }).catch(() => {});
      await c2.close(); await browser.close(); browser = undefined;
      await new Promise((r) => setTimeout(r, 300));
      const counts = netLogCounts(await readNetLog(log));
      const ok = counts.hostResolverJobs === 0 && counts.socketConnects === 0 && counts.udpConnects === 0 && counts.otherUrlRequests.length === 0 && tcpHits === 0 && udpHits === 0;
      const name = locked ? 'G0.4 attack page, launch arguments + route + CSP + init-script lock' : 'G0.3 attack page, launch arguments + route + CSP only (recorded, not gated)';
      if (locked) row(name, ok, `${fmt(counts)}; listener TCP ${tcpHits}, UDP datagrams ${udpHits}; navigations ${navigations}, pop-ups closed ${popups}`);
      else console.log(`INFO ${name} — ${fmt(counts)}; listener TCP ${tcpHits}, UDP datagrams ${udpHits}; navigations ${navigations}, pop-ups closed ${popups}`);
    }
  } finally {
    await browser?.close().catch(() => {});
    tcp.close(); httpSrv.close(); udp.close();
    if (!process.env.PF_KEEP) await rm(work, { recursive: true, force: true }); else console.log(`kept ${work}`);
  }
  process.exit(rows.every((r) => r.ok) ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
