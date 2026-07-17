/** APP-P1-010 — LiteRT persists compaction summary/cutoff across a full App relaunch. */
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  relaunchMainApp,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

const FIRST = `First context detail: ${'alpha '.repeat(45)}`;
const SECOND = `Recent context detail: ${'beta '.repeat(45)}`;
const SUMMARY =
  'The user established an alpha detail, followed by a recent beta detail.';

const model: DownloadedModel = {
  id: 'test/compaction/compaction.litertlm',
  name: 'Compaction Model',
  author: 'test',
  filePath: '/docs/models/compaction.litertlm',
  fileName: 'compaction.litertlm',
  fileSize: 128 * 1024 * 1024,
  quantization: 'INT4',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'litert',
  liteRTVision: false,
};

describe('APP-P1-010 full-App LiteRT compaction persistence', () => {
  it('keeps the summary cutoff and recent transcript when the conversation is reopened', async () => {
    const first = await renderMainApp({ downloadedModels: [model] });
    first.boundary.litert.module.loadModel.mockResolvedValue({
      backend: 'gpu',
      maxNumTokens: 500,
    });
    await openChatWithJourneyModel(first.rtl, first.view);
    first.boundary.litert.scriptTurns([
      // Non-vision LiteRT primes the native conversation once before the first user turn.
      { content: '' },
      {
        content: 'Alpha detail acknowledged.',
        benchmark: { prefillTokenCount: 400, decodeTokenCount: 4 },
      },
      { content: 'Beta detail acknowledged.' },
      { content: SUMMARY },
      { content: 'Both details remain available after compaction.' },
    ]);
    sendChatMessage(first.rtl, first.view, FIRST);
    await first.rtl.waitFor(() =>
      expect(first.view.getByText('Alpha detail acknowledged.')).toBeTruthy(),
    );
    sendChatMessage(first.rtl, first.view, SECOND);
    await first.rtl.waitFor(() =>
      expect(first.view.getByText('Beta detail acknowledged.')).toBeTruthy(),
    );
    sendChatMessage(first.rtl, first.view, 'Keep both details in mind.');
    await first.rtl.waitFor(() =>
      expect(
        first.view.getByText('Both details remain available after compaction.'),
      ).toBeTruthy(),
    );
    expect(
      first.boundary.litert.calls.resetConversation.length,
    ).toBeGreaterThan(2);
    first.view.unmount();

    const second = await relaunchMainApp();
    second.rtl.fireEvent.press(second.view.getByTestId('chats-tab'));
    second.rtl.fireEvent.press(
      await second.rtl.waitFor(() =>
        second.view.getByText(/First context detail:/),
      ),
    );
    await second.rtl.waitFor(() => {
      expect(second.view.getByText(SECOND)).toBeTruthy();
      expect(
        second.view.getByText(
          'Both details remain available after compaction.',
        ),
      ).toBeTruthy();
    });

    second.boundary.litert.scriptTurn({
      content: 'I remember the compacted alpha and recent beta details.',
    });
    sendChatMessage(second.rtl, second.view, 'What details do you remember?');
    await second.rtl.waitFor(() =>
      expect(
        second.view.getByText(
          'I remember the compacted alpha and recent beta details.',
        ),
      ).toBeTruthy(),
    );

    const reset = second.boundary.litert.calls.resetConversation.at(-1);
    const restoredHistory = JSON.parse(String(reset?.[5])) as Array<{
      role: string;
      content: string;
    }>;
    expect(restoredHistory[0].content).toContain(SUMMARY);
    expect(
      restoredHistory.some(
        turn => turn.content === 'Beta detail acknowledged.',
      ),
    ).toBe(true);
    expect(restoredHistory.some(turn => turn.content === FIRST)).toBe(false);

    second.view.unmount();
  }, 30000);
});
