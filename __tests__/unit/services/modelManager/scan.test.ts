/**
 * Unit tests for modelManager/scan.ts
 * Covers extractBaseName and findMatchingMmProj — the two pure functions
 * used by linkOrphanMmProj to detect and clear bad mmproj links.
 */

jest.mock('react-native-fs', () => ({
  exists: jest.fn(),
  readDir: jest.fn(() => Promise.resolve([])),
  unlink: jest.fn(),
  stat: jest.fn(),
}));
jest.mock('../../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../../../src/stores', () => ({
  useAppStore: {
    getState: jest.fn(() => ({
      downloadedModels: [],
      setDownloadedModels: jest.fn(),
    })),
  },
}));

import { extractBaseName } from '../../../../src/services/modelManager/scan';
import {
  getCuratedLiteRTEntry,
  buildCuratedLiteRTFiles,
  CURATED_LITERT_ENTRIES,
} from '../../../../src/services/curatedLiteRTRegistry';

// ---------------------------------------------------------------------------
// curatedLiteRTRegistry
// ---------------------------------------------------------------------------

describe('getCuratedLiteRTEntry', () => {
  it('returns the entry for a known curated filename', () => {
    const entry = getCuratedLiteRTEntry(CURATED_LITERT_ENTRIES[0].fileName);
    expect(entry).toBeDefined();
    expect(entry?.fileName).toBe(CURATED_LITERT_ENTRIES[0].fileName);
  });

  it('returns undefined for an unknown filename', () => {
    expect(getCuratedLiteRTEntry('unknown-model.litertlm')).toBeUndefined();
  });

  it('returns undefined when fileName is undefined', () => {
    expect(getCuratedLiteRTEntry(undefined)).toBeUndefined();
  });

  it('the public curated file projection contains a valid HuggingFace URL', () => {
    const entry = CURATED_LITERT_ENTRIES[0];
    const url = buildCuratedLiteRTFiles()[0].downloadUrl;
    expect(url).toContain(entry.hfRepoId);
    expect(url).toContain(entry.commitHash);
    expect(url).toContain(entry.fileName);
  });
});

// ---------------------------------------------------------------------------
// extractBaseName
// ---------------------------------------------------------------------------

describe('extractBaseName', () => {
  it('strips quantization suffix Q4_K_M', () => {
    expect(extractBaseName('gemma-4-E2B-it-Q4_K_M.gguf')).toBe(
      'gemma-4-e2b-it',
    );
  });

  it('strips quantization suffix Q8_0', () => {
    expect(extractBaseName('SmolLM2-360M-Instruct-Q8_0.gguf')).toBe(
      'smollm2-360m-instruct',
    );
  });

  it('strips quantization suffix F16 (uppercase F)', () => {
    expect(extractBaseName('llava-v1.5-7b-F16.gguf')).toBe('llava-v1.5-7b');
  });

  it('strips quantization suffix with underscore separator', () => {
    expect(extractBaseName('model_Q4_K_M.gguf')).toBe('model');
  });

  it('falls back to lowercased filename minus .gguf when no quant pattern', () => {
    expect(extractBaseName('my-model.gguf')).toBe('my-model');
  });

  it('falls back to full filename lowercase when no .gguf and no quant', () => {
    expect(extractBaseName('mymodel')).toBe('mymodel');
  });

  it('is case-insensitive for q prefix (lowercase q)', () => {
    expect(extractBaseName('Qwen3-0.6B-q4_k_m.gguf')).toBe('qwen3-0.6b');
  });
});

// findMatchingMmProj (the loose substring matcher) was removed — model↔projector matching is now the
// single strict rule in src/services/mmproj.ts, covered by __tests__/integration/models/mmProjMatchesModel.test.ts.
