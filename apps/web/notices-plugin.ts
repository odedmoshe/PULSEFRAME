// Build-time only Vite plugin: emits THIRD_PARTY_NOTICES.txt into dist.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';
import { FONT_CATALOG } from '../../packages/core/src/fonts.ts';

interface Pkg { name: string; version: string; license: string; url: string; text: string; dir: string }

/** Interface fonts (src/ds/uiFonts.css). Not in FONT_CATALOG on purpose: that list is the canvas and export fonts. */
const UI_FONTS = [
  { package: '@fontsource/ibm-plex-sans-hebrew', slug: 'ibm-plex-sans-hebrew', family: 'IBM Plex Sans Hebrew' },
  { package: '@fontsource/ibm-plex-mono', slug: 'ibm-plex-mono', family: 'IBM Plex Mono' },
  { package: '@fontsource/karantina', slug: 'karantina', family: 'Karantina' },
] as const;

const LICENCE_FILE = /^(licen[sc]e|copying)(\.(md|txt))?$/i;

function findPackageDir(file: string): string | undefined {
  let dir = dirname(file);
  for (;;) {
    const pj = join(dir, 'package.json');
    if (existsSync(pj)) {
      try {
        const j = JSON.parse(readFileSync(pj, 'utf8')) as { name?: string; version?: string };
        if (j.name && j.version) return dir;
      } catch { /* keep walking */ }
    }
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

function licenceOf(j: Record<string, unknown>): string {
  if (typeof j.license === 'string') return j.license;
  if (j.license && typeof j.license === 'object' && typeof (j.license as { type?: unknown }).type === 'string') return (j.license as { type: string }).type;
  return '';
}

function readPkg(dir: string): Pkg {
  const j = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown> & { name: string; version: string };
  const file = readdirSync(dir).find((f) => LICENCE_FILE.test(f));
  const license = licenceOf(j);
  if (!file && !license) throw new Error(`notices: ${j.name}@${j.version} has no licence file and no license field`);
  const repo = j.repository;
  let url = typeof repo === 'string' ? repo : repo && typeof repo === 'object' ? String((repo as { url?: string }).url ?? '') : '';
  url = url.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://');
  if (!url && typeof j.homepage === 'string') url = j.homepage;
  const text = file ? readFileSync(join(dir, file), 'utf8').trim() : `(No licence file shipped in the package; declared licence: ${license})`;
  return { name: j.name, version: j.version, license: license || 'SEE LICENSE TEXT', url: url || '(none declared)', text, dir };
}

export function noticesPlugin(): Plugin {
  const require = createRequire(import.meta.url);
  return {
    name: 'pulseframe-notices',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const dirs = new Set<string>();
      const fontPkgs = new Set<string>();
      for (const [fileName, out] of Object.entries(bundle)) {
        if (out.type === 'asset') for (const f of [...FONT_CATALOG, ...UI_FONTS]) if (new RegExp(`(^|/)${f.slug}-[^/]*\\.woff2?$`).test(fileName)) fontPkgs.add(f.package);
        if (out.type !== 'chunk') continue;
        for (const id of Object.keys(out.modules)) {
          const clean = id.split('?')[0]!.replace(/^\0/, '');
          if (!clean.includes('node_modules')) continue;
          const dir = findPackageDir(clean);
          if (dir) dirs.add(dir);
        }
      }
      for (const p of fontPkgs) dirs.add(dirname(require.resolve(`${p}/package.json`)));
      const pkgs = [...dirs].map(readPkg).filter((p) => !p.name.startsWith('@pulseframe/'));
      const byKey = new Map(pkgs.map((p) => [`${p.name}@${p.version}`, p]));
      const list = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
      for (const p of fontPkgs) if (!list.some((x) => x.name === p)) throw new Error(`notices: font files of ${p} emitted but package not listed`);

      const parts: string[] = [
        'THIRD-PARTY NOTICES',
        '',
        'PULSEFRAME Studio web bundle. The following third-party packages are bundled into this build.',
        'Workspace packages (@pulseframe/*) are first-party and are not listed.',
        '',
        'Packages: ' + list.map((p) => `${p.name}@${p.version}`).join(', '),
      ];
      for (const p of list) {
        parts.push('', '='.repeat(78), `${p.name} ${p.version}`, `License (SPDX): ${p.license}`, `Repository/homepage: ${p.url}`);
        if (p.name === 'mediabunny') {
          parts.push(
            '',
            `Mediabunny ${p.version} is licensed under MPL-2.0 and is bundled UNMODIFIED.`,
            'Corresponding source for this exact version is available from:',
            `  Repository: ${p.url}`,
            `  npm tarball: https://registry.npmjs.org/mediabunny/-/mediabunny-${p.version}.tgz`,
          );
        }
        const font = [...FONT_CATALOG, ...UI_FONTS].find((f) => f.package === p.name);
        if (font) parts.push('', `${font.family} font files (${font.slug}-*.woff2/.woff) are distributed under the SIL Open Font License 1.1; the licence text below accompanies them.`);
        parts.push('', '-'.repeat(78), p.text);
      }
      // map data (wave 8 tripmap; THIRD_PARTY_LICENSES.md §8): public domain, no notice duty; credited and described anyway
      parts.push('', '='.repeat(78), 'Natural Earth v5.1.2 (map data: coastlines, lakes, populated places)', 'License: public domain',
        'Repository: https://github.com/nvkelso/natural-earth-vector (tag v5.1.2, commit f1890d9f152c896d250a77557a5751a93d494776)',
        '', '"Everything here is public domain." ... "No permission is needed to use Natural Earth. Crediting the authors is unnecessary." (LICENSE.md at that tag)',
        'Place names from Wikidata (CC0), per the Natural Earth terms of use. Made with Natural Earth.',
        'Changed: clipped at 80 degrees of latitude, projected to Mercator, simplified and quantised (tools/tripmap/build-data.mjs). No border data is shipped.');
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.txt', source: parts.join('\n') + '\n' });
    },
  };
}
