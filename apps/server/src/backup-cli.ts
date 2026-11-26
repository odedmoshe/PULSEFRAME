/** `pnpm backup <destination>`: consistent copy of the data directory (PF_DATA_DIR or ./.data), safe while the server runs. */
import { loadConfig } from './config.ts';
import { backupDataDir } from './backup.ts';

if (process.argv[2] === '--verify') {
  const dir = process.argv[3];
  if (!dir) { console.error('usage: pnpm backup --verify <backup directory>'); process.exit(2); }
  const { verifyBackup } = await import('./backup.ts');
  try {
    const r = await verifyBackup(dir);
    for (const d of r.databases) console.log(`${d.ok ? 'ok     ' : 'DAMAGED'} ${d.file}${d.ok ? ` (${d.projects} project(s))` : `: ${d.error}`}`);
    console.log(`${r.mediaChecked} media file(s) checked against their content hash; ${r.mediaDamaged.length} damaged; ${r.mediaMissing.length} referenced by the database but missing.`);
    for (const h of r.mediaDamaged) console.log(`DAMAGED blobs/${h}`);
    for (const h of r.mediaMissing) console.log(`MISSING blobs/${h}`);
    console.log(r.ok ? 'Backup verified.' : 'Backup has problems (see above).');
    process.exit(r.ok ? 0 : 1);
  } catch (e) { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); }
}
if (process.argv[2] === '--prune') {
  const dir = process.argv[3], apply = process.argv[4] === '--apply';
  if (!dir) { console.error('usage: pnpm backup --prune <backup directory> [--apply]'); process.exit(2); }
  const { pruneBackup } = await import('./backup.ts');
  try {
    const r = pruneBackup(dir, apply);
    console.log(`${r.kept} media file(s) are needed by a database in this backup. ${r.unreferenced.files} file(s), ${r.unreferenced.bytes} bytes, are not needed by any.`);
    console.log(r.removed ? 'They were removed.' : r.unreferenced.files ? 'Nothing was removed. Run again with --apply to remove them.' : 'Nothing to remove.');
    process.exit(0);
  } catch (e) { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); }
}
const dest = process.argv[2];
if (!dest) { console.error('usage: pnpm backup <destination directory>'); process.exit(2); }
backupDataDir(loadConfig().dataDir, dest).then(
  (r) => console.log(`Backup written to ${r.dest}: database ${r.databaseBytes} bytes (integrity check passed, ${r.projects} project(s)), ${r.filesCopied} file(s) copied (${r.bytesCopied} bytes; ${r.filesVerified} media file(s) checked against their content hash), ${r.filesSkipped} unchanged.\nIt contains credentials (tokens.json); keep it private.`),
  (e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); },
);
