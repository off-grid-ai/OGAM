/** P2 #10 — downloading another Whisper model preserves the first install. */
import { renderMainApp } from '../../harness/appJourney';
import type { DownloadRow } from '../../harness/nativeBoundary';

const MB = 1024 * 1024;

describe('P2 second Whisper-model download journey', () => {
  it('shows both completed models after two distinct UI downloads', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { download: true },
    });
    const { act, fireEvent, waitFor } = rtl;

    fireEvent.press(view.getByTestId('models-tab'));
    fireEvent.press(
      await waitFor(() => view.getByTestId('transcription-models-tab')),
    );

    const completeDownload = async (opts: {
      cardIndex: number;
      modelId: string;
      fileName: string;
      sizeBytes: number;
    }) => {
      fireEvent.press(
        await waitFor(() =>
          view.getByTestId(
            `transcription-model-card-${opts.cardIndex}-download`,
          ),
        ),
      );
      const nativeRow = await waitFor(() => {
        const row = boundary
          .download!.active()
          .find(candidate => candidate.modelId === opts.modelId);
        expect(row).toBeTruthy();
        return row as DownloadRow;
      });

      const localUri = `/docs/whisper-models/${opts.fileName}`;
      await act(async () => {
        boundary.fs!.seedFile(localUri, opts.sizeBytes);
        boundary.download!.events.emit('DownloadComplete', {
          ...nativeRow,
          bytesDownloaded: opts.sizeBytes,
          totalBytes: opts.sizeBytes,
          status: 'completed',
          localUri,
        });
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      await waitFor(() => {
        expect(
          view.queryByTestId(
            `transcription-model-card-${opts.cardIndex}-download`,
          ),
        ).toBeNull();
      });
    };

    await completeDownload({
      cardIndex: 0,
      modelId: 'whisper-tiny.en',
      fileName: 'ggml-tiny.en.bin',
      sizeBytes: 75 * MB,
    });
    await completeDownload({
      cardIndex: 1,
      modelId: 'whisper-base.en',
      fileName: 'ggml-base.en.bin',
      sizeBytes: 142 * MB,
    });

    fireEvent.press(view.getByTestId('downloads-icon'));
    await waitFor(() =>
      expect(view.getByTestId('downloaded-models-screen')).toBeTruthy(),
    );
    fireEvent.press(view.getByText('Voice Models'));
    await waitFor(() => {
      expect(view.getByText('ggml-tiny.en.bin')).toBeTruthy();
      expect(view.getByText('ggml-base.en.bin')).toBeTruthy();
      expect(view.getAllByText('Transcription')).toHaveLength(2);
    });

    view.unmount();
  }, 30000);
});
