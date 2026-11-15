/** `pnpm backup <destination>`: consistent copy of the data directory (PF_DATA_DIR or ./.data), safe while the server runs. */
import { loadConfig } from './config.ts';
import { backupDataDir } from './backup.ts';

const dest = process.argv[2];
if (!dest) { console.error('usage: pnpm backup <destination directory>'); process.exit(2); }
backupDataDir(loadConfig().dataDir, dest).then(
  (r) => console.log(`Backup written to ${r.dest}: database ${r.databaseBytes} bytes (integrity check passed, ${r.projects} project(s)), ${r.filesCopied} file(s) copied (${r.bytesCopied} bytes), ${r.filesSkipped} unchanged.\nIt contains credentials (tokens.json); keep it private.`),
  (e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); },
);
