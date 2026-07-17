/** P1 #150 — prompt enhancement disables thinking before the native utility request. */
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
const CLEAN_PROMPT =
  'a photorealistic tabby cat in a sunlit garden, shallow depth of field';
const NATIVE_REASONING =
  'I should analyze lighting, style, composition, and every possible variation before rewriting.';

const THINKING_MODEL: DownloadedModel = {
  id: 'test/gemma-4-enhancement/gemma-4-enhancement-Q4_K_M.gguf',
  name: 'Gemma 4 Enhancement',
  author: 'test',
  fileName: 'gemma-4-enhancement-Q4_K_M.gguf',
  filePath: '/docs/models/gemma-4-enhancement-Q4_K_M.gguf',
  fileSize: 128 * 1024 * 1024,
  quantization: 'Q4_K_M',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'llama',
};

function isEnhancementRequest(value: unknown): value is {
  enable_thinking?: boolean;
  reasoning_format?: string;
  messages?: Array<{ role: string; content?: string }>;
} {
  if (!value || typeof value !== 'object') return false;
  const messages = (value as { messages?: unknown }).messages;
  return (
    Array.isArray(messages) &&
    messages.some(
      message =>
        message?.role === 'system' &&
        /image generation prompt/i.test(message.content ?? ''),
    )
  );
}

describe('P1 full-App image-prompt enhancement without thinking', () => {
  it('keeps native reasoning out of the enhanced image request and completes cleanly', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        llama: true,
        ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
      downloadedModels: [THINKING_MODEL],
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
    rtl.fireEvent(enhanceToggle, 'change', { nativeEvent: { value: true } });
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
    const thinkingToggle = await rtl.waitFor(() =>
      view.getByTestId('quick-thinking-toggle'),
    );
    expect(rtl.within(thinkingToggle).getByText('OFF')).toBeTruthy();
    rtl.fireEvent.press(thinkingToggle);
    await rtl.waitFor(() =>
      expect(
        rtl.within(view.getByTestId('quick-thinking-toggle')).getByText('ON'),
      ).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('quick-image-mode'));
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
      text: CLEAN_PROMPT,
      reasoning: NATIVE_REASONING,
    });
    sendChatMessage(rtl, view, RAW_PROMPT);

    await rtl.waitFor(
      () => {
        expect(view.getByText('Enhanced prompt')).toBeTruthy();
        expect(view.getByText(CLEAN_PROMPT)).toBeTruthy();
        expect(view.getAllByTestId('generated-image')).toHaveLength(1);
        expect(
          view.queryByText(/analyze lighting|<\|channel>|<think>/i),
        ).toBeNull();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('send-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
      },
      { timeout: 10000 },
    );

    const enhancementRequest = boundary
      .llama!.calls.completion.map(call => call[0])
      .find(isEnhancementRequest);
    expect(enhancementRequest).toBeDefined();
    expect(enhancementRequest!.enable_thinking).toBe(false);
    expect(enhancementRequest!.reasoning_format).toBe('none');

    expect(boundary.diffusion.calls.generateImage).toHaveLength(1);
    const downstreamPrompt = String(
      boundary.diffusion.calls.generateImage[0].prompt,
    );
    expect(downstreamPrompt).toBe(CLEAN_PROMPT);
    expect(downstreamPrompt).not.toMatch(
      /analyze lighting|<\|channel>|<think>|Thinking Process/i,
    );

    view.unmount();
  }, 30000);
});
