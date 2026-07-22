/** P1 #132 — a successful tool result remains visible when LiteRT's final turn is empty. */
import { Switch } from 'react-native';
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

const TOOL_MODEL: DownloadedModel = {
  id: 'test/empty-final-tools/empty-final-tools.litertlm',
  name: 'Empty Final Tool Model',
  author: 'test',
  fileName: 'empty-final-tools.litertlm',
  filePath: '/docs/models/empty-final-tools.litertlm',
  fileSize: 128 * 1024 * 1024,
  quantization: 'LiteRT',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'litert',
  liteRTVision: false,
};

describe('P1 #132 full-App empty final tool turn', () => {
  it('renders the calculator result as the answer instead of a blank response', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      downloadedModels: [TOOL_MODEL],
    });
    await openChatWithJourneyModel(rtl, view);

    // First send reaches the loaded-capability state through the real lazy loader.
    boundary.litert.scriptTurn({ content: 'Ready.' });
    sendChatMessage(rtl, view, 'Reply when ready.');
    await rtl.waitFor(() => expect(view.getByText('Ready.')).toBeTruthy());

    // Enable Calculator through the real quick-settings and Tools hierarchy.
    rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('quick-tools')),
    );
    const calculator = await rtl.waitFor(() =>
      view.getByTestId('tool-picker-row-calculator'),
    );
    rtl.fireEvent(
      rtl.within(calculator).UNSAFE_getByType(Switch),
      'valueChange',
      true,
    );
    rtl.fireEvent.press(view.getByTestId('tools-back-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-screen')).toBeTruthy(),
    );

    boundary.litert.scriptTurn({
      toolCalls: [{ name: 'calculator', arguments: { expression: '2+2' } }],
      content: '',
    });
    sendChatMessage(rtl, view, 'What is 2 + 2?');

    await rtl.waitFor(
      () => {
        expect(
          view.getByTestId('tool-result-label-calculator'),
        ).toHaveTextContent('2+2 = 4');
        const answers = view.getAllByTestId('assistant-message');
        expect(
          rtl.within(answers[answers.length - 1]).getByTestId('message-text'),
        ).toHaveTextContent('2+2 = 4');
        expect(view.queryByText(/\(No response\)/)).toBeNull();
        expect(view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 10000 },
    );

    view.unmount();
  }, 30000);
});
