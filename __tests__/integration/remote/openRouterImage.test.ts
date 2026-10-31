/**
 * An image made on OpenRouter uses the model picked in the Image picker.
 *
 * SPEC (OGAM user's view): with OpenRouter added, I pick any image model it lists (Qwen Image,
 * FLUX, Nano Banana) and the next image is made by that model. Picking an image model does not
 * change the model my chats use on that server.
 *
 * Before: OpenRouter images went to its chat endpoint, which refuses pure image models, and a pick
 * on a non-Desktop server never reached generation, which kept using the model filled in when the
 * server was added. The pick also set the server's chat model to the image model.
 *
 * Real server manager, store and media runtime. Device boundary only: the network at `fetch`.
 */
import { remoteServerManager } from '../../../src/services/remoteServerManager';
import { remoteMediaRuntime } from '../../../src/services/remoteMediaRuntime';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';

const PNG = 'iVBORw0KGgo=';
let calls: Array<{ url: string; body: Record<string, unknown> }> = [];
let restoreFetch: () => void = () => undefined;

beforeEach(() => {
  calls = [];
  const oldFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ url, body });
    const json = url.endsWith('/api/v1/images')
      ? { created: 1, data: [{ b64_json: PNG, media_type: 'image/png' }] }
      : { error: { message: `${String(body.model)} cannot be used with the chat/completions endpoint.` } };
    return {
      ok: url.endsWith('/api/v1/images'),
      status: url.endsWith('/api/v1/images') ? 200 : 400,
      json: async () => json,
      text: async () => JSON.stringify(json),
    } as Response;
  }) as typeof global.fetch;
  restoreFetch = () => {
    global.fetch = oldFetch;
  };
});

afterEach(async () => {
  restoreFetch();
  await remoteServerManager.clearAllServers();
});

it('makes the image with the picked model through the Images API, and leaves the chat model alone', async () => {
  // As adding OpenRouter leaves it: a model filled in for each kind of work.
  const server = await remoteServerManager.addServer({
    name: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1',
    providerType: 'openai-compatible',
    mediaModels: { image: 'qwen/qwen-image-2.1-turbo' },
  });
  await remoteServerManager.setActiveRemoteTextModel(server.id, 'particle/particle-1').catch(() => undefined);
  const chatModel = useRemoteServerStore.getState().activeRemoteTextModelId;

  await remoteServerManager.setActiveRemoteImageModel(server.id, 'google/gemini-nano-banana-2.1');

  const saved = useRemoteServerStore.getState().getServerById(server.id)!;
  const image = await remoteMediaRuntime.generateImage(saved, { prompt: 'a red lighthouse', size: '512x512' });

  expect(image.base64).toBe(PNG);
  const sent = calls.find(call => call.url.endsWith('/api/v1/images'));
  expect(sent?.body).toMatchObject({ model: 'google/gemini-nano-banana-2.1', prompt: 'a red lighthouse', aspect_ratio: '1:1' });
  expect(calls.some(call => call.url.includes('/chat/completions'))).toBe(false);
  expect(useRemoteServerStore.getState().activeRemoteTextModelId).toBe(chatModel);
});
