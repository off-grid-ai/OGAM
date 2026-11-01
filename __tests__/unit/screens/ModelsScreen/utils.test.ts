import { formatNumber, formatBytes, getDirectorySize, getModelType, matchesSdVersionFilter, getImageModelCompatibility, hfModelToDescriptor } from '../../../../src/screens/ModelsScreen/utils';
import type { NativeFileSystemBoundary } from '../../../harness/nativeFileSystem';

// The utils run for real (huggingFaceModelBrowser included). The disk is the in-memory nativeFileSystem.
jest.mock('react-native-fs', () => {
  const disk = require('../../../harness/nativeFileSystem').createNativeFileSystemBoundary();
  (globalThis as unknown as { __modelsUtilsDisk: unknown }).__modelsUtilsDisk = disk;
  return disk.module;
});
const disk = (globalThis as unknown as { __modelsUtilsDisk: NativeFileSystemBoundary }).__modelsUtilsDisk;

describe('ModelsScreen/utils', () => {
  // ==========================================================================
  // formatNumber
  // ==========================================================================
  describe('formatNumber', () => {
    it('formats millions', () => {
      expect(formatNumber(1500000)).toBe('1.5M');
    });

    it('formats thousands', () => {
      expect(formatNumber(2500)).toBe('2.5K');
    });

    it('returns raw number for small values', () => {
      expect(formatNumber(42)).toBe('42');
    });

    it('formats exactly 1M', () => {
      expect(formatNumber(1000000)).toBe('1.0M');
    });

    it('formats exactly 1K', () => {
      expect(formatNumber(1000)).toBe('1.0K');
    });
  });

  // ==========================================================================
  // formatBytes
  // ==========================================================================
  describe('formatBytes', () => {
    it('formats gigabytes', () => {
      expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB');
    });

    it('formats megabytes', () => {
      expect(formatBytes(500 * 1024 * 1024)).toBe('500 MB');
    });

    it('formats kilobytes', () => {
      expect(formatBytes(512 * 1024)).toBe('512 KB');
    });

    it('formats bytes', () => {
      expect(formatBytes(100)).toBe('100 B');
    });
  });

  // ==========================================================================
  // getDirectorySize
  // ==========================================================================
  describe('getDirectorySize', () => {
    beforeEach(() => disk.reset());

    it('sums file sizes in a flat directory', async () => {
      disk.seedFile('/a/file1', 100);
      disk.seedFile('/a/file2', 200);

      expect(await getDirectorySize('/a')).toBe(300);
    });

    it('recurses into subdirectories', async () => {
      disk.seedFile('/a/file1', 50);
      disk.seedFile('/a/sub/file2', 150);

      expect(await getDirectorySize('/a')).toBe(200);
    });

    it('handles a size the platform reports as a string', async () => {
      disk.seedFile('/a/file1', 500);
      disk.setReportedFileSize('/a/file1', '500');

      expect(await getDirectorySize('/a')).toBe(500);
    });

    it('counts a size the platform reports as empty as 0', async () => {
      disk.seedFile('/a/file1', 500);
      disk.setReportedFileSize('/a/file1', '');

      expect(await getDirectorySize('/a')).toBe(0);
    });
  });

  // ==========================================================================
  // getModelType
  // ==========================================================================
  describe('getModelType', () => {
    const makeModel = (overrides: Partial<{ name: string; id: string; tags: string[] }>) => ({
      name: overrides.name ?? 'test-model',
      id: overrides.id ?? 'test/model',
      tags: overrides.tags ?? [],
      author: 'test',
      description: '',
      downloads: 0,
      likes: 0,
      lastModified: '',
      files: [],
    });

    it('detects image-gen from diffusion tag', () => {
      expect(getModelType(makeModel({ tags: ['diffusion'] }))).toBe('image-gen');
    });

    it('detects image-gen from text-to-image tag', () => {
      expect(getModelType(makeModel({ tags: ['text-to-image'] }))).toBe('image-gen');
    });

    it('detects image-gen from image-generation tag', () => {
      expect(getModelType(makeModel({ tags: ['image-generation'] }))).toBe('image-gen');
    });

    it('detects image-gen from diffusers tag', () => {
      expect(getModelType(makeModel({ tags: ['diffusers'] }))).toBe('image-gen');
    });

    it('detects image-gen from name containing stable-diffusion', () => {
      expect(getModelType(makeModel({ name: 'stable-diffusion-xl' }))).toBe('image-gen');
    });

    it('detects image-gen from name containing sd-', () => {
      expect(getModelType(makeModel({ name: 'sd-v1.5' }))).toBe('image-gen');
    });

    it('detects image-gen from name containing sdxl', () => {
      expect(getModelType(makeModel({ name: 'sdxl-turbo' }))).toBe('image-gen');
    });

    it('detects image-gen from id containing stable-diffusion', () => {
      expect(getModelType(makeModel({ id: 'test/stable-diffusion-v2' }))).toBe('image-gen');
    });

    it('detects image-gen from id containing coreml-stable', () => {
      expect(getModelType(makeModel({ id: 'apple/coreml-stable-diffusion' }))).toBe('image-gen');
    });

    it('detects vision from vision tag', () => {
      expect(getModelType(makeModel({ tags: ['vision'] }))).toBe('vision');
    });

    it('detects vision from multimodal tag', () => {
      expect(getModelType(makeModel({ tags: ['multimodal'] }))).toBe('vision');
    });

    it('detects vision from image-text tag', () => {
      expect(getModelType(makeModel({ tags: ['image-text'] }))).toBe('vision');
    });

    it('detects vision from name containing vision', () => {
      expect(getModelType(makeModel({ name: 'llama-vision-7b' }))).toBe('vision');
    });

    it('detects vision from name containing vlm', () => {
      expect(getModelType(makeModel({ name: 'test-vlm-model' }))).toBe('vision');
    });

    it('detects vision from name containing llava', () => {
      expect(getModelType(makeModel({ name: 'llava-1.5-7b' }))).toBe('vision');
    });

    it('detects vision from id containing vision', () => {
      expect(getModelType(makeModel({ id: 'test/vision-model' }))).toBe('vision');
    });

    it('detects vision from id containing vlm', () => {
      expect(getModelType(makeModel({ id: 'test/vlm-7b' }))).toBe('vision');
    });

    it('detects vision from id containing llava', () => {
      expect(getModelType(makeModel({ id: 'test/llava-v1.6' }))).toBe('vision');
    });

    it('detects code from code tag', () => {
      expect(getModelType(makeModel({ tags: ['code'] }))).toBe('code');
    });

    it('detects code from name containing code', () => {
      expect(getModelType(makeModel({ name: 'deepseek-code-7b' }))).toBe('code');
    });

    it('detects code from name containing coder', () => {
      expect(getModelType(makeModel({ name: 'starcoder2-3b' }))).toBe('code');
    });

    it('detects code from name containing starcoder', () => {
      expect(getModelType(makeModel({ name: 'starcoder-base' }))).toBe('code');
    });

    it('detects code from id containing code', () => {
      expect(getModelType(makeModel({ id: 'test/code-llama' }))).toBe('code');
    });

    it('detects code from id containing coder', () => {
      expect(getModelType(makeModel({ id: 'test/deepseek-coder-v2' }))).toBe('code');
    });

    it('returns text for generic model', () => {
      expect(getModelType(makeModel({ tags: ['text-generation'] }))).toBe('text');
    });

    it('prioritises image-gen over vision (diffusion + vision tags)', () => {
      expect(getModelType(makeModel({ tags: ['diffusion', 'vision'] }))).toBe('image-gen');
    });

    it('prioritises vision over code', () => {
      expect(getModelType(makeModel({ tags: ['vision', 'code'] }))).toBe('vision');
    });
  });

  // ==========================================================================
  // matchesSdVersionFilter
  // ==========================================================================
  describe('matchesSdVersionFilter', () => {
    it('returns true when filter is "all"', () => {
      expect(matchesSdVersionFilter('anything', 'all')).toBe(true);
    });

    it('matches sdxl by name containing sdxl', () => {
      expect(matchesSdVersionFilter('Model SDXL Turbo', 'sdxl')).toBe(true);
    });

    it('matches sdxl by name containing xl', () => {
      expect(matchesSdVersionFilter('Model XL Base', 'sdxl')).toBe(true);
    });

    it('rejects non-sdxl model for sdxl filter', () => {
      expect(matchesSdVersionFilter('Model SD 1.5', 'sdxl')).toBe(false);
    });

    it('matches sd21 by 2.1', () => {
      expect(matchesSdVersionFilter('stable-diffusion-2.1', 'sd21')).toBe(true);
    });

    it('matches sd21 by 2-1', () => {
      expect(matchesSdVersionFilter('sd-2-1-base', 'sd21')).toBe(true);
    });

    it('rejects non-sd21 model', () => {
      expect(matchesSdVersionFilter('sd-1.5-model', 'sd21')).toBe(false);
    });

    it('matches sd15 by 1.5', () => {
      expect(matchesSdVersionFilter('stable-diffusion-1.5', 'sd15')).toBe(true);
    });

    it('matches sd15 by 1-5', () => {
      expect(matchesSdVersionFilter('sd-1-5-base', 'sd15')).toBe(true);
    });

    it('matches sd15 by v1-5', () => {
      expect(matchesSdVersionFilter('runwayml-v1-5', 'sd15')).toBe(true);
    });

    it('rejects non-sd15 model', () => {
      expect(matchesSdVersionFilter('sdxl-turbo', 'sd15')).toBe(false);
    });

    it('returns true for unknown filter value', () => {
      expect(matchesSdVersionFilter('anything', 'unknown')).toBe(true);
    });
  });

  // ==========================================================================
  // getImageModelCompatibility
  // ==========================================================================
  describe('getImageModelCompatibility', () => {
    const makeHFModel = (overrides: Partial<{ backend: string; variant: string }> = {}) => ({
      id: 'test',
      name: 'test',
      displayName: 'Test',
      size: 1000,
      backend: overrides.backend ?? 'mnn',
      variant: overrides.variant,
      downloadUrl: '',
      fileName: '',
      repo: '',
    });

    it('returns compatible when imageRec is null', () => {
      const result = getImageModelCompatibility(makeHFModel() as any, null);
      expect(result.isCompatible).toBe(true);
      expect(result.incompatibleReason).toBeUndefined();
    });

    it('returns compatible when no compatibleBackends specified', () => {
      const result = getImageModelCompatibility(makeHFModel() as any, {
        recommendedBackend: 'mnn',
        maxModelSizeMB: 2048,
        canRunSD: true,
        canRunQNN: false,
      } as any);
      expect(result.isCompatible).toBe(true);
    });

    it('returns incompatible when backend not in compatibleBackends', () => {
      const result = getImageModelCompatibility(makeHFModel({ backend: 'qnn' }) as any, {
        recommendedBackend: 'mnn',
        compatibleBackends: ['mnn'],
      } as any);
      expect(result.isCompatible).toBe(false);
      expect(result.incompatibleReason).toBe('Requires Snapdragon 888+');
    });

    it('returns "Requires newer Snapdragon" for old Qualcomm device', () => {
      const result = getImageModelCompatibility(
        makeHFModel({ backend: 'qnn' }) as any,
        { recommendedBackend: 'mnn', compatibleBackends: ['mnn'] } as any,
        { vendor: 'qualcomm', hasNPU: false } as any,
      );
      expect(result.isCompatible).toBe(false);
      expect(result.incompatibleReason).toBe('Requires newer Snapdragon');
    });

    it('returns compatible when backend in compatibleBackends', () => {
      const result = getImageModelCompatibility(makeHFModel({ backend: 'mnn' }) as any, {
        recommendedBackend: 'mnn',
        compatibleBackends: ['mnn', 'qnn'],
      } as any);
      expect(result.isCompatible).toBe(true);
    });

    it('returns incompatible for wrong chip variant', () => {
      const result = getImageModelCompatibility(
        makeHFModel({ backend: 'qnn', variant: '8gen2' }) as any,
        { recommendedBackend: 'qnn', compatibleBackends: ['qnn'], qnnVariant: '8gen1' } as any,
      );
      expect(result.isCompatible).toBe(false);
      expect(result.incompatibleReason).toBe('Requires Snapdragon 8 Gen 2+');
    });

    it('8gen2 device is compatible with all variants', () => {
      const result = getImageModelCompatibility(
        makeHFModel({ backend: 'qnn', variant: 'min' }) as any,
        { recommendedBackend: 'qnn', compatibleBackends: ['qnn'], qnnVariant: '8gen2' } as any,
      );
      expect(result.isCompatible).toBe(true);
    });

    it('8gen1 device is compatible with non-8gen2 variants', () => {
      const result = getImageModelCompatibility(
        makeHFModel({ backend: 'qnn', variant: 'min' }) as any,
        { recommendedBackend: 'qnn', compatibleBackends: ['qnn'], qnnVariant: '8gen1' } as any,
      );
      expect(result.isCompatible).toBe(true);
    });

    it('same variant is compatible', () => {
      const result = getImageModelCompatibility(
        makeHFModel({ backend: 'qnn', variant: '8gen1' }) as any,
        { recommendedBackend: 'qnn', compatibleBackends: ['qnn'], qnnVariant: '8gen1' } as any,
      );
      expect(result.isCompatible).toBe(true);
    });

    it('model without variant is always variant-compatible', () => {
      const result = getImageModelCompatibility(
        makeHFModel({ backend: 'qnn' }) as any,
        { recommendedBackend: 'qnn', compatibleBackends: ['qnn'], qnnVariant: 'min' } as any,
      );
      expect(result.isCompatible).toBe(true);
    });
  });

  // ==========================================================================
  // hfModelToDescriptor
  // ==========================================================================
  describe('hfModelToDescriptor', () => {
    it('converts a standard mnn model', () => {
      const hf = {
        id: 'test-model',
        name: 'test-model',
        displayName: 'Test Model',
        size: 500000,
        backend: 'mnn' as const,
        variant: undefined,
        downloadUrl: 'https://example.com/model.zip',
        fileName: 'model.zip',
        repo: 'test/model',
      };

      const desc = hfModelToDescriptor(hf as any);
      expect(desc.id).toBe('test-model');
      expect(desc.name).toBe('Test Model');
      expect(desc.description).toContain('GPU');
      expect(desc.backend).toBe('mnn');
      expect(desc.size).toBe(500000);
    });

    it('converts a qnn model', () => {
      const hf = {
        id: 'qnn-model',
        name: 'qnn-model',
        displayName: 'QNN Model',
        size: 500000,
        backend: 'qnn' as const,
        variant: '8gen2',
        downloadUrl: 'https://example.com/model.zip',
        fileName: 'model.zip',
        repo: 'test/qnn',
      };

      const desc = hfModelToDescriptor(hf as any);
      expect(desc.description).toContain('NPU');
      expect(desc.backend).toBe('qnn');
      expect(desc.variant).toBe('8gen2');
    });

    it('converts a coreml model', () => {
      const hf = {
        id: 'coreml-model',
        name: 'coreml-model',
        displayName: 'CoreML Model',
        size: 500000,
        backend: 'coreml' as const,
        downloadUrl: 'https://example.com/model.zip',
        fileName: 'model.zip',
        repo: 'apple/coreml-sd',
        _coreml: true,
        _coremlFiles: [{ path: 'a.mlmodelc', relativePath: 'a.mlmodelc', size: 100, downloadUrl: 'https://example.com/a' }],
      };

      const desc = hfModelToDescriptor(hf as any);
      expect(desc.description).toContain('Core ML');
      expect(desc.backend).toBe('coreml');
      expect(desc.coremlFiles).toHaveLength(1);
      expect(desc.repo).toBe('apple/coreml-sd');
    });
  });
});
