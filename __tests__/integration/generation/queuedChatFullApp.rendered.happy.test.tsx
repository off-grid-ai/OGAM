/** P1 #44 — a second rendered send queues behind an in-flight GGUF turn. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

function renderedText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  if (Array.isArray(value)) return value.map(renderedText).join('');
  if (value && typeof value === 'object' && 'children' in value)
    return renderedText((value as { children: unknown[] }).children);
  return '';
}

describe('P1 full-app queued chat journey', () => {
  it('shows queued feedback and drains the second turn after the first finishes', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
    });
    boundary.llama!.scriptCompletions([
      {
        text: 'First response complete.',
        pauseAfter: 'First response',
      },
      { text: 'Second response complete.' },
    ]);
    await openChatWithJourneyModel(rtl, view);

    sendChatMessage(rtl, view, 'first prompt');
    await rtl.waitFor(() => {
      expect(view.getByText('First response')).toBeTruthy();
      expect(view.getByTestId('stop-button')).toBeTruthy();
    });

    sendChatMessage(rtl, view, 'second prompt');
    await rtl.waitFor(() => {
      const queue = view.getByTestId('queue-indicator');
      expect(rtl.within(queue).getByText('1 queued')).toBeTruthy();
      expect(rtl.within(queue).getByText('second prompt')).toBeTruthy();
      expect(view.getByTestId('stop-button')).toBeTruthy();
      expect(view.getByTestId('chat-input').props.value).toBe('');
    });

    boundary.llama!.releaseStream();
    await rtl.waitFor(
      () => {
        expect(view.getByText('First response complete.')).toBeTruthy();
        expect(view.getByText('Second response complete.')).toBeTruthy();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.getByTestId('chat-input').props.value).toBe('');
      },
      { timeout: 8000 },
    );

    // Settle beyond the queue-drain timer and prove the terminal rendered
    // transcript contains exactly one FIFO turn for each user intent.
    await rtl.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 250));
    });
    const chat = view.getByTestId('chat-screen');
    const turns = rtl
      .within(chat)
      .getAllByTestId('message-text')
      .map(renderedText);
    expect(turns).toHaveLength(4);
    expect(turns[0]).toContain('first prompt');
    expect(turns[1]).toContain('First response complete.');
    expect(turns[2]).toContain('second prompt');
    expect(turns[3]).toContain('Second response complete.');

    rtl.fireEvent.changeText(
      view.getByTestId('chat-input'),
      'composer is ready again',
    );
    await rtl.waitFor(() => {
      expect(view.getByTestId('chat-input').props.value).toBe(
        'composer is ready again',
      );
      expect(view.getByTestId('send-button')).toBeTruthy();
      expect(view.queryByTestId('queue-indicator')).toBeNull();
      expect(view.queryByTestId('stop-button')).toBeNull();
    });
    view.unmount();
  }, 30000);
});
