export type VoiceProcessingState =
  | 'loading'
  | 'starting'
  | 'transcribing'
  | undefined;

/** Project the recorder lifecycle into one display state. */
export const deriveVoiceProcessingState = (input: {
  isRecording: boolean;
  isModelLoading: boolean;
  isStartingRecording: boolean;
  isTranscribing: boolean;
}): VoiceProcessingState => {
  if (input.isRecording) return undefined;
  if (input.isModelLoading) return 'loading';
  if (input.isStartingRecording) return 'starting';
  if (input.isTranscribing) return 'transcribing';
  return undefined;
};
