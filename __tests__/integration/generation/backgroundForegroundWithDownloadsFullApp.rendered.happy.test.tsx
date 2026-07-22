/**
 * P1 #211 — active downloads and one local generation remain coherent across
 * a background/foreground transition.
 *
 * The real App, navigation, download hydration, Download Manager,
 * local generation service, chat store, and AppState listeners stay real.
 * Native transfer, filesystem, RAM, and llama are device boundaries.
 */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const MODEL_ID = 'offgrid-tests/background-active';
const FILE_NAME = 'background-active-Q4_K_M.gguf';
const MODEL_KEY = `${MODEL_ID}/${FILE_NAME}`;
const ARCHIVE_SIZE = 24 * 1024 * 1024;
const PROMPT = 'Keep generation and download state coherent.';
const PARTIAL = 'The local reply remains attached';
const REPLY = `${PARTIAL} and completes once the app returns.`;
describe('P1 #211 background and foreground with generation plus downloads', () => {
  it('keeps one reply and one progressing download without duplicated callbacks', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        download: true,
        llama: true,
        ram: {
          platform: 'android',
          totalBytes: 8 * GB,
          availBytes: 6 * GB,
        },
      },
      beforeRender: ({ boundary: native }) => {
        native.download!.seedActive({
          downloadId: 'background-active-download',
          modelId: MODEL_ID,
          modelKey: MODEL_KEY,
          fileName: FILE_NAME,
          modelType: 'text',
          quantization: 'Q4_K_M',
          status: 'running',
          bytesDownloaded: ARCHIVE_SIZE / 4,
          totalBytes: ARCHIVE_SIZE,
          combinedTotalBytes: ARCHIVE_SIZE,
          createdAt: 1,
        });
      },
    });
    const { act, fireEvent, waitFor, within } = rtl;

    const nativeRow = boundary.download!.active()[0];
    await openChatWithJourneyModel(rtl, view);

    boundary.llama!.scriptCompletion({ text: REPLY, pauseAfter: PARTIAL });
    sendChatMessage(rtl, view, PROMPT);
    await waitFor(
      () => {
        expect(view.getByText(PARTIAL)).toBeTruthy();
        expect(view.getByTestId('stop-button')).toBeTruthy();
      },
      { timeout: 8000 },
    );

    await act(async () => {
      boundary.emitAppStateChange('background');
      boundary.download!.events.emit('DownloadProgress', {
        ...nativeRow,
        bytesDownloaded: ARCHIVE_SIZE * 0.75,
        totalBytes: ARCHIVE_SIZE,
        status: 'running',
      });
      boundary.emitAppStateChange('active');
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    await act(async () => {
      boundary.llama!.releaseStream();
    });
    await waitFor(
      () => {
        expect(view.getAllByText(REPLY)).toHaveLength(1);
        expect(view.getAllByText(PROMPT).length).toBeGreaterThan(0);
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
        expect(view.getByTestId('chat-input').props.editable).toBe(true);
      },
      { timeout: 8000 },
    );

    fireEvent.press(view.getByTestId('chat-back-button'));
    await waitFor(() => expect(view.getByTestId('home-screen')).toBeTruthy());
    fireEvent.press(view.getByTestId('models-tab'));
    await waitFor(() => expect(view.getByTestId('models-screen')).toBeTruthy());
    fireEvent.press(view.getByTestId('downloads-icon'));
    await waitFor(() => {
      expect(view.getByTestId('dm-active-downloading-count')).toHaveTextContent(
        '1',
      );
      const activeCard = view.getByTestId(`active-download-${MODEL_KEY}`);
      expect(within(activeCard).getByText('18 MB / 24 MB')).toBeTruthy();
      expect(view.getAllByTestId(`active-download-${MODEL_KEY}`)).toHaveLength(
        1,
      );
      expect(view.queryByTestId('dm-active-failed-count')).toBeNull();
    });

    view.unmount();
  }, 40000);
});
