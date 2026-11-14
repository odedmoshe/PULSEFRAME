import path from 'node:path';
import { startServer } from './index.ts';

const s = await startServer();
console.log(`PULSEFRAME Studio (local profile) listening on ${s.url}`);
console.log(`Agent tokens: ${path.join(s.cfg.dataDir, 'tokens.json')}  |  MCP endpoint: ${s.url}/mcp`);
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => void s.close().then(() => process.exit(0)));
