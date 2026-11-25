# Library fetcher

`fetch.mjs` fills the owner's content library (`E:\PULSEFRAME-Library` on the laptop) from a manifest. It is one file, runs with plain `node` (22 or newer), uses only built-in modules, and starts no other program except `git` for items of kind `git`. Zip and tar.gz archives are read by the script itself (no `tar`, no 7-Zip).

Downloaded content is data. The script never executes, imports or evaluates anything it fetched; npm packages are unpacked, their scripts are not run.

## Sending it to the laptop

The lead cannot reach the laptop's disk; a helper session there runs what the lead sends.

1. Send `fetch.mjs` in one message (under 60 KiB) and the manifest in a second, each with its SHA-256. Both files are plain ASCII.
2. The helper saves them as UTF-8, for example to `E:\PULSEFRAME-Library\_manifests\fetch.mjs` and `...\_manifests\visual-01.json`. Not with a PowerShell `>` redirect (Windows PowerShell 5.1 writes UTF-16; the script says so if a manifest arrives that way).
3. The helper checks each file. This prints the hash of the text with Windows line ends and a byte-order mark removed, so it matches the lead's value however the editor saved it:

   ```
   node -e "const s=require('fs').readFileSync(process.argv[1],'utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');console.log(require('crypto').createHash('sha256').update(s).digest('hex'))" fetch.mjs
   ```

## Running it

```
node fetch.mjs --root E:\PULSEFRAME-Library --manifest visual-01.json --dry-run
node fetch.mjs --root E:\PULSEFRAME-Library --manifest visual-01.json --only cldr-annotations/en
node fetch.mjs --root E:\PULSEFRAME-Library --manifest visual-01.json
```

- `--dry-run` prints every item with its size (from the manifest, `Content-Length`, or the npm registry) and writes nothing.
- `--only a,b` / `--skip a,b` take item ids or source ids.
- `--max-gb n` (default 100) is a hard limit on the whole library folder: what is already there, plus what running items reserved, plus the new item. An item that would pass it is refused before it starts, and a download of unknown size is stopped when it passes it.
- `--delay-ms n` (default 500) is the pause between request starts to one host; at most two requests per host are open at once.
- `--verify` re-hashes folders that are already present (files are always re-hashed).
- Exit code 0: everything selected is present. 1: an item failed or was refused. 2: bad arguments, invalid manifest, or another run holds the library.
- The very last line on stdout is always `EXIT <code>` (0, 1 or 2, the same number as the exit code, printed after the SUMMARY block), for a wrapper script that loses the process exit code. `--help` prints the usage only.
- Git items need no global git setting: every git command the tool runs in a repository it created passes `-c safe.directory=<that folder>` on its own command line, so a drive that records no file owner (git's "dubious ownership") works without touching `git config --global`.

### Running detached on Windows

Put the command in a `.ps1` file and start it with `powershell -NoProfile -File <file>`; never as an inline `-Command` string with nested quotes (an inline `"exit $LASTEXITCODE"` once ran as `exit 0` and stopped a two-step run after its first step). Read the `EXIT <code>` line at the end of the output as well as the process exit code.

Run it again after a failure: finished items are recognised as present, and a partial download continues where it stopped when the server gave a strong `ETag` and honours `Range` (otherwise it starts again). Nothing is ever overwritten: a file or folder that is in the way with other content is reported and left alone.

Each item lands in `_downloads-in-progress\<item id>`, is checked there (size, SHA-256, npm integrity value, git commit, archive entry names), and only then is renamed into place.

## What the script refuses

- Any URL that is not `https:`, including a redirect target; URLs with a user name or password.
- An archive with an absolute path, a drive letter or `..` in any entry: the whole item fails, before anything is written. Links and device entries are skipped and counted.
- A hash, size, integrity value or commit that differs from the manifest: the item fails and nothing is moved into place.
- Sources marked `needsOwnerKey`: skipped with a note. The script reads and sends no credential, cookie or key; `git` runs with prompts and credential helpers switched off.

File names from archives are made safe for Windows (`<>:"|?*` and control characters become `_`, trailing dots and spaces are dropped, device names such as `NUL` get a leading `_`, names that differ only by letter case get `~2`). Paths longer than 240 characters are still written (Node handles them) but are counted in the ledger entry's `warnings`, because Explorer and other programs may not open them.

## The manifest (version 1)

`manifestVersion` comes first. A source has `id`, `title`, `licence` (`spdx` or `custom`, `url`, `readOn`, `quote` in the publisher's own words), `credit` (the exact line, or `null`), the flags `diskOnly`, `creditInExport`, `shareAlike`, `people`, `aiGenerated`, `repoAllowed` (all six stated; optional `needsOwnerKey`, `trademark`, `personalOnly`), `notes`, and `items`. Item kinds:

| kind | fields | verified by |
|---|---|---|
| `file` | `url`, `dest`, optional `sha256`, `bytes` | SHA-256 and size when given |
| `archive` | `url`, `format` (`zip` or `tar.gz`), `dest`, optional `sha256`, `bytes`, `approxUnpackedBytes`, `strip`, `keep` (path prefixes) | SHA-256 and size of the archive when given; zip CRC of every entry |
| `npm` | `name`, `version` (exact), `dest`, optional `integrity`, `bytes`, `approxUnpackedBytes`, `keep` | the registry's `dist.integrity` (sha512), which must also equal the manifest's value when given |
| `git` | `repo`, `commit` (40 digits), `dest`, `approxBytes`, optional `sparse`, `sparseNoCone` | the checked-out commit |

`dest` is relative, with forward slashes, inside `music`, `sounds`, `visual`, `models` or `instruments`. Unknown fields are errors.

A `git` item is fetched as one commit without file contents (`fetch --depth=1 --filter=blob:none origin <commit>`), then checked out, which downloads only the files of the sparse paths. The `.git` folder stays. Measured on `google/fonts`: 3.4 MB of `.git` for two small families (the commit's folder listing, an index of all 20,095 paths, and the fetched files once more in packed form). Plan for roughly the size of the checked-out files again for already-compressed content (PNG, fonts), less for SVG.

## The ledger

`_manifests\ledger.json` is append-only. One entry per fetched item: item and source id, manifest id and hash, URL, final path, bytes, `sha256` of the downloaded file, `treeSha256` and file count for folders, `integrity` or `commit` where they apply, the licence fields and flags copied from the manifest, warnings, and the time.

- `"pinned": true` means the bytes were checked against a value fixed beforehand (manifest hash, registry integrity value, git commit).
- `"pinned": false` means the publisher gives no hash and the manifest had none: the recorded `sha256` is what was **first seen**. The run prints a `PIN <item> sha256=... bytes=...` line for each, so the lead can put the value into the next manifest version.

`licenceTexts` in the same file records each licence URL as fetched (path, hash, size) or the reason it could not be fetched; that failure is not fatal. The text is stored as `_manifests\LICENCES\<source id>.txt` exactly as the server sent it (a web page stays HTML). If a later run finds a different text, the first copy stays and the new one is saved beside it with a warning: read it before using new files.

`_manifests\CREDITS.txt` is rebuilt from the ledger on every run: licence, credit line and rules per source.

## The disk-only rule

Content of a source marked `diskOnly` stays on the owner's disk. It is never committed to the repository and never embedded in a project archive that is sent to someone else; the archive export has to leave such assets out by this flag. `repoAllowed` sources may be committed together with their licence text. `creditInExport` sources need their credit line in every shared video.

`@iconify/json` is marked `diskOnly` as a whole because it mixes licences: the editor must read `collections.json` and offer only sets under MIT, ISC, Apache-2.0 or CC0-1.0, and never Remix Icon (`ri`).

## Tests

`pnpm vitest run tools/library` (no network: a server on 127.0.0.1 through a test-only plain-http transport, and a git repository made in a temp folder). `pnpm typecheck` covers the test file and `fetch.d.mts`; `fetch.mjs` itself is plain JavaScript and is not type-checked.

## Manifests

| file | content | about | notes |
|---|---|---|---|
| `manifests/visual-01.json` | emoji, icons, transitions, fonts, maps, doodles | see its own notes | permissive licences only |
| `manifests/audio-01.json` | public-domain classical (Musopen), CC BY music (Incompetech), FSD50K and Freesound Loop Dataset (disk-only, per-clip licences), sampled instruments (Salamander, VSCO-2 CE, VCSL, MuseScore_General, TinySOL) | size: see the SUMMARY line of a dry run | Zenodo and archive.org give MD5/SHA-1 only: the publisher's value is in each item's `notes`, `bytes` is exact, the ledger records the first-seen SHA-256. FSD50K audio is a split zip: join the parts with 7-Zip on the laptop. |
| `manifests/models-01.json` | tier-1 local models: SigLIP 2, SAM 2.1 tiny/small, BiRefNet lite, Depth Anything 3 small/base, YuNet, DictaLM 3.0 1.7B, Gemma 4 E2B, DictaBERT niqqud, PANNs Cnn14 | about 8.7 GB | not gated; Hugging Face files pinned by commit, size and SHA-256 |

## Gated models (`fetch-gated.mjs`)

`node fetch-gated.mjs [--root <library>]` is run by the owner in their own terminal. It reads `expected/gated-models-01.json`, asks for a Hugging Face access key in a hidden prompt (refused when there is no terminal), and downloads the gated files into `models/gated/…`, checking each size (and SHA-256 where one is recorded). The key stays in memory for the run, is sent to `huggingface.co` only (redirects are followed by hand without it) and is never written, printed or passed on a command line. It prints the SHA-256 of every file and saves them to `_manifests/gated-hashes.txt`, from which the lead records the reference values. Tested in the Linux container: a public file without a key, a repeated run, no terminal (exit 2), a malformed key (nothing sent), a dummy key against the gated list (HTTP 401, the rest skipped). Not tested: a real key, Windows.
