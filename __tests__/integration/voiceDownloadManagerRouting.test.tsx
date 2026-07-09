/**
 * Integration: a downloading Kokoro model flows through the WHOLE real chain to the
 * Download Manager's voice-items projection as an ACTIVE (not completed) row.
 *
 * Chain under test (all REAL, only native + store glue mocked):
 *   KokoroEngine  →  ttsProvider  →  modelDownloadService.list()  →  useVoiceDownloadItems
 *
 * This guards the device-confirmed bug where the Download Manager listed Kokoro under
 * "Downloaded Models" (82MB) while it was still downloading. The engine + provider were
 * correct; the failure was purely in how the item was classified/routed. Here we drive
 * a real mid-download engine and assert the DownloadItem the DM consumes is type:'active'
 * status:'downloading' — the classification useDownloadManager routes into Active
 * Downloads (its section routing is unit-tested in useDownloadManager.branches.test.ts).
 *
 * Only the executorch native fetcher, the whisper native list, and the ttsStore/registry
 * glue are mocked; the engine's completeness state machine, the provider's status
 * computation, the service's merge, and the hook's status→type mapping all run for real.
 */
import { renderHook, waitFor } from '@testing-library/react-native';
import { BareResourceFetcher } from 'react-native-executorch-bare-resource-fetcher';
import { KokoroEngine } from '../../pro/audio/engine/tts/engines/kokoro/KokoroEngine';
import { modelDownloadService } from '../../src/services/modelDownloadService';

const fetchResources = (BareResourceFetcher as any).fetch as jest.Mock;
const listDownloadedFiles = BareResourceFetcher.listDownloadedFiles as jest.Mock;

// jest.mock factories may only reference vars prefixed with `mock`.
let mockKokoro: KokoroEngine;
jest.mock('../../pro/audio/engine', () => ({
  ttsRegistry: {
    getRegisteredIds: () => ['kokoro'],
    getEngine: () => mockKokoro,
  },
}));
jest.mock('../../pro/audio/ttsStore', () => ({
  useTTSStore: {
    getState: () => ({ settings: { engineId: 'kokoro' }, setEngine: jest.fn(), deleteModels: jest.fn(), downloadModels: jest.fn() }),
    subscribe: () => () => {},
  },
}));

// Boundaries useVoiceDownloadItems touches beyond the TTS chain: whisper native list
// (no STT models on disk) and the whisper store selector it subscribes to.
jest.mock('../../src/services', () => ({
  whisperService: { listDownloadedModels: jest.fn(async () => []), deleteModel: jest.fn(async () => {}) },
}));
jest.mock('../../src/stores', () => ({
  useWhisperStore: Object.assign((sel: any) => sel({ presentModelIds: [] }), {
    getState: () => ({ deleteModelById: jest.fn(async () => {}) }),
  }),
}));
jest.mock('../../src/bootstrap/hookRegistry', () => ({
  callHook: jest.fn(),
  HOOKS: { downloadsListVoiceModels: 'downloads.listVoiceModels', downloadsDeleteVoiceModel: 'downloads.deleteVoiceModel' },
}));

import { ttsProvider } from '../../pro/audio/ttsDownloadProvider';
import { useVoiceDownloadItems } from '../../src/screens/DownloadManagerScreen/useVoiceDownloadItems';

beforeEach(() => {
  jest.clearAllMocks();
  mockKokoro = new KokoroEngine();
  listDownloadedFiles.mockResolvedValue([]);
  fetchResources?.mockResolvedValue(undefined);
  // Register the REAL tts provider into the REAL service singleton.
  modelDownloadService.register(ttsProvider);
});

describe('Download Manager voice routing (real engine → provider → service → hook)', () => {
  it('a mid-download Kokoro reaches the hook as an ACTIVE downloading row, not completed', async () => {
    // Real live download in flight on the real engine.
    mockKokoro._setDownloadProgress(0.5); // phase → 'downloading', genuineCompletion false

    const { result } = renderHook(() => useVoiceDownloadItems(jest.fn()));

    await waitFor(() => expect(result.current.voiceItems.some(i => i.modelType === 'tts')).toBe(true));
    const tts = result.current.voiceItems.find(i => i.modelType === 'tts')!;

    // The exact classification the Download Manager routes into "Active Downloads".
    // FAILS if the engine/provider ever regressed to reporting downloaded mid-fetch.
    expect(tts.type).toBe('active');
    expect(tts.status).toBe('downloading');
    expect(tts.progress).toBeCloseTo(0.5);
    expect(result.current.voiceItems.some(i => i.modelType === 'tts' && i.type === 'completed')).toBe(false);
  });

  it('a genuinely completed Kokoro reaches the hook as a COMPLETED row', async () => {
    await mockKokoro.downloadAssets(); // fetch resolves → genuine completion

    const { result } = renderHook(() => useVoiceDownloadItems(jest.fn()));

    await waitFor(() => expect(result.current.voiceItems.some(i => i.modelType === 'tts')).toBe(true));
    const tts = result.current.voiceItems.find(i => i.modelType === 'tts')!;
    expect(tts.type).toBe('completed');
    expect(tts.status).toBe('completed');
  });
});
