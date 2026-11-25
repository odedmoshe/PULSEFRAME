/**
 * The catalogue of the owner's content library (wave 7 library track, worker A; library/contract.ts).
 *
 * - The root: cfg.libraryDir (PF_LIBRARY_DIR) wins over <dataDir>/library.json (0600), which only the owner's session writes.
 * - The index is a derived cache, <dataDir>/library-index.sqlite, keyed by the ledger's SHA-256, the root's realpath and
 *   LIBRARY_READERS_VERSION. It is not a job row (jobs need a project): one in-process, cancellable build writes
 *   LIBRARY_INDEX_FILE + '.tmp', which is swapped in whole. The previous index answers meanwhile. A '.tmp' found at start-up (a
 *   build cut by a restart) or an index that does not match the ledger is rebuilt at start-up.
 * - Every file is reached through paths.ts (realpath containment); the walk never reads a file above MAX_READ_BYTES except the
 *   known metadata files (MAX_METADATA_BYTES). File items are not opened at all when indexing (their ledger sha256 is checked
 *   at use); files in trees are recorded with their size and mtime (checked at use).
 * - What a licence means is core's (licenceDuties); a row whose licence the table refuses stays listed with its reason. When the
 *   table is not built in this build, nothing is listed and every entry says why (fail closed).
 * - Search words are never logged or stored.
 */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  currentEntries, heQueryForms, LIBRARY_FACETS_MAX, type LibraryFacets, heSkeleton, LEDGER_PATH, LedgerEntrySchema, LedgerSchema, LIBRARY_PAGE_MAX, LIBRARY_READERS_VERSION, LIBRARY_WORDS_HE,
  licenceDuties as coreLicenceDuties, searchKey, type LedgerEntry, type LibraryItemsPage, type LibraryItemsQuery, type LibraryKind, type LibraryRow,
  type LibraryState, type LibraryStatus, type LibraryUnusable,
} from '@pulseframe/core';
import type { Config } from '../config.ts';
import { canRasteriseSvg } from '../elements.ts';
import { LIBRARY_CONFIG_FILE, LIBRARY_INDEX_FILE, MAX_METADATA_BYTES, MAX_READ_BYTES, ROOT_REASONS, libraryError, type RootReason } from './contract.ts';
import { isInside, listInside, openInside, readInside, REPO_ROOT, statInside } from './paths.ts';
import { readerFor } from './readers/index.ts';
import type { ReaderCtx, ReaderRow, SharedData } from './readers/types.ts';

export type LicenceDutiesFn = typeof coreLicenceDuties;
/** One catalogue row as the index keeps it: the row the API answers, and what use needs to find and check the file. */
export interface IndexedRow {
  row: LibraryRow;
  /** The ledger entry (current one). */
  entry: { item: string; path: string; kind: LedgerEntry['kind']; sha256?: string; bytes: number; treeSha256?: string; version?: string; commit?: string; licenceUrl?: string };
  rel: string;
  member: string | null;
  /** Size and mtime recorded at index time (a file in a tree); null mtime for a file item. */
  bytes: number;
  mtimeMs: number | null;
  format: string;
  /** The row's own licence (as the reader named it) and the duties the core table gave it. */
  licence: { spdx?: string; custom?: string; url?: string };
}
/** Genre and mood values by kind: search key → the first spelling seen and the row count. */
type FacetCounts = Partial<Record<LibraryKind, { genre: Record<string, [string, number]>; mood: Record<string, [string, number]> }>>;
interface Summary { counts: Partial<Record<LibraryKind, number>>; svgCounts: Partial<Record<LibraryKind, number>>; notListed: { dir: string; entries: number }[]; unusable: Partial<Record<LibraryUnusable, number>>; problems: { item: string | null; reason: string }[] }

export interface LibraryServiceOptions {
  /** Core licenceDuties by default; tests may give a stand-in, labelled as such. */
  duties?: LicenceDutiesFn;
  rasteriser?: () => Promise<boolean>;
  /** Called after each entry is read while building (tests slow a build down or stop it here). */
  onEntry?: (done: number, total: number) => Promise<void> | void;
  /** Do not start a build from the constructor (tests). */
  noStartupBuild?: boolean;
}

const SCHEMA = `
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE items (
  id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, svg INTEGER NOT NULL, credit INTEGER NOT NULL, nc INTEGER NOT NULL,
  bpm REAL, dur REAL, genre TEXT NOT NULL, mood TEXT NOT NULL, data TEXT NOT NULL);
CREATE VIRTUAL TABLE fts USING fts5(title, body, tsk, bsk, content='', prefix='1 2 3', tokenize='unicode61 remove_diacritics 0');
`;
const bars = (xs: string[]) => `|${xs.map(searchKey).filter(Boolean).join('|')}|`;

export class LibraryService {
  readonly cfg: Config;
  private readonly duties: LicenceDutiesFn;
  private readonly rasteriser: () => Promise<boolean>;
  private readonly opts: LibraryServiceOptions;
  private db: Database.Database | null = null;
  private building: { cancel: boolean; progress: { rows: number; entriesDone: number; entriesTotal: number }; done: Promise<void> } | null = null;
  private ledgerCache: { stamp: string; sha256: string } | null = null;
  private closed = false;
  /** The start-up check (it may start a build); idle() waits for it first. */
  private starting: Promise<void> = Promise.resolve();
  private startingNow = false;

  constructor(cfg: Config, opts: LibraryServiceOptions = {}) {
    this.cfg = cfg;
    this.opts = opts;
    this.duties = opts.duties ?? coreLicenceDuties;
    this.rasteriser = opts.rasteriser ?? canRasteriseSvg;
    this.openIndex();
    if (!opts.noStartupBuild) { this.startingNow = true; this.starting = this.startupCheck().catch(() => undefined).finally(() => { this.startingNow = false; }); }
  }
  get indexFile() { return path.join(this.cfg.dataDir, LIBRARY_INDEX_FILE); }
  get configFile() { return path.join(this.cfg.dataDir, LIBRARY_CONFIG_FILE); }

  // ---------- the root ----------
  /** The configured root as written (env first), or null. */
  configuredRoot(): string | null {
    if (this.cfg.libraryDir) return this.cfg.libraryDir;
    try {
      const j = JSON.parse(fs.readFileSync(this.configFile, 'utf8')) as { root?: unknown };
      return typeof j.root === 'string' && j.root ? j.root : null;
    } catch { return null; }
  }
  /** Why a folder cannot be the root, or null when it can. */
  rootProblem(root: string): RootReason | null {
    const win = /^[A-Za-z]:[\\/]/.test(root) || root.startsWith('\\\\');
    if (!path.isAbsolute(root) || (process.platform === 'win32' && !win)) return 'it is not an absolute path';
    let real: string;
    try { real = fs.realpathSync(root); if (!fs.statSync(real).isDirectory()) return 'it does not exist'; } catch { return 'it does not exist'; }
    try { if (!fs.statSync(path.join(real, ...LEDGER_PATH.split('/'))).isFile()) return 'it holds no _manifests/ledger.json'; } catch { return 'it holds no _manifests/ledger.json'; }
    const dataReal = (() => { try { return fs.realpathSync(this.cfg.dataDir); } catch { return path.resolve(this.cfg.dataDir); } })();
    if (isInside(dataReal, real)) return 'it lies inside the data directory';
    const repoReal = (() => { try { return fs.realpathSync(REPO_ROOT); } catch { return REPO_ROOT; } })();
    if (isInside(repoReal, real)) return 'it lies inside the repository';
    return null;
  }
  /** PUT /library/root (the owner's session; the route checks that). null clears it. The environment variable still wins. */
  setRoot(root: string | null): void {
    if (root !== null) {
      const why = this.rootProblem(root);
      if (why) throw libraryError('rootInvalid', { reason: why, reasons: ROOT_REASONS }, why);
    }
    const tmp = `${this.configFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ root }) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, this.configFile);
    try { fs.chmodSync(this.configFile, 0o600); } catch { /* Windows */ }
    if (this.configuredRoot()) this.startBuild();
  }

  // ---------- the ledger ----------
  /** The state of the configured root and its ledger (not the index). */
  private async rootState(): Promise<{ state: Exclude<LibraryState, 'indexing' | 'ready'> | 'ok'; rootReal?: string; ledger?: { sha256: string; entries: unknown[]; licenceTexts: { source: string; path?: string }[] }; problems?: { item: string | null; reason: string }[] }> {
    const root = this.configuredRoot();
    if (!root) return { state: 'not_configured' };
    let rootReal: string;
    try { rootReal = await fsp.realpath(root); if (!(await fsp.stat(rootReal)).isDirectory()) return { state: 'root_missing' }; } catch { return { state: 'root_missing' }; }
    const file = path.join(rootReal, ...LEDGER_PATH.split('/'));
    let real: string;
    try { real = await fsp.realpath(file); } catch { return { state: 'ledger_missing', rootReal }; }
    if (!isInside(rootReal, real)) return { state: 'ledger_invalid', rootReal, problems: [{ item: null, reason: 'the ledger is a link out of the library folder' }] };
    let bytes: Buffer;
    try {
      const st = await fsp.stat(real);
      if (!st.isFile()) return { state: 'ledger_missing', rootReal };
      if (st.size > MAX_METADATA_BYTES) return { state: 'ledger_invalid', rootReal, problems: [{ item: null, reason: `the ledger is larger than ${MAX_METADATA_BYTES} bytes` }] };
      bytes = await fsp.readFile(real);
    } catch { return { state: 'ledger_missing', rootReal }; }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    let json: unknown;
    try { json = JSON.parse(bytes.toString('utf8')); } catch { return { state: 'ledger_invalid', rootReal, problems: [{ item: null, reason: 'the ledger is not JSON' }] }; }
    const parsed = LedgerSchema.safeParse(json);
    if (!parsed.success) {
      const v = (json as { ledgerVersion?: unknown } | null)?.ledgerVersion;
      return { state: 'ledger_invalid', rootReal, problems: [{ item: null, reason: v !== 1 ? `the ledger is not version 1 (ledgerVersion ${JSON.stringify(v ?? null).slice(0, 20)})` : 'the ledger has no entries list' }] };
    }
    this.ledgerCache = { stamp: real, sha256 };
    return { state: 'ok', rootReal, ledger: { sha256, entries: parsed.data.entries, licenceTexts: parsed.data.licenceTexts.map((t) => ({ source: t.source, ...(typeof t.path === 'string' ? { path: t.path } : {}) })) } };
  }

  // ---------- the index file ----------
  private openIndex() {
    this.db?.close();
    this.db = null;
    try {
      if (!fs.existsSync(this.indexFile)) return;
      const db = new Database(this.indexFile, { readonly: true, fileMustExist: true });
      db.prepare('SELECT 1 FROM meta LIMIT 1').get();
      this.db = db;
    } catch { this.db = null; }
  }
  private meta(k: string): string | null {
    try { return (this.db?.prepare('SELECT v FROM meta WHERE k = ?').get(k) as { v: string } | undefined)?.v ?? null; } catch { return null; }
  }
  private summary(): Summary | null {
    const s = this.meta('summary');
    return s ? (JSON.parse(s) as Summary) : null;
  }
  private async startupCheck() {
    const tmp = `${this.indexFile}.tmp`;
    const cut = fs.existsSync(tmp);
    const rs = await this.rootState().catch(() => null);
    if (this.closed || !rs || rs.state !== 'ok') return;
    if (cut || !this.db || this.meta('ledgerSha256') !== rs.ledger!.sha256 || this.meta('rootReal') !== rs.rootReal || this.meta('readersVersion') !== String(LIBRARY_READERS_VERSION)) this.startBuild();
  }

  // ---------- the build ----------
  /** Starts a build (a running one is cancelled first; its temp file is replaced). */
  startBuild(): void {
    if (this.closed) return;
    if (this.building) this.building.cancel = true;
    const prev = this.building?.done ?? Promise.resolve();
    const b = { cancel: false, progress: { rows: 0, entriesDone: 0, entriesTotal: 0 }, done: Promise.resolve() };
    this.building = b;
    b.done = prev.then(() => this.build(b)).catch(() => { /* a failed build leaves the previous index; the status says why */ }).finally(() => { if (this.building === b) this.building = null; });
  }
  /** DELETE /library/reindex: stops a build; the previous index stays. True when one was running. */
  cancelBuild(): boolean {
    if (!this.building) return false;
    this.building.cancel = true;
    return true;
  }
  /** Resolves when no build is running. */
  async idle(): Promise<void> { await this.starting; while (this.building) await this.building.done; }
  close(): void {
    this.closed = true;
    if (this.building) this.building.cancel = true;
    this.db?.close();
    this.db = null;
  }

  private async build(b: { cancel: boolean; progress: { rows: number; entriesDone: number; entriesTotal: number } }): Promise<void> {
    if (b.cancel || this.closed) return;
    const rs = await this.rootState();
    if (rs.state !== 'ok') return;
    const rootReal = rs.rootReal!;
    const tmp = `${this.indexFile}.tmp`;
    for (const f of [tmp, `${tmp}-journal`, `${tmp}-wal`]) fs.rmSync(f, { force: true });
    fs.mkdirSync(this.cfg.dataDir, { recursive: true });
    const db = new Database(tmp);
    let keep = false;
    try {
      db.pragma('journal_mode = OFF');
      db.pragma('synchronous = OFF');
      db.exec(SCHEMA);
      const insItem = db.prepare('INSERT INTO items (key, kind, svg, credit, nc, bpm, dur, genre, mood, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const insFts = db.prepare('INSERT INTO fts (rowid, title, body, tsk, bsk) VALUES (?, ?, ?, ?, ?)');
      const sum: Summary = { counts: {}, svgCounts: {}, notListed: [], unusable: {}, problems: [] };
      const facets: FacetCounts = {};
      const problem = (item: string | null, reason: string) => { if (sum.problems.length < 20) sum.problems.push({ item, reason: reason.slice(0, 300) }); };
      // entries: validated one by one; a bad one is named, never fatal
      const valid: LedgerEntry[] = [];
      for (const raw of rs.ledger!.entries) {
        const p = LedgerEntrySchema.safeParse(raw);
        if (p.success) valid.push(p.data);
        else problem(typeof (raw as { item?: unknown })?.item === 'string' ? String((raw as { item: string }).item).slice(0, 200) : null, `not a ledger entry: ${p.error.issues[0]?.path.join('.') ?? ''} ${p.error.issues[0]?.message ?? ''}`.trim());
      }
      const entries = currentEntries(valid);
      b.progress.entriesTotal = entries.length;
      const notListed = new Map<string, number>();
      const shared: SharedData = { cldr: new Map(), pieces: new Map() };
      const ctxOf = (e: LedgerEntry): ReaderCtx => ({
        entry: e, shared,
        problem: (reason) => problem(e.item, reason),
        cancelled: () => b.cancel || this.closed,
        list: async (rel) => {
          const items = await listInside(rootReal, e.path, rel).catch(() => null);
          if (!items) return null;
          const out: { name: string; type: 'file' | 'dir' }[] = [];
          for (const d of items) {
            if (d.isDirectory()) out.push({ name: d.name, type: 'dir' });
            else if (d.isFile()) out.push({ name: d.name, type: 'file' });
            else if (d.isSymbolicLink()) {
              const st = await statInside(rootReal, e.path, rel ? `${rel}/${d.name}` : d.name); // null for a link out of the item
              if (st?.isDirectory()) out.push({ name: d.name, type: 'dir' });
              else if (st?.isFile()) out.push({ name: d.name, type: 'file' });
              else problem(e.item, `a link out of its folder was not read: ${(rel ? `${rel}/` : '') + d.name}`.slice(0, 300));
            }
          }
          return out;
        },
        stat: async (rel) => { const s = await statInside(rootReal, e.path, rel); return s?.isFile() ? { size: s.size, mtimeMs: s.mtimeMs } : null; },
        read: async (rel, max) => { try { return (await readInside(rootReal, e.path, rel, Math.min(max, MAX_METADATA_BYTES)))?.bytes ?? null; } catch { return null; } },
        head: async (rel, n) => {
          try {
            const f = await openInside(rootReal, e.path, rel);
            try { const buf = Buffer.alloc(Math.min(n, MAX_READ_BYTES)); const { bytesRead } = await f.fd.read(buf, 0, buf.length, 0); return buf.subarray(0, bytesRead); } finally { await f.fd.close(); }
          } catch { return null; }
        },
      });
      // pass 1: what other entries need (CLDR words, pieces.json)
      const chosen = entries.map((e) => ({ e, c: readerFor(e) }));
      for (const { e, c } of chosen) {
        if (b.cancel || this.closed) return;
        if ('reader' in c && c.reader.collect) await c.reader.collect(ctxOf(e));
      }
      // pass 2: rows
      let dutiesMissing = false;
      let batch = 0;
      db.exec('BEGIN');
      for (const { e, c } of chosen) {
        if (b.cancel || this.closed) { db.exec('ROLLBACK'); return; }
        if ('notListed' in c) { notListed.set(c.notListed, (notListed.get(c.notListed) ?? 0) + 1); b.progress.entriesDone++; continue; }
        if (!c.reader.rows) { b.progress.entriesDone++; continue; }
        if (e.kind === 'file' && !e.sha256) { problem(e.item, 'a file item without a sha256 in the ledger is not listed'); b.progress.entriesDone++; continue; }
        const emit = async (r: ReaderRow) => {
          const fileRel = r.rel || e.path.slice(e.path.lastIndexOf('/') + 1);
          const key = `${e.item}/${fileRel}${r.member ? `#${r.member}` : ''}`;
          if (key.length > 300) { problem(e.item, `a key longer than 300 characters was not listed: ${key.slice(0, 80)}…`); return; }
          const licence = r.licence ?? { ...(e.licence.spdx ? { spdx: e.licence.spdx } : {}), ...(e.licence.custom ? { custom: e.licence.custom } : {}), url: e.licence.url };
          let duties;
          try { duties = this.duties(e.source, licence, e.flags); } catch { dutiesMissing = true; return; }
          const creditText = (r.credit !== undefined ? r.credit : e.credit)?.trim() ?? '';
          let unusable: LibraryUnusable | undefined;
          if (duties.use !== 'ok') unusable = duties.use;
          else if (r.creditUnresolved) unusable = 'credit_unresolved';
          else if (duties.credit && !creditText) unusable = 'credit_missing';
          else if (duties.credit && creditText.length > 500) unusable = 'credit_unresolved';
          else if (r.animated) unusable = 'animated';
          const row: LibraryRow = {
            key, entry: e.item, sourceId: e.source, kind: r.kind, title: r.title || fileRel, ...(r.author ? { author: r.author } : {}),
            licenceId: duties.licenceId,
            ...(creditText && creditText.length <= 500 && unusable !== 'credit_unresolved' ? { credit: { text: creditText, placement: duties.placement } } : {}),
            duties: { credit: duties.credit, nonCommercial: duties.nonCommercial, shareable: duties.shareable },
            badges: { ...(e.flags.people ? { people: true as const } : {}), ...(e.flags.aiGenerated ? { aiGenerated: true as const } : {}), ...(e.flags.trademark ? { trademark: true as const } : {}) },
            meta: r.meta, bytes: r.bytes, ...(unusable ? { unusable } : {}),
          };
          const indexed: IndexedRow = {
            row, rel: r.rel, member: r.member ?? null, bytes: r.bytes, mtimeMs: r.mtimeMs, format: r.format, licence,
            entry: { item: e.item, path: e.path, kind: e.kind, bytes: e.bytes, ...(e.sha256 ? { sha256: e.sha256 } : {}), ...(e.treeSha256 ? { treeSha256: e.treeSha256 } : {}), ...(e.version ? { version: e.version } : {}), ...(e.commit ? { commit: e.commit } : {}), ...(e.licence.url ? { licenceUrl: e.licence.url } : {}) },
          };
          // the «בלי קרדיט» filter: a row needs a credit when its duties say so, or when it is refused under an attribution licence
          const needsCredit = duties.credit || (duties.use !== 'ok' && /^CC-BY/.test(duties.licenceId));
          const tags = [...r.meta.tags, ...r.meta.genre, ...r.meta.mood, ...r.meta.instruments];
          const he = [...tags, r.kind].map((t) => LIBRARY_WORDS_HE[t.toLowerCase()]).filter((x): x is string => !!x);
          const title = searchKey(row.title);
          const body = searchKey([row.author ?? '', ...tags, ...r.words, ...he, LIBRARY_WORDS_HE[r.kind] ?? '', r.kind].join(' '));
          let info;
          try {
            info = insItem.run(key, r.kind, r.format === 'svg' ? 1 : 0, needsCredit ? 1 : 0, duties.nonCommercial ? 1 : 0, r.meta.bpm ?? null, r.meta.durationSeconds ?? null, bars(r.meta.genre), bars(r.meta.mood), JSON.stringify(indexed));
          } catch (err) {
            if (String((err as Error).message).includes('UNIQUE')) { problem(e.item, `the same key twice: ${key.slice(0, 120)}`); return; }
            throw err;
          }
          insFts.run(info.lastInsertRowid, title, body, heSkeleton(title), heSkeleton(body));
          const fk = (facets[r.kind] ??= { genre: {}, mood: {} });
          for (const [name, values] of [['genre', r.meta.genre], ['mood', r.meta.mood]] as const) {
            for (const v of new Set(values.map((x) => x.trim()).filter(Boolean))) {
              const k = searchKey(v);
              if (!k) continue;
              const had = Object.hasOwn(fk[name], k) ? fk[name][k] : undefined;
              fk[name][k] = had ? [had[0], had[1] + 1] : [v.slice(0, 64), 1];
            }
          }
          sum.counts[r.kind] = (sum.counts[r.kind] ?? 0) + 1;
          if (r.format === 'svg') sum.svgCounts[r.kind] = (sum.svgCounts[r.kind] ?? 0) + 1;
          if (unusable) sum.unusable[unusable] = (sum.unusable[unusable] ?? 0) + 1;
          b.progress.rows++;
          if (++batch % 2000 === 0) { db.exec('COMMIT'); await new Promise((res) => setImmediate(res)); if (b.cancel || this.closed) throw new Cancelled(); db.exec('BEGIN'); }
        };
        try { await c.reader.rows(ctxOf(e), emit); } catch (err) { if (err instanceof Cancelled) return; problem(e.item, `could not be read: ${(err as Error).message}`); }
        b.progress.entriesDone++;
        await this.opts.onEntry?.(b.progress.entriesDone, b.progress.entriesTotal);
        if (b.cancel || this.closed) { if (db.inTransaction) db.exec('ROLLBACK'); return; }
      }
      if (db.inTransaction) db.exec('COMMIT');
      if (dutiesMissing) problem(null, 'the licence table is not built in this build: nothing was listed');
      sum.notListed = [...notListed].map(([dir, n]) => ({ dir, entries: n })).sort((a, z) => (a.dir < z.dir ? -1 : 1));
      const setMeta = db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)');
      setMeta.run('ledgerSha256', rs.ledger!.sha256);
      setMeta.run('rootReal', rootReal);
      setMeta.run('readersVersion', String(LIBRARY_READERS_VERSION));
      setMeta.run('builtAt', new Date().toISOString());
      setMeta.run('summary', JSON.stringify(sum));
      setMeta.run('facets', JSON.stringify(facets));
      db.close();
      if (b.cancel || this.closed) return;
      // swap in whole: close the old one first (Windows cannot rename over an open file)
      this.db?.close();
      this.db = null;
      fs.renameSync(tmp, this.indexFile);
      keep = true;
      this.openIndex();
    } finally {
      if (db.open) db.close();
      if (!keep) fs.rmSync(tmp, { force: true });
    }
  }

  // ---------- answers ----------
  async status(owner: boolean): Promise<LibraryStatus> {
    const rs = await this.rootState().catch(() => ({ state: 'root_missing' as const }));
    const svgRasteriser = await this.rasteriser();
    const sum = rs.state === 'not_configured' ? null : this.summary();
    let state: LibraryState;
    if (rs.state !== 'ok') state = rs.state;
    else if (this.building || this.startingNow) state = 'indexing';
    else state = 'ready'; // the index answers as it is; a changed ledger is read at start-up, on a new root and on reindex (a cancel keeps it)
    const counts: Partial<Record<LibraryKind, number>> = {};
    const unusable: Partial<Record<LibraryUnusable, number>> = { ...(sum?.unusable ?? {}) };
    for (const [k, n] of Object.entries(sum?.counts ?? {}) as [LibraryKind, number][]) {
      const svg = svgRasteriser ? 0 : sum?.svgCounts[k] ?? 0;
      if (n - svg > 0) counts[k] = n - svg;
    }
    if (!svgRasteriser && sum) { const n = Object.values(sum.svgCounts).reduce((a, x) => a + (x ?? 0), 0); if (n) unusable.needs_svg_rasteriser = n; }
    const root = this.configuredRoot();
    return {
      state, ...(owner && root ? { root } : {}), counts, notListed: sum?.notListed ?? [], unusable,
      problems: [...('problems' in rs && rs.problems ? rs.problems : []), ...(sum?.problems ?? [])].slice(0, 20),
      ...(this.building ? { progress: { ...this.building.progress } } : {}),
      indexedAt: sum ? this.meta('builtAt') : null, verifiedAt: null, svgRasteriser,
    };
  }
  /** Whether a root is configured (the item routes answer 409 library_not_configured otherwise). */
  configured(): boolean { return this.configuredRoot() !== null; }
  /** The realpath of the root, or 409 library_not_configured / 404 when the folder is gone. */
  async rootReal(): Promise<string> {
    const root = this.configuredRoot();
    if (!root) throw libraryError('notConfigured');
    try { return await fsp.realpath(root); } catch { throw libraryError('itemMissing', { reason: 'the library folder is not there' }); }
  }
  get(key: string): IndexedRow | null {
    if (!this.db) return null;
    const r = this.db.prepare('SELECT data FROM items WHERE key = ?').get(key) as { data: string } | undefined;
    return r ? (JSON.parse(r.data) as IndexedRow) : null;
  }
  async search(q: LibraryItemsQuery): Promise<LibraryItemsPage> {
    if (!this.db) return { rows: [], next: null, total: 0 };
    const where: string[] = [];
    const args: unknown[] = [];
    if (!(await this.rasteriser())) where.push('i.svg = 0');
    if (q.kind) { where.push('i.kind = ?'); args.push(q.kind); }
    if (q.genre) { where.push('i.genre LIKE ?'); args.push(`%|${searchKey(q.genre)}|%`); }
    if (q.mood) { where.push('i.mood LIKE ?'); args.push(`%|${searchKey(q.mood)}|%`); }
    if (q.bpmMin !== undefined) { where.push('i.bpm >= ?'); args.push(q.bpmMin); }
    if (q.bpmMax !== undefined) { where.push('i.bpm <= ?'); args.push(q.bpmMax); }
    if (q.durMin !== undefined) { where.push('i.dur >= ?'); args.push(q.durMin); }
    if (q.durMax !== undefined) { where.push('i.dur <= ?'); args.push(q.durMax); }
    if (q.credit === 'none') where.push('i.credit = 0');
    if (q.commercial === 'allowed') where.push('i.nc = 0');
    const match = ftsQuery(q.q ?? '');
    const offset = q.cursor !== undefined ? (/^\d{1,9}$/.test(q.cursor) ? Number(q.cursor) : NaN) : 0;
    if (!Number.isFinite(offset)) throw libraryError('itemMissing', { reason: 'cursor' });
    const limit = q.limit ?? 50;
    const from = match ? 'fts JOIN items i ON i.id = fts.rowid' : 'items i';
    const w = [...(match ? ['fts MATCH ?'] : []), ...where];
    const a = [...(match ? [match] : []), ...args];
    const cond = w.length ? `WHERE ${w.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT count(*) AS n FROM ${from} ${cond}`).get(...a) as { n: number }).n;
    const order = match ? 'bm25(fts, 4.0, 2.0, 1.0, 0.5), i.key' : 'i.key';
    const rows = (this.db.prepare(`SELECT i.data FROM ${from} ${cond} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...a, Math.min(limit, LIBRARY_PAGE_MAX), offset) as { data: string }[])
      .map((r) => (JSON.parse(r.data) as IndexedRow).row);
    const next = offset + rows.length < total ? String(offset + rows.length) : null;
    return { rows, next, total };
  }
  /** The genres and moods of the catalogue (one kind, or all), the source's own spelling, most rows first; empty without an index. */
  facets(kind?: LibraryKind): LibraryFacets {
    const raw = this.meta('facets');
    const all = raw ? (JSON.parse(raw) as FacetCounts) : {};
    const merged = { genre: new Map<string, [string, number]>(), mood: new Map<string, [string, number]>() };
    for (const [k, f] of Object.entries(all) as [LibraryKind, NonNullable<FacetCounts[LibraryKind]>][]) {
      if (kind && k !== kind) continue;
      for (const name of ['genre', 'mood'] as const) {
        for (const [key, [value, n]] of Object.entries(f[name])) { const had = merged[name].get(key); merged[name].set(key, had ? [had[0], had[1] + n] : [value, n]); }
      }
    }
    const list = (m: Map<string, [string, number]>) => [...m.values()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).slice(0, LIBRARY_FACETS_MAX);
    return { genre: list(merged.genre), mood: list(merged.mood) };
  }
  /** The stored licence text's path (relative to the root) of a source, from the ledger's licenceTexts (the last stored one), or null. */
  async licencePath(sourceId: string): Promise<string | null> {
    const rs = await this.rootState();
    if (rs.state !== 'ok') return null;
    return rs.ledger!.licenceTexts.findLast((t) => t.source === sourceId && t.path)?.path ?? null;
  }
  /** Whether this row may be offered on this machine (an SVG needs the rasteriser). */
  async svgOk(): Promise<boolean> { return this.rasteriser(); }
}
class Cancelled extends Error {}

/** The FTS5 query for a search text: each word a prefix term (Hebrew prefix forms and skeletons OR'ed), words AND'ed; null for none. */
export function ftsQuery(text: string): string | null {
  const tokens = searchKey(text).split(' ').filter(Boolean).slice(0, 8);
  if (!tokens.length) return null;
  return tokens.map((t) => {
    const terms = new Set<string>();
    for (const f of heQueryForms(t)) {
      terms.add(`{title body}: "${f}"*`);
      const sk = heSkeleton(f);
      if (/[א-ת]/.test(sk)) terms.add(`{tsk bsk}: "${sk}"*`);
    }
    return `(${[...terms].join(' OR ')})`;
  }).join(' AND ');
}

/** One service per data directory in this process (http.ts may build several apps over one directory in tests). */
const services = new Map<string, LibraryService>();
export function libraryServiceFor(cfg: Config, opts?: LibraryServiceOptions): LibraryService {
  const k = path.resolve(cfg.dataDir);
  const s = services.get(k);
  if (s && s.cfg.libraryDir === cfg.libraryDir) return s;
  s?.close();
  const n = new LibraryService(cfg, opts);
  services.set(k, n);
  return n;
}
/** Tests and the proof: stop and forget the service of a data directory (as a process exit would). */
export function closeLibraryService(dataDir: string): void {
  const k = path.resolve(dataDir);
  services.get(k)?.close();
  services.delete(k);
}
