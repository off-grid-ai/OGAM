/**
 * Calls to Off Grid AI Desktop have no deadline, so a Desktop that never answers must not hold the phone.
 *
 * Product-correct outcome (the person's view): the person picks Desktop's image model. Desktop never
 * answers (asleep, off the network). The row shows it is loading, with Stop. They tap Stop: the row is
 * no longer loading, nothing is selected, no error shows, and the request to Desktop is closed. Desktop
 * comes back; they pick the model again and it is selected.
 *
 * Real RemoteModelOptionsSection, ModelSwitchStop, remoteServerManager and offGridDesktopModels.
 * Fakes only at the device boundary: Desktop's gateway over fetch (Desktop's own wire shapes, as in
 * slowDesktopNoDeadline), whose first activation never answers.
 */
import React from 'react';
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

const ENDPOINT = 'http://192.168.1.64:7878'; // NOSONAR - private LAN test fixture
const MODEL = { id: 'flux-schnell', name: 'Flux Schnell' };

/** Desktop's gateway. The first activation never answers; a request the phone aborts rejects, as fetch does. */
function serveSilentDesktop(): { aborted: string[]; restore: () => void } {
  const original = globalThis.fetch;
  const aborted: string[] = [];
  let activeImage: string | null = null;
  let activations = 0;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.origin !== ENDPOINT) return original(input, init);
    if (init?.signal?.aborted) throw new Error('Aborted');
    const route = `${(init?.method ?? 'GET').toUpperCase()} ${url.pathname}`;
    if (route === 'GET /v1/models') return json({ object: 'list', data: [] });
    if (route === 'GET /v1/models/catalog') {
      return json({
        kinds: ['text', 'vision', 'image', 'speech', 'transcription'],
        models: [{ ...MODEL, kind: 'image', org: 'Black Forest Labs', tags: [], files: [] }],
      });
    }
    if (route === 'GET /v1/models/installed') return json({ installed: [MODEL.id] });
    if (route === 'GET /v1/models/active') return json({ text: null, image: activeImage, speech: null, transcription: null });
    if (route === 'POST /v1/models/activate') {
      activations += 1;
      if (activations === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted.push(route);
            reject(new Error('Aborted'));
          }, { once: true });
        });
      }
      activeImage = MODEL.id;
      return json({ success: true });
    }
    return json({ error: { message: 'Unknown endpoint', type: 'not_found' } }, 404);
  }) as typeof globalThis.fetch;
  return { aborted, restore: () => { globalThis.fetch = original; } };
}

describe('a paired Desktop that never answers', () => {
  let desktop: ReturnType<typeof serveSilentDesktop> | undefined;

  afterEach(async () => {
    desktop?.restore();
    desktop = undefined;
    const { remoteServerManager } = require('../../../src/services/remoteServerManager');
    await remoteServerManager.clearAllServers();
  });

  it('lets the person stop a model switch, then switch once Desktop answers', async () => {
    const h = await setupChatScreen({ engine: 'llama' });
    desktop = serveSilentDesktop();
    const { remoteServerManager } = require('../../../src/services/remoteServerManager');
    const { RemoteModelOptionsSection } = require('../../../src/components/models/RemoteModelOptionsSection');
    const server = await remoteServerManager.addServer({
      name: 'Studio Mac',
      endpoint: ENDPOINT,
      providerType: 'openai-compatible',
      modelManagement: 'offgrid-desktop-v1',
      modelCatalog: { image: [MODEL] },
    });
    const rowId = `remote-image-model-${server.id}:${MODEL.id}`;
    const picker = h.rtl.render(React.createElement(RemoteModelOptionsSection, { category: 'image' }));

    // BEFORE: not selected, nothing loading.
    expect(picker.getByTestId(rowId).props.accessibilityState?.selected).not.toBe(true);
    expect(picker.queryByTestId('model-switch-stop')).toBeNull();

    h.rtl.fireEvent.press(picker.getByTestId(rowId));
    const stop = await picker.findByTestId('model-switch-stop');
    h.rtl.fireEvent.press(stop);

    await h.rtl.waitFor(() => expect(picker.queryByTestId('model-switch-stop')).toBeNull());
    expect(picker.getByTestId(rowId).props.accessibilityState?.selected).not.toBe(true);
    expect(picker.queryByText(/Could not reach|could not be selected/)).toBeNull();
    expect(desktop.aborted).toEqual(['POST /v1/models/activate']);

    // Desktop answers again: the next pick goes through.
    h.rtl.fireEvent.press(picker.getByTestId(rowId));
    await h.rtl.waitFor(() => {
      expect(picker.getByTestId(rowId).props.accessibilityState?.selected).toBe(true);
    });
    expect(picker.queryByTestId('model-switch-stop')).toBeNull();
    picker.unmount();
  }, 30_000);
});
