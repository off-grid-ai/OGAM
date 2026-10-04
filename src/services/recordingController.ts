/**
 * recordingController — the SINGLE owner of the voice-record lifecycle.
 *
 * Recording state used to be fragmented: `isDirectRecording` + `isAudioModeRecording`
 * in useVoiceInput, `isRecording` in useWhisperTranscription, and private flags in
 * the native services — with the hero mic able only to START (the old write-only
 * recordBridge). So tapping the hero mic again started a SECOND recording instead
 * of stopping, and the hero couldn't reflect the recording state at all.
 *
 * This controller is the one place that holds the record phase (the single source
 * of truth) and dispatches the start/stop/cancel intents. The recorder (useVoiceInput)
 * registers the concrete handlers and reports phase transitions; every mic — hero
 * and footer, on either platform — dispatches `toggle()` and reads the same phase.
 * No reactive snapshot to desync, no second start: toggle() decides from the
 * authoritative phase.
 *
 * It owns coordination + state, not the recording mechanics — those stay in the
 * recorder, which is injected via registerHandlers (DIP). Lives in core so the core
 * footer mic and the pro hero mic both depend on this one contract.
 */

/** Explicit record lifecycle. `transcribing` is the post-stop window (whisper running). */
/**
 * 'listening' is hands-free before anyone has spoken: the microphone is open, the turn has NOT begun.
 *
 * A distinct phase rather than a flag on 'recording', because the difference is user-visible - the
 * hero says "Listening" and offers to cancel, not "Recording - tap to stop" over an empty turn - and
 * this owner exists precisely so one truth drives every surface.
 */
import { voiceSession } from './voiceSession';

export type RecordPhase = 'idle' | 'listening' | 'recording' | 'transcribing';

interface RecordingHandlers {
  start: () => void | Promise<void>;
  stop: () => void | Promise<void>;
  cancel: () => void;
}

type Listener = (phase: RecordPhase) => void;

class RecordingController {
  private handlers: RecordingHandlers | null = null;

  /** The active recorder registers its concrete start/stop/cancel. Returns an
   *  unregister fn (call on unmount) so a stale recorder never receives intents. */
  registerHandlers(handlers: RecordingHandlers): () => void {
    this.handlers = handlers;
    return () => {
      if (this.handlers === handlers) this.handlers = null;
    };
  }

  isRecording(): boolean {
    // Listening counts: the microphone IS open, so anything asking "are we capturing" must say yes -
    // otherwise a second tap starts a second recording, which is the bug this owner exists to stop.
    return voiceSession.micShouldBeOpen();
  }

  /**
   * Derived from the session, never stored.
   *
   * This used to hold its own phase and its own facts, which made it a SECOND state machine beside the
   * voice session - two answers to "what is happening", kept in step by hand. It now owns only INTENTS:
   * every microphone in the app dispatches start/stop/cancel here, and there is exactly one place that
   * knows which recorder they reach.
   */
  getPhase(): RecordPhase {
    const { state, phase } = voiceSession.current();
    if (state === 'listen')
      return phase === 'recording' ? 'recording' : 'listening';
    if (state === 'speak')
      return phase === 'transcribing' ? 'transcribing' : 'recording';
    return 'idle';
  }

  /** Forwards the SESSION's changes, so a surface subscribing here cannot see a different story. */
  subscribe(listener: Listener): () => void {
    return voiceSession.subscribe(() => listener(this.getPhase()));
  }

  /** Ask Shared Speech to begin through the registered platform binding. */
  start(): void {
    if (this.getPhase() !== 'idle' || !this.handlers) return;
    this.handlers.start();
  }

  /** Stop the in-flight recording. Listening counts: the mic is open, so stop must reach it -
   *  toggle() offered to stop a listening turn and this refused it. */
  stop(): void {
    if (!this.isRecording() || !this.handlers) return;
    this.handlers.stop();
  }

  /** The uniform mic action: stop when recording, start when idle. This is what
   *  every mic (hero + footer) dispatches, so a second tap stops instead of
   *  starting a second recording (the hero tap-to-stop bug). Ignored while
   *  transcribing (the stop already happened). */
  toggle(): void {
    if (this.isRecording()) this.stop();
    else if (this.getPhase() === 'idle') this.start();
  }

  cancel(): void {
    if (!this.handlers) return;
    this.handlers.cancel();
  }

  /** Test helper. Only handlers are ours to forget; the phase belongs to the session. */
  _reset(): void {
    this.handlers = null;
  }
}

export const recordingController = new RecordingController();
