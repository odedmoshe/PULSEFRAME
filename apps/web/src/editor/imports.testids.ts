/**
 * Fixed data-testids of the import queue's cards and the phone drop dialog (ADR-0023), shared by the editor components and the
 * proofs (phone-drop-proof.ts, a11y-audit.ts). Lead contract: W3 puts exactly these on the elements named here; the lead's
 * mount step puts the entry points (file-input is today's, Library.tsx).
 * The phone's own page has its ids in apps/server/src/drop-page/testids.ts.
 */
export const IMPORT_TESTIDS = {
  // entry points (lead mount step): today's file picker, the folder picker (webkitdirectory), the phone drop opener
  fileInput: 'file-input', folderInput: 'folder-input', phoneDropOpen: 'phone-drop-open',
  // the import cards: their list (outside ul.assets, which phase0/phase3 proofs wait on), the summary «בייבוא (N)», one card per
  // job (or per local upload before it has a job), its state chip, its buttons, and the skipped-files notice of a folder
  list: 'imports-list', summary: 'imports-summary', card: (jobId: string) => `import-card-${jobId}`, localCard: (localId: string) => `import-local-${localId}`,
  state: 'import-state', progress: 'import-progress', retry: 'import-retry', cancel: 'import-cancel', dismiss: 'import-dismiss', skipped: 'imports-skipped',
} as const;
export const PHONE_DROP_TESTIDS = {
  // the dialog, its address picker (the owner confirms the address), the open button, the QR plate, the typed address and code
  dialog: 'phone-drop-dialog', address: 'phone-drop-address', start: 'phone-drop-start', qr: 'phone-drop-qr', typedAddress: 'phone-drop-typed-address', pin: 'phone-drop-pin',
  // the status line (role=status), the received files (import cards with via 'phone'), close and new code, the disclosure
  status: 'phone-drop-status', files: 'phone-drop-files', close: 'phone-drop-close', renew: 'phone-drop-new', disclosure: 'phone-drop-disclosure',
  // an honest state instead of a code (no home network, port failed, locked, expired, restarted) and the Windows/VPN hint
  problem: 'phone-drop-problem', hint: 'phone-drop-hint',
  // the chip left in the drawer header when the dialog is hidden while a code is live, and its close button
  chip: 'phone-drop-chip', chipClose: 'phone-drop-chip-close',
} as const;
