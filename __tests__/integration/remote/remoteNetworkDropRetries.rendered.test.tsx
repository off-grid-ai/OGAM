/**
 * Play review, 2026-11-18 (LM Studio over the network): "a small hiccup in your network … says unable to
 * connect to host and won't even bother trying to reconnect". One dropped request went straight to model
 * fallback: the server's other models (failing the same way, each one replacing the person's choice), then a
 * local model, which also dropped the server.
 *
 * The real ChatScreen and send path; only the network is faked: fetch for discovery, the streaming XHR for
 * chat (a dropped connection is the XHR's onerror, as on device).
 */
import { setupChatScreen } from '../../harness/chatHarness';
import {
  installChatStreamServer,
  type ChatStreamServer,
} from '../../harness/chatStreamServer';

jest.unmock('@react-navigation/native');

const answer = (text: string) => ({
  sse: [
    { choices: [{ delta: { role: 'assistant', content: text } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
    '[DONE]',
  ],
});
const drop = { networkError: true as const };

let server: ChatStreamServer | null = null;
afterEach(() => {
  server?.restore();
  server = null;
});

async function chatWithRemote() {
  const h = await setupChatScreen({
    navigation: 'real',
    engine: 'llama',
    platform: 'android',
  });
  const {
    remoteServerManager,
  } = require('../../../src/services/remoteServerManager');
  const { useRemoteServerStore } = require('../../../src/stores');
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/v1/models')) {
      return {
        ok: true,
        json: async () => ({
          object: 'list',
          data: [
            { id: 'first-model', object: 'model', owned_by: 'test' },
            { id: 'second-model', object: 'model', owned_by: 'test' },
          ],
        }),
      } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as typeof global.fetch;
  try {
    const added = await remoteServerManager.addServer({
      name: 'LM Studio',
      endpoint: 'http://192.168.1.20:1234',
      providerType: 'openai-compatible',
    });
    await useRemoteServerStore.getState().discoverModels(added.id);
    await remoteServerManager.setActiveRemoteTextModel(added.id, 'first-model');
  } finally {
    global.fetch = originalFetch;
  }
  server = installChatStreamServer();
  h.render();
  return { h, useRemoteServerStore };
}

describe('a short network drop to a remote server', () => {
  it('tries the same model again and answers, with no model change', async () => {
    const { h, useRemoteServerStore } = await chatWithRemote();
    server!.reply(drop, answer('Back again.'));
    await h.tapSend('Hello');

    await h.rtl.waitFor(
      () => expect(h.view!.queryByText('Back again.')).not.toBeNull(),
      { timeout: 8000 },
    );
    expect(server!.requests.map(r => r.body.model)).toEqual([
      'first-model',
      'first-model',
    ]);
    expect(
      h.view!.queryByTestId('tool-result-label-model_fallback'),
    ).toBeNull();
    expect(useRemoteServerStore.getState().activeRemoteTextModelId).toBe(
      'first-model',
    );
  });

  it('a server that stays unreachable is tried three times, and its other models are not tried', async () => {
    const { h } = await chatWithRemote();
    h.boundary.llama!.scriptCompletion({ text: 'Local answer.' });
    server!.reply(drop, drop, drop, answer('Should never be asked.'));
    await h.tapSend('Hello');

    await h.rtl.waitFor(
      () => expect(h.view!.queryByText(/Local answer/)).not.toBeNull(),
      { timeout: 12000 },
    );
    expect(server!.requests.map(r => r.body.model)).toEqual([
      'first-model',
      'first-model',
      'first-model',
    ]);
  });

  it('a server that answers with an error still falls back to its other model at once, as before', async () => {
    const { h } = await chatWithRemote();
    server!.reply(
      { status: 500, body: '{"error":{"message":"Model unavailable"}}' },
      answer('Second model here.'),
    );
    await h.tapSend('Hello');

    await h.rtl.waitFor(
      () => expect(h.view!.queryByText('Second model here.')).not.toBeNull(),
      { timeout: 8000 },
    );
    expect(server!.requests.map(r => r.body.model)).toEqual([
      'first-model',
      'second-model',
    ]);
  });
});
