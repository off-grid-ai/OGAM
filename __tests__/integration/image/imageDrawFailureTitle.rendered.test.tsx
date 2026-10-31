/**
 * The failure card says where an image failed.
 *
 * SPEC (OGAM user's view): a model that loaded and then could not draw the image did not "fail to load".
 * Its card reads "Image model: Couldn't make the image", gives the engine's one-line reason, and offers
 * Retry. A model that fails to load keeps "Failed to load model".
 *
 * The REAL ChatScreen, imageGenerationService and ModelFailureCard. Only the native diffusion module is
 * faked, rejecting as React Native delivers a native reject (the sd.cpp engine's IMAGE_FAILED).
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

const nativeReject = (code: string, message: string) => Object.assign(new Error(message), { code });

async function openChatWithImageModeOn() {
  const h = await setupChatScreen({ engine: 'litert', platform: 'android' });
  h.render();
  await h.placeImageModel({ backend: 'mnn' });
  await h.cycleImageMode();
  await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });
  return h;
}

it('a model that loaded but could not draw says it could not make the image, with the reason and Retry', async () => {
  const h = await openChatWithImageModeOn();
  h.boundary.diffusion.module.generateImage.mockRejectedValueOnce(nativeReject('IMAGE_FAILED', 'The image engine produced no image.'));

  await h.tapSend('a fox in the snow');

  expect(await h.view!.findByText("Image model: Couldn't make the image")).toBeTruthy();
  expect(h.view!.getByText('The image engine produced no image.')).toBeTruthy();
  expect(h.view!.queryByText(/Failed to load model/)).toBeNull();
  expect(h.view!.getByTestId('model-failure-retry-image')).toBeTruthy();
});

it('a model that cannot load keeps "Failed to load model"', async () => {
  const h = await openChatWithImageModeOn();
  h.boundary.diffusion.module.loadModel.mockRejectedValueOnce(nativeReject('LOAD_FAILED', 'Could not load the image model pack.'));

  await h.tapSend('a fox in the snow');

  expect(await h.view!.findByText(/Failed to load model/)).toBeTruthy();
  expect(h.view!.queryByText("Image model: Couldn't make the image")).toBeNull();
});
