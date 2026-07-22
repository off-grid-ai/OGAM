/** P2 #152 — image-prompt enhancement shows live progress in the real full-App journey. */
import { Modal } from 'react-native';
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
  seedDownloadedMnnImageModel,
  sendChatMessage,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const RAW_PROMPT = 'draw a cat';
const PARTIAL_PROMPT = 'a photorealistic tabby cat';
const ENHANCED_PROMPT =
  'a photorealistic tabby cat in a sunlit garden, shallow depth of field';
const TEXT_MODEL: DownloadedModel = {
  id: 'test/llama-3-enhancement-progress/llama-3-enhancement-progress-Q4_K_M.gguf',
  name: 'Llama 3 Enhancement Progress',
  author: 'test',
  fileName: 'llama-3-enhancement-progress-Q4_K_M.gguf',
  filePath: '/docs/models/llama-3-enhancement-progress-Q4_K_M.gguf',
  fileSize: 128 * 1024 * 1024,
  quantization: 'Q4_K_M',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'llama',
};

describe('P2 full-App image-prompt enhancement progress', () => {
  it('streams the partial enhancement before completing one clean image turn', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        llama: true,
        ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
      downloadedModels: [TEXT_MODEL],
      beforeRender: async ({ boundary: native, asyncStorage }) => {
        await seedDownloadedMnnImageModel(native, asyncStorage);
      },
    });

    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByText('Model Settings')),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('image-generation-accordion')),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('image-advanced-toggle')),
    );
    const enhanceToggle = await rtl.waitFor(() =>
      view.getByTestId('enhance-image-prompts-switch'),
    );
    expect(enhanceToggle.props.on).toBe(false);
    rtl.fireEvent(enhanceToggle, 'change', {
      nativeEvent: { value: true },
    });
    await rtl.waitFor(() =>
      expect(view.getByTestId('enhance-image-prompts-switch').props.on).toBe(
        true,
      ),
    );

    rtl.fireEvent.press(view.getByTestId('back-button'));
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('home-tab')));
    await openChatWithJourneyModel(rtl, view);

    rtl.fireEvent.press(view.getByTestId('model-selector'));
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByText('Image')));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('image-model-row-journey-mnn')),
    );
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-screen')).toBeTruthy(),
    );

    rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('quick-image-mode')),
    );
    await rtl.waitFor(() =>
      expect(view.getByTestId('image-mode-force-badge')).toBeTruthy(),
    );
    const settingsModal = view
      .UNSAFE_getAllByType(Modal)
      .find(modal => modal.props.visible);
    expect(settingsModal).toBeTruthy();
    await rtl.act(async () => {
      rtl.fireEvent(settingsModal!, 'requestClose');
    });

    boundary.llama!.scriptCompletion({
      text: ENHANCED_PROMPT,
      pauseAfter: PARTIAL_PROMPT,
    });
    sendChatMessage(rtl, view, RAW_PROMPT);

    await rtl.waitFor(
      () => {
        expect(view.getByText('Enhancing prompt with AI...')).toBeTruthy();
        expect(view.getByTestId('thinking-indicator')).toHaveTextContent(
          new RegExp(PARTIAL_PROMPT, 'i'),
        );
        expect(view.queryByText(ENHANCED_PROMPT)).toBeNull();
        expect(view.queryByTestId('generated-image')).toBeNull();
      },
      { timeout: 8000 },
    );

    await rtl.act(async () => {
      boundary.llama!.releaseStream();
    });

    await rtl.waitFor(
      () => {
        expect(view.getAllByText('Enhanced prompt')).toHaveLength(1);
        expect(view.getAllByText(ENHANCED_PROMPT)).toHaveLength(1);
        expect(view.getAllByTestId('generated-image')).toHaveLength(1);
        expect(view.queryByText('Enhancing prompt with AI...')).toBeNull();
        expect(
          view.queryByText(/<think>|<\|channel>|Thinking Process/i),
        ).toBeNull();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('send-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
      },
      { timeout: 10000 },
    );

    expect(boundary.diffusion.calls.generateImage).toHaveLength(1);
    expect(boundary.diffusion.calls.generateImage[0].prompt).toBe(
      ENHANCED_PROMPT,
    );

    view.unmount();
  }, 30000);
});
