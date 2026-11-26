# Third-party licences

This file lists third-party packages, fonts and external runtimes that PULSEFRAME uses, with the licence values recorded in the packages themselves. It is a factual inventory, not a legal review.

Sources: `pnpm licenses list --json` (reads the `license` field of each installed package's `package.json`), the manifests `package.json`, `apps/*/package.json` and `packages/*/package.json`, and the font files in `node_modules/.pnpm/@fontsource+heebo@5.3.0`. Snapshot date: 2026-11-14.

## 1. Direct dependencies

"Shipped" means the package is a runtime dependency of `apps/web` or `apps/server` (directly or through a workspace package they depend on). Dev tools are marked "no".

| Package | Version | License (SPDX) | Used by | Shipped to end users? |
|---|---|---|---|---|
| @fontsource/heebo | 5.3.0 | OFL-1.1 | @pulseframe/web | yes |
| mediabunny | 1.66.0 | MPL-2.0 | @pulseframe/web | yes |
| react | 19.3.1 | MIT | @pulseframe/web | yes |
| react-dom | 19.3.1 | MIT | @pulseframe/web | yes |
| @hono/node-server | 2.1.8 | MIT | @pulseframe/server | yes |
| hono | 4.13.18 | MIT | @pulseframe/server | yes |
| @modelcontextprotocol/server | 2.4.0 | Apache-2.0 | @pulseframe/server | yes |
| @modelcontextprotocol/client | 2.4.0 | Apache-2.0 | @pulseframe/evals (test harness only) | no |
| better-sqlite3 | 13.2.0 | MIT | @pulseframe/server | yes |
| zod | 4.6.7 | MIT | @pulseframe/server, @pulseframe/core, @pulseframe/providers | yes |
| playwright | 1.63.0 | Apache-2.0 | @pulseframe/renderer (used by apps/server), @pulseframe/evals | yes (via apps/server) |
| @types/node | 22.20.5 | MIT | root (devDependencies) | no |
| @types/better-sqlite3 | 9.6.0 | MIT | @pulseframe/server (devDependencies) | no |
| @types/react | 19.3.0 | MIT | @pulseframe/web (devDependencies) | no |
| @types/react-dom | 19.3.0 | MIT | @pulseframe/web (devDependencies) | no |
| @vitejs/plugin-react | 6.3.0 | MIT | @pulseframe/web (devDependencies) | no |
| vite | 8.3.8 | MIT | @pulseframe/web (devDependencies) | no |
| typescript | 7.0.2 | Apache-2.0 | root (devDependencies) | no |
| tsx | 4.23.15 | MIT | root (devDependencies) | no |
| vitest | 5.1.0 | MIT | root (devDependencies) | no |
| fast-check | 4.10.2 | MIT | root (devDependencies) | no |

Workspace packages (`@pulseframe/*`, all `private`, version `0.0.0`) are first-party and are not listed here. The root package `pulseframe` is also first-party.

## 2. Transitive dependencies by licence

The lockfile resolves 78 unique packages in total: 21 direct external packages (section 1) and 57 transitive packages. Each package has a single resolved version.

| License | Count | Example packages (max 5) |
|---|---|---|
| MIT | 45 | @esbuild/linux-x64@0.28.2, @jridgewell/resolve-uri@3.1.3, @jridgewell/sourcemap-codec@1.6.0, @jridgewell/trace-mapping@0.3.31, @oxc-project/types@0.156.0 |
| Apache-2.0 | 5 | @modelcontextprotocol/core@2.4.0, @typescript/typescript-linux-x64@7.0.2, detect-libc@2.1.2, expect-type@1.4.0, playwright-core@1.63.0 |
| ISC | 3 | isexe@2.0.0, picocolors@1.1.1, which@2.0.2 |
| MPL-2.0 | 3 | lightningcss@1.33.0, lightningcss-linux-x64-gnu@1.33.0, lightningcss-linux-x64-musl@1.33.0 |
| BSD-3-Clause | 1 | source-map-js@1.2.2 |
| **Total** | **57** | |

Transitive packages whose licence is NOT one of MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0, Unlicense, Python-2.0:

- lightningcss, version 1.33.0, MPL-2.0
- lightningcss-linux-x64-gnu, version 1.33.0, MPL-2.0
- lightningcss-linux-x64-musl, version 1.33.0, MPL-2.0

These are pulled in by the build toolchain (vite). The automated listing is not a legal review.

## 3. Fonts

**Heebo**, via `@fontsource/heebo` 5.3.0.

- Licence: SIL Open Font License, Version 1.1 (OFL-1.1), as recorded in the package's `package.json`.
- Copyright line (from the package `LICENSE` file): `Copyright 2014 The Heebo Project Authors (https://github.com/OdedEzer/heebo)`

Bundled font files and their SHA-256 hashes (verified against the installed package on 2026-11-14):

| File | SHA-256 |
|---|---|
| heebo-hebrew-400-normal.woff2 | 2bc607f150e17d5e334f2ce917a2385661f5f4457f212b5b3bed6a22fc1d2077 |
| heebo-hebrew-700-normal.woff2 | 7dee88b8da46dc5bbc8e7a4a14f1ae18ea506679b60f80ea765cf373a0c3073b |
| heebo-latin-400-normal.woff2 | 2fbe59e5561759450e111cff78825304c9278ec6ba5e808cbaff1c4a97dfa6fa |
| heebo-latin-700-normal.woff2 | 2dd5f140b9902257dc0f38e89f47f79d40b31438abef118637d916861fd370bb |

The OFL requires the licence text to accompany the font. The full OFL-1.1 text and copyright line from `@fontsource/heebo/LICENSE` are emitted into `apps/web/dist/THIRD_PARTY_NOTICES.txt` at build time (served at `/THIRD_PARTY_NOTICES.txt`).

### Interface fonts (UI redesign "Pulse", `apps/web/src/ds/uiFonts.css`)

Bundled for the interface only; the canvas and export fonts above are unchanged. All three are SIL Open Font License, Version 1.1 (OFL-1.1), recorded in each package's `package.json` and `LICENSE`, pinned exactly (5.3.0).

- **IBM Plex Sans Hebrew** (400/500/600/700, Hebrew and Latin subsets), `@fontsource/ibm-plex-sans-hebrew` 5.3.0. Copyright 2019 IBM Corp. All rights reserved.
- **IBM Plex Mono** (400/500, Latin subset), `@fontsource/ibm-plex-mono` 5.3.0. Copyright 2017 IBM Corp. All rights reserved.
- **Karantina** (400/700, Hebrew and Latin subsets; display sizes only), `@fontsource/karantina` 5.3.0. Copyright 2020 The Karantina Project Authors (https://github.com/ronykoch/Karantina).

`apps/web/notices-plugin.ts` emits the full OFL-1.1 text and copyright lines of these three packages into `apps/web/dist/THIRD_PARTY_NOTICES.txt` at build time, next to the Heebo notice.

## 4. External runtimes used but NOT distributed by this repository

The items below are system-installed or operator-installed. They are not vendored in this repository. Their licence obligations apply to whoever distributes or operates them.

- **FFmpeg 6.1.1-3ubuntu5** (Ubuntu package). The build is configured with `--enable-gpl` and includes libx264, libx265, libass, libfreetype, libfribidi, libharfbuzz, libvpx, libopus, libaom, libdav1d, libsvtav1 and libmp3lame. This build is therefore GPL. H.264 and AAC patent licensing is a separate matter that is not assessed here.
- **Chromium 153.0.8010.12** via **Playwright 1.63.0**. Playwright is Apache-2.0. Chromium is BSD-3-Clause plus many third-party licences.
- **SQLite 3.54.1** (public domain), compiled into better-sqlite3.
- **ComfyUI 0.45.0** at commit `eee59185ff4f43ae2d9ad122b245619d27d9daad`, GPL-3.0. It is an optional provider, used only as a separately run process in development. **PyTorch 2.15.0** (BSD-3-Clause) is used with it. No model weights are downloaded or bundled.

## 5. MPL-2.0 note

mediabunny 1.66.0 is licensed MPL-2.0 and is bundled unmodified into the web app. Files covered by MPL-2.0 keep their licence, and the source-availability and notice duties of MPL-2.0 apply on distribution. See https://www.mozilla.org/en-US/MPL/2.0/FAQ/

The build emits `THIRD_PARTY_NOTICES.txt` with the full MPL-2.0 text, the package repository URL, the npm tarball URL for the exact version (`https://registry.npmjs.org/mediabunny/-/mediabunny-1.66.0.tgz`) and a statement that it is bundled unmodified.

## 6. Open compliance items

- Done: `apps/web/notices-plugin.ts` emits `apps/web/dist/THIRD_PARTY_NOTICES.txt` listing every third-party package in the bundle (heebo, mediabunny, react, react-dom, scheduler, zod at the last build) with full licence texts; the build fails if a bundled package has no licence file and no `license` field. `pnpm check:notices` verifies the output after `pnpm build`.
- The transitive licence review is an automated listing from `pnpm licenses list`. It is not a legal review.
- No model or media licences apply yet, because no model weights or media assets are shipped.

## 7. Original project assets

- The logo and design tokens in `packages/brand` are original to this project.
- Procedural test fixtures are generated by `packages/fixtures`. No third-party media is used.

## 8. Map data

**Natural Earth v5.1.2** (`nvkelso/natural-earth-vector`, tag `v5.1.2` = commit `f1890d9f152c896d250a77557a5751a93d494776`), used by the trip map («מפת טיול»).

- Licence, read at that tag (`LICENSE.md`): "Everything here is public domain." … "All versions of Natural Earth raster + vector map data found on this website are in the public domain." … "No permission is needed to use Natural Earth. Crediting the authors is unnecessary."
- Place names (`NAME_HE`, `NAME_EN`): the Natural Earth terms of use say "The authors' used name data for more than 20 languages from Wikidata which is under a CC0 (public domain) license."
- Inputs (downloaded once on 2026-11-26 from `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/`, deleted after processing; SHA-256 pinned in `tools/tripmap/build-data.mjs`): `LICENSE.md`, `geojson/ne_50m_land.geojson`, `geojson/ne_50m_lakes.geojson`, `geojson/ne_10m_land.geojson`, `geojson/ne_10m_lakes.geojson`, `geojson/ne_10m_populated_places.geojson`.
- What was changed: land and lakes clipped at ±80° latitude (the 1:10m files also cropped to lon 29–39.5, lat 27–36.5), projected to Mercator, simplified (Douglas–Peucker) and quantised; places reduced to the box above plus `SCALERANK` ≤ 3 worldwide, with the fields NE_ID, Hebrew name, English name and coordinates at 0.01°. No admin (border) file is read or shipped; no capital or feature class is kept.
- Committed outputs (regenerated only by the script; size and SHA-256 tested in `tools/tripmap/data.test.ts`):

| File | Bytes | SHA-256 |
|---|---|---|
| packages/engine/src/map/outlines.data.ts | 146370 | c90df74f225e7f9205f77052763bf7d6693347ee638655b2382c3f4641c64475 |
| apps/web/src/editor/tripMap/places.data.ts | 30464 | 866edd5bebcfca5e0261987b690935c145c3932351b0bc64fe14c5a6a775142f |

`apps/web/notices-plugin.ts` adds a Natural Earth block to `THIRD_PARTY_NOTICES.txt` («Made with Natural Earth»), although the terms do not require one.
