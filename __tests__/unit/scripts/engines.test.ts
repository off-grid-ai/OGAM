/**
 * The rule behind the weekly engine PR and the beta's engine warning: a newer engine release
 * replaces the pinned one only when it installs as is, and is held, with the reason, when it needs
 * peer dependencies the app does not meet (ExecuTorch 0.10 needing react-native-worklets 0.10 is
 * the case that made this rule).
 */
import {
  ENGINES,
  decide,
  gradlePin,
  mavenRelease,
  patchFileName,
  pinnedVersion,
  setGradlePin,
  specFor,
  summaryMarkdown,
  unmetPeers,
} from '../../../scripts/lib/engines';

describe('the engines the app ships', () => {
  it('lists every native inference engine once', () => {
    expect(ENGINES.map(e => e.id)).toEqual(['llama.rn', 'whisper.rn', 'react-native-executorch', 'litertlm-android']);
  });
});

describe('pinnedVersion and specFor', () => {
  it.each([
    ['0.13.0-rc.7', '0.13.0-rc.7'],
    ['^0.7.4', '0.7.4'],
    ['~1.2.3', '1.2.3'],
  ])('%p pins %p', (spec, version) => {
    expect(pinnedVersion(spec)).toBe(version);
  });

  it.each(['*', 'file:../shared/packages/models', '>=1.0.0', '', undefined])('%p pins no version', spec => {
    expect(pinnedVersion(spec)).toBeNull();
  });

  it('keeps the caret, the tilde or the exact pin', () => {
    expect(specFor('^0.7.4', '0.8.0')).toBe('^0.8.0');
    expect(specFor('~0.7.4', '0.7.5')).toBe('~0.7.5');
    expect(specFor('0.13.0-rc.7', '0.13.0')).toBe('0.13.0');
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

describe('summaryMarkdown', () => {
  it('lists what moved and what was held, with the reason', () => {
    const md = summaryMarkdown([
      { id: 'whisper.rn', what: 'speech to text (whisper.cpp)', from: '0.5.5', status: 'bump', to: '0.7.4' },
      { id: 'react-native-executorch', what: 'Kokoro voice (ExecuTorch)', from: '0.9.3', status: 'held', to: '0.10.6', reason: 'needs react-native-worklets >=0.10.0' },
      { id: 'llama.rn', what: 'chat models (llama.cpp)', from: '0.13.0-rc.7', status: 'current' },
    ]);
    expect(md).toContain('| whisper.rn | speech to text (whisper.cpp) | 0.5.5 | **0.7.4** |');
    expect(md).toContain('- **react-native-executorch** 0.9.3 → 0.10.6: needs react-native-worklets >=0.10.0');
    expect(md).not.toContain('llama.rn');
  });

  it('says so when every engine is current', () => {
    expect(summaryMarkdown([{ id: 'llama.rn', what: 'chat', from: '1.0.0', status: 'current' }])).toBe(
      'Every engine is on its newest release.',
    );
  });
});
