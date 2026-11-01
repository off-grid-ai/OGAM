/** A foreground image request must not load a dirty diffusion model into low live RAM. */
import { setupChatScreen } from '../../harness/chatHarness';
import { GB, MB } from '../../harness/nativeBoundary';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

describe('Android image generation under live memory pressure', () => {
  it('refuses the image load instead of co-residing with text when only 1GB is available', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'android',
      ram: { platform: 'android', totalBytes: 11297 * MB, availBytes: 8 * GB },
      modelFileSizeBytes: 1300 * MB });
    h.render();
    // Android estimates 2.5x the on-disk image size: ~3GB dirty runtime memory.
    await h.placeImageModel({ backend: 'coreml', size: 1200 * MB });
    await h.cycleImageMode();
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });

    h.boundary.setRam({ platform: 'android', totalBytes: 11297 * MB, availBytes: 1009 * MB });
    await require('../../../src/services/hardware').hardwareService.refreshMemoryInfo();
    await h.tapSend('a fox in the snow');
    await h.settle(400);

    expect(h.boundary.diffusion.calls.generateImage).toHaveLength(0);
    expect(h.view!.queryByTestId('model-failure-load-anyway-image')).not.toBeNull();
    expect(h.view!.queryByTestId('model-failure-load-anyway-image')).not.toBeNull();
  });
});
