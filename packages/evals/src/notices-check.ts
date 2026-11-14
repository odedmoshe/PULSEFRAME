// Run after `pnpm build`: verifies licence notices ship with the web bundle.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const dist = resolve(root, 'apps/web/dist');
const file = resolve(dist, 'THIRD_PARTY_NOTICES.txt');
const fail = (m: string): never => { console.error(`FAIL notices-check: ${m}`); process.exit(1); };

if (!existsSync(file)) fail(`missing ${file} (run pnpm build)`);
const text = readFileSync(file, 'utf8');
const lower = text.toLowerCase();
const need = (ok: boolean, m: string) => { if (!ok) fail(m); };

const web = JSON.parse(readFileSync(resolve(root, 'apps/web/package.json'), 'utf8')) as { dependencies: Record<string, string> };
need(lower.includes('sil open font license'), 'missing "SIL OPEN FONT LICENSE"');
need(text.includes('Copyright 2014 The Heebo Project Authors'), 'missing Heebo copyright line');
need(text.includes('Mozilla Public License Version 2.0'), 'missing MPL-2.0 text');
need(text.includes('mediabunny 1.66.0'), 'missing mediabunny 1.66.0');
need(text.includes('https://registry.npmjs.org/mediabunny/-/mediabunny-1.66.0.tgz'), 'missing mediabunny source tarball URL');
need(/Repository: https?:\/\//.test(text), 'missing mediabunny repository URL');

for (const n of ['react', 'react-dom']) {
  const v = web.dependencies[n];
  need(!!v, `${n} not in apps/web/package.json`);
  const i = text.indexOf(`\n${n} ${v}\n`);
  need(i >= 0, `missing ${n} ${v}`);
  need(/MIT License|Permission is hereby granted/i.test(text.slice(i, i + 1500)), `no MIT text under ${n}`);
}

const assets = resolve(dist, 'assets');
const fonts = existsSync(assets) ? readdirSync(assets).filter((f) => /^heebo-.*\.woff2$/.test(f)) : [];
need(fonts.length > 0, 'no heebo-*.woff2 in dist/assets');

const m = /^Packages: (.*)$/m.exec(text);
const count = m ? m[1]!.split(', ').length : 0;
console.log(`PASS notices-check: ${count} packages listed, ${fonts.length} heebo woff2 files alongside notice`);
