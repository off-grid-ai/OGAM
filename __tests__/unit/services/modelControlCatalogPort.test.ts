import { createMobileModelControlPort } from '../../../src/services/adapters/models/modelControlCatalogPort';
import { publicImageDownloadRequest } from '../../../src/services/adapters/models/downloads/publicImageDownloadRequest';

const fetchMock = jest.fn();
const mobileModelControlPort = createMobileModelControlPort(async () => []);

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock;
});

describe('Mobile model-control catalog port', () => {
  it('resolves the exact selected Hugging Face artifact and its Shared-selected projector', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        siblings: [
          { rfilename: 'demo.Q4_K_M.gguf', lfs: { size: 101 } },
          { rfilename: 'demo.Q8_0.gguf', lfs: { size: 202 } },
          { rfilename: 'mmproj-demo-f16.gguf', lfs: { size: 33 } },
        ],
      }),
    });

    const resolved = await mobileModelControlPort.catalog.resolve?.(
      'org/demo/demo.Q4_K_M.gguf',
      new AbortController().signal,
      { repositoryId: 'org/demo', fileName: 'demo.Q4_K_M.gguf' },
    );

    expect(resolved).toEqual(
      expect.objectContaining({
        id: 'org/demo/demo.Q4_K_M.gguf',
        kind: 'text',
        catalogEntry: false,
      }),
    );
    expect(resolved?.artifacts).toEqual([
      expect.objectContaining({
        name: 'demo.Q4_K_M.gguf',
        role: 'primary',
        sizeBytes: 101,
      }),
      expect.objectContaining({
        name: 'mmproj-demo-f16.gguf',
        role: 'mmproj',
        sizeBytes: 33,
      }),
    ]);
    expect(resolved?.artifacts).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'demo.Q8_0.gguf' }),
      ]),
    );
  });

  it('returns no model when Hugging Face does not publish the selected file', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ siblings: [] }),
    });

    const resolved = await mobileModelControlPort.catalog.resolve?.(
      'org/demo/missing.gguf',
      new AbortController().signal,
      { repositoryId: 'org/demo', fileName: 'missing.gguf' },
    );

    expect(resolved).toBeNull();
  });

  it('resolves the exact image selected by guided setup from its validated metadata', async () => {
    const descriptor = {
      id: 'image-balanced',
      name: 'Balanced image',
      description: 'Balanced image',
      size: 200,
      downloadUrl: 'https://models.test/image-balanced.zip',
      style: 'general',
      backend: 'coreml' as const,
      repo: 'org/image-balanced',
    };
    const metadataJson = publicImageDownloadRequest(descriptor).metadataJson;
    const port = createMobileModelControlPort(async () => {
      throw new Error('The unrelated image catalog must not be read.');
    });

    const resolved = await port.catalog.resolve?.(
      'image:image-balanced',
      new AbortController().signal,
      {
        repositoryId: 'org/image-balanced',
        fileName: 'image-balanced.zip',
        metadataJson,
      },
    );

    expect(resolved).toEqual(
      expect.objectContaining({
        id: 'image:image-balanced',
        kind: 'image',
        catalogEntry: false,
      }),
    );
  });
});
