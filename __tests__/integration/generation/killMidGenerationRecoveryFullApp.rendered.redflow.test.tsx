/**
 * P1 #173 — a force-kill during local generation must cold-relaunch into a coherent chat.
 *
 * This mounts the real App, sends through the rendered composer, and lets only the native llama
 * boundary pause after visible output. A second user intent is queued to prove that every piece of
 * process-local generation state really existed before the kill. The mounted tree is then discarded
 * and relaunchMainApp creates a fresh module graph while retaining only device persistence.
 *
 * The relaunched product must restore the durable user turn, omit the unfinished assistant stream and
 * abandoned in-memory queue, render no phantom busy UI, and successfully complete the next real send.
 */
import {
  relaunchMainApp,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

const MODEL_ID = 'test/journey-model/journey-model-Q4_K_M.gguf';
const FIRST_PROMPT = 'Preserve this prompt through a force kill';
const ABANDONED_QUEUED_PROMPT =
  'This queued turn belonged to the killed process';
const SHOWN_PARTIAL = 'A partial answer visible before the kill';
const NEXT_PROMPT = 'Does this fresh process still work?';
const NEXT_REPLY = 'Yes. The relaunched conversation is healthy.';

function renderedText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  if (Array.isArray(value)) return value.map(renderedText).join('');
  if (value && typeof value === 'object' && 'children' in value)
    return renderedText((value as { children: unknown[] }).children);
  return '';
}

describe('P1 #173 kill-mid-generation cold-relaunch recovery', () => {
  it('restores the durable chat without phantom work and completes the next send', async () => {
    const firstLaunch = await renderMainApp({
      boundary: { llama: true },
      persistedAppState: { activeModelId: MODEL_ID },
    });
    firstLaunch.boundary.llama!.scriptCompletion({
      text: `${SHOWN_PARTIAL}, followed by output that must never survive.`,
      pauseAfter: SHOWN_PARTIAL,
    });

    firstLaunch.rtl.fireEvent.press(
      firstLaunch.view.getByTestId('new-chat-button'),
    );
    await firstLaunch.rtl.waitFor(() =>
      expect(firstLaunch.view.getByTestId('chat-input')).toBeTruthy(),
    );

    sendChatMessage(firstLaunch.rtl, firstLaunch.view, FIRST_PROMPT);
    await firstLaunch.rtl.waitFor(
      () => {
        expect(firstLaunch.view.getByText(SHOWN_PARTIAL)).toBeTruthy();
        expect(firstLaunch.view.getByTestId('stop-button')).toBeTruthy();
      },
      { timeout: 8000 },
    );

    // Establish that the killed process owns both an active stream and queued work. Neither may
    // become a phantom generation after the new process hydrates durable conversation history.
    sendChatMessage(firstLaunch.rtl, firstLaunch.view, ABANDONED_QUEUED_PROMPT);
    await firstLaunch.rtl.waitFor(() => {
      expect(firstLaunch.view.getByTestId('queue-indicator')).toBeTruthy();
      expect(firstLaunch.view.getByText('1 queued')).toBeTruthy();
      expect(
        firstLaunch.view.getByText(/This queued turn belonged to the killed/),
      ).toBeTruthy();
    });

    // A force-kill gives React no cleanup callback and gives native no opportunity to finish. Dropping
    // this tree plus relaunchMainApp's resetModules models that process boundary without pressing Stop.
    firstLaunch.view.unmount();

    const relaunched = await relaunchMainApp({ boundary: { llama: true } });
    relaunched.rtl.fireEvent.press(relaunched.view.getByTestId('chats-tab'));
    await relaunched.rtl.waitFor(() =>
      expect(relaunched.view.getByText(FIRST_PROMPT)).toBeTruthy(),
    );
    relaunched.rtl.fireEvent.press(
      relaunched.view.getByTestId('conversation-item-0'),
    );

    await relaunched.rtl.waitFor(() => {
      const chat = relaunched.rtl.within(
        relaunched.view.getByTestId('chat-screen'),
      );
      expect(chat.getAllByText(FIRST_PROMPT).length).toBeGreaterThan(0);
      expect(chat.queryByText(SHOWN_PARTIAL)).toBeNull();
      expect(chat.queryByText(ABANDONED_QUEUED_PROMPT)).toBeNull();
      expect(chat.queryByTestId('stop-button')).toBeNull();
      expect(chat.queryByTestId('queue-indicator')).toBeNull();
      expect(chat.getByTestId('chat-input').props.value).toBe('');
      expect(chat.getByTestId('chat-input').props.editable).toBe(true);
    });

    relaunched.boundary.llama!.scriptCompletion({ text: NEXT_REPLY });
    sendChatMessage(relaunched.rtl, relaunched.view, NEXT_PROMPT);
    await relaunched.rtl.waitFor(
      () => {
        expect(relaunched.view.getByText(NEXT_REPLY)).toBeTruthy();
        expect(relaunched.view.queryByTestId('stop-button')).toBeNull();
        expect(relaunched.view.queryByTestId('queue-indicator')).toBeNull();
      },
      { timeout: 8000 },
    );

    const turns = relaunched.view
      .getAllByTestId('message-text')
      .map(renderedText);
    expect(turns).toHaveLength(3);
    expect(turns[0]).toContain(FIRST_PROMPT);
    expect(turns[1]).toContain(NEXT_PROMPT);
    expect(turns[2]).toContain(NEXT_REPLY);
    expect(turns.join('\n')).not.toContain(SHOWN_PARTIAL);
    expect(turns.join('\n')).not.toContain(ABANDONED_QUEUED_PROMPT);

    relaunched.view.unmount();
  }, 30000);
});
