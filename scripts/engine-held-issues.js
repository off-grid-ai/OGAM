#!/usr/bin/env node
'use strict';
// Keeps one GitHub issue per engine that has been held longer than HELD_ISSUE_DAYS
// (scripts/lib/engines.js): opens it, keeps its blocker and next step current, and closes it once
// the engine is on its newest release. Reads the report scripts/update-engines.js --json wrote.
//
//   node scripts/engine-held-issues.js <engines.json>
//
// Needs `gh` with GH_TOKEN (issues: write). Any gh failure fails the run.

const fs = require('fs');
const { execFileSync } = require('child_process');
const engines = require('./lib/engines');

function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'] });
}

function main() {
  const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const open = JSON.parse(
    gh(['issue', 'list', '--state', 'open', '--limit', '200', '--search', 'in:title "Engine held:"', '--json', 'number,title']),
  );
  const issueFor = id => open.find(i => i.title === engines.heldIssueTitle(id));

  for (const result of report.held) {
    const issue = engines.heldIssue(result, Date.now());
    if (!issue) continue;
    const existing = issueFor(result.id);
    if (existing) gh(['issue', 'edit', String(existing.number), '--body-file', '-'], issue.body);
    else gh(['issue', 'create', '--title', issue.title, '--body-file', '-'], issue.body);
    console.log(`${existing ? 'Updated' : 'Opened'}: ${issue.title}`);
  }

  for (const id of report.current) {
    const existing = issueFor(id);
    if (!existing) continue;
    gh(['issue', 'close', String(existing.number), '--comment', `${id} is on its newest release.`]);
    console.log(`Closed: ${existing.title}`);
  }
}

main();
