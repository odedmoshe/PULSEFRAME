/**
 * proof:sources — «מאגר» / «ייבוא מקישור» end to end (wave 8 sources, part A). PRE-PASS STUB: the checks are named here, in order,
 * from sources-plan.md §5 as cut by sources-verify.md (yt-dlp, thumbnails, publish, folder and Freesound are not in this track) and
 * the decisions. W3 writes them against the settled contracts and W2's LABELLED doubles: `double: openverse`, `double: pixabay`,
 * `double: wikimedia`, `double: link-host`, each started by the proof on 127.0.0.1 port 0, wire shapes from sources-research.md A1/A2,
 * the address policy injected through SourcesDeps.test for the proof ONLY. Nothing is claimed about the real services. Fixtures made
 * at proof time by ffmpeg (a 2 s 320x180 testsrc MP4, a 1 s sine MP3, a 64x64 PNG) and deleted at the end.
 * Until SOURCES_BUILT.routes and SOURCES_BUILT.fetcher it prints every check as todo and exits 2 (blocked: not built).
 * Run through /home/user/PULSEFRAME/.artifacts/heavy. Evidence: docs/evidence/sources-proof.json.
 */
import { SOURCES_BUILT } from '@pulseframe/core';

export const SOURCES_PROOF_CHECKS = [
  '1 Openverse search: rows carry licence id and name from the answer; the double saw exactly q, the filters and "User-Agent: PULSEFRAME-Studio", and no project or owner text',
  '1b Openverse anonymous: the remaining-searches number counts down from 5 an hour; before the double would answer 429 the answer says how many are left; a 429 maps to provider_rate_limited with retryAfterSeconds',
  '2 Pixabay without a key: provider_key_missing; with the key stored by the owner\'s session the double saw it; no answer, log line, job row or SSE event contains it; an agent storing a key gets 403 owner_required',
  '3 a second identical Pixabay search within 24 h is served from memory (the double counted one request); no query on disk (grep of the data directory)',
  '3b Wikimedia without a contact: provider_contact_missing; with one the double saw "PULSEFRAME-Studio (<contact>)"; Artist HTML is shown as text',
  '4 a preview handle streams the double\'s bytes with Range (206); an unknown handle is 404 preview_not_found; a URL in place of a handle is never fetched',
  '5 import of a CC BY item as an AGENT credential: one use_source_item commit and one add_clip at the playhead, both as that agent; provenance.source validates; sha256 = the original hash; the credit verbatim; fetchedAt set; undo removes it exactly',
  '6 the download breaks at 50%: the job resumes with Range + If-Range (the double saw bytes=n-); with a changed ETag, or a 200 to the Range, it restarts at 0; the final hash is equal',
  '7 server restart mid-download: recover continues the .part; after success, after cancel and after a failure no src_* .part, up_ file or .link sidecar is left',
  '8 limit 100 KB and a 200 KB file whose Content-Length lies low: download_too_large naming the setting and the number, nothing stored; a setting above the upload limit is capped at it',
  '9 links to 127.0.0.1, [::ffff:127.0.0.1], 169.254.169.254, this machine\'s own interface address, and a public name redirecting to loopback: link_address_refused; a name that resolves to a public and a loopback address is refused; a 192.168.x.x link imports with link_private_network',
  '9b the DEFAULT address policy (nothing injected) refuses 127.0.0.1',
  '10 a link answering text/html: download_not_media; a Dropbox share link (dl=0) is fetched as dl=1 and its pageUrl keeps dl=0 out',
  '11 an NC item and an ND item: imported with warnings (no refusal); the export answers non_commercial_content and licence_no_derivatives naming the licences and quoting the ND deed sentence; the export succeeds; a shared archive leaves the NC and the Pixabay files out',
  '12 credits of the library-only golden documents are byte-identical to credits.golden.json; a project with only a CC BY source credit gets a credits card and an export reminder (C3)',
  '13 music fit of a CC BY-SA Openverse song: shortened with the share-alike warning quoting the deed; the copy carries the source record; its credit is listed with the shortened line (C4)',
  '14 the same idempotencyKey twice: one job, one download',
  '15 UI (headless Chromium): the «מאגר» tab reaches results, Space previews, Enter places at the playhead, the link box imports; Settings › «חיבורים» stores a key from the owner\'s session; RTL; the keyboard path without a mouse',
] as const;

if (import.meta.url === `file://${process.argv[1]}`) {
  const built = SOURCES_BUILT.routes && SOURCES_BUILT.fetcher;
  for (const c of SOURCES_PROOF_CHECKS) console.log(`${built ? 'TODO-WRITE' : 'todo'} ${c}`);
  if (!built) { console.log(`\nproof:sources — blocked: the sources runtime and the safe downloader are not built in this build (${SOURCES_PROOF_CHECKS.length} checks named)`); process.exit(2); }
  console.error('proof:sources: the checks are named but not written yet (W3)'); process.exit(1);
}
