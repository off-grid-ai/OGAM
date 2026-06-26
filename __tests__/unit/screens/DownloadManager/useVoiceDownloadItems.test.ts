/**
 * useVoiceDownloadItems tests
 *
 * Surfaces downloaded voice (TTS, via the downloads.listVoiceModels hook) and
 * transcription (STT/Whisper, core) models in the Download Manager. Verifies
 * loading, the tts/stt mapping, and the delete-confirm alert.
 */
import { renderHook, waitFor, act } from '@testing-library/react-native';

const mockListDownloadedModels = jest.fn((..._a: any[]) => Promise.resolve([] as any[]));
const mockDeleteModel = jest.fn((..._a: any[]) => Promise.resolve());
jest.mock('../../../../src/services', () => ({
  whisperService: {
    listDownloadedModels: (...a: any[]) => mockListDownloadedModels(...a),
    deleteModel: (...a: any[]) => mockDeleteModel(...a),
  },
}));

const mockCallHook = jest.fn();
jest.mock('../../../../src/bootstrap/hookRegistry', () => ({
  callHook: (...a: any[]) => mockCallHook(...a),
  HOOKS: { downloadsListVoiceModels: 'downloads.listVoiceModels', downloadsDeleteVoiceModel: 'downloads.deleteVoiceModel' },
}));

import { useVoiceDownloadItems } from '../../../../src/screens/DownloadManagerScreen/useVoiceDownloadItems';

describe('useVoiceDownloadItems', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListDownloadedModels.mockResolvedValue([
      { modelId: 'base.en', fileName: 'ggml-base.en.bin', sizeBytes: 142_000_000, filePath: '/x/ggml-base.en.bin' },
    ]);
    mockCallHook.mockImplementation((name: string) =>
      name === 'downloads.listVoiceModels'
        ? Promise.resolve([{ engineId: 'kokoro', name: 'Kokoro TTS', sizeBytes: 82_000_000 }])
        : Promise.resolve(undefined));
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

  it('omits voice models when the pro hook is absent', async () => {
    mockCallHook.mockReturnValue(undefined);
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
