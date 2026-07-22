/** P2 #49 — Chat Settings restores text-generation defaults in the real App. */
import { renderMainApp } from '../../harness/appJourney';

describe('P2 reset text settings journey', () => {
  it('returns a changed GGUF temperature to its default', async () => {
    const { rtl, view } = await renderMainApp({
      persistedAppState: {
        activeModelId: 'test/journey-model/journey-model-Q4_K_M.gguf',
      },
    });

    rtl.fireEvent.press(view.getByTestId('new-chat-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-input')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('chat-settings-icon'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByText('TEXT GENERATION')),
    );
    rtl.fireEvent.press(view.getByTestId('setting-temperature-value-button'));
    const input = view.getByTestId('setting-temperature-input');
    rtl.fireEvent.changeText(input, '1.25');
    rtl.fireEvent(input, 'submitEditing');
    await rtl.waitFor(() =>
      expect(view.getByTestId('setting-temperature-value').props.children).toBe(
        '1.25',
      ),
    );

    rtl.fireEvent.press(view.getByText('Reset to Defaults'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('setting-temperature-value').props.children).toBe(
        '0.70',
      ),
    );
    view.unmount();
  });
});
