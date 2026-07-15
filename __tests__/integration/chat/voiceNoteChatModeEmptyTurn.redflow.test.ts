/**
 * DEVICE 2026-07-14 — CHAT-mode STT must be identical on EVERY engine: transcribe and drop the text into the
 * INPUT BOX (dictation), for the user to review/edit/send. A direct-audio (LiteRT) model used to diverge —
 * chat-mode hold-to-talk dispatched a voice-note ATTACHMENT instead of filling the composer, unlike a
 * non-audio (llama) model. This pins the unified behavior: LiteRT chat-mode STT → onTranscript (composer),
 * NOT onAudioAttachment, NOT auto-send. (Voice/Audio interface mode still attaches audio — separate path.)
 *
 * REAL useVoiceInput + audioRecorderService + activeModelService + whisperService + stores; only device
 * leaves are faked. supportsDirectAudio() is true (audio-capable model + recorder) and interfaceMode is
 * 'text', so stopRecording takes Voice.ts's chat-mode else branch → transcribe the file → onTranscript.
 *
 * RED before the fix: the transcript went to onAudioAttachment (a dispatched voice note), not onTranscript.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

describe('chat-mode STT is dictation-to-the-input-box on every engine (LiteRT too) — device 2026-07-14', () => {
  it('a LiteRT direct-audio model in chat mode puts the transcript in the composer, not a voice-note attachment', async () => {
    // fs + whisper boundaries installed: the chat-mode voice note transcribes the recorded FILE via the
    // REAL whisperService.loadModel → transcribeFile path, so whisper must be genuinely loadable. That means
    // the model file has to exist on the (in-memory) disk — the one legitimate device leaf we place. Setting
    // downloadedModelId alone (with no file) makes whisperService.loadModel throw "not found" → whisper never
    // becomes resident → nothing to transcribe: a fabricated precondition that never exercises the real path.
    const boundary = installNativeBoundary({ fs: true, whisper: true, ram: { platform: 'ios', totalBytes: 12 * 1024 ** 3, availBytes: 8 * 1024 ** 3 } });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { renderHook, act } = require('../../harness/nativeBoundary').requireRTL();
    const RNFS = require('react-native-fs');
    const { liteRTService } = require('../../../src/services/litert');
    const { useVoiceInput } = require('../../../src/components/ChatInput/Voice');
    const { useAppStore } = require('../../../src/stores');
    const { useUiModeStore } = require('../../../src/stores/uiModeStore');
    const { useWhisperStore } = require('../../../src/stores');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // A direct-audio-capable LiteRT model is active and loaded WITH audio support.
    await liteRTService.loadModel('/models/gemma.litertlm', 'gpu', { supportsAudio: true, maxNumTokens: 4096 });
    useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'lrt', engine: 'litert' })], activeModelId: 'lrt' });
    // Whisper IS available: the model file is on disk (real leaf) + selected, so ensureWhisper() can load it
    // and transcribeFile can run. The recorded note transcribes to this text.
    boundary.fs!.seedFile(`${RNFS.DocumentDirectoryPath}/whisper-models/ggml-base.en.bin`, 75 * 1024 * 1024);
    await useWhisperStore.getState().refreshPresentModels();
    useWhisperStore.setState({ downloadedModelId: 'base.en' });
    boundary.whisper!.setFileTranscript('draw a dog');
    useUiModeStore.setState({ interfaceMode: 'text' as never }); // CHAT mode, not the audio interface

    const autoSendArgs: unknown[][] = [];
    const attachmentArgs: Array<Record<string, unknown>> = [];
    const transcriptArgs: string[] = [];
    const { result } = renderHook(() => useVoiceInput({
      conversationId: 'c1',
      onTranscript: (t: string) => { transcriptArgs.push(t); },
      onAutoSend: (...a: unknown[]) => { autoSendArgs.push(a); },
      onAudioAttachment: (p: Record<string, unknown>) => { attachmentArgs.push(p); },
    }));

    await act(async () => { await result.current.startRecording(); });
    // Precondition: the direct-audio recording actually started (else the branch below never runs).
    expect(result.current.isRecording).toBe(true);
    await act(async () => { await result.current.stopRecording(); });

    void boundary;
    // NEW unified behavior: the transcript lands in the COMPOSER (onTranscript) — dictation-to-the-input-box,
    // exactly like a non-audio (llama) model.
    expect(transcriptArgs.some(t => t.trim() === 'draw a dog')).toBe(true);
    // And it is NOT dispatched as a voice-note attachment, nor auto-sent — the user reviews/edits then sends.
    // RED before the fix: the transcript went to onAudioAttachment (a dispatched note), composer stayed empty.
    expect(attachmentArgs.length).toBe(0);
    expect(autoSendArgs.length).toBe(0);
  });
});
