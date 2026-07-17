/** P1 #34 — the rendered default system prompt reaches each native GGUF turn. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

type Journey = Awaited<ReturnType<typeof renderMainApp>>;
type NativeMessage = { role?: string; content?: string };
type NativeRequest = { messages?: NativeMessage[] };

const FIRST_PROMPT = 'Respond as a concise offline science tutor.';
const SECOND_PROMPT = 'Respond as a friendly offline history tutor.';

async function setSystemPrompt(
  journey: Journey,
  prompt: string,
): Promise<void> {
  const { rtl, view } = journey;

  rtl.fireEvent.press(view.getByTestId('settings-tab'));
  rtl.fireEvent.press(
    await rtl.waitFor(() => view.getByText('Model Settings')),
  );
  rtl.fireEvent.press(
    await rtl.waitFor(() => view.getByTestId('system-prompt-accordion')),
  );
  const input = await rtl.waitFor(() =>
    view.getByPlaceholderText('Enter system prompt...'),
  );
  rtl.fireEvent.changeText(input, prompt);
  await rtl.waitFor(() => expect(view.getByDisplayValue(prompt)).toBeTruthy());

  rtl.fireEvent.press(view.getByTestId('back-button'));
  rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('home-tab')));
  await rtl.waitFor(() => expect(view.getByTestId('home-screen')).toBeTruthy());
}

function latestNativeRequest(journey: Journey): NativeRequest {
  const request = journey.boundary.llama!.calls.completion.at(-1)?.[0];
  expect(request).toBeTruthy();
  return request as NativeRequest;
}

function systemMessage(request: NativeRequest): string {
  return (
    request.messages?.find(message => message.role === 'system')?.content ?? ''
  );
}

describe('P1 full-app system-prompt journey', () => {
  it('uses the latest rendered prompt while preserving coherent conversation history', async () => {
    const journey = await renderMainApp({
      boundary: { llama: true },
    });
    const { boundary, rtl, view } = journey;

    await setSystemPrompt(journey, FIRST_PROMPT);
    await openChatWithJourneyModel(rtl, view);
    boundary.llama!.scriptCompletion({
      text: 'Gravity attracts masses toward one another.',
    });
    sendChatMessage(rtl, view, 'Explain gravity briefly');
    await rtl.waitFor(
      () => {
        expect(
          view.getByText('Gravity attracts masses toward one another.'),
        ).toBeTruthy();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 8000 },
    );

    const firstRequest = latestNativeRequest(journey);
    expect(systemMessage(firstRequest)).toEqual(
      expect.stringContaining(FIRST_PROMPT),
    );

    // Update the default prompt through Model Settings, then reopen the same
    // persisted conversation. The next turn must use the new instruction while
    // retaining the completed user/assistant history from the first turn.
    rtl.fireEvent.press(view.getByTestId('chat-back-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('home-screen')).toBeTruthy(),
    );
    await setSystemPrompt(journey, SECOND_PROMPT);
    rtl.fireEvent.press(view.getByTestId('chats-tab'));
    const conversation = await rtl.waitFor(() =>
      view.getByTestId('conversation-item-0'),
    );
    rtl.fireEvent.press(conversation);
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-screen')).toBeTruthy(),
    );

    boundary.llama!.scriptCompletion({
      text: 'The printing press accelerated the spread of ideas.',
    });
    sendChatMessage(rtl, view, 'Now explain the printing press briefly');
    await rtl.waitFor(
      () => {
        expect(
          view.getByText('The printing press accelerated the spread of ideas.'),
        ).toBeTruthy();
        expect(
          view.getByText('Gravity attracts masses toward one another.'),
        ).toBeTruthy();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('voice-loading')).toBeNull();
      },
      { timeout: 8000 },
    );

    const secondRequest = latestNativeRequest(journey);
    expect(systemMessage(secondRequest)).toEqual(
      expect.stringContaining(SECOND_PROMPT),
    );
    expect(systemMessage(secondRequest)).not.toContain(FIRST_PROMPT);
    expect(secondRequest.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: 'Explain gravity briefly',
        }),
        expect.objectContaining({
          role: 'assistant',
          content: 'Gravity attracts masses toward one another.',
        }),
        expect.objectContaining({
          role: 'user',
          content: 'Now explain the printing press briefly',
        }),
      ]),
    );

    view.unmount();
  }, 30000);
});
