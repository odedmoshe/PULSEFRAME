// Downloads the gated models listed in expected/gated-models-01.json into the owner's library.
// Run by the OWNER, in their own terminal:  node fetch-gated.mjs [--root E:\PULSEFRAME-Library]
// The access key is typed (or pasted) into a hidden prompt. It is kept in memory for this run only:
// never written to disk, never printed, never put on a command line or in an environment variable,
// and sent to huggingface.co only (not to the storage hosts it redirects to).
// Node 22 built-ins only. Exit code: 0 all files present and the right size, 1 a file failed, 2 bad use.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HOST = 'huggingface.co';
const here = path.dirname(fileURLToPath(import.meta.url));

function args(argv) {
  const a = { root: null, expected: path.join(here, 'expected', 'gated-models-01.json'), anonymous: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--root') a.root = argv[++i];
    else if (k === '--expected') a.expected = argv[++i];
    else if (k === '--anonymous') a.anonymous = true; // testing with public files only: sends no key
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

/** Reads one line from the terminal without showing it. Refuses when there is no terminal. */
function readSecret(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      reject(Object.assign(new Error('this must be run by a person in a terminal window (the key is typed into a hidden prompt)'), { use: true }));
      return;
    }
    process.stdout.write(prompt);
    let value = '';
    const done = (err) => {
      input.setRawMode(false); input.pause(); input.off('data', onData);
      process.stdout.write('\n');
      if (err) reject(err); else resolve(value);
    };
    const onData = (chunk) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return done();
        if (ch === '\u0003') return done(new Error('cancelled'));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    input.setRawMode(true); input.resume(); input.on('data', onData);
  });
}

/** One request, tried up to four times when the connection itself fails (not on an HTTP answer). */
async function request(u, headers) {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    try { return await fetch(u, { headers, redirect: 'manual' }); } catch (e) { last = e; }
  }
  const why = last?.cause?.code ?? last?.cause?.message ?? last?.message ?? 'unknown';
  throw new Error(`could not connect to ${u.hostname} after four tries (${why})`);
}

/** GET with redirects followed by hand, so the key goes to huggingface.co and nowhere else. */
async function get(url, token) {
  let u = new URL(url);
  for (let hop = 0; hop < 6; hop++) {
    if (u.protocol !== 'https:') throw new Error(`refused a non-https address (${u.protocol}//${u.hostname})`);
    const headers = { 'user-agent': 'library-fetch/1 (node)', 'accept-encoding': 'identity' };
    if (token && u.hostname === HOST) headers.authorization = `Bearer ${token}`;
    const res = await request(u, headers);
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      await res.body?.cancel();
      if (!next) throw new Error(`redirect without an address (HTTP ${res.status})`);
      u = new URL(next, u);
      continue;
    }
    return res;
  }
  throw new Error('too many redirects');
}

async function sha256Of(file) {
  const h = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}

function safeDest(root, dest) {
  if (typeof dest !== 'string' || dest.includes('\\') || path.posix.isAbsolute(dest) || dest.split('/').some((s) => s === '' || s === '.' || s === '..')) {
    throw new Error(`refused destination ${JSON.stringify(dest)}`);
  }
  if (!dest.startsWith('models/gated/')) throw new Error(`refused destination outside models/gated: ${dest}`);
  return path.join(root, ...dest.split('/'));
}

async function fetchOne(root, f, token) {
  const target = safeDest(root, f.dest);
  if (fs.existsSync(target)) {
    const size = fs.statSync(target).size;
    if (size === f.bytes) return { state: 'present', target };
    throw new Error(`a file of the wrong size is already there (${size} B, expected ${f.bytes} B): ${target} - move or delete it and run again`);
  }
  const u = new URL(f.url);
  if (u.hostname !== HOST || !u.pathname.includes(`/resolve/${f.commit}/`)) throw new Error(`refused address ${f.url}`);
  const res = await get(f.url, token);
  if (res.status === 401) { await res.body?.cancel(); throw Object.assign(new Error('the site did not accept the key (HTTP 401)'), { code: 'KEY' }); }
  if (res.status === 403) { await res.body?.cancel(); throw Object.assign(new Error(`no access yet: open https://${HOST}/${f.repo} while signed in and accept the conditions (HTTP 403)`), { code: 'GATE' }); }
  if (res.status !== 200 || !res.body) { await res.body?.cancel(); throw new Error(`HTTP ${res.status}`); }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const part = `${target}.part`;
  const out = fs.createWriteStream(part, { flags: 'w' });
  const h = crypto.createHash('sha256');
  let got = 0;
  try {
    for await (const chunk of res.body) {
      got += chunk.length;
      if (got > f.bytes) throw new Error(`more data than expected (${f.bytes} B)`);
      h.update(chunk);
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    }
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
    if (got !== f.bytes) throw new Error(`got ${got} B, expected ${f.bytes} B (download cut short?)`);
    const digest = h.digest('hex');
    if (f.sha256 && digest !== f.sha256) throw new Error(`SHA-256 differs from the recorded value (${digest})`);
    fs.renameSync(part, target);
    return { state: 'fetched', target, sha256: digest };
  } catch (e) {
    out.destroy();
    fs.rmSync(part, { force: true });
    throw e;
  }
}

async function main() {
  const a = args(process.argv.slice(2));
  if (a.help) {
    console.log('usage: node fetch-gated.mjs [--root <library folder>] [--expected <file.json>]\n  Asks for a Hugging Face access key in a hidden prompt and downloads the gated files into <root>\\models\\gated.');
    return 0;
  }
  const root = a.root ?? (fs.existsSync('E:\\PULSEFRAME-Library') ? 'E:\\PULSEFRAME-Library' : null);
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw Object.assign(new Error('library folder not found; give it with --root'), { use: true });
  const list = JSON.parse(fs.readFileSync(a.expected, 'utf8').replace(/^\uFEFF/, ''));
  const gated = new Set(list.repos.filter((r) => r.gated === true).map((r) => r.repo));
  const files = list.files.filter((f) => gated.has(f.repo));
  if (!files.length) throw Object.assign(new Error('the list names no gated file'), { use: true });
  const total = files.reduce((n, f) => n + f.bytes, 0);
  console.log(`${files.length} files, ${(total / 2 ** 20).toFixed(1)} MiB, into ${path.join(root, 'models', 'gated')}`);

  let token = null;
  if (!a.anonymous) {
    console.log('Paste your Hugging Face access key (starts with hf_) and press Enter. Nothing will be shown while you paste.');
    token = (await readSecret('key: ')).trim();
    if (!/^hf_[A-Za-z0-9]{20,}$/.test(token)) throw Object.assign(new Error('that does not look like an access key (it starts with hf_ and has no spaces); nothing was sent'), { use: true });
  }

  const rows = []; let failed = 0; let stop = false;
  for (const f of files) {
    if (stop) { failed++; console.log(`SKIPPED ${f.dest}`); continue; }
    try {
      const r = await fetchOne(root, f, token);
      const digest = r.sha256 ?? await sha256Of(r.target);
      rows.push(`${digest}  ${String(f.bytes).padStart(12)}  ${f.dest}`);
      console.log(`${r.state === 'fetched' ? 'OK     ' : 'PRESENT'} ${f.dest}`);
    } catch (e) {
      failed++;
      console.log(`FAILED  ${f.dest}: ${e.message}`);
      if (e.code === 'KEY') stop = true; // a wrong key fails every file the same way
    }
  }
  token = null;
  if (rows.length) {
    const report = path.join(root, '_manifests', 'gated-hashes.txt');
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.writeFileSync(report, rows.join('\n') + '\n');
    console.log(`\nSHA-256, size, file (also saved to ${report}; not secret):`);
    for (const r of rows) console.log(r);
  }
  console.log(`\nSUMMARY: ${rows.length} of ${files.length} files in place, ${failed} failed.`);
  if (!a.anonymous) console.log(`You can now delete the access key: https://${HOST}/settings/tokens`);
  return failed ? 1 : 0;
}

main().then((code) => { process.exitCode = code; }, (e) => {
  console.error(`error: ${e.message}`);
  process.exitCode = e.use ? 2 : 1;
});
