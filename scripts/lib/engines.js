'use strict';
// The native inference engines the app ships, and the rule that decides whether a newer upstream
// release may replace the pinned one. Used by scripts/update-engines.js (the daily engine PR) and
// scripts/uat.sh (a beta warns when a newer engine exists). Plain CommonJS so node runs it
// directly; typed via engines.d.ts so the jest test and `tsc --noEmit` resolve it.
//
// iOS cannot load downloaded native code (App Store guideline 2.5.2), so there a new engine reaches
// people only in an app release (nightly + TestFlight). Android also takes signed llama.cpp engine
// packs over the air (src/services/enginePacks); the bundled engine is still its fallback. Keeping
// the pins at the newest release is how every build ships the newest engine.

const semver = require('semver');

/** Every native engine in the app, and where its version is pinned. */
const ENGINES = [
  // The app imports llama.cpp as `llama.rn`. Once package.json aliases it to our fork
  // (`"llama.rn": "npm:@ogai/llama.rn@…"`), the check follows the alias (npmPackage).
  { id: 'llama.rn', what: 'chat models (llama.cpp)', source: 'npm', pkg: 'llama.rn' },
  { id: 'whisper.rn', what: 'speech to text (whisper.cpp)', source: 'npm', pkg: 'whisper.rn' },
  {
    id: 'react-native-executorch',
    what: 'Kokoro voice (ExecuTorch)',
    source: 'npm',
    pkg: 'react-native-executorch',
    // Released in step with the engine; moves with it.
    with: ['react-native-executorch-bare-resource-fetcher'],
  },
  {
    id: 'litertlm-android',
    what: 'LiteRT-LM models on Android',
    source: 'maven',
    group: 'com.google.ai.edge.litertlm',
    artifact: 'litertlm-android',
    file: 'android/app/build.gradle',
  },
  {
    id: 'stable-diffusion.cpp',
    what: 'video (stable-diffusion.cpp, built from source with local patches)',
    source: 'github',
    repo: 'leejet/stable-diffusion.cpp',
    file: 'scripts/video/revision',
  },
];

const PREFIX = /^([\^~]?)(.+)$/;
const ALIAS = /^(npm:(?:@[^/@]+\/)?[^@]+@)(.*)$/;

/** An npm alias spec split into its "npm:<name>@" head and its version spec. */
function splitAlias(spec) {
  const m = ALIAS.exec(String(spec || '').trim());
  return m ? { head: m[1], version: m[2] } : { head: '', version: String(spec || '').trim() };
}

/** The package a dependency spec installs: an alias's target ("npm:@x/y@1" → "@x/y"), else `pkg`. */
function npmPackage(spec, pkg) {
  const { head } = splitAlias(spec);
  return head ? head.slice('npm:'.length, -1) : pkg;
}

/** The version a dependency spec pins ("^0.7.4" or "npm:@x/y@0.7.4" → "0.7.4"), or null for a range or a path. */
function pinnedVersion(spec) {
  const m = PREFIX.exec(splitAlias(spec).version);
  return m && semver.valid(m[2]) ? m[2] : null;
}

/** The spec for a new version, keeping the old spec's alias and its ^ or ~ (or exact pin). */
function specFor(oldSpec, version) {
  const { head, version: old } = splitAlias(oldSpec);
  const m = PREFIX.exec(old);
  return `${head}${m ? m[1] : ''}${version}`;
}

/**
 * The peer dependencies of a release that the app does not meet. `installed` maps a package name
 * to the version the app has (absent when the app does not have it). Optional peers the app does
 * not have are fine.
 */
function unmetPeers(peerDependencies, peerDependenciesMeta, installed) {
  return Object.entries(peerDependencies || {}).flatMap(([name, range]) => {
    const have = installed[name];
    if (!have) {
      return peerDependenciesMeta?.[name]?.optional ? [] : [{ name, range, have: null }];
    }
    return semver.satisfies(have, range, { includePrerelease: true }) ? [] : [{ name, range, have }];
  });
}

/** What unblocks a held engine; the daily job then bumps it by itself. */
const THEN = 'The next daily run then moves it.';

/**
 * Whether the newest release replaces the pinned one:
 *   current — the pin is already the newest release (or newer)
 *   bump    — the newest release installs as is
 *   held    — the newest release needs peers the app does not meet, or the pinned version
 *             carries a local fix (a patch-package patch) that a new version would drop;
 *             `reason` says which, `next` what unblocks it
 */
function decide({ current, latest, peerDependencies, peerDependenciesMeta, installed, patch }) {
  if (!latest || !semver.valid(latest) || (current && !semver.gt(latest, current))) {
    return { status: 'current' };
  }
  if (patch) {
    return {
      status: 'held',
      to: latest,
      reason: `carries a local fix (${patch}); port the fix or drop the patch first`,
      next: `Port ${patch} to ${latest}, or drop it if ${latest} has the fix. ${THEN}`,
    };
  }
  const unmet = unmetPeers(peerDependencies, peerDependenciesMeta, installed || {});
  if (unmet.length > 0) {
    const reason = unmet
      .map(p => `${p.name} ${p.range} (the app has ${p.have ?? 'none'})`)
      .join(', ');
    const moves = unmet.map(p => `${p.name} to ${p.range}`).join(', ');
    return { status: 'held', to: latest, reason: `needs ${reason}`, next: `Move ${moves} in its own PR. ${THEN}` };
  }
  return { status: 'bump', to: latest };
}

/**
 * When an engine's hold began: the publish time of the oldest stable release newer than the pin
 * (npm's `time` map), so a hold that outlives several releases keeps its first date. Null when
 * none is newer.
 */
function heldSince(times, current) {
  const newer = Object.entries(times || {})
    .filter(([v]) => semver.valid(v) && !semver.prerelease(v) && (!current || semver.gt(v, current)))
    .map(([, at]) => at)
    .sort();
  return newer[0] ?? null;
}

/** Days a hold may last before it gets an issue of its own. */
const HELD_ISSUE_DAYS = 3;

/** The issue title for a held engine: one issue per engine, found again by this title. */
function heldIssueTitle(id) {
  return `Engine held: ${id}`;
}

/** The issue for a held engine whose hold is older than HELD_ISSUE_DAYS, or null. */
function heldIssue(result, now) {
  if (result.status !== 'held' || !result.since) return null;
  const days = Math.floor((now - Date.parse(result.since)) / 86_400_000);
  if (Number.isNaN(days) || days <= HELD_ISSUE_DAYS) return null;
  return {
    title: heldIssueTitle(result.id),
    body: [
      `**${result.id}** (${result.what}) is on ${result.from}. ${result.to} has been out since ${result.since.slice(0, 10)} (${days} days) and cannot install as is.`,
      '',
      `**Blocker:** ${result.reason}`,
      '',
      `**Next step:** ${result.next}`,
      '',
      'The daily Engine updates workflow keeps this issue current and closes it once the engine moves.',
    ].join('\n'),
  };
}

/** The patch-package file name for a package at a version ("@scope/name" → "@scope+name+1.2.3.patch"). */
function patchFileName(pkg, version) {
  return `${pkg.replace('/', '+')}+${version}.patch`;
}

/**
 * A pinned commit against the repo's newest release, by GitHub's compare status: 'ahead' means the
 * release has commits the pin does not. The local patches are re-applied by the build, so CI says
 * whether they still fit.
 */
function githubDecision({ current, latest, status }) {
  if (!latest || !current || latest === current || status !== 'ahead') return { status: 'current' };
  return { status: 'bump', to: latest };
}

/** The newest release in a Maven metadata file (its <release>, else its <latest>). */
function mavenRelease(metadataXml) {
  const m = /<release>([^<]+)<\/release>/.exec(metadataXml) || /<latest>([^<]+)<\/latest>/.exec(metadataXml);
  return m ? m[1].trim() : null;
}

/** The version a Gradle file pins for group:artifact, or null when it does not pin one. */
function gradlePin(gradle, group, artifact) {
  const m = new RegExp(`["']${escape(group)}:${escape(artifact)}:([^"']+)["']`).exec(gradle);
  return m ? m[1] : null;
}

/** The Gradle file with group:artifact moved to `version`. */
function setGradlePin(gradle, group, artifact, version) {
  return gradle.replace(
    new RegExp(`(["']${escape(group)}:${escape(artifact)}:)[^"']+(["'])`),
    `$1${version}$2`,
  );
}

/** A Markdown summary of one run: what moved, and what was held and why. */
function summaryMarkdown(results) {
  const moved = results.filter(r => r.status === 'bump');
  const held = results.filter(r => r.status === 'held');
  const lines = [];
  if (moved.length > 0) {
    lines.push('## Updated', '', '| Engine | Used for | From | To |', '|---|---|---|---|');
    for (const r of moved) lines.push(`| ${r.id} | ${r.what} | ${r.from} | **${r.to}** |`);
    lines.push('');
  }
  if (held.length > 0) {
    lines.push('## Held', '', 'A newer release exists but cannot install as is. It needs its own upgrade.', '');
    for (const r of held) {
      const since = r.since ? ` Held since ${r.since.slice(0, 10)}.` : '';
      lines.push(`- **${r.id}** ${r.from} → ${r.to}: ${r.reason}.${since} Next: ${r.next}`);
    }
    lines.push('');
  }
  if (lines.length === 0) lines.push('Every engine is on its newest release.');
  return lines.join('\n');
}

/** The branch the daily job pushes its bump to, and the identity its commits carry. */
const BUMP_BRANCH = 'chore/engine-updates';
const BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';

/** Check results that count as passed. */
const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

/**
 * The CI jobs (.github/workflows/ci.yml) that build each video runtime from source. CI runs them
 * only when the PR changes a file videoRuntimeMoved matches; a bump that moves stable-diffusion.cpp
 * merges only once both built, never on a skip.
 */
const VIDEO_RUNTIME_CHECKS = ['video runtime (Android)', 'video runtime (iOS)'];

/** Whether a changed file (repository path) is an input of the video runtime builds. Same paths as ci.yml's changes job. */
function videoRuntimeMoved(path) {
  return path.startsWith('scripts/video/') || path === 'scripts/prepare-video-runtime.sh' || path === 'scripts/build-video-ios.sh';
}

/**
 * Whether the daily engine PR may merge (`gh pr view --json …`) after CI on `sha` ended:
 *   merge  — the bot's own bump into main, every check on `sha` passed
 *   skip   — not now (closed, a newer commit, or a check not green); a later CI run decides
 *   refuse — not a PR this job may merge (another branch or author, or it moves pro), or it moves
 *            the video runtime and a runtime build was skipped, missing or failed
 * A PR that lists held engines still merges the engines that moved.
 */
function bumpMergeDecision(pr, sha) {
  if (pr.headRefName !== BUMP_BRANCH || pr.baseRefName !== 'main' || pr.isCrossRepository) {
    return { action: 'refuse', reason: `${pr.headRefName} → ${pr.baseRefName} is not the engine bump PR` };
  }
  const strangers = pr.commits.flatMap(c => c.authors).filter(a => a.email !== BOT_EMAIL);
  if (strangers.length > 0) {
    return { action: 'refuse', reason: `has commits by ${strangers.map(a => a.login || a.email).join(', ')}; a person merges it` };
  }
  // The job never moves pro. A bump that does needs mobile-pro merged first, so a person merges it.
  if (pr.files.some(f => f.path === 'pro' || f.path.startsWith('pro/'))) {
    return { action: 'refuse', reason: 'moves the pro submodule; merge mobile-pro first, then this, by hand' };
  }
  if (pr.state !== 'OPEN') return { action: 'skip', reason: `is ${pr.state.toLowerCase()}` };
  if (pr.headRefOid !== sha) return { action: 'skip', reason: 'has a newer commit; its own CI run decides' };
  const checks = pr.statusCheckRollup.map(c => ({ name: c.name || c.context, result: c.conclusion || c.state }));
  const notGreen = checks.filter(c => !PASSED.has(c.result));
  if (checks.length === 0) return { action: 'skip', reason: 'no checks ran' };
  if (pr.files.some(f => videoRuntimeMoved(f.path))) {
    const unbuilt = VIDEO_RUNTIME_CHECKS.flatMap(name => {
      const runs = checks.filter(c => c.name === name);
      if (runs.length === 0) return [`${name} did not run`];
      return runs.filter(c => c.result && c.result !== 'SUCCESS').map(c => `${name} ${c.result}`);
    });
    if (unbuilt.length > 0) {
      return { action: 'refuse', reason: `moves the video runtime, but it did not build: ${unbuilt.join(', ')}` };
    }
  }
  if (notGreen.length > 0) {
    const listed = notGreen.map(c => `${c.name} ${c.result ?? 'running'}`).join(', ');
    return { action: 'skip', reason: `checks not green: ${listed}` };
  }
  return { action: 'merge' };
}

/** Workflows that build or upload a mobile release: nothing merges to main while one runs. */
const RELEASE_WORKFLOWS = ['uat-dev.yml', 'release.yml', 'release-ios.yml'];

/** The runs (`gh run list --json …`) that have not finished. */
function unfinishedRuns(runs) {
  return runs.filter(r => r.status !== 'completed');
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  ENGINES,
  npmPackage,
  pinnedVersion,
  specFor,
  unmetPeers,
  decide,
  patchFileName,
  mavenRelease,
  gradlePin,
  setGradlePin,
  summaryMarkdown,
  githubDecision,
  heldSince,
  heldIssue,
  heldIssueTitle,
  HELD_ISSUE_DAYS,
  BUMP_BRANCH,
  BOT_EMAIL,
  bumpMergeDecision,
  VIDEO_RUNTIME_CHECKS,
  videoRuntimeMoved,
  RELEASE_WORKFLOWS,
  unfinishedRuns,
};
