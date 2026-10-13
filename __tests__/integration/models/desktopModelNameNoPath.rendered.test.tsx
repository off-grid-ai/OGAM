/**
 * A model that Off Grid AI Desktop serves from a file it found on disk is shown on the phone by a
 * readable name, never by that file's path.
 *
 * Product-correct outcome (the person's view): Desktop has a model it picked up from a folder on the
 * Mac, so Desktop's own name for it is the absolute file path. The person adds that Desktop to the
 * phone, chooses the model and starts a chat. Every place the phone names the model (the server
 * editor's model choice, the Home text-model picker, the chat) shows "Qwen3.5-9B-Q4_K_M": no folder
 * path, no "/", no ".gguf".
 *
 * Entry point: the REAL AppNavigator inside a REAL NavigationContainer. Every step is a gesture: skip
 * Auto Setup, tap Add Remote Server, Add manually, type the name and address, Test Connection, Save,
 * go back Home, open the picker, tap the Desktop model, tap New Chat.
 *
 * Fake (device boundary only): the Desktop's HTTP API over global fetch, answering with the shapes
 * Desktop's model server produces (desktop/src/main/model-server.ts: /v1/models/catalog is
 * getCatalog(), /installed lists ids, /active is getActiveModalities(), /activate switches it). An
 * external model there is { id: "external:<sha256>", name, files: [{ name: <absolute path> }] }, as
 * desktop/src/main/external-models.ts builds it. Everything on the phone runs for real.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

jest.unmock('@react-navigation/native');

const DESKTOP_NAME = 'Studio Mac';
const DESKTOP_ENDPOINT = 'http://192.168.7.20:7878'; // NOSONAR - private LAN test fixture
const MODEL_PATH = '/Users/x/models/Qwen3.5-9B-Q4_K_M.gguf';
const MODEL_ID = 'external:5b1f0c3e9a7d4e2b8c6f1a0d3e5b7c9f2a4d6e8b0c1f3a5d7e9b2c4f6a8d0e1b';
const CLEAN_NAME = 'Qwen3.5-9B-Q4_K_M';
const RENDER_WAIT = { timeout: 8000 };

/** Off Grid AI Desktop's gateway: one external model, installed and active for text. */
function installDesktopGateway(): () => void {
  const originalFetch = globalThis.fetch;
  let activeText: string | null = MODEL_ID;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin !== DESKTOP_ENDPOINT) throw new TypeError('Network request failed');
    const json = (body: unknown, status = 200) =>
      ({ ok: status < 400, status, json: async () => body }) as Response;
    const method = (init?.method ?? 'GET').toUpperCase();
    switch (`${method} ${url.pathname}`) {
      case 'GET /v1/models':
        return json({ object: 'list', data: [{ id: MODEL_ID, object: 'model', owned_by: 'offgrid' }] });
      case 'GET /v1/models/catalog':
        return json({
          kinds: ['text', 'vision', 'image', 'speech', 'transcription'],
          models: [
            {
              id: MODEL_ID,
              name: MODEL_PATH,
              kind: 'text',
              org: 'Added folder',
              tags: ['External'],
              files: [{ name: MODEL_PATH, url: '', sizeBytes: 5.6 * GB, role: 'primary' }],
            },
          ],
        });
      case 'GET /v1/models/installed':
        return json({ installed: [MODEL_ID] });
      case 'GET /v1/models/active':
        return json({ text: activeText, image: null, speech: null, transcription: null });
      case 'POST /v1/models/activate': {
        const body = JSON.parse(String(init?.body ?? '{}')) as { id?: string; kind?: string };
        if (body.kind === 'text' && body.id === MODEL_ID) activeText = MODEL_ID;
        return json({ success: body.id === MODEL_ID });
      }
      default:
        return json({ error: 'not found' }, 404);
    }
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function expectNoPath(view: { queryAllByText: (m: RegExp) => unknown[] }) {
  expect(view.queryAllByText(/\/Users\//)).toHaveLength(0);
  expect(view.queryAllByText(/\.gguf/i)).toHaveLength(0);
}

describe('paired Desktop model names', () => {
  it('names a Desktop model found on disk without its file path in the editor, the picker, the chat and the Models sheet', async () => {
    installNativeBoundary({ fs: true, ram: { platform: 'ios', totalBytes: 8 * GB, availBytes: 6 * GB } });
    const restoreFetch = installDesktopGateway();
    try {
      const React = require('react');
      const { render, fireEvent, waitFor, within } = requireRTL();
      const { NavigationContainer } = require('@react-navigation/native');
      const { AppNavigator } = require('../../../src/navigation/AppNavigator');
      const { useAppStore } = require('../../../src/stores');

      // Boot state of a returning person who finished onboarding and dismissed the tour, with no
      // model on the phone. Not the state under test.
      useAppStore.getState().setOnboardingComplete(true);
      useAppStore.getState().dismissChecklist();

      const ui = render(
        React.createElement(NavigationContainer, null, React.createElement(AppNavigator)),
      );
      fireEvent.press(await waitFor(() => ui.getByTestId('auto-setup-skip'), RENDER_WAIT));

      // Before pairing, Home has no model to name.
      await waitFor(() => expect(ui.getByTestId('setup-card')).toBeTruthy(), RENDER_WAIT);
      expect(ui.queryByText(CLEAN_NAME)).toBeNull();

      // Add the Desktop.
      fireEvent.press(ui.getByTestId('add-server-button'));
      fireEvent.press(await waitFor(() => ui.getByTestId('add-server'), RENDER_WAIT));
      fireEvent.changeText(await waitFor(() => ui.getByTestId('server-name'), RENDER_WAIT), DESKTOP_NAME);
      fireEvent.changeText(ui.getByTestId('server-endpoint'), DESKTOP_ENDPOINT);
      fireEvent.press(ui.getByTestId('test-connection'));
      await waitFor(() => expect(ui.getByText(/Connected \(/)).toBeTruthy(), RENDER_WAIT);

      // The editor's text-model choice names Desktop's active model.
      const textChoice = ui.getByTestId('server-text-model');
      await waitFor(() => expect(within(textChoice).getByText(CLEAN_NAME)).toBeTruthy(), RENDER_WAIT);
      expectNoPath(within(textChoice));

      fireEvent.press(ui.getByTestId('save-server'));
      await waitFor(() => expect(ui.queryByTestId('server-name')).toBeNull(), RENDER_WAIT);

      // The Home text-model picker lists it under the Desktop.
      fireEvent.press(await waitFor(() => ui.getByLabelText('Back'), RENDER_WAIT));
      fireEvent.press(await waitFor(() => ui.getByTestId('browse-models-button'), RENDER_WAIT));
      const row = await waitFor(() => {
        const rows = ui.queryAllByTestId(/^remote-text-model-/);
        expect(rows).toHaveLength(1);
        return rows[0];
      }, RENDER_WAIT);
      expect(within(row).getByText(CLEAN_NAME)).toBeTruthy();
      expectNoPath(within(row));
      fireEvent.press(row);

      // The chat started with it.
      fireEvent.press(await waitFor(() => ui.getByTestId('new-chat-button'), RENDER_WAIT));
      await waitFor(
        () => expect(ui.getByText(new RegExp(`begin chatting with ${CLEAN_NAME.replace('.', '\\.')}\\.`))).toBeTruthy(),
        RENDER_WAIT,
      );
      expectNoPath(ui);

      // Back on Home, the Models sheet names the active text model the same way.
      fireEvent.press(ui.getByLabelText('Back'));
      fireEvent.press(await waitFor(() => ui.getByTestId('models-summary'), RENDER_WAIT));
      const textRow = await waitFor(() => ui.getByTestId('models-row-text'), RENDER_WAIT);
      expect(within(textRow).getByText(CLEAN_NAME)).toBeTruthy();
      expectNoPath(within(textRow));
      ui.unmount();
    } finally {
      restoreFetch();
    }
  });
});
