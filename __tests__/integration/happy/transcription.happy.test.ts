/**
 * HAPPY-PATH (integration) — audio-interface transcription: the user records a note in audio mode and the
 * transcribed text is auto-sent (reaches the model as the turn content).
 *
 * The REAL useVoiceInput hook + REAL audioRecorderService + REAL whisperService + REAL resolveTranscription
 * run; only the device leaves are faked (react-native-audio-api recorder + whisper.rn native). This is the
 * success complement to the transcriptionEmpty guard (empty transcript → no dispatch): a real transcript →
 * dispatch with the spoken text.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

describe('happy — audio-mode transcription auto-sends the spoken text', () => {
  it('records, transcribes, and dispatches the transcript as the turn content', async () => {
    const boundary = installNativeBoundary({ fs: true, ram: { platform: 'ios', totalBytes: 12 * 1024 ** 3, availBytes: 8 * 1024 ** 3 } });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { renderHook, act } = require('../../harness/nativeBoundary').requireRTL();
    const { liteRTService } = require('../../../src/services/litert');
    const { useVoiceInput } = require('../../../src/components/ChatInput/Voice');
    const { useAppStore, useWhisperStore } = require('../../../src/stores');
    const { useUiModeStore } = require('../../../src/stores/uiModeStore');
    const whisperRn = require('whisper.rn');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // The (faked) native whisper context transcribes this recording to a known phrase.
    whisperRn.initWhisper.mockResolvedValue({ id: 'w', transcribe: () => ({ promise: Promise.resolve({ result: 'book a flight to tokyo' }) }) });
    // The whisper model file must exist on disk (real whisperService validates it before load).
    boundary.fs!.seedFile(`${boundary.fs!.DocumentDirectoryPath}/whisper-models/ggml-base.en.bin`, 142 * 1024 * 1024);

    await liteRTService.loadModel('/models/gemma.litertlm', 'gpu', { supportsAudio: true, maxNumTokens: 4096 });
    useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'lrt', engine: 'litert' })], activeModelId: 'lrt' });
    useWhisperStore.setState({ downloadedModelId: 'base.en' });
    useUiModeStore.setState({ interfaceMode: 'audio' as never }); // AUDIO interface — the transcribe+dispatch path

    const autoSendArgs: unknown[][] = [];
    const { result } = renderHook(() => useVoiceInput({
      conversationId: 'c1', onTranscript: () => {},
      onAutoSend: (...a: unknown[]) => { autoSendArgs.push(a); },
      onAudioAttachment: () => {},
    }));

    await act(async () => { await result.current.startRecording(); });
    expect(result.current.isRecording).toBe(true);
    await act(async () => { await result.current.stopRecording(); });

    // The spoken text was transcribed and dispatched as the turn content.
    expect(autoSendArgs.length).toBeGreaterThan(0);
    expect(autoSendArgs[0][0]).toBe('book a flight to tokyo');
  });
});
