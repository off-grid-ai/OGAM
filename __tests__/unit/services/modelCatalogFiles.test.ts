import {
  catalogModelFiles,
  resolveModelFiles,
} from '../../../src/services/modelCatalogFiles';
import type { ModelEntry } from '@offgrid/models';

describe('modelCatalogFiles', () => {
  it('projects the Shared Gemma entry with its primary and projector artifacts', () => {
    const files = catalogModelFiles('unsloth/gemma-4-E2B-it-GGUF');

    expect(files).toEqual([
      expect.objectContaining({
        name: 'gemma-4-E2B-it-Q4_K_M.gguf',
        quantization: 'Q4_K_M',
        downloadUrl: expect.stringContaining(
          '/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf',
        ),
        mmProjFile: expect.objectContaining({
          name: 'mmproj-gemma-4-E2B-it-F16.gguf',
          downloadUrl: expect.stringContaining(
            '/unsloth/gemma-4-E2B-it-GGUF/resolve/main/mmproj-F16.gguf',
          ),
        }),
      }),
    ]);
  });

  it('adds discovered quantizations and preserves matching catalog metadata', async () => {
    const discovery = { getModelFiles: jest.fn().mockResolvedValue([
      {
        name: 'gemma-4-E2B-it-Q4_K_M.gguf',
        size: 1,
        quantization: 'Q4_K_M',
        downloadUrl: 'https://untrusted.test/Q4_K_M.gguf',
      },
      {
        name: 'gemma-4-E2B-it-Q5_K_M.gguf',
        size: 3_356_037_216,
        quantization: 'Q5_K_M',
        downloadUrl: 'https://huggingface.test/Q5_K_M.gguf',
      },
    ]) };

    const files = await resolveModelFiles(
      'unsloth/gemma-4-E2B-it-GGUF',
      discovery,
    );

    expect(files).toHaveLength(2);
    expect(files[0]).toEqual(expect.objectContaining({
      name: 'gemma-4-E2B-it-Q4_K_M.gguf',
      size: 3_110_000_000,
      downloadUrl: expect.stringContaining(
        '/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf',
      ),
    }));
    expect(files[1]?.name).toBe('gemma-4-E2B-it-Q5_K_M.gguf');
    expect(discovery.getModelFiles).toHaveBeenCalledWith(
      'unsloth/gemma-4-E2B-it-GGUF',
    );
  });

  it('uses catalog files when remote variant discovery fails', async () => {
    const discovery = {
      getModelFiles: jest.fn().mockRejectedValue(new Error('offline')),
    };

    const files = await resolveModelFiles(
      'unsloth/gemma-4-E2B-it-GGUF',
      discovery,
    );

    expect(files.map(file => file.name)).toEqual([
      'gemma-4-E2B-it-Q4_K_M.gguf',
    ]);
  });

  it('uses network discovery for an uncatalogued model', async () => {
    const discoveredFile = {
      name: 'custom-Q4_K_M.gguf',
      size: 100,
      quantization: 'Q4_K_M',
      downloadUrl: 'https://example.test/custom-Q4_K_M.gguf',
    };
    const discovery = {
      getModelFiles: jest.fn().mockResolvedValue([discoveredFile]),
    };

    await expect(
      resolveModelFiles('community/custom-GGUF', discovery),
    ).resolves.toEqual([discoveredFile]);
    expect(discovery.getModelFiles).toHaveBeenCalledWith(
      'community/custom-GGUF',
    );
  });

  it('does not discover files for a catalog-owned runtime model', async () => {
    const catalog: ModelEntry[] = [
      {
        id: 'runtime/model',
        name: 'Runtime Model',
        kind: 'voice',
        artifactDelivery: 'runtime',
        files: [],
      },
    ];

    expect(catalogModelFiles('runtime/model', catalog)).toEqual([]);
  });
});
