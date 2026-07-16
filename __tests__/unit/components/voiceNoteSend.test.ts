/**
 * Unit tests for the voice-note send/attach logic (Feature 2 predicate +
 * Feature 1 transcription threading). These are pure functions — no mocks of the
 * thing under test; the real handlers run and we assert observable calls.
 */
import {
  shouldAutoSendVoiceNote,
  buildVoiceAttachment,
  buildVoiceNoteHandlers,
} from '../../../src/components/ChatInput/voiceNoteSend';
import { MediaAttachment } from '../../../src/types';

const imgAttachment: MediaAttachment = { id: 'img-1', type: 'image', uri: 'file:///a.jpg' };

describe('shouldAutoSendVoiceNote', () => {
  it('auto-sends when composer is empty and there are no other attachments', () => {
    expect(shouldAutoSendVoiceNote({ composerText: '', pendingAttachments: [] })).toBe(true);
    expect(shouldAutoSendVoiceNote({ composerText: '   ', pendingAttachments: [] })).toBe(true);
  });

  it('does NOT auto-send when there is typed composer text', () => {
    expect(shouldAutoSendVoiceNote({ composerText: 'hello', pendingAttachments: [] })).toBe(false);
  });

  it('does NOT auto-send when there is another pending attachment', () => {
    expect(shouldAutoSendVoiceNote({ composerText: '', pendingAttachments: [imgAttachment] })).toBe(false);
  });
});

describe('buildVoiceAttachment', () => {
  it('stores the transcription on textContent (single source of truth)', () => {
    const att = buildVoiceAttachment({ uri: '/tmp/v.wav', format: 'wav', durationSeconds: 3, transcription: '  hi there  ' });
    expect(att.type).toBe('audio');
    expect(att.audioFormat).toBe('wav');
    expect(att.audioDurationSeconds).toBe(3);
    expect(att.textContent).toBe('hi there');
    expect(att.fileName).toBe('v.wav');
  });

  it('omits textContent when there is no transcription (no stray empty text)', () => {
    const att = buildVoiceAttachment({ uri: '/tmp/v.wav', format: 'wav' });
    expect(att.textContent).toBeUndefined();
    const blank = buildVoiceAttachment({ uri: '/tmp/v.wav', format: 'wav', transcription: '   ' });
    expect(blank.textContent).toBeUndefined();
  });
});

describe('buildVoiceNoteHandlers.onAudioAttachment (Chat mode)', () => {
  const makeDeps = (over: Partial<Parameters<typeof buildVoiceNoteHandlers>[0]> = {}) => {
    const onSend = jest.fn();
    const addAudioAttachment = jest.fn();
    const clearAttachments = jest.fn();
    const appendTranscript = jest.fn();
    const onHaptic = jest.fn();
    const deps = {
      getComposerText: () => '',
      getPendingAttachments: () => [] as MediaAttachment[],
      isAudioMode: false,
      imageMode: 'auto' as const,
      onSend,
      addAudioAttachment,
      clearAttachments,
      appendTranscript,
      onHaptic,
      ...over,
    };
    return { deps, onSend, addAudioAttachment, clearAttachments, appendTranscript, onHaptic };
  };

  it('standalone voice note auto-sends with transcription in message content AND audio attachment', () => {
    const { deps, onSend, addAudioAttachment, clearAttachments } = makeDeps();
    const { onAudioAttachment } = buildVoiceNoteHandlers(deps);

    onAudioAttachment({ uri: '/tmp/v.wav', format: 'wav', durationSeconds: 2, transcription: 'what is the weather' });

    expect(addAudioAttachment).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledTimes(1);
    const [text, attachments, mode] = onSend.mock.calls[0];
    // transcription reaches text-only/vision models via message content
    expect(text).toBe('what is the weather');
    // audio-capable models get the input_audio attachment
    expect(attachments).toHaveLength(1);
    expect(attachments[0].type).toBe('audio');
    expect(attachments[0].textContent).toBe('what is the weather');
    expect(mode).toBe('auto');
    expect(clearAttachments).toHaveBeenCalledTimes(1);
  });

  it('adds as a pending attachment (no send) when composer already has text', () => {
    const { deps, onSend, addAudioAttachment } = makeDeps({ getComposerText: () => 'draft message' });
    const { onAudioAttachment } = buildVoiceNoteHandlers(deps);

    onAudioAttachment({ uri: '/tmp/v.wav', format: 'wav', durationSeconds: 2, transcription: 'hi' });

    expect(onSend).not.toHaveBeenCalled();
    expect(addAudioAttachment).toHaveBeenCalledWith({
      uri: '/tmp/v.wav', audioFormat: 'wav', audioDurationSeconds: 2, transcription: 'hi',
    });
  });

  it('adds as a pending attachment (no send) when another attachment is pending', () => {
    const { deps, onSend, addAudioAttachment } = makeDeps({ getPendingAttachments: () => [imgAttachment] });
    const { onAudioAttachment } = buildVoiceNoteHandlers(deps);

    onAudioAttachment({ uri: '/tmp/v.wav', format: 'wav', durationSeconds: 2 });

    expect(onSend).not.toHaveBeenCalled();
    expect(addAudioAttachment).toHaveBeenCalledTimes(1);
  });
});

describe('buildVoiceNoteHandlers.onTranscript (Chat-mode dictation)', () => {
  const makeDeps = (over: Partial<Parameters<typeof buildVoiceNoteHandlers>[0]> = {}) => {
    const onSend = jest.fn();
    const addAudioAttachment = jest.fn();
    const clearAttachments = jest.fn();
    const appendTranscript = jest.fn();
    const onHaptic = jest.fn();
    const deps = {
      getComposerText: () => '',
      getPendingAttachments: () => [] as MediaAttachment[],
      isAudioMode: false,
      imageMode: 'auto' as const,
      onSend,
      addAudioAttachment,
      clearAttachments,
      appendTranscript,
      onHaptic,
      ...over,
    };
    return { deps, onSend, addAudioAttachment, clearAttachments, appendTranscript, onHaptic };
  };

  it('standalone dictation (empty composer) fills the input for review — never auto-sends (B26)', () => {
    const { deps, onSend, appendTranscript } = makeDeps();
    const { onTranscript } = buildVoiceNoteHandlers(deps);

    onTranscript('what is the weather');

    // Hold-to-talk dictation puts the words in the input box (the device-correct
    // behavior — B26: a blank input after speaking was the bug), for the user to
    // review and send. It does NOT auto-send.
    expect(onSend).not.toHaveBeenCalled();
    expect(appendTranscript).toHaveBeenCalledWith('what is the weather');
  });

  it('does NOT send when the transcription is blank and there is no audio', () => {
    const { deps, onSend, appendTranscript } = makeDeps();
    const { onTranscript } = buildVoiceNoteHandlers(deps);

    onTranscript('   ');

    expect(onSend).not.toHaveBeenCalled();
    expect(appendTranscript).not.toHaveBeenCalled();
  });

  it('appends to the composer (no send) when composer already has text', () => {
    const { deps, onSend, appendTranscript } = makeDeps({ getComposerText: () => 'draft' });
    const { onTranscript } = buildVoiceNoteHandlers(deps);

    onTranscript('appended words');

    expect(onSend).not.toHaveBeenCalled();
    expect(appendTranscript).toHaveBeenCalledWith('appended words');
  });

  it('appends to the composer (no send) when another attachment is pending', () => {
    const { deps, onSend, appendTranscript } = makeDeps({ getPendingAttachments: () => [imgAttachment] });
    const { onTranscript } = buildVoiceNoteHandlers(deps);

    onTranscript('some speech');

    expect(onSend).not.toHaveBeenCalled();
    expect(appendTranscript).toHaveBeenCalledWith('some speech');
  });
});

describe('buildVoiceNoteHandlers.onAutoSend (Audio mode)', () => {
  it('is defined in audio mode and sends through the same path', () => {
    const onSend = jest.fn();
    const clearAttachments = jest.fn();
    const { onAutoSend } = buildVoiceNoteHandlers({
      getComposerText: () => '',
      getPendingAttachments: () => [],
      isAudioMode: true,
      imageMode: 'auto',
      onSend,
      addAudioAttachment: jest.fn(),
      clearAttachments,
      appendTranscript: jest.fn(),
      onHaptic: jest.fn(),
    });
    expect(onAutoSend).toBeDefined();
    onAutoSend!('spoken text', { uri: '/tmp/a.wav', format: 'wav', durationSeconds: 4 });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).toBe('spoken text');
    expect(onSend.mock.calls[0][1][0].type).toBe('audio');
    expect(clearAttachments).toHaveBeenCalled();
  });

  it('is undefined in chat mode (no audio-mode auto-send path)', () => {
    const { onAutoSend } = buildVoiceNoteHandlers({
      getComposerText: () => '',
      getPendingAttachments: () => [],
      isAudioMode: false,
      imageMode: 'auto',
      onSend: jest.fn(),
      addAudioAttachment: jest.fn(),
      clearAttachments: jest.fn(),
      appendTranscript: jest.fn(),
      onHaptic: jest.fn(),
    });
    expect(onAutoSend).toBeUndefined();
  });
});
