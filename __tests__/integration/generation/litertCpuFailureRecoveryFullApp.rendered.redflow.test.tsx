/** P1 #29 — a LiteRT CPU invoke failure explains recovery and does not wedge Chat. */
import type { DownloadedModel } from '../../../src/types';
import { renderMainApp, sendChatMessage } from '../../harness/appJourney';

const liteRTModel: DownloadedModel = {
  id: 'test/gemma-cpu-recovery/gemma-cpu-recovery.litertlm',
  name: 'Gemma CPU Recovery',
  author: 'test',
  fileName: 'gemma-cpu-recovery.litertlm',
  filePath: '/docs/models/gemma-cpu-recovery.litertlm',
  fileSize: 128 * 1024 * 1024,
  quantization: 'LiteRT',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'litert',
  liteRTVision: false,
};

const STATUS_13 =
  'Status Code: 13. Message: ERROR: Failed to invoke the compiled model';

describe('P1 LiteRT CPU failure recovery full-App journey', () => {
  it('surfaces GPU recovery guidance, clears generation state, and succeeds after switching backend', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      downloadedModels: [liteRTModel],
    });
    const { act, fireEvent, waitFor } = rtl;

    fireEvent.press(view.getByTestId('browse-models-button'));
    fireEvent.press(await waitFor(() => view.getByTestId('model-item')));
    await waitFor(() =>
      expect(view.getByTestId('new-chat-button')).toBeTruthy(),
    );

    fireEvent.press(view.getByTestId('settings-tab'));
    fireEvent.press(await waitFor(() => view.getByText('Model Settings')));
    fireEvent.press(
      await waitFor(() => view.getByTestId('text-generation-accordion')),
    );
    fireEvent.press(
      await waitFor(() => view.getByTestId('text-advanced-toggle')),
    );
    const cpuButton = await waitFor(() =>
      view.getByTestId('litert-backend-cpu-button'),
    );
    expect(cpuButton.props.accessibilityState.selected).toBe(false);
    fireEvent.press(cpuButton);
    await waitFor(() =>
      expect(
        view.getByTestId('litert-backend-cpu-button').props.accessibilityState
          .selected,
      ).toBe(true),
    );

    fireEvent.press(view.getByTestId('back-button'));
    fireEvent.press(await waitFor(() => view.getByTestId('home-tab')));
    fireEvent.press(await waitFor(() => view.getByTestId('new-chat-button')));
    await waitFor(() => expect(view.getByTestId('chat-screen')).toBeTruthy());

    boundary.litert.scriptError(STATUS_13);
    sendChatMessage(rtl, view, 'Answer this on the selected backend');

    await waitFor(
      () => {
        const failure = view.getByTestId('model-failure-text');
        expect(rtl.within(failure).getByText('No response')).toBeTruthy();
        expect(
          rtl.within(failure).getByText(/incompatible backend/i),
        ).toBeTruthy();
        expect(
          rtl.within(failure).getByTestId('model-failure-retry-text'),
        ).toBeTruthy();
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.getByTestId('chat-input').props.value).toBe('');
      },
      { timeout: 8000 },
    );

    fireEvent.press(view.getByTestId('chat-settings-icon'));
    fireEvent.press(await waitFor(() => view.getByText('TEXT GENERATION')));
    fireEvent.press(
      await waitFor(() => view.getByTestId('modal-text-advanced-toggle')),
    );
    fireEvent.press(
      await waitFor(() => view.getByTestId('litert-backend-gpu-button')),
    );
    await waitFor(() =>
      expect(
        view.getByTestId('litert-backend-gpu-button').props.accessibilityState
          .selected,
      ).toBe(true),
    );
    fireEvent.press(view.getByText('Done'));

    const reloadBanner = await waitFor(
      () => view.getByTestId('reload-model-banner'),
      { timeout: 4000 },
    );
    await act(async () => fireEvent.press(reloadBanner));
    await waitFor(
      () => expect(view.queryByTestId('reload-model-banner')).toBeNull(),
      {
        timeout: 10000,
      },
    );

    boundary.litert.scriptTurn({ content: 'Recovered on GPU.' });
    fireEvent.press(view.getByTestId('model-failure-retry-text'));
    await waitFor(() =>
      expect(view.queryByTestId('model-failure-text')).toBeNull(),
    );
    await waitFor(
      () => {
        expect(view.getByText('Recovered on GPU.')).toBeTruthy();
        expect(view.queryByTestId('model-failure-text')).toBeNull();
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.getByTestId('chat-input').props.value).toBe('');
      },
      { timeout: 8000 },
    );

    view.unmount();
  }, 30000);
});
