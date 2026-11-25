# Local visual asset library — source and licence research

Read date for every quotation below: **2026-11-25**. Research only: nothing was downloaded into the project, nothing installed, no account or key created. Not legal advice; it is a reading of each source's own pages.

How pages were read: licence files from public repositories and the sites' own licence/terms pages were fetched and read as text. Several sites refused automated reading (HTTP 403/401/429) — those are marked **[blocked]** and their facts are in "Not verified" unless a second page of the same publisher (help centre, API documentation, repository README) was readable.

## 0. What the editor can take today (checked in the repository)

| Fact | Where |
|---|---|
| Stills accepted: PNG (alpha kept), JPEG, WebP; BMP/TIFF/GIF(1 frame)/AVIF converted to PNG. **SVG and animated WebP are refused at import.** | `docs/CAPABILITIES.md` "Still images" row; `docs/evidence/image-matrix.json` |
| SVG → PNG with straight alpha already exists server-side for the 252 built-in elements (ffmpeg `librsvg` decoder, honest 501 when the ffmpeg lacks it). | `apps/server/src/elements.ts:22-38,77` |
| Alpha is recorded for stills only (`image.hasAlpha`). There is **no alpha-video asset form**, no image-sequence asset, no APNG/animated-WebP playback, no Lottie. | `packages/core/src/schema.ts:205`, `apps/server/src/ingest.ts:70,100` |
| 17 blend modes incl. `screen`, `add`, `multiply`, `overlay`, `soft-light`, `lighten`. **No luma-key effect** (chroma key exists). | `packages/core/src/effects.ts:177` |
| `.cube` 3D LUT import (2..65 per axis, ≤16 MiB) as a project asset. HaldCLUT PNG is not read. | CAPABILITIES ".cube colour lookup tables" row |
| Transitions: Canvas2D + 7 WebGPU (WGSL) passes; GPU ones offered only where the adapter reproduces reference pixels. | CAPABILITIES "Trend pack", ADR-0008 |
| Fonts already bundled (do not re-propose): Heebo, Rubik, Assistant, Frank Ruhl Libre, Secular One, Suez One, David Libre, Karantina, Amatic SC, Fredoka, Gveret Levin, IBM Plex Sans Hebrew, IBM Plex Mono. Held: Alef, Varela Round (Reserved Font Names). | `packages/core/src/fonts.ts:36-66`, `apps/web/package.json` |
| Packs are data; holiday elements are drawn by formula "no licence exposure". | ADR-0022 §3 |

Consequences for conversion:
- **SVG → PNG is the right route**, in two steps: thumbnails (128–256 px) at fetch time, the full-size PNG at insert time at the size the clip needs (the existing `elements.ts` route, which also sets colour). Keep the SVG on disk as the library master. Never hand third-party SVG to the browser DOM (the import matrix already refuses SVG with a script). Risk: `librsvg` does not draw every SVG feature and the owner's Windows ffmpeg may lack it — fall back to rasterising in the headless-Chromium renderer that the project already has (no new dependency). Not tested here.
- **Video on black needs no conversion**: put the clip on an upper track with blend `screen` or `add` (light leaks, bokeh, flares, dust-white-on-black, snow, sparkles); grain on mid-grey with `overlay`/`soft-light`; dark dust on white with `multiply`. A luma key is not needed and does not exist.
- **Animated stickers with alpha (APNG, animated WebP, GIF) cannot be played today.** They need engine work first (an alpha-video form, e.g. colour + matte packed in one ordinary H.264 file and joined in a pass, or an image-sequence asset). Until then they are tier B at best.
- Downloaded overlays that change light (leaks, flares, strobes, VHS) fall under flash safety (ADR-0009); each must pass the same check as built-in effects before it is offered.

## 1. Stickers and emoji

| Tier | Source | Licence (own page, quoted) | Facts | Route / stability | Editor work |
|---|---|---|---|---|---|
| **A** | **Fluent Emoji** (Microsoft) | MIT. `raw.githubusercontent.com/microsoft/fluentui-emoji/main/LICENSE`: "MIT License / Copyright (c) Microsoft Corporation." | Per emoji a folder with `3D/*.png` (checked: 256×256 RGBA), `Color/*.svg`, Flat and High-contrast SVG, and `metadata.json` with `keywords`, `group`, `unicode` (checked on "Menorah"). Aggregator count: 3,126 (color), 3,145 (flat). One consistent, friendly 3D style — the best fit for family videos. | Git repository (no release tags verified). Pin a commit; hash every file at fetch. Also inside `@iconify/json` (SVG only). Size not verified (order of 0.1–1 GB). | 3D PNG usable as is (256 px only — soft above ~25% of a 1080p frame); SVG → PNG for larger. |
| **A** | **Noto Emoji** (Google) | README: "Emoji fonts (under the fonts subdirectory) are under the SIL Open Font License, version 1.1. Tools and most image resources are under the Apache license, version 2.0. Flag images under third_party/region-flags are in the public domain or otherwise exempt from copyright". | Aggregator count 3,729 SVG. PNG/SVG in the repository (exact folders not verified today). | Git repository; `@iconify-json/noto` 1.2.10 (25.6 MB, Apache-2.0, npm integrity hash). | SVG → PNG. |
| B | **Twemoji** (jdecked fork) | README: "Graphics licensed under CC-BY 4.0". Attribution: "will accept a mention in a project README or an 'About' section or footer on a website". | 3,988 SVG + 72×72 PNG (checked). Flat style. | `@twemoji/svg` 15.0.0 (8.1 MB, integrity hash). | SVG → PNG. **Credit needed when a video using them is shared publicly** (CC BY: credit "in any reasonable manner" — description or end card). |
| B | **Noto animated emoji** | FAQ at `googlefonts.github.io/noto-emoji-files/?view=docs`: "Animated Noto Emoji is licensed under CC BY 4.0." Formats: "For 2D emoji: vector .svg, lottie.json, .webp, and .gif. For 3D emoji: .png." Bulk: "Currently, there is no way to download the whole set". | 512 px GIF/WebP per emoji (URL scheme from a third-party gist, not verified). | Per-file fetch from the font CDN only; no archive, no checksums. | Needs alpha-animation support + credit in each public video. |
| B | **Fluent Emoji Animated** | MIT (`microsoft/fluentui-emoji-animated/main/LICENSE`). README: "Animated PNGs, size 256x256px … This repository is approximately ~5GB in size (10GB on your disk)". | APNG 256 px. | Git LFS repository. | Needs alpha-animation support. Good candidate for the larger budget. |
| C | **OpenMoji** | README: "OpenMoji graphics are licensed under the Creative Commons Share Alike License 4.0 (CC BY-SA 4.0)"; suggested credit: "All emojis designed by OpenMoji – the open-source emoji and icon project. License: CC BY-SA 4.0". | 4,568 entries incl. 445 own extras; SVG, PNG 618 and 72; `openmoji.json` with tags. npm `openmoji` 17.0.0 (43.4 MB). | Versioned releases. | **Rejected for family videos: share-alike.** A video that builds an OpenMoji into its picture is plausibly an adaptation, which would have to be shared under CC BY-SA with credit. Use only if the owner accepts that per video. |
| C | Lottie collections (LottieFiles) | "Lottie Simple License (FL 9.13.21)" permits use, but files are Lottie JSON. | — | — | No Lottie player and none may be added. Rejected. |

Search metadata for a Hebrew-first browser: Unicode CLDR `common/annotations/he.xml` has 3,950 Hebrew annotation lines (checked: 🕎 → "דת | חנוכה | חנוכיה | יהדות | מנורה"), under the Unicode licence file in that repository ("Copyright © 2001–2026 Unicode, Inc.", `unicode-org/cldr/main/LICENSE`; its terms were not analysed today — see §14). Join by code point with any emoji set.

## 2. Icons and shapes

Best single route: **`@iconify/json` 2.2.561** (npm, MIT for the packaging, 706.9 MB unpacked, integrity hash): 280 sets, 558,863 icons, each set with an SPDX licence in `collections.json`. Read today: MIT 148 sets (351,332 icons), Apache-2.0 31 (85,616), CC-BY-4.0 53 (66,153), CC0-1.0 10 (11,348), ISC 4 (6,412), OFL-1.1 13, CC-BY-SA 9, GPL 6, NC 2, four others. **Filter by licence at fetch; do not rasterise everything** — keep SVG, rasterise on insert.

| Tier | Set | Licence read at the set's own repository | Count (aggregator) |
|---|---|---|---|
| A | Lucide | "ISC License / Copyright (c) 2026 Lucide Icons and Contributors" | 2,104 |
| A | Phosphor | MIT ("Copyright (c) 2023 Phosphor Icons") | 9,072 (6 weights) |
| A | Tabler | MIT ("Copyright (c) 2020-2026 Paweł Kuna") | 6,563 |
| A | Material Symbols / Icons | README: "available … under the Apache License Version 2.0 … We'd love attribution in your app's about screen, but it's not required." | 15,806 |
| A | Heroicons, Bootstrap Icons, Iconoir | MIT (each LICENSE read) | 1,288 / 2,078 / 1,671 |
| A | Fluent UI System Icons + colour set, Meteocons (weather, colour), circle-flags | MIT per aggregator metadata — upstream files not read today | 20,015 + 890 / 447 / 444 |
| B | Font Awesome Free | LICENSE.txt: "Icons: CC BY 4.0 License … applies to all icons packaged as SVG and JS file types." Brand icons: "Please do not use brand logos for any purpose except to represent the company, product, or service to which they refer." | 2,000 solid |
| B | Streamline free sets (freehand, stickies, plump colour…), Solar, Pepicons | CC BY 4.0 per aggregator metadata only | ~20,000 |
| C | Remix Icon | **Licence changed.** Upstream `License` file: "Remix Icon License v1.0 / Version 1.0 – January 2026" — allows use and modification, but "You may NOT … Offer the Icons as a downloadable asset collection where the Icons themselves constitute the primary product value" and no logo use. The aggregator still labels v4.8.0 "Apache-2.0". Skip. |
| C | Arcticons (CC BY-SA 4.0), Game Icons (CC BY 3.0), the two NC sets | share-alike / attribution / non-commercial | — |

All tier A icon licences permit keeping the files in an application and, with their notice files, even committing them. Monochrome icons need a fill colour chosen at rasterise time (the elements route already does this).

## 3. Illustrations, doodles, arrows, party graphics

| Tier | Source | Licence (own page) | Facts and route |
|---|---|---|---|
| A | **Open Peeps** | "The library is in the public domain under the CC0 License. This means you can copy, modify, distribute, remix, burn, and use the work, even for commercial purposes, without asking permission." (openpeeps.com) | Hand-drawn people, mix-and-match; ready PNG/SVG busts, standing, sitting. "Download Library" button — archive host and size not verified; manual download. |
| A | **Open Doodles** | "You can copy, edit, remix, share, or redraw these images for any purpose without restriction under copyright or database law (CC0 license.)" (opendoodles.com/about) | SVG and PNG, "individual assets and source files on Dropbox" — manual. Small set. |
| A | **Humaaans** | "Free for commercial or personal use. CC0 Public Domain License" (humaaans.com) | Flat people kit; manual download. |
| A | **Kenney** | "all game assets on the asset pages are public domain licensed (CC0) … Attribution is not required." (kenney.nl/support) | Useful packs: Emotes Pack (480 files), Particle Pack (80 files, 512×512 — sparks, smoke, stars, flares as PNG; usable as overlay stills with `add`). One zip per pack from each asset page; no checksums seen; the site also advertises an all-in-one bundle (terms not read). |
| A | Doodle icons by Khushmeen | "Free icons for commercial and personal use under CC0 license - no attribution required." (khushmeen.com/icons.html) | 400+ hand-drawn icons incl. arrows; download route not verified. |
| B | Openclipart | "Openclipart is an online media collection of more than 180,000 vectorial graphics, entirely in the public domain … All Clipart are Released into the Public Domain." (openclipart.org/share) | Very uneven quality; includes holiday clip art. No bulk archive or working API verified; uploads are user-declared (their own `pd_issue` tag exists for doubtful items). Hand-pick. |
| B | Lukasz Adam illustrations | Page says "under the CC0 license (MIT license). No attribution required." — two licences named in one sentence; download appears to need an e-mail sign-up. Owner decides. |
| B | SVG Repo | Mixed per-item licences ("Our bots collect and index SVG icons from various known sources"); own default licence allows use without attribution but "distribute with limitations". Per-item check required; no bulk. |
| C | **unDraw** | undraw.co/license: "This license does not include the right to compile assets, vectors or images from unDraw to replicate a similar or competing service, in any form or distribute the assets in packs or otherwise. This extends to automated and non-automated ways to link, embed, scrape, search or download the assets included on the website without our consent." Rule of thumb on the same page: do not "train an ai model, add them in an app". | Use in a video is allowed; a library inside the application and any automated fetch are not. Rejected as a library source. |
| C | Storyset (Freepik) | storyset.com/terms: free "provided that any use of the Storyset Content by the User is credited"; content must not be "included … in a database, archive or in any other media/stock product, collection, set of clips, or library"; robots forbidden. | Rejected. |
| C | Vecteezy free | "Free License … provided you give mandatory attribution to the creator of the work." | Rejected (credit in every video; mixed catalogue). |

**Jewish-holiday graphics — plain result:** no consistent, high-quality open pack for Hanukkah, Purim, Passover, Rosh Hashanah or bar/bat mitzvah was found. What exists under clear terms: the emoji themselves (menorah 🕎, star of David ✡, synagogue 🕍, hamsa 🪬, plus generic candle, honey pot, apple, wine glass, scroll, masks, crown, gift, balloon, cake, party popper, confetti ball — in Fluent and Noto, tier A), scattered CC0-labelled clip art (freesvg.org, Openclipart — licence pages not fully verified, quality uneven), and per-file items on Wikimedia Commons. Recommendation: keep ADR-0022's decision — draw holiday elements by formula in the project (already done for hanukkiah, dreidel, candles) and extend it to the other holidays; use the emoji subset as stickers. This also avoids misdrawn ritual objects.

## 4. Video overlays, loops, stock video and photos

No source of real-alpha overlay video under an open licence was found. Everything below is ordinary video (use blend modes, section 0). Grain, dust and simple leaks can also be generated locally (ffmpeg noise, or the editor's own closed-form overlays), with no licence at all — prefer that for grain.

| Tier | Source | Licence, decisive sentences | Bulk route | Notes |
|---|---|---|---|---|
| **A** | **NASA (images, video, SVS)** | nasa.gov media guidelines: "NASA content … generally are not subject to copyright in the United States … NASA should be acknowledged as the source of the material." Limits: "The NASA Insignia, Logotype, identifiers, and imagery are not in the public domain"; "it must not explicitly or implicitly convey NASA's endorsement"; identifiable persons: "permission should be obtained from the person". SVS help: "All of our content is in the public domain (unless otherwise noted) … free to download, use, and redistribute". | SVS has a search and page API (documented on svs.gsfc.nasa.gov/help); images.nasa.gov API (PDF present, not analysed). No key verified as needed. | Earth, space, aurora, clouds loops; third-party-copyright items are marked — skip those; some SVS items carry licensed music (drop the audio). |
| B (key) | **Coverr** | coverr.co/license (updated 2026-11-04): "free, irrevocable, non-exclusive, worldwide license to download, copy, modify, perform and use them, including commercially". Allowed: "Site builders, template providers and video editors can make Coverr stock available inside their product. The Coverr API is built for exactly this." Not allowed: "No selling, giving away or uploading the raw files, packs or collections"; "Nothing from Coverr may be used to train AI models". People: "We hold model releases for the people in our stock content but don't share them. We don't hold releases for brands, trademarks, landmarks". "Free (Demo tier) apps must credit Coverr". | API with a key (owner creates it). Limits not read. | Part of the library is AI-generated (`is_ai_generated: true`, "The people aren't real") — filter it out or label it. |
| B (key) | **Pexels** | [licence page blocked] Help centre (their own, read): "All photos and videos uploaded on Pexels are licensed under the Pexels license … free for personal and commercial purposes without attribution." Rules: "Identifiable people may not appear in a bad light … Don't sell unaltered copies … Don't redistribute or sell the photos on other stock photo or wallpaper platforms." API: "default rate limit of 200/hour and 20,000/month"; "API rate limit increases are currently paused"; "you may not copy our core functionality with the API"; "Pexels and our contributors must be credited within your platform"; `per_page` max 80; cache 24 h. | API with a key. At 80 results per request a few hundred clips is a handful of requests; file downloads are separate. | Large catalogue incl. overlay-style clips on black (light leaks, bokeh, snow, confetti). Show "Photos/Videos provided by Pexels" in the browser. Do not mirror the catalogue. |
| B (manual) | **Pixabay** | [licence page blocked; wording via search index of pixabay.com/service/terms: "You cannot sell or distribute Content … on a Standalone basis."] API docs (read): "requests must be cached for 24 hours … do not send lots of automated queries. **Systematic mass downloads are not allowed.**" "100 requests per 60 seconds". "permanent hotlinking … is not allowed … download them to your server first." | No bulk. Hand-picked downloads, or interactive search through the API with the owner's key. | Good for overlays and illustrations (incl. holiday items), but item by item. |
| B (manual) | **Mixkit** | Stock Video Free License: "can be used in your commercial and non-commercial projects, for free … Attribution is not required". User terms §9: must not "aggregate or collate an Item(s) and make available on a stock or inventory basis", must not "use scripts or bots to mass download Items". **Second licence exists**: "Stock Video Restricted License … personal projects only" — not allowed in "YouTube videos", "a monetized YouTube video". | Manual only. | Record which of the two licences each clip has. |
| B | **Wikimedia Commons** | Per-file licences. "some licenses require that the original creator be attributed … some licenses require that if you modify the work, your modifications must also be similarly freely licensed"; "Other restrictions may apply. These may include trademarks, patents, personality rights". | API; requires "an informative User-Agent string with contact information, or they may be blocked without notice". An anonymous test call today returned HTTP 429. | Filter to CC0 / public domain only, store author and licence per file. |
| B | ESA/Hubble | "released under the Creative Commons Attribution 4.0 International license … clearly and visibly credited". For video: "include the full credit 'burned in' or overlaid on the video, or clearly visible as a credit at the end" — description text is **not** enough. | Site archives; route not checked. | Credit card in every video. |
| B | Blender Studio open films | "Unless notified otherwise, all digital content … is available under the Creative Commons Attribution 4.0." | Not checked. | Credit in every video. |
| B | Beeple free VJ loops | "All videos are released under the Creative Commons license and are available for both commercial and non-commercial work in ANY form." — which CC licence is not stated; audio excluded. | Manual. | Abstract loops; licence version unverified. |
| C | **Unsplash** (for a local library) | [licence page blocked; sentence via search index: "This license does not include the right to compile photos from Unsplash to replicate a similar or competing service."] API docs (read): "we require the image URLs returned by the API to be directly used or embedded in your applications (generally referred to as hotlinking)"; demo mode "50 requests per hour"; attribution of photographer and Unsplash required. | The API is built for hotlinking, the opposite of a local library. | Hand-downloading single photos for a video is within the licence as described; no bulk route. |
| C | Videvo | Help pages did not load. Search index of their help centre describes several licences incl. a "Videvo Attribution License" (credit required). | — | Not verified; mixed licences; skip. |

Rules about people in all stock: none of these sources gives the owner a model release. Family videos shared privately are the low-risk case; for public or monetised posts avoid stock clips where a recognisable stranger is the subject, and never place one in an unflattering context.

## 5. Textures, papers, backgrounds, maps

| Tier | Source | Licence | Facts / route |
|---|---|---|---|
| **A** | **Poly Haven** | polyhaven.com/license: "Our assets are all licensed as CC0 … You can redistribute them, share them around, include them when sharing your own work". Site ToS forbids "Web scraping or data mining without express permission" — use the API. API ToS: "free to access and use by anyone … Poly Haven will never require payment, a license, or a key"; "all API calls must be made with a unique 'Referer' header or user-agent that matches your software name"; a visible credit is required only "if you use the live API inside your software … to surface Poly Haven content", not for downloaded files. | API listing read today: 999 HDRIs, 872 textures, with categories, tags, description and a `files_hash` per asset (use it in the manifest). The sample texture record lists a maximum of 8192 px; take the colour map only (JPG) at 2K–4K. Tonemapped HDRI JPGs make sky/room backdrops. File sizes not measured. |
| **A** | **ambientCG** | docs.ambientcg.com/license: "All ambientCG assets are provided under the Creative Commons CC0 1.0 Universal License … You can include the raw files in your project". | API v3 (`/api/v3/assets` with `type`, `q`, `sort`, `limit`, `offset`, `include=downloads`), plus a downloads CSV. No key mentioned. Catalogue size not read. Paper, fabric, wood, plaster, concrete. |
| **A** | **Natural Earth** | "All versions of Natural Earth raster + vector map data found on this website are in the public domain … No permission is needed … Crediting the authors is unnecessary." | Versioned (3.2.0 on the raster page read); rasters 51–136 MB each; vectors as shapefiles. `world-atlas` 2.0.2 on npm (ISC, 8.2 MB TopoJSON) is a convenient derived form. For travel-map backgrounds and route animations. Boundaries are politically sensitive — the data's own disputed-area handling should be reviewed before showing borders. |
| B | Hero Patterns | Site footer: "CC BY 4.0". | ~90 SVG tile patterns; credit in each public video. |
| C | Subtle Patterns (Toptal) | [blocked] Third parties say CC BY-SA 3.0. | Not verified; share-alike if true. Skip. |
| — | Gradients | None needed. | Generate in code (no licence, exact colours, any size). |

## 6. Colour LUTs

**No high-quality `.cube` pack under CC0/MIT/Apache was found and verified.** What exists:

| Tier | Source | Status |
|---|---|---|
| B | MonoPhotoRedux (Codeberg) | LICENSE.TXT read: CC BY-SA 4.0. Monochrome `.cube` LUTs only. |
| B | `cyangraphics/clut` | README: "licensed under a Creative Commons Attribution-ShareAlike 4.0 International License". HaldCLUT PNG — needs a HaldCLUT→`.cube` converter (small own script; target 33 or 65 per axis). |
| not verified | G'MIC colour presets ("1100+ color CLUTs", HaldCLUT PNG download per preset) | The page states the licence of the *sample photos* ("CC-by-SA 2.0") and of the software (CeCILL), **not of the CLUT data**; authorship is per pack (RawTherapee, PictureFX …). Page warns that film-stock names are trademarks "for informational purposes only". |
| not verified | RawTherapee Film Simulation Collection | RawPedia page returned 404 today. |
| not verified | "800 free LUTs" pack (third-party articles say CC BY 4.0, `.cube`) | Publisher's site unreachable today; the licence claim is second-hand. |

Open legal question (unsettled, say so to the owner): whether grading a video through a share-alike LUT makes the video an adaptation of the LUT. The cautious reading is to treat BY-SA LUTs like BY-SA stickers. Recommendation: do not download a LUT pack in the first set. Extend the 40 built-in looks instead and let the editor **export its own looks as `.cube`** if interchange is wanted. If a film-emulation pack is taken later, rename away trademarked stock names.

## 7. Hebrew-capable fonts not yet in the project

Source: Google Fonts metadata read today lists **62 families with a Hebrew subset**; 14 are already bundled or held. Licence of each candidate read in `google/fonts` (`ofl/<family>/OFL.txt`): SIL OFL 1.1, and — checked by text — **no Reserved Font Name declared** for those marked ✓. OFL allows bundling and redistribution with the licence text, so fonts are the one category that may live in the repository (through the pinned `@fontsource` packages, as today). No credit is needed in videos.

| Use | Families (✓ = OFL.txt read, no RFN) |
|---|---|
| Children / handwriting | Playpen Sans Hebrew ✓ (variable weight), Solitreo ✓ |
| Display / fun (Rubik "filtered" family, 26 faces) | Rubik Bubbles ✓, Rubik Doodle Shadow ✓, Rubik Wet Paint ✓, Rubik Spray Paint ✓, Rubik Scribble ✓, Rubik Dirt ✓, Rubik Glitch ✓, Rubik Moonrocks ✓ (others of the family not individually read) |
| Clean sans | Noto Sans Hebrew ✓ (width + weight axes), Open Sans ✓, Miriam Libre ✓, Arimo ✓, Lunasima ✓, Google Sans ✓ ("Copyright 2025 The Google Sans Project Authors", OFL), M PLUS 1p ✓, M PLUS Rounded 1c (licence file not found under the expected name — not verified) |
| Serif / traditional | Noto Serif Hebrew ✓, Noto Rashi Hebrew ✓, Bellefair ✓, Bona Nova ✓, Bona Nova SC ✓, Cardo ✓, Libertinus Serif ✓, Tinos (not verified) |
| Dot-matrix display / monospace | Handjet ✓, Cousine ✓ |
| Hold | Cascadia Code / Mono — "with Reserved Font Name Cascadia Code" (same question as Alef). |

Each row still has to pass the project's own gate (glyph and nikud test, `check:notices`) before entering `FONT_CATALOG`; whether `@fontsource` publishes each family's Hebrew subset at the pinned version was not checked.

## 8. Transitions and shaders

| Tier | Source | Licence | Facts |
|---|---|---|---|
| **A** | **GL Transitions** | Repository LICENSE: MIT, plus "Individual transitions … may have their own license specified in their file header comments. When no license is specified, the transition is covered by this MIT license." README: "all are MIT except two under BSD licenses." | npm `gl-transitions` **3.3.0** (9.7 MB, integrity hash, changelog). Index read today: **227 transitions; 225 MIT, 1 BSD-3-Clause (InvertedPageCurl), 1 BSD-2-Clause (StereoViewer)**; each has author, licence, description, tags, typed parameters with defaults/min/max. The package ships every transition as GLSL, GLSL3, Metal, SkSL **and WGSL** (227 `.wgsl` files, generated, with author and licence in the header). 2 need extra textures. |
| C | Shadertoy | [terms page blocked] Secondary sources agree the default is CC BY-NC-SA 3.0 unless the shader states otherwise. | Non-commercial + share-alike by default: unusable for possibly monetised videos. Only a shader whose own header grants a permissive licence could be used, one by one. |
| C | LYGIA | LICENSE.md: "The Prosperity Public License 3.0.0 … noncommercial purposes for free and … commercial purposes for thirty days" (a paid patron licence exists). | Rejected. |
| B | ISF Files (Vidvox) | Repository LICENSE: MIT. | GLSL effects/generators. Community reports of Shadertoy ports relabelled MIT — provenance per file needed. |

GL Transitions can be committed (MIT/BSD notices kept, `check:notices` row). Work for the editor: an adapter from their uniform layout to the existing WebGPU pass, a mapping of `params` to `set_transition_options`, the reference-pixel gate of ADR-0008 per transition, and a flash-safety run (several are strobes/glitches). This is copied data with headers, not a runtime dependency.

## 9. Title, lower-third and template packs

Stated plainly: the free "template" libraries found (Mixkit's Templates section lists "Premiere Pro, After Effects, Final Cut Pro, DaVinci Resolve") are project files of those programs. **This editor cannot read them and they are not proposed.** No title or lower-third pack in an open, documented format was found. Templates stay the project's own data (ADR-0016/0022); the downloadable ingredients are fonts (§7), stickers/icons (§1–3), textures (§5) and transitions (§8).

## 10. Game art, public-domain art and ornaments

| Tier | Source | Licence | Route |
|---|---|---|---|
| A | Kenney | CC0 (see §3) | zip per pack |
| A | **The Met Open Access** | [policy page blocked, 429] Repository README: data under CC0; images: "Companion artworks … covered by the policy are identified … with the Creative Commons Zero (CC0) icon." API page: "we do not require API users to register or obtain an API key … Please limit request rate to 80 requests per second." | Collection API (`isPublicDomain`, image URLs). The page still says the old `/v1/search` "is deprecated and will be retired on October 1, 2026" — use `/v1.1`. |
| A | **Cleveland Museum of Art** | "High-resolution images and data … are made available under a Creative Commons Zero (CC0) designation … Works designated as Creative Commons (CC0) do not require attribution". | API: "No key or token is required"; JSON/CSV dumps in a repository (Git LFS). ~30,000 works with images. |
| A | Art Institute of Chicago | "free, unrestricted use of over 50,000 images … under Creative Commons Zero (CC0)"; requested caption "Artist. Title, Date. The Art Institute of Chicago."; "it is the sole responsibility of the image user to identify and obtain any necessary third-party permissions". | API + weekly data dumps; "When downloading images, use /full/843,/0/default.jpg … use a single thread and self-throttle" — i.e. 843 px wide by their rule: fine for stickers/ornaments, small for full-frame backgrounds. |
| B | Rijksmuseum | "much of the information and data … can be freely used, including for commercial purposes"; Public Domain / CC0 marks per item; "We kindly ask that … you credit the Rijksmuseum … even if this is not required." | Data dumps, OAI-PMH, IIIF listed; key requirement not verified. |
| B | Smithsonian Open Access, National Gallery of Art | [policy pages blocked] READMEs: Smithsonian metadata on a public cloud bucket ("Over 11 million metadata records"); NGA data CC0, "Images and media files are not included in the dataset". | Image terms not verified today. |
| B | OpenGameArt | Per item: CC0, CC BY, CC BY-SA, GPL, OGA-BY. FAQ: CC BY items "must credit the original artist" and "may not be … used on distribution networks that use some form of Digital Rights Management". | No bulk; filter to CC0 by hand. |

Museum CC0 covers the museum's own rights in the photograph of an old work; it is the right source for ornaments, frames, old paper, engravings, maps and paintings as backdrops.

## 11. Proposed first download set (about 30–50 GB; estimates are marked)

Everything goes to a folder outside the repository, described by a manifest (see §13). Tier A first; tier B rows need the owner's key or hand-picking.

| # | What | Source | Size |
|---|---|---|---|
| 1 | Emoji stickers: Fluent (3D PNG + colour SVG + metadata), Noto (SVG) | git commit pin / npm | < 1 GB (estimate) |
| 2 | Hebrew + English search words for emoji | CLDR annotations `he.xml`, `en.xml` | < 5 MB |
| 3 | Icons and shapes: the MIT / ISC / Apache-2.0 / CC0 sets of `@iconify/json` 2.2.561 | npm tarball | 0.7 GB unpacked, less after filtering |
| 4 | Transitions: `gl-transitions` 3.3.0 | npm tarball | 10 MB |
| 5 | Fonts: ~20–25 families of §7 | pinned font packages | < 0.1 GB |
| 6 | CC0 illustrations: Open Peeps, Open Doodles, Humaaans, Kenney Emotes + Particle packs, doodle icons | manual downloads / zips | < 1 GB (estimate) |
| 7 | Maps: Natural Earth 3.2.0 — two shaded-relief rasters + 1:50m vectors | zips | ~0.5 GB |
| 8 | Textures and papers: ~300 materials, colour map only, 2K–4K JPG | ambientCG / Poly Haven APIs | 3–6 GB (estimate) |
| 9 | Sky and room backdrops: ~150 tonemapped HDRI JPGs | Poly Haven API | 2–4 GB (estimate) |
| 10 | Old art, ornaments, frames, paper: ~1,500 CC0 works | Met + Cleveland APIs | 5–8 GB (estimate) |
| 11 | Space and Earth loops and stills | NASA / SVS | 5–10 GB (estimate) |
| 12 | B-roll and overlay clips on black (light leaks, bokeh, dust, snow, confetti, sparkles, flares), 400–600 clips at 1080p, chosen by a fixed keyword list | Pexels + Coverr with the owner's keys; Pixabay and Mixkit by hand | 10–20 GB (estimate) |

Not in the first set: LUT packs (§6), animated emoji (engine cannot play them), any share-alike or NC source, any After Effects/Premiere/Resolve project file.

**A larger budget (100–500 GB) adds:** 4K versions of the stock clips (roughly ×4–6 per clip), Fluent Emoji Animated (5–10 GB) once alpha animation exists, the complete Poly Haven and ambientCG colour maps at 4K, larger museum pulls (Art Institute dumps, Rijksmuseum, Smithsonian after their terms are read), NASA SVS frame sets, CC0/public-domain featured media from Wikimedia Commons, all Kenney packs.

## 12. Legal traps found

1. **"Free" is not "redistributable".** Pexels, Pixabay, Unsplash, Mixkit and Coverr all forbid passing on the raw files or building a collection for others. These files stay on the owner's disk, never in the repository — and **a project archive that embeds such clips and is sent to someone else is a redistribution**. The archive export should be able to leave library assets out, by manifest flag.
2. **Bulk fetching is restricted even where use is free.** Pixabay API: "Systematic mass downloads are not allowed". Mixkit: no "scripts or bots to mass download". unDraw: no automated or manual compiling, no in-app use. Storyset: no robots, no libraries. Unsplash API: hotlinking required. Poly Haven: no site scraping (API is fine). Wikimedia: descriptive User-Agent with contact or be blocked.
3. **Share-alike reaches the video**: OpenMoji, Arcticons, the two BY-SA LUT sets, probably Subtle Patterns. Kept out.
4. **Attribution in every public video** (a real cost for family films): Twemoji, Noto animated emoji, Font Awesome Free, Streamline/Solar sets, Hero Patterns, Blender films, and ESA/Hubble (must be burned in or shown at the end — a description line is not enough). If any of these are taken, the manifest flag should drive an automatic credits card / description text at export.
5. **Licences drift.** Remix Icon moved from Apache-2.0 to its own licence in January 2026 while an aggregator still shows Apache-2.0. Pin versions, store the licence text and its hash at fetch time, and re-read on every update.
6. **Two licences on one site.** Mixkit "Restricted" clips are personal-only (no monetised YouTube). Coverr mixes in AI-generated clips with synthetic people and "sponsored" items under other licences. Record the per-item licence, not the site's.
7. **Rights the licence does not cover**: recognisable people (no model release reaches the owner), logos and trademarks in footage, the NASA insignia, brand icons in icon sets, trademarked film-stock names in LUT file names, political use (Pexels forbids it for content showing people).
8. **No-AI clauses**: unDraw and Coverr forbid any use for training, fine-tuning or evaluating models. The editor's AI features must never use library assets as training data; ordinary editing of a clip is not training.
9. **Shader provenance**: Shadertoy's default is non-commercial share-alike; ports of such shaders circulate under false MIT labels. Take shaders only from GL Transitions, where each file names author and licence.
10. **Vendor emoji** (Apple, Samsung, WhatsApp) are not open — never capture or bundle them.
11. **Reserved Font Names**: Cascadia Code joins Alef and Varela Round on the held list.
12. **Privacy**: a live stock search from inside the editor sends the owner's search words (for example a child's birthday theme) to a third party. Prefetch by a fixed generic keyword list instead; keep in-editor search local.

## 13. Manifest (for the build that follows)

One record per source and per file: source id, version / tag / commit, URL, byte size, SHA-256 (computed at first fetch where the publisher gives none; npm tarballs and Poly Haven give a hash), SPDX id or "custom", licence URL + date read + hash of the saved licence text, credit line, flags `repoAllowed`, `diskOnly`, `creditInExport`, `shareAlike`, `people`, `trademark`, `aiGenerated`, `personalOnly`. This mirrors the existing rule for model downloads (owner-only, bound to exact bytes and SHA-256). Sources with versioned releases and checksums today: npm packages (icons, emoji SVG, transitions, fonts), Natural Earth (version numbers, no checksums), Poly Haven (`files_hash`). Without versions: Kenney zips, the CC0 illustration kits, museum images, stock clips — pin by own hash.

## 14. Not verified today

- Pexels licence page and API documentation page (403); only their help-centre articles were read.
- Pixabay Content License and terms (403); only the API documentation was read. Unsplash licence and API terms (401); only the API documentation was read.
- Shadertoy terms (403). Subtle Patterns licence (403). Videvo licences (pages empty). RawTherapee film-simulation collection (404). The "800 free LUTs" publisher (unreachable). Licence of G'MIC's CLUT data.
- The Met's image policy page (429), Smithsonian and National Gallery of Art terms (403); Rijksmuseum API key requirement; Art Institute image size beyond their 843 px guidance.
- The terms of the Unicode CLDR licence (file seen, not analysed).
- Noto animated emoji: licence file itself and the per-file URL scheme; Noto Emoji repository folder layout; Fluent Emoji repository size; whether Fluent has release tags.
- Upstream licence files of Fluent UI System Icons, Meteocons, circle-flags, Streamline, Solar, Pepicons (aggregator metadata only — and the aggregator was wrong for Remix Icon).
- Download hosts, archive sizes and checksums for Open Peeps, Open Doodles, Humaaans, Lukasz Adam, Khushmeen icons; Openclipart and freesvg.org bulk routes and freesvg's licence page; SVG Repo per-item terms.
- Which Creative Commons licence Beeple's loops use; Blender film asset routes; Internet Archive / Prelinger terms (not read); Wikimedia Commons API limits (429 on an anonymous call).
- Coverr and NASA image API rate limits; ambientCG catalogue size; all file sizes marked "estimate".
- M PLUS Rounded 1c and Tinos licence files; the Rubik display faces not individually listed; availability of each proposed family's Hebrew subset in the pinned font packages; Hebrew glyph and nikud coverage (the project's own test decides).
- Whether the owner's Windows ffmpeg has `librsvg`; SVG fidelity of `librsvg` on these sets; WebGPU behaviour of the GL Transitions WGSL files on the owner's adapter; flash safety of any downloaded overlay or transition.
- Giphy, Tenor, Freepik, Flaticon, Icons8, rawpixel, Motion Array and similar were not evaluated; nothing is claimed about them.
