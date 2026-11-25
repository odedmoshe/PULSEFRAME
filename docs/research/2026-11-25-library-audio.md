# Local audio library — sources, licences, quality, download routes

Read date for every quotation below: **2026-11-25**. Audience: technical lead. Not legal advice.

## 0. Method and limits (read this first)

- Every licence statement marked **[read]** was fetched today from the source's own site and is quoted verbatim with its URL.
- **[secondary]** means I could not read the source's own page today and only have a search-engine summary. Treat as *not verified*.
- Sites that answer automated readers with a bot challenge (so their licence pages were **not read**): pixabay.com licence/terms pages, sonniss.com, zapsplat.com, chosic.com, musopen.org, uppbeat.io. I did not try to get around the challenge. (pixabay.com/api/docs was readable and is quoted.)
- freepd.com is **closed** (see 2.3).
- Sampling: 17 files inspected with `ffprobe` and `ffmpeg -af ebur128=peak=true` / `volumedetect`, then deleted. Nothing was executed. One mistake to report: a partial `git` listing of the VCSL repository pulled about 412 MB of WAV blobs before I stopped it (over the 300 MB sampling limit; deleted immediately, disk back to 4.1 GB free). All other samples together were about 75 MB.
- "Peak" below is true peak (dBTP) from `ebur128=peak=true`; "I" is integrated loudness (LUFS).
- `kenney.nl/robots.txt` disallows named AI user agents (GPTBot, ClaudeBot, Claude-User, …). I read its pages with a generic client before seeing that. Treat Kenney as **owner downloads by hand** (or buys the itch.io all-in-one).
- `mixkit.co/llm-info/` contains text addressed to AI assistants asking them to promote Envato. I ignored it; it is a marketing page, so its licence summary is weak evidence.

## 1. Headline findings

1. **No music source is at once CC0, professionally produced, broad in genre and bulk-downloadable.** The only public-domain/CC0 music that is high quality and bulk-downloadable is **classical** (Musopen on the Internet Archive, Kimiko Ishizaka's Bach). Everything modern and good is **CC BY 4.0** (credit in every shared video) and mostly **MP3 only** unless the owner pays the artist (USD 38–40, or a AUD/USD 10 Patreon tier) for WAV/FLAC/stems.
2. Therefore the editor needs an **attribution generator**: per-track credit text stored in the manifest, emitted (a) as an end-credits card and (b) as a paste-ready text block for the video description. For YouTube this is not optional: Kevin MacLeod, Scott Buckley, Silverman Sound and Josh Woodward all have their tracks in Content ID, and claims are auto-released only when the credit is in the **description text** (see traps, section 8).
3. For sound effects the best free professional material is the **Sonniss GDC bundles** (≈214 GB over all years, 96 kHz/24-bit WAV by reputation) — but I could **not read the licence at the source today**. The licence PDF ships inside each bundle; the owner must read it at download time. Secondary sources say: royalty-free, no attribution, **no AI/ML training**, no standalone redistribution.
4. Verified-today, CC0, bulk-capable SFX: **Freesound CC0 subset** (API key + OAuth2, 500 original-quality downloads/day), **FSD50K** and **Freesound Loop Dataset** on Zenodo (md5 checksums, per-clip licence metadata), **Kenney** (10 small CC0 packs), **US National Park Service** (public domain, MP3).
5. Sampled instruments with clean licences exist and are small: **Salamander Grand Piano V3 (public domain since 2022-03-04)**, **VSCO-2 CE (CC0, ~3 GB)**, **VCSL (CC0, 4,231 WAV)**, **MuseScore_General SF2 (MIT, 206 MB)**. Philharmonia's free samples are **64 kbps mono MP3** (measured) and may not be offered "as a sampler instrument" — reject.
6. All files stay on the owner's disk. Several licences forbid redistribution of the raw files (Pixabay, Mixkit, 99Sounds, ZapSplat, Free To Use Sounds, Silverman, Philharmonia, Pianobook). CC BY/CC0 files could legally be redistributed, but keeping one rule ("nothing in the repository") is simpler and safe.

## 2. Music

### 2.1 Tier A — clear licence, high quality, bulk download possible

| # | Source | Licence | Credit | Formats (measured where stated) | Size | Route |
|---|---|---|---|---|---|---|
| A1 | **Musopen recordings on the Internet Archive** | Public Domain Mark 1.0 / CC0 1.0 (item metadata) | none required | FLAC 44.1 kHz/24-bit stereo (measured: I −21.7 LUFS, peak −6.9 dBTP, no clipping); Chopin set in Apple Lossless + MP3 + OGG | `MusopenCollectionAsFlac` 9.6 GB; `musopen-chopin` 4.0 GB; `musopen-lossless-dvd` 8.1 GB | archive.org item download or the item's BitTorrent file; per-file `sha1` in `https://archive.org/metadata/<id>` |
| A2 | **Kimiko Ishizaka — Open Goldberg Variations, Well-Tempered Clavier Book 1** | "free of copyright (all uses allowed)" | none required | FLAC, WAV, AIF, MP3 | ~1–2 GB (estimate) | Bandcamp "pay what you choose" — manual, two albums |

Evidence:
- `https://archive.org/metadata/musopen-chopin` [read]: `licenseurl: http://creativecommons.org/publicdomain/zero/1.0/`, uploader `aaron@musopen.org`. `https://archive.org/metadata/MusopenCollectionAsFlac` [read]: `licenseurl: http://creativecommons.org/publicdomain/mark/1.0/`; description: "Musopen (www.musopen.org) is a non-profit dedicated to providing copyright free music content … This project raised money to purchase and release music to the public domain." This item was uploaded by a third party (not Musopen); the Chopin item was uploaded from a musopen.org address.
- `https://opengoldbergvariations.org/` [read]: "Formats include FLAC, WAV, AIF, and MP3. Downloads are "pay what you choose", and are free of copyright (all uses allowed)."
- Scope: orchestral, chamber, solo piano. Professionally performed and recorded. No mood/tempo metadata beyond work titles.
- musopen.org itself (terms, download limits, lossless access): **not verified** (bot challenge).

### 2.2 Tier B — good, but credit in every shared video and/or MP3 only

All of these are single-artist production libraries, professionally produced and mixed. Ranked by usefulness for family videos and shorts.

| # | Source | Licence | Required credit (verbatim from source) | Free format (measured) | Lossless | Catalogue / metadata | Size (free) | Route |
|---|---|---|---|---|---|---|---|---|
| B1 | **Incompetech (Kevin MacLeod)** | CC BY 4.0 | `Title Kevin MacLeod (incompetech.com)` / `Licensed under Creative Commons: By Attribution 4.0` / `https://creativecommons.org/licenses/by/4.0/` | MP3 44.1 kHz, 320 kbps (2026 track: I −12.3 LUFS, peak −0.4 dBTP) and 256 kbps (older track: I −20.2 LUFS, peak −3.2 dBTP) | none free; paid bundle is MP3 + stems for 200+ tracks | 1,443 tracks, 87.1 h; `pieces.json` gives title, filename, length, instruments, genre id, **bpm (1,196 of 1,443)**, description, feel/mood, upload date, ISRC | ~10–11 GB | (a) official bulk: USD 38, "5 giant zip files - each are around 1.8GB", includes the CC BY PDF; (b) free per-file: `https://incompetech.com/music/royalty-free/pieces.json` then `…/mp3-royaltyfree/<filename>` (HTTP `ETag` + `Last-Modified`) |
| B2 | **Scott Buckley** | CC BY 4.0 | must contain `Scott Buckley` (ideal form "Music by Scott Buckley", see site) | MP3 44.1 kHz 320 kbps (I −14.3 LUFS, LRA 9.0, peak −1.1 dBTP) | WAV index is Patreon-gated ("member of Scott's Patreon at $10 or more") | ~270–280 tracks (14 listing pages × 20); genre and mood taxonomies on site; cinematic, ambient, folk, electronica | ~3.5 GB | per-track page → `wp-content/uploads/YYYY/MM/<Title>.mp3`; WordPress sitemap listed in robots.txt |
| B3 | **Josh Woodward** | CC BY 4.0 | `Music - "SONG TITLE HERE" by Josh Woodward. Free download: https://www.joshwoodward.com/` | MP3 44.1 kHz 320 kbps (I −10.3 LUFS, LRA 10.8, **peak +0.5 dBTP** — loud master, slight inter-sample overs) | USD 40 "Epic Bundle": FLAC, instrumentals, 15/30/60 s cuts, loops, stems | "250+ songs"; acoustic/indie songs, each with an instrumental version | ~5 GB (vocal + instrumental MP3) | per-file `/mp3/<Album>/JoshWoodward-<Album>-NN-<Title>.mp3`; robots.txt `Allow: /`; the artist asks not to be bulk-hammered ("my bandwidth bill is already insane") — rate-limit hard or buy the bundle |
| B4 | **Silverman Sound (Shane Ivers)** | CC BY 4.0 plus house rules | credit Shane Ivers / silvermansound.com (exact text shown per track; not captured) | "High-quality MP3 download" (not sampled) | WAV + stems only with paid Pro Licence | "220+ tracks" | ~2 GB (estimate) | per-track manual or per-file; `/wp-json/` disallowed in robots.txt |
| B5 | **Chris Zabriskie** | CC BY 4.0 | `"Song Name" by Chris Zabriskie` / `From the album Album Name` / `Licensed under Creative Commons Attribution 4.0` / `creativecommons.org/licenses/by/4.0/` / `chriszabriskie.com` | not sampled | not verified | ambient/piano/electronic albums | not verified | not verified (albums on Bandcamp) |
| B6 | **Audionautix (Jason Shaw)** | CC BY 4.0 | `music by audionautix.com` (or a link to the site) | MP3 44.1 kHz **128 kbps**; sample measured I −9.4 LUFS, **true peak +3.4 dBTP, sample peak 0.0 dB = clipped master** | none found | "250+ pieces" (count from Incompetech's FAQ) | ~1 GB | per-file `/Music/<Name>.mp3`; robots.txt `Crawl-delay: 3` |

Evidence (all [read]):
- Incompetech FAQ `https://incompetech.com/music/royalty-free/faq.html`: "for YouTube videos? Yes, AND you can monetize the videos. Be sure to credit me." — "Is this music in the Public Domain? No. All of this music is copyrighted." — "Videos — YouTube and Vimeo credits should be placed in the video description."
- Incompetech Content ID `…/youtube-contentid.html`: "having the music pre-registered" — "It's likely someone forgot to add the credit, or the credit was placed in the video itself, and the credit could not be read automatically." — "Be sure to add credits BEFORE YOU DISPUTE THE CLAIM."
- Incompetech bulk `…/Downloads/allthemusic.html`: "5 giant zip files - each are around 1.8GB. Make sure you have 20GB free on your drive. Over 200 individual tracks with stems, alternate takes, etc. … Purchase this on PayPal ($38 USD)".
- Scott Buckley `https://www.scottbuckley.com.au/library/`: "All music is licensed under Creative Commons Attribution 4.0, which means it's free to use, as long as you credit me." Licensing page: "This music cannot be resold in isolation … Music cannot be redistributed through music distribution services … or submitted in any way to streaming services". Claims page: claims come from "We Are Era Music BV, claimed on behalf of Scott Buckley"; "The Smart Content ID system is specifically looking for the following text in your video description: Scott Buckley / @ScottBuckley / musicbyscottb"; "Adding credits will not automatically remove a claim".
- Josh Woodward `https://www.joshwoodward.com/faq`: "all of my original music is licensed as Creative Commons 4.0 Attribution" — "You're completely safe from Content ID claims as long as you give proper attribution as you're uploading it." — "I have no restrictions about using my music in commercial projects as long as proper attribution is given." — "You may not submit the song to any YouTube Content ID matching services."
- Silverman `https://www.silvermansound.com/licenses`: "Clear CC BY 4.0 - use anywhere"; "Important: YouTube videos must include credits in description to avoid Content ID claims"; "You can't redistribute the music as standalone audio"; "You can't register it through Content ID systems". Claims page: claims appear as "We Are Era Music BV — claimed on behalf of Shane Ivers".
- Zabriskie `https://chriszabriskie.com/use/`: "All of my music is free to use in creative projects under the Creative Commons Attribution 4.0 license. Credit is required for free use."
- Audionautix `https://audionautix.com/creative-commons-music`: "All music produced by Jason Shaw on AudionautiX is released under Creative Commons Attribution 4.0 International License" — "You are free to use the music (even for commercial purposes) as long as you provide a link to this website from yours OR credit us with, "music by audionautix.com"." — "Must be part of some other created works."

What CC BY 4.0 means for the four questions: private sharing — yes; public and monetised — yes; keeping files in a local application library — yes (copying is allowed); redistribution of raw files — allowed by the CC licence itself, but Buckley and Silverman add "not in isolation / not standalone" rules, so do not redistribute. No AI clause in any of them.

Other tier-B music (hand-picked, manual):
- **YouTube Audio Library** — no-attribution tracks and CC BY tracks; filters for genre, mood, vocals, **BPM**, duration. `https://support.google.com/youtube/answer/3376882` [read]: "Music and sound effects from the YouTube Audio Library are copyright-safe. The Audio Library is found exclusively in YouTube Studio." — "won't be claimed by a rights holder through the Content ID system." Needs the owner's Google account. YouTube terms [read] forbid access "using any automated means (such as robots, botnets or scrapers)". **Manual download only.** Whether the library's licence covers use off YouTube was **not verified** (the licence text itself is only inside YouTube Studio).
- **Pixabay Music** — custom "Content License", no attribution. Licence pages not read ([secondary]: content "cannot be sold or distributed on a standalone basis"). `https://pixabay.com/api/docs/` [read] documents images and videos only (no music endpoint) and says "do not send lots of automated queries. Systematic mass downloads are not allowed." **Manual download only.** Content ID status of individual uploads: not verified.
- **Mixkit music** — `https://mixkit.co/llm-info/` [read]: "Free License: Allows use in commercial projects (YouTube videos, social media marketing, online ads, music videos) and personal projects. No attribution required." Terms `https://mixkit.co/terms/` [read] forbid to "use scripts or bots to mass download Items (this includes using any means whatsoever to scrape/download the entire library and/or database of Items)", to "aggregate or collate an Item(s) and make available on a stock or inventory basis" and to "build a similar or competitive product or service". **Manual download only; local personal use only.** Full licence text is client-rendered and was not read.
- **OpenGameArt music** — per-asset CC0 / CC BY / CC BY-SA / GPL (`https://opengameart.org/content/faq` [read]: "you can use any of the art submitted to this site. Even in commercial projects. Just be sure to adhere to the license terms."). Quality varies widely; take CC0 and CC BY only, by hand.
- **Free Music Archive (site)** — per-track licences. Terms `https://freemusicarchive.org/Terms_of_Use` [read]: "You will not attack the Site with automated requests or attempt to data mine the Site." **Manual download only.** FAQ [read]: "Some artists on the FMA have started using YouTube's Content ID system … FMA cannot address Content ID claims directly." Useful for a hand-picked handful of CC0/CC BY artists; MP3.
- **ccMixter** — per-track CC licences, many NC. Terms `https://ccmixter.org/terms` [read]: "Different Creative Commons licenses may apply to different tracks … You must use each track in accordance with its license terms." An API exists (terms section 8); limits not verified. Offers stems/a cappellas. Take CC BY only, by hand.
- **Wikimedia Commons audio** — `https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia` [read]: "almost all content hosted on Wikimedia Commons may be freely reused subject to certain restrictions (in many cases)"; each file page lists "the copyright status, the copyright owner, and the license conditions". Mostly OGG; quality uneven. Good for specific public-domain classical recordings; per-file licence must be stored.

### 2.3 Tier C — rejected for the library

| Source | Reason |
|---|---|
| **FreePD** | `https://freepd.com/` [read]: "we have officially taken the service offline … freepd.com is now permanently closed." Copies exist on archive.org (`freepd`, 7.2 GB, 1,025 MP3) but that item has **no licence field, an anonymous uploader, and at least one file that is plainly not FreePD material** ("Animals Of The ABC Islands _ Wild Caribbean _ BBC Earth.mp3"). Provenance cannot be proven; do not ingest. |
| **Bensound** (free licence) | `https://www.bensound.com/faq` [read]: free use only "as part of an online video … published and accessible free of charge"; "Each attribution text is valid for 1 video only. If you want to use the same track in a new video, you can download it again to receive a new attribution text." A local library cannot satisfy a per-video token; tracks are in Content ID. |
| **MTG-Jamendo dataset** | `README.md` [read]: "made available solely for non-commercial research and academic use. Any other use … requires prior written authorization from Jamendo S.A." (55,701 tracks, 320 kbps MP3, 508 GB.) |
| **MUSDB18 / MUSDB18-HQ** (stems) | `https://sigsep.github.io/datasets/musdb.html` [read]: "the tracks can only be used for academic purposes"; 46 tracks CC BY-NC-SA. |
| **FMA dataset** (`fma_full.zip`, 879 GiB; `fma_large` is 30 s clips) | `README.md` [read]: 106,574 tracks, MP3, sha1 checksums published. Mixed per-track CC licences (many NC/ND), mostly amateur recordings, one 879 GiB zip that exceeds the budget. Quality-first owner: no. |
| **Slakh2100** (104 GB FLAC, Zenodo, CC BY 4.0) | Machine-rendered MIDI with stems; not music a viewer wants to hear, and the origin of the underlying compositions was not verified. |
| **Uppbeat free tier** | [secondary]: 3 downloads, then one more per month; credit per download. Useless for a library. Not verified at source. |
| **Chosic** | Aggregator of third-party artists; not verified (bot challenge). Go to the artists directly. |
| **Jamendo site, Tabletop Audio, Purple Planet, TeknoAXE, Tim Beek, Alexander Nakarada, filmmusic.io** | Licence pages not readable or not found today → **not verified**, not recommended until read. |
| **Soundimage.org (Eric Matyas)** | Custom licence. `https://soundimage.org/attribution-info/` [read]: "you are required to credit me in your actual game, video … Crediting me on the info page on Youtube … instead of in the actual video … is not sufficient." OGG/MP3. Usable only if every video carries an on-screen credit; keep out of the default set. |

## 3. Sound effects

### 3.1 Tier A

| # | Source | Licence | Credit | Formats | Size | Route / stability |
|---|---|---|---|---|---|---|
| S1 | **Sonniss GameAudioGDC bundles** — *conditional: licence not read today* | custom royalty-free licence, PDF inside each bundle ([secondary]: no attribution; no AI/ML training; no standalone redistribution; terms may differ by year) | none ([secondary]) | WAV, professional library recordings from many vendors (not sampled) | per year ≈ 12–90 GB; all years ≈ 214 GB (figures from third-party archive.org mirrors' metadata) | official page `sonniss.com/gameaudiogdc` (direct links/torrent per year) — owner opens it in a browser, reads `License.pdf`, downloads. Torrent infohash gives a stable pin. |
| S2 | **Freesound — CC0 subset via API** | CC0 1.0 per sound (CC BY 4.0 and CC BY-NC 4.0 also exist — filter them) | none for CC0 | originals as uploaded: "it can be .wav, .aif, .flac, .ogg or .mp3"; filter on type/samplerate/bitdepth/duration in the API | owner's choice; realistic 5–20 GB | API key (owner registers) + **OAuth2** for originals. "60 requests per minute and 2000 requests per day"; originals "30 requests per minute and 500 requests per day". Stable numeric sound ids; store id, uploader, licence URL, md5 from the API response |
| S3 | **FSD50K** (Zenodo record 4060432) | per-clip Creative Commons licence in the metadata (keep CC0, optionally CC BY) | none for CC0 | "uncompressed PCM 16 bit 44.1 kHz mono", 51,197 clips of 0.3–30 s, 200 labelled classes (human sounds, animals, things, nature, instruments) | ~24 GB download | plain HTTPS from Zenodo, multi-part zip, **md5 per file** from `https://zenodo.org/api/records/4060432`; DOI-versioned |
| S4 | **Freesound Loop Dataset (FSL10K)** (Zenodo record 3967852) | per-loop CC licence in `FSL10K/metadata.json` (keep CC0 / CC BY) | per licence | WAV loops; "9,455 loops … tempo, key, genre and instrumentation annotation" | 8.84 GB | Zenodo, md5 `c260a1203a82c1dda80ec1de75e5e23f` for `FSL10K.zip` |
| S5 | **Kenney audio packs** | CC0 1.0 | none | pack format not verified by download; site preview is OGG Vorbis 48 kHz stereo (I −19.1 LUFS, peak −0.4 dBTP) | 10 packs, small (UI Audio 50 files, Impact Sounds 130 files) | **manual** (robots.txt blocks AI agents) or the paid itch.io "All-in-1" bundle. Packs: Casino Audio, Sci-fi Sounds, Interface Sounds, Impact Sounds, Voiceover Pack, Voiceover Pack (Fighter), Music Jingles, RPG Audio, Digital Audio, UI Audio |
| S6 | **US National Park Service sound libraries** | public domain | "please credit the "National Park Service" where appropriate" | MP3 (field recorders "record audio as mp3 files") | < 1 GB | per-file links on nps.gov pages |
| S7 | **Versilian "Miscellania I & II"** (percussion/metal/horror one-shots) | CC0 (per the curated list at hilbricht.net; Versilian page not read) | none | WAV | small | Versilian Studios site — verify on download |

Evidence:
- Freesound FAQ `https://freesound.org/help/faq/` [read]: "for the "zero" license you can do pretty much what you want with the sound. You could even sell the sound, ... but you can't claim you are the author!" — on AI: "CCO sounds have no restrictions." — on claims: "if an artist creates a song that contains all of, or even a snippet of, a "raw" sound effect from this site, and then the artist also submits their song to the YouTube Content ID Scanning system, then if another person uses the same sound effect in a YouTube video, the ID scan will discover a match."
- Freesound API `https://freesound.org/docs/api/overview.html` [read]: rate limits quoted in the table; "Downloading original sound files requires OAuth2 authentication". API terms `https://freesound.org/help/tos_api/` [read]: "Use of the API is for interaction with your application only. Do not make full copies of the database." and "Terms for commercial use of the API will be negotiated on a case by case basis with UPF". A curated personal pull of a few thousand CC0 sounds is within this; mirroring the CC0 subset is not.
- Kenney `https://kenney.nl/support` [read]: "all game assets on the asset pages are public domain licensed (CC0). You're free to use them, even in commercial projects."
- NPS `https://www.nps.gov/yell/learn/photosmultimedia/soundlibrary.htm` [read]: "The files available here were recorded in the park and are in the public domain. They may be downloaded and used without limitation; however, please credit the "National Park Service" where appropriate."
- Zenodo API records [read] for the md5 values and sizes.

Honest gap: none of S2–S7 gives designed "cinematic" material (whooshes, risers, braams, hits, transitions) at professional level. That comes from S1 (Sonniss) and the manual sources in 3.2. If Sonniss is rejected after the owner reads its licence, the designed-SFX layer must come from 99Sounds, Mixkit and Pixabay by hand, plus the editor's own synthesiser.

### 3.2 Tier B

| Source | Licence | Credit | Formats | Route | Notes |
|---|---|---|---|---|---|
| **99Sounds** | custom royalty-free | not required | WAV packs (not sampled) | manual, one pack at a time | `https://99sounds.org/license/` [read]: "royalty-free for personal and commercial projects" — "You do not have the right to sell or redistribute (even for free) the audio files … on their own" — "may not be used to create "noise apps," "white noise apps," "sleep sound apps," and similar software." — "Giving credit … is not obligatory." Designed cinematic and ambience packs; the best manual complement. |
| **Mixkit sound effects** | Mixkit free licence (see 2.2) | not required | not sampled | manual only (bots forbidden) | categories include transition, nature, human, lifestyle, technology, game |
| **Pixabay sound effects** | Pixabay Content License (not read) | not required ([secondary]) | not sampled | manual only ("Systematic mass downloads are not allowed") | |
| **Free To Use Sounds** (free Bandcamp packs) | custom | **required** for the free packs: "Sound effects obtained from Free To Use Sounds" (or the two variants on the page) with a website link | field recordings, WAV (not sampled) | manual (Bandcamp) | `https://www.freetousesounds.com/license-agreement/` [read]: "Licensee may not sell, sublicense, redistribute, share, or otherwise make available any of the licensed sound effects in their original form"; AI/ML and app developers need a separate "Developer License". Using them inside the owner's own videos is fine; do not expose them to anyone else. |
| **OpenGameArt sounds** | per asset | per asset | varies | manual | take CC0 only |
| **BBC Sound Effects** — *private-only pool, see below* | RemArc licence | credit the BBC | WAV, "over 33,000 clips", mono and stereo | site has a "Download all favourites" batch tool behind licence acceptance | **non-commercial only** |
| **ZapSplat** (free account) | custom Standard Licence ([secondary]) | **required** for free accounts: credit "ZapSplat" ([secondary]) | MP3 on free accounts, WAV for paying members ([secondary]) | account, manual | not verified at source; lowest priority |

BBC detail (text read from the site's own application bundle, `https://sound-effects.bbcrewind.co.uk/` [read]): "The BBC Sound Effects Archive is available for personal, educational or research purposes." — "as long as your usage remains non-commercial, you can use sound effects for free, crediting the BBC. If the usage becomes commercial - i.e. if you monetise it, sell it, or charge for access to it, or if it is advertising-funded or commercially sponsored, then that counts as commercial use" — the licence text also lists "to do text and data mining, computer analysis or to develop or train artificial intelligence" among restricted purposes. Consequence: usable in a family video sent privately; **not** in anything posted on an advertising-funded platform. Only ingest if the library gets a hard `private_only` flag that blocks public export. Otherwise reject.

### 3.3 Tier C

| Source | Reason |
|---|---|
| **Adobe Audition sound effects** (direct zips on download.adobe.com, e.g. Ambience 1 1.3 GB, Drones 1.3 GB) | `https://www.adobe.com/products/audition/offers/adobeauditiondlcsfx.html` [read]: "Your download and use of the content on this page is governed by and subject to the Adobe Software License Agreement ("EULA") for Adobe Audition and other related Adobe software." Use only if the owner holds an Adobe licence and has read that EULA. |
| **SoundBible** | Small, old, per-sound mix of CC BY / public domain / other (`https://soundbible.com/about.php` [read]); not worth a pipeline. |
| **Philharmonia sound samples** (as SFX or instruments) | measured 64 kbps mono MP3; see section 5. |
| **Openverse** (as a download source) | Index only. Terms `https://docs.openverse.org/terms_of_service.html` [read]: "You must not scrape the content in the Openverse catalog". Fine as a search aid. |
| **Free Firearm Sound Library, xeno-canto, NASA audio, ESC-50, UrbanSound8K** | not read today → not verified. |

## 4. Loops and stems — summary

- Loops with tempo/key metadata: **FSL10K** (S4). Take CC0 and CC BY loops only.
- Stems of real songs under usable licences: **Josh Woodward** (stems for newer songs in the USD 40 bundle), **Incompetech** ("Over 200 individual tracks with stems, alternate takes, etc." in the USD 38 bundle), **Silverman** (stems with the paid licence), **ccMixter** (CC BY items, by hand).
- Research stem sets (MUSDB18, MedleyDB-derived, MTG-Jamendo) are academic/non-commercial — rejected.

## 5. Sampled instruments for the built-in synthesiser

| Library | Licence | Format / quality | Size | Download | Notes |
|---|---|---|---|---|---|
| **Salamander Grand Piano V3** (Yamaha C5) | **Public domain** since 2022-03-04 | SFZ + WAV, "48kHz 24bit, 16 velocity layers" | 1.45 GB (48k/24, tar.bz2, sha1 `90dfa11fa1f812a1cd956f38e66bc82820c918aa`); 489 MB (44.1k/16); 78 MB (Ogg) | `archive.org/details/SalamanderGrandPianoV3` | Author's blog `https://rytmenpinne.wordpress.com/2022/03/04/good-news-everyone/` [read]: "I've decided to public domain all my sampled instruments! yay! They are all yours now and you may do whatever you wish!" The archive.org item and sfzinstruments.github.io still label it CC-BY-3.0 (older label) — keep the blog URL in the manifest. Crediting Alexander Holm costs nothing. |
| **Salamander Drumkit** | Public domain (same statement) | SFZ + WAV | not measured | `archive.org/details/SalamanderDrumkit` | acoustic kit |
| **VSCO-2 Community Edition** (chamber orchestra) | CC0 1.0 | SFZ + WAV | "3 GB of samples" | GitHub `sgossner/VSCO-2-CE`, release 1.1.0 | `LICENSE` [read]: "CC0 1.0 Universal". Site [read]: "no rules, no royalties, no limits on how or when you can use it". Strings, winds, brass, percussion, keys. |
| **Versilian Community Sample Library (VCSL)** | CC0 1.0 | WAV; measured 48 kHz/16-bit stereo, peaks −17.8 to −30.9 dBFS (unnormalised, clean); 4,231 WAV files | not fully measured (> 0.4 GB) | GitHub `sgossner/VCSL`, commit `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e` | README [read]: "you can do whatever you want with these sounds (even make commercial software), no royalties, no credit, no special terms." Recorders, zithers/harps, mallets, hand percussion, drums, a TX81Z set. |
| **MuseScore_General.sf2 / .sf3** (General MIDI set) | MIT | SF2 215.6 MB; SF3 39.9 MB | — | `https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/` | Licence file [read]: "MuseScore_General.sf2 is shared under the MIT license … The acknowledgements and copyright notices above must be included in any derivative work." Best single file for full GM coverage. |
| **GeneralUser GS 2.0.3** (GM/GS set) | custom permissive licence v2.0 | SF2, 261 presets + 13 kits, "30.7 MB of RAM" | ~31 MB | schristiancollins.com (do not hot-link) | [read]: "You may use GeneralUser GS without restriction for your own music creation, private or commercial … Please feel free to use it in your software projects". Caveat in the licence itself: "I cannot be 100% sure where all of the samples originated". |
| **FreePats sound banks** | per bank: CC0 preferred, some CC BY 4.0/3.0, older GPL + sound exception | SFZ/SF2 + WAV/FLAC | small per bank | freepats.zenvoid.org | `licenses.html` [read]. Pianos, guitars, basses, organs, mallets, synth sets, drum kits. Read each bank's licence line. |
| **AVL Drumkits** (Red Zeppelin, Black Pearl) | CC BY-SA 3.0 with music exception | SFZ/SF2/Hydrogen, 5 velocity layers | not measured | bandshed.net/avldrumkits | [read]: "You are free to distribute or sell any music you create with these kits without attribution, that is only required if you modify or fork the samples and library formats themselves." |
| **University of Iowa MIS** | "may be downloaded and used for any projects, without restrictions" | AIFF; older set 16-bit/44.1 kHz mono (measured: chromatic-scale file of 43 s, peak −15.8 dBFS); post-2011 instruments 24-bit/96 kHz stereo | few GB | per-file links on theremin.music.uiowa.edu | Older files are whole scales and need slicing; anechoic and dry. Good raw material, more work. |
| **Headroom Piano** (Yamaha C3) | CC BY 4.0 | SFZ | 156 MB | sfzinstruments.github.io/pianos | attribution: Bengt Nilsson |
| **Accurate-Salamander** | CC BY | SFZ | 1.6 GB | via sfzinstruments list | retuned Salamander |
| **TinySOL** (Zenodo 3685367) | CC BY 4.0 | isolated orchestral notes | 1.03 GB, md5 `36030a7fe389da86c3419e5ee48e3b7f` | Zenodo | sample format not verified |

Rejected or caution:
- **Philharmonia sound samples** — `https://philharmonia.co.uk/resources/sound-samples/` [read]: "You are free to use these samples as you wish, including releasing them as part of a commercial work. The only restriction is that they must not be sold or made available 'as is' (i.e. as samples or as a sampler instrument)." Measured: MP3, 44.1 kHz, **mono, 64 kbps**. Too low for a quality upgrade, and they could never ship with the synthesiser.
- **NSynth** — CC BY 4.0 [read], but "four second, monophonic 16kHz audio snippets". Too low-fidelity.
- **Sonatina Symphonic Orchestra** — "Creative Commons Sampling Plus 1.0" [read], a retired licence with an advertising restriction; 16-bit/44.1 kHz. Prefer VSCO-2 CE.
- **Virtual Playing Orchestra** — 603 MB WAV; [read]: "different licenses apply to different parts of the library". Built partly from Sonatina, Iowa and Philharmonia material. Usable for making music; licence bookkeeping is messy. Skip.
- **Pianobook** — per-pack, uploader-warranted; FAQ [read]: "It is forbidden to sell or redistribute the sample libraries"; "we cannot guarantee sample packs uploaded to this site are copyright free". Skip.
- **jRhodes3d** — samples CC BY-NC, with a carve-out "License for musicians using this to make music: CC0" (sfzinstruments list [read]). Usable locally; never ship.
- **Karoryfer, DrumGizmo kits, Flame Studios, Spitfire LABS** — not verified.
- Pointer worth keeping: `https://hilbricht.net/foss-sampled-instruments/` [read] — a strict, hand-checked list (Salamander piano and drumkit, VSCO-2 CE, Versilian Miscellania, AVL Drumkits, Flame Studios guitars).

Shipping rule: CC0 / public-domain / MIT instruments (Salamander, VSCO-2 CE, VCSL, MuseScore_General) are the only ones that could later be bundled with the product. Everything else stays a local-disk add-on.

## 6. Proposed first download set (target 60–120 GB)

| Block | What to take | Size | Owner action needed |
|---|---|---|---|
| Music, PD/CC0 | Musopen: `MusopenCollectionAsFlac`, `musopen-chopin`, `musopen-lossless-dvd` (archive.org); Kimiko Ishizaka Goldberg + WTC (FLAC) | ~23 GB | two Bandcamp downloads by hand |
| Music, CC BY 4.0 | Incompetech whole catalogue; Scott Buckley whole library; Josh Woodward (vocal + instrumental); Silverman Sound; Chris Zabriskie albums; Audionautix only as low-priority filler (128 kbps, clipped masters) | ~22 GB as MP3 | none for MP3. Recommended spend: USD 38 (Incompetech zips + stems) and USD 40 (Woodward FLAC + stems + short cuts) — these are the official bulk archives and the only lossless routes |
| SFX, professional | Sonniss GDC: start with two or three years (for example the 2024 and 2026 bundles plus one mid-size older year) | ~40–70 GB | open the official page in a browser, **read `License.pdf`**, download |
| SFX, CC0 bulk | FSD50K (keep CC0 clips, plus CC BY if the credit generator exists); FSL10K loops (CC0/CC BY); Kenney 10 packs; NPS clips; Versilian Miscellania | ~24 GB + 8.8 GB + < 1 GB (download size; kept size smaller after the licence filter) | Kenney by hand |
| SFX, curated | Freesound CC0 via API: targeted queries (room tones, children, party, crowd, household foley, nature, UI) with filters on licence, duration, sample rate and rating | 5–10 GB over one to three weeks at 500 originals/day | create a Freesound account and API credential (OAuth2) |
| SFX, manual | 99Sounds packs (cinematic hits, whooshes, rain/thunder, ambiences) | ~5 GB (estimate) | by hand |
| Instruments | Salamander piano 48k/24 + drumkit; VSCO-2 CE; VCSL; MuseScore_General.sf2; GeneralUser GS; AVL Drumkits; selected FreePats banks | ~6–8 GB | none |
| **Total** | | **≈ 95–125 GB** (drop one Sonniss year to land under 100) | |

What a 500 GB budget adds:
- All Sonniss GDC years (≈ 214 GB in total).
- Scott Buckley WAV library through his Patreon tier (size not published); Silverman WAV + stems (paid).
- A much larger Freesound CC0 pull — only by agreement with Freesound; their FAQ points bulk users to "Data Packs" by request rather than the API.
- University of Iowa 24/96 instrument sets; more FreePats banks; Accurate-Salamander.
- Hand-picked no-attribution tracks from the YouTube Audio Library, Pixabay and Mixkit (manual; these fill the "modern pop / social short" gap that CC BY artists cover only partly).
- BBC Sound Effects, **only** with the `private_only` flag implemented.
- Not recommended even with space: FMA dataset (879 GiB, mixed licences, amateur), MTG-Jamendo (non-commercial research), Slakh.

## 7. Download and manifest design

- One manifest row per file: `source`, `source_url`, `licence_id` (SPDX-style: `CC0-1.0`, `CC-BY-4.0`, `PDM-1.0`, `LicenseRef-Sonniss-GDC-<year>`, `LicenseRef-99Sounds`, …), `licence_url`, `licence_read_date`, `credit_text` (exact string), `credit_placement` (`description` | `on_screen` | `none`), `redistribute` (bool), `public_ok` (bool), `monetised_ok` (bool), `ai_use_ok` (bool or unknown), `sha256` (computed locally after download), upstream hash where one exists, `bytes`, `fetched_at`.
- Upstream integrity available: archive.org per-file `sha1`/`md5`; Zenodo `md5`; FMA dataset `sha1`; GitHub commit ids (VCSL, VSCO-2 CE); torrent infohash (Sonniss, archive.org). Artist sites (Incompetech, Buckley, Woodward, Audionautix) give only `ETag`/`Last-Modified` and unversioned URLs — pin by local `sha256` and keep the file; do not re-fetch.
- Politeness for artist sites: one connection, 3 s between requests (Audionautix asks for `Crawl-delay: 3`), resume support, a descriptive user agent, run once. Incompetech's whole catalogue is 1,443 requests; Woodward explicitly worries about bandwidth.
- Manual-only sources (automation forbidden or blocked): YouTube Audio Library, Pixabay, Mixkit, Free Music Archive site, Kenney, ZapSplat, 99Sounds, Bandcamp, Sonniss page. Give the owner an "import folder" that asks for source and licence at import time.
- Metadata for the browser: Incompetech `pieces.json` (bpm, genre, mood, instruments, length); FSL10K (tempo, key, genre, instrumentation); FSD50K (200 class labels); Freesound API (tags, duration, automatically extracted descriptors — "these features are automatically extracted and might not be always accurate"); Sonniss (file names and embedded metadata — not verified). Everything else needs local analysis: loudness (EBU R128), tempo, key, duration. Loudness varies a lot: measured music masters ranged from −9.4 to −21.7 LUFS, so normalise at playback, never rewrite the files.
- Reject on ingest: true peak above 0 dBTP together with sample peak at 0.0 dB (clipped), MP3 below 192 kbps for music, mono music, sample rate below 44.1 kHz.

## 8. Legal traps, stated plainly

1. **"Free to use in videos" is not "free to put in an application's library for other people".** Pixabay, Mixkit, 99Sounds, ZapSplat, Free To Use Sounds and Silverman forbid distributing the raw files on their own; Mixkit also forbids collating items "on a stock or inventory basis" and building "a similar or competitive product". A library on the owner's own disk, used only by the owner, is use and not distribution — the moment files are bundled, synced to others or committed, it is distribution.
2. **CC BY music will get Content ID claims on YouTube unless the credit is in the description text at upload.** Kevin MacLeod: music is "pre-registered"; credit "placed in the video itself … could not be read automatically". Scott Buckley and Silverman Sound: claims via "We Are Era Music BV"; Buckley: "Adding credits will not automatically remove a claim" (a release form is needed afterwards). Josh Woodward: safe only "as long as you give proper attribution as you're uploading it". So an end-card credit alone is not enough for YouTube.
3. **Bensound's free licence is per video**: "Each attribution text is valid for 1 video only." It cannot live in a library.
4. **Raw Freesound sounds can trigger claims** because third parties register songs that contain them (Freesound FAQ). CC0 does not protect against that; expect an occasional dispute.
5. **BBC Sound Effects are non-commercial only** and posting on an advertising-funded platform counts as commercial by the BBC's own wording. The licence also restricts AI training and data mining.
6. **Adobe's "free" sound effects are under the Adobe software EULA**, not an open licence.
7. **Philharmonia samples may not be offered "as a sampler instrument"**; Pianobook packs may not be redistributed; GeneralUser GS admits unknown sample origins. Only CC0/PD/MIT instruments are safe to ship.
8. **Research datasets are not content libraries**: MTG-Jamendo ("solely for non-commercial research and academic use"), MUSDB18 ("academic purposes"), and anything built on CC BY-NC material. Freesound's API terms also say "Do not make full copies of the database".
9. **Mirrors without provenance**: the archive.org FreePD copy has no licence field and contains foreign files. A mirror's "CC0" label is only as good as its uploader. Prefer items uploaded by the rights holder (e.g. `musopen-chopin`) or with an author's own statement (Salamander).
10. **Label drift**: Salamander Grand Piano is public domain per its author (2022) but still labelled CC-BY-3.0 on archive.org and on the SFZ list. Record the authoritative URL, not the mirror's label.
11. **AI clauses**: Sonniss ([secondary]) forbids AI/ML training; Free To Use Sounds requires a separate licence for "machine learning or AI development"; BBC restricts it; Freesound uploaders can set generative-AI preferences since July 2026. If the editor ever feeds library audio to a model (even for local analysis that trains something), these sources must be excluded — hence the `ai_use_ok` column. Plain playback and mixing in a video is not affected.
12. **NoDerivatives (ND) licences** on FMA/ccMixter/Jamendo forbid editing a track under a video in most readings (FMA FAQ: "incorporating a song into a video is a derivative work"). Filter out ND as well as NC.
13. **Scraping bans** that make a source manual-only: YouTube ("any automated means"), Pixabay ("Systematic mass downloads are not allowed"), Mixkit ("scripts or bots to mass download"), Free Music Archive ("automated requests … data mine"), Openverse ("must not scrape").

## 9. Not verified (could not be read at the source today)

- Sonniss GDC licence text, per-year terms, official sizes, audio format — site blocked; only search summaries and third-party mirror metadata.
- Pixabay Content License and Terms (audio rules, Content ID, AI clause) — blocked; only a search summary and the API page.
- ZapSplat Standard Licence (credit text, MP3/WAV limits, app/library clause) — blocked.
- Uppbeat free tier terms — blocked.
- Musopen site terms, free-account limits, lossless access — blocked. (Archive.org items are verified as items only.)
- Chosic — blocked.
- Mixkit: full text of the music and sound-effect licences (page is client-rendered); only the summary page and the user terms were read.
- YouTube Audio Library: the licence text shown inside YouTube Studio, including use outside YouTube.
- Kenney: pack file formats and sizes (only a preview file was probed).
- Silverman Sound: exact credit string and MP3 bitrate. Chris Zabriskie: formats, track count, download route.
- Scott Buckley WAV library size and format (Patreon-gated). Exact track count (estimated from pagination).
- Audionautix track count (taken from a third party's FAQ).
- Freesound: number of CC0 sounds; contents of the web terms of service.
- FSD50K: the exact list of clip licences (only the "per clip, in metadata" structure was confirmed); FSL10K licence mix.
- TinySOL sample format; VCSL total size; Salamander Drumkit size; AVL Drumkits size.
- Tim Beek, Alexander Nakarada, TeknoAXE, filmmusic.io, Purple Planet, Tabletop Audio, Jamendo site, Karoryfer, DrumGizmo kits, Free Firearm Sound Library, xeno-canto, NASA audio, ESC-50, UrbanSound8K, Looperman, Internet Archive general terms — pages unreadable, not found, or not attempted.
- Whether any specific track in any library is currently registered in Content ID by a third party (cannot be checked without uploading).
- I did not listen to anything: "professionally produced" rests on the sources' nature (single-composer production libraries, commissioned orchestral recordings, vendor SFX libraries) and on the measured technical figures, not on a listening test. A listening pass by the owner on 20–30 files per source is still needed before a source is marked trusted.

## 10. Measurements (all files deleted after inspection)

| Source | File | Container/codec | Rate / depth / ch | Bitrate | I (LUFS) | LRA | True peak | Sample peak |
|---|---|---|---|---|---|---|---|---|
| Incompetech | The Britons (2026) | MP3 | 44.1 kHz / stereo | 320 kbps | −12.3 | 4.7 | −0.4 dBTP | −0.4 dB |
| Incompetech | Carefree (older) | MP3 | 44.1 kHz / stereo | 256 kbps | −20.2 | 3.5 | −3.2 | −3.4 |
| Scott Buckley | Wildflowers | MP3 | 44.1 kHz / stereo | 320 kbps | −14.3 | 9.0 | −1.1 | −1.1 |
| Josh Woodward | Let It In | MP3 | 44.1 kHz / stereo | 320 kbps | −10.3 | 10.8 | **+0.5** | 0.0 |
| Audionautix | Falling Sky | MP3 | 44.1 kHz / stereo | **128 kbps** | −9.4 | 9.0 | **+3.4** | **0.0 (clipped)** |
| Musopen (archive.org) | Goldberg Var. 4 | FLAC | 44.1 kHz / 24-bit / stereo | lossless | −21.7 | 6.0 | −6.9 | −6.9 |
| VCSL | 4 recorder samples | WAV PCM | 48 kHz / 16-bit / stereo | 1,536 kbps | −25.9 … −39.8 | — | −17.8 … −30.9 | same |
| Philharmonia | Thai gong, triangle | MP3 | 44.1 kHz / **mono** | **64 kbps** | −34.1, −52.6 | — | −18.7, −32.6 | — |
| Univ. of Iowa | Flute.vib.mf.B3B4 | AIFF PCM | 44.1 kHz / 16-bit / mono | 706 kbps | −30.2 | 10.7 | −15.8 | −15.8 |
| Kenney | site preview (foley) | OGG Vorbis | 48 kHz / stereo | ~79 kbps | −19.1 | 6.2 | −0.4 | −0.4 |
