/**
 * imageModelIntegrity IO wrappers — resolveImageModelDir / validateImageModelDir /
 * ensureImageExtractionComplete. The pure rule is covered in imageModelIntegrity.test;
 * this drives the RNFS + unzip boundaries (mocked) to cover dir resolution, the coreml
 * short-circuit, unreadable dirs, and the re-unzip-once-then-throw gate.
 */
const existing = new Set<string>();
const dirListings: Record<string, Array<{ name: string; size: number; isFile: boolean }>> = {};

const mockExists = jest.fn(async (p: string) => existing.has(p));
const mockReadDir = jest.fn(async (p: string) => {
  if (!(p in dirListings)) throw new Error(`ENOENT ${p}`);
  return dirListings[p].map(e => ({
    name: e.name,
    size: e.size,
    path: `${p}/${e.name}`,
    isFile: () => e.isFile,
    isDirectory: () => !e.isFile,
  }));
});
jest.mock('react-native-fs', () => ({ exists: (p: string) => mockExists(p), readDir: (p: string) => mockReadDir(p) }));

const mockUnzip = jest.fn(async (_source?: string, _target?: string) => '/done');
jest.mock('react-native-zip-archive', () => ({ unzip: (source: string, target: string) => mockUnzip(source, target) }));

jest.mock('../../../src/utils/logger', () => ({ __esModule: true, default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import {
  resolveImageModelDir, validateImageModelDir, ensureImageExtractionComplete,
} from '../../../src/utils/imageModelIntegrity';
import { ImageModelIncompleteError } from '../../../src/services/modelLoadErrors';

const COMPLETE_MNN = [
  { name: 'unet.mnn', size: 1, isFile: true }, { name: 'unet.mnn.weight', size: 1, isFile: true },
  { name: 'clip_v2.mnn', size: 1, isFile: true }, { name: 'clip_v2.mnn.weight', size: 1, isFile: true },
  { name: 'vae_decoder.mnn', size: 1, isFile: true }, { name: 'vae_decoder.mnn.weight', size: 1, isFile: true },
  { name: 'pos_emb.bin', size: 1, isFile: true }, { name: 'token_emb.bin', size: 1, isFile: true },
  { name: 'tokenizer.json', size: 1, isFile: true },
];

beforeEach(() => {
  jest.clearAllMocks();
  existing.clear();
  for (const k of Object.keys(dirListings)) delete dirListings[k];
  mockUnzip.mockResolvedValue('/done');
});

describe('resolveImageModelDir', () => {
  it('returns modelPath itself when the unet marker is directly inside', async () => {
    existing.add('/m/unet.mnn');
    expect(await resolveImageModelDir('/m', 'mnn')).toBe('/m');
  });

  it('finds the marker one subdir down (e.g. AbsoluteReality/)', async () => {
    existing.add('/m/AbsoluteReality/unet.mnn');
    dirListings['/m'] = [{ name: 'AbsoluteReality', size: 0, isFile: false }];
    expect(await resolveImageModelDir('/m', 'mnn')).toBe('/m/AbsoluteReality');
  });

  it('finds the marker two subdirs down (qnn output_512/qnn_models_min)', async () => {
    existing.add('/m/output_512/qnn_models_min/unet.bin');
    dirListings['/m'] = [{ name: 'output_512', size: 0, isFile: false }];
    dirListings['/m/output_512'] = [{ name: 'qnn_models_min', size: 0, isFile: false }];
    expect(await resolveImageModelDir('/m', 'qnn')).toBe('/m/output_512/qnn_models_min');
  });

  it('returns null when no marker is found and skips unreadable subdirs', async () => {
    dirListings['/m'] = [{ name: 'empty', size: 0, isFile: false }]; // /m/empty is unreadable (no listing)
    expect(await resolveImageModelDir('/m', 'mnn')).toBeNull();
  });

  it('skips top-level files and non-marker sub-files while descending two levels', async () => {
    existing.add('/m/sub/deep/unet.mnn');
    dirListings['/m'] = [
      { name: 'readme.txt', size: 5, isFile: true },   // top-level FILE → item.isDirectory() false
      { name: 'sub', size: 0, isFile: false },
    ];
    dirListings['/m/sub'] = [
      { name: 'note.bin', size: 5, isFile: true },      // sub FILE → s.isDirectory() false
      { name: 'deep', size: 0, isFile: false },
    ];
    expect(await resolveImageModelDir('/m', 'mnn')).toBe('/m/sub/deep');
  });

  it('returns null when modelPath itself is unreadable', async () => {
    expect(await resolveImageModelDir('/nope', 'mnn')).toBeNull();
  });

  it('treats an exists() failure as no-marker (hasMarker swallows the error)', async () => {
    mockExists.mockRejectedValueOnce(new Error('io error')); // the top-level marker probe throws
    expect(await resolveImageModelDir('/m', 'mnn')).toBeNull(); // then /m is unreadable → null
  });
});

describe('validateImageModelDir', () => {
  it('coreml short-circuits to complete', async () => {
    expect(await validateImageModelDir('/m', 'coreml')).toEqual({ complete: true, missing: [] });
  });

  it('reports the unet as missing when no model dir resolves', async () => {
    const res = await validateImageModelDir('/m', 'mnn');
    expect(res.complete).toBe(false);
    expect(res.missing).toContain('unet.mnn');
  });

  it('names unet.bin (not unet.mnn) when a qnn model dir does not resolve', async () => {
    const res = await validateImageModelDir('/m', 'qnn');
    expect(res.missing).toContain('unet.bin');
  });

  it('treats a zero/NaN file size as 0 (missing) when mapping the listing', async () => {
    existing.add('/m/unet.mnn');
    // token_emb.bin present but zero-byte → Number(size)||0 = 0 → counted missing.
    dirListings['/m'] = COMPLETE_MNN.map(f => (f.name === 'token_emb.bin' ? { ...f, size: 0 } : f));
    const res = await validateImageModelDir('/m', 'mnn');
    expect(res.complete).toBe(false);
    expect(res.missing).toContain('token_emb.bin');
  });

  it('passes a complete extraction', async () => {
    existing.add('/m/unet.mnn');
    dirListings['/m'] = COMPLETE_MNN;
    expect(await validateImageModelDir('/m', 'mnn')).toEqual({ complete: true, missing: [] });
  });

  it('flags the missing files of a partial extraction', async () => {
    existing.add('/m/unet.mnn');
    dirListings['/m'] = COMPLETE_MNN.filter(f => f.name !== 'pos_emb.bin' && f.name !== 'clip_v2.mnn.weight');
    const res = await validateImageModelDir('/m', 'mnn');
    expect(res.complete).toBe(false);
    expect(res.missing).toEqual(expect.arrayContaining(['pos_emb.bin', 'clip_v2.mnn.weight']));
  });

  it('reports unreadable when the resolved dir cannot be listed', async () => {
    existing.add('/m/unet.mnn');
    // marker exists so it resolves to /m, but /m has no listing → readDir throws.
    const res = await validateImageModelDir('/m', 'mnn');
    expect(res.complete).toBe(false);
    expect(res.missing).toContain('<unreadable model dir>');
  });
});

describe('ensureImageExtractionComplete', () => {
  const opts = (backend?: string) => ({ backend: backend as any, modelDir: '/m', zipPath: '/m.zip', modelId: 'id' });

  it('is a no-op for coreml / unknown backends', async () => {
    await expect(ensureImageExtractionComplete(opts('coreml'))).resolves.toBeUndefined();
    await expect(ensureImageExtractionComplete(opts(undefined))).resolves.toBeUndefined();
    expect(mockUnzip).not.toHaveBeenCalled();
  });

  it('passes without re-unzip when already complete', async () => {
    existing.add('/m/unet.mnn');
    dirListings['/m'] = COMPLETE_MNN;
    await expect(ensureImageExtractionComplete(opts('mnn'))).resolves.toBeUndefined();
    expect(mockUnzip).not.toHaveBeenCalled();
  });

  it('re-unzips ONCE and passes when the retry completes the model', async () => {
    existing.add('/m/unet.mnn');
    dirListings['/m'] = COMPLETE_MNN.filter(f => f.name !== 'pos_emb.bin'); // incomplete first
    mockUnzip.mockImplementation(async () => { dirListings['/m'] = COMPLETE_MNN; return '/done'; }); // repaired on re-unzip
    await expect(ensureImageExtractionComplete(opts('mnn'))).resolves.toBeUndefined();
    expect(mockUnzip).toHaveBeenCalledTimes(1);
  });

  it('throws ImageModelIncompleteError when still incomplete after the re-unzip', async () => {
    existing.add('/m/unet.mnn');
    dirListings['/m'] = COMPLETE_MNN.filter(f => f.name !== 'pos_emb.bin');
    // re-unzip is a no-op (still missing pos_emb.bin)
    await expect(ensureImageExtractionComplete(opts('mnn'))).rejects.toBeInstanceOf(ImageModelIncompleteError);
    expect(mockUnzip).toHaveBeenCalledTimes(1);
  });
});
