/**
 * "Draw a dog" must reach the image model without loading the text model first.
 *
 * Device evidence (iPhone, 2026-09-02 14:39): the log shows `[GEN-SM] ensureModelReady → ready`
 * (Qwen 3.5 2B loaded, seconds of work) BEFORE `[ROUTE-SM] classify intent=image`. The send path
 * pre-loaded the text model before the shared ChatOperationApplicationService had routed the turn,
 * so every drawing request paid for a text model it never used. Shared owns routing and asks for the
 * text route only when the turn is text; Mobile supplies the boundary and renders.
 *
 * Real ChatScreen, real shared routing (pattern classification, auto mode), real image service; only
 * the llama and diffusion natives are faked. Reaching auto mode with an image model selected is done
 * through the quick-settings toggle the person uses: auto → ON (selects the model) → OFF → auto.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('a drawing request is routed to the image model', () => {
  it('generates the image and never loads the text model', async () => {
    const h = await setupChatScreen({ engine: 'llama' });
    h.render();
    await h.placeImageModel({ backend: 'coreml' });
    await h.cycleImageMode(); // auto -> ON: the real toggle selects the downloaded image model
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });
    await h.cycleImageMode(); // ON -> OFF
    await h.cycleImageMode(); // OFF -> auto, image model still selected: shared classifies the request
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).toBeNull(); });

    const initLlama = h.boundary.llama!.module.initLlama;
    const textLoadsBefore = initLlama.mock.calls.length;

    await h.tapSend('Draw a dog');
    await h.rtl.waitFor(() => { expect(h.boundary.diffusion.calls.generateImage.length).toBe(1); });

    expect(initLlama.mock.calls.length).toBe(textLoadsBefore);
    expect(h.boundary.llama!.calls.completion.length).toBe(0);
  });
});
