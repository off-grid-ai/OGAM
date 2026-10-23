/**
 * UI integration — turning MTP on downloads the model's MTP head; when that download fails, the
 * person sees it failed, retries with one tap, and the retry gets MTP ready.
 *
 * Product-correct outcome (the person's view): Gemma 4 E4B is on the phone. In a chat, the person opens
 * the settings sheet, expands Advanced under Text Generation and turns Speculative Decoding (MTP) on.
 * The app fetches the model's published MTP head by itself and shows its progress under the switch.
 * The network drops and the download fails: the progress goes away and a single retry icon appears in
 * its place. One tap on it starts the download again with progress; this time it finishes, the retry
 * icon and the progress go away, and MTP stays on with its Draft Tokens control. Reopening the sheet
 * later starts nothing again: the head is installed.
 *
 * Entry point: the REAL App (boot, NavigationContainer, AppNavigator). Every step is a gesture: Home →
 * New Chat → the chat's settings icon → TEXT GENERATION → Advanced → MTP "On" → the retry icon.
 *
 * Fakes (device boundary only): the in-memory filesystem (the model weights, and the head bytes the
 * native downloader writes), AsyncStorage (what an earlier run saved), the RAM sensor, llama.rn, the
 * native slider (a View), and the native background downloader (DownloadManagerModule), whose
 * DownloadProgress / DownloadError / DownloadComplete events are what the device emits. Everything we
 * own runs: MtpHeadDownload, mtpHeads, downloadMtpHead, performSidecarDownload,
 * backgroundDownloadService, the stores.
 */
import { installNativeBoundary, requireRTL, GB, MB } from '../../harness/nativeBoundary';

jest.unmock('@react-navigation/native');
jest.mock('react-native-bootsplash', () => ({ hide: jest.fn(async () => {}) }), { virtual: true });
// Native slider component: a plain View carrying its props (the drag gesture is not under test here).
jest.mock('@react-native-community/slider', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    const { View } = require('react-native');
    return require('react').createElement(View, props);
  },
}));

const MODEL_FILE = 'gemma-4-E4B-it-Q4_K_M.gguf';
const MODEL_ID = `unsloth/gemma-4-E4B-it-GGUF/${MODEL_FILE}`;
const HEAD_FILE = 'mtp-gemma-4-E4B-it-Q8_0.gguf';
const HEAD_BYTES = 98653248;
const RENDER_WAIT = { timeout: 8000 };

describe('MTP head download that fails', () => {
  it('shows the failure, and one tap on retry downloads the head and leaves MTP ready', async () => {
    const boundary = installNativeBoundary({
      llama: true,
      fs: true,
      download: true,
      ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
    });
    const React = require('react');
    const { render, fireEvent, waitFor, act, within } = requireRTL();
    const AsyncStorage =
      require('@react-native-async-storage/async-storage').default ??
      require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();

    // What an earlier run left: the weights on disk and their saved row, selected, MTP never turned on.
    const modelsDir = `${boundary.fs!.DocumentDirectoryPath}/models`;
    const modelPath = `${modelsDir}/${MODEL_FILE}`;
    const headPath = `${modelsDir}/${HEAD_FILE}`;
    boundary.fs!.seedFile(modelPath, 4900 * MB);
    await AsyncStorage.setItem(
      '@local_llm/downloaded_models',
      JSON.stringify([
        {
          id: MODEL_ID,
          name: 'Gemma 4 E4B',
          author: 'unsloth',
          filePath: modelPath,
          fileName: MODEL_FILE,
          fileSize: 4900 * MB,
          quantization: 'Q4_K_M',
          downloadedAt: '2026-10-01T09:00:00.000Z',
          credibility: { source: 'community', isOfficial: false, isVerifiedQuantizer: false },
          engine: 'llama',
        },
      ]),
    );
    await AsyncStorage.setItem(
      'local-llm-app-storage',
      JSON.stringify({
        state: { hasCompletedOnboarding: true, checklistDismissed: true, activeModelId: MODEL_ID },
        version: 0,
      }),
    );

    const App = require('../../../App').default;
    const ui = render(React.createElement(App));
    await waitFor(() => expect(ui.queryByTestId('app-loading')).toBeNull(), RENDER_WAIT);

    // Home → New Chat → the chat's settings → Text Generation → Advanced.
    fireEvent.press(await waitFor(() => ui.getByTestId('home-tab'), RENDER_WAIT));
    fireEvent.press(await waitFor(() => ui.getByTestId('new-chat-button'), RENDER_WAIT));
    fireEvent.press(await waitFor(() => ui.getByTestId('chat-settings-icon'), RENDER_WAIT));
    fireEvent.press(await waitFor(() => ui.getByText('TEXT GENERATION'), RENDER_WAIT));
    fireEvent.press(await waitFor(() => ui.getByTestId('modal-text-advanced-toggle'), RENDER_WAIT));

    // BEFORE: MTP off, no Draft Tokens, no download status, no retry, nothing downloading.
    await waitFor(() => expect(ui.getByTestId('speculative-off-button')).toBeTruthy(), RENDER_WAIT);
    expect(ui.queryByTestId('speculative-draft-stepper-value')).toBeNull();
    expect(ui.queryByTestId('mtp-head-status')).toBeNull();
    expect(ui.queryByLabelText('Retry MTP head download')).toBeNull();
    expect(boundary.download!.active()).toHaveLength(0);

    // The one tap: MTP on. The head download starts by itself, with progress under the switch.
    fireEvent.press(ui.getByTestId('speculative-on-button'));
    await waitFor(() => expect(ui.getByTestId('speculative-draft-stepper-value')).toBeTruthy(), RENDER_WAIT);
    const first = await waitFor(() => {
      const rows = boundary.download!.active().filter(r => r.fileName === HEAD_FILE);
      expect(rows).toHaveLength(1);
      return rows[0];
    }, RENDER_WAIT);
    await act(async () => {
      boundary.download!.events.emit('DownloadProgress', {
        downloadId: first.downloadId, fileName: first.fileName, modelId: first.modelId,
        bytesDownloaded: HEAD_BYTES * 0.3, totalBytes: HEAD_BYTES, status: 'running',
      });
    });
    await waitFor(() => expect(ui.getByText('Getting MTP head… 30%')).toBeTruthy(), RENDER_WAIT);
    expect(ui.queryByLabelText('Retry MTP head download')).toBeNull();

    // The device's download fails (network lost). The progress goes; the retry icon takes its place.
    await act(async () => {
      boundary.download!.events.emit('DownloadError', {
        downloadId: first.downloadId, fileName: first.fileName, modelId: first.modelId,
        status: 'failed', reason: 'Network connection lost',
      });
    });
    await waitFor(() => expect(ui.getByLabelText('Retry MTP head download')).toBeTruthy(), RENDER_WAIT);
    expect(ui.queryByText(/Getting MTP head/)).toBeNull();
    expect(within(ui.getByTestId('mtp-head-status')).getByTestId('mtp-head-retry')).toBeTruthy();
    expect(await boundary.fs!.exists(headPath)).toBe(false);
    // MTP itself stays on: the failure is the head, not the setting.
    expect(ui.getByTestId('speculative-draft-stepper-value')).toBeTruthy();

    // One tap on retry: a fresh download starts and shows progress again.
    const before = new Set(boundary.download!.active().map(r => r.downloadId));
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Retry MTP head download'));
    });
    const second = await waitFor(() => {
      const rows = boundary.download!.active().filter(r => r.fileName === HEAD_FILE && !before.has(r.downloadId));
      expect(rows).toHaveLength(1);
      return rows[0];
    }, RENDER_WAIT);
    await waitFor(() => expect(ui.queryByLabelText('Retry MTP head download')).toBeNull(), RENDER_WAIT);
    await act(async () => {
      boundary.download!.events.emit('DownloadProgress', {
        downloadId: second.downloadId, fileName: second.fileName, modelId: second.modelId,
        bytesDownloaded: HEAD_BYTES * 0.8, totalBytes: HEAD_BYTES, status: 'running',
      });
    });
    await waitFor(() => expect(ui.getByText('Getting MTP head… 80%')).toBeTruthy(), RENDER_WAIT);

    // This time the native side finishes: the bytes land beside the model.
    await act(async () => {
      boundary.fs!.seedFile(headPath, HEAD_BYTES);
      boundary.download!.events.emit('DownloadComplete', {
        downloadId: second.downloadId, fileName: second.fileName, modelId: second.modelId,
        bytesDownloaded: HEAD_BYTES, totalBytes: HEAD_BYTES, status: 'completed',
        localUri: `file://${headPath}`,
      });
    });

    // AFTER: MTP is ready — no progress, no retry, MTP on with its Draft Tokens.
    await waitFor(() => expect(ui.queryByTestId('mtp-head-status')).toBeNull(), RENDER_WAIT);
    expect(ui.queryByText(/Getting MTP head/)).toBeNull();
    expect(ui.queryByLabelText('Retry MTP head download')).toBeNull();
    expect(ui.getByTestId('speculative-draft-stepper-value')).toBeTruthy();

    // Reopening the settings later starts nothing: the head is installed.
    const downloadsSoFar = boundary.download!.module.startDownload.mock.calls.length;
    fireEvent.press(ui.getByTestId('modal-text-advanced-toggle'));
    await waitFor(() => expect(ui.queryByTestId('speculative-on-button')).toBeNull(), RENDER_WAIT);
    fireEvent.press(ui.getByTestId('modal-text-advanced-toggle'));
    await waitFor(() => expect(ui.getByTestId('speculative-draft-stepper-value')).toBeTruthy(), RENDER_WAIT);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(ui.queryByTestId('mtp-head-status')).toBeNull();
    expect(boundary.download!.module.startDownload.mock.calls.length).toBe(downloadsSoFar);
    ui.unmount();
  });
});
