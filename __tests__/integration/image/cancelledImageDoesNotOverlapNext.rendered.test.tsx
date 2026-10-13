/**
 * An image the user cancelled while the text model was still loading for prompt enhancement must
 * stay cancelled. When the user asks for a second image before that load finishes, the first one
 * must not wake up once the load completes: it must not enhance, request an image or take over the
 * second image's progress. Stopping the second image then stops the second image's own request.
 *
 * Real ChatScreen (image drawn through the real image-mode toggle and send, stopped through the
 * image card's real X). Fakes only at the device boundary: llama.rn (its load held in the post-init
 * window, its completion held before the first token), the image server's fetch and the native file
 * system.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import {
  REMOTE_IMAGE_URL,
  chooseRemoteImageModel,
  clearRemoteServers,
  holdImageGeneration,
} from '../../harness/remoteImageServer';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('a cancelled image does not overlap the next one', () => {
  let server: ReturnType<typeof holdImageGeneration>;

  afterEach(() => {
    server.release();
    server.restore();
    clearRemoteServers();
  });

  it('keeps the first image stopped after its text model loads, and stops the second on its own X', async () => {
    const h = await setupChatScreen({ engine: 'llama' });
    server = holdImageGeneration();
    h.boundary.fs!.serveRemoteFile(REMOTE_IMAGE_URL, {
      body: 'synthetic-png-bytes',
      headers: { 'Content-Type': 'image/png' },
    });
    await chooseRemoteImageModel(h);
    h.useAppStore.getState().updateSettings({ enhanceImagePrompts: true });
    const llama = h.boundary.llama!;

    // The user ejects the text model from the In Memory list, so the next enhancement has to load it.
    const React = require('react');
    const { ModelsManagerSheet } = require('../../../src/components/models/ModelsManagerSheet');
    const sheet = h.rtl.render(React.createElement(ModelsManagerSheet, {
      visible: true, onClose: () => {}, labels: { text: '-', image: '-', voice: '-', speech: '-' },
      loadingState: { isLoading: false }, isEjecting: false, hasActiveModel: false,
      onOpenRow: () => {}, onEject: () => {},
    }));
    await h.rtl.waitFor(() => { expect(sheet.queryByTestId('models-row-text-ram')).not.toBeNull(); });
    h.rtl.fireEvent.press(sheet.getByTestId('models-row-text-eject'));
    // The sheet re-reads residency on a 300 ms poll.
    await h.rtl.act(async () => { await h.settle(400); });
    expect(sheet.queryByTestId('models-row-text-ram')).toBeNull();
    sheet.unmount();

    // Image A: the text model starts loading for enhancement and stays inside its load window.
    llama.scriptMultimodalHold();
    await h.tapSend('draw a lighthouse at dusk');
    await h.rtl.waitFor(() => { expect(llama.multimodalHoldActive()).toBe(true); });
    await h.rtl.waitFor(() => { expect(h.view!.queryAllByText(/Loading text model/i).length).toBeGreaterThan(0); });

    // The user stops A while the model is still loading.
    await h.pressImageCardStop();
    await h.rtl.waitFor(() => { expect(h.view!.queryAllByText(/Loading text model/i)).toHaveLength(0); });

    // Image B: its enhancement request will be held before the first token.
    llama.scriptCompletion({ text: 'a pine forest in morning fog, soft light', holdBeforeStream: true });
    await h.tapSend('draw a pine forest');

    // A's load completes. Only B goes on to enhance.
    await h.rtl.act(async () => { llama.releaseMultimodalHold(); });
    await h.rtl.waitFor(() => { expect(h.view!.queryAllByText(/Enhancing your prompt/i).length).toBeGreaterThan(0); });
    await h.rtl.act(async () => { await h.settle(300); });
    expect(llama.calls.completion).toHaveLength(1);
    expect(server.requests).toBe(0);

    // Stopping B stops B's own enhancement request, and no image is requested for either.
    await h.pressImageCardStop();
    const context = await llama.module.initLlama.mock.results.at(-1)!.value;
    await h.rtl.waitFor(() => { expect(context.stopCompletion).toHaveBeenCalled(); });
    await h.rtl.waitFor(() => { expect(h.view!.queryAllByText(/Enhancing your prompt/i)).toHaveLength(0); });
    expect(llama.calls.completion).toHaveLength(1);
    expect(server.requests).toBe(0);
    const fs = h.boundary.fs!;
    expect(fs.listFiles(`${fs.DocumentDirectoryPath}/generated_images`)).toHaveLength(0);
  });
});
