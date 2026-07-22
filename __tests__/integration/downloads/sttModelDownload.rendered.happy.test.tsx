/** P0 #9 — download an on-device Whisper model through the real Models screen. */
import { renderMainApp } from '../../harness/appJourney';

const FILE_NAME = 'ggml-tiny.en.bin';
const MODEL_ID = 'whisper-tiny.en';
const FILE_SIZE = 75 * 1024 * 1024;

describe('P0 STT-model download journey', () => {
  it('downloads Whisper from Transcription Models and lists it under Voice Models', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { download: true },
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
      expect(view.getByText('English only')).toBeTruthy();
      expect(view.getByTestId('transcription-model-card-0')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(view.getByTestId('transcription-model-card-0-download'));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(boundary.download!.active()).toHaveLength(1));
    const nativeRow = boundary.download!.active()[0];
    expect(nativeRow).toEqual(
      expect.objectContaining({
        fileName: FILE_NAME,
        modelId: MODEL_ID,
        modelType: 'stt',
      }),
    );

    await act(async () => {
      boundary.download!.events.emit('DownloadProgress', {
        ...nativeRow,
        bytesDownloaded: FILE_SIZE / 2,
        totalBytes: FILE_SIZE,
        status: 'running',
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(view.getByTestId('transcription-model-card-0')).toHaveTextContent(
        /50%/,
      ),
    );

    await act(async () => {
      boundary.fs!.seedFile(`/docs/whisper-models/${FILE_NAME}`, FILE_SIZE);
      boundary.download!.events.emit('DownloadComplete', {
        ...nativeRow,
        bytesDownloaded: FILE_SIZE,
        totalBytes: FILE_SIZE,
        status: 'completed',
        localUri: `/docs/whisper-models/${FILE_NAME}`,
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
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
      expect(view.getByText(FILE_NAME)).toBeTruthy();
      expect(view.getByText('Transcription')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(view.getByTestId('back-button'));
    });
    await waitFor(() => expect(view.getByTestId('models-screen')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('home-tab'));
    });
    await waitFor(() => expect(view.getByTestId('home-screen')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('models-summary'));
    });
    await waitFor(() =>
      expect(view.getByTestId('models-row-speech')).toBeTruthy(),
    );
    expect(view.queryByTestId('models-row-speech-ram')).toBeNull();
    view.unmount();
  }, 30000);
});
