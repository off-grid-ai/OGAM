import { ImageModeState, MediaAttachment } from '../../types';

/**
 * Decides how a freshly recorded voice note is handled in Chat mode.
 *
 * A voice note is "standalone" when the composer has no typed text AND no other
 * pending attachments — in that case it is sent immediately (mirroring Audio
 * Mode's auto-send). When there is other content the user is building up a
 * message, so the voice note is added as a pending attachment for a manual send.
 *
 * Single source of truth for the branch — callers must not re-derive it.
 */
export function shouldAutoSendVoiceNote(opts: {
  composerText: string;
  pendingAttachments: MediaAttachment[];
}): boolean {
  const hasText = opts.composerText.trim().length > 0;
  const hasOtherAttachments = opts.pendingAttachments.length > 0;
  return !hasText && !hasOtherAttachments;
}

/**
 * Builds the audio MediaAttachment for a voice note, carrying the whisper
 * transcription as `textContent` (display-only for audio — llmMessages sends the
 * transcription to the model via `message.content`, never from the attachment).
 */
export function buildVoiceAttachment(opts: {
  uri: string;
  format: 'wav' | 'mp3';
  durationSeconds?: number;
  transcription?: string;
}): MediaAttachment {
  return {
    id: `audio-${Date.now()}`,
    type: 'audio',
    uri: opts.uri,
    audioFormat: opts.format,
    audioDurationSeconds: opts.durationSeconds,
    fileName: opts.uri.split('/').pop(),
    ...(opts.transcription?.trim() ? { textContent: opts.transcription.trim() } : {}),
  };
}

interface AudioInfo {
  uri: string;
  format: 'wav' | 'mp3';
  durationSeconds?: number;
  transcription?: string;
}

export interface VoiceNoteHandlerDeps {
  /** Current composer text (read at handler-invocation time). */
  getComposerText: () => string;
  /** Current pending attachments (read at handler-invocation time). */
  getPendingAttachments: () => MediaAttachment[];
  /** Whether the app is in Audio interface mode. */
  isAudioMode: boolean;
  /** Current image mode passed through to onSend. */
  imageMode: ImageModeState;
  onSend: (message: string, attachments: MediaAttachment[], imageMode: ImageModeState) => void;
  addAudioAttachment: (audio: { uri: string; audioFormat: 'wav' | 'mp3'; audioDurationSeconds?: number; transcription?: string }) => void;
  clearAttachments: () => void;
  appendTranscript: (text: string) => void;
  onHaptic: () => void;
}

/**
 * Builds the three voice callbacks (onTranscript / onAudioAttachment / onAutoSend)
 * from a set of dependencies, keeping all voice-note send/attach decisions out of
 * the View. Both Audio Mode auto-send and standalone Chat-mode auto-send route
 * through the SAME send path (`sendVoiceNote`).
 */
export function buildVoiceNoteHandlers(deps: VoiceNoteHandlerDeps) {
  // Single owning send path for every voice-note send (Audio Mode auto-send,
  // standalone Chat-mode audio auto-send, and standalone Chat-mode dictation
  // auto-send). `audioAttachment` is optional: the Whisper dictation path yields
  // a transcription but no persisted audio file, so a standalone dictation sends
  // as a plain text message (no audio attachment).
  const sendVoiceNote = (text: string, audioAttachment?: MediaAttachment) => {
    deps.onHaptic();
    const attachments = audioAttachment
      ? [...deps.getPendingAttachments(), audioAttachment]
      : [...deps.getPendingAttachments()];
    deps.onSend(text, attachments, deps.imageMode);
    deps.clearAttachments();
  };

  const isStandalone = (): boolean =>
    shouldAutoSendVoiceNote({
      composerText: deps.getComposerText(),
      pendingAttachments: deps.getPendingAttachments(),
    });

  // Whisper dictation path (Chat mode hold-to-talk, non-audio model): emits a
  // transcription with NO audio file. The transcript is placed INTO the composer
  // for the user to review and send — the device-correct behavior for hold-to-talk
  // (B26: the user spoke and expected the words in the input box; a blank input was
  // the bug). Appending (never auto-sending) means dictating over existing text
  // extends it, and a first dictation fills an empty composer. A blank transcript
  // produces nothing to append and is dropped.
  const onTranscript = (text: string) => {
    if (!text.trim()) return;
    deps.appendTranscript(text);
  };

  const onAudioAttachment = (audio: AudioInfo) => {
    if (isStandalone()) {
      const audioAttachment = buildVoiceAttachment(audio);
      sendVoiceNote(audio.transcription?.trim() ?? '', audioAttachment);
    } else {
      deps.addAudioAttachment({
        uri: audio.uri, audioFormat: audio.format, audioDurationSeconds: audio.durationSeconds, transcription: audio.transcription,
      });
    }
  };

  const onAutoSend = deps.isAudioMode
    ? (text: string, audio: { uri: string; format: 'wav' | 'mp3'; durationSeconds: number }) =>
        sendVoiceNote(text, buildVoiceAttachment(audio))
    : undefined;

  return { onTranscript, onAudioAttachment, onAutoSend };
}
