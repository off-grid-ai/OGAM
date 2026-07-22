/**
 * P0 #11 — download the Pro TTS model through the real Models screen.
 *
 * The user drives the real App navigation and Voice Models panel. Kokoro, the
 * TTS store, Pro download provider, unified download service, and Download
 * Manager remain real; only the executorch resource fetcher is the native
 * boundary supplied by Jest.
 */
import { renderMainApp } from '../../harness/appJourney';

describe('P0 TTS-model download journey', () => {
  it('downloads Kokoro from Voice Models and lists it in Download Manager', async () => {
    const { rtl, view } = await renderMainApp();
    const { act, fireEvent, waitFor } = rtl;

    await act(async () => {
      fireEvent.press(view.getByTestId('models-tab'));
    });
    await waitFor(() => expect(view.getByTestId('models-screen')).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByTestId('voice-models-tab'));
    });
    await waitFor(() => expect(view.getByText('Download voice')).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByText('Download voice'));
    });

    await waitFor(() => {
      expect(view.queryByText('Download voice')).toBeNull();
      expect(view.getByTestId('voice-af_heart')).toBeTruthy();
      expect(view.getByText('Remove voice model (82 MB)')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(view.getByTestId('downloads-icon'));
    });
    await waitFor(() => {
      expect(view.getByTestId('downloaded-models-screen')).toBeTruthy();
      expect(view.getByText('Kokoro TTS')).toBeTruthy();
    });
  }, 30000);
});
