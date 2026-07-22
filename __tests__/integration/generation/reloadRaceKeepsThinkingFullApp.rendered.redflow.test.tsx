/** P1 #190 — a send racing a Settings reload keeps the model's thinking capability. */
import { Modal, Platform } from 'react-native';
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

const REASONING =
  'Seventeen has no divisors below its square root, so it is prime.';
const ANSWER = 'Yes, 17 is prime.';
const GEMMA_MODEL: DownloadedModel = {
  id: 'test/reload-race/gemma-4-Q4_K_M.gguf',
  name: 'Gemma 4',
  author: 'test',
  fileName: 'gemma-4-Q4_K_M.gguf',
  filePath: '/docs/models/gemma-4-Q4_K_M.gguf',
  fileSize: 128 * 1024 * 1024,
  quantization: 'Q4_K_M',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'llama',
};

describe('P1 full-App Settings reload and send race', () => {
  it('waits for capability detection and renders the racing turn reasoning', async () => {
    const journey = await renderMainApp({
      boundary: { llama: true },
      downloadedModels: [GEMMA_MODEL],
    });
    const { boundary, rtl, view } = journey;
    const backend = Platform.OS === 'ios' ? 'metal' : 'opencl';

    await openChatWithJourneyModel(rtl, view);

    // Reach the thinking setting through the rendered quick-settings affordance.
    rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
    const thinkingToggle = await rtl.waitFor(() =>
      view.getByTestId('quick-thinking-toggle'),
    );
    rtl.fireEvent.press(thinkingToggle);
    await rtl.waitFor(() =>
      expect(
        rtl.within(view.getByTestId('quick-thinking-toggle')).getByText('ON'),
      ).toBeTruthy(),
    );
    const quickSettingsModal = view
      .UNSAFE_getAllByType(Modal)
      .find(modal => modal.props.visible);
    expect(quickSettingsModal).toBeTruthy();
    rtl.fireEvent(quickSettingsModal!, 'requestClose');

    // Load once so the next settings change is a genuine reload of a known
    // reasoning-capable context rather than an initial-load scenario.
    boundary.llama!.scriptCompletion({ text: 'Ready to reason.' });
    sendChatMessage(rtl, view, 'Get ready');
    await rtl.waitFor(
      () => {
        expect(view.getByText('Ready to reason.')).toBeTruthy();
        expect(view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 8000 },
    );

    // Change a load-time setting through the real in-chat Settings sheet.
    rtl.fireEvent.press(view.getByTestId('chat-settings-icon'));
    await rtl.waitFor(() =>
      expect(view.getByText('Chat Settings')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByText('TEXT GENERATION'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('modal-text-advanced-toggle')),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId(`backend-${backend}-button`)),
    );
    const settingsModal = view
      .UNSAFE_getAllByType(Modal)
      .find(
        modal =>
          modal.props.visible &&
          rtl.within(modal).queryByText('Chat Settings') != null,
      );
    expect(settingsModal).toBeTruthy();
    rtl.fireEvent(settingsModal!, 'requestClose');

    const reloadBanner = await rtl.waitFor(() =>
      view.getByTestId('reload-model-banner'),
    );
    boundary.llama!.scriptMultimodalHold();
    boundary.llama!.scriptCompletion({
      text: ANSWER,
      thinkingText: `<think>${REASONING}</think>${ANSWER}`,
    });

    // Begin the reload and hold it at the native capability-probe boundary —
    // the exact window in which the device report's Send arrived.
    rtl.fireEvent.press(reloadBanner);
    await rtl.waitFor(
      () => expect(boundary.llama!.multimodalHoldActive()).toBe(true),
      { timeout: 6000 },
    );

    sendChatMessage(rtl, view, 'Is 17 prime?');
    // Give the racing Send time to reach readiness while the capability probe is
    // still held. A broken early-published context starts completion here with
    // stale thinking=false; the correct pipeline remains parked behind the load.
    await rtl.act(() => new Promise<void>(resolve => setTimeout(resolve, 100)));
    await rtl.act(async () => {
      boundary.llama!.releaseMultimodalHold();
    });

    await rtl.waitFor(
      () => {
        expect(view.getByText(ANSWER)).toBeTruthy();
        expect(view.getByTestId('thinking-block')).toBeTruthy();
        expect(view.getByText(REASONING)).toBeTruthy();
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
        expect(view.queryByTestId('reload-model-banner')).toBeNull();
      },
      { timeout: 10000 },
    );

    expect(boundary.llama!.calls.completion.at(-1)?.[0]).toEqual(
      expect.objectContaining({ enable_thinking: true }),
    );
    view.unmount();
  }, 30000);
});
