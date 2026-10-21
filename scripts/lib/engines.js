'use strict';
// The native inference engines the app ships, and the rule that decides whether a newer upstream
// release may replace the pinned one. Used by scripts/update-engines.js (the weekly engine PR) and
// scripts/uat.sh (a beta warns when a newer engine exists). Plain CommonJS so node runs it
// directly; typed via engines.d.ts so the jest test and `tsc --noEmit` resolve it.
//
// A phone app cannot download new native code (App Store guideline 2.5.2, Google Play's policy on
// executable code), so a new engine reaches people only in an app release. Keeping the pins at the
// newest release is how every beta ships the newest engine.

const semver = require('semver');

/** Every native engine in the app, and where its version is pinned. */
const ENGINES = [
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
];

const PREFIX = /^([\^~]?)(.+)$/;

/** The version a dependency spec pins ("^0.7.4" → "0.7.4"), or null for a range or a path. */
function pinnedVersion(spec) {
  const m = PREFIX.exec(String(spec || '').trim());
  return m && semver.valid(m[2]) ? m[2] : null;
}

/** The spec for a new version, keeping the old spec's ^ or ~ (or exact pin). */
function specFor(oldSpec, version) {
  const m = PREFIX.exec(String(oldSpec || '').trim());
  return `${m ? m[1] : ''}${version}`;
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

/**
 * Whether the newest release replaces the pinned one:
 *   current — the pin is already the newest release (or newer)
 *   bump    — the newest release installs as is
 *   held    — the newest release needs peers the app does not meet, or the pinned version
 *             carries a local fix (a patch-package patch) that a new version would drop;
 *             `reason` says which
 */
function decide({ current, latest, peerDependencies, peerDependenciesMeta, installed, patch }) {
  if (!latest || !semver.valid(latest) || (current && !semver.gt(latest, current))) {
    return { status: 'current' };
  }
  if (patch) {
    return { status: 'held', to: latest, reason: `carries a local fix (${patch}); port the fix or drop the patch first` };
  }
  const unmet = unmetPeers(peerDependencies, peerDependenciesMeta, installed || {});
  if (unmet.length > 0) {
    const reason = unmet
      .map(p => `${p.name} ${p.range} (the app has ${p.have ?? 'none'})`)
      .join(', ');
    return { status: 'held', to: latest, reason: `needs ${reason}` };
  }
  return { status: 'bump', to: latest };
}

/** The patch-package file name for a package at a version ("@scope/name" → "@scope+name+1.2.3.patch"). */
function patchFileName(pkg, version) {
  return `${pkg.replace('/', '+')}+${version}.patch`;
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
    for (const r of held) lines.push(`- **${r.id}** ${r.from} → ${r.to}: ${r.reason}`);
    lines.push('');
  }
  if (lines.length === 0) lines.push('Every engine is on its newest release.');
  return lines.join('\n');
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  ENGINES,
  pinnedVersion,
  specFor,
  unmetPeers,
  decide,
  patchFileName,
  mavenRelease,
  gradlePin,
  setGradlePin,
  summaryMarkdown,
};
