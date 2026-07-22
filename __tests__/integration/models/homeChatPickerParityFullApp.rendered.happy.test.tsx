/** APP-P2-002 — Home and Chat project one shared model selection and residency state. */
import { renderMainApp, sendChatMessage } from '../../harness/appJourney';
import { createDownloadedModel } from '../../utils/factories';

const ACTIVE_ID = 'test/parity-active/parity-active-Q4_K_M.gguf';
const OTHER_ID = 'test/parity-other/parity-other-Q4_K_M.gguf';

describe('APP-P2-002 full-App Home and Chat picker parity', () => {
  it('shows the same active, downloaded, and resident model before and after a real turn', async () => {
    const active = createDownloadedModel({
      id: ACTIVE_ID,
      name: 'Parity Active',
      fileName: 'parity-active-Q4_K_M.gguf',
      filePath: '/docs/models/parity-active-Q4_K_M.gguf',
    });
    const other = createDownloadedModel({
      id: OTHER_ID,
      name: 'Parity Other',
      fileName: 'parity-other-Q4_K_M.gguf',
      filePath: '/docs/models/parity-other-Q4_K_M.gguf',
    });
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
      downloadedModels: [active, other],
      persistedAppState: { activeModelId: ACTIVE_ID },
    });
    const { act, fireEvent, waitFor } = rtl;

    // Home manager: active selection is visible but lazy loading has not made it
    // resident. Opening its real picker lists both downloaded choices.
    fireEvent.press(view.getByTestId('models-summary'));
    await waitFor(() => {
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /Parity Active/,
      );
      expect(view.queryByTestId('models-row-text-ram')).toBeNull();
    });
    fireEvent.press(view.getByTestId('models-row-text'));
    await waitFor(() => {
      expect(view.getByText('Parity Active')).toBeTruthy();
      expect(view.getByText('Parity Other')).toBeTruthy();
      expect(view.getAllByTestId('model-item')).toHaveLength(2);
    });
    fireEvent.press(view.getByText('Done'));

    fireEvent.press(await waitFor(() => view.getByTestId('new-chat-button')));
    await waitFor(() => expect(view.getByTestId('chat-screen')).toBeTruthy());

    // Chat reads the same owners: identical active label, identical downloaded
    // rows, and still no phantom residency before the first send.
    fireEvent.press(view.getByTestId('model-selector'));
    await waitFor(() => {
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /Parity Active/,
      );
      expect(view.queryByTestId('models-row-text-ram')).toBeNull();
    });
    fireEvent.press(view.getByTestId('models-row-text'));
    await waitFor(() => {
      expect(view.getByTestId(`text-model-row-${ACTIVE_ID}`)).toBeTruthy();
      expect(view.getByTestId(`text-model-row-${OTHER_ID}`)).toBeTruthy();
    });
    fireEvent.press(view.getByText('Done'));

    boundary.llama!.scriptCompletion({
      text: 'The shared model state stayed coherent.',
    });
    sendChatMessage(rtl, view, 'Load the shared active model');
    await waitFor(
      () =>
        expect(
          view.getByText('The shared model state stayed coherent.'),
        ).toBeTruthy(),
      { timeout: 8000 },
    );

    // Residency becomes visible in Chat...
    fireEvent.press(view.getByTestId('model-selector'));
    await waitFor(() => {
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /Parity Active/,
      );
      expect(view.getByTestId('models-row-text-ram')).toBeTruthy();
    });
    fireEvent.press(view.getByText('Done'));

    // ...and the same resident is projected on Home after real navigation.
    await act(async () => {
      fireEvent.press(view.getByTestId('chat-back-button'));
    });
    await waitFor(() => expect(view.getByTestId('home-screen')).toBeTruthy());
    fireEvent.press(view.getByTestId('models-summary'));
    await waitFor(() => {
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /Parity Active/,
      );
      expect(view.getByTestId('models-row-text-ram')).toBeTruthy();
      expect(view.getByTestId('models-row-text-eject')).toBeTruthy();
    });

    view.unmount();
  }, 30000);
});
