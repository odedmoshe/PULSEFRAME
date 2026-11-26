/**
 * Lead wiring of the wave 8 qc track on the server: preflight carries core documentChecks (one line), the scope names the rules only
 * once they are built, MCP and OpenAPI describe the new codes and the `measured` numbers, and the list of preflight codes the sheet
 * must word in Hebrew (verifier C12) names only codes the server or core really emit. B1's server lines (the explanation pass on
 * every route, the WAV sound checks, the browser route's not-measured record) are the todo rows at the end.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, PREFLIGHT_SHOWN_CODES, QC_BUILT, QC_CODES, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { Exporter } from './export.ts';
import { preflight } from './preflight.ts';
import { buildOpenApi } from './openapi.ts';
import { Store } from './store.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: 'qcw_', actor: 'user:local' }).doc;
let dir: string, store: Store, exporter: Exporter;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-qcw-')); store = new Store(dir); exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist')); });
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('qc wiring (wave 8, lead pre-pass)', () => {
  it.runIf(!QC_BUILT)('preflight runs the document rules but, until they are built, lists none of their codes and its scope does not claim them', () => {
    const doc = tx(createProject({ id: 'prj_qcw', name: 'qc', frameRate: R }), [{ op: 'add_text', args: { text: 'כותרת', start: f(0), duration: f(2) } }]);
    const rep = preflight(exporter, doc, 1);
    expect(rep.issues.filter((i) => (QC_CODES as readonly string[]).includes(i.code))).toEqual([]);
    for (const c of QC_CODES) expect(rep.scope.includes(c), c).toBe(false);
  });
  it('the preflight source pushes documentChecks once, and the MCP description names every qc code', () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, 'preflight.ts'), 'utf8');
    expect(src.match(/issues\.push\(\.\.\.documentChecks\(doc\)\.issues\)/g)).toHaveLength(1);
    const mcp = fs.readFileSync(path.join(import.meta.dirname, 'mcp.ts'), 'utf8');
    const line = mcp.split('\n').find((l) => l.includes("registerTool('preflight'"))!;
    for (const c of QC_CODES) expect(line.includes(c), c).toBe(true);
  });
  it('OpenAPI documents an issue\'s range and measured numbers, and the loudness body\'s variantId (C15)', () => {
    const api = buildOpenApi() as any;
    const issue = api.paths['/api/v1/projects/{id}/preflight'].get.responses['200'].content['application/json'].schema.properties.issues.items;
    expect(Object.keys(issue.properties)).toEqual(expect.arrayContaining(['range', 'measured']));
    const loud = api.paths['/api/v1/projects/{id}/analysis/loudness'].post.requestBody.content['application/json'].schema;
    expect(Object.keys(loud.properties)).toEqual(expect.arrayContaining(['sequenceId', 'variantId', 'background']));
  });
  it('every preflight code the sheet must word (C12) is a code the server or core emits', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const files = [path.join(root, 'apps/server/src'), path.join(root, 'packages/core/src')].flatMap((d) => fs.readdirSync(d).filter((x) => x.endsWith('.ts') && !x.includes('.test.') && x !== 'qcContract.ts').map((x) => path.join(d, x)));
    const text = files.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
    const missing = PREFLIGHT_SHOWN_CODES.filter((c) => !(QC_CODES as readonly string[]).includes(c) && !text.includes(`'${c}'`));
    expect(missing).toEqual([]);
  });
  // B1 (qc-b1.md): the server lines
  it.todo('the export\'s checks go through explainFindings once, after assembleChecks; the fast export gives the same explained fields (Q13)');
  it.todo('the loudness route\'s soundChecks go through the same explainFindings, so proof:send K4 still holds byte for byte (C6)');
  it.todo('a WAV export stores checks with sound measured and picture not_measured with its reason (Q12)');
  it.todo('a browser-route export stores checks not_measured on both parts with the route\'s reason (Q12)');
});
