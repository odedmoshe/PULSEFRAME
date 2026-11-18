/**
 * The launcher proof:phone-drop runs its server with (ADR-0023; verifier correction): startServer with the door's address override
 * taken from THIS script's argv. No environment variable can set cfg.dropAdmitAddresses, and apps/server/src/main.ts is untouched;
 * the proof records that the override was used. Being a child process, it can be killed with SIGKILL (P13) and stopped with
 * SIGTERM (P20).
 *
 *   tsx packages/evals/src/phone-drop-server.ts --data <dir> --port <n> --drop-port <n> [--admit <ipv4>] [--max-upload <bytes>]
 *     [--max-storage <bytes>] [--code-bytes <bytes>]
 * Prints one JSON line when it listens: { ready, url, ownerUrl, agent, ownerKey, pid }. Never prints a drop code.
 */
import { startServer } from '@pulseframe/server';

const arg = (name: string): string | undefined => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const num = (name: string): number | undefined => { const v = arg(name); return v === undefined ? undefined : Number(v); };

const admit = arg('admit');
const s = await startServer({
  dataDir: arg('data')!, port: num('port')!, dropPort: num('drop-port') ?? 0, homeZone: 'Asia/Jerusalem',
  dropAdmitAddresses: admit ? [admit] : [],
  ...(num('max-upload') !== undefined ? { maxUploadBytes: num('max-upload')! } : {}),
  ...(num('max-storage') !== undefined ? { maxStorageBytes: num('max-storage')! } : {}),
  ...(num('code-bytes') !== undefined ? { dropCodeBytes: num('code-bytes')! } : {}),
});
process.stdout.write(`${JSON.stringify({ ready: true, url: s.url, ownerUrl: s.ownerUrl, agent: s.auth.tokens.agent, ownerKey: s.auth.tokens.owner, pid: process.pid, admitted: admit ? [admit] : [] })}\n`);
let closing = false;
process.on('SIGTERM', () => { if (closing) return; closing = true; void s.close().then(() => process.exit(0), () => process.exit(1)); });
