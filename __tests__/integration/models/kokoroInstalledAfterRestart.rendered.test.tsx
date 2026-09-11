import type { PersistedModelDownload } from '@offgrid/models';
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';

const DOWNLOAD_JOURNAL_KEY = '@offgrid/model_downloads_v2';
const INSTALLATION_RECEIPT_KEY = '@offgrid/kokoro_installation_v1';
const MODEL_ID = 'software-mansion/executorch-kokoro';
const ARTIFACT_ID = `${MODEL_ID}:kokoro-medium`;

let fixture:
  | import('../../harness/mobileApplicationFixture').MobileApplicationFixture
  | undefined;

afterEach(async () => {
  await fixture?.dispose();
  fixture = undefined;
});

const finalizedKokoroDownload = (): PersistedModelDownload => ({
  manifest: {
    id: `download:${MODEL_ID}`,
    modelId: MODEL_ID,
    kind: 'voice',
    revision: 'main',
    artifacts: [
      {
        id: ARTIFACT_ID,
        name: 'kokoro-medium',
        localName: '.downloads/kokoro-medium',
        url: '',
        sizeBytes: 82 * 1024 * 1024,
        role: 'primary',
        required: true,
      },
    ],
    metadata: { catalogEntry: true },
  },
  // This is the state produced by the old startup bug: finalization is proven below, but the
  // missing transient flag made reconciliation downgrade the row after relaunch.
  phase: 'interrupted',
  artifacts: [
    {
      artifactId: ARTIFACT_ID,
      phase: 'completed',
      bytesDownloaded: 82 * 1024 * 1024,
      totalBytes: 82 * 1024 * 1024,
    },
  ],
  installedArtifacts: [
    {
      artifactId: ARTIFACT_ID,
      localName: 'managed-tts/kokoro-medium',
    },
  ],
  createdAt: 1,
  updatedAt: 2,
  attempt: 1,
});

async function startProApplication() {
  const { startMobileApplicationFixture } =
    require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  fixture = await startMobileApplicationFixture({ pro: true });
}

function openSpeechTab() {
  const React = require('react');
  const rtl = requireRTL();
  const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
  const ui = rtl.render(React.createElement(ModelsScreen));
  rtl.fireEvent.press(ui.getByText('Speech'));
  return { rtl, ui };
}

describe('Kokoro installed state after restart', () => {
  it('adopts the finalized download once and keeps the Speech tab installed on the next launch', async () => {
    installNativeBoundary({ fs: true });
    const AsyncStorage =
      require('@react-native-async-storage/async-storage').default ??
      require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await AsyncStorage.setItem(
      DOWNLOAD_JOURNAL_KEY,
      JSON.stringify([finalizedKokoroDownload()]),
    );

    await startProApplication();
    const first = openSpeechTab();
    await first.rtl.waitFor(() =>
      expect(first.ui.getByTestId('models-tts-language')).toBeTruthy(),
    );
    expect(first.ui.queryByText('Download voice')).toBeNull();
    expect(JSON.parse(await AsyncStorage.getItem(INSTALLATION_RECEIPT_KEY))).toEqual({
      version: 1,
      installed: true,
    });
    first.ui.unmount();
    await fixture?.dispose();
    fixture = undefined;

    // A new JavaScript process has no old TTS store or completed journal to consult. The one
    // durable receipt must still make the installed voice controls visible.
    await AsyncStorage.setItem(DOWNLOAD_JOURNAL_KEY, '[]');
    installNativeBoundary({ fs: true });
    await startProApplication();
    const second = openSpeechTab();
    await second.rtl.waitFor(() =>
      expect(second.ui.getByTestId('models-tts-language')).toBeTruthy(),
    );
    expect(second.ui.queryByText('Download voice')).toBeNull();
    second.ui.unmount();
  });
});
