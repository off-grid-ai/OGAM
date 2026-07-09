/**
 * The single decision for "what happens after we try to transcribe a voice note":
 * dispatch the turn, or surface a retry message. Pure so it is unit-testable and so
 * the record hook (the View) holds no branching logic of its own.
 *
 * Why this exists: a voice note whose transcription produced NOTHING must never be
 * dispatched. Sending an empty transcript made the intent router classify on "" and
 * silently route the turn to the text model (a spoken "draw a dog" answered as text,
 * never reaching image generation). Worse, when the STT model failed to LOAD (a
 * heavier generation model owned RAM), the user was left stuck with no feedback.
 *
 * Two distinct misses, two distinct messages:
 *  - whisperReady = false → the transcription model couldn't be loaded (memory) →
 *    guide the user to free memory and retry.
 *  - whisperReady = true but empty transcript → the clip was silence / too short →
 *    "couldn't hear that".
 */
export type TranscriptionOutcome =
  | { dispatch: true; text: string }
  | { dispatch: false; message: string };

export function resolveTranscription(
  whisperReady: boolean,
  rawTranscript: string,
): TranscriptionOutcome {
  const text = rawTranscript.trim();
  if (text) return { dispatch: true, text };
  return {
    dispatch: false,
    message: whisperReady
      ? "Couldn't hear that — try again"
      : "Couldn't load the voice model — free some memory and try again",
  };
}
