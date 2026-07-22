/** P1 #31 — Chat temperature changes reach each subsequent native generation. */
import {
  closeAppSheet,
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

async function setChatTemperature(
  journey: Awaited<ReturnType<typeof renderMainApp>>,
  value: string,
): Promise<void> {
  const { rtl, view } = journey;

  rtl.fireEvent.press(view.getByTestId('chat-settings-icon'));
  await rtl.waitFor(() => expect(view.getByText('Chat Settings')).toBeTruthy());
  if (!view.queryByTestId('setting-temperature-value-button')) {
    rtl.fireEvent.press(view.getByText('TEXT GENERATION'));
  }
  const temperatureButton = await rtl.waitFor(() =>
    view.getByTestId('setting-temperature-value-button'),
  );
  rtl.fireEvent.press(temperatureButton);
  const input = view.getByTestId('setting-temperature-input');
  rtl.fireEvent.changeText(input, value);
  rtl.fireEvent(input, 'submitEditing');
  await rtl.waitFor(() =>
    expect(view.getByTestId('setting-temperature-value')).toHaveTextContent(
      Number(value).toFixed(2),
    ),
  );
  await closeAppSheet(journey, 'Chat Settings');
}

describe('P1 full-app temperature setting journey', () => {
  it('applies each rendered temperature to the next successful turn without stale settings', async () => {
    const journey = await renderMainApp({
      boundary: { llama: true },
    });
    const { boundary, rtl, view } = journey;

    await openChatWithJourneyModel(rtl, view);
    await setChatTemperature(journey, '0.15');

    boundary.llama!.scriptCompletion({
      text: 'The focused setting was applied.',
    });
    sendChatMessage(rtl, view, 'Answer with the focused setting');
    await rtl.waitFor(
      () => {
        expect(
          view.getAllByText('Answer with the focused setting').length,
        ).toBeGreaterThan(0);
        expect(view.getByText('The focused setting was applied.')).toBeTruthy();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 8000 },
    );

    const firstRequest = boundary.llama!.calls.completion.at(-1)?.[0] as
      | { temperature?: number }
      | undefined;
    expect(firstRequest).toEqual(
      expect.objectContaining({ temperature: 0.15 }),
    );
    const completedAfterFirstTurn = boundary.llama!.calls.completion.length;

    // Change the same control in the same live conversation. The next native
    // request must read current UI state rather than a model-load-time snapshot.
    await setChatTemperature(journey, '1.35');
    boundary.llama!.scriptCompletion({
      text: 'The creative setting replaced the old value.',
    });
    sendChatMessage(rtl, view, 'Now use the creative setting');
    await rtl.waitFor(
      () => {
        expect(
          view.getAllByText('Now use the creative setting').length,
        ).toBeGreaterThan(0);
        expect(
          view.getByText('The creative setting replaced the old value.'),
        ).toBeTruthy();
        expect(view.getByText('The focused setting was applied.')).toBeTruthy();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 8000 },
    );

    expect(boundary.llama!.calls.completion.length).toBeGreaterThan(
      completedAfterFirstTurn,
    );
    const secondRequest = boundary.llama!.calls.completion.at(-1)?.[0] as
      | { temperature?: number }
      | undefined;
    expect(secondRequest).toEqual(
      expect.objectContaining({ temperature: 1.35 }),
    );
    expect(secondRequest?.temperature).not.toBe(firstRequest?.temperature);

    view.unmount();
  }, 30000);
});
