import path from 'node:path';
import { startServer } from './index.ts';

const s = await startServer();
console.log(`PULSEFRAME Studio (local profile) listening on ${s.url}`);
console.log(`Editor (owner): ${s.ownerUrl}   <- open this link; it carries the owner key for this machine`);
for (const origin of s.cfg.extraOrigins) console.log(`Editor (owner) via ${origin}: ${origin}/?key=${s.auth.tokens.owner}`);
console.log(`Agent tokens: ${path.join(s.cfg.dataDir, 'tokens.json')}  |  MCP endpoint: ${s.url}/mcp`);
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => void s.close().then(() => process.exit(0)));
