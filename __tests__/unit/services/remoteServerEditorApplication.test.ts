import {
  createRemoteServerEditorApplication,
  RemoteServerEditorOperationError,
  type RemoteServerEditorPorts,
} from '../../../src/services/modelServices/remoteServerEditorApplication';

function ports(
  overrides: Partial<RemoteServerEditorPorts> = {},
): RemoteServerEditorPorts {
  return {
    credentials: { read: async () => null },
    servers: {
      add: async input => ({ ...input, id: 'saved', createdAt: '2026-09-01' }),
      update: async () => undefined,
      testCandidate: async () => ({ success: true, models: [] }),
      testSaved: async () => ({ success: true }),
    },
    models: {
      project: () => undefined,
      select: async () => undefined,
    },
    activeServerId: () => null,
    ...overrides,
  };
}

describe('Remote Server Editor application boundary', () => {
  it('is independently composable and preserves credential failure identity', async () => {
    const application = createRemoteServerEditorApplication(ports({
      credentials: { read: async () => { throw new Error('Keychain unavailable'); } },
    }));

    await expect(application.loadExisting({
      id: 'desktop',
      name: 'Desktop',
      endpoint: 'https://desktop.example.test/v1',
      provider: 'openai-compatible',
      createdAt: '2026-09-01',
    }, {})).rejects.toEqual(expect.objectContaining({
      name: RemoteServerEditorOperationError.name,
      failure: {
        kind: 'credential-read',
        message: 'Could not read the API key from Keychain.',
      },
    }));
  });

  it('uses only injected ports for a successful candidate test', async () => {
    const testCandidate = jest.fn(async () => ({
      success: true,
      latency: 12,
      models: [],
    }));
    const application = createRemoteServerEditorApplication(ports({
      servers: { ...ports().servers, testCandidate },
    }));

    const result = await application.test({
      endpoint: 'https://desktop.example.test/v1',
      apiKey: '',
      current: {},
    });

    expect(testCandidate).toHaveBeenCalledWith(
      'https://desktop.example.test/v1',
      undefined,
    );
    expect(result).toMatchObject({
      failure: null,
      result: { success: true },
      models: [],
    });
  });

  it('projects transport identities and repository IDs to catalog-owned names', async () => {
    const application = createRemoteServerEditorApplication(ports({
      servers: {
        ...ports().servers,
        testCandidate: async () => ({
          success: true,
          latency: 4,
          selections: {
            text: 'remote-vision:desktop:unsloth%2FQwen3.5-2B-GGUF',
            image: 'offgrid-ai/dreamshaper-xl-v2-turbo-GGUF',
          },
          models: [{
            id: 'unsloth/Qwen3.5-2B-GGUF',
            name: 'Qwen 3.5 2B',
            serverId: 'desktop',
            capabilities: {
              supportsVision: true,
              supportsToolCalling: false,
              supportsThinking: false,
            },
            lastUpdated: '2026-09-01',
          }],
          catalog: {
            image: [{
              id: 'offgrid-ai/dreamshaper-xl-v2-turbo-GGUF',
              name: 'DreamShaper XL Turbo',
            }],
          },
          modelManagement: 'offgrid-desktop-v1',
        }),
      },
    }));

    const result = await application.test({
      endpoint: 'https://desktop.example.test/v1',
      apiKey: '',
      current: {},
    });

    expect(result.modelNames).toEqual({
      text: 'Qwen 3.5 2B',
      image: 'DreamShaper XL Turbo',
      transcription: null,
      voice: null,
    });
  });
});
