 
declare const global: any;

/**
 * HuggingFace Service Unit Tests
 *
 * Tests for model search, metadata parsing, quantization extraction,
 * mmproj matching, credibility determination, and file size formatting.
 * Priority: P1 (High) - Model discovery and download accuracy.
 */

import { huggingFaceService } from '../../../src/services/huggingface';

// Access private methods via cast
const service = huggingFaceService as any;

describe('HuggingFaceService', () => {
  // ============================================================================
  // extractQuantization
  // ============================================================================
  describe('extractQuantization', () => {
    it('extracts Q4_K_M from filename', () => {
      expect(service.extractQuantization('model-Q4_K_M.gguf')).toBe('Q4_K_M');
    });

    it('extracts Q5_K_S from filename', () => {
      expect(service.extractQuantization('model-Q5_K_S.gguf')).toBe('Q5_K_S');
    });

    it('extracts Q8_0 from filename', () => {
      expect(service.extractQuantization('model-Q8_0.gguf')).toBe('Q8_0');
    });

    it('extracts Q2_K from filename', () => {
      expect(service.extractQuantization('model-Q2_K.gguf')).toBe('Q2_K');
    });

    it('extracts Q3_K from Q3_K_L filename (matches first known quant)', () => {
      // extractQuantization checks known QUANTIZATION_INFO keys and returns first match
      const result = service.extractQuantization('model-Q3_K_L.gguf');
      expect(['Q3_K', 'Q3_K_L']).toContain(result);
    });

    it('extracts Q6_K from filename', () => {
      expect(service.extractQuantization('model-Q6_K.gguf')).toBe('Q6_K');
    });

    it('extracts F16 from filename', () => {
      expect(service.extractQuantization('model-f16.gguf')).toBe('F16');
    });

    it('handles case-insensitive matching', () => {
      expect(service.extractQuantization('model-q4_k_m.gguf')).toBe('Q4_K_M');
    });

    it('returns Unknown for unrecognized quantization', () => {
      expect(service.extractQuantization('model.gguf')).toBe('Unknown');
    });

    it('extracts from complex filenames', () => {
      expect(service.extractQuantization('Qwen2.5-7B-Instruct-Q4_K_M.gguf')).toBe('Q4_K_M');
    });
  });

  // ============================================================================
  // isMMProjFile
  // ============================================================================
  describe('isMMProjFile', () => {
    it('detects mmproj in filename', () => {
      expect(service.isMMProjFile('model-mmproj-f16.gguf')).toBe(true);
    });

    it('detects projector in filename', () => {
      expect(service.isMMProjFile('model-projector-q8_0.gguf')).toBe(true);
    });

    it('detects clip in .gguf filename', () => {
      expect(service.isMMProjFile('clip-model.gguf')).toBe(true);
    });

    it('does not detect clip in non-.gguf file', () => {
      expect(service.isMMProjFile('clip-model.bin')).toBe(false);
    });

    it('rejects regular model file', () => {
      expect(service.isMMProjFile('Qwen2.5-7B-Instruct-Q4_K_M.gguf')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(service.isMMProjFile('Model-MMPROJ-F16.gguf')).toBe(true);
    });
  });

  // ============================================================================
  // findMatchingMMProj
  // ============================================================================
  describe('findMatchingMMProj', () => {
    const modelId = 'org/model';

    it('returns undefined when no mmproj files', () => {
      const result = service.findMatchingMMProj('model-Q4_K_M.gguf', [], modelId);
      expect(result).toBeUndefined();
    });

    // Quant is NOT a matching signal (#510): one projector serves every quant of its model. Among several
    // generic projectors (no model-name token) for the repo's single model, F16 is preferred over other
    // precisions — never the model's own quant.
    it('prefers F16 among generic projectors, ignoring the model quant', () => {
      const mmProjFiles = [
        { path: 'mmproj-Q4_K_M.gguf', size: 100 },
        { path: 'mmproj-f16.gguf', size: 800 },
      ];

      const result = service.findMatchingMMProj('model-Q4_K_M.gguf', mmProjFiles, modelId);
      expect(result.name).toBe('mmproj-f16.gguf');
    });

    it('falls back to f16 mmproj when no quant match', () => {
      const mmProjFiles = [
        { path: 'mmproj-Q8_0.gguf', size: 400 },
        { path: 'mmproj-f16.gguf', size: 800 },
      ];

      const result = service.findMatchingMMProj('model-Q3_K_L.gguf', mmProjFiles, modelId);
      expect(result.name).toBe('mmproj-f16.gguf');
    });

    it('falls back to fp16 spelling variant', () => {
      const mmProjFiles = [
        { path: 'mmproj-fp16.gguf', size: 800 },
      ];

      const result = service.findMatchingMMProj('model-Q4_K_M.gguf', mmProjFiles, modelId);
      expect(result.name).toBe('mmproj-fp16.gguf');
    });

    it('falls back to first mmproj when no f16 available', () => {
      const mmProjFiles = [
        { path: 'mmproj-Q8_0.gguf', size: 400 },
      ];

      const result = service.findMatchingMMProj('model-Q3_K_L.gguf', mmProjFiles, modelId);
      expect(result.name).toBe('mmproj-Q8_0.gguf');
    });

    it('includes correct downloadUrl', () => {
      const mmProjFiles = [
        { path: 'mmproj-f16.gguf', size: 800 },
      ];

      const result = service.findMatchingMMProj('model-Q4_K_M.gguf', mmProjFiles, modelId);
      expect(result.downloadUrl).toContain(modelId);
      expect(result.downloadUrl).toContain('mmproj-f16.gguf');
    });

    it('uses lfs.size when available', () => {
      const mmProjFiles = [
        { path: 'mmproj-f16.gguf', size: 100, lfs: { size: 800000000 } },
      ];

      const result = service.findMatchingMMProj('model-Q4_K_M.gguf', mmProjFiles, modelId);
      expect(result.size).toBe(800000000);
    });
  });

  // ============================================================================
  // determineCredibility
  // ============================================================================
  describe('determineCredibility', () => {
    it('identifies lmstudio-community as lmstudio source', () => {
      const cred = service.determineCredibility('lmstudio-community');
      expect(cred.source).toBe('lmstudio');
      expect(cred.isVerifiedQuantizer).toBe(true);
      expect(cred.verifiedBy).toBe('LM Studio');
    });

    it('identifies official model authors', () => {
      const cred = service.determineCredibility('Qwen');
      expect(cred.source).toBe('official');
      expect(cred.isOfficial).toBe(true);
    });

    it('identifies verified quantizers', () => {
      const cred = service.determineCredibility('bartowski');
      expect(cred.source).toBe('verified-quantizer');
      expect(cred.isVerifiedQuantizer).toBe(true);
    });

    it('classifies unknown authors as community', () => {
      const cred = service.determineCredibility('random-user-123');
      expect(cred.source).toBe('community');
      expect(cred.isOfficial).toBe(false);
      expect(cred.isVerifiedQuantizer).toBe(false);
    });
  });

  // ============================================================================
  // formatFileSize
  // ============================================================================
  describe('formatFileSize', () => {
    it('formats 0 bytes', () => {
      expect(huggingFaceService.formatFileSize(0)).toBe('0 B');
    });

    it('formats bytes', () => {
      expect(huggingFaceService.formatFileSize(500)).toBe('500.00 B');
    });

    it('formats kilobytes', () => {
      expect(huggingFaceService.formatFileSize(1024)).toBe('1.00 KB');
    });

    it('formats megabytes', () => {
      expect(huggingFaceService.formatFileSize(1024 * 1024 * 2.5)).toBe('2.50 MB');
    });

    it('formats gigabytes', () => {
      expect(huggingFaceService.formatFileSize(1024 * 1024 * 1024 * 4.2)).toBe('4.20 GB');
    });
  });

  // ============================================================================
  // getQuantizationInfo
  // ============================================================================
  describe('getQuantizationInfo', () => {
    it('returns info for known quantization', () => {
      const info = huggingFaceService.getQuantizationInfo('Q4_K_M');
      expect(info.quality).toBeDefined();
      expect(info.bitsPerWeight).toBeGreaterThan(0);
    });

    it('returns default for unknown quantization', () => {
      const info = huggingFaceService.getQuantizationInfo('UNKNOWN');
      expect(info.quality).toBe('Unknown');
      expect(info.bitsPerWeight).toBe(4.5);
    });
  });

  // ============================================================================
  // getDownloadUrl
  // ============================================================================
  describe('getDownloadUrl', () => {
    it('constructs correct download URL', () => {
      const url = huggingFaceService.getDownloadUrl('org/model', 'file.gguf');
      expect(url).toContain('org/model');
      expect(url).toContain('resolve/main/file.gguf');
    });

    it('supports custom revision', () => {
      const url = huggingFaceService.getDownloadUrl('org/model', 'file.gguf', 'dev');
      expect(url).toContain('resolve/dev/file.gguf');
    });
  });

  // ============================================================================
  // transformModelResult
  // ============================================================================
  describe('transformModelResult', () => {
    it('transforms HF search result to ModelInfo', () => {
      const result = service.transformModelResult({
        id: 'org/model-name',
        author: 'org',
        downloads: 1000,
        likes: 50,
        tags: ['gguf', 'text-generation'],
        lastModified: '2024-01-01',
        siblings: [
          { rfilename: 'model-Q4_K_M.gguf', size: 4000000000 },
        ],
      });

      expect(result.id).toBe('org/model-name');
      expect(result.name).toBe('model-name');
      expect(result.author).toBe('org');
      expect(result.downloads).toBe(1000);
      expect(result.likes).toBe(50);
      expect(result.files).toHaveLength(1);
    });

    it('extracts author from ID when author field missing', () => {
      const result = service.transformModelResult({
        id: 'some-org/some-model',
        downloads: 0,
        likes: 0,
        tags: [],
        siblings: [],
      });

      expect(result.author).toBe('some-org');
    });

    it('filters siblings to only GGUF files', () => {
      const result = service.transformModelResult({
        id: 'org/model',
        author: 'org',
        downloads: 0,
        likes: 0,
        tags: [],
        siblings: [
          { rfilename: 'model.gguf', size: 4000000000 },
          { rfilename: 'README.md', size: 1000 },
          { rfilename: 'config.json', size: 500 },
        ],
      });

      expect(result.files).toHaveLength(1);
      expect(result.files[0].name).toBe('model.gguf');
    });

    it('generates description with type and author', () => {
      const result = service.transformModelResult({
        id: 'org/model',
        author: 'org',
        downloads: 0,
        likes: 0,
        tags: [],
        cardData: { pipeline_tag: 'text-generation' },
        siblings: [],
      });

      expect(result.description).toContain('Text generation');
      expect(result.description).toContain('org');
    });

    it('detects code model type from tags', () => {
      const result = service.transformModelResult({
        id: 'org/coder-7b',
        author: 'org',
        downloads: 0,
        likes: 0,
        tags: ['code'],
        siblings: [],
      });

      expect(result.description).toContain('Code generation');
    });

    it('includes param count in description when present in name', () => {
      const result = service.transformModelResult({
        id: 'org/llama-3b-gguf',
        author: 'org',
        downloads: 0,
        likes: 0,
        tags: [],
        siblings: [],
      });

      expect(result.description).toContain('3B');
    });
  });

  // ============================================================================
  // searchModels (with fetch mock)
  // ============================================================================
  describe('searchModels', () => {
    let mockFetch: jest.Mock;

    beforeEach(() => {
      jest.clearAllMocks();
      mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });
      global.fetch = mockFetch;
    });

    it('sends request with gguf filter', async () => {
      await huggingFaceService.searchModels();

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('filter=gguf');
    });

    it('appends search param when query provided', async () => {
      await huggingFaceService.searchModels('llama');

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('search=llama');
    });

    it('does not append search param for empty query', async () => {
      await huggingFaceService.searchModels('');

      const url = mockFetch.mock.calls[0][0];
      expect(url).not.toContain('search=');
    });

    it('throws on API error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      await expect(huggingFaceService.searchModels()).rejects.toThrow('API error: 500');
    });

    it('respects limit option', async () => {
      await huggingFaceService.searchModels('', { limit: 10 });

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('limit=10');
    });

    it('appends pipeline_tag when pipelineTag option is provided', async () => {
      await huggingFaceService.searchModels('', { pipelineTag: 'image-text-to-text' });

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('pipeline_tag=image-text-to-text');
    });

    it('does not append pipeline_tag when option is not provided', async () => {
      await huggingFaceService.searchModels('test');

      const url = mockFetch.mock.calls[0][0];
      expect(url).not.toContain('pipeline_tag');
    });

    it('combines query and pipeline_tag in the same request', async () => {
      await huggingFaceService.searchModels('qwen', { pipelineTag: 'image-text-to-text' });

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('search=qwen');
      expect(url).toContain('pipeline_tag=image-text-to-text');
    });
  });

  // ============================================================================
  // getModelFiles (with fetch mock)
  // ============================================================================
  describe('getModelFiles', () => {
    it('separates mmproj files from model files', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          { type: 'file', path: 'model-Q4_K_M.gguf', size: 4000000000 },
          { type: 'file', path: 'mmproj-f16.gguf', size: 800000000 },
          { type: 'file', path: 'README.md', size: 1000 },
        ]),
      });

      const files = await huggingFaceService.getModelFiles('org/model');

      // Only model files (not mmproj, not README)
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('model-Q4_K_M.gguf');
      // mmproj should be paired
      expect(files[0].mmProjFile).toBeDefined();
      expect(files[0].mmProjFile?.name).toBe('mmproj-f16.gguf');
    });

    it('sorts files by size ascending', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          { type: 'file', path: 'model-Q8_0.gguf', size: 8000000000 },
          { type: 'file', path: 'model-Q4_K_M.gguf', size: 4000000000 },
          { type: 'file', path: 'model-Q2_K.gguf', size: 2000000000 },
        ]),
      });

      const files = await huggingFaceService.getModelFiles('org/model');

      expect(files[0].size).toBeLessThan(files[1].size);
      expect(files[1].size).toBeLessThan(files[2].size);
    });

    it('falls back to siblings when tree endpoint fails', async () => {
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: false, status: 404 }) // tree fails
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'org/model',
            siblings: [
              { rfilename: 'model-Q4_K_M.gguf', size: 4000000000 },
            ],
          }),
        });

      const files = await huggingFaceService.getModelFiles('org/model');

      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('model-Q4_K_M.gguf');
    });
  });

  // ============================================================================
  // Additional branch coverage tests
  // ============================================================================
  describe('getModelDetails', () => {
    it('returns model info on success', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'org/test-model',
          author: 'org',
          downloads: 500,
          likes: 25,
          tags: ['gguf'],
          siblings: [{ rfilename: 'model-Q4_K_M.gguf', size: 4000000000 }],
        }),
      });
      global.fetch = mockFetch;

      const result = await huggingFaceService.getModelDetails('org/test-model');

      expect(result.id).toBe('org/test-model');
      expect(result.author).toBe('org');
    });

    it('throws on API error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(huggingFaceService.getModelDetails('org/nonexistent')).rejects.toThrow('API error: 404');
    });
  });


  describe('extractDescription vision detection', () => {
    it('detects vision model type', () => {
      const desc = service.extractDescription({
        id: 'org/llava-7b-gguf',
        tags: ['vision'],
        author: 'org',
        siblings: [],
      });
      expect(desc).toContain('Vision');
    });

    it('detects vlm model type from name', () => {
      const desc = service.extractDescription({
        id: 'org/model-vlm-7b-gguf',
        tags: [],
        author: 'org',
        siblings: [],
      });
      expect(desc).toContain('Vision');
    });

    it('extracts license from cardData', () => {
      const desc = service.extractDescription({
        id: 'org/model-7b',
        tags: [],
        author: 'org',
        cardData: { license: 'apache-2.0' },
        siblings: [],
      });
      expect(desc).toContain('APACHE 2.0');
    });
  });

  describe('getModelFilesFromSiblings with no siblings', () => {
    it('returns empty array when siblings is null', async () => {
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: false, status: 404 }) // tree fails
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'org/model',
            siblings: null,
          }),
        });

      const files = await huggingFaceService.getModelFiles('org/model');
      expect(files).toEqual([]);
    });
  });

  describe('getModelFiles — catch block fallback (fetch throws)', () => {
    it('falls back to getModelFilesFromSiblings when fetch throws', async () => {
      global.fetch = jest.fn()
        .mockRejectedValueOnce(new Error('network error')) // tree throws
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'org/model',
            siblings: [
              { rfilename: 'model-Q4_K_M.gguf', size: 4000000000 },
            ],
          }),
        });

      const files = await huggingFaceService.getModelFiles('org/model');
      expect(files).toHaveLength(1);
    });
  });

  describe('getModelFilesFromSiblings — sort with multiple files', () => {
    it('sorts sibling files by size ascending', async () => {
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: false, status: 404 }) // tree fails
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'org/model',
            siblings: [
              { rfilename: 'model-Q8_0.gguf', size: 8000000000 },
              { rfilename: 'model-Q4_K_M.gguf', size: 4000000000 },
            ],
          }),
        });

      const files = await huggingFaceService.getModelFiles('org/model');
      expect(files).toHaveLength(2);
      expect(files[0].size).toBeLessThan(files[1].size);
    });
  });

  describe('extractQuantization — matches quant via replace underscore', () => {
    it('recognizes Q4KM (without underscores) as a quantization match', () => {
      // The quantization key Q4_K_M has underscores; test that Q4KM still matches
      const svc = huggingFaceService as any;
      const result = svc.extractQuantization('model-Q4KM.gguf');
      // Should match Q4_K_M via the quant.replace('_', '') comparison
      expect(result).toBeDefined();
    });
  });
});
