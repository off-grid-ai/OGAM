import {
  initialVoiceSession,
  micShouldBeOpen,
  nextVoiceSession,
  speechMayPlay,
  type VoiceSession,
  type VoiceSessionEvent,
} from '@offgrid/speech';
import { useAppStore } from '../stores/appStore';
import { useUiModeStore } from '../stores/uiModeStore';
import logger from '../utils/logger';

/**
 * The one owner of "what is this voice session doing": listening, speaking, or stopped.
 *
 * The machine is in `@offgrid/speech` because a spoken turn is not a mobile idea - desktop has the
 * same three states. This holds the single instance, asks the store which mode is selected, and tells
 * everyone when the state changes.
 *
 * ONE owner on purpose. What this replaces kept the same truth in several places at once - a lock with
 * tokens, a derived floor, a per-hook `suspended` ref, an `awaitingSpeech` flag, a `replyInFlight`
 * boolean in the pro feature - and they drifted apart. Every deadlock came from two of them
 * disagreeing, and each one had to be found on a device.
 *
 * Anything that wants to open a microphone or play audio ASKS here. Nothing keeps its own copy.
 */

type Listener = (session: VoiceSession) => void;

const listeners = new Set<Listener>();

/** Read at every transition, so changing the setting takes effect on the next event. */
const handsFree = (): boolean =>
  useUiModeStore.getState().interfaceMode === 'audio' &&
  (useAppStore.getState().settings.voiceTurnMode ?? 'silence') === 'handsfree';

/**
 * Built on FIRST USE, never at module load.
 *
 * `handsFree()` reads the app store, and this module is reachable from that store's own import graph:
 * evaluating it here ran `useAppStore.getState()` while the store module was still initialising, where
 * `useAppStore` is still undefined. It took a whole test file down with it, and on a cold start it is
 * the same hazard. A voice session also does not need to exist before anything asks for one.
 */
let session: VoiceSession | null = null;

const current = (): VoiceSession => (session ??= initialVoiceSession(handsFree()));

/**
 * Which captured spoken turn holds the floor: counted up each time a capture hands the floor to the
 * assistant. A queued question remembers it, so its drain can hand back ITS floor and never end a later
 * spoken turn that happens to be in the same state.
 */
let capturedTurns = 0;

export const voiceSession = {
  current: (): VoiceSession => current(),

  /** The microphone may be open only while listening. */
  micShouldBeOpen: (): boolean => micShouldBeOpen(current()),

  /** Audio may play only while speaking - so a reply after a stop stays silent. */
  speechMayPlay: (): boolean => speechMayPlay(current()),

  /**
   * The spoken turn that holds the floor with no reply ready yet (`speak`/`transcribing`, as the capture
   * left it), or null when no captured turn is waiting for its reply.
   */
  floorTurn(): number | null {
    const now = current();
    const waiting = now.state === 'speak' && now.phase === 'transcribing' && !now.replayReturnsTo;
    return waiting ? capturedTurns : null;
  },

  /**
   * Apply an event. Silent when nothing changes, so the log shows real transitions only.
   *
   * Every transition is logged with its cause: a state that is wrong is always wrong because of the
   * event that produced it, and the state alone cannot say which.
   */
  dispatch(event: VoiceSessionEvent): void {
    const before = current();
    session = nextVoiceSession(before, event, handsFree());
    const captured = session.state === 'speak' && session.phase === 'transcribing';
    if (event === 'turnCaptured' && captured && (before.state !== 'speak' || before.phase !== 'transcribing')) {
      capturedTurns += 1;
    }
    // State AND phase. `phase` is what a person is shown - the hero says "Listening" and then
    // "Recording you now" - so a phase-only change is a real change and a surface that is not told
    // shows the wrong thing for the whole turn.
    //
    // This is safe ONLY because `useVoiceSessionDriver` is edge-triggered. While it started a turn on
    // any notification that found the state at `listen`, this same line made it open a second recording
    // mid-turn. If that driver is ever made level-triggered again, this notification becomes a second
    // capture - the two belong together.
    if (session.state === before.state && session.phase === before.phase) {
      logger.log(`[SESSION] ${before.state}/${before.phase} unchanged by ${event}`);
      return;
    }
    logger.log(
      `[SESSION] ${before.state}/${before.phase} -> ${session.state}/${session.phase} (${event})`,
    );
    for (const listener of listeners) listener(session);
  },

  /** Test helper: module state outlives a test file, so each test needs a clean session. */
  _resetForTesting(): void {
    // Cleared, not rebuilt: the next read builds it, and this helper then never touches the store.
    session = null;
    listeners.clear();
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
