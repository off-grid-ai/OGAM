/**
 * Pressing the chat's Stop button while an image prompt is still being enhanced. The text model never
 * answers the enhancement on its own, yet Stop ends it: the enhancement goes away, no image is drawn,
 * no image bubble appears, the composer is back to idle, and the next ordinary message gets its reply.
 *
 * Real ChatScreen (image mode through the real quick-settings toggle, prompt enhancement through the real
 * settings toggle, the request through the real send button). During an image job the chat's Stop is
 * the image progress card's stop control (the composer shows no stop button while an image is in
 * progress); it runs the same chat Stop handler as the composer's stop button. Fakes only at the device boundary: the llama.rn completion (held open before its first
 * token), the diffusion native module and the native file system.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

type Harness = Awaited<ReturnType<typeof setupChatScreen>>;

/** Turn prompt enhancement ON by tapping the real toggle on the real image settings section. */
async function enableEnhanceViaUI(h: Harness) {
  const { ImageGenerationSection } = require('../../../src/components/GenerationSettingsModal/ImageGenerationSection');
  const s = h.rtl.render(h.React.createElement(ImageGenerationSection, {}));
  h.rtl.fireEvent.press(s.getByTestId('modal-image-advanced-toggle'));
  h.rtl.fireEvent.press(await h.rtl.waitFor(() => s.getByTestId('image-enhance-on')));
  s.unmount();
}

describe('pressing Stop while an image prompt is being enhanced', () => {
  it('stops the enhancement, draws no image and leaves the chat ready for the next message', async () => {
    const h = await setupChatScreen({ engine: 'llama' });
    h.render();
    await h.placeImageModel({ backend: 'coreml' });
    await h.cycleImageMode(); // auto -> ON (force)
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });
    await enableEnhanceViaUI(h);
    const view = h.view!;
    const llama = h.boundary.llama!;
    const diffusion = h.boundary.diffusion;

    // The text model takes the enhancement request and never answers it on its own.
    llama.scriptCompletion({
      text: 'a lighthouse at dusk, warm light over a calm sea',
      holdBeforeStream: true,
    });
    await h.tapSend('draw a lighthouse at dusk');

    // BEFORE: the enhancement is in flight on the image progress card, and no image exists.
    await h.rtl.waitFor(() => { expect(view.queryAllByText(/Enhancing your prompt/i).length).toBeGreaterThan(0); });
    await h.rtl.act(async () => { await h.settle(200); });
    expect(view.queryAllByText(/Enhancing your prompt/i).length).toBeGreaterThan(0);
    expect(diffusion.calls.generateImage).toHaveLength(0);
    expect(view.queryByTestId('generated-image')).toBeNull();

    // The user presses Stop (not Delete Chat).
    await h.pressImageCardStop();

    // AFTER: the enhancement is gone and the composer is idle again, without the model ever answering.
    await h.rtl.waitFor(() => { expect(view.queryAllByText(/Enhancing your prompt/i)).toHaveLength(0); });
    expect(view.queryByTestId('stop-button')).toBeNull();
    // Give a late image request every chance to start; none may.
    await h.rtl.act(async () => { await h.settle(400); });
    expect(diffusion.calls.generateImage).toHaveLength(0);
    expect(view.queryByTestId('generated-image')).toBeNull();
    const fs = h.boundary.fs!;
    expect(fs.listFiles(`${fs.DocumentDirectoryPath}/generated_images`)).toHaveLength(0);

    // A following ordinary message works: image mode off, ask a question, the reply renders.
    await h.cycleImageMode(); // ON -> OFF
    await h.rtl.waitFor(() => { expect(view.queryByTestId('image-mode-force-badge')).toBeNull(); });
    expect(view.queryByText(/The capital of France is Paris\./)).toBeNull();
    await h.send('what is the capital of France', { text: 'The capital of France is Paris.' });
    await h.rtl.waitFor(() => { expect(view.queryByText(/The capital of France is Paris\./)).not.toBeNull(); });
    await h.rtl.waitFor(() => { expect(view.queryByTestId('stop-button')).toBeNull(); });
    expect(diffusion.calls.generateImage).toHaveLength(0);
    expect(view.queryByTestId('generated-image')).toBeNull();
  });
});
