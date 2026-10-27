/**
 * Qwen3-ASR 0.6B as a speech-to-text model beside Whisper.
 *
 * From the person's side:
 *  - On a phone the memory guard admits, Models > Transcription lists Qwen3-ASR 0.6B. Downloading it
 *    fetches its weights and audio projector (checksummed) and makes it the speech model.
 *  - On a phone the guard refuses, it is not listed; the Whisper models still are.
 *  - With it selected, dictation in a chat puts what they said in the composer.
 *  - When Qwen3-ASR fails, the composer says so in one line, and a downloaded Whisper model
 *    transcribes the recording instead.
 *
 * Real TranscriptionModelsTab, ChatScreen, language select, stores, residency, download service and
 * transcription service. Fakes only at the device boundary: llama.rn (the Qwen3-ASR context), whisper.rn,
 * the recorder, the file system, the background downloader, the RAM sensor, and the engine's reported
 * llama.cpp build (llama.rn BuildInfo).
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

const CARD = 'transcription-model-card-qwen3-asr';
const WEIGHTS = 'Qwen3-ASR-0.6B-Q8_0.gguf';
const PROJECTOR = 'mmproj-Qwen3-ASR-0.6B-Q8_0.gguf';

/** The llama.cpp build this app ships, as llama.rn reports it about itself. */
function engineReportsShippedBuild() {
  const src: string = require('fs').readFileSync(require.resolve('llama.rn/src/version.ts'), 'utf8');
  const number = /BUILD_NUMBER = '(\d+)'/.exec(src)![1];
  require('llama.rn').BuildInfo = { number, commit: 'test' };
}

/** What the app does at launch: read the device once (the RAM it reads is the boundary's). */
async function launchReadsDevice() {
  const { hardwareService } = require('../../../src/services/hardware');
  await hardwareService.getDeviceInfo();
}

/** The catalog's Qwen3-ASR files, as the downloader is asked for them. */
function catalogFile(name: string): { sizeBytes: number; sha256: string } {
  const { CATALOG } = require('@offgrid/models');
  const entry = CATALOG.find((e: { id: string }) => e.id === 'ggml-org/Qwen3-ASR-0.6B-GGUF');
  return entry.files.find((f: { name: string }) => f.name === name);
}

describe('Qwen3-ASR on the Transcription tab', () => {
  it('is listed where the memory guard admits it, and downloads both files checksummed', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    engineReportsShippedBuild();
    await launchReadsDevice();
    const React = require('react');
    const { render, fireEvent, waitFor, act } = requireRTL();
    const { registerCoreDownloadProviders } = require('../../../src/services/modelDownloadService/registerProviders');
    const { TranscriptionModelsTab } = require('../../../src/screens/ModelsScreen/TranscriptionModelsTab');
    registerCoreDownloadProviders();

    const screen = render(React.createElement(TranscriptionModelsTab, { showRemoteModels: false }));
    expect(screen.getByText('Qwen3-ASR 0.6B')).toBeTruthy();
    expect(screen.getByTestId(`${CARD}-download`)).toBeTruthy();
    expect(screen.queryByTestId(`${CARD}-delete`)).toBeNull();

    fireEvent.press(screen.getByTestId(`${CARD}-download`));

    // The projector comes first, then the weights; each finishes on disk where the app reads it.
    const docs = boundary.fs!.DocumentDirectoryPath;
    for (const name of [PROJECTOR, WEIGHTS]) {
      const row = await waitFor(() => {
        const started = boundary.download!.active().filter((r: { fileName?: string }) => r.fileName === name);
        expect(started).toHaveLength(1);
        return started[0] as { downloadId: string; fileName: string; modelId: string; sha256?: string };
      });
      const file = catalogFile(name);
      expect(row.sha256).toBe(file.sha256);
      await act(async () => {
        boundary.fs!.seedFile(`${docs}/whisper-models/${name}`, file.sizeBytes);
        boundary.download!.events.emit('DownloadComplete', {
          downloadId: row.downloadId, fileName: name, modelId: row.modelId,
          bytesDownloaded: file.sizeBytes, totalBytes: file.sizeBytes, status: 'completed',
          localUri: `${docs}/whisper-models/${name}`,
        });
      });
    }

    // Downloaded and in use: the card offers removal, not download, and reads as the selected model.
    await waitFor(() => { expect(screen.getByTestId(`${CARD}-delete`)).toBeTruthy(); }, { timeout: 4000 });
    expect(screen.queryByTestId(`${CARD}-download`)).toBeNull();
    expect(screen.getByTestId(CARD).props.accessibilityState.selected).toBe(true);
  });

  it('is not listed on a phone whose memory the guard refuses', async () => {
    installNativeBoundary({ download: true, fs: true, ram: { platform: 'android', totalBytes: 1 * GB, availBytes: 0.5 * GB } });
    engineReportsShippedBuild();
    await launchReadsDevice();
    const React = require('react');
    const { render } = requireRTL();
    const { TranscriptionModelsTab } = require('../../../src/screens/ModelsScreen/TranscriptionModelsTab');

    const screen = render(React.createElement(TranscriptionModelsTab, { showRemoteModels: false }));
    expect(screen.getByTestId('transcription-model-card-0')).toBeTruthy();
    expect(screen.queryByText('Qwen3-ASR 0.6B')).toBeNull();
    expect(screen.queryByTestId(CARD)).toBeNull();
  });
});

type Harness = Awaited<ReturnType<typeof setupChatScreen>>;

/** The person has Qwen3-ASR on disk (a finished download) and picks it on the Transcription tab. */
async function selectQwenAsr(h: Harness, opts: { whisperToo?: boolean } = {}) {
  const React = require('react');
  const { TranscriptionModelsTab } = require('../../../src/screens/ModelsScreen/TranscriptionModelsTab');
  const docs = h.boundary.fs!.DocumentDirectoryPath;
  for (const name of [WEIGHTS, PROJECTOR]) {
    h.boundary.fs!.seedFile(`${docs}/whisper-models/${name}`, catalogFile(name).sizeBytes);
  }
  if (opts.whisperToo) h.boundary.fs!.seedFile(`${docs}/whisper-models/ggml-tiny.en.bin`, 75 * 1024 * 1024);
  const tab = h.rtl.render(React.createElement(TranscriptionModelsTab, { showRemoteModels: false }));
  const card = await h.rtl.waitFor(() => {
    expect(tab.getByTestId(`${CARD}-delete`)).toBeTruthy();
    return tab.getByTestId(CARD);
  }, { timeout: 4000 });
  expect(card.props.accessibilityState.selected).toBe(false);
  h.rtl.fireEvent.press(card);
  await h.rtl.waitFor(() => {
    expect(tab.getByTestId(CARD).props.accessibilityState.selected).toBe(true);
  }, { timeout: 4000 });
  tab.unmount();
}

/** Pick the transcription language the way the chat settings offer it. */
async function chooseLanguage(h: Harness, code: string) {
  const React = require('react');
  const { TranscriptionLanguageSelect } = require('../../../src/components/TranscriptionLanguageSelect');
  const select = h.rtl.render(React.createElement(TranscriptionLanguageSelect));
  h.rtl.fireEvent.press(select.getByTestId('transcription-language-select'));
  h.rtl.fireEvent.press(await h.rtl.waitFor(() => select.getByTestId(`transcription-language-select-${code}`)));
  select.unmount();
}

/** Hold the mic, speak, let go: one chat-mode dictation. */
async function dictate(h: Harness) {
  await h.tapMic();
  await h.settle(300);
  await h.releaseMic();
  await h.settle(1200);
}

describe('dictation with Qwen3-ASR selected', () => {
  it.each([
    // A pinned language prefills `language English<asr_text>`, so the model writes only the words.
    { language: 'en', modelSays: 'hello world' },
    // Auto-detect: the model names the language, then the words.
    { language: 'auto', modelSays: 'language English<asr_text>hello world' },
  ])('puts what was said in the composer (language $language)', async ({ language, modelSays }) => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android', whisper: true, llamaAudio: true });
    engineReportsShippedBuild();
    await selectQwenAsr(h);
    await chooseLanguage(h, language);
    h.render();
    const view = h.view!;
    const input = await h.rtl.waitFor(() => view.getByTestId('chat-input'));
    expect(input.props.value ?? '').toBe('');

    h.boundary.llama!.scriptCompletion({ text: modelSays });
    await dictate(h);

    await h.rtl.waitFor(() => {
      expect(view.getByTestId('chat-input').props.value ?? '').toBe('hello world');
    }, { timeout: 4000 });
    expect(view.queryByTestId('transcription-notice')).toBeNull();
  });

  it('says so in one line and lets Whisper transcribe when Qwen3-ASR fails', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android', whisper: true, llamaAudio: true });
    engineReportsShippedBuild();
    await selectQwenAsr(h, { whisperToo: true });
    h.render();
    const view = h.view!;
    expect(view.queryByTestId('transcription-notice')).toBeNull();

    h.boundary.llama!.scriptCompletion({ throwMessage: 'Failed to evaluate audio chunk' });
    h.boundary.whisper!.setFileTranscript('take a note');
    await dictate(h);

    await h.rtl.waitFor(() => {
      expect(view.getByTestId('chat-input').props.value ?? '').toBe('take a note');
    }, { timeout: 4000 });
    expect(view.getByTestId('transcription-notice').props.children).toBe(
      "Qwen3-ASR couldn't transcribe that, so Whisper did.",
    );
  });

  it('says so in one line when Qwen3-ASR fails and no Whisper model is there', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android', whisper: true, llamaAudio: true });
    engineReportsShippedBuild();
    await selectQwenAsr(h);
    h.render();
    const view = h.view!;
    expect(view.queryByTestId('transcription-notice')).toBeNull();

    h.boundary.llama!.scriptCompletion({ throwMessage: 'Failed to evaluate audio chunk' });
    await dictate(h);

    await h.rtl.waitFor(() => {
      expect(view.getByText(/Qwen3-ASR couldn't transcribe that\. Try again, or download a Whisper model\./)).toBeTruthy();
    }, { timeout: 4000 });
    expect(view.getByTestId('chat-input').props.value ?? '').toBe('');
  });
});
