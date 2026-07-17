/** P1 #15 — deleting a downloaded Whisper model leaves another transfer alone. */
import { renderMainApp } from '../../harness/appJourney';

const MB = 1024 * 1024;
const DOWNLOADED_FILE = 'ggml-small.en.bin';
const ACTIVE_FILE = 'ggml-base.en.bin';

describe('P1 unrelated Whisper deletion journey', () => {
  it('keeps the active Base download after Small is deleted and the app foregrounds', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { download: true },
      beforeRender: ({ boundary: device }) => {
        device.fs!.seedFile(
          `${
            device.fs!.DocumentDirectoryPath
          }/whisper-models/${DOWNLOADED_FILE}`,
          466 * MB,
        );
      },
    });
    const { act, fireEvent, waitFor } = rtl;

    await act(async () => {
      fireEvent.press(view.getByTestId('models-tab'));
    });
    await waitFor(() => expect(view.getByTestId('models-screen')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('transcription-models-tab'));
    });
    await waitFor(() => {
      expect(
        view.getByTestId('transcription-model-card-1-download'),
      ).toBeTruthy();
      expect(view.getByTestId('transcription-model-card-2')).toBeTruthy();
      expect(
        view.queryByTestId('transcription-model-card-2-download'),
      ).toBeNull();
    });

    // Start Base through the product so Whisper owns the transfer identity that
    // must not be confused with the already-downloaded Small model.
    await act(async () => {
      fireEvent.press(view.getByTestId('transcription-model-card-1-download'));
      await Promise.resolve();
    });
    await waitFor(() => expect(boundary.download!.active()).toHaveLength(1));
    expect(boundary.download!.active()[0]).toEqual(
      expect.objectContaining({
        fileName: ACTIVE_FILE,
        modelId: 'whisper-base.en',
        modelType: 'stt',
      }),
    );

    await act(async () => {
      fireEvent.press(view.getByTestId('downloads-icon'));
    });
    await waitFor(() =>
      expect(view.getByTestId('downloaded-models-screen')).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(view.getByText('Voice Models'));
    });
    await waitFor(() => {
      expect(view.getByText(ACTIVE_FILE)).toBeTruthy();
      expect(view.getByText(DOWNLOADED_FILE)).toBeTruthy();
    });

    // Under the Voice filter, Small is the sole completed card, so this is the
    // real trash action associated with the downloaded model (not Base's cancel).
    await act(async () => {
      fireEvent.press(view.getByTestId('delete-model-button'));
    });
    await waitFor(() =>
      expect(view.getByText('Delete Transcription Model')).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(view.getByText('Delete'));
      await Promise.resolve();
    });
    await waitFor(() => expect(view.queryByText(DOWNLOADED_FILE)).toBeNull());

    // Foreground recovery rebuilds the rendered active list from native truth.
    // This guards against a stale card hiding an accidental cancellation.
    await act(async () => {
      boundary.emitAppStateChange('background');
      boundary.emitAppStateChange('active');
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(boundary.download!.active()).toHaveLength(1);
      expect(view.getByText('Active Downloads')).toBeTruthy();
      expect(view.getByText(ACTIVE_FILE)).toBeTruthy();
    });

    view.unmount();
  }, 30000);
});
