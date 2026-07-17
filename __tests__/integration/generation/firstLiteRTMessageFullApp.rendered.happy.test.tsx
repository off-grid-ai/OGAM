/** P1 #24 — the first LiteRT message lazy-loads the selected model and renders its reply. */
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

const liteRTModel: DownloadedModel = {
  id: 'test/gemma-first-message/gemma-first-message.litertlm',
  name: 'Gemma First Message',
  author: 'test',
  fileName: 'gemma-first-message.litertlm',
  filePath: '/docs/models/gemma-first-message.litertlm',
  fileSize: 128 * 1024 * 1024,
  quantization: 'LiteRT',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'litert',
};

describe('P1 first LiteRT message full-App journey', () => {
  it('stays nonresident until send, then shows the reply and selected resident model', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      downloadedModels: [liteRTModel],
    });
    const { act, fireEvent, waitFor } = rtl;

    await openChatWithJourneyModel(rtl, view);

    await act(async () => {
      fireEvent.press(view.getByTestId('model-selector'));
    });
    await waitFor(() => {
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /Gemma First Message/,
      );
      expect(view.queryByTestId('models-row-text-ram')).toBeNull();
      expect(view.queryByTestId('models-row-text-eject')).toBeNull();
    });
    await act(async () => {
      fireEvent.press(view.getByText('Done'));
    });
    await waitFor(() => expect(view.getByTestId('chat-input')).toBeTruthy());

    boundary.litert.scriptTurn({
      content: 'Paris is the capital of France.',
    });
    sendChatMessage(rtl, view, 'What is the capital of France?');

    await waitFor(
      () => {
        expect(
          view.getAllByText('What is the capital of France?').length,
        ).toBeGreaterThan(0);
        expect(view.getByText('Paris is the capital of France.')).toBeTruthy();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('send-button')).toBeNull();
      },
      { timeout: 8000 },
    );

    await act(async () => {
      fireEvent.press(view.getByTestId('model-selector'));
    });
    await waitFor(() => {
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /Gemma First Message/,
      );
      expect(view.getByTestId('models-row-text-ram')).toBeTruthy();
      expect(view.getByTestId('models-row-text-eject')).toBeTruthy();
    });

    view.unmount();
  }, 30000);
});
