/**
 * useVoiceDownloadItems tests
 *
 * Surfaces voice (TTS) + transcription (STT/Whisper) models in the Download Manager.
 * TTS state now comes from the SAME ModelDownloadService projection the Voice panel
 * reads (ttsProvider) — not a parallel `downloads.listVoiceModels` hook — so the two
 * surfaces can't disagree (the "Kokoro shows downloaded while still downloading" bug).
 * Delete still routes through the pro delete hook.
 */
import { renderHook, waitFor, act } from '@testing-library/react-native';
import type { ModelDownload } from '../../../../src/services/modelDownloadService/types';

const mockListDownloadedModels = jest.fn((..._a: any[]) => Promise.resolve([] as any[]));
const mockDeleteModel = jest.fn((..._a: any[]) => Promise.resolve());
const mockUnloadModel = jest.fn(async (..._a: any[]) => {});
// The hook reads whisperService.listDownloadedModels from the barrel, but the STT delete routes
// through the REAL whisperStore, which reads the CONCRETE services/whisperService. Mock BOTH paths,
// wired to the SAME mock closures, so the delete assertion sees the call regardless of which import
// reaches it. NB: each factory INLINES the object with lazy-arrow methods that read the mock-prefixed
// closures only when CALLED — an eager object/const captured in the factory is undefined at hoist
// time (ES imports run the factory before the const initializes).
jest.mock('../../../../src/services', () => ({
  whisperService: {
    listDownloadedModels: (...a: any[]) => mockListDownloadedModels(...a),
    deleteModel: (...a: any[]) => mockDeleteModel(...a),
    isModelLoaded: () => false,
    unloadModel: (...a: any[]) => mockUnloadModel(...a),
    getModelPath: (id: string) => `/models/ggml-${id}.bin`,
    isModelDownloaded: () => Promise.resolve(true),
  },
}));
jest.mock('../../../../src/services/whisperService', () => ({
  whisperService: {
    listDownloadedModels: (...a: any[]) => mockListDownloadedModels(...a),
    deleteModel: (...a: any[]) => mockDeleteModel(...a),
    isModelLoaded: () => false,
    unloadModel: (...a: any[]) => mockUnloadModel(...a),
    getModelPath: (id: string) => `/models/ggml-${id}.bin`,
    isModelDownloaded: () => Promise.resolve(true),
  },
  WHISPER_MODELS: [],
}));

let mockServiceList: ModelDownload[] = [];
jest.mock('../../../../src/services/modelDownloadService', () => ({
  modelDownloadService: {
    list: jest.fn(async () => mockServiceList),
    subscribe: jest.fn(() => () => {}),
  },
}));

const mockCallHook = jest.fn();
jest.mock('../../../../src/bootstrap/hookRegistry', () => ({
  callHook: (...a: any[]) => mockCallHook(...a),
  HOOKS: { downloadsListVoiceModels: 'downloads.listVoiceModels', downloadsDeleteVoiceModel: 'downloads.deleteVoiceModel' },
}));

import { useVoiceDownloadItems } from '../../../../src/screens/DownloadManagerScreen/useVoiceDownloadItems';

const CAPS = { cancel: false, retry: false, remove: true, resumable: true, determinateProgress: false };
const ttsEntry = (over: Partial<ModelDownload> = {}): ModelDownload => ({
  id: 'tts:kokoro', modelType: 'tts', name: 'Kokoro TTS', sizeBytes: 82_000_000,
  bytesDownloaded: 82_000_000, progress: 1, status: 'completed', capabilities: CAPS, ...over,
});

describe('useVoiceDownloadItems', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListDownloadedModels.mockResolvedValue([
      { modelId: 'base.en', fileName: 'ggml-base.en.bin', sizeBytes: 142_000_000, filePath: '/x/ggml-base.en.bin' },
    ]);
    mockServiceList = [ttsEntry()];
    mockCallHook.mockResolvedValue(undefined);
  });

  it('lists transcription (stt) and voice (tts) downloaded models', async () => {
    const { result } = renderHook(() => useVoiceDownloadItems(jest.fn()));

    await waitFor(() => expect(result.current.voiceItems).toHaveLength(2));

    const stt = result.current.voiceItems.find(i => i.modelType === 'stt');
    const tts = result.current.voiceItems.find(i => i.modelType === 'tts');
    expect(stt?.fileName).toBe('ggml-base.en.bin');
    expect(stt?.modelId).toBe('base.en');
    expect(tts?.modelId).toBe('kokoro');
    expect(tts?.fileName).toBe('Kokoro TTS');
  });

  it('shows an in-progress voice download as an ACTIVE item (service says downloading)', async () => {
    mockServiceList = [ttsEntry({ status: 'downloading', progress: 0.5, bytesDownloaded: 40_000_000 })];
    const { result } = renderHook(() => useVoiceDownloadItems(jest.fn()));
    await waitFor(() => expect(result.current.voiceItems.some(i => i.modelType === 'tts')).toBe(true));

    const tts = result.current.voiceItems.find(i => i.modelType === 'tts')!;
    expect(tts.type).toBe('active');
    expect(tts.status).toBe('downloading');
    expect(tts.progress).toBe(0.5);
    expect(tts.bytesDownloaded).toBe(40_000_000);
  });

  it('regression: a downloading TTS model is NEVER rendered as completed (the sync bug)', async () => {
    // The Download Manager showed Kokoro under "Downloaded Models" while the Voice
    // panel showed it at 0%. With one source, a service status of 'downloading' can
    // only ever produce an ACTIVE item here.
    mockServiceList = [ttsEntry({ status: 'downloading', progress: 0, bytesDownloaded: 0 })];
    const { result } = renderHook(() => useVoiceDownloadItems(jest.fn()));
    await waitFor(() => expect(result.current.voiceItems.some(i => i.modelType === 'tts')).toBe(true));

    const tts = result.current.voiceItems.find(i => i.modelType === 'tts')!;
    expect(tts.type).toBe('active');
    expect(result.current.voiceItems.some(i => i.modelType === 'tts' && i.type === 'completed')).toBe(false);
  });

  it('shows a finished voice download as a COMPLETED item', async () => {
    mockServiceList = [ttsEntry({ status: 'completed', progress: 1 })];
    const { result } = renderHook(() => useVoiceDownloadItems(jest.fn()));
    await waitFor(() => expect(result.current.voiceItems.some(i => i.modelType === 'tts')).toBe(true));

    const tts = result.current.voiceItems.find(i => i.modelType === 'tts')!;
    expect(tts.type).toBe('completed');
    expect(tts.status).toBe('completed');
  });

  it('surfaces a FAILED voice download as a retryable failed item', async () => {
    // Regression: a failed Kokoro download used to be dropped entirely (nothing
    // shown, no way to retry). A service status of 'error' must render as a
    // failed ACTIVE item with a retryable reason code so the Download Manager
    // shows the Retry button.
    mockServiceList = [ttsEntry({
      status: 'error', progress: 0.3, bytesDownloaded: 24_000_000,
      error: 'Download interrupted or missing resource',
    })];
    const { result } = renderHook(() => useVoiceDownloadItems(jest.fn()));
    await waitFor(() => expect(result.current.voiceItems.some(i => i.modelType === 'tts')).toBe(true));

    const tts = result.current.voiceItems.find(i => i.modelType === 'tts')!;
    expect(tts.type).toBe('active');
    expect(tts.status).toBe('failed');
    // Engine message present → prefer it verbatim; leave reasonCode undefined so
    // the label helper shows the engine text, not a canned code message. Retry
    // still renders because isRetryable(undefined) === true.
    expect(tts.reason).toBe('Download interrupted or missing resource');
    expect(tts.reasonCode).toBeUndefined();
  });

  it('falls back to the retryable code when the engine gives no failure message', async () => {
    mockServiceList = [ttsEntry({ status: 'error', progress: 0, bytesDownloaded: 0 })];
    const { result } = renderHook(() => useVoiceDownloadItems(jest.fn()));
    await waitFor(() => expect(result.current.voiceItems.some(i => i.modelType === 'tts')).toBe(true));

    const tts = result.current.voiceItems.find(i => i.modelType === 'tts')!;
    expect(tts.status).toBe('failed');
    expect(tts.reasonCode).toBe('download_interrupted');
  });

  it('omits voice models when the service reports no tts entries', async () => {
    mockServiceList = [];
    const { result } = renderHook(() => useVoiceDownloadItems(jest.fn()));

    await waitFor(() => expect(result.current.voiceItems).toHaveLength(1));
    expect(result.current.voiceItems[0].modelType).toBe('stt');
  });

  it('builds a delete alert that removes a transcription model on confirm', async () => {
    const onClose = jest.fn();
    const { result } = renderHook(() => useVoiceDownloadItems(onClose));
    await waitFor(() => expect(result.current.voiceItems).toHaveLength(2));

    const sttItem = result.current.voiceItems.find(i => i.modelType === 'stt')!;
    const alert = result.current.buildDeleteAlert(sttItem);
    expect(alert.title).toContain('Transcription');

    const confirm = alert.buttons?.find(b => b.text === 'Delete');
    await act(async () => { confirm?.onPress?.(); });

    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(mockDeleteModel).toHaveBeenCalledWith('base.en'));
  });

  it('builds a delete alert that calls the pro delete hook for voice models', async () => {
    const { result } = renderHook(() => useVoiceDownloadItems(jest.fn()));
    await waitFor(() => expect(result.current.voiceItems).toHaveLength(2));

    const ttsItem = result.current.voiceItems.find(i => i.modelType === 'tts')!;
    const alert = result.current.buildDeleteAlert(ttsItem);
    expect(alert.title).toContain('Voice');

    const confirm = alert.buttons?.find(b => b.text === 'Delete');
    await act(async () => { confirm?.onPress?.(); });

    await waitFor(() => expect(mockCallHook).toHaveBeenCalledWith('downloads.deleteVoiceModel', 'kokoro'));
  });
});
