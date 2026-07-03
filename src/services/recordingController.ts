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
export type RecordPhase = 'idle' | 'recording' | 'transcribing';

export interface RecordingHandlers {
  start: () => void | Promise<void>;
  stop: () => void | Promise<void>;
  cancel: () => void;
}

type Listener = (phase: RecordPhase) => void;

class RecordingController {
  private phase: RecordPhase = 'idle';
  private handlers: RecordingHandlers | null = null;
  private readonly listeners = new Set<Listener>();

  /** The active recorder registers its concrete start/stop/cancel. Returns an
   *  unregister fn (call on unmount) so a stale recorder never receives intents. */
  registerHandlers(handlers: RecordingHandlers): () => void {
    this.handlers = handlers;
    return () => {
      if (this.handlers === handlers) this.handlers = null;
    };
  }

  getPhase(): RecordPhase {
    return this.phase;
  }

  isRecording(): boolean {
    return this.phase === 'recording';
  }

  /** The recorder reports lifecycle transitions here — the SINGLE writer of phase. */
  setPhase(phase: RecordPhase): void {
    if (phase === this.phase) return;
    this.phase = phase;
    for (const l of this.listeners) l(phase);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Start recording if idle. Decision is made from the authoritative phase. */
  start(): void {
    if (this.phase !== 'idle' || !this.handlers) return;
    void this.handlers.start();
  }

  /** Stop the in-flight recording (no-op unless actually recording). */
  stop(): void {
    if (this.phase !== 'recording' || !this.handlers) return;
    void this.handlers.stop();
  }

  /** The uniform mic action: stop when recording, start when idle. This is what
   *  every mic (hero + footer) dispatches, so a second tap stops instead of
   *  starting a second recording (the hero tap-to-stop bug). Ignored while
   *  transcribing (the stop already happened). */
  toggle(): void {
    if (this.phase === 'recording') this.stop();
    else if (this.phase === 'idle') this.start();
  }

  cancel(): void {
    if (!this.handlers) return;
    this.handlers.cancel();
  }

  /** Test helper. */
  _reset(): void {
    this.phase = 'idle';
    this.handlers = null;
    this.listeners.clear();
  }
}

export const recordingController = new RecordingController();
