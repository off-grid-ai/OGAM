/**
 * imageModelIntegrity for stable-diffusion.cpp packs and multi-file downloads. Files live in an
 * in-memory disk behind the react-native-fs boundary; the SD pack rules, checkpoint header check
 * and completeness rules run for real.
 */
import { createHash } from 'crypto';

const mockFiles = new Map<string, Buffer>();

function mockList(dir: string) {
  const children = new Map<string, { size: number; isFile: boolean }>();
  for (const [path, bytes] of mockFiles) {
    if (!path.startsWith(`${dir}/`)) continue;
    const [name, ...rest] = path.slice(dir.length + 1).split('/');
    children.set(name, rest.length ? { size: 0, isFile: false } : { size: bytes.length, isFile: true });
  }
  if (children.size === 0) throw new Error(`ENOENT ${dir}`);
  return [...children].map(([name, entry]) => ({
    name,
    size: entry.size,
    path: `${dir}/${name}`,
    isFile: () => entry.isFile,
    isDirectory: () => !entry.isFile,
  }));
}

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/docs',
  exists: async (path: string) => mockFiles.has(path),
  readDir: async (dir: string) => mockList(dir),
  stat: async (path: string) => ({ size: mockFiles.get(path)?.length ?? 0 }),
  read: async (path: string, length: number, position: number) =>
    mockFiles.get(path)!.subarray(position, position + length).toString('base64'),
  hash: async (path: string) =>
    require('crypto').createHash('sha256').update(mockFiles.get(path)!).digest('hex'),
}));

jest.mock('react-native-zip-archive', () => ({ unzip: jest.fn() }));

import {
  checkImageModelFiles,
  resolveImageModelDir,
  validateImageModelDir,
  validateMultifileComplete,
} from '../../../src/services/imageModelIntegrity';

/** A safetensors file whose header names the given tensors. */
function safetensors(tensors: string[]): Buffer {
  const header = Buffer.from(JSON.stringify(Object.fromEntries(tensors.map(name => [name, {}]))));
  const length = Buffer.alloc(8);
  length.writeUInt32LE(header.length, 0);
  return Buffer.concat([length, header, Buffer.alloc(16)]);
}

const FULL_CHECKPOINT = safetensors([
  'model.diffusion_model.input_blocks.0.0.weight',
  'first_stage_model.decoder.conv_in.weight',
  'cond_stage_model.transformer.text_model.embeddings.token_embedding.weight',
]);
const UNET_ONLY = safetensors(['model.diffusion_model.input_blocks.0.0.weight']);

beforeEach(() => mockFiles.clear());

describe('checkImageModelFiles for SD packs', () => {
  it('needs exactly one diffusion weight to recognise a pack', () => {
    expect(checkImageModelFiles([{ name: 'notes.txt', size: 5, isFile: true }], 'sd')).toEqual({
      complete: false,
      missing: ['image model pack'],
    });
  });

  it('accepts a non-empty single checkpoint and names an empty one', () => {
    expect(checkImageModelFiles([{ name: 'dreamshaper_8.safetensors', size: 10, isFile: true }], 'sd')).toEqual({
      complete: true,
      missing: [],
    });
    expect(checkImageModelFiles([{ name: 'dreamshaper_8.safetensors', size: 0, isFile: true }], 'sd')).toEqual({
      complete: false,
      missing: ['dreamshaper_8.safetensors'],
    });
  });

  it('lists the Qwen-Image companions that are not on disk', () => {
    const result = checkImageModelFiles([{ name: 'qwen_image_2.1-Q4_K_M.gguf', size: 10, isFile: true }], 'sd');
    expect(result.complete).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
    expect(result.missing).not.toContain('qwen_image_2.1-Q4_K_M.gguf');
  });
});

describe('SD pack directories on disk', () => {
  it('finds the pack directly or one folder down', async () => {
    mockFiles.set('/m/dreamshaper_8.safetensors', FULL_CHECKPOINT);
    expect(await resolveImageModelDir('/m', 'sd')).toBe('/m');
    mockFiles.clear();
    mockFiles.set('/m/pack/dreamshaper_8.safetensors', FULL_CHECKPOINT);
    expect(await resolveImageModelDir('/m', 'sd')).toBe('/m/pack');
  });

  it('reports a missing pack when no weight is present', async () => {
    mockFiles.set('/m/readme.txt', Buffer.from('x'));
    expect(await validateImageModelDir('/m', 'sd')).toEqual({ complete: false, missing: ['image model pack'] });
  });

  it('accepts a complete checkpoint and rejects a UNet-only export', async () => {
    mockFiles.set('/m/dreamshaper_8.safetensors', FULL_CHECKPOINT);
    expect(await validateImageModelDir('/m', 'sd')).toEqual({ complete: true, missing: [] });
    mockFiles.set('/m/dreamshaper_8.safetensors', UNET_ONLY);
    expect(await validateImageModelDir('/m', 'sd')).toEqual({
      complete: false,
      missing: ['complete SD checkpoint with image model, text encoder, and VAE'],
    });
  });
});

describe('validateMultifileComplete', () => {
  const part = Buffer.from('model bytes');
  const sha256 = createHash('sha256').update(part).digest('hex');

  it('refuses a download with no file list', async () => {
    await expect(validateMultifileComplete('/m', [])).rejects.toThrow('Download file list missing');
  });

  it('accepts parts that are present, the expected size, and hash-matched in any case', async () => {
    mockFiles.set('/m/unet.mnn', part);
    await expect(
      validateMultifileComplete('/m', [{ relativePath: 'unet.mnn', expectedSize: part.length, sha256: sha256.toUpperCase() }]),
    ).resolves.toBeUndefined();
  });

  it('names a missing, short, or damaged part', async () => {
    await expect(validateMultifileComplete('/m', [{ relativePath: 'unet.mnn' }])).rejects.toThrow(
      'Downloaded file missing or empty: unet.mnn',
    );
    mockFiles.set('/m/unet.mnn', part);
    await expect(
      validateMultifileComplete('/m', [{ relativePath: 'unet.mnn', expectedSize: part.length + 1 }]),
    ).rejects.toThrow('Downloaded file is incomplete: unet.mnn');
    await expect(
      validateMultifileComplete('/m', [{ relativePath: 'unet.mnn', sha256: '0'.repeat(64) }]),
    ).rejects.toThrow('Downloaded file is damaged: unet.mnn');
  });
});
