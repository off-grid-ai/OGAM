/**
 * HAPPY-PATH (UI, BEHAVIORAL — iPhone short of pages) — the phone can be short of memory while this
 * app's own headroom still looks large. The OS then kills the app in the middle of the load. The
 * memory guard must go by the smaller of the two, so the person sees the "Not Enough Memory" card
 * and no crash.
 *
 * Device evidence: jetsam reports from the iPhone 17 Pro Max (docs/pr-screenshots/release-analytics-video/
 * acceptance/ios): the app was killed at ~3.3 GB with `vm-pageshortage` while os_proc_available_memory said
 * several GB were free; the same phone generated normally when it had room.
 *
 * Real ChatScreen, real residency gate and image service; only the native leaves and the RAM sensor are faked.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { GB } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

async function sendImagePromptOnPhoneWith(systemAvailBytes: number) {
  const h = await setupChatScreen({ engine: 'litert', platform: 'ios' });
  h.render();
  await h.placeImageModel({ backend: 'coreml' });
  await h.cycleImageMode();
  await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });
  // A 12 GB iPhone: this app may still allocate 9 GB, but the whole phone has only `systemAvailBytes` to give.
  h.boundary.setRam({ platform: 'ios', totalBytes: 12 * GB, availBytes: 9 * GB, systemAvailBytes });
  await require('../../../src/services/hardware').hardwareService.refreshMemoryInfo();
  await h.tapSend('a fox in the snow');
  return h;
}

describe('happy — an iPhone short of pages is refused with the card, not killed mid-load', () => {
  it('the app has headroom but the phone has 100 MB free: the card shows and no image is made', async () => {
    const h = await sendImagePromptOnPhoneWith(100 * 1024 * 1024);
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Not Enough Memory/)).not.toBeNull(); });
    expect(h.boundary.diffusion.calls.generateImage.length).toBe(0);
  });

  it('control: the same phone with 8 GB free generates the image', async () => {
    const h = await sendImagePromptOnPhoneWith(8 * GB);
    await h.rtl.waitFor(() => { expect(h.boundary.diffusion.calls.generateImage.length).toBe(1); });
    expect(h.view!.queryByText(/Not Enough Memory/)).toBeNull();
  });
});
