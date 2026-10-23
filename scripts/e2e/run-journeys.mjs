/**
 * Every single-phone journey, one after the other, into one evidence folder.
 *
 *   node scripts/e2e/run-journeys.mjs --platform ios|android|both [--only engine-smoke,mic-permission]
 *
 * Extra flags pass through to every journey (e.g. --expect-image "receipt"). Sequential on purpose:
 * two journeys on one phone fight over the same screen. run-flows.mjs is the MESH runner (two
 * surfaces per route); these journeys drive one phone each, so they get their own runner.
 */
import { spawnSync } from 'node:child_process';
import { flag } from './device-journey.mjs';

const JOURNEYS = ['engine-smoke', 'mic-permission', 'download-a11y', 'branch-fixes', 'crash-smoke'];
const only = flag('only')?.split(',');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const passThrough = process.argv.slice(2).filter((arg, i, all) => arg !== '--only' && all[i - 1] !== '--only');

const results = [];
for (const journey of JOURNEYS.filter((j) => !only || only.includes(j))) {
  const run = spawnSync('node', [`scripts/e2e/${journey}-journey.mjs`, ...passThrough, '--stamp', stamp], {
    stdio: 'inherit',
  });
  results.push({ journey, ok: run.status === 0 });
}
console.log('\n=== journeys ===');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.journey}`);
console.log(`evidence in .artifacts/device-e2e/${stamp}/`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
