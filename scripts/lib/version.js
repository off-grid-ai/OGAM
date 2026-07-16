'use strict';
// Version-string math shared by scripts/uat.sh (cut a beta) and scripts/promote.sh
// (bless a beta cut to production). Plain CommonJS so bash can run it directly
//   node scripts/lib/version.js <command> <arg...>
// and typed via version.d.ts so the jest test + `tsc --noEmit` gate resolve it.
// One source of truth for what "0.0.103" means, so the cut and the promote can
// never disagree on the version they are shipping.

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const BETA_TAG = /^v(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$/;

/** Parse "MAJOR.MINOR.PATCH" → {major,minor,patch}. Throws on anything else. */
function parseVersion(version) {
  const m = SEMVER.exec(String(version).trim());
  if (!m) {
    throw new Error(
      `Invalid version "${version}" (expected MAJOR.MINOR.PATCH, e.g. 0.0.103)`,
    );
  }
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** The next patch version: "0.0.102" → "0.0.103". */
function nextPatch(version) {
  const { major, minor, patch } = parseVersion(version);
  return `${major}.${minor}.${patch + 1}`;
}

/** Parse a beta tag "v0.0.103-beta.1" → { version: "0.0.103", beta: 1 }. Throws otherwise. */
function parseBetaTag(tag) {
  const m = BETA_TAG.exec(String(tag).trim());
  if (!m) {
    throw new Error(
      `Invalid beta tag "${tag}" (expected vMAJOR.MINOR.PATCH-beta.N, e.g. v0.0.103-beta.1)`,
    );
  }
  return {
    version: `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}`,
    beta: Number(m[4]),
  };
}

/** The production version a beta tag promotes to: "v0.0.103-beta.1" → "0.0.103". */
function targetVersionFromBetaTag(tag) {
  return parseBetaTag(tag).version;
}

/** Build a beta tag from a target version + number: ("0.0.103", 1) → "v0.0.103-beta.1". */
function betaTag(targetVersion, n) {
  const { major, minor, patch } = parseVersion(targetVersion);
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1) {
    throw new Error(`Invalid beta number "${n}" (expected a positive integer)`);
  }
  return `v${major}.${minor}.${patch}-beta.${num}`;
}

// The store build id (Android versionCode / iOS CURRENT_PROJECT_VERSION) that a beta
// cut shipped is the SINGLE SOURCE OF TRUTH for what promote must ship. uat.sh embeds it
// in the beta git tag's annotation as a machine-parseable "Build: <n>" line; promote.sh
// reads it back so it can pin the EXACT tested build (not "latest processed"). Defining the
// line's format once here means the writer (uat) and the reader (promote) can never drift.
const BUILD_LINE = /(?:^|\n)Build:\s*(\d+)\s*(?:$|\n)/;

/** Validate + normalise a store build id to its canonical string. Throws on non-integers. */
function parseBuildNumber(build) {
  const num = Number(String(build).trim());
  if (!Number.isInteger(num) || num < 1) {
    throw new Error(
      `Invalid build number "${build}" (expected a positive integer, e.g. 1720000000)`,
    );
  }
  return String(num);
}

/** The line embedded in a beta tag annotation to carry the tested build id. */
function buildAnnotationLine(build) {
  return `Build: ${parseBuildNumber(build)}`;
}

/**
 * Recover the tested build id from a beta tag's annotation body. Returns the build id as a
 * string, or throws if no valid "Build: <n>" line is present (promote must FAIL FAST rather
 * than silently promote "latest processed" when the tested build id is unrecoverable).
 */
function buildNumberFromAnnotation(annotation) {
  const m = BUILD_LINE.exec(String(annotation));
  if (!m) {
    throw new Error(
      'No "Build: <n>" line in the tag annotation — cannot recover the tested build id. ' +
        'Re-cut the beta with a uat.sh that annotates the build id, or promote will not ' +
        'know which store build to pin.',
    );
  }
  return parseBuildNumber(m[1]);
}

module.exports = {
  parseVersion,
  nextPatch,
  parseBetaTag,
  targetVersionFromBetaTag,
  betaTag,
  parseBuildNumber,
  buildAnnotationLine,
  buildNumberFromAnnotation,
};

// CLI: `node scripts/lib/version.js <command> <arg...>` — used by the shell scripts.
if (require.main === module) {
  const [cmd, arg, arg2] = process.argv.slice(2);
  try {
    let out;
    switch (cmd) {
      case 'next-patch':
        out = nextPatch(arg);
        break;
      case 'target-from-beta':
        out = targetVersionFromBetaTag(arg);
        break;
      case 'beta-tag':
        out = betaTag(arg, arg2);
        break;
      case 'build-line':
        // Emit the "Build: <n>" line uat.sh appends to the beta tag annotation.
        out = buildAnnotationLine(arg);
        break;
      case 'build-from-annotation':
        // Recover the tested build id from a tag annotation body (passed on argv).
        out = buildNumberFromAnnotation(arg);
        break;
      default:
        throw new Error(
          `Unknown command "${cmd}". Use: next-patch <version> | target-from-beta <tag> | ` +
            'beta-tag <version> <n> | build-line <n> | build-from-annotation <annotation>',
        );
    }
    process.stdout.write(`${out}\n`);
  } catch (e) {
    process.stderr.write(`${e && e.message ? e.message : String(e)}\n`);
    process.exit(1);
  }
}
