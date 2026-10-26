/**
 * Auto Setup on a phone too small for any video model offers "Find my computer"; once an Off Grid AI
 * Desktop is paired, it names that computer as where videos are made (commit 035c87386).
 *
 * Product-correct outcome (the person's view): with Pro, on an 8 GB phone no video pack fits, so
 * the plan's VIDEO row says videos are made on a computer and offers Find my computer. Tapping it
 * opens Remote servers. The person adds their Desktop there and comes back: the row now reads
 * "Videos are made on Studio Mac." and no longer offers Find my computer.
 *
 * Entry point: the REAL App with Pro installed the way the bootstrap does it (harness/proHarness),
 * onboarding done and no model on the phone, so Auto Setup opens first. Every step after launch is
 * a gesture: Find my computer, Add server, type name and address, Test connection, Save, Back.
 *
 * Fakes (device boundary only): the RAM sensor, Hugging Face (fetch, for the image candidates) and
 * the Desktop's gateway over fetch, in Desktop's own wire shapes (desktop/src/main/model-server.ts:
 * /v1/models/catalog, /installed, /active). Everything we own runs for real.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

jest.unmock('@react-navigation/native');
jest.mock('react-native-bootsplash', () => ({ hide: jest.fn(async () => {}) }), { virtual: true });

const RENDER_WAIT = { timeout: 8000 };
const DESKTOP_NAME = 'Studio Mac';
const DESKTOP_ENDPOINT = 'http://192.168.7.21:7878'; // NOSONAR - private LAN test fixture

/** The network: Hugging Face's image repos, and the person's Desktop with one video model. */
function installNetwork(): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const json = (body: unknown, status = 200) =>
      ({ ok: status < 400, status, json: async () => body }) as Response;
    if (url.hostname === 'huggingface.co') {
      if (/^\/api\/models\/.+\/tree\/main$/.test(url.pathname)) {
        const size = 1.2 * GB;
        return json([{ type: 'file', path: 'coreml-split_einsum-compiled.zip', size, lfs: { oid: 'x', size, pointerSize: 1 } }]);
      }
      return json([]);
    }
    if (url.origin !== DESKTOP_ENDPOINT) throw new TypeError('Network request failed');
    const method = (init?.method ?? 'GET').toUpperCase();
    switch (`${method} ${url.pathname}`) {
      case 'GET /v1/models':
        return json({ object: 'list', data: [] });
      case 'GET /v1/models/catalog':
        return json({
          kinds: ['text', 'vision', 'image', 'video', 'speech', 'transcription'],
          memoryGb: 64,
          models: [{ id: 'off-grid-ai/Wan2.1-T2V-1.3B-GGUF', name: 'Wan 2.1 (1.3B)', kind: 'video', org: 'Off Grid AI', tags: [], files: [] }],
        });
      case 'GET /v1/models/installed':
        return json({ installed: ['off-grid-ai/Wan2.1-T2V-1.3B-GGUF'] });
      case 'GET /v1/models/active':
        return json({ text: null, image: null, video: 'off-grid-ai/Wan2.1-T2V-1.3B-GGUF', speech: null, transcription: null });
      default:
        return json({ error: 'not found' }, 404);
    }
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe('Auto Setup video on a small phone', () => {
  it('offers Find my computer, and names the Desktop once it is added', async () => {
    installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 4 * GB } });
    const restoreFetch = installNetwork();
    const React = require('react');
    const { render, fireEvent, waitFor, within } = requireRTL();
    const AsyncStorage =
      require('@react-native-async-storage/async-storage').default ??
      require('@react-native-async-storage/async-storage');
    const ui = { current: null as null | ReturnType<typeof render> };
    try {
      await AsyncStorage.clear();
      await AsyncStorage.setItem(
        'local-llm-app-storage',
        JSON.stringify({ state: { hasCompletedOnboarding: true }, version: 0 }),
      );
      await require('../../harness/proHarness').installPro();
      const App = require('../../../App').default;
      const app = render(React.createElement(App));
      ui.current = app;

      // BEFORE: the open plan's VIDEO row says videos are made on a computer, and offers to find it.
      const videoRow = () => within(app.getByTestId('auto-setup-selected-plan')).getByTestId('auto-setup-video-row');
      await waitFor(() => expect(videoRow()).toBeTruthy(), RENDER_WAIT);
      expect(within(videoRow()).getByText('Videos are made on your computer with Off Grid AI Desktop.')).toBeTruthy();
      expect(within(videoRow()).queryByText(`Videos are made on ${DESKTOP_NAME}.`)).toBeNull();

      // Find my computer opens Remote servers.
      fireEvent.press(within(videoRow()).getByTestId('auto-setup-find-computer'));
      fireEvent.press(await waitFor(() => app.getByTestId('add-server'), RENDER_WAIT));

      // The person adds their Desktop.
      fireEvent.changeText(await waitFor(() => app.getByTestId('server-name'), RENDER_WAIT), DESKTOP_NAME);
      fireEvent.changeText(app.getByTestId('server-endpoint'), DESKTOP_ENDPOINT);
      fireEvent.press(app.getByTestId('test-connection'));
      await waitFor(() => expect(app.getByText(/Connected \(/)).toBeTruthy(), RENDER_WAIT);
      fireEvent.press(app.getByTestId('save-server'));
      await waitFor(() => expect(app.queryByTestId('server-name')).toBeNull(), RENDER_WAIT);
      await waitFor(() => expect(app.getByText(DESKTOP_NAME)).toBeTruthy(), RENDER_WAIT);

      // Back on Auto Setup: the row names the Desktop and no longer offers to find a computer.
      fireEvent.press(app.getByLabelText('Back'));
      await waitFor(
        () => expect(within(videoRow()).getByText(`Videos are made on ${DESKTOP_NAME}.`)).toBeTruthy(),
        RENDER_WAIT,
      );
      expect(within(videoRow()).queryByTestId('auto-setup-find-computer')).toBeNull();
    } finally {
      ui.current?.unmount();
      restoreFetch();
      const { remoteServerManager } = require('../../../src/services/remoteServerManager');
      await remoteServerManager.clearAllServers();
    }
  }, 45000);
});
