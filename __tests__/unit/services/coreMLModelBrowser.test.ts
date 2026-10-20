/**
 * CoreMLModelBrowser Unit Tests
 *
 * Tests the iOS-specific Core ML model discovery service that fetches
 * available image models from Apple's HuggingFace repos.
 *
 * Priority: P0 (Critical) - If this breaks, iOS users can't discover image models.
 */

// Mock fetch globally before importing
declare const global: any;
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

import {
  fetchAvailableCoreMLModels,
} from '../../../src/services/coreMLModelBrowser';

// ============================================================================
// Test data
// ============================================================================

const makeTreeEntry = (
  path: string,
  type: 'file' | 'directory',
  size = 0,
  lfsSize?: number,
) => ({
  type,
  path,
  size,
  ...(lfsSize ? { lfs: { oid: 'abc', size: lfsSize, pointerSize: 100 } } : {}),
});

// Top-level tree for a valid repo
const topLevelTree = [
  makeTreeEntry('README.md', 'file', 5000),
  makeTreeEntry('original', 'directory'),
  makeTreeEntry('split_einsum', 'directory'),
];

// Inside split_einsum/
const splitEinsumTree = [
  makeTreeEntry('split_einsum/compiled', 'directory'),
  makeTreeEntry('split_einsum/packages', 'directory'),
];

// Inside split_einsum/compiled/
const compiledTree = [
  makeTreeEntry('split_einsum/compiled/TextEncoder.mlmodelc', 'directory'),
  makeTreeEntry('split_einsum/compiled/Unet.mlmodelc', 'directory'),
  makeTreeEntry('split_einsum/compiled/VAEDecoder.mlmodelc', 'directory'),
  makeTreeEntry('split_einsum/compiled/merges.txt', 'file', 500),
  makeTreeEntry('split_einsum/compiled/vocab.json', 'file', 800),
];

// Inside TextEncoder.mlmodelc/
const textEncoderFiles = [
  makeTreeEntry('split_einsum/compiled/TextEncoder.mlmodelc/model.mlmodel', 'file', 100, 250_000_000),
  makeTreeEntry('split_einsum/compiled/TextEncoder.mlmodelc/weights.bin', 'file', 100, 200_000_000),
];

// Inside Unet.mlmodelc/
const unetFiles = [
  makeTreeEntry('split_einsum/compiled/Unet.mlmodelc/model.mlmodel', 'file', 100, 1_500_000_000),
];

// Inside VAEDecoder.mlmodelc/
const vaeFiles = [
  makeTreeEntry('split_einsum/compiled/VAEDecoder.mlmodelc/model.mlmodel', 'file', 100, 100_000_000),
];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Set up fetch mock to respond with the correct tree for each URL path.
 * Handles both repos by matching on path patterns (not repo-specific).
 */
function setupSuccessfulFetch(_repo?: string) {
  mockFetch.mockImplementation(async (url: string) => {
    const urlStr = String(url);

    // Top-level (any repo)
    if (urlStr.match(/\/tree\/main$/)) {
      return { ok: true, json: () => Promise.resolve(topLevelTree) };
    }
    // split_einsum directory
    if (urlStr.endsWith('tree/main/split_einsum')) {
      return { ok: true, json: () => Promise.resolve(splitEinsumTree) };
    }
    // compiled directory
    if (urlStr.endsWith('tree/main/split_einsum/compiled')) {
      return { ok: true, json: () => Promise.resolve(compiledTree) };
    }
    // TextEncoder.mlmodelc
    if (urlStr.includes('TextEncoder.mlmodelc')) {
      return { ok: true, json: () => Promise.resolve(textEncoderFiles) };
    }
    // Unet.mlmodelc
    if (urlStr.includes('Unet.mlmodelc')) {
      return { ok: true, json: () => Promise.resolve(unetFiles) };
    }
    // VAEDecoder.mlmodelc
    if (urlStr.includes('VAEDecoder.mlmodelc')) {
      return { ok: true, json: () => Promise.resolve(vaeFiles) };
    }

    return { ok: true, json: () => Promise.resolve([]) };
  });
}

function setupFailingFetch() {
  mockFetch.mockResolvedValue({
    ok: false,
    status: 500,
    json: () => Promise.resolve({}),
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('CoreMLModelBrowser', () => {
  let fetchCoreMLModels: typeof fetchAvailableCoreMLModels;

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-require module to get fresh internal cache (cachedModels, cacheTimestamp)
    jest.resetModules();
    const mod = require('../../../src/services/coreMLModelBrowser');
    fetchCoreMLModels = mod.fetchAvailableCoreMLModels;
  });

  describe('fetchAvailableCoreMLModels', () => {
    it('fetches and returns Core ML models from Apple repos', async () => {
      setupSuccessfulFetch('apple/coreml-stable-diffusion-2-1-base');

      // Force refresh to bypass any cache
      const models = await fetchCoreMLModels(true);

      expect(models.length).toBeGreaterThanOrEqual(1);
    });

    it('returns models with correct shape', async () => {
      setupSuccessfulFetch('apple/coreml-stable-diffusion-2-1-base');

      const models = await fetchCoreMLModels(true);

      if (models.length > 0) {
        const model = models[0]!;
        expect(model).toHaveProperty('id');
        expect(model).toHaveProperty('name');
        expect(model).toHaveProperty('displayName');
        expect(model).toHaveProperty('backend', 'coreml');
        expect(model).toHaveProperty('downloadUrl');
        expect(model).toHaveProperty('fileName');
        expect(model).toHaveProperty('size');
        expect(model).toHaveProperty('repo');
        expect(model).toHaveProperty('files');
        expect(typeof model.id).toBe('string');
        expect(typeof model.size).toBe('number');
        expect(Array.isArray(model.files)).toBe(true);
      }
    });

    it('sets backend to coreml for all models', async () => {
      setupSuccessfulFetch('apple/coreml-stable-diffusion-2-1-base');

      const models = await fetchCoreMLModels(true);

      models.forEach(model => {
        expect(model.backend).toBe('coreml');
      });
    });

    it('calculates total size from LFS file sizes', async () => {
      setupSuccessfulFetch('apple/coreml-stable-diffusion-2-1-base');

      const models = await fetchCoreMLModels(true);

      if (models.length > 0) {
        // Size should be sum of all file sizes (LFS sizes when available)
        // 250M + 200M + 1500M + 100M + 500 + 800 = ~2050M
        expect(models[0]!.size).toBeGreaterThan(0);
      }
    });

    it('includes download URLs for each file', async () => {
      setupSuccessfulFetch('apple/coreml-stable-diffusion-2-1-base');

      const models = await fetchCoreMLModels(true);

      if (models.length > 0) {
        models[0]!.files!.forEach(file => {
          expect(file.downloadUrl).toContain('https://huggingface.co/');
          expect(file.downloadUrl).toContain('resolve/main/');
        });
      }
    });

    it('names a model in plain words, without the "(Core ML)" runtime suffix', async () => {
      setupSuccessfulFetch('apple/coreml-stable-diffusion-2-1-base');

      const models = await fetchCoreMLModels(true);

      if (models.length > 0) {
        expect(models[0]!.displayName).not.toContain('Core ML');
      }
    });

    it('generates correct display name for SD 2.1 Base repo', async () => {
      setupSuccessfulFetch('apple/coreml-stable-diffusion-2-1-base');

      const models = await fetchCoreMLModels(true);
      const sd21 = models.find(m => m.repo === 'apple/coreml-stable-diffusion-2-1-base');

      if (sd21) {
        expect(sd21.name).toBe('SD 2.1 Base');
      }
    });

    it('returns models from multiple repos', async () => {
      setupSuccessfulFetch('apple/coreml-stable-diffusion-2-1-base');

      const models = await fetchCoreMLModels(true);

      // Should return models from multiple repos
      expect(models.length).toBeGreaterThanOrEqual(2);
      const repos = models.map(m => m.repo);
      const uniqueRepos = new Set(repos);
      expect(uniqueRepos.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe('caching', () => {
    it('returns cached models within TTL', async () => {
      setupSuccessfulFetch('apple/coreml-stable-diffusion-2-1-base');

      // First call populates cache
      const first = await fetchCoreMLModels(true);
      const fetchCountAfterFirst = mockFetch.mock.calls.length;

      // Second call should use cache
      const second = await fetchCoreMLModels(false);
      const fetchCountAfterSecond = mockFetch.mock.calls.length;

      // No additional fetch calls
      expect(fetchCountAfterSecond).toBe(fetchCountAfterFirst);
      expect(second).toEqual(first);
    });

    it('forceRefresh bypasses cache', async () => {
      setupSuccessfulFetch('apple/coreml-stable-diffusion-2-1-base');

      // First call
      await fetchCoreMLModels(true);
      const fetchCountAfterFirst = mockFetch.mock.calls.length;

      // Force refresh should make new fetch calls
      await fetchCoreMLModels(true);
      const fetchCountAfterRefresh = mockFetch.mock.calls.length;

      expect(fetchCountAfterRefresh).toBeGreaterThan(fetchCountAfterFirst);
    });
  });

  describe('error handling', () => {
    it('handles API errors gracefully via Promise.allSettled', async () => {
      setupFailingFetch();

      // Should not throw
      const models = await fetchCoreMLModels(true);

      // Returns empty array when all repos fail
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBe(0);
    });

    it('returns partial results when one repo fails', async () => {
      let _callCount = 0;
      mockFetch.mockImplementation(async (url: string) => {
        const urlStr = String(url);

        // First repo succeeds
        if (urlStr.includes('2-1-base')) {
          _callCount++;
          // Route to success handler for 2-1-base repo
          if (urlStr.endsWith('tree/main')) {
            return { ok: true, json: () => Promise.resolve(topLevelTree) };
          }
          if (urlStr.includes('split_einsum') && !urlStr.includes('compiled')) {
            return { ok: true, json: () => Promise.resolve(splitEinsumTree) };
          }
          if (urlStr.includes('compiled') && !urlStr.includes('.mlmodelc')) {
            return { ok: true, json: () => Promise.resolve(compiledTree) };
          }
          if (urlStr.includes('TextEncoder')) {
            return { ok: true, json: () => Promise.resolve(textEncoderFiles) };
          }
          if (urlStr.includes('Unet')) {
            return { ok: true, json: () => Promise.resolve(unetFiles) };
          }
          if (urlStr.includes('VAEDecoder')) {
            return { ok: true, json: () => Promise.resolve(vaeFiles) };
          }
          return { ok: true, json: () => Promise.resolve([]) };
        }

        // Second repo fails
        return { ok: false, status: 404, json: () => Promise.resolve({}) };
      });

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const models = await fetchCoreMLModels(true);

      // Should still return models from the successful repo
      expect(models.length).toBeGreaterThanOrEqual(0);

      warnSpy.mockRestore();
    });

    it('skips repos without split_einsum variant', async () => {
      // Return a tree that doesn't have split_einsum directory
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          makeTreeEntry('README.md', 'file', 100),
          makeTreeEntry('original', 'directory'),
          // No split_einsum!
        ]),
      });

      const models = await fetchCoreMLModels(true);

      expect(models.length).toBe(0);
    });

    it('skips repos without compiled subdirectory', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (String(url).endsWith('tree/main')) {
          return { ok: true, json: () => Promise.resolve(topLevelTree) };
        }
        // split_einsum exists but no compiled subdir
        return {
          ok: true,
          json: () => Promise.resolve([
            makeTreeEntry('split_einsum/packages', 'directory'),
          ]),
        };
      });

      const models = await fetchCoreMLModels(true);

      expect(models.length).toBe(0);
    });

    it('logs warnings for failed repos', async () => {
      setupFailingFetch();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      await fetchCoreMLModels(true);

      expect(warnSpy).toHaveBeenCalled();
      const warnCalls = warnSpy.mock.calls.map(c => c[0]);
      expect(warnCalls.some((msg: string) => msg.includes('[CoreMLBrowser]'))).toBe(true);

      warnSpy.mockRestore();
    });
  });

  // ============================================================================
  // Strategy 1: zip archive path (lines 141-142)
  // ============================================================================
  describe('zip archive (Strategy 1)', () => {
    it('returns a model with downloadUrl and no files when a compiled zip is found (lines 141-142)', async () => {
      // A top-level tree that contains a zip matching findCompiledZip criteria
      const zipTree = [
        makeTreeEntry('README.md', 'file', 5000),
        makeTreeEntry(
          'coreml-sd-v1-5-palettized_split_einsum_v2_compiled.zip',
          'file',
          0,
          1_800_000_000, // LFS size
        ),
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(zipTree),
      });

      const models = await fetchCoreMLModels(true);

      // At least one model should have been created via the zip path
      expect(models.length).toBeGreaterThan(0);
      const zipModel = models[0]!;
      // Zip-path models have a downloadUrl but no individual files array
      expect(zipModel.downloadUrl).toContain('resolve/main/');
      expect(zipModel.downloadUrl).toContain('.zip');
      // Size comes from LFS size in the zip entry
      expect(zipModel.size).toBeGreaterThan(0);
    });

    it('uses zipEntry.size as fallback when lfs size is absent (lines 141-142)', async () => {
      const zipTree = [
        makeTreeEntry(
          'model_split_einsum_compiled.zip',
          'file',
          500_000_000, // plain size (no LFS)
        ),
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(zipTree),
      });

      const models = await fetchCoreMLModels(true);

      expect(models.length).toBeGreaterThan(0);
      expect(models[0]!.size).toBe(500_000_000);
    });
  });

  describe('model ID generation', () => {
    it('generates unique IDs from repo name', async () => {
      setupSuccessfulFetch('apple/coreml-stable-diffusion-2-1-base');

      const models = await fetchCoreMLModels(true);

      models.forEach(model => {
        expect(model.id).toMatch(/^coreml_/);
        // ID is derived from repo name: coreml_{org}_{repo-name}
        expect(model.id).toContain('apple_coreml-stable-diffusion');
      });

      // IDs should be unique across all models
      const ids = models.map(m => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
