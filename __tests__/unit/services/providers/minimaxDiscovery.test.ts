import { fetchModelsFromServer, testEndpointAndGetModels } from '../../../../src/stores/remoteServerHelpers';
import type { RemoteServer } from '../../../../src/types';

jest.mock('../../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../../../src/services/offGridDesktopModels', () => ({
  readOffGridDesktopModelState: jest.fn(async () => null),
}));
jest.mock('../../../../src/services/httpClient', () => ({
  testEndpoint: jest.fn(async () => ({ success: true, latency: 1 })),
  detectServerType: jest.fn(async () => null),
}));
jest.mock('../../../../src/stores/remoteModelCapabilities', () => ({
  isGenerativeModel: () => true,
  fetchModelCapabilities: jest.fn(async () => ({ contextLength: 4096, supportsVision: false })),
  RemoteAuthenticationError: class extends Error {},
}));

const directModels = [
  { id: 'MiniMax-M2.7', kind: 'chat' },
  { id: 'MiniMax-M3', kind: 'chat' },
  { id: 'MiniMax-M3.1-Flash', kind: 'chat' },
  { id: 'MiniMax-image', kind: 'image' },
  { id: 'MiniMax-speech', kind: 'speech' },
];

describe('MiniMax discovery', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  const serve = (data: unknown[]) => {
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200, json: async () => ({ object: 'list', data }),
    })) as unknown as typeof fetch;
  };

  it.each(['https://api.minimax.io/v1', 'https://api.minimaxi.com/v1/'])(
    'refreshes ordinary text choices at %s without changing saved IDs or media',
    async endpoint => {
      serve(directModels);
      const server = { id: 'saved', endpoint, mediaModels: { text: 'MiniMax-M2.7' } } as RemoteServer;
      const models = await fetchModelsFromServer(server);
      expect(models.map(model => model.id)).toEqual(['MiniMax-M3.1-Flash', 'MiniMax-M3']);
      expect(models[0].capabilities).toMatchObject({
        maxContextLength: 1_000_000, supportsVision: true,
        supportsToolCalling: true, thinkingLevelsOnly: true, acceptsThinkingKwarg: false,
      });
      expect(server.mediaModels?.text).toBe('MiniMax-M2.7');
      const result = await testEndpointAndGetModels(endpoint);
      expect(result.modelCatalog?.text?.map(model => model.id)).toEqual(['MiniMax-M3.1-Flash', 'MiniMax-M3']);
      expect(result.mediaModels).toEqual({ text: 'MiniMax-M3.1-Flash', image: 'MiniMax-image', voice: 'MiniMax-speech' });
    },
  );

  it('keeps gateway metadata, non-MiniMax models and media while ordering current text models', async () => {
    const data = [
      { id: 'other/model', context_length: 12345 },
      { id: 'minimax/minimax-m2.7' },
      { id: 'minimax/minimax-m3', context_length: 524288 },
      { id: 'minimax/minimax-m3.1-flash:free', context_length: 1000000 },
    ].map(model => ({ ...model, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, supported_parameters: ['tools'] }));
    serve([...data, { id: 'minimax/media', architecture: { output_modalities: ['image'] } }]);
    const endpoint = 'https://openrouter.ai/api/v1';
    const models = await fetchModelsFromServer({ id: 'gateway', endpoint } as RemoteServer);
    expect(models.map(model => model.id)).toEqual(['other/model', 'minimax/minimax-m3.1-flash:free', 'minimax/minimax-m3']);
    expect(models[2].capabilities.maxContextLength).toBe(524288);
    expect(models[1].capabilities).toMatchObject({
      supportsThinking: true, thinkingLevelsOnly: true, acceptsThinkingKwarg: false,
    });
    const result = await testEndpointAndGetModels(endpoint);
    expect(result.modelCatalog?.text?.map(model => model.id)).toEqual(models.map(model => model.id));
    expect(result.modelCatalog?.image?.map(model => model.id)).toEqual(['minimax/media']);
  });

  it('leaves custom endpoint model lists alone', async () => {
    serve(directModels);
    const models = await fetchModelsFromServer({ id: 'custom', endpoint: 'https://custom.example/v1' } as RemoteServer);
    expect(models.map(model => model.id)).toEqual(['MiniMax-M2.7', 'MiniMax-M3', 'MiniMax-M3.1-Flash']);
  });
});
