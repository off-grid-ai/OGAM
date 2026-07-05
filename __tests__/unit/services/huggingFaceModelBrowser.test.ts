import {
  fetchAvailableModels,
  getVariantLabel,
  guessStyle,
} from '../../../src/services/huggingFaceModelBrowser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();
(globalThis as any).fetch = mockFetch;

/** Build a fake HuggingFace tree entry. */
function treeEntry(
  path: string,
  size: number,
  type = 'file',
  lfsSize?: number,
) {
  return {
    type,
    path,
    size,
    ...(lfsSize === undefined
      ? {}
      : { lfs: { oid: 'abc', size: lfsSize, pointerSize: 100 } }),
  };
}

/**
 * Helper that makes `fetch` return the given body for each successive call.
 * Each element in `responses` becomes one `Response`-like object.
 */
function mockFetchResponses(...responses: { ok: boolean; body?: unknown }[]) {
  responses.forEach(({ ok, body }) => {
    mockFetch.mockResolvedValueOnce({
      ok,
      status: ok ? 200 : 500,
      json: () => Promise.resolve(body),
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('huggingFaceModelBrowser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // parseFileName (tested indirectly via fetchAvailableModels)
  // -----------------------------------------------------------------------
  describe('parseFileName (via fetchAvailableModels)', () => {
    it('parses MNN backend zip as an MNN model', async () => {
      mockFetchResponses(
        { ok: true, body: [treeEntry('AnythingV5.zip', 500, 'file', 2000)] },
        { ok: true, body: [] },
      );

      const models = await fetchAvailableModels(true);

      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        id: 'anythingv5_cpu',
        name: 'AnythingV5',
        displayName: 'Anything V5 (MNN)',
        backend: 'mnn',
        fileName: 'AnythingV5.zip',
        size: 2000,
        repo: 'xororz/sd-mnn',
        downloadUrl:
          'https://huggingface.co/xororz/sd-mnn/resolve/main/AnythingV5.zip',
      });
      expect(models[0].variant).toBeUndefined();
    });

    it('parses QNN backend zip as an NPU model with variant', async () => {
      mockFetchResponses(
        { ok: true, body: [] },
        {
          ok: true,
          body: [
            treeEntry('AnythingV5_qnn2.28_8gen2.zip', 100, 'file', 3000),
          ],
        },
      );

      const models = await fetchAvailableModels(true);

      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        id: 'anythingv5_npu_8gen2',
        name: 'AnythingV5',
        displayName: 'Anything V5 (NPU 8gen2)',
        backend: 'qnn',
        variant: '8gen2',
        fileName: 'AnythingV5_qnn2.28_8gen2.zip',
        size: 3000,
        repo: 'xororz/sd-qnn',
      });
    });

    it('parses QNN backend with "min" variant as non-flagship', async () => {
      mockFetchResponses(
        { ok: true, body: [] },
        {
          ok: true,
          body: [treeEntry('ChilloutMix_qnn2.28_min.zip', 100, 'file', 1500)],
        },
      );

      const models = await fetchAvailableModels(true);

      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        displayName: 'Chillout Mix (NPU non-flagship)',
        variant: 'min',
      });
    });

    it('filters out non-zip files', async () => {
      mockFetchResponses(
        {
          ok: true,
          body: [
            treeEntry('README.md', 200),
            treeEntry('AnythingV5.zip', 500, 'file', 2000),
          ],
        },
        { ok: true, body: [] },
      );

      const models = await fetchAvailableModels(true);

      expect(models).toHaveLength(1);
      expect(models[0].fileName).toBe('AnythingV5.zip');
    });

    it('filters out directory entries', async () => {
      mockFetchResponses(
        {
          ok: true,
          body: [
            treeEntry('somefolder', 0, 'directory'),
            treeEntry('Model.zip', 100, 'file', 1000),
          ],
        },
        { ok: true, body: [] },
      );

      const models = await fetchAvailableModels(true);

      expect(models).toHaveLength(1);
    });

    it('filters out QNN zips that do not match the expected pattern', async () => {
      mockFetchResponses(
        { ok: true, body: [] },
        {
          ok: true,
          body: [
            // Missing the _qnn<version>_<variant> pattern
            treeEntry('RandomFile.zip', 100),
            treeEntry('AnythingV5_qnn2.28_8gen2.zip', 100, 'file', 3000),
          ],
        },
      );

      const models = await fetchAvailableModels(true);

      expect(models).toHaveLength(1);
      expect(models[0].backend).toBe('qnn');
    });

    it('uses entry.size when lfs is absent', async () => {
      mockFetchResponses(
        { ok: true, body: [treeEntry('TinyModel.zip', 999)] },
        { ok: true, body: [] },
      );

      const models = await fetchAvailableModels(true);

      expect(models[0].size).toBe(999);
    });
  });

  // -----------------------------------------------------------------------
  // fetchAvailableModels
  // -----------------------------------------------------------------------
  describe('fetchAvailableModels', () => {
    it('returns parsed models from both repos', async () => {
      mockFetchResponses(
        { ok: true, body: [treeEntry('ModelA.zip', 10, 'file', 1000)] },
        {
          ok: true,
          body: [treeEntry('ModelB_qnn2.28_8gen1.zip', 10, 'file', 2000)],
        },
      );

      const models = await fetchAvailableModels(true);

      expect(models).toHaveLength(2);
      expect(models[0].backend).toBe('mnn');
      expect(models[1].backend).toBe('qnn');
    });

    it('sorts GPU (mnn) before NPU (qnn)', async () => {
      mockFetchResponses(
        { ok: true, body: [treeEntry('Zebra.zip', 10, 'file', 1000)] },
        {
          ok: true,
          body: [treeEntry('Alpha_qnn2.28_8gen2.zip', 10, 'file', 2000)],
        },
      );

      const models = await fetchAvailableModels(true);

      expect(models[0].backend).toBe('mnn');
      expect(models[1].backend).toBe('qnn');
    });

    it('sorts alphabetically within the same backend', async () => {
      mockFetchResponses(
        {
          ok: true,
          body: [
            treeEntry('Zebra.zip', 10, 'file', 1000),
            treeEntry('Alpha.zip', 10, 'file', 1000),
          ],
        },
        { ok: true, body: [] },
      );

      const models = await fetchAvailableModels(true);

      expect(models[0].name).toBe('Alpha');
      expect(models[1].name).toBe('Zebra');
    });

    it('uses cache on second call (no second fetch)', async () => {
      mockFetchResponses(
        { ok: true, body: [treeEntry('CachedModel.zip', 10, 'file', 500)] },
        { ok: true, body: [] },
      );

      const first = await fetchAvailableModels(true);
      const second = await fetchAvailableModels(false);

      // fetch should only have been called twice (once per repo, during the first call)
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(second).toEqual(first);
    });

    it('forceRefresh bypasses cache', async () => {
      // First call
      mockFetchResponses(
        { ok: true, body: [treeEntry('OldModel.zip', 10, 'file', 500)] },
        { ok: true, body: [] },
      );
      await fetchAvailableModels(true);

      // Second call with forceRefresh
      mockFetchResponses(
        { ok: true, body: [treeEntry('NewModel.zip', 10, 'file', 600)] },
        { ok: true, body: [] },
      );
      const models = await fetchAvailableModels(true);

      expect(mockFetch).toHaveBeenCalledTimes(4); // 2 per call
      expect(models).toHaveLength(1);
      expect(models[0].name).toBe('NewModel');
    });

    it('skips QNN repo when skipQnn is true', async () => {
      mockFetchResponses(
        { ok: true, body: [treeEntry('ModelA.zip', 10, 'file', 1000)] },
        // Second fetch should not happen
      );

      const models = await fetchAvailableModels(true, { skipQnn: true });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(models).toHaveLength(1);
      expect(models[0].backend).toBe('mnn');
    });

    it('fetches QNN repo when skipQnn is false', async () => {
      mockFetchResponses(
        { ok: true, body: [treeEntry('ModelA.zip', 10, 'file', 1000)] },
        { ok: true, body: [treeEntry('ModelB_qnn2.28_8gen1.zip', 10, 'file', 2000)] },
      );

      const models = await fetchAvailableModels(true, { skipQnn: false });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(models).toHaveLength(2);
    });

    it('throws when fetch returns a non-ok response', async () => {
      mockFetchResponses(
        { ok: false, body: null },
        { ok: true, body: [] },
      );

      await expect(fetchAvailableModels(true)).rejects.toThrow(
        /Failed to fetch.*HTTP 500/,
      );
    });

    it('propagates network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      await expect(fetchAvailableModels(true)).rejects.toThrow(
        'Network failure',
      );
    });
  });

  // -----------------------------------------------------------------------
  // getVariantLabel
  // -----------------------------------------------------------------------
  describe('getVariantLabel', () => {
    it('returns label for "min"', () => {
      expect(getVariantLabel('min')).toBe('For non-flagship Snapdragon chips');
    });

    it('returns label for "8gen1"', () => {
      expect(getVariantLabel('8gen1')).toBe('For Snapdragon 8 Gen 1');
    });

    it('returns label for "8gen2"', () => {
      expect(getVariantLabel('8gen2')).toBe('For Snapdragon 8 Gen 2/3/4/5');
    });

    it('returns undefined for undefined variant', () => {
      expect(getVariantLabel()).toBeUndefined();
    });

    it('returns undefined for unknown variant string', () => {
      expect(getVariantLabel('unknown_variant')).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // guessStyle
  // -----------------------------------------------------------------------
  describe('guessStyle', () => {
    it.each([
      ['AbsoluteReality', 'photorealistic'],
      ['realisticVision', 'photorealistic'],
      ['ChilloutMix', 'photorealistic'],
      ['Photon', 'photorealistic'],
      ['PHOTO_MODEL', 'photorealistic'],
    ])('returns "photorealistic" for %s', (name, expected) => {
      expect(guessStyle(name)).toBe(expected);
    });

    it.each([
      ['AnythingV5', 'anime'],
      ['MeinaMix', 'anime'],
      ['CounterfeitV3', 'anime'],
      ['DreamShaper', 'anime'],
    ])('returns "anime" for %s', (name, expected) => {
      expect(guessStyle(name)).toBe(expected);
    });
  });
});
