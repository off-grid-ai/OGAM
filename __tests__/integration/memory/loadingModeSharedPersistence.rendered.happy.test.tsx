/**
 * P0 #85 — Model Loading is one setting shared by global Model Settings and
 * the in-chat settings sheet. The journey changes it on the real settings
 * screen, leaves that screen, and observes the same selected value in chat.
 */
import { renderMainApp } from '../../harness/appJourney';

describe('P0 shared model-loading mode journey', () => {
  it('keeps Aggressive selected between global and in-chat settings', async () => {
    const { asyncStorage, rtl, view } = await renderMainApp({
      persistedAppState: {
        activeModelId: 'test/journey-model/journey-model-Q4_K_M.gguf',
      },
    });
    const { act, fireEvent, waitFor } = rtl;

    await act(async () => {
      fireEvent.press(view.getByTestId('settings-tab'));
    });
    await waitFor(() =>
      expect(view.getAllByText('Settings').length).toBeGreaterThan(0),
    );

    await act(async () => {
      fireEvent.press(view.getByText('Model Settings'));
    });
    await waitFor(() =>
      expect(view.getByTestId('text-generation-accordion')).toBeTruthy(),
    );

    // Model Loading is a global runtime policy, so it is visible before any
    // modality-specific accordion is opened.
    expect(
      view.queryByText('Configure LLM behavior for text responses.'),
    ).toBeNull();
    const globalAggressive = await waitFor(() =>
      view.getByTestId('model-loading-mode-aggressive-button'),
    );
    expect(globalAggressive.props.accessibilityState.selected).toBe(false);
    fireEvent.press(globalAggressive);
    await waitFor(() => {
      expect(
        view.getByTestId('model-loading-mode-aggressive-button').props
          .accessibilityState.selected,
      ).toBe(true);
    });
    await waitFor(async () => {
      const raw = await asyncStorage.getItem('local-llm-app-storage');
      const persisted = JSON.parse(raw ?? '{}');
      expect(persisted.state?.settings?.modelLoadingMode).toBe('aggressive');
    });

    fireEvent.press(view.getByTestId('back-button'));
    fireEvent.press(await waitFor(() => view.getByTestId('home-tab')));
    fireEvent.press(await waitFor(() => view.getByTestId('new-chat-button')));
    await waitFor(() => expect(view.getByTestId('chat-input')).toBeTruthy());

    fireEvent.press(view.getByTestId('chat-settings-icon'));
    // The chat sheet exposes the same global policy above Image/Text sections.
    expect(view.queryByTestId('modal-text-advanced-toggle')).toBeNull();
    await waitFor(() => {
      expect(
        view.getByTestId('model-loading-mode-aggressive-button').props
          .accessibilityState.selected,
      ).toBe(true);
      expect(
        view.getByTestId('model-loading-mode-balanced-button').props
          .accessibilityState.selected,
      ).toBe(false);
    });
  }, 30000);
});
