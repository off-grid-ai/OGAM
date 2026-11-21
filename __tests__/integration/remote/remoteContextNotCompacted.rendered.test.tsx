/**
 * Play review, 2026-11-18 (LM Studio over the network): "constant compacting of conversations". A remote
 * chat was budgeted against the phone's own context setting (4096 tokens) instead of the server model's
 * context, so a chat of ~3,300 tokens was compacted every turn or two, each time with an extra summary call.
 *
 * The real ChatScreen, the real discovery (LM Studio's /api/v1/models reports the model's context) and
 * the real send path. Only the network is faked: fetch for discovery, the streaming XHR for chat.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import {
  installChatStreamServer,
  type ChatStreamServer,
} from '../../harness/chatStreamServer';

jest.unmock('@react-navigation/native');

const ENDPOINT = 'http://192.168.1.20:1234';
const MODEL_ID = 'qwen3-8b';

function installDiscoveryFetch(contextLength: number): () => void {
  const original = global.fetch;
  const ok = (body: unknown): Response =>
    ({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response);
  const notFound = (): Response =>
    ({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => '',
    } as unknown as Response);
  global.fetch = (async (input: RequestInfo | URL) => {
    const u = typeof input === 'string' ? input : input.toString();
    if (u.endsWith('/api/v1/models')) {
      return ok({
        models: [
          {
            key: MODEL_ID,
            max_context_length: contextLength,
            capabilities: { vision: false, trained_for_tool_use: false },
          },
        ],
      });
    }
    if (u.endsWith('/v1/models'))
      return ok({
        object: 'list',
        data: [{ id: MODEL_ID, object: 'model', owned_by: 'lmstudio' }],
      });
    if (u.endsWith('/v1/chat/completions')) {
      const sse =
        'data: {"choices":[{"delta":{"role":"assistant","content":"Hi"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
      return ok(sse);
    }
    return notFound();
  }) as typeof global.fetch;
  return () => {
    global.fetch = original;
  };
}

const sse = (text: string) => ({
  sse: [
    { choices: [{ delta: { role: 'assistant', content: text } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
    '[DONE]',
  ],
});

let server: ChatStreamServer | null = null;
afterEach(() => {
  server?.restore();
  server = null;
});

async function chatWithRemote(contextLength: number) {
  const h = await setupChatScreen({
    navigation: 'real',
    engine: 'llama',
    platform: 'android',
  });
  const { useRemoteServerStore, useAppStore } = require('../../../src/stores');
  const { llmService } = require('../../../src/services/llm');
  const {
    setActiveRemoteTextModelImpl,
  } = require('../../../src/services/remoteServerManagerUtils');
  await llmService.unloadModel();
  useAppStore.getState().setActiveModelId(null);
  const restoreFetch = installDiscoveryFetch(contextLength);
  try {
    const serverId = useRemoteServerStore.getState().addServer({
      name: 'LM Studio',
      endpoint: ENDPOINT,
      providerType: 'openai-compatible',
    });
    await useRemoteServerStore.getState().discoverModels(serverId);
    await setActiveRemoteTextModelImpl(serverId, MODEL_ID);
  } finally {
    restoreFetch();
  }
  server = installChatStreamServer();
  h.render();
  return h;
}

// About 3,500 tokens: past 80% of the phone's 4096, far inside a 32K model.
const LONG =
  'The quarterly plan covers hiring, budget and the launch dates. '.repeat(220);

describe('a remote model with a large context', () => {
  it('keeps a 3,500-token chat whole: no summary call, every earlier message sent', async () => {
    const h = await chatWithRemote(32768);
    server!.reply(sse('Noted.'), sse('Here is the plan.'));
    await h.tapSend(LONG);
    await h.rtl.waitFor(
      () => expect(h.view!.queryByText('Noted.')).not.toBeNull(),
      { timeout: 8000 },
    );
    await h.tapSend('Sum it up');
    await h.rtl.waitFor(
      () => expect(h.view!.queryByText('Here is the plan.')).not.toBeNull(),
      { timeout: 8000 },
    );

    // Two turns, two requests: no summary request between them.
    expect(server!.requests).toHaveLength(2);
    const sent = server!.requests[1].body.messages.map(
      (m: { content: unknown }) => JSON.stringify(m.content),
    );
    expect(sent.some((c: string) => c.includes(LONG.trim()))).toBe(true);
  });

  it('still compacts when the server model really is small', async () => {
    const h = await chatWithRemote(4096);
    server!.reply(
      sse('Noted.'),
      sse('A short summary.'),
      sse('Here is the plan.'),
    );
    await h.tapSend(LONG);
    await h.rtl.waitFor(
      () => expect(h.view!.queryByText('Noted.')).not.toBeNull(),
      { timeout: 8000 },
    );
    await h.tapSend('Sum it up');
    await h.rtl.waitFor(
      () => expect(h.view!.queryByText('Here is the plan.')).not.toBeNull(),
      { timeout: 8000 },
    );

    // The summary call happens before the answer, and the long message is not sent again whole.
    expect(server!.requests).toHaveLength(3);
    const sent = server!.requests[2].body.messages.map(
      (m: { content: unknown }) => JSON.stringify(m.content),
    );
    expect(sent.some((c: string) => c.includes(LONG.trim()))).toBe(false);
  });
});
