/**
 * RED-FLOW (integration) — Q20: a direct-audio model in CHAT (text-interface) mode records a standalone
 * voice note → the note is dispatched with NO transcribed text, so the model gets a content==='' turn.
 *
 * The REAL useVoiceInput hook + REAL audioRecorderService + REAL activeModelService + REAL stores run; only
 * the device leaves are faked (react-native-audio-api recorder via jest.setup, whisper.rn, the audio
 * session, the litert native module). supportsDirectAudio() is true (audio-capable model + recorder), and
 * interfaceMode is 'text' (NOT audio-interface) — so stopRecording takes Voice.ts:149's else branch, which
 * calls onAudioAttachment WITHOUT transcribing (bypasses resolveTranscription). The transcript is lost.
 *
 * The assertion is fix-shape-agnostic: it fails as long as the transcript reaches NEITHER dispatch path
 * (onAutoSend text arg, or a transcript on the attachment). Either fix ("transcribe+gate like the
 * audio-mode path") makes one of them carry the text → GREEN. Today neither does → RED.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

describe('Q20 — chat-mode direct-audio voice note dispatches an empty-content turn (red-flow)', () => {
  it('carries the transcribed text into the dispatched note instead of empty content', async () => {
    const boundary = installNativeBoundary({ ram: { platform: 'ios', totalBytes: 12 * 1024 ** 3, availBytes: 8 * 1024 ** 3 } });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { renderHook, act } = require('../../harness/nativeBoundary').requireRTL();
    const { liteRTService } = require('../../../src/services/litert');
    const { useVoiceInput } = require('../../../src/components/ChatInput/Voice');
    const { useAppStore } = require('../../../src/stores');
    const { useUiModeStore } = require('../../../src/stores/uiModeStore');
    const { useWhisperStore } = require('../../../src/stores');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // A direct-audio-capable LiteRT model is active and loaded WITH audio support.
    await liteRTService.loadModel('/models/gemma.litertlm', 'gpu', { supportsAudio: true, maxNumTokens: 4096 });
    useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'lrt', engine: 'litert' })], activeModelId: 'lrt' });
    useWhisperStore.setState({ downloadedModelId: 'base.en' }); // whisper is available, so a fix CAN transcribe
    useUiModeStore.setState({ interfaceMode: 'text' as never }); // CHAT mode, not the audio interface

    const autoSendArgs: unknown[][] = [];
    const attachmentArgs: Array<Record<string, unknown>> = [];
    const { result } = renderHook(() => useVoiceInput({
      conversationId: 'c1',
      onTranscript: () => {},
      onAutoSend: (...a: unknown[]) => { autoSendArgs.push(a); },
      onAudioAttachment: (p: Record<string, unknown>) => { attachmentArgs.push(p); },
    }));

    await act(async () => { await result.current.startRecording(); });
    // Precondition: the direct-audio recording actually started (else the branch below never runs).
    expect(result.current.isRecording).toBe(true);
    await act(async () => { await result.current.stopRecording(); });

    void boundary;
    // Proof the else branch (Voice.ts:149) fired: the note WAS dispatched as an audio attachment.
    expect(attachmentArgs.length).toBeGreaterThan(0);
    // The transcript must reach the model as content, via EITHER dispatch path.
    const gotText =
      autoSendArgs.some(a => typeof a[0] === 'string' && (a[0] as string).trim().length > 0) ||
      attachmentArgs.some(p => typeof p.transcript === 'string' && (p.transcript as string).trim().length > 0);

    // Today: chat mode → onAudioAttachment({uri,format,durationSeconds}) with no transcript, onAutoSend never
    // called → the note carries no text → the model would receive content='' → RED.
    expect(gotText).toBe(true);
  });
});
