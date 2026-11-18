/**
 * `pnpm proof:phone-drop` — the end-to-end proof of the phone drop and the import queue (ADR-0023, amends ADR-0002), on a CPU,
 * with no model. Evidence: docs/evidence/phone-drop-proof.json.
 *
 * CONTRACT FILE (lead pre-pass): the script name and the evidence path are fixed; the proof is the lead's, after W1–W3 are
 * merged (plan §9 with the verifier's corrections, which win). Until it is written this exits 2 = blocked, and proves nothing.
 *
 * What the checks must be able to fail for (the corrections win over the plan):
 * - The server is started by a launcher inside packages/evals that passes cfg.dropAdmitAddresses from its own argv to
 *   startServer (main.ts untouched; no environment variable can set it), and the evidence records that the override was used.
 *   P3b: WITHOUT the override, POST …/drop answers 409 no_private_network on a machine without a private address.
 * - P8: a reload in the phone context continues the batch (same-IP re-claim); a second device gets 409 and the Hebrew message.
 * - P11/P12: the Hebrew refusal is asserted in the Playwright phone context with a body of at least 64 MiB (a refusal read by a
 *   browser still sending, not a reset); after a refused junk upload the data directory returns to its size without clean-up.
 * - P13: record whether an orphan ffmpeg survived the SIGKILL; assert "no temp files" only after it exited.
 * - P17: ONE actor — owner edit, owner background import (POST …/imports), Ctrl+Z undoes the edit and redo is available; the
 *   control (POST …/assets, kind 'edit') makes Ctrl+Z remove the import. The phone case is a separate, labelled check.
 * - P18: against docs/evidence/phone-drop-baseline.json (proof:phone-drop-baseline, recorded at the base commit), in a fresh
 *   data directory where no conform reuse is possible; ignore only id, importedAt, capture and provenance.upload.
 * - The EXIF fixture is checked by an independent reader (ffprobe -show_frames: DateTimeOriginal, Orientation) before use.
 * - Free disk at the start is recorded; HEIC, the Windows firewall prompt, a VPN as default route and real phone pickers are
 *   recorded as not verified here.
 */
console.error('proof:phone-drop is not built yet (phone drop, ADR-0023): the contracts are in place; the proof is the lead\'s after W1-W3. Nothing was checked.');
process.exit(2);
