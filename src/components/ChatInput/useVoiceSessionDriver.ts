import { useEffect, useRef } from 'react';
import { voiceSession } from '../../services/voiceSession';
import { recordingController } from '../../services/recordingController';
import { logVoiceDiagnostic } from '../../utils/voiceDiagnostics';

/**
 * Obey the session's answer to "may a microphone be open right now".
 *
 * That is the entire responsibility. It replaces a hook that polled four separate signals, held a
 * `suspended` ref, scheduled a drain timer and tried to guess when a turn was over - all of which
 * existed because nothing owned the answer. The session owns it now, so this only has to obey -
 * in both directions: open the mic when the session listens, and cancel a recording the moment the
 * floor is seized out from under one.
 */
export function useVoiceSessionDriver(opts: {
  startTurn: () => void;
  inputReady: boolean;
}): void {
  const startRef = useRef(opts.startTurn);
  startRef.current = opts.startTurn;
  const inputReady = opts.inputReady;

  useEffect(() => {
    // EDGE, not level: a turn begins on the transition INTO listen, never on any notification that
    // happens to arrive while already listening. Read level-triggered, this opened a SECOND recording
    // every time anything else about the session changed mid-turn - and `phase` changes mid-turn by
    // design (`listening` -> `recording` the moment a voice is heard). The contract was always "on
    // every transition INTO listen"; this is that, actually implemented.
    let wasListening = voiceSession.current().state === 'listen';
    const stop = voiceSession.subscribe(session => {
      const listening = session.state === 'listen';
      const entered = listening && !wasListening;
      const previousListening = wasListening;
      wasListening = listening;
      logVoiceDiagnostic('session_observed_by_recorder', {
        previousListening,
        state: session.state,
        phase: session.phase,
        enteredListening: entered,
        replayReturnsTo: session.replayReturnsTo,
      });
      if (entered && inputReady) {
        logVoiceDiagnostic('session_dispatched_recording_start', {
          state: session.state,
          phase: session.phase,
        });
        startRef.current();
      }
      // A replay seizing the floor is the one exit from LISTEN the recorder does not drive itself:
      // stop and silence both flow through the recorder before the session moves. Cancel rather than
      // stop - pressing play on a saved message abandons the open turn, it does not finish it, so
      // there is nothing worth transcribing. Idempotent when nothing is recording.
      else if (session.replayReturnsTo) recordingController.cancel();
    });
    // The session may ALREADY be listening when this mounts (hands-free starts there), and a state
    // that never changes produces no event. Checking once is what makes entering the mode work.
    if (inputReady && voiceSession.micShouldBeOpen()) {
      const session = voiceSession.current();
      logVoiceDiagnostic('mounted_session_dispatched_recording_start', {
        state: session.state,
        phase: session.phase,
      });
      startRef.current();
    }
    return stop;
  }, [inputReady]);
}
