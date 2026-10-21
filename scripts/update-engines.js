#!/usr/bin/env node
'use strict';
// Moves the app's native engines (scripts/lib/engines.js) to their newest upstream releases.
// A release that needs peer dependencies the app does not meet, or that would drop a local
// patch-package fix, is held and reported, never half-installed.
//
//   node scripts/update-engines.js [--check] [--pods] [--summary <file.md>]
//
//   --check     report only; change nothing (scripts/uat.sh runs this before a beta)
//   --pods      after a bump, run `pod install` so ios/Podfile.lock matches
//   --summary   write a Markdown summary (the weekly PR's body)
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
  const spec = pkg.dependencies[engine.pkg];
  const current = engines.pinnedVersion(spec);
  const latest = npmView(engine.pkg, ['dist-tags.latest']);
  const release = latest ? npmView(`${engine.pkg}@${latest}`, ['peerDependencies', 'peerDependenciesMeta']) : {};
  const peers = release?.peerDependencies ?? {};
  const installed = Object.fromEntries(Object.keys(peers).map(name => [name, installedVersion(name, pkg)]));
  const patch = current ? path.join('patches', engines.patchFileName(engine.pkg, current)) : null;
  const decision = engines.decide({
    current,
    latest,
    patch: patch && fs.existsSync(path.join(ROOT, patch)) ? patch : null,
    peerDependencies: peers,
    peerDependenciesMeta: release?.peerDependenciesMeta,
    installed,
  });
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

function applyNpm(engine, to, pkg) {
  pkg.dependencies[engine.pkg] = engines.specFor(pkg.dependencies[engine.pkg], to);
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
  for (const engine of engines.ENGINES) {
    try {
      const { decision, from } = engine.source === 'npm' ? npmEngine(engine, pkg) : await mavenEngine(engine);
      results.push({ id: engine.id, what: engine.what, from, ...decision });
    } catch (error) {
      // A registry that does not answer leaves that engine where it is, and says so.
      results.push({ id: engine.id, what: engine.what, from: '?', status: 'held', to: '?', reason: `could not check: ${error.message}` });
    }
  }

  const bumps = results.filter(r => r.status === 'bump');
  if (!CHECK && bumps.length > 0) {
    for (const r of bumps) {
      const engine = engines.ENGINES.find(e => e.id === r.id);
      if (engine.source === 'npm') applyNpm(engine, r.to, pkg);
      else applyMaven(engine, r.to);
    }
    fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
    if (bumps.some(r => engines.ENGINES.find(e => e.id === r.id).source === 'npm')) {
      execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit' });
      if (PODS) {
        execFileSync('pod', ['install'], {
          cwd: path.join(ROOT, 'ios'),
          stdio: 'inherit',
          env: { ...process.env, LANG: 'en_US.UTF-8' },
        });
      }
    }
  }

  if (SUMMARY) fs.writeFileSync(SUMMARY, engines.summaryMarkdown(results));
  const pick = status => results.filter(r => r.status === status);
  console.log(JSON.stringify({ changed: pick('bump'), held: pick('held'), current: pick('current').map(r => r.id) }));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
