import { installNativeBoundary, requireRTL, MB } from '../../harness/nativeBoundary';

describe('Speech model card download controls', () => {
  it('shows Pause and Cancel together, then clears only the cancelled transfer', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    const React = require('react');
    const { render, fireEvent, waitFor } = requireRTL();
    const { registerCoreDownloadProviders } = require('../../../src/services/modelDownloadService/registerProviders');
    const { hydrateDownloadStore } = require('../../../src/services/downloadHydration');
    const { TranscriptionModelsTab } = require('../../../src/screens/ModelsScreen/TranscriptionModelsTab');
    registerCoreDownloadProviders();
    boundary.download!.seedActive({
      downloadId: 'dl-medium', fileName: 'ggml-medium.en.bin',
      modelId: 'whisper-medium.en', modelType: 'stt', status: 'running',
      bytesDownloaded: 18 * MB, totalBytes: 1500 * MB,
    });
    boundary.download!.seedActive({
      downloadId: 'dl-base', fileName: 'ggml-base.en.bin',
      modelId: 'whisper-base.en', modelType: 'stt', status: 'running',
      bytesDownloaded: 8 * MB, totalBytes: 142 * MB,
    });
    await hydrateDownloadStore();

    const screen = render(React.createElement(TranscriptionModelsTab, { showRemoteModels: false }));
    await waitFor(() => expect(screen.getByTestId('transcription-model-card-3-pause')).toBeTruthy());
    expect(screen.getByTestId('transcription-model-card-3-cancel')).toBeTruthy();
    expect(screen.queryByText('Pause')).toBeNull();
    expect(screen.queryByText('Cancel')).toBeNull();

    fireEvent.press(screen.getByTestId('transcription-model-card-3-pause'));
    await waitFor(() => expect(screen.getByTestId('transcription-model-card-3-resume')).toBeTruthy());
    expect(screen.getByTestId('transcription-model-card-3-cancel')).toBeTruthy();
    fireEvent.press(screen.getByTestId('transcription-model-card-3-cancel'));
    await waitFor(() => expect(boundary.download!.active().map((row: { downloadId: string }) => row.downloadId)).toEqual(['dl-base']));
    await waitFor(() => expect(screen.queryByTestId('transcription-model-card-3-cancel')).toBeNull());
    expect(screen.getByTestId('transcription-model-card-3-download')).toBeTruthy();
    expect(screen.getByTestId('transcription-model-card-1-pause')).toBeTruthy();
  });

  it('shows Cancel instead of Download while a new Speech model waits for a slot', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    const React = require('react');
    const { render, fireEvent, waitFor } = requireRTL();
    const { registerCoreDownloadProviders } = require('../../../src/services/modelDownloadService/registerProviders');
    const { TranscriptionModelsTab } = require('../../../src/screens/ModelsScreen/TranscriptionModelsTab');
    registerCoreDownloadProviders();

    const screen = render(React.createElement(TranscriptionModelsTab, { showRemoteModels: false }));
    fireEvent.press(screen.getByTestId('transcription-model-card-0-download'));
    await waitFor(() => expect(screen.getByTestId('transcription-model-card-0-cancel')).toBeTruthy());
    expect(screen.queryByTestId('transcription-model-card-0-download')).toBeNull();
    fireEvent.press(screen.getByTestId('transcription-model-card-0-cancel'));
    await waitFor(() => expect(screen.queryByTestId('transcription-model-card-0-cancel')).toBeNull());
    expect(screen.getByTestId('transcription-model-card-0-download')).toBeTruthy();
    expect(boundary.download!.active()).toHaveLength(0);
  });

  it('keeps language selection out of both Speech model lists', () => {
    installNativeBoundary({ download: true, fs: true });
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 404, json: async () => ({ error: 'Not found' }) }) as Response;
    try {
      const React = require('react');
      const { render, fireEvent } = requireRTL();
      const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
      const { WhisperPickerSheet } = require('../../../src/components/models/WhisperPickerSheet');

      const modelsTab = render(React.createElement(ModelsScreen, {}));
      fireEvent.press(modelsTab.getByTestId('transcription-models-tab'));
      expect(modelsTab.queryByText('Language')).toBeNull();
      expect(modelsTab.getByText('English only')).toBeTruthy();
      modelsTab.unmount();

      const chatPicker = render(React.createElement(WhisperPickerSheet, { visible: true, onClose: () => {} }));
      expect(chatPicker.queryByText('Language')).toBeNull();
      expect(chatPicker.getByText('On this phone')).toBeTruthy();
      chatPicker.unmount();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
