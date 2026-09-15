/**
 * HAPPY-PATH (UI integration, HEAVY entry point) — resend/regenerate: after a reply, the user long-presses
 * the assistant bubble and taps Retry; the REAL regenerate path produces a fresh answer that renders.
 *
 * Real ChatScreen + real gesture (long-press → action-retry) + real regenerateResponseFn + real engine;
 * only native leaves faked. Covers llama.cpp and LiteRT (regenerate is engine-agnostic; metal = llama-iOS,
 * proven by the first-message parity test).
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { installRemoteStream } from '../../harness/remoteHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('happy — resend/regenerate (heavy entry point)', () => {
  // Retry is reached through the action menu, which opens BOTH via long-press AND the 3-dots '•••' button.
  it.each(['longpress', 'dots'] as const)(
    'llama.cpp: Retry (menu via %s) produces a fresh answer',
    async via => {
      const h = await setupChatScreen({ engine: 'llama' });
      h.render();
      await h.send('tell me a fact', { text: 'Honey never spoils.' });
      await h.rtl.waitFor(() => {
        expect(h.view!.queryByText(/Honey never spoils\./)).not.toBeNull();
      });

      await h.regenerateLast({ text: 'Octopuses have three hearts.' }, via);
      await h.rtl.waitFor(() => {
        expect(
          h.view!.queryByText(/Octopuses have three hearts\./),
        ).not.toBeNull();
      });
    },
  );

  it.each(['longpress', 'dots'] as const)(
    'LiteRT: Retry (menu via %s) produces a fresh answer',
    async via => {
      const h = await setupChatScreen({ engine: 'litert' });
      h.render();
      await h.send('tell me a fact', { content: 'Honey never spoils.' });
      await h.rtl.waitFor(() => {
        expect(h.view!.queryByText(/Honey never spoils\./)).not.toBeNull();
      });

      await h.regenerateLast({ content: 'Octopuses have three hearts.' }, via);
      await h.rtl.waitFor(() => {
        expect(
          h.view!.queryByText(/Octopuses have three hearts\./),
        ).not.toBeNull();
      });
    },
  );

  it('uses a newly selected remote model when resending an older message', async () => {
    const h = await setupChatScreen({ engine: 'llama' });
    h.render();
    await h.send('tell me a fact', { text: 'Local answer.' });
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(/Local answer\./)).not.toBeNull();
    });

    const { remoteServerManager } = require('../../../src/services/remoteServerManager');
    const { useRemoteServerStore } = require('../../../src/stores');
    const originalFetch = global.fetch;
    global.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes('/v1/models')) {
        return {
          ok: true,
          json: async () => ({
            object: 'list',
            data: [
              {
                id: 'gemini',
                object: 'model',
                owned_by: 'test',
                kind: 'chat',
              },
            ],
          }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof global.fetch;
    try {
      const server = await remoteServerManager.addServer({
        name: 'Desktop',
        endpoint: 'http://localhost:1234',
        providerType: 'openai-compatible',
      });
      await remoteServerManager.testConnection(server.id);

      h.rtl.fireEvent.press(h.view!.getByTestId('model-selector'));
      h.rtl.fireEvent.press(
        await h.rtl.waitFor(() => h.view!.getByTestId('models-row-text')),
      );
      h.rtl.fireEvent.press(
        await h.rtl.waitFor(() => h.view!.getByText('gemini')),
      );
      await h.rtl.waitFor(() => {
        expect(useRemoteServerStore.getState().activeRemoteTextModelId).toBe(
          'gemini',
        );
      });

      installRemoteStream(
        'data: {"choices":[{"delta":{"content":"Remote resend answer."}}]}\n\n' +
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
          'data: [DONE]\n\n',
      );
      await h.openActionMenu('user', 'dots');
      h.rtl.fireEvent.press(h.view!.getByTestId('action-retry'));
      await h.rtl.waitFor(() => {
        expect(h.view!.queryByText(/Remote resend answer\./)).not.toBeNull();
      });

      h.rtl.fireEvent.press(h.view!.getByTestId('model-selector'));
      await h.rtl.waitFor(() => {
        expect(h.view!.queryByTestId('models-row-text')).not.toBeNull();
      });
      expect(h.view!.queryByTestId('models-row-text-ram')).toBeNull();
    } finally {
      global.fetch = originalFetch;
      await remoteServerManager.clearAllServers();
    }
  });
});
