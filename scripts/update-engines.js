#!/usr/bin/env node
'use strict';
// Moves the app's native engines (scripts/lib/engines.js) to their newest upstream releases.
// A release that needs peer dependencies the app does not meet, or that would drop a local
// patch-package fix, is held and reported (with its blocker and next step), never half-installed.
// An engine that cannot be checked fails the run before anything changes.
//
//   node scripts/update-engines.js [--check] [--pods] [--summary <file.md>] [--json <file.json>]
//
//   --check     report only; change nothing (scripts/uat.sh runs this before a beta)
//   --pods      after a bump, run `pod install` so ios/Podfile.lock matches
//   --summary   write a Markdown summary (the daily PR's body)
//   --json      write the report to a file, only once every step has succeeded
//
// Prints one line of JSON: { "changed": [...], "held": [...], "current": [...] }.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const engines = require('./lib/engines');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const PODS = args.includes('--pods');
const summaryAt = args.indexOf('--summary');
const SUMMARY = summaryAt >= 0 ? args[summaryAt + 1] : null;
const jsonAt = args.indexOf('--json');
const JSON_OUT = jsonAt >= 0 ? args[jsonAt + 1] : null;

/** Writes a whole file or none: a reader never sees half of it. */
function writeWhole(file, text) {
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
}

function npmView(spec, fields) {
  const out = execFileSync('npm', ['view', spec, ...fields, '--json'], { cwd: ROOT, encoding: 'utf8' });
  return out.trim() ? JSON.parse(out) : undefined;
}

/** The version of a package the app has: the installed copy, else the version its spec pins. */
function installedVersion(name, pkg) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;
  } catch {
    const spec = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
    return engines.pinnedVersion(spec) ?? undefined;
  }
}

function npmEngine(engine, pkg) {
  const spec = pkg.dependencies[engine.dep ?? engine.pkg];
  const name = engines.npmPackage(spec, engine.pkg);
  const current = engines.pinnedVersion(spec);
  const latest = npmView(name, ['dist-tags.latest']);
  const release = latest ? npmView(`${name}@${latest}`, ['peerDependencies', 'peerDependenciesMeta']) : {};
  const peers = release?.peerDependencies ?? {};
  const installed = Object.fromEntries(Object.keys(peers).map(peer => [peer, installedVersion(peer, pkg)]));
  const patch = current ? path.join('patches', engines.patchFileName(engine.dep ?? engine.pkg, current)) : null;
  const decision = engines.decide({
    current,
    latest,
    patch: patch && fs.existsSync(path.join(ROOT, patch)) ? patch : null,
    peerDependencies: peers,
    peerDependenciesMeta: release?.peerDependenciesMeta,
    installed,
  });
  if (decision.status === 'held') decision.since = engines.heldSince(npmView(name, ['time']), current);
  return { decision, from: current ?? spec };
}

async function mavenEngine(engine) {
  const file = path.join(ROOT, engine.file);
  const current = engines.gradlePin(fs.readFileSync(file, 'utf8'), engine.group, engine.artifact);
  const url = `https://dl.google.com/android/maven2/${engine.group.replace(/\./g, '/')}/${engine.artifact}/maven-metadata.xml`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const latest = engines.mavenRelease(await res.text());
  return { decision: engines.decide({ current, latest }), from: current };
}

/** GitHub's API, with the workflow's token when there is one (the anonymous limit is 60 an hour). */
async function github(pathname) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com${pathname}`, { headers });
  if (!res.ok) throw new Error(`${pathname} answered ${res.status}`);
  return res.json();
}

/** A source build pinned to a commit: the repo's newest release, when it is ahead of the pin. */
async function githubEngine(engine) {
  const current = fs.readFileSync(path.join(ROOT, engine.file), 'utf8').trim();
  const release = await github(`/repos/${engine.repo}/releases/latest`);
  const latest = (await github(`/repos/${engine.repo}/commits/${encodeURIComponent(release.tag_name)}`)).sha;
  const { status } = await github(`/repos/${engine.repo}/compare/${current}...${latest}`);
  const decision = engines.githubDecision({ current, latest, status });
  return { decision: decision.status === 'bump' ? { ...decision, tag: release.tag_name } : decision, from: current.slice(0, 7) };
}

function applyGithub(engine, to) {
  fs.writeFileSync(path.join(ROOT, engine.file), `${to}\n`);
}

function applyNpm(engine, to, pkg) {
  const dep = engine.dep ?? engine.pkg;
  pkg.dependencies[dep] = engines.specFor(pkg.dependencies[dep], to);
  for (const companion of engine.with ?? []) {
    const latest = npmView(companion, ['dist-tags.latest']);
    if (latest && pkg.dependencies[companion]) {
      pkg.dependencies[companion] = engines.specFor(pkg.dependencies[companion], latest);
    }
  }
}

function applyMaven(engine, to) {
  const file = path.join(ROOT, engine.file);
  fs.writeFileSync(file, engines.setGradlePin(fs.readFileSync(file, 'utf8'), engine.group, engine.artifact, to));
}

async function main() {
  const pkgFile = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  const results = [];
  const failed = [];
  for (const engine of engines.ENGINES) {
    try {
      const { decision, from } =
        engine.source === 'npm' ? npmEngine(engine, pkg) : engine.source === 'github' ? await githubEngine(engine) : await mavenEngine(engine);
      results.push({ id: engine.id, what: engine.what, from, ...decision });
    } catch (error) {
      failed.push(`${engine.id}: ${error.message}`);
    }
  }
  // An engine nobody checked is neither current nor held: fail before anything changes.
  if (failed.length > 0) throw new Error(`Could not check every engine:\n  ${failed.join('\n  ')}`);

  // npm and CocoaPods log to stderr here: stdout carries only the one JSON line the workflow reads.
  const logToStderr = ['ignore', 2, 2];
  const bumps = results.filter(r => r.status === 'bump');
  if (!CHECK && bumps.length > 0) {
    for (const r of bumps) {
      const engine = engines.ENGINES.find(e => e.id === r.id);
      if (engine.source === 'npm') applyNpm(engine, r.to, pkg);
      else if (engine.source === 'github') applyGithub(engine, r.to);
      else applyMaven(engine, r.to);
    }
    fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
    if (bumps.some(r => engines.ENGINES.find(e => e.id === r.id).source === 'npm')) {
      execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: logToStderr });
      if (PODS) {
        execFileSync('pod', ['install'], {
          cwd: path.join(ROOT, 'ios'),
          stdio: logToStderr,
          env: { ...process.env, LANG: 'en_US.UTF-8' },
        });
      }
    }
  }

  if (SUMMARY) writeWhole(SUMMARY, engines.summaryMarkdown(results));
  const pick = status => results.filter(r => r.status === status);
  const report = JSON.stringify({ changed: pick('bump'), held: pick('held'), current: pick('current').map(r => r.id) });
  if (JSON_OUT) writeWhole(JSON_OUT, `${report}\n`);
  console.log(report);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
