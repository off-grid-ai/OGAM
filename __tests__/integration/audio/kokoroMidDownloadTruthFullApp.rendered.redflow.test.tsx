/**
 * Kokoro download truthfulness — files created by the native fetcher are not
 * completion evidence while that native transfer is still in flight.
 */
import { renderMainApp } from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const KOKORO_FILES = [
  'duration_predictor.pte',
  'synthesizer.pte',
  'af_heart.bin',
  'tagger.pt',
  'lexicon.json',
].map(file => `/data/react-native-executorch/${file}`);

describe('full-App Kokoro mid-download state', () => {
  it('keeps Voice Models and Download Manager active until the native fetch genuinely resolves', async () => {
    let resolveFetch: (() => void) | undefined;
    const { rtl, view } = await renderMainApp({
      boundary: {
        ram: { platform: 'android', totalBytes: 16 * GB, availBytes: 14 * GB },
      },
      beforeRender: () => {
        const {
          BareResourceFetcher,
        } = require('react-native-executorch-bare-resource-fetcher');
        (BareResourceFetcher.listDownloadedFiles as jest.Mock)
          .mockReset()
          .mockResolvedValue(KOKORO_FILES);
        (BareResourceFetcher.fetch as jest.Mock)
          .mockReset()
          .mockImplementation((onProgress: (progress: number) => void) => {
            onProgress(0.42);
            return new Promise<void>(resolve => {
              resolveFetch = resolve;
            });
          });
      },
    });

    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('voice-models-tab'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByText('Download voice')),
    );

    // The native fetcher creates every destination file before all bytes land.
    // While its promise is unresolved, neither surface may treat that presence as
    // a completed or usable model.
    await rtl.waitFor(() => {
      expect(view.getByText('42%')).toBeTruthy();
      expect(view.queryByText('Download voice')).toBeNull();
      expect(view.queryByTestId('voice-af_heart')).toBeNull();
    });

    rtl.fireEvent.press(view.getByTestId('downloads-icon'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('active-download-kokoro')).toBeTruthy();
      expect(view.queryByTestId('completed-download-kokoro')).toBeNull();
      expect(view.getByTestId('dm-active-downloading-count')).toHaveTextContent(
        '1',
      );
    });

    rtl.fireEvent.press(view.getByTestId('back-button'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('models-screen')).toBeTruthy();
      expect(view.getByText('42%')).toBeTruthy();
      expect(view.queryByTestId('voice-af_heart')).toBeNull();
    });

    expect(resolveFetch).toBeDefined();
    await rtl.act(async () => {
      resolveFetch!();
      await Promise.resolve();
    });
    await rtl.waitFor(() =>
      expect(view.getByTestId('voice-af_heart')).toBeTruthy(),
    );

    rtl.fireEvent.press(view.getByTestId('downloads-icon'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('completed-download-kokoro')).toBeTruthy();
      expect(view.queryByTestId('active-download-kokoro')).toBeNull();
    });

    view.unmount();
  }, 30000);
});
