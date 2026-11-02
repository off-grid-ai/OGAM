#!/usr/bin/env node
'use strict';
// Merges the daily engine PR (chore/engine-updates) once CI on its head commit is green, with a
// merge commit, and never while a mobile nightly or store upload runs: it waits for those to end.
// Only the bot's own bump merges (scripts/lib/engines.js, bumpMergeDecision).
//
//   node scripts/merge-engine-pr.js <head sha CI just tested>
//
// Needs `gh` with GH_TOKEN allowed to merge: a PAT, so the push to main starts the workflows after
// it. Fails loudly on any gh error, on a PR it must not merge, and when a release run is still going
// at the deadline.

const { execFileSync } = require('child_process');
const engines = require('./lib/engines');

const WAIT_MS = 5 * 60_000;
const DEADLINE_MS = 5 * 60 * 60_000;

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

function readPr() {
  const fields = 'number,state,headRefName,baseRefName,headRefOid,isCrossRepository,commits,files,statusCheckRollup';
  return JSON.parse(gh(['pr', 'view', engines.BUMP_BRANCH, '--json', fields]));
}

function releaseRunsGoing() {
  return engines.RELEASE_WORKFLOWS.flatMap(workflow =>
    engines
      .unfinishedRuns(JSON.parse(gh(['run', 'list', '--workflow', workflow, '--limit', '20', '--json', 'status,url'])))
      .map(r => `${workflow} ${r.url}`),
  );
}

/** The PR when it may merge now, re-read each time: a push or a red check while waiting stops it. */
function mergeable(sha) {
  const pr = readPr();
  const verdict = engines.bumpMergeDecision(pr, sha);
  if (verdict.action === 'refuse') throw new Error(`Will not merge #${pr.number}: ${verdict.reason}`);
  if (verdict.action === 'skip') console.log(`Not merging #${pr.number}: ${verdict.reason}`);
  return verdict.action === 'merge' ? pr : null;
}

async function main() {
  const sha = process.argv[2];
  if (!sha) throw new Error('usage: merge-engine-pr.js <head sha>');
  if (!mergeable(sha)) return;

  const deadline = Date.now() + DEADLINE_MS;
  for (let going = releaseRunsGoing(); going.length > 0; going = releaseRunsGoing()) {
    if (Date.now() > deadline) throw new Error(`A release run is still going; merge by hand after it ends:\n  ${going.join('\n  ')}`);
    console.log(`Waiting for release runs to end:\n  ${going.join('\n  ')}`);
    await new Promise(resolve => setTimeout(resolve, WAIT_MS));
  }

  const pr = mergeable(sha);
  if (!pr) return;
  // --match-head-commit: GitHub refuses the merge if a commit arrived after the checks.
  gh(['pr', 'merge', String(pr.number), '--merge', '--match-head-commit', sha]);
  console.log(`Merged #${pr.number} (${sha.slice(0, 7)}) with a merge commit.`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
