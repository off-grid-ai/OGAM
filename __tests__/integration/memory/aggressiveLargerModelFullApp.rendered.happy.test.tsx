/** P1 #97 — Aggressive admits a larger local model without an override prompt. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';
import type { DownloadedModel } from '../../../src/types';

const LARGE_MODEL: DownloadedModel = {
  id: 'test/aggressive-large/aggressive-large-Q4_K_M.gguf',
  name: 'Aggressive Large Model',
  author: 'test',
  fileName: 'aggressive-large-Q4_K_M.gguf',
  filePath: '/docs/models/aggressive-large-Q4_K_M.gguf',
  // Android's normal text working-set multiplier makes this exceed the balanced
  // ceiling on an 8 GB device while remaining below the aggressive ceiling.
  fileSize: 2.5 * GB,
  quantization: 'Q4_K_M',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'llama',
};

describe('P1 #97 aggressive larger-model loading', () => {
  it('loads and replies automatically after Aggressive is selected in Model Settings', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        llama: true,
        ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
      downloadedModels: [LARGE_MODEL],
    });

    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByText('Model Settings')),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() =>
        view.getByTestId('model-loading-mode-aggressive-button'),
      ),
    );
    await rtl.waitFor(() =>
      expect(
        view.getByTestId('model-loading-mode-aggressive-button').props
          .accessibilityState.selected,
      ).toBe(true),
    );
    rtl.fireEvent.press(view.getByTestId('back-button'));
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('home-tab')));

    await openChatWithJourneyModel(rtl, view);
    boundary.llama!.scriptCompletion({
      text: 'The larger model loaded automatically.',
    });
    sendChatMessage(rtl, view, 'Use the larger model.');

    await rtl.waitFor(
      () => {
        expect(
          view.getByText('The larger model loaded automatically.'),
        ).toBeTruthy();
        expect(view.queryByText('Load Anyway')).toBeNull();
        expect(view.queryByText('Insufficient Memory')).toBeNull();
        expect(view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 15000 },
    );

    view.unmount();
  }, 40000);
});
