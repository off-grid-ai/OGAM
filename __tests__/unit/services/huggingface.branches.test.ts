declare const global: any;

/**
 * Branch-coverage tests for huggingface.ts.
 * Targets searchWhisperRepos / getWhisperFiles (success + catch fallbacks),
 * the extractQuantization underscore-stripped match branch (line 121),
 * and transformFileInfo's lfs.size fallbacks.
 */

import { huggingFaceService } from '../../../src/services/huggingface';

const service = huggingFaceService as any;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('extractQuantization underscore-stripped match branch', () => {
  it('matches a known quant when its single underscore is stripped from the filename', () => {
    // quant.replace('_','') strips the FIRST underscore only: Q8_0 -> "Q80".
    // A filename containing "Q80" must hit the underscore-stripped branch (line 119-121).
    expect(service.extractQuantization('modelQ80.gguf')).toBe('Q8_0');
  });

  it('falls through to the regex extractor for an unlisted Q pattern', () => {
    // No QUANTIZATION_INFO key matches -> regex /[QqFf]\d+.../ kicks in.
    const result = service.extractQuantization('model-Q9_xyz.gguf');
    expect(result.startsWith('Q9')).toBe(true);
  });
});

describe('transformFileInfo size fallbacks', () => {
  it('uses lfs.size and carries sha256 through', () => {
    const out = service.transformFileInfo('org/model', {
      rfilename: 'm-Q4_K_M.gguf', size: 1, lfs: { size: 999, sha256: 'abc' },
    });
    expect(out.size).toBe(999);
    expect(out.sha256).toBe('abc');
  });

  it('falls back to plain size, then to 0 when both missing', () => {
    expect(service.transformFileInfo('org/model', { rfilename: 'm.gguf', size: 50 }).size).toBe(50);
    expect(service.transformFileInfo('org/model', { rfilename: 'm.gguf' }).size).toBe(0);
  });
});

describe('searchWhisperRepos', () => {
  it('maps results, defaulting query, author, downloads', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { id: 'ggerganov/whisper.cpp', author: 'ggerganov', downloads: 42, lastModified: '2024' },
        { id: 'someone/whisper-tiny' }, // no author/downloads -> fallbacks
      ]),
    });

    const out = await huggingFaceService.searchWhisperRepos('');

    const url = (global.fetch as jest.Mock).mock.calls[0][0];
    expect(url).toContain('search=whisper'); // empty query defaults to 'whisper'
    expect(url).toContain('pipeline_tag=automatic-speech-recognition');
    expect(out[0]).toEqual({ id: 'ggerganov/whisper.cpp', author: 'ggerganov', downloads: 42, lastModified: '2024' });
    // author derived from id split, downloads defaults to 0
    expect(out[1]).toEqual({ id: 'someone/whisper-tiny', author: 'someone', downloads: 0, lastModified: undefined });
  });

  it('passes the provided query and custom limit through', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    await huggingFaceService.searchWhisperRepos('large-v3', 5);
    const url = (global.fetch as jest.Mock).mock.calls[0][0];
    expect(url).toContain('search=large-v3');
    expect(url).toContain('limit=5');
  });

  it('returns [] when the request fails (catch branch)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network'));
    expect(await huggingFaceService.searchWhisperRepos('x')).toEqual([]);
  });

  it('returns [] when the response is not ok (fetchJson throws)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    expect(await huggingFaceService.searchWhisperRepos('x')).toEqual([]);
  });
});

describe('getWhisperFiles', () => {
  it('filters to ggml .bin files, derives name, computes sizeMb, and sorts ascending', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { type: 'file', path: 'ggml-base.bin', lfs: { size: 100 * 1024 * 1024 } },
        { type: 'file', path: 'sub/ggml-tiny.bin', size: 10 * 1024 * 1024 },
        { type: 'file', path: 'config.json', size: 5 },           // not .bin
        { type: 'file', path: 'model.bin', size: 1 },             // .bin but not ggml
        { type: 'dir', path: 'ggml-dir.bin' },                    // not a file
      ]),
    });

    const out = await huggingFaceService.getWhisperFiles('org/whisper');

    expect(out).toHaveLength(2);
    // sorted by sizeMb ascending -> tiny (10MB) first
    expect(out[0].name).toBe('ggml-tiny.bin');
    expect(out[0].sizeMb).toBe(10);
    expect(out[1].name).toBe('ggml-base.bin');
    expect(out[1].sizeMb).toBe(100);
    expect(out[1].downloadUrl).toContain('org/whisper/resolve/main/ggml-base.bin');
  });

  it('handles a file with neither lfs.size nor size (sizeMb 0)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ type: 'file', path: 'ggml-x.bin' }]),
    });
    const out = await huggingFaceService.getWhisperFiles('org/whisper');
    expect(out[0].sizeMb).toBe(0);
  });

  it('returns [] when fetch throws (catch branch)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('down'));
    expect(await huggingFaceService.getWhisperFiles('org/whisper')).toEqual([]);
  });
});

describe('getModelDetails delegates to transformModelResult', () => {
  it('uses id split fallback for name when no slash present', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'soloname', downloads: 0, likes: 0, tags: [], siblings: [] }),
    });
    const result = await huggingFaceService.getModelDetails('soloname');
    expect(result.name).toBe('soloname');
    expect(result.author).toBe('soloname'); // id.split('/')[0]
  });
});
