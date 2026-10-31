/**
 * Device regression: downloading a new transcription model selects it, but an older Whisper
 * context can still be resident. Starting dictation must replace that context before capture;
 * "some Whisper model is loaded" is not enough.
 *
 * Real TranscriptionModelsTab + ChatScreen + stores + residency + Whisper service. Only the
 * filesystem, download manager, and whisper.rn runtime are device-boundary fakes.
 */
import { setupChatScreen } from '../../harness/chatHarness';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

describe('selected Whisper model identity', () => {
  it('loads the newly downloaded model before the next transcription', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', whisper: true, download: true });
    await h.setupWhisperModel('tiny.en');

    const React = require('react');
    const { TranscriptionModelsTab } = require('../../../src/screens/ModelsScreen/TranscriptionModelsTab');
    const { useWhisperStore } = require('../../../src/stores/whisperStore');
    const { whisperService } = require('../../../src/services/whisperService');
    const modelTab = h.renderAside(React.createElement(TranscriptionModelsTab));

    // Large v3 Turbo is catalogue index 8. Download it through the real model-card action.
    await h.rtl.act(async () => {
      h.rtl.fireEvent.press(modelTab.getByTestId('transcription-model-card-8-download'));
      await Promise.resolve();
    });
    await h.rtl.waitFor(() => { expect(h.boundary.download!.active()).toHaveLength(1); });
    const row = h.boundary.download!.active()[0];
    await h.rtl.act(async () => { await Promise.resolve(); });
    await h.rtl.act(async () => {
      h.boundary.fs!.seedFile(
        '/docs/whisper-models/ggml-large-v3-turbo.bin',
        809 * 1024 * 1024,
      );
      h.boundary.download!.events.emit('DownloadComplete', {
        downloadId: row.downloadId,
        fileName: row.fileName,
        modelId: row.modelId,
        bytesDownloaded: row.totalBytes ?? 1,
        totalBytes: row.totalBytes ?? 1,
        status: 'completed',
        localUri: '/docs/whisper-models/ggml-large-v3-turbo.bin',
      });
    });
    await h.rtl.waitFor(() => {
      expect(useWhisperStore.getState().downloadedModelId).toBe('large-v3-turbo');
    });
    modelTab.unmount();

    // The old tiny.en context is still resident. A real mic gesture must replace it with
    // Large v3 Turbo before whisper.rn starts capturing.
    h.render();
    await h.tapMic();
    await h.rtl.waitFor(() => {
      expect(h.boundary.whisper!.hasRealtimeSubscriber()).toBe(true);
    }, { timeout: 4000 });

    const initCalls = h.boundary.whisper!.module.initWhisper.mock.calls;
    const lastLoadedPath = initCalls[initCalls.length - 1]?.[0]?.filePath;
    await h.rtl.act(async () => {
      h.boundary.whisper!.emitRealtime({ text: 'test', isCapturing: false });
      await whisperService.stopTranscription();
    });

    expect(lastLoadedPath).toBe('/docs/whisper-models/ggml-large-v3-turbo.bin');
  }, 30000);
});
