// Run after `pnpm build`: verifies licence notices ship with the web bundle.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FONT_CATALOG } from '@pulseframe/core';

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
const emitted = existsSync(assets) ? readdirSync(assets) : [];
let fontFiles = 0;
for (const f of FONT_CATALOG) {
  // Every catalog font: pinned in package.json, files emitted for each weight (Hebrew + Latin), package + OFL text in the notices.
  need(web.dependencies[f.package] === f.version, `${f.package} is not pinned to ${f.version} in apps/web/package.json`);
  for (const w of f.weights) for (const subset of ['hebrew', 'latin']) {
    const hit = emitted.filter((n) => n.startsWith(`${f.slug}-${subset}-${w}-normal`) && n.endsWith('.woff2'));
    need(hit.length === 1, `expected one ${f.slug}-${subset}-${w}-normal*.woff2 in dist/assets, found ${hit.length}`);
    fontFiles += hit.length;
  }
  const i = text.indexOf(`\n${f.package} ${f.version}\n`);
  need(i >= 0, `missing ${f.package} ${f.version} in notices`);
  const next = text.indexOf('\n' + '='.repeat(78), i + 1);
  need(/SIL OPEN FONT LICENSE/i.test(text.slice(i, next < 0 ? undefined : next)), `no OFL text under ${f.package}`);
}

const m = /^Packages: (.*)$/m.exec(text);
const count = m ? m[1]!.split(', ').length : 0;
console.log(`PASS notices-check: ${count} packages listed, ${FONT_CATALOG.length} font families (${fontFiles} woff2 files) with OFL text alongside`);
