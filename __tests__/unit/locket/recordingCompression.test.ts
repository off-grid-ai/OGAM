/**
 * Unit tests for manual recording compression (recordingCompression.ts).
 *
 * Covers the safety contract: encode -> verify -> only THEN drop the raw; a
 * failed/empty/too-large encode leaves the original untouched; already-compressed
 * is a no-op; and resolveToWav decodes .m4a but passes .wav through untouched.
 * Native AudioNormalizer, RNFS, and the store are mocked so we exercise only the
 * decision logic (no real audio work).
 */

const mockCompressToAac = jest.fn();
const mockNormalize = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: {
    AudioNormalizer: {
      compressToAac: (s: string, o: string) => mockCompressToAac(s, o),
      normalizeToWav16kMono: (i: string, o: string) => mockNormalize(i, o),
    },
  },
}));

const mockRNFS = {
  exists: jest.fn(),
  unlink: jest.fn(),
};
jest.mock('react-native-fs', () => ({
  exists: (p: string) => mockRNFS.exists(p),
  unlink: (p: string) => mockRNFS.unlink(p),
}));

const mockUpdate = jest.fn();
jest.mock('../../../pro/locket/stores/recordingsStore', () => ({
  useRecordingsStore: { getState: () => ({ updateRecording: mockUpdate }) },
}));

jest.mock('@offgrid/core/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  compressRecording,
  isCompressed,
  resolveToWav,
} from '../../../pro/locket/services/recordingCompression';
import type { Recording } from '../../../pro/locket/stores/recordingsStore';

const rec = (over: Partial<Recording> = {}): Recording => ({
  id: 'rec-1',
  path: '/docs/Music/Recordings/rec-100.wav',
  startedAt: 100,
  endedAt: 100000,
  durationMs: 99900,
  sizeBytes: 1_000_000,
  ...over,
} as Recording);

beforeEach(() => {
  jest.clearAllMocks();
  mockRNFS.exists.mockResolvedValue(true);
  mockRNFS.unlink.mockResolvedValue(undefined);
});

describe('isCompressed', () => {
  it('is false for .wav, true for .m4a', () => {
    expect(isCompressed({ path: '/a/rec-1.wav' })).toBe(false);
    expect(isCompressed({ path: '/a/rec-1.m4a' })).toBe(true);
    expect(isCompressed({ path: '/a/rec-1.WAV' })).toBe(false); // case-insensitive
  });
});

describe('compressRecording - happy path', () => {
  it('encodes, verifies, repoints the store, then drops the raw', async () => {
    mockCompressToAac.mockResolvedValue({ path: '/docs/Music/Recordings/rec-100.m4a', sizeBytes: 90_000 });
    const r = rec();
    const res = await compressRecording(r);
    expect(res).toEqual({ ok: true, savedBytes: 910_000, newSizeBytes: 90_000 });
    // store repointed to the .m4a with the new size
    expect(mockUpdate).toHaveBeenCalledWith('rec-1', {
      path: '/docs/Music/Recordings/rec-100.m4a',
      sizeBytes: 90_000,
    });
    // raw dropped (the .wav), AFTER the update
    expect(mockRNFS.unlink).toHaveBeenCalledWith('/docs/Music/Recordings/rec-100.wav');
  });
});

describe('compressRecording - safety guards (raw never lost)', () => {
  it('no-ops when already compressed', async () => {
    const res = await compressRecording(rec({ path: '/docs/rec-100.m4a' }));
    expect(res).toEqual({ ok: false, reason: 'already-compressed' });
    expect(mockCompressToAac).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('keeps the raw when the source file is missing', async () => {
    mockRNFS.exists.mockResolvedValue(false);
    const res = await compressRecording(rec());
    expect(res).toEqual({ ok: false, reason: 'file-missing' });
    expect(mockCompressToAac).not.toHaveBeenCalled();
  });

  it('keeps the raw when the encoder throws', async () => {
    mockCompressToAac.mockRejectedValue(new Error('AVAssetWriter failed'));
    const res = await compressRecording(rec());
    expect(res).toEqual({ ok: false, reason: 'encode-failed' });
    expect(mockUpdate).not.toHaveBeenCalled();
    // never unlinked the raw
    expect(mockRNFS.unlink).not.toHaveBeenCalledWith('/docs/Music/Recordings/rec-100.wav');
  });

  it('keeps the raw when the output verifies as empty', async () => {
    mockCompressToAac.mockResolvedValue({ path: '/docs/Music/Recordings/rec-100.m4a', sizeBytes: 10 });
    const res = await compressRecording(rec());
    expect(res).toEqual({ ok: false, reason: 'verify-failed' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('keeps the raw when the output is not actually smaller', async () => {
    mockCompressToAac.mockResolvedValue({ path: '/docs/Music/Recordings/rec-100.m4a', sizeBytes: 1_200_000 });
    const res = await compressRecording(rec({ sizeBytes: 1_000_000 }));
    expect(res).toEqual({ ok: false, reason: 'not-smaller' });
    expect(mockUpdate).not.toHaveBeenCalled();
    // the bogus larger output is cleaned up
    expect(mockRNFS.unlink).toHaveBeenCalledWith('/docs/Music/Recordings/rec-100.m4a');
  });
});

describe('resolveToWav', () => {
  it('passes a .wav through untouched with a no-op cleanup (no decode)', async () => {
    const { wavPath, cleanup } = await resolveToWav('/docs/rec-1.wav');
    expect(wavPath).toBe('/docs/rec-1.wav');
    expect(mockNormalize).not.toHaveBeenCalled();
    await cleanup();
    expect(mockRNFS.unlink).not.toHaveBeenCalled();
  });

  it('decodes a .m4a to a temp WAV and cleanup removes it', async () => {
    mockNormalize.mockResolvedValue('ok');
    const { wavPath, cleanup } = await resolveToWav('/docs/rec-1.m4a');
    expect(mockNormalize).toHaveBeenCalledWith('/docs/rec-1.m4a', expect.stringMatching(/\.decode-rec-1\.wav$/));
    expect(wavPath).toMatch(/\.decode-rec-1\.wav$/);
    await cleanup();
    expect(mockRNFS.unlink).toHaveBeenCalledWith(wavPath);
  });
});
