/** APP-P1-008 — conversation create/rename/open/delete keeps the active chat coherent. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

describe('APP-P1-008 full-App conversation lifecycle', () => {
  it('renames one chat, opens the other, deletes it, then reopens the renamed chat', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
    });

    await openChatWithJourneyModel(rtl, view);
    boundary.llama!.scriptCompletion({ text: 'First conversation answer.' });
    sendChatMessage(rtl, view, 'First conversation prompt.');
    await rtl.waitFor(() =>
      expect(view.getByText('First conversation answer.')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('chat-back-button'));

    rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('chats-tab')));
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByText('New')));
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-screen')).toBeTruthy(),
    );
    boundary.llama!.scriptCompletion({ text: 'Second conversation answer.' });
    sendChatMessage(rtl, view, 'Second conversation prompt.');
    await rtl.waitFor(() =>
      expect(view.getByText('Second conversation answer.')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('chat-back-button'));

    // The newest chat is first. Rename it through the Chats row action.
    const renameActions = await rtl.waitFor(() =>
      view.getAllByTestId(/^rename-conversation-/),
    );
    rtl.fireEvent.press(renameActions[0]);
    rtl.fireEvent.changeText(
      view.getByTestId('conversation-rename-input'),
      'Renamed second chat',
    );
    rtl.fireEvent.press(view.getByTestId('conversation-rename-save'));
    await rtl.waitFor(() =>
      expect(view.getByText('Renamed second chat')).toBeTruthy(),
    );

    // Open the older chat and prove its transcript became active, not the renamed one.
    rtl.fireEvent.press(view.getByText('First conversation prompt.'));
    await rtl.waitFor(() => {
      expect(view.getByText('First conversation answer.')).toBeTruthy();
      expect(view.queryByText('Second conversation answer.')).toBeNull();
    });
    rtl.fireEvent.press(view.getByTestId('chat-back-button'));

    // Delete that active chat. The remaining renamed chat must stay discoverable.
    const deleteActions = await rtl.waitFor(() =>
      view.getAllByTestId(/^delete-conversation-/),
    );
    rtl.fireEvent.press(deleteActions[1]);
    await rtl.waitFor(() => expect(view.getByText('Delete Chat')).toBeTruthy());
    const deleteButtons = view.getAllByText('Delete');
    rtl.fireEvent.press(deleteButtons[deleteButtons.length - 1]);
    await rtl.waitFor(() => {
      expect(view.getByText('Renamed second chat')).toBeTruthy();
      expect(view.queryByText('First conversation prompt.')).toBeNull();
    });

    rtl.fireEvent.press(view.getByText('Renamed second chat'));
    await rtl.waitFor(() => {
      expect(view.getByText('Second conversation answer.')).toBeTruthy();
      expect(view.queryByText('First conversation answer.')).toBeNull();
    });

    view.unmount();
  }, 30000);
});
