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
  useAppStore: { getState: jest.fn(() => ({ downloadedModels: [], setDownloadedModels: jest.fn() })) },
}));

import { extractBaseName, findMatchingMmProj } from '../../../../src/services/modelManager/scan';
import { getCuratedLiteRTEntry, buildCuratedLiteRTUrl, CURATED_LITERT_ENTRIES } from '../../../../src/services/curatedLiteRTRegistry';
import type RNFS from 'react-native-fs';

function makeFile(name: string): RNFS.ReadDirResItemT {
  return { name, path: `/models/${name}`, isFile: () => true, size: 1000, isDirectory: () => false, ctime: new Date(), mtime: new Date() };
}

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

  it('buildCuratedLiteRTUrl produces a valid HuggingFace URL', () => {
    const entry = CURATED_LITERT_ENTRIES[0];
    const url = buildCuratedLiteRTUrl(entry);
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
    expect(extractBaseName('gemma-4-E2B-it-Q4_K_M.gguf')).toBe('gemma-4-e2b-it');
  });

  it('strips quantization suffix Q8_0', () => {
    expect(extractBaseName('SmolLM2-360M-Instruct-Q8_0.gguf')).toBe('smollm2-360m-instruct');
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

// ---------------------------------------------------------------------------
// findMatchingMmProj
// ---------------------------------------------------------------------------

describe('findMatchingMmProj', () => {
  it('returns undefined for empty file list', () => {
    expect(findMatchingMmProj('gemma-4-e2b-it', [])).toBeUndefined();
  });

  it('matches by baseName substring in mmproj filename', () => {
    const files = [makeFile('gemma-4-e2b-it-Q4_K_M-mmproj.gguf')];
    expect(findMatchingMmProj('gemma-4-e2b-it', files)?.name).toBe('gemma-4-e2b-it-Q4_K_M-mmproj.gguf');
  });

  it('matches by noSeparators form (hyphens and underscores stripped)', () => {
    // baseName = "smolvlm2-256m" → noSeparators = "smolvlm2256m"
    const files = [makeFile('mmproj-SmolVLM2-256M-Instruct-bf16.gguf')];
    expect(findMatchingMmProj('smolvlm2-256m', files)?.name).toBe('mmproj-SmolVLM2-256M-Instruct-bf16.gguf');
  });

  it('does NOT match an unrelated mmproj (gemma vs SmolLM2)', () => {
    const files = [makeFile('gemma-4-E2B-it-Q4_K_M-mmproj.gguf')];
    expect(findMatchingMmProj('smollm2-360m-instruct', files)).toBeUndefined();
  });

  it('returns first match when multiple mmproj files are present', () => {
    const files = [
      makeFile('gemma-4-e2b-it-mmproj.gguf'),
      makeFile('gemma-4-e2b-it-v2-mmproj.gguf'),
    ];
    expect(findMatchingMmProj('gemma-4-e2b-it', files)?.name).toBe('gemma-4-e2b-it-mmproj.gguf');
  });

  it('match is case-insensitive', () => {
    const files = [makeFile('Gemma-4-E2B-IT-mmproj.GGUF')];
    expect(findMatchingMmProj('gemma-4-e2b-it', files)?.name).toBe('Gemma-4-E2B-IT-mmproj.GGUF');
  });
});
