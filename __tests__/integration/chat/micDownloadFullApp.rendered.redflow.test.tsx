/** P1 #192 — downloading speech support stays a background status while text chat remains usable. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

const BASE_EN_TOTAL_BYTES = 142 * 1024 * 1024;

describe('P1 full-app mic behavior during an STT download', () => {
  it('shows determinate download progress instead of a model loader and still sends text', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { download: true, llama: true, whisper: true },
    });
    await openChatWithJourneyModel(rtl, view);

    const unavailableMic = await rtl.waitFor(() =>
      view.getByTestId('voice-record-button-unavailable'),
    );
    expect(view.queryByTestId('voice-loading')).toBeNull();

    await rtl.act(async () => {
      rtl.fireEvent.press(unavailableMic);
    });
    await rtl.waitFor(() =>
      expect(view.getByText('Download Voice Model')).toBeTruthy(),
    );
    await rtl.act(async () => {
      rtl.fireEvent.press(view.getByText('Download'));
    });
    await rtl.waitFor(() =>
      expect(boundary.download!.active()).toHaveLength(1),
    );
    const nativeDownload = boundary.download!.active()[0];

    await rtl.act(async () => {
      boundary.download!.events.emit('DownloadProgress', {
        ...nativeDownload,
        bytesDownloaded: Math.round(BASE_EN_TOTAL_BYTES * 0.62),
        totalBytes: BASE_EN_TOTAL_BYTES,
        status: 'running',
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const progressMic = await rtl.waitFor(() =>
      view.getByTestId('voice-mic-download-progress'),
    );
    expect(progressMic.props.accessibilityLabel).toBe(
      'Downloading voice model 62%',
    );
    expect(view.getByTestId('voice-record-button-unavailable')).toBeTruthy();
    expect(view.queryByTestId('voice-loading')).toBeNull();

    boundary.llama!.scriptCompletion({
      text: 'Text chat remains available during the voice download.',
    });
    sendChatMessage(rtl, view, 'Can I keep using text chat?');
    await rtl.waitFor(
      () => {
        expect(
          view.getByText(
            'Text chat remains available during the voice download.',
          ),
        ).toBeTruthy();
        expect(view.getByTestId('voice-mic-download-progress')).toBeTruthy();
        expect(view.queryByTestId('voice-loading')).toBeNull();
      },
      { timeout: 6000 },
    );
    view.unmount();
  }, 30000);
});
