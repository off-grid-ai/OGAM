/**
 * STT input-side terminal-artifact guards: what reaches the model (or does NOT)
 * after recording, in TEXT mode and VOICE/AUDIO mode.
 *
 * Drives the REAL resolveTranscription (empty/not-ready decision) and the REAL
 * buildVoiceNoteHandlers (auto-send vs append; audio attachment vs dictation),
 * asserting the exact (message, attachments) handed to onSend — the payload the
 * generation layer will consume — and that audio is carried display-only, never
 * as the message text.
 *
 * Covers Q5b / B5b class: empty transcript + whisper-not-ready in each mode.
 */
import { resolveTranscription } from '../../../src/components/ChatInput/transcriptionOutcome';
import { buildVoiceNoteHandlers, type VoiceNoteHandlerDeps } from '../../../src/components/ChatInput/voiceNoteSend';
import { modelInputAudioUris } from '../../../src/services/modelMedia';
import type { MediaAttachment, ImageModeState } from '../../../src/types';

const IMAGE_MODE: ImageModeState = 'disabled';

function makeDeps(over: Partial<VoiceNoteHandlerDeps> = {}): {
  deps: VoiceNoteHandlerDeps;
  sends: Array<{ message: string; attachments: MediaAttachment[] }>;
  appended: string[];
  attachAdds: unknown[];
} {
  const sends: Array<{ message: string; attachments: MediaAttachment[] }> = [];
  const appended: string[] = [];
  const attachAdds: unknown[] = [];
  const deps: VoiceNoteHandlerDeps = {
    getComposerText: () => '',
    getPendingAttachments: () => [],
    isAudioMode: false,
    imageMode: IMAGE_MODE,
    onSend: (message, attachments) => sends.push({ message, attachments }),
    addAudioAttachment: (a) => attachAdds.push(a),
    clearAttachments: () => {},
    appendTranscript: (t) => appended.push(t),
    onHaptic: () => {},
    ...over,
  };
  return { deps, sends, appended, attachAdds };
}

describe('empty-transcript / whisper-not-ready decision (resolveTranscription)', () => {
  it('non-empty transcript → dispatch with trimmed text', () => {
    expect(resolveTranscription(true, '  hello there  ')).toEqual({ dispatch: true, text: 'hello there' });
  });
  it('empty transcript + whisper ready → NOT dispatched, "couldn\'t hear"', () => {
    const r = resolveTranscription(true, '   ');
    expect(r.dispatch).toBe(false);
    if (!r.dispatch) expect(r.message).toMatch(/hear that/i);
  });
  it('empty transcript + whisper NOT ready → NOT dispatched, "couldn\'t load"', () => {
    const r = resolveTranscription(false, '');
    expect(r.dispatch).toBe(false);
    if (!r.dispatch) expect(r.message).toMatch(/load the voice model/i);
  });
});

describe('TEXT-mode dictation (onTranscript): transcript reaches model, audio never', () => {
  it('standalone empty composer → auto-sends the transcript as the message text', () => {
    const { deps, sends } = makeDeps();
    buildVoiceNoteHandlers(deps).onTranscript('draw a dog');
    expect(sends).toEqual([{ message: 'draw a dog', attachments: [] }]);
  });

  it('blank transcript → nothing is sent (no empty turn to the model)', () => {
    const { deps, sends, appended } = makeDeps();
    buildVoiceNoteHandlers(deps).onTranscript('   ');
    expect(sends).toEqual([]);
    expect(appended).toEqual([]);
  });

  it('composer already has text → transcript is appended, NOT auto-sent', () => {
    const { deps, sends, appended } = makeDeps({ getComposerText: () => 'existing draft' });
    buildVoiceNoteHandlers(deps).onTranscript('more words');
    expect(sends).toEqual([]);
    expect(appended).toEqual(['more words']);
  });
});

describe('AUDIO-mode voice note (onAutoSend): transcript is the message, audio is display-only', () => {
  it('sends transcript as message text with the audio carried as an attachment', () => {
    const { deps, sends } = makeDeps({ isAudioMode: true });
    const handlers = buildVoiceNoteHandlers(deps);
    handlers.onAutoSend!('what time is it', { uri: 'file:///v.wav', format: 'wav', durationSeconds: 2 });
    expect(sends).toHaveLength(1);
    expect(sends[0].message).toBe('what time is it');
    const audio = sends[0].attachments.find((a) => a.type === 'audio');
    expect(audio).toBeTruthy();
    // The transcript reaches the model via message.content (the `text` arg above),
    // NOT via the attachment: the AUDIO-mode auto-send path does not thread the
    // transcription onto the attachment, so textContent is absent here.
    expect(audio!.textContent).toBeUndefined();
    // Either way the model-media rule keeps the audio OUT of the model input.
    expect(modelInputAudioUris(sends[0].attachments)).toEqual([]);
  });
});

describe('EDGE — direct-audio model in CHAT mode, standalone (onAudioAttachment)', () => {
  it('BUG: an untranscribed voice note auto-sends an EMPTY-content message to the model', () => {
    // Voice.ts:150 fires onAudioAttachment with NO transcription (the direct-audio,
    // non-audio-interface path bypasses resolveTranscription). Standalone → it
    // auto-sends. Since audio never reaches the model (modelInputAudioUris === []),
    // the model gets a message with EMPTY content and no usable input.
    const { deps, sends } = makeDeps({ isAudioMode: false });
    const handlers = buildVoiceNoteHandlers(deps);
    handlers.onAudioAttachment({ uri: 'file:///v.wav', format: 'wav', durationSeconds: 2 /* no transcription */ });
    expect(sends).toHaveLength(1);
    // Terminal artifact the model consumes: empty text + audio it will ignore.
    expect(sends[0].message).toBe('');
    expect(modelInputAudioUris(sends[0].attachments)).toEqual([]);
    // i.e. the model receives an empty, contentless turn.
  });
});
