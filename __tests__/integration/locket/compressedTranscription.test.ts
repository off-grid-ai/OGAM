/**
 * Integration test: compressed (.m4a) recordings transcribe correctly.
 *
 * The real bug class this guards: transcription slices audio with
 * extractWavSlice, which RIFF-parses a WAV header. A compressed .m4a has no such
 * header, so without the decode step it would slice garbage. This test wires the
 * REAL transcribeChunked + the REAL resolveToWav (recordingCompression) together,
 * mocking only the native/whisper leaves, and asserts:
 *   - an .m4a source is decoded ONCE (normalizeToWav16kMono) before slicing,
 *   - extractWavSlice is called on the DECODED wav, never on the .m4a,
 *   - the decoded temp file is cleaned up afterwards,
 *   - a plain .wav source is NEVER decoded (the no-op fast path).
 */

const mockExtractWavSlice = jest.fn();
const mockNormalize = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: {
    AudioNormalizer: {
      extractWavSlice: (s: string, a: number, d: number) => mockExtractWavSlice(s, a, d),
      normalizeToWav16kMono: (i: string, o: string) => mockNormalize(i, o),
    },
  },
}));

const mockUnlink = jest.fn().mockResolvedValue(undefined);
jest.mock('react-native-fs', () => ({
  exists: jest.fn().mockResolvedValue(true),
  unlink: (p: string) => mockUnlink(p),
}));

jest.mock('@offgrid/core/services/whisperService', () => ({
  whisperService: {
    transcribeFile: jest.fn().mockResolvedValue('hello world'),
  },
}));

jest.mock('@offgrid/core/utils/memorySnapshot', () => ({ logMemory: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@offgrid/core/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../../pro/locket/services/transcriptionForeground', () => ({
  transcriptionForeground: { start: jest.fn().mockResolvedValue(undefined), stop: jest.fn().mockResolvedValue(undefined) },
}));

// Minimal in-memory store: transcribeChunked reads checkpoint/segments and writes back.
const state: Record<string, unknown> = {};
jest.mock('../../../pro/locket/stores', () => ({
  useRecordingsStore: {
    getState: () => ({
      recordings: [{ id: 'rec-1', ...state }],
      updateRecording: (_id: string, patch: Record<string, unknown>) => Object.assign(state, patch),
    }),
  },
}));
// recordingCompression imports the store from '../stores/recordingsStore' - mock that path too.
jest.mock('../../../pro/locket/stores/recordingsStore', () => ({
  useRecordingsStore: { getState: () => ({ updateRecording: jest.fn() }) },
}));

import { transcribeChunked } from '../../../pro/locket/services/transcribeChunked';

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(state)) delete state[k];
  mockExtractWavSlice.mockImplementation((_s, _a, _d) => Promise.resolve('/tmp/slice.wav'));
  mockNormalize.mockResolvedValue('/docs/.decode-rec-100.wav');
});

it('decodes a compressed .m4a once, then slices the DECODED wav (never the m4a)', async () => {
  await transcribeChunked({ id: 'rec-1', path: '/docs/rec-100.m4a', durationMs: 60_000 });

  // decoded exactly once, from the .m4a
  expect(mockNormalize).toHaveBeenCalledTimes(1);
  expect(mockNormalize).toHaveBeenCalledWith('/docs/rec-100.m4a', expect.stringMatching(/\.decode-rec-100\.wav$/));
  const decodedWav = mockNormalize.mock.calls[0][1];

  // every slice targets the DECODED wav, and NEVER the .m4a
  expect(mockExtractWavSlice).toHaveBeenCalled();
  for (const call of mockExtractWavSlice.mock.calls) {
    expect(call[0]).toBe(decodedWav);
  }
  expect(mockExtractWavSlice).not.toHaveBeenCalledWith('/docs/rec-100.m4a', expect.anything(), expect.anything());

  // temp decoded wav cleaned up
  expect(mockUnlink).toHaveBeenCalledWith(decodedWav);
});

it('never decodes a plain .wav source (no-op fast path)', async () => {
  await transcribeChunked({ id: 'rec-1', path: '/docs/rec-100.wav', durationMs: 60_000 });

  expect(mockNormalize).not.toHaveBeenCalled();
  // slices go straight against the original wav
  for (const call of mockExtractWavSlice.mock.calls) {
    expect(call[0]).toBe('/docs/rec-100.wav');
  }
});
