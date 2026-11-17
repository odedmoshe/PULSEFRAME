/**
 * `pnpm packs:sheet` — a contact sheet for the owner (ADR-0022): every pack element and one still per pack template, written to
 * .artifacts/packs-sheet/ as PNG. It looks; it does not judge: the owner views it before more packs are made.
 *
 * CONTRACT FILE (lead pre-pass): the script name and the output folder are fixed; the sheet is W1's. Until it is written this
 * exits 2 = blocked, and writes nothing.
 */
console.error('packs:sheet is not built yet (content packs, ADR-0022): the contracts are in place and the sheet is W1\'s. Nothing was written.');
process.exit(2);
