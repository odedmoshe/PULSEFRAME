/**
 * Keyframe curves (ADR-0019), step 0: the bit-identity baseline of the v1 easings, which the new curves must not change.
 *
 *   pnpm baseline:keys            records docs/evidence/keys-baseline.json from this tree's sampler
 *   pnpm baseline:keys --check    samples again and fails (exit 1) on any difference (Object.is on the Float64 bits)
 *
 * What is sampled: keys-baseline.lib.ts (the five v1 easings × 2000 rational times, each sample as its IEEE-754 bits in hex,
 * so a difference of one ulp is a difference).
 * Pure: no server, no browser, no build. The lead runs it BEFORE W1 changes animation.ts (the contracts commit left the v1
 * branch byte-identical, so a run on that commit records the same numbers as one on the tree before it).
 */
import fs from 'node:fs';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { V1_EASINGS } from '@pulseframe/core';
import { keysBaseline, type KeysBaseline } from './keys-baseline.lib.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const evidence = path.join(root, 'docs/evidence/keys-baseline.json');
const CHECK = process.argv.includes('--check');
const record = keysBaseline();
if (record.count !== 2000) throw new Error(`expected 2000 times, made ${record.count}`);

if (!CHECK) {
  fs.mkdirSync(path.dirname(evidence), { recursive: true });
  fs.writeFileSync(evidence, `${JSON.stringify(record, null, 1)}\n`);
  console.log(`recorded ${V1_EASINGS.length} easings × ${record.count} times → ${path.relative(root, evidence)}`);
} else {
  const was = JSON.parse(fs.readFileSync(evidence, 'utf8')) as KeysBaseline;
  let diffs = 0;
  const first: string[] = [];
  for (const e of V1_EASINGS) for (let i = 0; i < record.count; i++) {
    const t = record.times[i]!;
    if (!was.times[i] || !T.eq(was.times[i]!, t) || was.samples[e]?.[i] !== record.samples[e][i]) { diffs++; if (first.length < 10) first.push(`${e} @ ${t.value}/${t.timescale}: ${was.samples[e]?.[i]} → ${record.samples[e][i]}`); }
  }
  console.log(JSON.stringify({ proof: 'keys-baseline --check', differences: diffs, first }, null, 2));
  process.exit(diffs ? 1 : 0);
}
