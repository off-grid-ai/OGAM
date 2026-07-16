/**
 * HAPPY-PATH (UI, BEHAVIORAL) — vision: the user attaches a photo and sends; a vision-capable model receives
 * the image at the native boundary and its answer about it renders.
 *
 * Real ChatScreen + real useAttachments + generation + liteRTService; only native leaves faked (the image
 * picker returns a mock image; the LiteRT native records the media it was handed). The model is selected via
 * the real Home picker and is vision-capable; the photo is attached via the real attach-photo gesture.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import type { Message } from '../../../src/types';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('happy — attach a photo and a vision model answers about it (heavy entry point)', () => {
  it('includes the attached image at the native boundary and renders the answer', async () => {
    const h = await setupChatScreen({ engine: 'litert', vision: true });
    h.render();

    // Real attach-photo gesture (the faked native picker returns an image), then type + send.
    await h.attachImageViaUI();
    await h.send('what is in this image', { content: 'I see a tabby cat sitting on a windowsill.' });

    // The model's answer about the image renders.
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/tabby cat sitting on a windowsill/)).not.toBeNull(); });

    // The attached image reached the native model (sendMessageWithImages / sendMessageWithMedia).
    const mediaArgs = [...h.boundary.litert.calls.sendMessageWithMedia, ...h.boundary.litert.calls.sendMessageWithImages].flat(2);
    expect(JSON.stringify(mediaArgs)).toMatch(/mock\/image\.jpg/);
    void ({} as Message);
  });
});
