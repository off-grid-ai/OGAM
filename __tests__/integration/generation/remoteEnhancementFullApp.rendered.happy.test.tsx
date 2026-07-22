/** P1 #144 — remote text-model prompt enhancement completes through the real App. */
import { Modal } from 'react-native';
import {
  renderMainApp,
  seedDownloadedMnnImageModel,
  sendChatMessage,
} from '../../harness/appJourney';
import {
  installRemoteDiscoveryBoundary,
  openRemoteChatThroughApp,
} from '../../harness/fullAppRemoteJourney';
import { installRemoteStream } from '../../harness/remoteHarness';
import { GB } from '../../harness/nativeBoundary';

const RAW_PROMPT = 'draw a cat';
const ENHANCED_PROMPT =
  'a photorealistic tabby cat on a windowsill in soft morning light';
const ENHANCED_SSE =
  'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n' +
  'data: {"choices":[{"delta":{"content":"a photorealistic tabby cat "}}]}\n\n' +
  'data: {"choices":[{"delta":{"content":"on a windowsill in soft morning light"}}]}\n\n' +
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
  'data: [DONE]\n\n';

describe('P1 full-App remote prompt enhancement', () => {
  it('uses the selected remote text model to enhance the downstream image prompt', async () => {
    installRemoteDiscoveryBoundary();
    const app = await renderMainApp({
      boundary: {
        ram: { platform: 'ios', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
      beforeRender: async ({ boundary, asyncStorage }) => {
        await seedDownloadedMnnImageModel(boundary, asyncStorage);
      },
    });

    app.rtl.fireEvent.press(app.view.getByTestId('settings-tab'));
    app.rtl.fireEvent.press(
      await app.rtl.waitFor(() => app.view.getByText('Model Settings')),
    );
    app.rtl.fireEvent.press(
      await app.rtl.waitFor(() =>
        app.view.getByTestId('image-generation-accordion'),
      ),
    );
    app.rtl.fireEvent.press(
      await app.rtl.waitFor(() =>
        app.view.getByTestId('image-advanced-toggle'),
      ),
    );
    const enhanceToggle = await app.rtl.waitFor(() =>
      app.view.getByTestId('enhance-image-prompts-switch'),
    );
    app.rtl.fireEvent(enhanceToggle, 'change', {
      nativeEvent: { value: true },
    });
    await app.rtl.waitFor(() =>
      expect(
        app.view.getByTestId('enhance-image-prompts-switch').props.value ??
          app.view.getByTestId('enhance-image-prompts-switch').props.on,
      ).toBe(true),
    );

    app.rtl.fireEvent.press(app.view.getByTestId('back-button'));
    app.rtl.fireEvent.press(
      await app.rtl.waitFor(() => app.view.getByTestId('home-tab')),
    );
    await openRemoteChatThroughApp(app.rtl, app.view);

    app.rtl.fireEvent.press(app.view.getByTestId('model-selector'));
    app.rtl.fireEvent.press(
      await app.rtl.waitFor(() => app.view.getByText('Image')),
    );
    app.rtl.fireEvent.press(
      await app.rtl.waitFor(() =>
        app.view.getByTestId('image-model-row-journey-mnn'),
      ),
    );
    await app.rtl.waitFor(() =>
      expect(app.view.getByTestId('chat-screen')).toBeTruthy(),
    );

    app.rtl.fireEvent.press(app.view.getByTestId('quick-settings-button'));
    app.rtl.fireEvent.press(
      await app.rtl.waitFor(() => app.view.getByTestId('quick-image-mode')),
    );
    await app.rtl.waitFor(() =>
      expect(app.view.getByTestId('image-mode-force-badge')).toBeTruthy(),
    );
    const settingsModal = app.view
      .UNSAFE_getAllByType(Modal)
      .find(modal => modal.props.visible);
    if (!settingsModal) throw new Error('Quick settings modal did not open');
    await app.rtl.act(async () => {
      app.rtl.fireEvent(settingsModal, 'requestClose');
    });

    installRemoteStream(ENHANCED_SSE);
    sendChatMessage(app.rtl, app.view, RAW_PROMPT);

    await app.rtl.waitFor(
      () => {
        expect(app.view.getByText('Enhanced prompt')).toBeTruthy();
        expect(app.view.getByText(ENHANCED_PROMPT)).toBeTruthy();
        expect(app.view.getAllByTestId('generated-image')).toHaveLength(1);
        expect(app.view.getByTestId('chat-input').props.value).toBe('');
        expect(app.view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 10000 },
    );

    expect(app.boundary.diffusion.calls.generateImage).toHaveLength(1);
    expect(app.boundary.diffusion.calls.generateImage[0].prompt).toBe(
      ENHANCED_PROMPT,
    );
    app.view.unmount();
  }, 30000);
});
