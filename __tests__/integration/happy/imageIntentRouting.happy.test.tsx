/**
 * HAPPY-PATH (UI integration, HEAVY entry point) — model routing: on the real ChatScreen, a "draw ..."
 * prompt routes to the IMAGE model (image generated) while a normal prompt routes to the TEXT model.
 *
 * Real ChatScreen + real dispatchGenerationFn + real intentClassifier (pattern method) + real
 * imageGenerationService/generation; only native LiteRT + diffusion faked. This is the routing regression
 * floor: the right model runs for the right prompt.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { createONNXImageModel } from '../../utils/factories';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

async function withImageModel(h: Awaited<ReturnType<typeof setupChatScreen>>) {
  const imageModel = createONNXImageModel({ id: 'sd', name: 'SD', modelPath: '/models/sd', backend: 'coreml' as never });
  h.useAppStore.setState({ downloadedImageModels: [imageModel], activeImageModelId: 'sd' });
  h.useAppStore.getState().updateSettings({ autoDetectMethod: 'pattern', imageGenerationMode: 'auto', enhanceImagePrompts: false, imageThreads: 4, imageUseOpenCL: false, imageSteps: 8 });
  h.boundary.diffusion.module.getLoadedModelPath.mockResolvedValue(imageModel.modelPath);
}

describe('happy — prompt routing picks the right model (heavy entry point)', () => {
  it('a "draw ..." prompt routes to the image model (image generated)', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'ios' });
    await withImageModel(h);
    h.render();

    await h.send('draw a cat wearing a hat', { content: 'unused-text-turn' });

    // Routed to the image model: the native image generator ran exactly once.
    await h.rtl.waitFor(() => { expect(h.boundary.diffusion.calls.generateImage.length).toBe(1); });
  });

  it('control: a normal prompt routes to the text model (no image generated)', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'ios' });
    await withImageModel(h);
    h.render();

    await h.send('what is the capital of France', { content: 'The capital of France is Paris.' });

    // Routed to the text model: the answer renders and the image generator never ran.
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/The capital of France is Paris\./)).not.toBeNull(); });
    expect(h.boundary.diffusion.calls.generateImage.length).toBe(0);
  });
});
