import { useAppStore } from '../stores';
import { selectVoiceRecognitionUnlocked } from '../stores/proAccessSlice';

/** Reactive "is voice recognition (Pro) available right now" for UI gating. */
export function useVoiceRecognitionUnlocked(): boolean {
  return useAppStore(selectVoiceRecognitionUnlocked);
}
