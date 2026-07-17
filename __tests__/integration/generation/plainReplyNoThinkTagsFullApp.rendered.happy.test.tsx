/** P1 #38 — plain GGUF and LiteRT replies do not expose an empty native think block. */
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
  type RenderedAppJourney,
} from '../../harness/appJourney';

const PROMPT = 'Reply with only the capital of France.';
const CLEAN_REPLY = 'Paris is the capital of France.';
const EMPTY_THINK_REPLY = `<think>\n\n</think>${CLEAN_REPLY}`;

const liteRTModel: DownloadedModel = {
  id: 'test/plain-reply/plain-reply.litertlm',
  name: 'Plain Reply LiteRT',
  author: 'test',
  fileName: 'plain-reply.litertlm',
  filePath: '/docs/models/plain-reply.litertlm',
  fileSize: 128 * 1024 * 1024,
  quantization: 'LiteRT',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'litert',
  liteRTVision: false,
};

async function expectCleanTerminalReply(
  journey: RenderedAppJourney,
): Promise<void> {
  const { rtl, view } = journey;

  await rtl.waitFor(
    () => {
      const assistantMessages = view.getAllByTestId('assistant-message');
      expect(assistantMessages).toHaveLength(1);
      expect(
        rtl.within(assistantMessages[0]).getByText(CLEAN_REPLY),
      ).toBeTruthy();
      expect(view.queryByText(/<\/?think>/i)).toBeNull();
      expect(view.queryByTestId('thinking-block')).toBeNull();
      expect(view.queryByTestId('thinking-indicator')).toBeNull();
      expect(view.queryByTestId('streaming-thinking-hint')).toBeNull();
      expect(view.queryByTestId('stop-button')).toBeNull();
      expect(view.queryByTestId('send-button')).toBeNull();
      expect(view.getByTestId('chat-input').props.value).toBe('');
    },
    { timeout: 8000 },
  );
}

describe('P1 plain-reply full-App journeys', () => {
  it('renders a GGUF plain reply once without empty think tags or thinking UI', async () => {
    const journey = await renderMainApp({ boundary: { llama: true } });
    const { boundary, rtl, view } = journey;
    boundary.llama!.scriptCompletion({ text: EMPTY_THINK_REPLY });

    await openChatWithJourneyModel(rtl, view);
    sendChatMessage(rtl, view, PROMPT);

    await expectCleanTerminalReply(journey);
    view.unmount();
  }, 30000);

  it('renders a LiteRT plain reply once without empty think tags or thinking UI', async () => {
    const journey = await renderMainApp({ downloadedModels: [liteRTModel] });
    const { boundary, rtl, view } = journey;
    boundary.litert.scriptTurn({ content: EMPTY_THINK_REPLY });

    await openChatWithJourneyModel(rtl, view);
    sendChatMessage(rtl, view, PROMPT);

    await expectCleanTerminalReply(journey);
    view.unmount();
  }, 30000);
});
