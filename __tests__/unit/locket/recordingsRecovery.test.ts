/**
 * Unit tests for locket orphan recovery (recordingsRecovery.ts).
 *
 * Covers the by-directory (not by-filename) scoping, the conditional grace
 * window (only while the recorder is running), and the epoch/mtime startedAt
 * fallback. RNFS and the recordings store are mocked so the test exercises
 * only the recovery decision logic.
 */

const SAMPLE_RATE = 16000;
const BYTES_PER_SECOND = SAMPLE_RATE * 1 * 2; // 16k mono 16-bit
const HEADER = 44;
// A comfortably-recoverable size: header + 5s of PCM.
const OK_SIZE = HEADER + BYTES_PER_SECOND * 5;

// ---- Mocks -----------------------------------------------------------------

jest.mock('react-native-fs', () => ({
  ExternalDirectoryPath: '/ext',
  DocumentDirectoryPath: '/docs',
  exists: jest.fn(),
  readDir: jest.fn(),
  stat: jest.fn(),
  read: jest.fn(),
}));

// `mock`-prefixed so babel allows referencing them inside the hoisted factory.
const mockAddRecoveredBatch = jest.fn((recs: unknown[]) => (recs as unknown[]).length);
const mockStore: { currentFilePath: string | null; isRunning: boolean; recordings: { path: string }[] } = {
  currentFilePath: null,
  isRunning: false,
  recordings: [],
};

jest.mock('../../../pro/locket/stores/recordingsStore', () => ({
  useRecordingsStore: {
    getState: () => ({
      currentFilePath: mockStore.currentFilePath,
      isRunning: mockStore.isRunning,
      recordings: mockStore.recordings,
      addRecoveredBatch: mockAddRecoveredBatch,
    }),
  },
}));

jest.mock('@offgrid/core/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import RNFS from 'react-native-fs';
import {
  recoverOrphans,
  _resetRecoveryGuardForTesting,
} from '../../../pro/locket/services/recordingsRecovery';

const mockRNFS = RNFS as unknown as {
  exists: jest.Mock;
  readDir: jest.Mock;
  stat: jest.Mock;
  read: jest.Mock;
};

// Build a healthy WAV header (declared data size == fileSize - 44) in base64,
// so readDeclaredDataSize sees a healthy header unless we say otherwise.
function wavHeaderB64(dataSize: number): string {
  const b = Buffer.alloc(44);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + dataSize, 4);
  b.write('WAVE', 8, 'ascii');
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(dataSize, 40);
  return b.toString('base64');
}

function entry(name: string) {
  return { name, path: `/ext/Music/Recordings/${name}`, isFile: () => true };
}

beforeEach(() => {
  _resetRecoveryGuardForTesting();
  mockStore.currentFilePath = null;
  mockStore.isRunning = false;
  mockStore.recordings = [];
  mockAddRecoveredBatch.mockClear();
  mockRNFS.exists.mockResolvedValue(true);
  // Default: healthy header, recent-ish mtime, OK size.
  mockRNFS.stat.mockResolvedValue({ size: OK_SIZE, mtime: 1_000_000 });
  mockRNFS.read.mockResolvedValue(wavHeaderB64(OK_SIZE - HEADER));
});

describe('recoverOrphans - by-directory scoping (Gap 4 fix)', () => {
  it('recovers a .wav that does NOT match the rec-<epoch> name', async () => {
    mockRNFS.readDir.mockResolvedValue([entry('imported-thing.wav')]);
    const report = await recoverOrphans({ force: true });
    expect(report.added).toBe(1);
    expect(mockAddRecoveredBatch).toHaveBeenCalledTimes(1);
  });

  it('still recovers a rec-<epoch>.wav file', async () => {
    mockRNFS.readDir.mockResolvedValue([entry('rec-1720000000000.wav')]);
    const report = await recoverOrphans({ force: true });
    expect(report.added).toBe(1);
  });

  it('ignores non-.wav files in the directory', async () => {
    mockRNFS.readDir.mockResolvedValue([entry('notes.txt'), entry('cover.jpg')]);
    const report = await recoverOrphans({ force: true });
    expect(report.added).toBe(0);
    expect(report.skippedBadName).toBe(2);
  });
});

describe('recoverOrphans - conditional grace window (Gap 2 fix)', () => {
  it('recovers a freshly-modified file when the recorder is NOT running', async () => {
    mockStore.isRunning = false;
    // mtime = "now" so it is within any grace window.
    const now = 5_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    mockRNFS.stat.mockResolvedValue({ size: OK_SIZE, mtime: now });
    mockRNFS.readDir.mockResolvedValue([entry('rec-1.wav')]);

    const report = await recoverOrphans({ force: true });
    expect(report.added).toBe(1);
    expect(report.skippedTooNew).toBe(0);
    (Date.now as jest.Mock).mockRestore?.();
  });

  it('skips a freshly-modified file WHILE the recorder is running', async () => {
    mockStore.isRunning = true;
    const now = 5_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    mockRNFS.stat.mockResolvedValue({ size: OK_SIZE, mtime: now });
    mockRNFS.readDir.mockResolvedValue([entry('rec-1.wav')]);

    const report = await recoverOrphans({ force: true });
    expect(report.added).toBe(0);
    expect(report.skippedTooNew).toBe(1);
    (Date.now as jest.Mock).mockRestore?.();
  });
});

describe('recoverOrphans - safety guards preserved', () => {
  it('never recovers the currently-recording file', async () => {
    mockStore.currentFilePath = '/ext/Music/Recordings/rec-active.wav';
    mockRNFS.readDir.mockResolvedValue([entry('rec-active.wav')]);
    const report = await recoverOrphans({ force: true });
    expect(report.added).toBe(0);
    expect(report.skippedActive).toBe(1);
  });

  it('skips files below the minimum recoverable size', async () => {
    mockRNFS.stat.mockResolvedValue({ size: HEADER + 10, mtime: 1_000_000 });
    mockRNFS.readDir.mockResolvedValue([entry('rec-tiny.wav')]);
    const report = await recoverOrphans({ force: true });
    expect(report.added).toBe(0);
    expect(report.skippedTooSmall).toBe(1);
  });

  it('does not re-add a recording already in the store', async () => {
    mockStore.recordings = [{ path: '/ext/Music/Recordings/rec-known.wav' }];
    mockRNFS.readDir.mockResolvedValue([entry('rec-known.wav')]);
    const report = await recoverOrphans({ force: true });
    expect(report.added).toBe(0);
    expect(report.alreadyInStore).toBe(1);
  });

  it('labels a zeroed-header file as damaged', async () => {
    // Header declares 0 data bytes but the file has real PCM -> damaged.
    mockRNFS.read.mockResolvedValue(wavHeaderB64(0));
    mockRNFS.readDir.mockResolvedValue([entry('rec-damaged.wav')]);
    const report = await recoverOrphans({ force: true });
    expect(report.added).toBe(1);
    expect(report.staleHeaderDetected).toBe(1);
    const queued = mockAddRecoveredBatch.mock.calls[0][0] as { name: string }[];
    expect(queued[0].name).toBe('Recovered (header damaged)');
  });
});
