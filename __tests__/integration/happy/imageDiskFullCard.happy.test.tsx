/**
 * HAPPY-PATH (UI, BEHAVIORAL — graceful low-storage surface) — on a nearly full iPhone, Core ML cannot
 * write the compiled package of a Stable Diffusion sub-model. MPSGraph then calls exit() and the app
 * closes (production crash, 0.0.111). The native module now checks free space first and REJECTS with
 * ERR_DISK_FULL and a storage message — at load (prewarm compile) and before generation (the lazy
 * compile of the 'original' variant). This proves the user sees that message on the failure card, and
 * that no image is produced, through the REAL ChatScreen + imageGenerationService + ModelFailureCard.
 * Only the native diffusion module is faked, rejecting exactly as React Native delivers a native reject.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

// The message CoreMLDiffusionModule.storageShortfallMessage builds (sizes from ByteCountFormatter).
const STORAGE_MESSAGE =
  'Not enough storage to prepare this image model. It needs 2.1 GB free and your phone has 412 MB. ' +
  'Free up space in Settings → Storage, then try again.';

/** A native promise rejection as React Native hands it to JS: an Error with the native code + message. */
function nativeReject(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

async function openChatWithImageModeOn() {
  const h = await setupChatScreen({ engine: 'litert', platform: 'ios' });
  h.render();
  await h.placeImageModel({ backend: 'coreml' });
  await h.cycleImageMode(); // auto → ON(force); also activates the downloaded image model
  await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });
  return h;
}

describe('happy — a full disk surfaces a storage message on the image failure card, not a crash', () => {
  it('shows the storage message when the native load refuses before the Core ML compile', async () => {
    const h = await openChatWithImageModeOn();
    h.boundary.diffusion.module.loadModel.mockRejectedValueOnce(nativeReject('ERR_DISK_FULL', STORAGE_MESSAGE));

    await h.tapSend('a fox in the snow');

    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Not enough storage to prepare this image model/)).not.toBeNull(); });
    expect(h.view!.queryByText(/Free up space in Settings → Storage/)).not.toBeNull();
    // A storage refusal is not a memory problem: the card must not tell the user to close apps for RAM.
    expect(h.view!.queryByText(/Not Enough Memory/)).toBeNull();
    expect(h.view!.queryByTestId('model-failure-retry-image')).not.toBeNull();
    expect(h.boundary.diffusion.calls.generateImage.length).toBe(0);
  });

  it('shows the storage message when the native generate refuses before the lazy compile', async () => {
    const h = await openChatWithImageModeOn();
    h.boundary.diffusion.module.generateImage.mockRejectedValueOnce(nativeReject('ERR_DISK_FULL', STORAGE_MESSAGE));

    await h.tapSend('a fox in the snow');

    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Not enough storage to prepare this image model/)).not.toBeNull(); });
    expect(h.view!.queryByText(/Not Enough Memory/)).toBeNull();
    // The refusal is not shown as a pipeline crash that "unloaded" the model.
    expect(h.view!.queryByText(/the model encountered an error and was unloaded/)).toBeNull();
    expect(h.view!.queryByTestId('model-failure-retry-image')).not.toBeNull();
  });
});
