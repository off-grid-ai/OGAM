/**
 * An Off Grid gateway lists its Computer Use specialists (a grounder, a decider) beside its chat
 * model. Connecting to it must not offer them as text models. The real connection test and model
 * discovery run; the gateway is the only fake, answering at the fetch boundary.
 */
import { testServerConnection } from '../../../src/stores/remoteServerHelpers';
import type { RemoteServer } from '../../../src/types/remoteServer';

const realFetch = globalThis.fetch;

const GATEWAY_MODELS = {
  object: 'list',
  data: [
    { id: 'qwen3.8-27b', name: 'Qwen3.8 27B', kind: 'chat' },
    {
      id: 'bartowski/tencent_UI-Mate-27B-GGUF',
      name: 'UI-Mate-27B',
      kind: 'grounding_specialist',
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
    },
    {
      id: 'jaredpalmer/kev-4b',
      name: 'Kev 4B',
      kind: 'decision_specialist',
      architecture: { input_modalities: ['text'], output_modalities: ['decisions'] },
    },
  ],
};

beforeEach(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === '/v1/models') {
      return new Response(JSON.stringify(GATEWAY_MODELS), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const server: RemoteServer = {
  id: 'pod',
  name: 'Pod gateway',
  endpoint: 'http://192.168.1.40:7878',
  providerType: 'openai-compatible',
  createdAt: '2026-10-22T10:00:00.000Z',
};

it('offers the gateway chat model as text, never its grounder or decider', async () => {
  const result = await testServerConnection(server);

  expect(result.success).toBe(true);
  expect(result.modelCatalog?.text?.map(model => model.id)).toEqual(['qwen3.8-27b']);
  expect(result.models?.map(model => model.id)).not.toContain('jaredpalmer/kev-4b');
  expect(result.models?.map(model => model.id)).not.toContain('bartowski/tencent_UI-Mate-27B-GGUF');
});
