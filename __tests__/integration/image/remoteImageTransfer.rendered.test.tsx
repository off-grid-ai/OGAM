/**
 * Remote image generation: the image is created on a remote server, then the phone transfers the
 * file from the URL the server returns.
 *
 * - Cancel during that transfer stops it and never saves the image, even when the transfer
 *   finishes as the cancel lands.
 *
 * Real ChatScreen, real image-mode toggle, real remote model picker, real imageGenerationService
 * and remote image runner. Fakes only at the network (fetch) and native file system (RNFS) edges.
 */
import React from 'react';
import { setupChatScreen } from '../../harness/chatHarness';
import type { RemoteTransfer } from '../../harness/nativeFileSystem';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

const ENDPOINT = 'http://192.168.1.60:7878'; // NOSONAR - private LAN test fixture
const IMAGE_URL = 'https://images.example.test/out/lighthouse.png';
const PNG_BODY = 'synthetic-png-bytes';

type Harness = Awaited<ReturnType<typeof setupChatScreen>>;

/** The remote server answers an image request with a URL to transfer, as OpenAI-style servers do. */
function serveImageGeneration(): { requests: number; restore: () => void } {
  const original = globalThis.fetch;
  const state = { requests: 0, restore: () => { globalThis.fetch = original; } };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === `${ENDPOINT}/v1/images/generations`) {
      state.requests += 1;
      return new Response(JSON.stringify({ data: [{ url: IMAGE_URL }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    return original(input);
  }) as typeof globalThis.fetch;
  return state;
}

/** Pick the remote image model in the real picker, then switch the chat into image mode. */
async function chooseRemoteImageModel(h: Harness) {
  const { useRemoteServerStore } = require('../../../src/stores/remoteServerStore');
  const { RemoteModelOptionsSection } = require('../../../src/components/models/RemoteModelOptionsSection');
  // A saved server with its discovered image catalog is what the add-server flow leaves behind.
  const serverId = useRemoteServerStore.getState().addServer({
    name: 'Studio Mac',
    endpoint: ENDPOINT,
    providerType: 'openai-compatible',
    modelCatalog: { image: [{ id: 'flux-schnell', name: 'Flux Schnell' }] },
  });
  const picker = h.rtl.render(React.createElement(RemoteModelOptionsSection, { category: 'image' }));
  h.rtl.fireEvent.press(picker.getByTestId(`remote-image-model-${serverId}:flux-schnell`));
  await h.rtl.waitFor(() => {
    expect(useRemoteServerStore.getState().activeRemoteMediaServerIds.image).toBe(serverId);
  });
  picker.unmount();

  h.render();
  await h.cycleImageMode();
  await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });
}

describe('remote image transfer', () => {
  let h: Harness;
  let server: ReturnType<typeof serveImageGeneration>;
  const imagesDir = () => `${h.boundary.fs!.DocumentDirectoryPath}/generated_images`;

  beforeEach(async () => {
    h = await setupChatScreen({ engine: 'llama' });
    server = serveImageGeneration();
  });

  afterEach(() => {
    server.restore();
    require('../../../src/stores/remoteServerStore').useRemoteServerStore.getState().clearAllServers();
  });

  async function startHeldTransfer(honorsStop: boolean): Promise<RemoteTransfer> {
    const transfer = h.boundary.fs!.serveRemoteFile(IMAGE_URL, {
      body: PNG_BODY, headers: { 'Content-Type': 'image/png' }, hold: true, honorsStop,
    });
    await chooseRemoteImageModel(h);
    await h.tapSend('draw a lighthouse at dusk');
    await h.rtl.waitFor(() => { expect(transfer.held()).toBe(true); });
    // BEFORE: the transfer is under way. Part of the file is on disk and no image is shown.
    expect(h.boundary.fs!.listFiles(imagesDir())).toHaveLength(1);
    expect(h.view!.queryByTestId('generated-image')).toBeNull();
    return transfer;
  }

  it('cancel during the transfer stops it and leaves no image and no file', async () => {
    await startHeldTransfer(true);

    await h.pressImageCardStop();
    await h.settle(200);

    expect(h.view!.queryByTestId('generated-image')).toBeNull();
    expect(h.boundary.fs!.listFiles(imagesDir())).toEqual([]);
  });

  it('a transfer that finishes as cancel lands is not saved', async () => {
    const transfer = await startHeldTransfer(false);

    await h.pressImageCardStop();
    await h.rtl.act(async () => { transfer.release(); });
    await h.settle(200);

    expect(h.view!.queryByTestId('generated-image')).toBeNull();
    expect(h.boundary.fs!.listFiles(imagesDir())).toEqual([]);
  });
});
