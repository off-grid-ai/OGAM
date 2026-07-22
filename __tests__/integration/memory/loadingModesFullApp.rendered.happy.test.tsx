/** P0 #87/#88 — heavy-model residency policy through Settings, Chat, and In Memory. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  seedDownloadedMnnImageModel,
  sendChatMessage,
  type RenderedAppJourney,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

type LoadingMode = 'conservative' | 'balanced';

async function runHeavyResidencyJourney(
  mode: LoadingMode,
): Promise<RenderedAppJourney> {
  const journey = await renderMainApp({
    boundary: {
      llama: true,
      ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
    },
    beforeRender: async ({ boundary, asyncStorage }) => {
      await seedDownloadedMnnImageModel(boundary, asyncStorage);
    },
  });
  const { boundary, rtl, view } = journey;
  const { act, fireEvent, waitFor } = rtl;

  fireEvent.press(view.getByTestId('settings-tab'));
  fireEvent.press(await waitFor(() => view.getByText('Model Settings')));
  fireEvent.press(
    await waitFor(() => view.getByTestId('text-generation-accordion')),
  );
  fireEvent.press(
    await waitFor(() => view.getByTestId('text-advanced-toggle')),
  );
  const modeButton = await waitFor(() =>
    view.getByTestId(`model-loading-mode-${mode}-button`),
  );
  fireEvent.press(modeButton);
  await waitFor(() =>
    expect(
      view.getByTestId(`model-loading-mode-${mode}-button`).props
        .accessibilityState.selected,
    ).toBe(true),
  );
  fireEvent.press(view.getByTestId('back-button'));
  fireEvent.press(await waitFor(() => view.getByTestId('home-tab')));

  await openChatWithJourneyModel(rtl, view);
  boundary.llama!.scriptCompletion({ text: 'Text is resident.' });
  sendChatMessage(rtl, view, 'load the text model');
  await waitFor(() => expect(view.getByText('Text is resident.')).toBeTruthy());

  fireEvent.press(view.getByTestId('quick-settings-button'));
  fireEvent.press(await waitFor(() => view.getByTestId('quick-image-mode')));
  await waitFor(() =>
    expect(view.getByTestId('image-mode-force-badge')).toBeTruthy(),
  );
  const ReactNative = require('react-native') as typeof import('react-native');
  const visibleModal = view
    .UNSAFE_getAllByType(ReactNative.Modal)
    .find(modal => modal.props.visible);
  expect(visibleModal).toBeTruthy();
  await act(async () => {
    fireEvent(visibleModal!, 'requestClose');
  });

  sendChatMessage(rtl, view, 'a cabin under northern lights');
  await waitFor(
    () => expect(view.getByTestId('generated-image')).toBeTruthy(),
    {
      timeout: 8000,
    },
  );
  fireEvent.press(view.getByTestId('model-selector'));
  await waitFor(() =>
    expect(view.getByTestId('models-row-image-ram')).toBeTruthy(),
  );
  return journey;
}

describe('P0 full-app model-loading modes', () => {
  it('Conservative keeps only the newly loaded heavy image model', async () => {
    const { view } = await runHeavyResidencyJourney('conservative');
    expect(view.getByTestId('models-row-image-ram')).toBeTruthy();
    expect(view.queryByTestId('models-row-text-ram')).toBeNull();
    view.unmount();
  }, 30000);

  it('Balanced keeps text and image resident when both fit', async () => {
    const { view } = await runHeavyResidencyJourney('balanced');
    expect(view.getByTestId('models-row-image-ram')).toBeTruthy();
    expect(view.getByTestId('models-row-text-ram')).toBeTruthy();
    view.unmount();
  }, 30000);
});
