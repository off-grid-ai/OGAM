/** P0 #99 — an oversized image model fails gracefully and honors Load Anyway. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const MODEL_PATH = '/docs/image_models/oversized-coreml';

describe('P0 oversized-model recovery journey', () => {
  it('shows the memory card, then generates after the explicit override', async () => {
    const imageModel = {
      id: 'oversized-coreml',
      name: 'Oversized Image',
      description: 'A model larger than this device safe budget',
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
          availBytes: 300 * 1024 * 1024,
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

    sendChatMessage(rtl, view, 'a fox in the snow');
    await waitFor(() => {
      expect(view.getByTestId('chat-screen')).toBeTruthy();
      expect(view.getByTestId('model-failure-image')).toBeTruthy();
      expect(view.getByText('Image model: Not Enough Memory')).toBeTruthy();
      expect(view.getByTestId('model-failure-load-anyway-image')).toBeTruthy();
      expect(view.queryByTestId('generated-image')).toBeNull();
    });
    expect(boundary.diffusion.calls.generateImage).toHaveLength(0);

    fireEvent.press(view.getByTestId('model-failure-load-anyway-image'));
    await waitFor(
      () => {
        expect(view.queryByTestId('model-failure-image')).toBeNull();
        expect(view.getByTestId('generated-image')).toBeTruthy();
      },
      { timeout: 8000 },
    );
    expect(boundary.diffusion.calls.generateImage).toHaveLength(1);
    view.unmount();
  }, 30000);
});
