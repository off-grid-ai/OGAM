/** P2 #75 — Model Settings and Chat Settings share image slider values. */
import {
  openChatWithJourneyModel,
  renderMainApp,
} from '../../harness/appJourney';

describe('P2 full-app image-settings surface parity', () => {
  it('reflects edits made on either settings surface in the other', async () => {
    const { rtl, view } = await renderMainApp({
      boundary: { llama: true },
    });

    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByText('Model Settings')),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('image-generation-accordion')),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('image-steps-value-button')),
    );
    const modelSettingsSteps = await rtl.waitFor(() =>
      view.getByTestId('image-steps-input'),
    );
    rtl.fireEvent.changeText(modelSettingsSteps, '13');
    rtl.fireEvent(modelSettingsSteps, 'submitEditing');
    await rtl.waitFor(() =>
      expect(view.getByTestId('image-steps-value')).toHaveTextContent('13'),
    );

    rtl.fireEvent.press(view.getByTestId('back-button'));
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('home-tab')));
    await openChatWithJourneyModel(rtl, view);
    rtl.fireEvent.press(view.getByTestId('chat-settings-icon'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByText('IMAGE GENERATION')),
    );
    await rtl.waitFor(() =>
      expect(view.getByTestId('image-steps-value')).toHaveTextContent('13'),
    );

    rtl.fireEvent.press(view.getByTestId('image-size-value-button'));
    const chatSettingsSize = await rtl.waitFor(() =>
      view.getByTestId('image-size-input'),
    );
    rtl.fireEvent.changeText(chatSettingsSize, '384');
    rtl.fireEvent(chatSettingsSize, 'submitEditing');
    await rtl.waitFor(() =>
      expect(view.getByTestId('image-size-value')).toHaveTextContent('384x384'),
    );

    rtl.fireEvent.press(view.getByText('Done'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-input')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('chat-back-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('home-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByText('Model Settings')),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('image-generation-accordion')),
    );
    await rtl.waitFor(() =>
      expect(view.getByTestId('image-size-value')).toHaveTextContent('384x384'),
    );

    view.unmount();
  });
});
