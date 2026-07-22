/**
 * P1 #108 — In Memory reports the RAM owned by a model only after it is resident.
 *
 * The journey mounts the real App and proves downloaded storage does not claim
 * RAM. It selects that model through Home, then a rendered chat send runs the
 * production lazy-load and residency registration path. Back on Home, the same
 * In Memory sheet must expose the resident model's estimated runtime footprint.
 * Only the native model runtime, filesystem, and device RAM sensor are faked.
 */
import { renderMainApp, sendChatMessage } from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

describe('P1 loaded-model RAM visibility', () => {
  it('shows the loaded text model RAM after its first real turn', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        llama: true,
        ram: {
          platform: 'android',
          totalBytes: 12 * GB,
          availBytes: 10 * GB,
        },
      },
    });
    const { act, fireEvent, waitFor } = rtl;

    // Downloaded storage is not residency: before a runtime load, In Memory must
    // not claim that the model consumes RAM.
    await act(async () => {
      fireEvent.press(view.getByTestId('models-summary'));
    });
    await waitFor(() => expect(view.getByText('MODELS')).toBeTruthy());
    expect(view.queryByTestId('models-row-text-ram')).toBeNull();
    await act(async () => {
      fireEvent.press(view.getByText('Done'));
    });
    await waitFor(() => expect(view.queryByText('MODELS')).toBeNull());

    // Select the model only through Home's rendered picker.
    await act(async () => {
      fireEvent.press(view.getByTestId('browse-models-button'));
    });
    await waitFor(() => expect(view.getByText('Journey Model')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('model-item'));
    });
    await waitFor(() =>
      expect(view.getByTestId('new-chat-button')).toBeTruthy(),
    );
    await waitFor(() => expect(view.queryByText('Text Models')).toBeNull());

    // Enter through the real Home navigation and lazy-load on the first turn.
    await act(async () => {
      fireEvent.press(view.getByTestId('new-chat-button'));
    });
    await waitFor(() => expect(view.getByTestId('chat-screen')).toBeTruthy());
    boundary.llama!.scriptCompletion({ text: 'The model is resident.' });
    sendChatMessage(rtl, view, 'load the selected model');
    await waitFor(() =>
      expect(view.getByText('The model is resident.')).toBeTruthy(),
    );

    await act(async () => {
      fireEvent.press(view.getByTestId('chat-back-button'));
    });
    await waitFor(() => expect(view.getByTestId('home-screen')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('models-summary'));
    });

    // Journey Model is 128 MiB. The production CPU residency estimator accounts
    // for runtime overhead (1.5x), registers 192 MiB, then renders 0.2 GB.
    await waitFor(() => {
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /Journey Model/,
      );
      expect(view.getByTestId('models-row-text-ram')).toHaveTextContent(
        '0.2 GB',
      );
    });

    view.unmount();
  }, 30000);
});
