/**
 * Opens Scribe (its Improve screen) with a sentence to fix, so a person sees what it does at once.
 * Without Pro the Scribe screen is not registered: Get Pro opens instead.
 */
import { useNavigation } from '@react-navigation/native';
import { useHasRegisteredScreen } from '../navigation/screenRegistry';
import { useGetPro } from './useGetPro';

/** A line with the slips Scribe fixes: spelling, grammar and a missing comma. */
export const SCRIBE_SAMPLE = "Their going to send the report tomorow if its ready, can you check it.";

export function useOpenScribe(): () => void {
  // ScribeImprove is a Pro screen, registered at run time, so it is not in RootStackParamList.
  const navigation = useNavigation<{ navigate: (name: string, params: { text: string }) => void }>();
  const hasScribe = useHasRegisteredScreen('ScribeImprove');
  const getPro = useGetPro();
  return () => {
    if (hasScribe) navigation.navigate('ScribeImprove', { text: SCRIBE_SAMPLE });
    else getPro('scribe');
  };
}
