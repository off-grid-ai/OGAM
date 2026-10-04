import type { VoiceSession, VoiceSessionEvent } from '@offgrid/application';
import { applicationFacade } from './applicationFacade';

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

const speech = () => applicationFacade().speech;

export const voiceSession = {
  current: (): VoiceSession => speech().snapshot().voice,

  /** The microphone may be open only while listening. */
  micShouldBeOpen: (): boolean => speech().session.micShouldBeOpen(),

  /** Audio may play only while speaking - so a reply after a stop stays silent. */
  speechMayPlay: (): boolean => speech().session.speechMayPlay(),

  /**
   * Apply an event. Silent when nothing changes, so the log shows real transitions only.
   *
   * Every transition is logged with its cause: a state that is wrong is always wrong because of the
   * event that produced it, and the state alone cannot say which.
   */
  dispatch(event: VoiceSessionEvent): void {
    speech().session.dispatch(event);
  },

  /** Test helper: module state outlives a test file, so each test needs a clean session. */
  _resetForTesting(): void {
    speech().session.dispatch('reset');
  },

  subscribe(listener: Listener): () => void {
    return speech().subscribe(snapshot => listener(snapshot.voice));
  },
};
