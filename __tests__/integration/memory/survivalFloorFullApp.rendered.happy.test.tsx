/** P2 #98 + P1 #102 — Aggressive/Load Anyway cannot cross the device survival floor. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';
import { GB, MB } from '../../harness/nativeBoundary';

const MODEL_PATH = '/docs/image_models/catastrophic-coreml';

describe('P1 full-App override survival-floor journey', () => {
  it('offers the cautious override once, then blocks native loading at critically low real RAM', async () => {
    const imageModel = {
      id: 'catastrophic-coreml',
      name: 'Catastrophic Image',
      description: 'A model that cannot leave enough live memory for the app',
      modelPath: MODEL_PATH,
      downloadedAt: '2026-07-17T00:00:00.000Z',
      size: 2 * GB,
      style: 'Image',
      backend: 'coreml' as const,
    };
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        llama: true,
        ram: {
          platform: 'ios',
          totalBytes: 4 * GB,
          availBytes: 300 * MB,
        },
      },
      beforeRender: async ({ boundary: native, asyncStorage }) => {
        native.fs!.seedFile(`${MODEL_PATH}/model.mlmodelc`, 2 * GB);
        await asyncStorage.setItem(
          '@local_llm/downloaded_image_models',
          JSON.stringify([imageModel]),
        );
      },
    });
    const { act, fireEvent, waitFor } = rtl;

    fireEvent.press(view.getByTestId('settings-tab'));
    fireEvent.press(await waitFor(() => view.getByText('Model Settings')));
    fireEvent.press(
      await waitFor(() =>
        view.getByTestId('model-loading-mode-aggressive-button'),
      ),
    );
    await waitFor(() =>
      expect(
        view.getByTestId('model-loading-mode-aggressive-button').props
          .accessibilityState.selected,
      ).toBe(true),
    );
    fireEvent.press(view.getByTestId('back-button'));
    fireEvent.press(await waitFor(() => view.getByTestId('home-tab')));

    await openChatWithJourneyModel(rtl, view);
    fireEvent.press(view.getByTestId('quick-settings-button'));
    fireEvent.press(await waitFor(() => view.getByTestId('quick-image-mode')));
    await waitFor(() =>
      expect(view.getByTestId('image-mode-force-badge')).toBeTruthy(),
    );
    const ReactNative =
      require('react-native') as typeof import('react-native');
    const visibleModal = view
      .UNSAFE_getAllByType(ReactNative.Modal)
      .find(modal => modal.props.visible);
    expect(visibleModal).toBeTruthy();
    await act(async () => {
      fireEvent(visibleModal!, 'requestClose');
    });

    sendChatMessage(rtl, view, 'a lighthouse in a storm');
    await waitFor(() => {
      expect(view.getByText('Image model: Not Enough Memory')).toBeTruthy();
      expect(view.getByTestId('model-failure-load-anyway-image')).toBeTruthy();
    });

    fireEvent.press(view.getByTestId('model-failure-load-anyway-image'));
    await waitFor(() => {
      expect(view.getByText('Image model: Not Enough Memory')).toBeTruthy();
      expect(view.queryByTestId('model-failure-load-anyway-image')).toBeNull();
      expect(view.queryByTestId('generated-image')).toBeNull();
    });

    // The app stops at the JS survival gate, before allocating native image RAM.
    expect(boundary.diffusion.module.loadModel).toHaveBeenCalledTimes(0);
    expect(boundary.diffusion.calls.generateImage).toHaveLength(0);
    view.unmount();
  }, 30000);
});
