/**
 * Version math shared by scripts/uat.sh (cut) and scripts/promote.sh (promote).
 * The whole point of the module is that the cut and the promote agree on what a
 * version/tag means, so every derivation + every rejection path is asserted here.
 */
import {
  parseVersion,
  nextPatch,
  parseBetaTag,
  targetVersionFromBetaTag,
  betaTag,
  parseBuildNumber,
  buildAnnotationLine,
  buildNumberFromAnnotation,
} from '../../../scripts/lib/version';

describe('parseVersion', () => {
  it('parses a semver into parts', () => {
    expect(parseVersion('0.0.103')).toEqual({ major: 0, minor: 0, patch: 103 });
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });
  it('trims surrounding whitespace', () => {
    expect(parseVersion('  0.0.103\n')).toEqual({
      major: 0,
      minor: 0,
      patch: 103,
    });
  });
  it.each(['0.0', 'v0.0.103', '0.0.103-beta.1', 'x.y.z', '', '1.2.3.4'])(
    'rejects malformed version %p',
    bad => {
      expect(() => parseVersion(bad as string)).toThrow(/Invalid version/);
    },
  );
});

describe('nextPatch', () => {
  it('increments only the patch', () => {
    expect(nextPatch('0.0.102')).toBe('0.0.103');
    expect(nextPatch('1.4.9')).toBe('1.4.10');
  });
  it('propagates a malformed input as an error', () => {
    expect(() => nextPatch('nope')).toThrow(/Invalid version/);
  });
});

describe('parseBetaTag', () => {
  it('splits a beta tag into version + beta number', () => {
    expect(parseBetaTag('v0.0.103-beta.1')).toEqual({
      version: '0.0.103',
      beta: 1,
    });
    expect(parseBetaTag('v2.5.0-beta.12')).toEqual({
      version: '2.5.0',
      beta: 12,
    });
  });
  it.each([
    'v0.0.103', // no beta suffix
    '0.0.103-beta.1', // missing leading v
    'v0.0.103-beta', // missing number
    'v0.0.103-rc.1', // wrong prerelease kind
    'v0.0.103-beta.0.1', // malformed number
    '',
  ])('rejects non-beta tag %p', bad => {
    expect(() => parseBetaTag(bad as string)).toThrow(/Invalid beta tag/);
  });
});

describe('targetVersionFromBetaTag', () => {
  it('strips the leading v and the -beta.N suffix (the promote derivation)', () => {
    expect(targetVersionFromBetaTag('v0.0.103-beta.1')).toBe('0.0.103');
    expect(targetVersionFromBetaTag('v0.0.103-beta.7')).toBe('0.0.103'); // beta number is irrelevant to the target
  });
  it('rejects a non-beta tag rather than guessing', () => {
    expect(() => targetVersionFromBetaTag('v0.0.103')).toThrow(
      /Invalid beta tag/,
    );
  });
});

describe('betaTag', () => {
  it('builds a beta tag from a version + number', () => {
    expect(betaTag('0.0.103', 1)).toBe('v0.0.103-beta.1');
    expect(betaTag('0.0.103', '2')).toBe('v0.0.103-beta.2'); // string n (from shell) accepted
  });
  it('round-trips with targetVersionFromBetaTag', () => {
    expect(targetVersionFromBetaTag(betaTag('0.0.103', 3))).toBe('0.0.103');
  });
  it.each([0, -1, 1.5, 'x'])('rejects invalid beta number %p', n => {
    expect(() => betaTag('0.0.103', n as number)).toThrow(
      /Invalid beta number/,
    );
  });
  it('rejects a malformed target version', () => {
    expect(() => betaTag('0.0', 1)).toThrow(/Invalid version/);
  });
});

// The store build id is the single source of truth threaded uat.sh → beta tag → promote.sh
// → fastlane. If the writer and the reader disagree on its format/validation, promote pins
// the wrong bytes — exactly the class of bug these helpers exist to prevent.
describe('parseBuildNumber', () => {
  it('normalises a positive integer to its canonical string', () => {
    expect(parseBuildNumber(1720000000)).toBe('1720000000');
    expect(parseBuildNumber('1720000000')).toBe('1720000000');
  });
  it('trims surrounding whitespace (shell may pass a trailing newline)', () => {
    expect(parseBuildNumber('  1720000000\n')).toBe('1720000000');
  });
  it.each([0, -1, 1.5, 'x', '', 'NaN'])(
    'rejects a non-positive-integer build id %p',
    bad => {
      expect(() => parseBuildNumber(bad as number)).toThrow(
        /Invalid build number/,
      );
    },
  );
});

describe('buildAnnotationLine', () => {
  it('formats the machine-parseable line uat.sh embeds in the beta tag', () => {
    expect(buildAnnotationLine(1720000000)).toBe('Build: 1720000000');
    expect(buildAnnotationLine('1720000000')).toBe('Build: 1720000000');
  });
  it('rejects an invalid build id rather than writing a bad line', () => {
    expect(() => buildAnnotationLine('nope')).toThrow(/Invalid build number/);
  });
});

describe('buildNumberFromAnnotation', () => {
  it('recovers the build id from a full tag annotation body', () => {
    const annotation = 'Off Grid 0.0.103-beta.1\n\nBuild: 1720000000\n';
    expect(buildNumberFromAnnotation(annotation)).toBe('1720000000');
  });
  it('recovers when the line is the only content', () => {
    expect(buildNumberFromAnnotation('Build: 42')).toBe('42');
  });
  it('round-trips with buildAnnotationLine (writer ↔ reader agree)', () => {
    const line = buildAnnotationLine(1720000000);
    expect(buildNumberFromAnnotation(`Off Grid 0.0.103-beta.1\n\n${line}\n`)).toBe(
      '1720000000',
    );
  });
  it.each([
    'Off Grid 0.0.103-beta.1', // no Build line at all
    'build: 1720000000', // wrong case
    'Build: notanumber', // non-numeric value
    '',
  ])('FAILS FAST when the build id is unrecoverable from %p', bad => {
    expect(() => buildNumberFromAnnotation(bad)).toThrow(
      /(No "Build: <n>" line|Invalid build number)/,
    );
  });
});
