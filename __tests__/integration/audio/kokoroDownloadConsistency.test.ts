/**
 * Integration: Kokoro download-state consistency across the Download Manager and
 * the Voice Models tab.
 *
 * Both surfaces read TTS download state from the SAME seam — the real
 * `ttsProvider.list()` (via modelDownloadService), which queries the singleton
 * KokoroEngine. This test drives the REAL KokoroEngine through the REAL ttsProvider
 * and mocks only the native filesystem boundary (BareResourceFetcher), so a green
 * result means the actual chain behaves — not that a mock returned what it was told.
 *
 * Reported bug: mid-download the Download Manager showed Kokoro "downloaded" (82MB)
 * while the Voice tab honestly showed real progress. Root cause: completeness came
 * from pure basename PRESENCE, and executorch creates each destination file before
 * its bytes finish, so the full set is present mid-fetch. The fix makes the LIVE
 * download lifecycle the single source of truth (no disk presence scan), and the
 * provider computes 'downloading' FIRST so an in-flight download is never 'completed'.
 * This pins that a files-present-but-in-flight state can NEVER surface as 'completed'
 * from the provider both views consume — so the two views cannot disagree.
 */
import { BareResourceFetcher } from 'react-native-executorch-bare-resource-fetcher';
import { KokoroEngine } from '../../../pro/audio/engine/tts/engines/kokoro/KokoroEngine';

const listDownloadedFiles = BareResourceFetcher.listDownloadedFiles as jest.Mock;
const fetchResources = (BareResourceFetcher as any).fetch as jest.Mock;

// jest.mock factory may only reference vars prefixed with `mock`.
let mockKokoro: KokoroEngine;
jest.mock('../../../pro/audio/engine', () => ({
  ttsRegistry: {
    getRegisteredIds: () => ['kokoro'],
    getEngine: () => mockKokoro,
  },
}));
jest.mock('../../../pro/audio/ttsStore', () => ({
  useTTSStore: {
    getState: () => ({ settings: { engineId: 'kokoro' }, setEngine: jest.fn(), deleteModels: jest.fn(), downloadModels: jest.fn() }),
    subscribe: () => () => {},
  },
}));

import { ttsProvider } from '../../../pro/audio/ttsDownloadProvider';

// The full required set: two shared core .pte + the active voice's assets.
const CORE = ['duration_predictor.pte', 'synthesizer.pte'];
const VOICE = ['af_heart.bin', 'tagger.pt', 'lexicon.json'];
const allOnDisk = () => [...CORE, ...VOICE].map((f) => `/cache/react-native-executorch/${f}`);

beforeEach(() => {
  jest.clearAllMocks();
  mockKokoro = new KokoroEngine();
  listDownloadedFiles.mockResolvedValue([]);
  fetchResources?.mockResolvedValue(undefined);
});

describe('Kokoro download-state consistency (DM vs Voice tab share one source)', () => {
  it('mid-download: ALL required files on disk but the fetch is in flight must NOT read as completed', async () => {
    // The exact bug state: executorch has created every destination file before
    // their bytes finished, so basename presence is complete — but the download is
    // not. Pre-fix this surfaced as status 'completed' (82MB) in the Download
    // Manager. The live lifecycle now wins: an in-flight fetch is 'downloading'.
    listDownloadedFiles.mockResolvedValue(allOnDisk());
    mockKokoro._setDownloadProgress(0.61); // Voice tab shows 61% → phase 'downloading'

    const items = await ttsProvider.list();
    const kokoro = items.find((d) => d.id === 'tts:kokoro');

    // NEVER 'completed'. Both views render from this same list, so they agree.
    expect(kokoro?.status).toBe('downloading');
    expect(kokoro?.progress).toBeCloseTo(0.61);
  });

  it('genuinely complete: a resolved fetch reads as completed', async () => {
    fetchResources.mockResolvedValueOnce(undefined);
    await mockKokoro.downloadAssets(); // fetch resolves → genuine completion

    const kokoro = (await ttsProvider.list()).find((d) => d.id === 'tts:kokoro');
    expect(kokoro?.status).toBe('completed');
    expect(kokoro?.progress).toBe(1);
  });

  it('persisted completion hydrated on boot reads as completed', async () => {
    mockKokoro.hydrateDownloaded(true);

    const kokoro = (await ttsProvider.list()).find((d) => d.id === 'tts:kokoro');
    expect(kokoro?.status).toBe('completed');
  });

  it('partial (core .pte present, no completion) is not completed', async () => {
    // A prior interrupted fetch left the shared .pte behind; no fetch has finished.
    listDownloadedFiles.mockResolvedValue(CORE.map((f) => `/cache/react-native-executorch/${f}`));

    const kokoro = (await ttsProvider.list()).find((d) => d.id === 'tts:kokoro');
    expect(kokoro?.status).not.toBe('completed');
  });
});
