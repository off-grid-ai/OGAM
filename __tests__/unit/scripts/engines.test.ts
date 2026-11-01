/**
 * The rule behind the daily engine PR and the beta's engine warning: a newer engine release
 * replaces the pinned one only when it installs as is, and is held, with the reason, when it needs
 * peer dependencies the app does not meet (ExecuTorch 0.10 needing react-native-worklets 0.10 is
 * the case that made this rule).
 */
import {
  ENGINES,
  decide,
  githubDecision,
  BOT_EMAIL,
  bumpMergeDecision,
  gradlePin,
  heldIssue,
  npmPackage,
  heldSince,
  mavenRelease,
  patchFileName,
  pinnedVersion,
  setGradlePin,
  specFor,
  summaryMarkdown,
  unfinishedRuns,
  unmetPeers,
} from '../../../scripts/lib/engines';

describe('the engines the app ships', () => {
  it('lists every native inference engine once', () => {
    expect(ENGINES.map(e => e.id)).toEqual(['llama.rn', 'whisper.rn', 'react-native-executorch', 'litertlm-android', 'stable-diffusion.cpp']);
  });
});

describe('githubDecision', () => {
  it('moves a pinned commit to the newest release when the release is ahead of it', () => {
    expect(githubDecision({ current: 'aaa', latest: 'bbb', status: 'ahead' })).toEqual({ status: 'bump', to: 'bbb' });
  });
  it.each([
    ['identical', 'bbb'],
    ['behind', 'bbb'],
    ['diverged', 'bbb'],
    ['ahead', null],
  ])('stays when the compare says %p', (status, latest) => {
    expect(githubDecision({ current: 'aaa', latest, status })).toEqual({ status: 'current' });
  });
});

describe('pinnedVersion and specFor', () => {
  it.each([
    ['0.13.0-rc.7', '0.13.0-rc.7'],
    ['^0.7.4', '0.7.4'],
    ['~1.2.3', '1.2.3'],
    ['npm:@ogai/llama.rn@0.14.0', '0.14.0'],
    ['npm:@ogai/llama.rn@^0.14.0-rc.1', '0.14.0-rc.1'],
  ])('%p pins %p', (spec, version) => {
    expect(pinnedVersion(spec)).toBe(version);
  });

  it.each(['*', 'file:../shared/packages/models', '>=1.0.0', 'npm:@ogai/llama.rn@latest', '', undefined])('%p pins no version', spec => {
    expect(pinnedVersion(spec)).toBeNull();
  });

  it('keeps the caret, the tilde or the exact pin', () => {
    expect(specFor('^0.7.4', '0.8.0')).toBe('^0.8.0');
    expect(specFor('~0.7.4', '0.7.5')).toBe('~0.7.5');
    expect(specFor('0.13.0-rc.7', '0.13.0')).toBe('0.13.0');
    // A dependency with no spec yet takes the version exactly.
    expect(specFor('', '0.13.0')).toBe('0.13.0');
  });

  it('keeps an npm alias, so the app still imports llama.rn', () => {
    expect(specFor('npm:@ogai/llama.rn@0.14.0', '0.15.0')).toBe('npm:@ogai/llama.rn@0.15.0');
    expect(specFor('npm:@ogai/llama.rn@^0.14.0', '0.15.0')).toBe('npm:@ogai/llama.rn@^0.15.0');
  });

  it('checks the package the app installs: upstream llama.rn today, the fork once aliased', () => {
    const llama = ENGINES.find(e => e.id === 'llama.rn');
    expect(npmPackage('0.13.0-rc.9', llama!.pkg!)).toBe('llama.rn');
    expect(npmPackage('npm:@ogai/llama.rn@0.14.0', llama!.pkg!)).toBe('@ogai/llama.rn');
    expect(npmPackage('npm:llama.rn@0.14.0', 'x')).toBe('llama.rn');
  });
});

describe('decide', () => {
  it('leaves an engine that is already on the newest release', () => {
    expect(decide({ current: '0.13.0-rc.7', latest: '0.13.0-rc.7' })).toEqual({ status: 'current' });
    // A dist-tag that points backwards (an older "latest") never downgrades the pin.
    expect(decide({ current: '0.9.3', latest: '0.9.1' })).toEqual({ status: 'current' });
    expect(decide({ current: '0.9.3', latest: null })).toEqual({ status: 'current' });
  });

  it('moves an engine whose newest release installs as is', () => {
    expect(
      decide({
        current: '0.5.5',
        latest: '0.7.4',
        peerDependencies: { react: '*', 'react-native': '*' },
        installed: { react: '19.2.0', 'react-native': '0.83.1' },
      }),
    ).toEqual({ status: 'bump', to: '0.7.4' });
    // From a release candidate to the release.
    expect(decide({ current: '0.13.0-rc.7', latest: '0.13.0' })).toEqual({ status: 'bump', to: '0.13.0' });
  });

  it('holds a release that needs a newer peer or one the app lacks, and names them', () => {
    const decision = decide({
      current: '0.9.3',
      latest: '0.10.6',
      peerDependencies: {
        'react-native-worklets': '>=0.10.0 <0.14.0',
        'react-native-blob-util': '>=0.24.11',
        '@kesha-antonov/react-native-background-downloader': '>=4.4.0',
      },
      installed: { 'react-native-worklets': '0.7.3', '@kesha-antonov/react-native-background-downloader': '4.5.6' },
    });
    expect(decision).toEqual({
      status: 'held',
      to: '0.10.6',
      reason:
        'needs react-native-worklets >=0.10.0 <0.14.0 (the app has 0.7.3), react-native-blob-util >=0.24.11 (the app has none)',
      next: 'Move react-native-worklets to >=0.10.0 <0.14.0, react-native-blob-util to >=0.24.11 in its own PR. The next daily run then moves it.',
    });
  });
});

describe('a pinned engine with a local fix', () => {
  // whisper.rn 0.5.5 carries Android crash fixes in patches/whisper.rn+0.5.5.patch, and 0.7.4
  // drops the file they patch and the transcribeRealtime API the app calls. Moving it would ship
  // the crash and break live transcription, so it is held until the fix is ported.
  it('is held while its patch exists, even when every peer is met', () => {
    expect(
      decide({ current: '0.5.5', latest: '0.7.4', patch: 'patches/whisper.rn+0.5.5.patch', peerDependencies: {}, installed: {} }),
    ).toEqual({
      status: 'held',
      to: '0.7.4',
      reason: 'carries a local fix (patches/whisper.rn+0.5.5.patch); port the fix or drop the patch first',
      next: 'Port patches/whisper.rn+0.5.5.patch to 0.7.4, or drop it if 0.7.4 has the fix. The next daily run then moves it.',
    });
  });

  it('is still current when no newer release exists', () => {
    expect(decide({ current: '0.5.5', latest: '0.5.5', patch: 'patches/whisper.rn+0.5.5.patch' })).toEqual({ status: 'current' });
  });

  it('names patch files the way patch-package does', () => {
    expect(patchFileName('whisper.rn', '0.5.5')).toBe('whisper.rn+0.5.5.patch');
    expect(patchFileName('@kesha-antonov/react-native-background-downloader', '4.5.6')).toBe(
      '@kesha-antonov+react-native-background-downloader+4.5.6.patch',
    );
  });
});

describe('unmetPeers', () => {
  it('accepts an optional peer the app does not have', () => {
    expect(unmetPeers({ expo: '*' }, { expo: { optional: true } }, {})).toEqual([]);
  });

  it('accepts a prerelease that satisfies the range', () => {
    expect(unmetPeers({ 'llama.rn': '>=0.13.0-rc.1' }, undefined, { 'llama.rn': '0.13.0-rc.7' })).toEqual([]);
  });
});

describe('Maven and Gradle', () => {
  const gradle = [
    '    // LiteRT-LM on-device LLM inference (pinned — do not use latest.release)',
    '    implementation("com.google.ai.edge.litertlm:litertlm-android:0.18.0")',
  ].join('\n');

  it('reads the newest release from Maven metadata', () => {
    expect(mavenRelease('<metadata><versioning><latest>0.19.0-rc1</latest><release>0.18.1</release></versioning></metadata>')).toBe('0.18.1');
    expect(mavenRelease('<metadata><versioning><latest>0.18.1</latest></versioning></metadata>')).toBe('0.18.1');
    expect(mavenRelease('<metadata/>')).toBeNull();
  });

  it('reads and moves the Gradle pin, and nothing else', () => {
    expect(gradlePin(gradle, 'com.google.ai.edge.litertlm', 'litertlm-android')).toBe('0.18.0');
    expect(gradlePin(gradle, 'com.google.ai.edge.litertlm', 'litertlm-jvm')).toBeNull();
    const moved = setGradlePin(gradle, 'com.google.ai.edge.litertlm', 'litertlm-android', '0.18.1');
    expect(moved).toContain('"com.google.ai.edge.litertlm:litertlm-android:0.18.1"');
    expect(moved.split('\n')[0]).toBe(gradle.split('\n')[0]);
  });
});

const executorchHeld = {
  id: 'react-native-executorch',
  what: 'Kokoro voice (ExecuTorch)',
  from: '0.9.3',
  status: 'held' as const,
  to: '0.10.6',
  reason: 'needs react-native-worklets >=0.10.0 (the app has 0.7.3)',
  next: 'Move react-native-worklets to >=0.10.0 in its own PR. The next daily run then moves it.',
  since: '2026-10-20T08:00:00.000Z',
};

describe('summaryMarkdown', () => {
  it('lists what moved, and each held engine with its blocker, since when, and the next step', () => {
    const md = summaryMarkdown([
      { id: 'whisper.rn', what: 'speech to text (whisper.cpp)', from: '0.5.5', status: 'bump', to: '0.7.4' },
      executorchHeld,
      { id: 'llama.rn', what: 'chat models (llama.cpp)', from: '0.13.0-rc.7', status: 'current' },
    ]);
    expect(md).toContain('| whisper.rn | speech to text (whisper.cpp) | 0.5.5 | **0.7.4** |');
    expect(md).toContain(
      '- **react-native-executorch** 0.9.3 → 0.10.6: needs react-native-worklets >=0.10.0 (the app has 0.7.3). Held since 2026-10-20. Next: Move react-native-worklets to >=0.10.0 in its own PR.',
    );
    expect(md).not.toContain('llama.rn');
  });

  it('still names a held engine whose start is unknown', () => {
    expect(summaryMarkdown([{ ...executorchHeld, since: null }])).toContain('(the app has 0.7.3). Next: Move');
  });

  it('says so when every engine is current', () => {
    expect(summaryMarkdown([{ id: 'llama.rn', what: 'chat', from: '1.0.0', status: 'current' }])).toBe(
      'Every engine is on its newest release.',
    );
  });
});

describe('heldSince', () => {
  const times = {
    created: '2024-01-01T00:00:00.000Z',
    '0.9.3': '2026-09-01T00:00:00.000Z',
    '0.10.0-rc.1': '2026-09-20T00:00:00.000Z',
    '0.10.0': '2026-10-01T00:00:00.000Z',
    '0.10.6': '2026-10-25T00:00:00.000Z',
  };

  it('dates a hold from the oldest stable release newer than the pin, so a new release does not reset it', () => {
    expect(heldSince(times, '0.9.3')).toBe('2026-10-01T00:00:00.000Z');
  });

  it('has no date when nothing newer is published, or npm gave no times', () => {
    expect(heldSince(times, '0.10.6')).toBeNull();
    expect(heldSince(undefined, '0.9.3')).toBeNull();
  });
});

describe('heldIssue', () => {
  const day = 86_400_000;
  const since = Date.parse(executorchHeld.since);

  it('opens no issue for a hold of 3 days or less', () => {
    expect(heldIssue(executorchHeld, since + 3 * day)).toBeNull();
  });

  it('opens one issue per engine after 3 days, naming the blocker and the next step', () => {
    const issue = heldIssue(executorchHeld, since + 4 * day);
    expect(issue?.title).toBe('Engine held: react-native-executorch');
    expect(issue?.body).toContain('0.10.6 has been out since 2026-10-20 (4 days)');
    expect(issue?.body).toContain('**Blocker:** needs react-native-worklets >=0.10.0 (the app has 0.7.3)');
    expect(issue?.body).toContain('**Next step:** Move react-native-worklets to >=0.10.0 in its own PR.');
  });

  it('opens none for an engine that is not held, or whose hold has no date', () => {
    expect(heldIssue({ id: 'whisper.rn', what: 'stt', from: '0.5.5', status: 'bump', to: '0.7.4' }, Date.now())).toBeNull();
    expect(heldIssue({ ...executorchHeld, since: null }, Date.now())).toBeNull();
  });
});

describe('bumpMergeDecision', () => {
  const sha = 'a'.repeat(40);
  const green = {
    state: 'OPEN',
    headRefName: 'chore/engine-updates',
    baseRefName: 'main',
    headRefOid: sha,
    isCrossRepository: false,
    commits: [{ authors: [{ login: 'github-actions[bot]', email: BOT_EMAIL }] }],
    files: [{ path: 'package.json' }, { path: 'ios/Podfile.lock' }],
    statusCheckRollup: [
      { name: 'ci', conclusion: 'SUCCESS' },
      { name: 'Copilot', conclusion: 'SKIPPED' },
      { context: 'SonarCloud', state: 'SUCCESS' },
    ],
  };

  it("merges the bot's own bump once every check on the tested commit passed", () => {
    expect(bumpMergeDecision(green, sha)).toEqual({ action: 'merge' });
  });

  it.each([
    ['another branch', { headRefName: 'feature/x' }, 'feature/x → main is not the engine bump PR'],
    ['another base', { baseRefName: 'release/x' }, 'chore/engine-updates → release/x is not the engine bump PR'],
    ['a fork', { isCrossRepository: true }, 'is not the engine bump PR'],
    ['a commit by a person', { commits: [{ authors: [{ login: 'ali', email: 'ali@example.com' }] }] }, 'has commits by ali; a person merges it'],
    ['an author with no login', { commits: [{ authors: [{ email: 'x@example.com' }] }] }, 'has commits by x@example.com'],
    ['a pro bump', { files: [{ path: 'pro' }] }, 'merge mobile-pro first'],
    ['a file under pro', { files: [{ path: 'pro/src/x.ts' }] }, 'merge mobile-pro first'],
  ])('refuses %s', (_label, over, reason) => {
    const verdict = bumpMergeDecision({ ...green, ...over }, sha);
    expect(verdict.action).toBe('refuse');
    expect(verdict.reason).toContain(reason);
  });

  it.each([
    ['a closed PR', { state: 'CLOSED' }, 'is closed'],
    ['a newer commit', { headRefOid: 'b'.repeat(40) }, 'has a newer commit'],
    ['no checks', { statusCheckRollup: [] }, 'no checks ran'],
    ['a failed check', { statusCheckRollup: [{ name: 'ci', conclusion: 'FAILURE' }] }, 'checks not green: ci FAILURE'],
    ['a running check', { statusCheckRollup: [{ name: 'ci', conclusion: null }] }, 'checks not green: ci running'],
  ])('waits on %s', (_label, over, reason) => {
    const verdict = bumpMergeDecision({ ...green, ...over }, sha);
    expect(verdict).toEqual({ action: 'skip', reason: expect.stringContaining(reason) });
  });
});

describe('unfinishedRuns', () => {
  it('keeps every run that has not completed', () => {
    const runs = [{ status: 'completed' }, { status: 'in_progress' }, { status: 'queued' }, { status: 'waiting' }];
    expect(unfinishedRuns(runs).map(r => r.status)).toEqual(['in_progress', 'queued', 'waiting']);
  });
});
