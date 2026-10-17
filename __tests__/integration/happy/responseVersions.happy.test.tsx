/**
 * HAPPY-PATH (UI integration) — retrying an answer keeps the earlier one as a version.
 *
 * Real ChatScreen, real gestures (action menu → Retry, the ‹ › version arrows), real regenerate path,
 * real chat store and its thread rules (utils/chatThread over @offgrid/sync); only native leaves faked.
 * The person asks two questions, retries the FIRST answer, then steps back to it: the earlier answer
 * and the turn that followed it come back, and nothing was deleted.
 */
import { renderedThread, setupChatScreen } from '../../harness/chatHarness';
import { installRemoteStream } from '../../harness/remoteHarness';

/** A captured-shape OpenAI-compatible SSE reply carrying `text`. */
const sse = (text: string) =>
  `data: {"choices":[{"delta":{"content":${JSON.stringify(text)}}}]}\n\n` +
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
  'data: [DONE]\n\n';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('happy — retry keeps every answer as a version', () => {
  it('llama.cpp: an older answer retried shows 2/2, and Previous brings back its later turn', async () => {
    const h = await setupChatScreen({ engine: 'llama' });
    h.render();
    await h.send('tell me a fact', { text: 'Honey never spoils.' });
    await h.rtl.waitFor(() => expect(h.view!.queryByText(/Honey never spoils\./)).not.toBeNull());
    await h.send('another one', { text: 'Bananas are berries.' });
    await h.rtl.waitFor(() => expect(h.view!.queryByText(/Bananas are berries\./)).not.toBeNull());

    // Retry the first answer from its question: long-press the first question, then Retry.
    h.boundary.llama!.scriptCompletion({ text: 'Octopuses have three hearts.' });
    h.rtl.fireEvent(h.view!.getAllByTestId('user-message')[0]!, 'longPress');
    await h.rtl.waitFor(() => expect(h.view!.getByTestId('action-menu')).toBeTruthy());
    h.rtl.fireEvent.press(h.view!.getByTestId('action-retry'));
    await h.rtl.waitFor(() =>
      expect(h.view!.queryByText(/Octopuses have three hearts\./)).not.toBeNull(),
    );
    // The new answer is version 2 of 2; the later turn belongs to the first answer, so it is not shown.
    expect(h.view!.getByText('2/2')).toBeTruthy();
    expect(h.view!.queryByText(/Bananas are berries\./)).toBeNull();

    h.rtl.fireEvent.press(h.view!.getByLabelText('Previous response'));
    await h.rtl.waitFor(() => expect(h.view!.queryByText(/Honey never spoils\./)).not.toBeNull());
    expect(h.view!.getByText('1/2')).toBeTruthy();
    expect(h.view!.queryByText(/Bananas are berries\./)).not.toBeNull();
    expect(h.view!.queryByText(/Octopuses have three hearts\./)).toBeNull();

    // Every message is still saved.
    const { useChatStore } = require('../../../src/stores');
    const conversation = useChatStore.getState().conversations[0];
    expect(conversation.messages.map((message: { content: string }) => message.content)).toEqual(
      expect.arrayContaining([
        'tell me a fact',
        'Honey never spoils.',
        'another one',
        'Bananas are berries.',
        'Octopuses have three hearts.',
      ]),
    );
  });

  it.each(['llama.cpp', 'remote'] as const)(
    '%s: an edited question shows 2/2, Previous brings back the original turn and the turn after it; resending an older question keeps its later turns as a version',
    async model => {
      const h = await setupChatScreen({ engine: 'llama' });
      h.render();
      const v = () => h.view!;
      const restoreRemote =
        model === 'remote' ? await h.selectRemoteModelViaUI() : async () => {};
      // The next answer, at the boundary of the model in use: the llama.rn engine or the server's SSE stream.
      const nextAnswer = (text: string) => {
        if (model === 'remote') installRemoteStream(sse(text));
        else h.boundary.llama!.scriptCompletion({ text });
      };
      const ask = async (question: string, answer: string) => {
        nextAnswer(answer);
        // On the remote model the local engine is scripted with a different answer, so a send that
        // wrongly ran locally shows the wrong text.
        await h.send(question, {
          text: model === 'remote' ? 'The local engine answered.' : answer,
        });
      };
      try {
        const expectThread = (...lines: string[]) =>
          expect(renderedThread(v())).toEqual(
            lines.map(line => expect.stringMatching(new RegExp(`^${line}`))),
          );

        await ask('tell me a fact', 'Honey never spoils.');
        await h.rtl.waitFor(() =>
          expect(v().queryByText(/Honey never spoils\./)).not.toBeNull(),
        );
        await ask('another one', 'Bananas are berries.');
        await h.rtl.waitFor(() =>
          expect(v().queryByText(/Bananas are berries\./)).not.toBeNull(),
        );
        // Before: a plain chat, in order, with no version switcher.
        expectThread(
          'user: tell me a fact',
          'assistant: Honey never spoils\\.',
          'user: another one',
          'assistant: Bananas are berries\\.',
        );
        expect(v().queryByText(/^\d+\/\d+$/)).toBeNull();

        // Edit the FIRST question: long-press it, Edit, change the text, SAVE & RESEND.
        nextAnswer('Octopuses have three hearts.');
        h.rtl.fireEvent(v().getAllByTestId('user-message')[0]!, 'longPress');
        await h.rtl.waitFor(() =>
          expect(v().getByTestId('action-menu')).toBeTruthy(),
        );
        h.rtl.fireEvent.press(v().getByTestId('action-edit'));
        const input = await h.rtl.waitFor(() =>
          v().getByPlaceholderText('Enter message...'),
        );
        h.rtl.fireEvent.changeText(input, 'tell me a sea fact');
        h.rtl.fireEvent.press(v().getByText('SAVE & RESEND'));
        await h.rtl.waitFor(() =>
          expect(
            v().queryByText(/Octopuses have three hearts\./),
          ).not.toBeNull(),
        );

        // The edited question is version 2 of 2; the original turn and the one after it are put away.
        expectThread(
          'user: tell me a sea fact',
          'assistant: Octopuses have three hearts\\.',
        );
        expect(v().getByText('2/2')).toBeTruthy();

        h.rtl.fireEvent.press(v().getByLabelText('Previous question'));
        await h.rtl.waitFor(() => expect(v().getByText('1/2')).toBeTruthy());
        expectThread(
          'user: tell me a fact',
          'assistant: Honey never spoils\\.',
          'user: another one',
          'assistant: Bananas are berries\\.',
        );

        h.rtl.fireEvent.press(v().getByLabelText('Next question'));
        await h.rtl.waitFor(() => expect(v().getByText('2/2')).toBeTruthy());
        expectThread(
          'user: tell me a sea fact',
          'assistant: Octopuses have three hearts\\.',
        );

        // Resend an OLDER question: ask a follow-up, then Resend the first question from its action menu.
        await ask('and a land one', 'Cows have best friends.');
        await h.rtl.waitFor(() =>
          expect(v().queryByText(/Cows have best friends\./)).not.toBeNull(),
        );
        expectThread(
          'user: tell me a sea fact',
          'assistant: Octopuses have three hearts\\.',
          'user: and a land one',
          'assistant: Cows have best friends\\.',
        );
        nextAnswer('Sharks predate trees.');
        h.rtl.fireEvent(v().getAllByTestId('user-message')[0]!, 'longPress');
        await h.rtl.waitFor(() =>
          expect(v().getByTestId('action-menu')).toBeTruthy(),
        );
        expect(v().getByText('Resend')).toBeTruthy();
        h.rtl.fireEvent.press(v().getByTestId('action-retry'));
        await h.rtl.waitFor(() =>
          expect(v().queryByText(/Sharks predate trees\./)).not.toBeNull(),
        );

        // The resent answer is version 2 of 2 of the answer; the earlier answer and its follow-up are put away.
        expectThread(
          'user: tell me a sea fact',
          'assistant: Sharks predate trees\\.',
        );
        expect(v().getAllByText('2/2')).toHaveLength(2); // the question's versions and the answer's versions

        h.rtl.fireEvent.press(v().getByLabelText('Previous response'));
        await h.rtl.waitFor(() => expect(v().getByText('1/2')).toBeTruthy());
        expectThread(
          'user: tell me a sea fact',
          'assistant: Octopuses have three hearts\\.',
          'user: and a land one',
          'assistant: Cows have best friends\\.',
        );

        h.rtl.fireEvent.press(v().getByLabelText('Next response'));
        await h.rtl.waitFor(() =>
          expect(v().getAllByText('2/2')).toHaveLength(2),
        );
        expectThread(
          'user: tell me a sea fact',
          'assistant: Sharks predate trees\\.',
        );
      } finally {
        await restoreRemote();
      }
    },
  );
});
