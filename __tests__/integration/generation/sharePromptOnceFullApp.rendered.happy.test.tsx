/** P2 #165 — the support prompt appears at most once per app session. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

const SHEET_TITLE = 'Support Open-Source AI';

describe('P2 full-app support prompt journey', () => {
  it('does not reappear after Maybe later and another completed generation', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
    });
    boundary.llama!.scriptCompletions([
      { text: 'First answer.' },
      { text: 'Second answer.' },
      { text: 'Third answer.' },
    ]);
    await openChatWithJourneyModel(rtl, view);

    sendChatMessage(rtl, view, 'first prompt');
    await rtl.waitFor(() =>
      expect(view.getByText('First answer.')).toBeTruthy(),
    );
    expect(view.queryByText(SHEET_TITLE)).toBeNull();

    sendChatMessage(rtl, view, 'second prompt');
    await rtl.waitFor(() =>
      expect(view.getByText('Second answer.')).toBeTruthy(),
    );
    await rtl.waitFor(() => expect(view.getByText(SHEET_TITLE)).toBeTruthy(), {
      timeout: 4000,
    });

    rtl.fireEvent.press(view.getByText('Maybe later'));
    await rtl.waitFor(() => expect(view.queryByText(SHEET_TITLE)).toBeNull());

    sendChatMessage(rtl, view, 'third prompt');
    await rtl.waitFor(() =>
      expect(view.getByText('Third answer.')).toBeTruthy(),
    );
    await rtl.act(
      () => new Promise<void>(resolve => setTimeout(resolve, 1700)),
    );
    expect(view.queryByText(SHEET_TITLE)).toBeNull();

    view.unmount();
  }, 30000);
});
